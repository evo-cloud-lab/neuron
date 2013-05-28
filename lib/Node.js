var _        = require('underscore'),
    Class    = require('evo-elements').Class;

var NODE_ATTRS = ['id', 'address'];

var Node = Class({
    constructor: function (info) {
        if (info) {
            this.load(info);
        }
    },
    
    load: function (info) {
        if (!NODE_ATTRS.every(function (attr) { return !!info[attr]; })) {
            return false;
        }
        var port = parseInt(info.port);
        if (!isFinite(port) || port <= 0) {
            return false;
        }
        
        NODE_ATTRS.forEach(function (attr) {
            this[attr] = info[attr];
        }, this);
        this.port = port;
        
        return true;
    },
    
    get valid () {
        return !!this.id;
    },
    
    get linkUri () {
        return "ws://" + this.address + ":" + this.port;
    },
    
    get apiUri () {
        return "http://" + this.address + ":" + this.port;
    },
    
    toObject: function () {
        return _.pick(this, 'id', 'address', 'port');
    }
});

module.exports = Node;