var _     = require('underscore'),
    Class = require('js-class'),
    
    Node      = require('./Node'),
    LocalNode = require('./LocalNode');

var TOPOLOGY_VER = 'nt0';

var Topology = Class({
    constructor: function (identity, connector) {
        Object.defineProperty(this, 'V', { value: TOPOLOGY_VER, configurable: false, writable: false });
        this.connector = connector;
        this.localNode = new LocalNode(identity, connector);
        this.clear();
    },
    
    get id () {
        return this.localNode.id;
    },
    
    get valid () {
        return !!this.masterId;
    },
    
    get master () {
        return this.valid ? this.nodes[this.masterId] : null;
    },
    
    get isMaster () {
        return this.masterId == this.localNode.id;
    },
    
    get isChanged () {
        return Object.keys(this.changes).length > 0;
    },
    
    clear: function (notify) {
        this.nodes = {};
        this.nodes[this.localNode.id] = this.localNode;
        delete this.masterId;
        this.revision = 0;
        this.changes = {};
        
        if (notify) {
            this._updated();
        }
    },
    
    add: function (node) {
        var change = { node: node.toObject() };
        if (this.nodes[node.id]) {
            change.type = 'update';
            change.origin = this.nodes[node.id].toObject();
        } else {
            change.type = 'insert';
        }
        this.nodes[node.id] = node;
        this.changes[node.id] = change;
        
        this._updated();
        
        return this;
    },
    
    remove: function (nodeId) {
        if (this.nodes[nodeId]) {
            this.changes[nodeId] = { type: 'delete', nodeId: nodeId };
            delete this.nodes[nodeId];
            this._updated();
        }
        return this;
    },
    
    flushChanges: function () {
        var changes = Object.keys(this.changes).map(function (id) { return this.changes[id]; }.bind(this));
        this.changes = {};
        if (changes.length > 0) {
            var baseRev = this.revision;
            this.revision ++;
            return {
                baseRevision: baseRev,
                revision: this.revision,
                changes: changes
            };
        }
        return null;
    },
    
    reload: function (topology) {
        if (topology.v !== this.V ||
            !Array.isArray(topology.nodes) ||
            !isFinite(parseInt(topology.revision))) {
            throw new Error('Bad topology');
        }

        if (!topology.master) {
            throw new Error('No master');
        }
        
        var nodes = {};
        topology.nodes.forEach(function (node) {
            nodes[node.id] = new Node(node);
        });
        
        if (!nodes[topology.master]) {
            throw new Error('Invalid master id');
        }
        
        nodes[this.localNode.id] = this.localNode;
        
        this.nodes = nodes;
        this.masterId = topology.master;
        this.revision = topology.revision;
        
        this._updated();
        
        return this;
    },
    
    update: function (changes) {
        var changed = false;
        changes.forEach(function (change) {
            switch (change.type) {
                case 'insert':
                case 'update':
                    if (change.node && change.node.id != this.localNode.id) {
                        this.nodes[change.node.id] = new Node(change.node);
                        changed = true;
                    }
                    break;
                case 'delete':
                    if (change.nodeId != this.localNode.id) {
                        if (this.masterId == change.nodeId) {
                            delete this.masterId;
                        }
                        delete this.nodes[change.nodeId];
                        changed = true;
                    }
                    break;
            }
        }, this);
        
        if (changed) {
            this._updated();
        }
        return this;
    },
    
    becomeMaster: function () {
        this.clear();
        this.masterId = this.localNode.id;
        this._updated();
        return this;
    },
    
    electMaster: function () {
        // remove master
        if (!this.isMaster) {
            delete this.nodes[this.masterId];
        }
        // elect a new master
        this.masterId = Object.keys(this.nodes).sort()[0];
        this._updated();
        return this;
    },
    
    toObject: function () {
        return {
            v: this.V,
            id: this.localNode.id,
            master: this.masterId,
            nodes: Object.keys(this.nodes).map(function (id) { return this.nodes[id].toObject(); }.bind(this)),
            revision: this.revision
        };
    },
    
    _updated: function () {
        this.connector.topologyUpdated();
    }
}, {
    statics: {
        V: TOPOLOGY_VER
    }
});

module.exports = Topology;