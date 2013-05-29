var _     = require('underscore'),
    async = require('async'),
    Class = require('js-class'),
    trace = require('evo-elements').Trace('neuron:pubsub'),

    BiMap = require('./BiMap');

var MessengerMasterExt = Class({
    constructor: function (masterState) {
        this.state = masterState;
        this.subs = new BiMap('topic', 'link');
    },
    
    onDisconnect: function (link) {
        this.subs.removeAll(link.id, 'link');
    },
    
    'cluster:msg.sub': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.topics)) {
            msg.data.topics.forEach(function (topic) {
                this.subs.add(topic, link.id);
            }, this);
        }
    },
    
    'cluster:msg.unsub': function (msg, link) {
        if (msg.data && Array.isArray(msg.data.topics)) {
            msg.data.topics.forEach(function (topic) {
                this.subs.remove(topic, link.id);
            }, this);
        }
    },
    
    'cluster:msg.pub': function (msg, link) {
        if (!msg.data || !msg.data.message) {
            return;
        }
        var topics = msg.data.topics;
        if (!Array.isArray(topics)) {
            topics = msg.data.topic ? [msg.data.topic] : undefined;
        }
        
        var links = {};
        if (topics) {
            topics.forEach(function (topic) {
                this.subs.vals(topic, 'topic').forEach(function (linkId) {
                    links[linkId] = this.state.topology.nodes[id];
                }, this);
            }, this);
        } else {    // broadcast
            links = this.state.topology.nodes;
        }
        
        async.each(Object.keys(links), function (id, next) {
            if (links[id] && id != link.id) {
                links[id].send('msg.message', msg.data);
            }
            next();
        });
    }
});

var MessengerMemberExt = Class({
    constructor: function (service) {
        this.service = service;
        this.subs = new BiMap('topic', 'conn');
    },
    
    disconnect: function (conn) {
        var topics = this.subs.vals(conn.id, 'conn');
        this.subs.removeAll(conn.id, 'conn');
        var removed = [];
        topics.forEach(function (topic) {
            if (!this.subs.map(topic, 'topic')) {
                removed.push(topic);
            }
        });
        if (removed.length > 0) {
            this.service.sendToMaster('msg.unsub', { topics: removed });
        }
    },
    
    stateChanged: function (state) {
        if (state.ready) {
            var topics = Object.keys(this.subs.dict('topic'));
            if (topics.length > 0) {
                this.service.sendToMaster('msg.sub', { topics: topics });
            }
        }
    },
    
    'cluster:msg.message': function (msg) {
        if (msg.data && Array.isArray(msg.data.topics)) {
            var conns = {}, unsubs = [];
            msg.data.topics.forEach(function (topic) {
                var ids = this.subs.vals(topic, 'topic');
                if (ids.length > 0) {
                    ids.forEach(function (connId) {
                        conns[connId] = true;
                    });
                } else {
                    unsubs.push(topic);
                }
            }, this);
            if (unsubs.length > 0) {
                this.service.sendToMaster('msg.unsub', { topics: unsubs });
            }
            this.service.multicast(Object.keys(conns), 'msg.message', msg.data);
        }
    },
    
    'client:msg.sub': function (msg, conn) {
        if (msg.data && Array.isArray(msg.data.topics)) {
            msg.data.topics.forEach(function (topic) {
                this.subs.add(topic, conn.id);
            }, this);
            this.service.sendToMaster('msg.sub', { topics: msg.data.topics });
        }
    },
    
    'client:msg.unsub': function (msg, conn) {
        if (msg.data && Array.isArray(msg.data.topics)) {
            var topics = [];            
            msg.data.topics.forEach(function (topic) {
                var exists = !!this.subs.map(topic, 'topic');
                this.subs.remove(topic, conn.id);
                if (exists && !this.subs.map(topic, 'topic')) {
                    topics.push(topic);
                }
            }, this);
            if (topics.length > 0) {
                this.service.sendToMaster('msg.unsub', { topics: topics });
            }
        }        
    },
    
    'client:msg.pub': function (msg, conn) {
        this.service.sendToMaster('msg.pub', msg.data);
    }
});

module.exports = {
    Master: MessengerMasterExt,
    Member: MessengerMemberExt
};