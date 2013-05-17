var elements = require('evo-elements'),
    Class    = elements.Class,
    trace    = elements.Trace('neuron:master:link'),
    
    Node         = require('./Node'),
    LinkProtocol = require('./LinkProtocol');

var CFG_AUTHINFO_TIMEOUT = 3000;

var LinkConnection = Class(Node, {
    constructor: function (conn, protocol) {
        Node.prototype.constructor.call(this);
        this.connection = conn
            .on('message', this.onMessage.bind(this))
            .on('close', this.onClose.bind(this));
        this.protocol = protocol;
        trace.verbose('ACCEPT %s', conn.remoteAddress);
        this.timer = setTimeout(this.onTimeout.bind(this), CFG_AUTHINFO_TIMEOUT);
    },
    
    send: function (event, data) {
        if (this.connection) {
            var msg = this.protocol.encode({ event: event, data: data });
            trace.debug('SEND %s: %j', this.id, msg);
            this.connection.send(msg);
        }
        return this;
    },
    
    onTimeout: function () {
        trace.verbose('TIMEOUT %s', this.connection.remoteAddress);
        this.connection.close();
    },
    
    onClose: function () {
        this._cancelTimer();
        trace.verbose('CLOSE %s %s', this.connection.remoteAddress, this.id);
        if (this.valid) {
            this.emit('disconnect', this);
        }
        delete this.connection;
    },
    
    onMessage: function (rawMsg) {
        var msg = this.protocol.decode(rawMsg);
        if (!msg) {
            return;
        }
        
        trace.debug('MSG %s: %j', this.id, msg);
        
        if (this.valid) {
            this.emit('message', msg, this);
        } else if (msg.event == 'id' && this.load(msg.data)) {
            this._cancelTimer();
            this.emit('connection', this);
        }
    },
    
    _cancelTimer: function () {
        if (this.timer) {
            clearTimeout(this.timer);
            delete this.timer;
        }
    }
}, {
    implements: [process.EventEmitter],
    statics: {
        accept: function (request) {
            trace.verbose('REQUEST %s, %j', request.remoteAddress, request.requestedProtocols);
            var protocolClass = LinkProtocol.select(request.requestedProtocols);
            if (!protocolClass) {
                request.reject(400, 'Unsupported protocol');
                return null;
            }
            var connection = request.accept(protocolClass.id, request.origin);
            return new LinkConnection(connection, protocolClass.create());
        }
    }
});

module.exports = LinkConnection;