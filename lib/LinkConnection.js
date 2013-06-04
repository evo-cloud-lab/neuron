var Class  = require('js-class'),
    Logger = require('evo-elements').Logger,
    
    Node         = require('./Node'),
    LinkProtocol = require('./LinkProtocol');

var CFG_AUTHINFO_TIMEOUT = 3000;

var LinkConnection = Class(Node, {
    constructor: function (conn, protocol, masterState) {
        Node.prototype.constructor.call(this);
        this.connection = conn
            .on('message', this.onMessage.bind(this))
            .on('close', this.onClose.bind(this));
        this.protocol = protocol;
        this.logger = new Logger('neuron:master:link', function () {
            return '<' + masterState.topology.id + '> ' + (this.id ? ':<' + this.id + '> ' : '');
        }.bind(this));
        this.logger.verbose('ACCEPT %s', conn.remoteAddress);
        this.timer = setTimeout(this.onTimeout.bind(this), CFG_AUTHINFO_TIMEOUT);
    },
    
    send: function (event, data) {
        if (this.connection) {
            var msg = this.protocol.encode({ event: event, data: data });
            this.logger.debug('SEND %s: %j', this.id, msg);
            this.connection.send(msg);
        }
        return this;
    },
    
    onTimeout: function () {
        this.logger.verbose('TIMEOUT %s', this.connection.remoteAddress);
        this.connection.close();
    },
    
    onClose: function () {
        this._cancelTimer();
        this.logger.verbose('CLOSE %s %s', this.connection.remoteAddress, this.id);
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
        
        this.logger.debug('MSG %s: %j', this.id ? this.id : '', msg);
        
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
    implements: [process.EventEmitter]
});

module.exports = LinkConnection;