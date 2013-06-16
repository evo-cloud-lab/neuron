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
    elements   = require('evo-elements'),
    BiMap      = elements.BiMap,
    DelayedJob = elements.DelayedJob;

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
     *         'adName1': content1,
     *         ...
     *     }
     * }
     */
    'cluster:ad.pub': function (msg, link) {
        if (msg.data && typeof(msg.data.contents) == 'object') {
            for (var ad in msg.data.contents) {
                var content = msg.data.contents[ad];
                this.ads.add(ad, link.id, content);
                this._addChange('pub', ad, link.id);
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
     *         'adName1': content1,
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
                        contents[ad][linkId] = all[linkId];
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

    _addChange: function (event, ad, linkId) {
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
                linkChange.content = this.ads.get(ad, linkId);
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
        this.contents = {}; // cached contents for local watchers
    },
        
    disconnect: function (conn) {
        var unwatches = [];
        ads = this.watchers.keys(conn.id, 'conn');
        this.watchers.removeAll(conn.id, 'conn');
        ads.forEach(function (ad) {
            if (!this.watchers.all(ad, 'ad')) {
                unwatches.push(ad);
                delete this.contents[ad];
            }
        }, this);
        if (unwatches.length > 0) {
            this.service.sendToMaster('ad.unwatch', { names: unwatches });
        }
        
        var repubs = [], unpubs = [];
        var ads = this.ads.keys(conn.id, 'conn');
        this.ads.removeAll(conn.id, 'conn');
        ads.forEach(function (ad) {
            if (this.ads.all(ad, 'ad')) {
                repubs.push(ad);
            } else {
                unpubs.push(ad);
            }
        }, this);
        this._resendPub(repubs);
        if (unpubs.length > 0) {
            this.service.sendToMaster('ad.unpub', { names: unpubs });
        }
    },
    
    stateChanged: function (state) {
        if (state.ready) {
            // clear content cache
            this.contents = {};
            // re-create watchers
            var ads = Object.keys(this.watchers.map('ad'));
            if (ads.length > 0) {
                this.service.sendToMaster('ad.watch', { names: ads });
            }
            // re-publish
            this._resendPub(Object.keys(this.ads.map('ad')));
        }
    },

    /* Data Format
     * {
     *     "update": {
     *         "adName1": {
     *             "linkId1": {
     *                 "event": "pub", "unpub" or "off"
     *                 "content": content // only available when "event" is "pub"
     *             }
     *         },
     *         ...
     *     }
     * }
     */
    'cluster:ad.update': function (msg) {
        this._watchUpdate(msg, 'update', function (ad, data) {
            for (var linkId in data) {
                var linkUpdate = data[linkId];
                switch (linkUpdate.event) {
                    case 'pub':
                        if (linkUpdate.content) {
                            if (!this.contents[ad]) {
                                this.contents[ad] = {};
                            }
                            this.contents[ad][linkId] = linkUpdate.content;
                        }
                        break;
                    case 'unpub':
                    case 'off':
                        if (this.contents[ad]) {
                            delete this.contents[ad][linkId];
                            if (Object.keys(this.contents[ad]).length == 0) {
                                delete this.contents[ad];
                            }
                        }
                        break;
                }
            }
        });
    },

    /* Data Format
     * {
     *     "contents": {
     *         "adName1": {
     *             "linkId1": content
     *         },
     *         ...
     *     }
     * }
     */    
    'cluster:ad.contents': function (msg) {
        this._watchUpdate(msg, 'contents', function (ad, data) {
            this.contents[ad] = data;
        });
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
        var contents = msg.data.contents || {};
        for (var ad in contents) {
            this.ads.add(ad, conn.id, contents[ad]);
        }
        this._resendPub(Object.keys(contents));
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]  
     * }
     */
    'client:ad.unpub': function (msg, conn) {
        this._removeConn(msg, conn, this.ads, 'unpub');
        var repubs = [];
        (Array.isArray(msg.data.names) ? msg.data.names : []).forEach(function (ad) {
            if (this.ads.all(ad, 'ad')) {
                repubs.push(ad);
            }
        }, this);
        this._resendPub(repubs);
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'client:ad.watch': function (msg, conn) {
        var contents = {};
        (Array.isArray(msg.data.names) ? msg.data.names : []).forEach(function (ad) {
            if (this.watchers.all(ad, 'ad')) {
                contents[ad] = this.contents[ad] || {};
            }
        }, this);
        this._addConn(msg, conn, this.watchers, 'watch');
        if (Object.keys(contents).length > 0) {
            this.service.send(conn.id, 'ad.contents', { contents: contents });
        }
    },
    
    /* Data Format
     * {
     *     "names": ['adName1', 'adName2', ...]
     * }
     */
    'client:ad.unwatch': function (msg, conn) {
        this._removeConn(msg, conn, this.watchers, 'unwatch');
    },
    
    _resendPub: function (ads) {
        var contents = {};
        ads.forEach(function (ad) {
            var all = this.ads.all(ad, 'ad');
            if (all) {
                contents[ad] = {};
                for (var connId in all) {
                    contents[ad][connId] = all[connId];
                }
            }
        }, this);
        if (Object.keys(contents).length > 0) {
            this.service.sendToMaster('ad.pub', { contents: contents });
        }
    },
    
    _watchUpdate: function (msg, event, cacheUpdate) {
        var conns = {}, unwatched = [], data = msg.data[event] || {};
        Object.keys(data).forEach(function (ad) {
            var all = this.watchers.all(ad, 'ad');
            if (all) {
                cacheUpdate.call(this, ad, data[ad]);
                for (var connId in all) {
                    if (!conns[connId]) {
                        conns[connId] = {};
                    }
                    conns[connId][ad] = data[ad];
                }
            } else {
                unwatched.push(ad);
            }
        }, this);
        if (unwatched.length > 0) {
            this.service.sendToMaster('ad.unwatch', { names: unwatched });
        }
        async.each(Object.keys(conns), function (connId) {
            var data = {};
            data[event] = conns[connId];
            this.service.send(connId, 'ad.' + event, data);
        }.bind(this));        
    },
    
    _addConn: function (msg, conn, bimap, event) {
        var names = Array.isArray(msg.data.names) ? msg.data.names : [], adds = [];
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
        var names = Array.isArray(msg.data.names) ? msg.data.names : [], removes = [];
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