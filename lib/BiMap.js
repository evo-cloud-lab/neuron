var _     = require('underscore'),
    Class = require('js-class');

function addMap(map, k, v, data, merge) {
    var values = map[k];
    if (!values) {
        values = map[k] = {};
    }
    var origData = values[v];
    if (origData == undefined || !merge) {
        values[v] = data == undefined ? {} : data;
    } else if (merge) {
        if (typeof(origData) == 'object' && typeof(data) == 'object') {
            _.extend(values[v], data);
        } else {
            throw new Error('data not mergable');
        }
    } else if (data != undefined) {
        values[v] = data;
    }
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

/** @class BiMap
 * @description Bi-direction Map
 *
 * A bi-direction map maps an association <k1, k2> to a value.
 * It is constructed with two maps, the first one maps KEY1 to
 * multiple KEY2 entries, with each KEY2 entry associated with
 * a value. On the contrary, the second one maps KEY2 to multiple
 * KEY1 entries, associated with the same value as KEY2 in KEY1 map.
 *
 * When removing a specific <k1, k2> association, entries are removed
 * from both maps. When removing all association with k1, all KEY2 keys
 * are removed from first map, and all <?, k1> are removed from the
 * second map.
 */
var BiMap = Class({
    
    /** @constructor
     *
     * @param {String} name1 the name of 1st key
     * @param {String} name2 the name of 2nd key
     */
    constructor: function (name1, name2) {
        this._maps = [{}, {}];
        this._names = [name1, name2];
    },
    
    /** @field */
    get maps () {
        return this._maps;
    },
    
    /** @field */
    get names () {
        return this._names;
    },
    
    /** @function
     * @description Add an association with value
     *
     * @param k1 KEY1 key
     * @param k2 KEY2 key
     * @param data optional, the associated value, {} if not specified
     * @param merge optional, present with data if data is merged instead of being replaced
     */
    add: function (k1, k2, data, merge) {
        addMap(this._maps[0], k1, k2, data, merge);
        addMap(this._maps[1], k2, k1, data, merge);
        return this;
    },

    /** @function
     * @description read the value with specified association
     *
     * @param k1 KEY1 key
     * @param k2 KEY2 key
     * @returns the associated value or undefined
     */
    get: function (k1, k2) {
        var map1 = this._maps[0][k1];
        return map1 ? map1[k2] : undefined;
    },

    /** @function
     * @description Remove an association
     *
     * @param k1 KEY1 key
     * @param k2 KEY2 key
     */
    remove: function (k1, k2) {
        removeMap(this._maps[0], k1, k2);
        removeMap(this._maps[1], k2, k1);
        return this;
    },
        
    /** @function
     * @description Remove a key
     *
     * By removing a key, all associations with this key are removed.
     *
     * @param k KEY1/KEY2 key, decided by at
     * @param {String} at name of the key @see BiMap#constructor
     */
    removeAll: function (k, at) {
        at = this._mapIndex(at);        // find which map to operate on
        var other = at == 1 ? 0 : 1;    // the other map
        var keys = this._maps[at][k];
        if (keys) {
            // remove k from the other map
            Object.keys(keys).forEach(function (key) {
                removeMap(this._maps[other], key, k);
            }, this);
            // finally remove k from the specified map
            delete this._maps[at][k];
        }
        return this;
    },
    
    /** @function
     * @description Retrieve all associations by key
     *
     * @param k KEY1/KEY2 key, decided by at
     * @param {String} at name of the key @see BiMap#constructor
     * @returns {Object} all associations
     */
    all: function (k, at) {
        return this._maps[this._mapIndex(at)][k];
    },
    
    /** @function
     * @description Retrieve keys in all associations by key
     *
     * It is a little different from @see BiMap#all, it returns an
     * empty array instead of undefined if k is not present.
     * 
     * @param k KEY1/KEY2 key, decided by at
     * @param {String} at name of the key @see BiMap#constructor
     * @returns {Array} keys in all associations
     */
    keys: function (k, at) {
        var all = this.all(k, at);
        return all ? Object.keys(all) : [];
    },
    
    /** @function
     * @description get the map by name
     *
     * @param at {String} name of the map
     * @returns {Object} the map identified by name.
     */
    map: function (at) {
        return this.maps[this._mapIndex(at)];
    },
    
    /** @private
     * @description translate name into map index
     * @throws {Error} when at is an invalid name
     */
    _mapIndex: function (name) {
        var index = this.names.indexOf(name);
        if (index < 0) {
            throw new Error('Invalid key name: ' + name);
        }
        return index;
    }
});

module.exports = BiMap;