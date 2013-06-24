/** @fileoverview
 * This file provides the high-level functions for constructing
 * messages.
 */

exports.make = function (event, data) {
    return { event: event, data: data };
};