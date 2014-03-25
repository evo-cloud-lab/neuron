/** @fileoverview
 * This is an internal module
 *
 * Axon is a collection of all up-stream connection (aka branch)
 */

var Class = require('js-class');

// Internal class - Axon implementation
var Axon = Class({
    constructor: function (soma) {
        this.soma = soma;
        this.branches = {};
    },

    addBranch: function (name, connector, opts) {
        this.branches[name] = new AxonBranch(name, connector, opts, this);
    },

    delBranch: function (name) {
        var branch = this.branches[name];
        delete this.branches[name];
        branch && branch.disconnect();
    },

    send: function (branchName, params) {
        var branch = this.branches[branchName];
        if (!branch) {
            return this.soma._sendError('Not found axon branch: ' + branchName, params.opts);
        }
        return branch.send(params);
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
        (this.connector = connector)
            .on('message', this.onMessage.bind(this))
            .on('error', this.onError.bind(this))
            .on('connecting', this.onConnecting.bind(this))
            .on('ready', this.onReady.bind(this))
            .on('close', this.onClose.bind(this));
    },

    disconnect: function () {
        delete this.axon;
        this.connector.disconnect();
    },

    send: function (params) {
        return this.connector.send(params.msg, params.opts, params.callback);
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
        if (msg.event == 'id' && msg.data) {
            this.id = msg.data.id;
        }
        this.axon && this.axon._branchMessage(msg, this);
    },

    onError: function (err) {
        this.axon && this.axon._branchError(err, this);
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
            this.axon && this.axon._branchState(state, this);
        }
    },

    _register: function () {
        this.connector.send({ event: 'register', data: { name: this.alias } });
    }
});

module.exports = Axon;