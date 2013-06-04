var async  = require('async'),
    Class  = require('js-class'),
    Logger = require('evo-elements').Logger,
    
    Server       = require('./Server'),
    Connector    = require('./Connector'),
    Extensions   = require('./Extensions'),
    MessengerExt = require('./MessengerExt'),
    AdvertiseExt = require('./AdvertiseExt');

var logger = new Logger('neuron:lsvc');

var LocalConnection = Class({
    constructor: function (id, connection, protocol, service) {
        this.id = id;
        this.service = service;
        this.protocol = protocol;        
        this.connection = connection
            .on('message', this.onMessage.bind(this))
            .on('close', this.onClose.bind(this));
    },
    
    send: function (msg) {
        if (this.connection) {
            this.connection.send(this.protocol.encode(msg));
            return true;
        }
        return false;
    },
    
    onMessage: function (rawMsg) {
        var msg = this.protocol.decode(rawMsg);
        if (!msg || !msg.event) {
            return;
        }
        this.service.onLocalMessage(msg, this);
    },
    
    onClose: function (reasonCode, description) {
        this.service.onConnectionClose(this, reasonCode, description);
        delete this.connection;
    }
});

var LocalService = Class({
    constructor: function (opts) {
        this.connector = new Connector(opts)
            .on('state', this.onStateChanged.bind(this))
            .on('message', this.onMessage.bind(this));
        this.opts = opts;
        this.connections = {};
        this.idBase = 0;
        
        this.exts = new Extensions([
            new MessengerExt.Member(this),
            new AdvertiseExt.Member(this)
        ]);
        
        this.server = new Server({
            routes: function (app) {
                
            }
        }).on('connection', this.onConnection.bind(this));
    },
    
    start: function (callback) {
        var addresses = [];
        async.parallel([
            function (done) {
                if (this.opts.port) {
                    this.server.listen(this.opts.port, '127.0.0.1', function () {
                        addresses.push('127.0.0.1:' + this.opts.port);
                        done();
                    });
                } else {
                    done();
                }
            }.bind(this),
            function (done) {
                if (this.opts.sock) {
                    this.server.listen(this.opts.sock, function () {
                        this.addresses.push(this.opts.sock);
                        done();
                    });
                } else {
                    done();
                }
            }.bind(this),
        ], function () {
            logger.notice("Local Service is ready on: %j", addresses);
            this.connector.start(callback);
        }.bind(this));
        return this;
    },
    
    stop: function (callback) {
        async.parallel([
            function (done) {
                this.server.close(done);
            }.bind(this),
            function (done) {
                this.connector.stop(done);
            }.bind(this)
        ], callback);
        return this;
    },
    
    sendToMaster: function (event, data) {
        return this.connector.sendToMaster(event, data);
    },
    
    multicast: function (connIds, event, data) {
        var msg = { event: event, data: data };
        async.each(connIds, function (connId) {
            var conn = this.connections[connId];
            if (conn) {
                conn.send(msg);
            }
        }.bind(this));
    },
    
    onStateChanged: function (state) {
        this.exts.invokeAsync('stateChanged', [state]);
    },
    
    onMessage: function (msg) {
        this.exts.dispatch('cluster', msg);
    },
    
    onLocalMessage: function (msg, conn) {
        this.exts.dispatch('client', msg, conn);
    },
    
    onConnection: function (connection, protocol) {
        this.idBase ++;
        while (this.connections[this.idBase]) {
            this.idBase ++;
        }
        var id = this.idBase;
        var conn = new LocalConnection(id, connection, protocol, this);
        this.connections[id] = conn;
        this.exts.invokeAsync('connection', conn);
    },
    
    onConnectionClose: function (conn) {
        delete this.connections[conn.id];
        this.exts.invokeAsync('disconnect', conn);
    }
});

module.exports = LocalService;