/** @fileoverview
 * This file provides the framework to build a neuron-like service
 * and constructs a neural network locally.
 * 
 * A neuron-like service behaves like a neuron which may connect
 * to one or more up-stream neuron-like services with axon branches
 * and accepts multiple connections from down-stream neuron-like services
 * with dendrites. With neuron-like structure, these services can build
 * up a neural network.
 */

var Class    = require('js-class'),
    elements = require('evo-elements'),    
    Config   = elements.Config,
    Logger   = elements.Logger,
    
    Synapse = require('./Synapse'),
    Message = require('./Message');

/** @class Neuron
 * @description The base class for a neuron-like service
 *
 * http://en.wikipedia.org/wiki/Neuron
 */
var Neuron = Class(process.EventEmitter, {
    
    /** @constructor
     * @param {String} name   The name of this neuron. This is used for
     *                        local endpoint (unix socket name: /path/neuron-<name>.sock)
     *                        and message routing when connected to SpinalCord.
     * @param {Config} cfg    The instance of evo-elements.Config. If not provided, the global Config
     *                        object is used. It is used to get configurations including:
     *                           - neuron.dendrite.sock: unix socket path pattern, "${name}" is subsitituted
     *                                                   default is /tmp/neuron-${name}.sock
     */
    constructor: function (name, cfg) {
        this.name = name;
        this.cfg = cfg || Config.conf();
        this._axon = new Axon(this);
        this._dendrites = {};
    },
    
    /** @property axon All axon branches states */
    get axon () {
        return this._axon.toObject();
    },

    /** @function
     * @description Enable Receptor for down-stream connections on this Neuron instance and start serving.
     *
     * @param {Function} readyFn   The optional callback when Receptor is ready.
     *                             It is same as later adding 'ready' event listener.
     */
    start: function (readyFn) {
        this._receptor = Synapse.listen('unix:' + this._sockPath(this.name))
            .on('connection', this.onConnection.bind(this))
            .on('ready', this._receptorReady.bind(this))
            .on('error', this._receptorError.bind(this))
            .on('close', this._receptorClose.bind(this));
        
        typeof(readyFn) == 'function' && this.on('ready', readyFn);
        
        return this;
    },
    
    /** @function
     * @description Add a up-stream connection (axon branch) to another Neuron instance.
     */
    connect: function (name, opts) {
        if (!this._axon[name]) {
            var connector = Synapse.connect('unix:' + this._sockPath(name), opts);
            this._axon.addBranch(name, connector, opts);
        }
        return this;
    },
    
    /** @function
     * @description Send a up-stream message.
     *
     * @param {Message} message   The message constructed by Message.
     */
    send: function (branchName, message, opts) {
        var options = this._sendOptions(message, opts);
        return this._axon.send(branchName, message.toObject(), options);
    },
    
    /** @function
     * @description Send a down-stream message to a single dendrite.
     *
     * @param {String} dendriteId   Id of the dendrite to which the message is sent.
     */
    unicast: function (dendriteId, message, opts) {
        var m = dendriteId.match(/^(.+)\.(\d+)$/);
        if (!m || m.length < 3) {
            throw new Error('Invalid Id: ' + dendriteId);
        }
        var options = this._sendOptions(message, opts);
        var name = m[1], index = parseInt(m[2]);
        var dendrite = this._dendrites[name] ? this._dendrites[name][index] : undefined;
        if (!dendrite) {
            return this._sendError('Not found dendrite: ' + dendriteId, options);
        }
        
        return dendrite.send(message.toObject(), options);
    },
    
    /** @function
     * @description Send a down-stream message to a single dendrite.
     *
     * @param {String} pattern   The pattern to filter dendrites. It can be one of
     *                              - Array of Ids: exact matching the Ids
     *                              - RegExp: match the Ids
     *                              - Function: filter Ids using function (id)
     */
    multicast: function (pattern, message, opts) {
        var options = this._sendOptions(message, opts), filter;
        delete options.strict;      // no errors should be thrown
        delete options.callback;    // callback not supported yet
        
        if (Array.isArray(pattern)) {
            var ids = pattern;
            filter = function (id) {
                return ids.indexOf(id) >= 0;
            };
        } else if (pattern instanceof RegExp) {
            filter = function (id) {
                return id.match(pattern);
            };
        } else if (typeof(pattern) == 'string') {
            pattern = new RegExp(pattern);
            filter = function (id) {
                return id.match(pattern);
            };
        } else if (typeof(pattern) == 'function') {
            filter = pattern;
        } else {
            throw new Error('Invalid pattern: ' + pattern);
        }
        
        for (var name in this._dendrites) {
            this._dendrites[name].forEach(function (dendrite) {
                if (filter(dendrite.id)) {
                    dendrite.send(message, options);
                }
            });
        }
        return this;
    },
    
    /** @function
     * @description Send a down-stream message to all dendrites
     */
    broadcast: function (message, opts) {
        var options = this._sendOptions(message, opts);
        delete options.strict;      // no errors should be thrown
        delete options.callback;    // callback not supported yet
        
        for (var name in this._dendrites) {
            this._dendrites[name].forEach(function (dendrite) {
                dendrite.send(message, options);
            });
        }
        return this;
    },
    
    onConnection: function (connection) {
        new Dendrite(connection, this);
    },
        
    _sockPath: function (name) {
        return this.cfg.query('neuron.dendrite.sock', '/tmp/neuron-${name}.sock')
                       .replace(/^(.*[^\\]|)\$\{name\}/, '$1' + name);
    },
    
    _sendOptions: function (message, opts) {
        if (!(message instanceof Message)) {
            throw new Error('Bad message');
        }
        var options = { data: message };
        switch (typeof(opts)) {
            case 'function':
                options.callback = opts;
                break;
            case 'object':
                _.extend(options, _.pick(opts, 'callback', 'timeout', 'strict'));
                break;
        }
        return options;
    },
    
    _sendError: function (errMessage, options) {
        var err = new Error(errMessage);
        if (options.strict) {
            throw err;
        }
        return err;
    },
    
    _receptorReady: function () {
        this.emit('ready');
    },
    
    _receptorError: function (err) {
        this.emit('error', err);
    },
    
    _receptorClose: function () {
        this.emit('close');
    },

    // Soma interface
    
    _axonMessage: function (msg, branch) {
        this.emit('message', Message.wrap(msg, 'up', branch.name));
    },
    
    _axonError: function (err, branch) {
        this.emit('error', err, 'up', branch.name);
    },
    
    _axonState: function (state, branch) {
        this.emit('state', state, branch.name);
    },
    
    _dendriteId: function (name, dendrite) {
        var dendrites = this._dendrites[name] || (this._dendrites[name] = []);
        dendrite.index = dendrites.push(dendrite) - 1;
        var id = name + '.' + dendrite.index;
        process.nextTick(function () {
            this.emit('connect', id);
        }.bind(this));
        return id;
    },
    
    _dendriteMessage: function (msg, dendrite) {
        this.emit('message', Message.wrap(msg, 'down', dendrite.id));
    },
    
    _dendriteError: function (err, dendrite) {
        if (dendrite.id) {
            this.emit('error', err, 'down', dendrite.id);
        }
    },
    
    _dendriteClose: function (dendrite) {
        if (dendrite.index) {
            delete this._dendrites[dendrite.name][dendrite.index];
            if (Object.keys(this._dendrites[dendrite.name]).length == 0) {
                delete this._dendrites[dendrite.name];
            }
            this.emit('disconnect', dendrite.id);
        }
    }
});

// Internal class - Axon implementation
var Axon = Class({
    constructor: function (soma) {
        this.soma = soma;
        this.branches = {};
    },
    
    addBranch: function (name, connector, opts) {
        this.branches[name] = new AxonBranch(name, connector, opts, this);
    },
    
    send: function (branchName, msg, opts) {
        var branch = this.branches[branchName];
        if (!branch) {
            return this.soma._sendError('Not found axon branch: ' + branchName, opts);
        }
        return branch.send(msg, opts);
    },
    
    toObject: function () {
        var obj = {};
        for (var name in this.branches) {
            obj[name] = this.branches[name].toObject();
        }
        return obj;
    },
    
    _branchMessage: function (msg, branch) {
        this.soma._axonMessage(msg, branch);
    },
    
    _branchError: function (err, branch) {
        this.soma._axonError(err, branch);
    },
    
    _branchState: function (state, branch) {
        this.soma._axonState(state, branch);
    }
});

// Internal class - a branch on Axon
var AxonBranch = Class({
    constructor: function (name, connector, opts, axon) {
        this.axon = axon;
        this.name = name;
        this.alias = opts && opts.alias ? opts.alias : name;
        this.state = 'connecting';
        this.connector = connector
            .on('message', this.onMessage.bind(this))
            .on('error', this.onError.bind(this))
            .on('connecting', this.onConnecting.bind(this))
            .on('ready', this.onReady.bind(this))
            .on('close', this.onClose.bind(this));
    },
    
    send: function (msg, opts) {
        return this.connector.send(msg, opts);
    },
    
    toObject: function () {
        return {
            id: this.id,
            name: this.name,
            alias: this.alias,
            state: this.state
        };
    },
    
    onMessage: function (msg) {
        if (msg.event == 'id') {
            this.id = msg.data.id;
        }
        this.axon._branchMessage(msg, this);
    },
    
    onError: function (err) {
        this.axon._branchError(err, this);
    },
    
    onConnecting: function () {
        this._setState('connecting');
    },
    
    onReady: function () {
        this._register();
        this._setState('connected');
    },
    
    onClose: function () {
        delete this.id;
        this._setState('disconnected');
    },
    
    _setState: function (state) {
        if (this.state != state) {
            this.state = state;
            this.axon._branchState(state, this);
        }
    },
    
    _register: function () {
        this.connector.send({ event: 'register', data: { name: this.alias } });
    }
});

// Internal class - a dendrite represents a connection
var Dendrite = Class({
    constructor: function (synapse, soma) {
        this.soma = soma;
        this.synapse = synapse
            .on('message', this.onMessage.bind(this))
            .on('error', this.onError.bind(this))
            .on('close', this.onClose.bind(this))
            .setTimeout(3000);  // the connection must request id by name first within timeout interval
    },
    
    send: function (msg, opts) {
        return this.synapse.send(msg, opts);
    },
    
    onMessage: function (msg) {
        if (this.id) {
            this.soma._dendriteMessage(msg, this);
        } else if (msg.event == 'register' && msg.data.name) {
            this.name = msg.data.name;
            this.id = this.soma._dendriteId(msg.data.name, this);
            this.synapse.setTimeout(null);
            this.synapse.send({ event: 'id', data: { id: this.id } });
        }
    },

    onError: function (err) {
        this.soma._dendriteError(msg, this);
    },
    
    onClose: function () {
        this.soma._dendriteClose(this);
    }
});

module.exports = Neuron;