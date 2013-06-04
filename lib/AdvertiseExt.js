var _          = require('underscore'),
    async      = require('async'),
    Class      = require('js-class'),
    elements   = require('evo-elements'),
    DelayedJob = elements.DelayedJob,
        
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
    
    'cluster:ad.pub': function (msg, link) {
        if (msg.data && typeof(msg.data.ads) == 'object') {
            for (var ad in msg.data.ads) {
                this.ads.add(ad, link.id, msg.data.ads[ad]);
                this.changes[ad] = true;
            }
            this.notifyJob.schedule();
        }
    },
    
    'cluster:ad.unpub': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.ads)) {
            msg.data.ads.forEach(function (ad) {
                this.ads.remove(ad, link.id);
                this.changes[ad] = true;
            }, this);
            this.notifyJob.schedule();            
        }
    },
    
    'cluster:ad.watch': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.ads)) {
            msg.data.ads.forEach(function (ad) {
                this.watchers.add(ad, link.id);
            }, this);
        }
    },
    
    'cluster:ad.unwatch': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.ads)) {
            msg.data.ads.forEach(function (ad) {
                this.watchers.remove(ad, link.id);
            }, this);
        }        
    },

    _notify: function () {
        var events = {};
        for (var ad in this.changes) {
            var content = this.ads.map(ad, 'ad');
            content = { data: content ? _.clone(content) : null };
            this.watchers.vals(ad, 'ad').forEach(function (linkId) {
                var ads = events[linkId];
                if (!ads) {
                    ads = events[linkId] = {};
                }
                ads[ad] = content;
            }, this);
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
        this.ads.vals(linkId, 'link').forEach(function (ad) {
            this.changes[ad] = true;
        }, this);
        this.ads.removeAll(linkId, 'link');
        this.notifyJob.schedule();
    }
});

var AdvertiseMemberExt = Class({
    constructor: function (service) {
        this.service = service;
    },
    
    connection: function (conn) {
        
    },
    
    disconnect: function (conn) {
        
    },
    
    'cluster:ad.update': function (msg) {
        
    }
});

module.exports = {
    Master: AdvertiseMasterExt,
    Member: AdvertiseMemberExt
};