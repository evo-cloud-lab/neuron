var request    = require('request'),
    async      = require('async'),
    elements   = require('evo-elements'),
    Class      = elements.Class,
    States     = elements.States,
    DelayedJob = elements.DelayedJob,
    trace      = elements.Trace('neuron:conn'),

    Topology       = require('./Topology'),
    LinkConnection = require('./LinkConnection');

/** Connector State base class
 *
 */
var State = Class({
    constructor: function (name, connector) {
        this.name = name;
        this.connector = connector;
        this.topology = connector.topology;
        this.trace = elements.Trace('neuron:conn:' + name);
    }
});

/** Master State
 *
 * Run the node as master
 */
var MasterState = Class(State, {
    constructor: function (connector) {
        State.prototype.constructor.call(this, 'master', connector);
        this.syncJob = new DelayedJob(this._syncTopology.bind(this));
    },
    
    enter: function () {
        this.topology.becomeMaster();
        this.trace.info('Master mode started: %j', this.topology.localNode.toObject());
        return this;
    },
    
    // Handle node link connections
    linkRequest: function (request) {
        var link = LinkConnection.accept(request);
        if (link) {                
            link.on('connection', function (link) {
                this._addConnection(link);
            }.bind(this)).on('message', function (msg, link) {
                this._handleLinkMessage(msg, link);
            }.bind(this)).on('disconnect', function (link) {
                this._delConnection(link);
            }.bind(this));
        }
    },
    
    _addConnection: function (link) {
        this.trace.verbose('CONNECT %s, %s:%d', link.id, link.address, link.port);
        this.topology.add(link);
        this.syncJob.schedule();
    },
    
    _delConnection: function (link) {
        this.trace.verbose('DISCONNECT %s, %s:%d', link.id, link.address, link.port);
        this.topology.remove(link.id);
        link.removeAllListeners();
        this.syncJob.schedule();
    },
    
    _handleLinkMessage: function (msg, link) {
        this.trace.debug('MSG (%s): %j', link.id, msg);
        if (msg.event == 'state') {
            var fullTopology = this.topology.toObject();
            link.topologyRev = fullTopology.revision;
            link.send('topology.reload', fullTopology);
        }
    },
    
    _syncTopology: function () {
        var updates = this.topology.flushChanges();
        if (updates) {
            var fullTopology;
            this.trace.debug('SYNC %j', updates);
            async.each(Object.keys(this.topology.nodes), function (id, next) {
                if (id != this.topology.id) {
                    var link = this.topology.nodes[id];
                    if (link.topologyRev == updates.baseRevision) {
                        link.topologyRev = updates.revision;
                        link.send('topology.update', updates);
                    } else {
                        if (!fullTopology) {
                            fullTopology = this.topology.toObject();
                        }
                        link.topologyRev = fullTopology.revision;
                        link.send('topology.reload', fullTopology);
                    }
                }
            }.bind(this));
        }
    }
});

/** Connected State
 *
 * A non-master node joined the network successfully
 */
var ConnectedState = Class(State, {
    constructor: function (masterLink, connector) {
        State.prototype.constructor.call(this, 'connected', connector);
        this.masterLink = masterLink
            .on('message', this.onMessage.bind(this))
            .on('down', this.onLinkDown.bind(this));
    },
    
    enter: function () {
        this.trace.verbose('CONNECTED');
        this.masterLink.send('id', this.topology.localNode.toObject());
        return this;
    },
    
    onMessage: function (msg) {
        this.trace.debug('MSG %j', msg);
        switch (msg.event) {
            case 'topology.reload':
                try {
                    this.topology.reload(msg.data);
                } catch (e) {
                    // bad message, drop it
                }
                break;
            case 'topology.update':
                this._updateTopology(msg.data);
                break;
        }
    },
    
    onLinkDown: function () {
        this.trace.verbose('MASTER LINK DOWN');
        this.connector.from(this).transit(new ConnectState(this.connector));
    },
    
    _updateTopology: function (updates) {
        if (!updates.baseRevision || !updates.revision ||
            !Array.isArray(updates.changes)) {
            this.trace.warn('Invalid topology.update message: %j', updates);
            return;
        }
        if (updates.baseRevision != this.topology.revision) {
            this.trace.debug('Topology out-of-date: %d vs %d (base)', this.topology.revision, updates.baseRevision);
            // report state to request a full topology
            this.masterLink.send('state', { revision: this.topology.revision });
        } else {
            this.topology.update(updates.changes);
            // TODO if master becomes unavailable, reconnect?
            if (!this.topology.valid) {
                // TODO
                this.trace.error('MASTER GONE: updates: %j', updates);
            }
        }
    }
});

/** Connect State
 *
 * A node is trying to connect a master
 */
var ConnectState = Class(State, {
    constructor: function (connector) {
        State.prototype.constructor.call(this, 'connect', connector);
    },
    
    enter: function () {
        this.trace.verbose('CONNECT %s, %s:%d', this.topology.master.id, this.topology.master.address, this.topology.master.port);
        this.masterLink = this.topology.master.link()
            .on('up', function () {
                    this.masterLink.removeAllListeners().disableReconnect();
                    this.connector.from(this).transit(function () {
                        return new ConnectedState(this.masterLink, this.connector);
                    }.bind(this));
                }.bind(this))
            .on('timeout', function () {
                    this.trace.verbose('TIMEOUT');
                    this.masterLink.removeAllListeners();
                    this.connector.from(this).transit(function () {
                        if (this.connector.topology.electMaster().isMaster) {
                            return new MasterState(this.connector);
                        } else {
                            return new ConnectState(this.connector);
                        }
                    }.bind(this));
                }.bind(this))
            .connect();
        return this;
    }
});

/** Boot State
 *
 * A node contacts bootstrap nodes to find out master
 */
var BootState = Class(State, {
    constructor: function (connector) {
        State.prototype.constructor.call(this, 'boot', connector);
        this.bootstraps = connector.opts.bootstraps;
    },
    
    enter: function () {
        this.bootIndex = 0;
        if (!this.bootstraps || this.bootstraps.length == 0) {
            return new MasterState(this.connector);
        } else {
            this._connect();
        }
        return this;
    },
        
    _connect: function () {
        var bootstrap = this.bootstraps[this.bootIndex];
        this.trace.verbose('%s: CONNECT', bootstrap);
        request({
            url: bootstrap + '/topology',
            json: true,
            followAllRedirects: true
        }, this._handleResponse.bind(this));
    },

    _handleResponse: function (err, response, body) {
        var bootstrap = this.bootstraps[this.bootIndex];
        if (err) {
            this.trace.error('%s: ERROR: %s', bootstrap, err.message);
        } else if (response.statusCode >= 300) {
            this.trace.error('%s: FAIL %d: %j', bootstrap, response.statueCode, body);
        } else {
            this.trace.verbose('%s: JOINED: %j', bootstrap, body);
            try {
                this.connector.from(this).transit(function () {
                    this.connector.topology.reload(body);
                    return new ConnectState(this.connector);
                }.bind(this));
                return;
            } catch (e) {
                this.trace.error('%s: ERROR: %s', bootstrap, e.message);
            }
        }
        this.bootIndex ++;
        if (this.bootIndex >= this.bootstraps.length) {
            this.trace.error('No bootstrap available, run as master!');
            this.connector.from(this).transit(function () {
                return new MasterState(this.connector);
            }.bind(this));
        } else {
            this._connect();
        }
    }
});

module.exports = Class(States, {
    constructor: function (opts) {
        States.prototype.constructor.call(this);
        this.opts = opts;
    },
    
    get stateName() {
        return this.state ? this.state.name : null;
    },
   
    connect: function () {
        this.topology = new Topology({
            id: this.opts.address + ':' + this.opts.port,
            address: this.opts.address,
            port: this.opts.port            
        });        
        this.transit(new BootState(this));
        return this;
    },
    
    linkRequest: function (request) {
        var err;
        if (this.state.linkRequest) {
            try {
                this.state.linkRequest(request);
            } catch (e) {
                err = e;
            }
        } else {
            err = new Error('Not Supported');
            err.code = 400;
        }
        if (err) {
            request.reject(err.code, err.message);
        }
    }
}, {
    implements: [process.EventEmitter]
});