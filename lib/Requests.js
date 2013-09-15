/** @fileoverview
 * This is an internal module
 *
 * This module provides Request/Response support
 */

var _     = require('underscore'),
    Class = require('js-class');

var Request = Class({
    constructor: function (id, branch, params) {
        this.id = id;
        this.branch = branch;
        this.callback = params.callback;    // save user callback
        this.params = { opts: params.opts, msg: _.clone(params.msg) };
        this.params.callback = this._sendCallback.bind(this);   // set send callback
        this.params.msg.id = id;
    },

    startTimer: function (requests) {
        if (this.params.opts.timeout >= 0) {
            this.requests = requests;
            this.timer = setTimeout(this.onTimeout.bind(this), this.params.opts.timeout);
        }
    },

    complete: function () {
        if (this.timer) {
            clearTimeout(this.timer);
            delete this.timer;
        }
        if (typeof(this.callback) == 'function') {
            var ret = this.callback.apply(null, arguments);
            if (ret === false) {    // explicitly specify to continue emitting 'message' event
                return false;
            }
        }
        return true;
    },

    onTimeout: function () {
        delete this.timer;
        if (this.requests) {
            this.requests.abandon(this, new Error('timeout'));
        }
    },

    _sendCallback: function (err) {
        err && this.requests.abandon(this, err);
    }
});

var Requests = Class({
    constructor: function () {
        this._reqId = 0;
        this._tracks = {};
    },

    newRequest: function (branch, params) {
        var id = ++ this._reqId;
        return new Request(id, branch, params);
    },

    track: function (req) {
        var reqs = (this._tracks[req.branch] || (this._tracks[req.branch] = {}));
        reqs[req.id] = req;
        req.startTimer(this);
    },

    filter: function (msg, branch) {
        if (msg.id != null) {
            var req = this._remove(branch, msg.id);
            return req && req.complete(null, msg);
        }
        return false;
    },

    abandon: function (req, err) {
        if (this._remove(req.branch, req.id)) {
            req.complete(err);
        }
    },

    _remove: function (branch, id) {
        var req = this._tracks[branch] && this._tracks[branch][id];
        if (req) {
            delete this._tracks[branch][id];
            if (Object.keys(this._tracks[branch]).length == 0) {
                delete this._tracks[branch];
            }
        }
        return req;
    }
});

module.exports = Requests;