var fork    = require('child_process').fork,
    Class   = require('js-class'),
    request = require('request');

var ClusterNode = Class({
    constructor: function (id, manager, mode) {
        this.id = id;
        this.manager = manager;
        this.port = manager.portBase + id;
        var args = ['--id', this.port.toString(), '--port', this.port, '--address', '127.0.0.1' ];
        if (id > 0) {
            args.push('--bootstraps');
            args.push('json:["http://127.0.0.1:' + manager.portBase + '"]');
        }
        if (mode) {
            args.push('--mode');
            args.push(mode);
        }
        this.process = fork(__dirname + '/NodeHost.js', args)
            .on('message', this.onMessage.bind(this));
    },
    
    kill: function () {
        this.process.kill();
    },
    
    queryTopology: function (callback) {
        request({ url: 'http://127.0.0.1:' + this.port + '/topology', json: true }, function (error, response, body) {
            if (error) {
                callback(error);
            } else if (response.statusCode < 300) {
                callback(null, body);
            } else {
                var err = new Error('REST Error');
                err.response = response;
                callback(err, body);
            }
        }.bind(this));
    },
    
    onMessage: function (msg) {
        if (msg.event == 'topology') {
            this.topology = msg.data;
            //console.log('%d TOPOLOGY %j', this.port, this.topology);
            var readiness = false;
            if (this.topology && Array.isArray(this.topology.nodes)) {
                var nodes = {};
                this.topology.nodes.forEach(function (node) {
                    nodes[node.id] = true;
                });
                readiness = this.manager.nodes.every(function (node) {
                    var id = node.port.toString();
                    return nodes[id]
                });
            }
            this.manager.nodeReadiness(readiness, this);
        }
        this.manager.nodeMessage(msg, this);
    }
});

var ClusterManager = Class(process.EventEmitter, {
    constructor: function (opts) {
        this.portBase = opts && opts.port ? opts.port : 9000;
        this.nodes = [];
    },
    
    get nodeCount () {
        return this.nodes.length;
    },
    
    start: function (nodeCount, mode) {
        for (var i = 0; i < nodeCount; i ++) {
            this.nodes[i] = new ClusterNode(i, this, mode);
        }
        return this;
    },
    
    stop: function () {
        this.nodes.forEach(function (node) {
            node.kill();
        });
        this.nodes = [];
        return this;
    },
    
    nodeMessage: function (msg, node) {
        this.emit('message', msg, node);
    },
    
    nodeReadiness: function (ready, node) {
        var changed = node.ready != ready;
        node.ready = ready;
        if (changed) {
            //console.log('READINESS %d %s', node.port, ready);
            this.emit('ready', ready, node);
            var allReady = this.nodes.every(function (node) { return node.ready; });
            changed = allReady != this.allReady;
            this.allReady = allReady;
            if (changed) {
                this.emit('allready', allReady);
            }
        }
    }
});

module.exports = ClusterManager;