var fork    = require('child_process').fork,
    Class   = require('js-class'),
    request = require('request');

var ClusterNode = Class({
    constructor: function (index, manager, opts) {
        this.index = index;
        this.manager = manager;
        this.port = manager.portBase + index;
        var args = ['--id=' + this.port.toString(), '--port=' + this.port, '--address=127.0.0.1' ];
        for (var key in opts) {
            var val = (typeof(opts[key]) == 'object' || Array.isArray(opts[key])) ? JSON.stringify(opts[key]) : opts[key];
            args.push('--' + key + '=' + val);
        }
        if (process.env.LOGGER != undefined) {
            args.push('--logger=' + process.env.LOGGER);
        } else {
            args.push('--logger={"drivers":{}}');
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
        switch (msg.event) {
            case 'topology':
                this.topology = msg.data;
                //console.log('%d TOPOLOGY %j', this.port, this.topology);
                this._checkReadiness();
                break;
            case 'state':
                this.readyState = msg.data.ready;
                this._checkReadiness();
                break;
        }
        this.manager.nodeMessage(msg, this);
    },
    
    _checkReadiness: function () {
        var readiness = false;
        if (this.readyState && this.topology && Array.isArray(this.topology.nodes)) {
            var nodes = {};
            this.topology.nodes.forEach(function (node) {
                nodes[node.id] = true;
            });
            readiness = this.manager.nodes.every(function (node) {
                var id = node.port.toString();
                return nodes[id];
            });
        }
        this.manager.nodeReadiness(readiness, this);
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
            var opts = {};
            if (mode) {
                opts.mode = mode;
            }
            if (i > 0) {
                opts.bootstraps = ['http://127.0.0.1:' + this.portBase];
            }
            this.nodes[i] = new ClusterNode(i, this, opts);
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
    
    kill: function (index) {
        var node = this.nodes[index];
        delete this.nodes[index];
        if (node) {
            node.kill();
        }
        return this;
    },
    
    spawn: function (index, opts) {
        var node = new ClusterNode(index, this, opts);
        this.nodes[index] = node;
        return node;
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