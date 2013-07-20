/** @fileoverview
 * This file provides the high-level functions for constructing
 * messages.
 */

exports.make = function (event, data) {
    return { event: event, data: data };
};

exports.err = function (err) {
    var data = { message: err.message };
    Object.keys(err).forEach(function (key) { data[key] = err[key]; });
    return { event: 'error', data: data };
};

exports.error = err;    // alias