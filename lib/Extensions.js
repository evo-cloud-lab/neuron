var async = require('async'),
    Class = require('evo-elements').Class;

var Extensions = Class({
    constructor: function (exts) {
        this.extensions = Array.isArray(exts) ? [].concat(exts) : [];
    },
    
    setup: function () {
        return this.invoke('setup');
    },
    
    cleanup: function () {
        return this.invoke('cleanup');
    },
    
    dispatch: function (src, msg, link) {
        return this.exts.invokeAsync(src + ':' + msg.event.toLowerCase(), [msg, link]);
    },
    
    invoke: function (method, args) {
        if (!args) {
            args = [];
        }
        return this.extensions.map(function (extension) {
            if (typeof(extension[method]) == 'function') {
                return extension[method].apply(extension, args);
            }
            return undefined;
        });
    },
    
    invokeAsync: function (method, args, collector) {
        if (typeof(args) == 'function') {
            collector = args;
            args = [];
        } else if (!args) {
            args = [];
        }
        async.map(this.extensions, function (extension, done) {
            if (typeof(extension[method]) == 'function') {
                done(null, extension[method].apply(extension, args));
            } else {
                done(null);
            }
        }, function (err, results) {
            if (typeof(collector) == 'function') {
                collector(err, results);
            }
        });
        return this;
    }
});

module.exports = Extensions;