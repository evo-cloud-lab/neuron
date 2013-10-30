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

var _        = require('underscore'),
    Class    = require('js-class'),
    elements = require('evo-elements'),
    Config   = elements.Config,
    Logger   = elements.Logger,
    Schema   = elements.Schema,

    Synapse    = require('./Synapse'),
    Axon       = require('./Axon'),
    Dendrite   = require('./Dendrite'),
    Requests   = require('./Requests'),
    Dispatcher = require('./Dispatcher'),
    Message    = require('./Message');

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
     * @param opts   Optional options:
     *                  - config: the instance of evo-elements.Config. If not provided, the global Config
     *                            object is used. It is used to get configurations including:
     *                               - neuron.dendrite.sock: unix socket path pattern, "${name}" is subsitituted
     *                                                       default is /tmp/neuron-${name}.sock
     *                  - connects: Array of names to which axon branches will connect.
     */
    constructor: function (name, opts) {
        if (typeof(name) == 'string') {
            this.name = name;
        } else {
            opts = name;
        }
        this.cfg = opts && opts.config || Config.conf();
        this.name || (this.name = this.cfg.query('neuron.name', opts && opts.name));

        this._connects = opts && opts.connects;
        if (this._connects && !Array.isArray(this._connects)) {
            this._connects = [this._connects];
        }
        this._connectOpts = opts && opts.connectOpts;
        this._axon = new Axon(this);
        this._dendrites = {};
        this._requests = new Requests();
        this._dispatcher = new Dispatcher();
        this._subscriptions = {};
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
        if (this.name) {
            this._receptor = Synapse.listen('unix:' + this._sockPath(this.name))
                .on('connection', this.onConnection.bind(this))
                .on('error', this._receptorError.bind(this))
                .on('close', this._receptorClose.bind(this))
                .on('ready', function () {
                         typeof(readyFn) == 'function' && readyFn();
                    });
        }
        Array.isArray(this._connects) && this._connects.forEach(function (name) {
           this.connect(name, this._connectOpts);
        }, this);

        return this;
    },

    /** @function
     * @description Add a up-stream connection (axon branch) to another Neuron instance.
     */
    connect: function (name, opts) {
        if (!this._axon[name]) {
            var options = _.clone(this.cfg.query('neuron.synapse.connectOpts', {}));
            if (opts) {
                _.extend(options, opts);
            }

            var connector = Synapse.connect('unix:' + this._sockPath(name), options);
            this._axon.addBranch(name, connector, options);
        }
        return this;
    },

    /** @function
     * @description High-level request/response mechanism
     *
     * @param {Function} callback   Callback to receive response. It is function (err, msg).
     */
    request: function (branchName, msg, opts, callback) {
        var params = this._sendParams(msg, opts, callback);
        if (params.opts.timeout == undefined) {
            params.opts.timeout = this.cfg.query('neuron.request.timeout', -1);
        }
        var req = this._requests.newRequest(branchName, params);
        var ret = this._axon.send(branchName, req.params);
        if (typeof(ret) == 'boolean') {
            this._requests.track(req);
        }
        return ret;
    },

    /** @function
     * @description Send a response
     *
     * @param requestId   Id in request message ('id' field).
     */
    respond: function (msg, dendriteId, requestId) {
        var newMsg = _.clone(msg);
        newMsg.id = requestId;
        return this.cast(newMsg, { target: dendriteId });
    },

    /** @function
     * @description High-level dispatching mechanism
     *
     * @param event   Event (string or RegExp) subscribed;
     * @param {Function} handler   Handler registered for the specified event, defined as function (wrappedMsg, next)
     */
    dispatch: function (event, handler) {
        this._dispatcher.register(event, handler);
        return this;
    },

    /** @function
     * @description Subscribe messages from axon branches
     *
     * @param {String} event        Event subscribed;
     * @param {String} branchName   Name of branch to watch;
     * @param {Function} handler    Handler for handling the messages.
     */
    subscribe: function (event, branchName, handler) {
        var sub = this._subscriptions[event];
        sub || (sub = this._subscriptions[event] = { });
        var branch = sub[branchName];
        branch || (branch = sub[branchName] = []);
        branch.push(handler);
        return this;
    },

    /** @function
     * @description Send a up-stream message.
     *
     * @param {String} branchName   Name of branch to send up-stream message.
     * @param {Function} callback   Optional, to receive message send status, different from 'callback' of @request.
     */
    send: function (branchName, msg, opts, callback) {
        return this._axon.send(branchName, this._sendParams(msg, opts, callback));
    },

    /** @function
     * @description Send a down-stream message through one or multiple dendrites
     *
     * @param opts   Options. Field 'target' selects which dendrites will receive the message.
     *                  - string: id of the dendrite for unicast
     *                  - array of strings: ids of dendrites for multicast
     *                  - RegExp: regular expression to match ids of dendrites for multicast
     *                  - function: a function to filter dendrites by id
     *                  - <not present>: perform broadcast
     */
    cast: function (msg, opts) {
        var params = this._sendParams(msg, opts), dendrites = [];
        var target = params.opts.target;
        if (typeof(target) == 'string') {
            var m = target.match(/^(.+)\.(\d+)$/);
            if (m && m.length >= 3) {
                var name = m[1], index = parseInt(m[2]);
                var dendrite = this._dendrites[name] ? this._dendrites[name][index] : undefined;
                dendrite && dendrites.push(dendrite);
            }
        } else {
            var filter = function () { return true; };
            if (Array.isArray(target)) {
                filter = function (id) {
                    return target.indexOf(id) >= 0;
                }
            } else if (target instanceof RegExp) {
                filter = function (id) {
                    return id.match(target);
                }
            } else if (typeof(target) == 'function') {
                filter = target;
            }
            for (var name in this._dendrites) {
                this._dendrites[name].forEach(function (dendrite) {
                    if (filter(dendrite.id)) {
                        dendrites.push(dendrite);
                    }
                });
            }
        }

        dendrites.forEach(function (dendrite) {
            dendrite.send(params);
        });

        return this;
    },

    onConnection: function (connection) {
        new Dendrite(connection, this);
    },

    _sockPath: function (name) {
        return this.cfg.query('neuron.dendrite.sock', '/tmp/neuron-${name}.sock')
                       .replace(/^(.*[^\\]|)\$\{name\}/, '$1' + name);
    },

    _sendParams: function (msg, opts, callback) {
        // validate message format with required fields:
        //    - event: the name of message in string
        //    - data: the attached data, must be a hash (object)
        if (!msg || !msg.event || typeof(msg.data) != 'object') {
            throw new Error('Bad message');
        }
        var params = { msg: msg, opts: {} };
        switch (typeof(opts)) {
            case 'function':
                params.callback = opts;
                break;
            case 'object':
                _.extend(params.opts, opts);
                callback && (params.callback = callback);
                break;
        }
        return params;
    },

    _sendError: function (errMessage, options) {
        var err = new Error(errMessage);
        if (options.strict) {
            throw err;
        }
        return err;
    },

    _receptorError: function (err) {
        this.emit('error', err);
    },

    _receptorClose: function () {
        this.emit('close');
    },

    // Soma interface

    _axonMessage: function (msg, branch) {
        if (!this._requests.filter(msg, branch.name)) {
            var sub = this._subscriptions[msg.event];
            var handlers = sub && sub[branch.name];
            Array.isArray(handlers) && handlers.forEach(function (handler) {
                handler(msg, branch.name);
            });
            this.emit('message', msg, { src: 'a', id: branch.name });
        }
    },

    _axonError: function (err, branch) {
        this.emit('error', err, { src: 'a', id: branch.name });
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
        var wrappedMsg = Object.create({
            neuron: this,

            src: dendrite.id,
            event: msg.event,
            data: msg.data,
            raw: msg,

            respond: function (msg) {
                return msg instanceof Error ? this.fail(err)
                                            : this.neuron.respond(msg, this.src, this.raw.id);
            },

            ok: function (data) {
                return data instanceof Error ? this.fail(data)
                                             : this.neuron.respond(Message.ok(data), this.src, this.raw.id);
            },

            fail: function (err) {
                return this.neuron.respond(Message.error(err), this.src, this.raw.id);
            },

            accept: function (schema, opts, callback) {
                if (typeof(opts) == 'function') {
                    callback = opts;
                    opts = {};
                }
                var acceptedData = Schema.accept(schema, this.data, opts);
                if (acceptedData instanceof Error) {
                    this.respond(Message.error(acceptedData));
                } else {
                    return callback(acceptedData);
                }
                return undefined;
            }
        });
        wrappedMsg.done = function (err, data) {
            this.ok(err || data);
        }.bind(wrappedMsg);

        this._dispatcher.process(wrappedMsg, function () {
            this.emit('message', msg, { src: 'd', id: dendrite.id });
        }.bind(this), this);
    },

    _dendriteError: function (err, dendrite) {
        if (dendrite.id) {
            this.emit('error', err, { src: 'd', id: dendrite.id });
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

module.exports = Neuron;