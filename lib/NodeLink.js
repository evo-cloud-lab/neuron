var ClientSocket = require('websocket').client,
    elements     = require('evo-elements'),
    Class        = elements.Class,
    trace        = elements.Trace('neuron:node:link'),
    
    LinkProtocol = require('./LinkProtocol');

var RETRY_DELAY = [100, 200, 500, 1000, 1000, 2000, 2000, 5000, 5000];

module.exports = Class(process.EventEmitter, {
    constructor: function (node) {
        this.node = node;
        this.protocol = LinkProtocol.preferred.create();
        this.socket = new ClientSocket()
            .on('connect', this.onConnect.bind(this))
            .on('connectFailed', this.onConnectFailed.bind(this));
    },
    
    connect: function () {
        this.reconnect = 0;
        this._reconnect(true);
        return this;
    },
    
    disableReconnect: function () {
        this.reconnect = -1;
        return this;
    },
    
    send: function (event, data) {
        if (this.connection) {
            var msg = this.protocol.encode({ event: event, data: data });
            trace.debug('SEND %s: %j', this.node.linkUri, msg);
            this.connection.send(msg);
        }
        return this;
    },
    
    close: function () {
        this.disableReconnect();
        if (this.connection) {
            this.connection.close();
        }
        return this;
    },
    
    get connected () {
        return !!this.connection;
    },
    
    _connect: function () {
        trace.verbose('CONNECT %s: %s', this.node.linkUri, this.protocol.id);
        this.socket.connect(this.node.linkUri, this.protocol.id);
    },
    
    _reconnect: function (nodelay) {
        if (this.pending) {
            clearTimeout(this.pending);
            delete this.pending;
        }
        if (this.reconnect >= 0 && this.reconnect < RETRY_DELAY.length) {
            if (!nodelay) {
                trace.debug('DELAY %s: %d', this.node.linkUri, RETRY_DELAY[this.reconnect]);
                this.pending = setTimeout(function () {
                    this.reconnect ++;
                    this._connect();
                }.bind(this), RETRY_DELAY[this.reconnect]);
            } else {
                this._connect();
            }
        } else if (this.reconnect >= RETRY_DELAY.length) {
            trace.verbose('TIMEOUT %s', this.node.linkUri);
            this.emit('timeout', this);
        }
    },
    
    onConnect: function (conn) {
        this.connection = conn
            .on('message', this.onMessage.bind(this))
            .on('error', this.onConnectionError.bind(this))
            .on('close', this.onConnectionClose.bind(this));
        if (this.reconnect >= 0) {
            this.reconnect = 0;
        }
        trace.verbose('UP %s', this.node.linkUri);
        this.emit('up', this);
        return this;
    },
    
    onConnectFailed: function (err) {
        trace.error('CONNECT FAILED %s: %s', this.node.linkUri, err);
        this._reconnect();
    },
    
    onMessage: function (rawMsg) {
        var msg = this.protocol.decode(rawMsg);        
        if (msg) {
            trace.debug('MSG %s: %j', this.node.linkUri, msg);
            this.emit('message', msg, this);
        }
    },
    
    onConnectionError: function (err) {
        trace.error('ERROR %s: %s', this.node.linkUri, err);
        this.emit('error', err);
    },
    
    onConnectionClose: function (reasonCode, description) {
        trace.verbose('DOWN %s: %d %s', this.node.linkUri, reasonCode, description);
        this.emit('down', this, { code: reasonCode, message: description });
        delete this.connection;
        this._reconnect();
    }
});