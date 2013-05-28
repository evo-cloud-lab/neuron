var assert  = require('assert'),
    async   = require('async'),
    Helpers = require('./Helpers'),
    ConnectorCluster = require('./ConnectorCluster');

describe('Connector Functional', function () {
    var cluster;
    
    beforeEach(function () {
        cluster = new ConnectorCluster();
    });
    
    afterEach(function (done) {
        this.timeout(10000);
        cluster.stopAll(done);
    });
    
    it('Simply creates a network with 16 nodes', function (done) {
        this.timeout(5000);
        
        var NODES = 16;
        cluster.startAll(NODES, function () {
            var timer = setInterval(function () {
                if (cluster.connectors.every(function (connector) {
                    return connector.ready;
                })) {
                    clearInterval(timer);
                    setTimeout(function () {
                        Helpers.expects(function () {
                            for (var n = 0; n < NODES; n ++) {
                                var nodes = cluster.nodes(n);
                                for (var i = 0; i < NODES; i ++) {
                                    assert(nodes[i], 'Node ' + i + ' not in Node ' + n);
                                }
                            }
                        }, done, true);
                    }, 2000);
                }
            }, 500);
        });
    });
});