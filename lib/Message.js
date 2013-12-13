/** @fileoverview
 * This file provides the high-level functions for constructing
 * messages.
 */

exports.make = function (event, data) {
    return { event: event, data: data };
};

exports.ok = function (data) {
    return { event: 'ok', data: data || {} };
};

exports.err = function (err) {
    var data = { message: err.message };
    Object.keys(err).forEach(function (key) { data[key] = err[key]; });
    return { event: 'error', data: data };
};

exports.parseError = function (msg) {
    if (msg.event == 'error') {
        var err = new Error(msg.data.message);
        Object.keys(msg.data).forEach(function (key) {
            key != 'message' && (err[key] = msg.data[key]);
        });
        return err;
    }
    return null;
};

exports.error = exports.err;    // alias