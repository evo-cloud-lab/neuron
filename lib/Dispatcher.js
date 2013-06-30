/** @fileoverview
 * This is an internal module
 *
 * This module provides high-level named event dispatching support
 */

var Class = require('js-class');

var Dispatcher = Class({
    constructor: function () {
        this._events = {};
        this._regexps = [];
    },
    
    register: function (event, handler) {
        if (event instanceof RegExp) {
            this._regexps.push({ re: event, handler: handler });
        } else if (typeof(event) == 'string') {
            (this._events[event] || (this._events[event] = [])).push(handler);
        } else {
            throw new Error('Invalid event');
        }
        return this;
    },
    
    process: function (wrappedMsg, next, context) {
        var handlers = this._events[wrappedMsg.event] ? this._events[wrappedMsg.event].slice() : [];
        this._regexps.forEach(function (re) {
            if (wrappedMsg.event.match(re.re)) {
                handlers.push(re.handler);
            }
        });
        if (handlers.length > 0) {
            var curr = -1;
            var nextFn = function (msg) {
                msg || (msg = wrappedMsg);
                curr ++;
                if (curr < handlers.length) {
                    handlers[curr].call(context, msg, nextFn);
                } else {
                    next(msg);
                }
            };
            nextFn(wrappedMsg);
        } else {
            next();
        }
    }
});

module.exports = Dispatcher;