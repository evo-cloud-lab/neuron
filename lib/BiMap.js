var Class = require('js-class');

function addMap(map, k, v, data) {
    var values = map[k];
    if (!values) {
        values = map[k] = {};
    }
    values[v] = data == undefined ? true : data;
}

function removeMap(map, k, v) {
    var values = map[k];
    if (values) {
        delete values[v];
        if (Object.keys(values).length == 0) {
            delete map[k];
        }
    }
}

var BiMap = Class({
    constructor: function (name1, name2) {
        this.maps = [{}, {}];
        this.names = [name1, name2];
    },
    
    add: function (k1, k2, data) {
        addMap(this.maps[0], k1, k2, data);
        addMap(this.maps[1], k2, k1, data);
    },
    
    remove: function (k1, k2) {
        removeMap(this.maps[0], k1, k2);
        removeMap(this.maps[1], k2, k1);
    },
    
    removeAll: function (k, at) {
        at = this.names.indexOf(at);
        var other = at == 1 ? 0 : 1;
        var keys = this.maps[at][k];
        if (keys) {
            Object.keys(keys).forEach(function (key) {
                removeMap(this.maps[other], key, k);
            });
            delete this.maps[at][k];
        }
    },
    
    map: function (k, at) {
        at = this.names.indexOf(at);
        return this.maps[at][k];
    },
    
    vals: function (k, at) {
        var map = this.map(k, at);
        return map ? Object.keys(map) : [];
    },
    
    dict: function (at) {
        at = this.names.indexOf(at);
        return this.maps[at];
    }
});

module.exports = BiMap;