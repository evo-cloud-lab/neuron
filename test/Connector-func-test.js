var assert  = require('assert'),
    async   = require('async'),
    ClientSocket = require('websocket').client,
    Helpers = require('./Helpers'),
    ClusterManager = require('./ClusterManager');

describe('Connector Functional', function () {
    var cluster;
    
    beforeEach(function () {
        cluster = new ClusterManager();
    });
    
    afterEach(function () {
        cluster.stop();
    });
    
    it('Simply creates a network with 16 nodes', function (done) {
        this.timeout(5000);
        cluster
            .on('allready', function (ready) {
                if (ready) {
                    done();
                }
            })
            .start(16, 'connector');
    });
    
    it('Master election', function (done) {
        this.timeout(60000);
        var state = 'connect';
        cluster
            .on('allready', function (ready) {
                switch (state) {
                    case 'connect':
                        if (ready) {
                            cluster.kill(0);
                            state = 'disconnect';
                        }
                        break;
                    case 'disconnect':
                        if (!ready) {
                            state = 'elected';
                            break;
                        }
                        break;
                    case 'elected':
                        if (ready) {
                            Helpers.expects(function () {
                                cluster.nodes.forEach(function (node) {
                                    assert.equal(node.topology.master, cluster.portBase + 1);
                                });
                            }, done, true);
                        }
                        break;
                }
            })
            .start(16, 'connector');
    });
    
    it('Non-master redirection', function (done) {
        this.timeout(5000);
        var initial = true;
        cluster
            .on('allready', function (ready) {
                if (initial && ready) {
                    initial = false;
                    var socket = new ClientSocket()
                        .on('connect', function () {
                            done(new Error('Expect connectFailed'));
                        })
                        .on('connectFailed', function (err) {
                            Helpers.expects(function () {
                                var lines = err.split('\n'), location;
                                assert.ok(lines[0].match(/status: 302$/));
                                assert.ok(lines.slice(1).some(function (line) {
                                    var m = line.match(/^location:\s+(\S+)$/i);
                                    location = m ? m[1] : undefined;
                                    return !!m;
                                }));
                                assert.equal(location, 'ws://127.0.0.1:' + cluster.portBase);
                            }, done, true);
                        })
                        .connect('ws://127.0.0.1:' + (cluster.portBase + 1), 'evo-neuron-json');
                }
            })
            .start(2, 'connector');
    });
});