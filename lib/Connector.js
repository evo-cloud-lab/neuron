var request    = require('request'),
    async      = require('async'),
    Class      = require('js-class'),
    elements   = require('evo-elements'),
    States     = elements.States,
    Trace      = elements.Trace,
    DelayedJob = elements.DelayedJob,

    Server         = require('./Server'),
    Topology       = require('./Topology'),
    NodeLink       = require('./NodeLink'),
    LinkConnection = require('./LinkConnection'),
    Extensions     = require('./Extensions'),
    MessengerExt   = require('./MessengerExt'),
    AdvertiseExt   = require('./AdvertiseExt');

/** Connector State base class
 *
 */
var State = Class({
    constructor: function (name, connector) {
        this.name = name;
        this.connector = connector;
        this.topology = connector.topology;
        this.trace = Trace('neuron:conn:' + name, '<' + this.topology.id + '> ');
    },
    
    updateState: function (ready) {
        this.connector.ready = ready;
        this.connector.emit('state', { name: this.name, ready: ready }, this);
        if (ready) {
            this.connector.emit('ready', this);
        }
        return this;
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
        this.exts = new Extensions([
            new MessengerExt.Master(this),
            new AdvertiseExt.Master(this)
        ]);
    },
    
    enter: function () {
        this.topology.becomeMaster();
        this.exts.setup();
        this.updateState(true);
        this.trace.info('Master mode started: %j', this.topology.localNode.toObject());
        return this;
    },
    
    leave: function () {
        this.exts.cleanup();
    },
    
    // Handle node link connections
    linkRequest: function (request) {
        var conn = Server.accept(request);
        if (conn) {
            new LinkConnection(conn.connection, conn.protocol, this)
                .on('connection', this.onConnection.bind(this))
                .on('message', this.onMessage.bind(this))
                .on('disconnect', this.onDisconnect.bind(this));
        }
    },
    
    // routing to self
    sendToMaster: function (event, data) {
        process.nextTick(function () {
            this.onMessage({ event: event, data: data }, this.topology.localNode);
        }.bind(this));
        return true;
    },
    
    onConnection: function (link) {
        this.trace.verbose('CONNECT %s, %s:%d', link.id, link.address, link.port);
        this.topology.add(link);
        this.syncJob.schedule();
        this.exts.invokeAsync('onConnect', [link]);
    },
    
    onDisconnect: function (link) {
        this.trace.verbose('DISCONNECT %s, %s:%d', link.id, link.address, link.port);
        this.exts.invokeAsync('onDisconnect', [link]);
        this.topology.remove(link.id);
        link.removeAllListeners();
        this.syncJob.schedule();
    },
    
    onMessage: function (msg, link) {
        this.trace.debug('MSG (%s): %j', link.id, msg);
        var method = '_message' + msg.event.toUpperCase();
        if (typeof(this[method]) == 'function') {
            this[method].call(this, msg, link);
        } else {
            this.exts.dispatch('cluster', msg, link);
        }
    },
    
    _messageSTATE: function (msg, link) {
        var fullTopology = this.topology.toObject();
        link.topologyRev = fullTopology.revision;
        link.send('topology.reload', fullTopology);
    },
    
    _syncTopology: function () {
        var updates = this.topology.flushChanges();
        this.trace.debug('SYNC %j', updates);
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
        this.updateState(true);        
        return this;
    },
    
    sendToMaster: function (event, data) {
        this.masterLink.send(event, data);
        return true;
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
            default:
                this.connector.onMessage(msg);
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
        this.updateState();
        this.trace.verbose('CONNECT %s, %s:%d', this.topology.master.id, this.topology.master.address, this.topology.master.port);
        this.masterLink = new NodeLink(this.topology.master, this)
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
        this.maxRetries = connector.opts.bootMaxRetries || 5;
        this.retryDelay = connector.opts.bootRetryDelay || 1000;
    },
    
    enter: function () {
        this.bootIndex = 0;
        this.retries = 0;
        if (!this.bootstraps || this.bootstraps.length == 0) {
            return new MasterState(this.connector);
        } else {
            this.updateState();
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
            this.trace.verbose('%s: BOOTED: %j', bootstrap, body);
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
        if (this.bootIndex < this.bootstraps.length) {
            this._connect();
        } else if (++ this.retries < this.maxRetries) {
            this.bootIndex = 0;
            setTimeout(this._connect.bind(this), this.retryDelay);
        } else {
            this.trace.error('No bootstrap available, run as master!');
            this.connector.from(this).transit(function () {
                return new MasterState(this.connector);
            }.bind(this));
        }
    }
});

var Connector = Class(States, {
    constructor: function (opts) {
        States.prototype.constructor.call(this);
        this.opts = opts;
        this.trace = Trace('neuron:conn', function () {
            return this.topology ? '<' + this.topology.id + '> ' : '';
        }.bind(this));
        this.server = new Server({
            routes: function (app) {
                    app.get('/topology', function (req, res) {
                        res.json(this.topology.toObject());
                    }.bind(this));
                
                    app.get('/state', function (req, res) {
                        res.json({ state: this.stateName, topologyVer: this.topology.V });
                    }.bind(this));            
                }.bind(this),
            accept: this.linkRequest.bind(this)
        }).on('close', this.onServerClose.bind(this));
    },
    
    get stateName() {
        return this.state ? this.state.name : null;
    },
   
    start: function (callback) {
        var port = this.opts.port;
        this.server.listen(port, function () {
            var address = this.server.httpServer.address();
            if (!port) {
                this.opts.port = port = address.port;
            }
            this.topology = new Topology({
                id: this.opts.id ? this.opts.id : (this.opts.address + ':' + this.opts.port),
                address: this.opts.address,
                port: this.opts.port            
            }, this);
            this.trace.info('Connector is listening on %s:%d', address.address, this.opts.port);            
            process.nextTick(function () {
                this.transit(new BootState(this));
            }.bind(this));
            if (typeof(callback) == 'function') {
                callback(this);
            }
        }.bind(this));        
        return this;
    },
    
    stop: function (callback) {
        this.server.close(callback);
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
    },
    
    sendToMaster: function (event, data) {
        if (this.state.sendToMaster) {
            return this.state.sendToMaster(event, data);
        }
        return false;
    },
    
    topologyUpdated: function () {
        this.emit('topology');
    },
    
    onMessage: function (msg) {
        this.emit('message', msg);
    },
    
    onServerClose: function () {
        this.transit(null);
        this.topology.clear();
    }
}, {
    implements: [process.EventEmitter]
});

module.exports = Connector;