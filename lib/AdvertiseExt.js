/** @fileoverview
 *
 * Advertise extension is used to watch a collection of content under a single name.
 *
 * A content collection is a named simple list of content from multiple source. A watcher
 * can monitor any change in this list. A source can publish or update its content to
 * this unique name with its own identity, then all watchers can receive this change.
 */

var _          = require('underscore'),
    async      = require('async'),
    Class      = require('js-class'),
    DelayedJob = require('evo-elements').DelayedJob,
        
    BiMap = require('./BiMap');

var AdvertiseMasterExt = Class({
    constructor: function (masterState) {
        this.state = masterState;
        this.ads = new BiMap('ad', 'link');
        this.watchers = new BiMap('ad', 'link');
        this.changes = {};
        this.notifyJob = new DelayedJob(this._notify.bind(this));
    },
    
    onConnect: function (link) {
        this._clearLink(link.id);
    },
    
    onDisconnect: function (link) {
        this._clearLink(link.id);
    },
    
    /* Data Format
     * {
     *     "contents": {
     *         'adName1': {
     *             'srcId1': data1,
     *             'srcId2': data2,
     *             ...
     *         },
     *         ...
     *     }
     * }
     */
    'cluster:ad.pub': function (msg, link) {
        if (msg.data && typeof(msg.data.contents) == 'object') {
            for (var ad in msg.data.contents) {
                var content = msg.data.contents[ad];
                this.ads.add(ad, link.id, content);
                this._addChange('pub', ad, link.id, Object.keys(content));
            }
            this.notifyJob.schedule();
        }
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'cluster:ad.unpub': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.names)) {
            msg.data.names.forEach(function (ad) {
                this.ads.remove(ad, link.id);
                this._addChange('unpub', ad, link.id);
            }, this);
            this.notifyJob.schedule();            
        }
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     * the initial contents sent back is same as ad.pub
     * {
     *     "contents": {
     *         'adName1': {
     *             'srcId1': data1,
     *             'srcId2': data2,
     *             ...
     *         },
     *         ...
     *     }
     * }
     */
    'cluster:ad.watch': function (msg, link) {
        var contents = {};
        if (msg.data && Array.isArray(msg.data.names)) {
            msg.data.names.forEach(function (ad) {
                this.watchers.add(ad, link.id);
                var all = this.ads.all(ad, 'ad');
                if (all) {
                    contents[ad] = {};
                    for (var linkId in all) {
                        contents[ad][linkId] = _.clone(all[linkId]);
                    }
                }
            }, this);
        }
        link.send('ad.contents', { contents: contents });
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'cluster:ad.unwatch': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.names)) {
            msg.data.names.forEach(function (ad) {
                this.watchers.remove(ad, link.id);
            }, this);
        }        
    },

    _addChange: function (event, ad, linkId, srcIds) {
        var change = this.changes[ad];
        if (!change) {
            change = this.changes[ad] = {};
        }
        var linkChange = change[linkId];
        if (!linkChange) {
            linkChange = change[linkId] = {};
        }
        switch (event) {
            case 'pub':
                linkChange.event = event;
                if (Array.isArray(linkChange.sources)) {
                    linkChange.sources = linkChange.sources.concat(srcIds);
                } else {
                    linkChange.sources = srcIds;
                }
                break;
            case 'unpub':
                // discard all source ids
                change[linkId] = linkChange = { event: event };
                break;
            case 'off':
                // ignore if already gracefully unpubed, 
                if (linkChange.event != 'unpub') {
                    change[linkId] = linkChange = { event: event };
                }
                break;
        }
    },
    
    _notify: function () {
        var events = {};
        // assemble all watched changed by link
        for (var linkId in this.watchers.map('link')) {
            var data = {};
            this.watchers.keys(linkId, 'link').forEach(function (ad) {
                var change = this.changes[ad];
                if (change) {
                    data[ad] = {};
                    for (var id in change) {
                        data[ad][id] = _.clone(change[id]);
                        // load all source ids with actual content
                        var srcIds = change[id].sources;
                        if (Array.isArray(srcIds)) {
                            var contents = this.ads.get(ad, id) || {};
                            data[ad][id].sources = {};
                            srcIds.forEach(function (srcId) {
                                data[ad][id].sources[srcId] = contents[srcId];
                            });
                        }
                    }
                }
            }, this);
            if (Object.keys(data).length > 0) {
                events[linkId] = { update: data };
            }
        }
        this.changes = {};
        async.each(Object.keys(events), function (linkId) {
            var link = this.state.topology.nodes[linkId];
            if (link) {
                link.send('ad.update', events[linkId]);
            }
        }.bind(this));
    },
    
    _clearLink: function (linkId) {
        this.watchers.removeAll(linkId, 'link');
        this.ads.keys(linkId, 'link').forEach(function (ad) {
            this._addChange('off', ad, linkId);
        }, this);
        this.ads.removeAll(linkId, 'link');
        this.notifyJob.schedule();
    }
});

var AdvertiseMemberExt = Class({
    constructor: function (service) {
        this.service = service;
        this.ads = new BiMap('ad', 'conn');
        this.watchers = new BiMap('ad', 'conn');
    },
        
    disconnect: function (conn) {
        var contents = {}, unpubs = [];
        var ads = this.ads.keys(conn.id, 'conn');
        this.ads.removeAll(conn.id, 'conn');
        ads.forEach(function (ad) {
            if (this.ads.all(ad, 'ad')) {
                contents[ad] = {};
                contents[ad][conn.id] = null;
            } else {
                unpubs.push(ad);
            }
        }, this);
        if (Object.keys(contents).length > 0) {
            this.service.sendToMaster('ad.pub', { contents: contents });
        }
        if (unpubs.length > 0) {
            this.service.sendToMaster('ad.unpub', { names: unpubs });
        }
        
        var unwatches = [];
        ads = this.watchers.keys(conn.id, 'conn');
        this.watchers.removeAll(conn.id, 'conn');
        ads.forEach(function (ad) {
            if (!this.watchers.all(ad, 'ad')) {
                unwatches.push(ad);
            }
        }, this);
        if (unwatches.length > 0) {
            this.service.sendToMaster('ad.unwatch', { names: unwatches });
        }
    },
    
    stateChanged: function (state) {
        if (state.ready) {
            // re-create watchers
            var ads = Object.keys(this.watchers.map('ad'));
            if (ads.length > 0) {
                this.service.sendToMaster('ad.watch', { names: ads });
            }
            // re-publish
            var pubs = {}, admap = this.ads.map('ad');
            for (var ad in admap) {
                var all = this.ads.all(ad, 'ad');
                if (all) {
                    pubs[ad] = {};
                    for (var id in all) {
                        pubs[ad][id] = all[id];        
                    }
                }                
            }
            if (Object.keys(pubs).length > 0) {
                this.service.sendToMaster('ad.pub', { contents: pubs });
            }
        }
    },

    /* Data Format
     * {
     *     "update": {
     *         "adName1": {
     *             "linkId1": {
     *                 "event": "pub", "unpub" or "off"
     *                 "sources": {
     *                     "id1": data,
     *                     ...
     *                 } // only available when "event" is "pub"
     *             }
     *         },
     *         ...
     *     }
     * }
     */
    'cluster:ad.update': function (msg) {
        this._watchUpdate(msg, 'update');
    },

    /* Data Format
     * {
     *     "contents": {
     *         "adName1": {
     *             "linkId1": {
     *                 "sourceId1": data,
     *                 ...
     *             }
     *         },
     *         ...
     *     }
     * }
     */    
    'cluster:ad.contents': function (msg) {
        this._watchUpdate(msg, 'contents');
    },
    
    /* Data Format
     * {
     *     "contents": {
     *         "adName1": data1,
     *         ...
     *     }    
     * }
     */
    'client:ad.pub': function (msg, conn) {
        var contents = typeof(msg.contents) == 'object' ? msg.contents : {};
        var pubs = {};
        for (var ad in contents) {
            this.ads.add(ad, conn.id, contents[ad]);
            pubs[ad] = {};
            pubs[ad][conn.id] = contents[ad];
        }
        if (Object.keys(pubs).length > 0) {
            this.service.sendToMaster('ad.pub', { contents: pubs });
        }
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]  
     * }
     */
    'client:ad.unpub': function (msg, conn) {
        this._removeConn(msg, conn, this.ads, 'unpub');
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'client:ad.watch': function (msg, conn) {
        this._addConn(msg, conn, this.watchers, 'watch');
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'client:ad.unwatch': function (msg, conn) {
        this._removeConn(msg, conn, this.watchers, 'unwatch');
    },
    
    _watchUpdate: function (msg, event) {
        var conns = {}, data = msg[event];
        data && Object.keys(data).forEach(function (ad) {
            this.watchers.keys(ad, 'ad').forEach(function (connId) {
                if (!conns[connId]) {
                    conns[connId] = {};
                }
                conns[connId][ad] = data[ad];
            });
        }, this);
        async.each(Object.keys(conns), function (connId) {
            var data = {};
            data[event] = conns[connId];
            this.service.send(connId, 'ad.' + event, data);
        }.bind(this));        
    },
    
    _addConn: function (msg, conn, bimap, event) {
        var names = Array.isArray(msg.names) ? msg.names : [];
        var adds = [];
        names.forEach(function (ad) {
            if (!bimap.all(ad, 'ad')) {
                adds.push(ad);
            }
            bimap.add(ad, conn.id);
        });
        if (adds.length > 0) {
            this.service.sendToMaster('ad.' + event, { names: adds });
        }
    },
    
    _removeConn: function (msg, conn, bimap, event) {
        var names = Array.isArray(msg.names) ? msg.names : [];
        var removes = [];
        names.forEach(function (ad) {
            bimap.remove(ad, conn.id);
            if (!bimap.all(ad, 'ad')) {
                removes.push(ad);
            }
        }, this);
        if (removes.length > 0) {
            this.service.sendToMaster('ad.' + event, { names: removes });
        }        
    }
});

module.exports = {
    Master: AdvertiseMasterExt,
    Member: AdvertiseMemberExt
};