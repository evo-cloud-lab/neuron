/** @fileoverview
 * This file provides the high-level Message class for constructing
 * messages. All messages passed to high-level send functions must be
 * instance of Message.
 */

var _     = require('underscore'),
    Class = require('js-class');

/** @class
 * @description Base message class
 */
var Message = Class({
    constructor: function (event, data) {
        this.event = event;
        this.data = data || {};
        this.headers = {};
    },
    
    toObject: function () {
        return _.extend(_.clone(this.headers), {
            event: this.event,
            data: this.data
        });
    }
}, {
    statics: {
        /** @static
         * @description Build a new message instance
         */
        make: function (event, data) {
            return new Message(event, data);
        },
        
        /** @static
         * @description Wraps a received message in plain object
         *
         * @param {String} source   The source where message is received:
         *                             - 'up': from one of up-stream axon branches,
         *                                     sourceId is branch name
         *                             - 'down': from one of down-stream dendrites,
         *                                        sourceId is dendrite Id.
         */
        wrap: function (msg, source, srcId) {
            var message = new Message(msg.event, msg.data);
            message.source = source;
            message.sourceId = srcId;
            return message;
        }
    }
});

module.exports = Message;