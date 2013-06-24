/** @fileoverview
 * This file provides the abstract transportation layer for all Neuron based
 * services. All communications are message-based.
 */

var net     = require('net'),
    url     = require('url'),
    msgpack = require('msgpack'),
    Class   = require('js-class');

/** @class
 * @description A Receptor is a listener just like a listening socket.
 */
var Receptor = Class(process.EventEmitter, {
    constructor: function (listener) {
        this.listener = listener;
        listener.on('connection', this.onConnection.bind(this))
                .on('listening', this.onListening.bind(this))
                .on('error', this.onError.bind(this))
                .on('close', this.onClose.bind(this));
    },
    
    onConnection: function (connection) {
        this.emit('connection', new Synapse(new StreamConnection(connection)));
    },
    
    onListening: function () {
        this.emit('ready');
    },
    
    onError: function (err) {
        this.emit('error', err);
    },
    
    onClose: function () {
        this.emit('close');
    }
});

var STREAM_HEAD_LEN = 4;

/** @class
 * @description A wrapper over raw stream connection for parsing the message buffers
 */
var StreamConnection = Class(process.EventEmitter, {
    /** @constructor
     * @param connection the low-level connection which emits events same as net.Socket
     */
    constructor: function (connection) {
        this.connection = connection;
        this._bufs = [];
        this._expectedLen = STREAM_HEAD_LEN;
        this._recvLen = 0;
        this._handler = this._handleStreamHead;
        
        connection
            .on('data', this.onData.bind(this))
            .on('connect', this.onConnect.bind(this))
            .on('end', this.onEnd.bind(this))
            .on('close', this.onClose.bind(this))
            .on('drain', this.onDrain.bind(this))
            .on('error', this.onError.bind(this))
            .on('timeout', this.onTimeout.bind(this));
    },
    
    close: function () {
        this.connection.end();
        this.connection.destroy();
    },
    
    send: function (data, callback) {
        var bufs = [new Buffer(4), data];
        bufs[0].writeUInt32BE(data.length, 0);
        return this.connection.write(Buffer.concat(bufs), callback);
    },
    
    // Stream implementation
    
    pause: function () {
        this.connection.pause();
    },
    
    resume: function () {
        this.connection.resume();
    },
    
    // Timeout support
    
    setTimeout: function (timeout) {
        this.connection.setTimeout(timeout || 0);
    },
    
    // Event handlers
    
    onData: function (data) {
        this._bufs.push(data);
        this._recvLen += data.length;
        while (this._recvLen >= this._expectedLen) {
            data = Buffer.concat(this._bufs);
            this._recvLen -= this._expectedLen;
            if (this._recvLen > 0) {
                this._bufs = [data.slice(this._expectedLen)];
            } else {
                this._bufs = [];
            }
            this._handler.call(this, data.slice(0, this._expectedLen));
        }
    },
    
    onConnect: function () {
        this.emit('connect');
    },
    
    onEnd: function () {
        this.emit('end');
    },
    
    onClose: function (hadError) {
        this.emit('close', hadError);
    },
    
    onDrain: function () {
        this.emit('drain');
    },
    
    onError: function (err) {
        this.emit('error', err);
    },
    
    onTimeout: function () {
        this.emit('timeout');
    },
    
    _handleStreamHead: function (data) {
        var dataLen = data.readUInt32BE(0) & 0x00ffffff;
        this._expectedLen = dataLen;
        this._handler = this._handleStreamData;
    },
    
    _handleStreamData: function (data) {
        this._expectedLen = STREAM_HEAD_LEN;
        this._handler = this._handleStreamHead;
        this.emit('message', data);
    }
});

/** @class
 * @description A Synapse is a connection between two Neuron instances for transmitting messages.
 */
var Synapse = Class(process.EventEmitter, {
    
    /** @constructor
     * @param transport   The transport layer which emits 'message' event. If not present, this instance is unattached.
     */
    constructor: function (transport) {
        this._sendQueue = [];
        this.attach(transport);
    },
    
    /** @function
     * @description Explicitly close the transport
     */
    disconnect: function () {
        this.transport && this.transport.close();
        // TODO not sure if 'close' event will be emitted
        // detach and emit 'close' if it is not emitted
        return this;
    },
    
    /** @function
     * @description Send message
     */
    send: function (message, opts, callback) {
        return this._send(this._pack(message, opts, callback));
    },
    
    // Stream implementation
    
    pause: function () {
        this.transport && this.transport.pause();
        return this;
    },
    
    resume: function () {
        this.transport && this.transport.resume();
        return this;
    },
    
    // Timeout support
    
    setTimeout: function (timeout) {
        if (timeout == null || timeout == undefined) {
            delete this._timeout;
            timeout = 0;
        } else {
            timeout = parseInt(timeout);
            if (isNaN(timeout)) {
                throw new Error('Invalid timeout: ' + timeout);
            }
            this._timeout = timeout;
        }
        this.transport && this.transport.setTimeout(timeout);
        return this;
    },
    
    // Internal transport re-attachment
    /** @private */
    attach: function (transport) {
        if (this.transport) {
            this.transport.removeAllListeners();
            this._clearSendQueue();
        }
        this.transport = transport;
        if (transport) {
            transport
                .on('message', this.onMessage.bind(this))
                .on('error', this.onError.bind(this))
                .on('close', this.onClose.bind(this))
                .on('drain', this.onDrain.bind(this))
                .on('timeout', this.onTimeout.bind(this))
                .setTimeout(this._timeout);
        }
    },
    
    // Event Handlers
    
    onMessage: function (msgBuf) {
        this.emit('message', Synapse.decodeMessage(msgBuf));
    },
    
    onError: function (err) {
        this.emit('error', err);
    },
    
    onClose: function (hadError) {
        this.emit('close', hadError);
        this.attach(null);
    },
    
    onDrain: function () {
        delete this._sendBusy;
        while (!this._sendBusy) {
            var queuedMsg = this._sendQueue.shift();
            if (!queuedMsg) {
                break;
            }
            if (this._send(queuedMsg) == undefined) {
                this._sendQueue.unshift(queuedMsg);
                break;
            }
        }
    },
    
    onTimeout: function () {
        this.disconnect();
    },
    
    _pack: function (message, opts, callback) {
        if (typeof(opts) == 'function') {
            callback = opts;
            opts = undefined;
        }
        var msg = { message: message };
        if (typeof(callback) == 'function') {
            msg.callback = function (err) { callback(err, message, opts); };
        }
        return msg;
    },
    
    _send: function (msg) {
        if (this.transport) {
            if (this._sendBusy) {
                this._sendQueue.push(msg);
                return false;
            } else {
                msg.encoded || (msg.encoded = Synapse.encodeMessage(msg.message));
                var result = this.transport.send(msg.encoded, msg.callback);
                result || (this._sendBusy = true);
                return result;
            }
        }
        return undefined;   // unable to send message        
    },
    
    _clearSendQueue: function () {
        var abandoned = this._sendQueue;
        delete this._sendBusy;
        this._sendQueue = [];
        this._abandonMsgs(abandoned);
    },
    
    _abandonMsgs: function (msgs) {
        if (msgs.length > 0) {
            process.nextTick(function () {
                var err = new Error('abandon');
                msgs.forEach(function (msg) {
                    if (msg.callback) {
                        msg.callback(err);
                    }
                });
            });
        }
    }
}, {
    statics: {
        /** @static
         * @description Encode message into Buffer
         */
        encodeMessage: function (msgObj) {
            return msgpack.pack(msgObj);
        },
        
        /** @static
         * @description Decode message from Buffer
         */
        decodeMessage: function (msgBuf) {
            return msgpack.unpack(msgBuf);
        },
        
        /** @static
         * @description Connect to the specified endpoint
         *
         * @param opts   Optional options @see Connector#constructor
         */
        connect: function (destinationUri, opts) {
            return new Connector(destinationUri, opts);
        },
        
        /** @static
         * @description Create a listening endpoint which accepts connections
         */
        listen: function (listenUri) {
            var uri = url.parse(listenUri);
            var server = net.createServer();
            switch (uri.protocol) {
                case 'unix:':
                    server.listen(uri.path);
                    break;
                case 'tcp:': {
                        var args = [parseInt(uri.port)];
                        if (isNaN(args[0])) {
                            args[0] = 0;
                        }
                        if (uri.hostname != '*' && uri.hostname.length > 0) {
                            args.push(uri.hostname);
                        }
                        server.listen.apply(server, args);
                    }
                    break;
                default:
                    throw new Error('Invalid listening URI: ' + listenUri);
            }
            return new Receptor(server);
        }
    }
});

/** @class
 * @description A Connector is a sub-class of Synapse which initiates the communication.
 *
 * Connector extends Synapse by adding events:
 *    - connecting: starts connecting
 *    - ready: connected
 * and reconnecting mechanism.
 */
var Connector = Class(Synapse, {

    /** @constructor
     * @param connectUri  The target Uri to connect to
     * @param opts   Optional options, see below.
     */
    constructor: function (connectUri, opts) {
        Synapse.prototype.constructor.call(this);
        // default options
        this.opts = {
            sendQueueMax: 1024,     // maximum message queued before connnected
            reconnectDelay: 500,    // delay interval before next reconnect
            reconnect: true         // set this to false to reconnect manually
        };
        connectUri && this.connect(connectUri, opts);
    },
    
    /** @function
     * @description Connect to a dendrite of a Neuron instance
     *
     * @param {String} connectUri   Uri to connect, can be "unix:/path" or "tcp://host:port"
     * @param opts   Optional options. @see Connector#constructor
     *
     * @throws  "Communication already initiated" if connecting or connected.
     */
    connect: function (connectUri, opts) {
        if (this.transport) {
            throw new Error('Communication already initiated');
        }

        this._parseConnectUri(connectUri, opts);

        if (this._delayTimer) {
            clearTimeout(this._delayTimer);
            delete this._delayTimer;
        }

        delete this._disconnected;  // clear flag to use opts.reconnect only
        delete this._connected;     // clear connected flag
        
        if (this._uri) {
            process.nextTick(function () {
                this.emit('connecting');
            }.bind(this));
            this.attach(new StreamConnection(net.connect.apply(net, this._connectArgs)));
        }

        return this;
    },
    
    // override
    // if disconnect explicitly, reconnect is not performed
    disconnect: function () {
        this._disconnected = true;
        Synapse.prototype.disconnect.call(this);
        return this;
    },
    
    // override
    /** @function
     * @description Send message with re-send support
     *
     * @param opts   Optional options:
     *                  - timeout   Timeout interval before discarding the message if not sent,
     *                              -1 for being never discarded.
     */
    send: function (message, opts, callback) {
        var msg = this._pack(message, opts, callback), enqueue = true;
        if (opts) {
            if (opts.timeout > 0) {
                msg.expireAt = Date.now() + opts.timeout;
            } else if (opts.timeout != -1) {
                enqueue = false;
            }
        }
        if (!this._connected || this._sendBusy) {
            return this._enqueueMsg(msg);
        }
        var result = this._send(msg);
        if (result == undefined && enqueue) {  // sending failure and needs re-send
            return this._enqueueMsg(msg);
        }
        return result;
    },
    
    // override
    attach: function (transport) {
        Synapse.prototype.attach.call(this, transport);
        transport && transport.on('connect', this.onConnect.bind(this));
    },
    
    onConnect: function () {
        this._connected = true;
        this.onDrain(); // re-send queued messages
        this.emit('ready');
    },
    
    onClose: function (hadError) {
        delete this._connected;
        Synapse.prototype.onClose.call(this, hadError);
        if (!this._disconnected && this.opts.reconnect) {
            this._delayTimer = setTimeout(this._reconnect.bind(this), this.opts.reconnectDelay);
        }
    },
    
    _reconnect: function () {
        this.connect();
    },
    
    _parseConnectUri: function (connectUri, opts) {
        if (connectUri) {
            var uri = url.parse(connectUri, true), args = [];
            switch (uri.protocol) {
                case 'unix:':
                    args.push(uri.path);
                    break;
                case 'tcp:': {
                        args.push(parseInt(uri.port));
                        if (isNaN(args[0])) {
                            args[0] = 0;
                        }
                        if (uri.hostname.length > 0) {
                            args.push(uri.hostname);
                        }
                    }
                    break;
                default:
                    throw new Error('Invalid destination URI: ' + connectUri);
            }
            this._uri = uri;
            this._connectArgs = args;
            
            // parse opts
            if (opts) {
                var delay = parseInt(opts.reconnectDelay);
                if (!isNaN(delay)) {
                    this.opts.reconnectDelay = delay;
                }
                if (opts.reconnect != undefined) {
                    this.opts.reconnect = !!opts.reconnect;
                }
            }
        }
    },
    
    _enqueueMsg: function (msg) {
        // try to queue message
        //    opts.sendQueueMax ! > 0 means queue is disabled
        //    opts.sendQueueMax == -1 means there's no limit on queue size (not recommended)
        if (this.opts.sendQueueMax > 0 || this.opts.sendQueueMax == -1) {
            // if queue is full, clear all timed-out messages to make possible rooms.
            var expires = [];
            if (this.opts.sendQueueMax > 0 && this._sendQueue.length >= this.opts.sendQueueMax) {
                var now = Date.now();
                this._sendQueue = this._sendQueue.filter(function (msg) {
                    if (msg.expireAt && msg.expireAt <= now) {
                        expires.push(msg);
                        return false;
                    }
                    return true;
                });
            }
            this._abandonMsgs(expires);
            // check again if possible rooms are available
            if (this.opts.sendQueueMax == -1 || this._sendQueue.length < this.opts.sendQueueMax) {
                this._sendQueue.push(msg);
                return false;
            }
        }
        return undefined;   // message not enqueued, unable to send
    },
    
    // override
    // discard expired message
    _send: function (msg) {
        if (msg.expireAt <= Date.now()) {
            this._abandonMsgs([msg]);
            return true;
        }
        return Synapse.prototype._send.call(this, msg);
    },
    
    // override
    // all queued messages should be kept for reconnect
    _clearSendQueue: function () {
        delete this._sendBusy;
    }
});

module.exports = Synapse;