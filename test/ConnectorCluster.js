var async    = require('async'),
    request  = require('request'),
    elements = require('evo-elements'),
    Class    = elements.Class,
    
    Connector = require('../lib/Connector');

var ConnectorCluster = Class({
    constructor: function (basePort) {
        this.basePort = basePort || process.env.PORT || 9000;
        this.connectors = [];
    },
    
    start: function (index, opts, callback) {
        if (typeof(opts) == 'function') {
            callback = opts;
            opts = {};
        }
        
        if (this.connectors[index]) {
            callback(this.connectors[index]);
        } else {
            var port = this.basePort + index;
            var connOpts = {
                address: '127.0.0.1',
                port: port
            };
            if (!opts.master) {
                connOpts.bootstraps = ["http://127.0.0.1:" + this.basePort];
            }
            var connector = new Connector(connOpts);
            this.connectors[index] = connector;
            connector.start(callback);
        }
        return this;
    },
    
    stop: function (index, callback) {
        var connector = this.connectors[index];
        if (connector) {
            delete this.connectors[index];
            connector.stop(callback);
        } else {
            callback(null);
        }
        return this;
    },
    
    startBatch: function (count, opts, callback) {
        if (typeof(opts) == 'function') {
            callback = opts;
            opts = {};
        }
        var base = opts.base ? opts.base : 0;
        async.times(count, function (n, next) {
            this.start(base + n, opts, function () { next(); });
        }.bind(this), callback);
        return this;
    },
    
    stopBatch: function (count, base, callback) {
        if (typeof(base) == 'function') {
            callback = base;
            base = 0;
        }
        async.times(count, function (n, next) {
            this.stop(base + n, function () { next(); });
        }.bind(this), callback);
        return this;
    },
    
    startAll: function (nodes, callback) {
        if (nodes > 0) {
            async.series([
                function (next) {
                    this.start(0, { master: true }, function () { next(); });
                }.bind(this),
                function (next) {
                    this.startBatch(nodes - 1, { base: 1 }, function () { next(); });
                }.bind(this)
            ], callback);
        }
        return this;
    },
    
    stopAll: function (callback) {
        this.stopBatch(this.connectors.length, callback);
        return this;
    },
    
    queryTopology: function (index, callback) {
        if (this.connectors[index]) {
            request('http://127.0.0.1:' + this.basePort + index + '/topology', function (error, response, body) {
                callback({
                    topology: body,
                    error: error,
                    response: response
                });
            });
        } else {
            callback();
        }
        return this;
    },
    
    queryTopologies: function (indices, base, callback) {
        var results = [];
        if (isFinite(base)) {
            async.times(indices, function (n, next) {
                this.queryTopology(base + n, function (result) {
                    results[base + n] = result;
                    next();
                });
            }.bind(this), function () { callback(results); });
        } else {
            callback = base;
            if (!Array.isArray(indices)) {
                indices = [indices];
            }
            async.each(indices, function (index, next) {
                this.queryTopology(index, function (result) {
                    results[index] = result;
                    next();
                });
            }.bind(this), function () {
                callback(results);
            });
        }
        return this;
    },
    
    nodes: function (index) {
        var indices = {}, connector = this.connectors[index];
        if (connector) {
            var nodes = connector.topology.nodes;
            for (var id in nodes) {
                indices[nodes[id].port - this.basePort] = true;
            }
        }
        return indices;
    }
});

module.exports = ConnectorCluster;