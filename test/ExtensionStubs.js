var Class = require('js-class'),

    Extensions = require('../lib/Extensions');

/** @MasterContainer
 * @description A simulated master state in connector
 */
var MasterContainer = Class({
    constructor: function (extClasses) {
        this.idBase = 0;
        this.exts = new Extensions(extClasses.map(function (extClass) { return new extClass(this); }.bind(this)));
        this.topology = {
            nodes: { }
        };
    },
    
    addLink: function (link) {
        this.topology.nodes[link.id] = link;
        return this;
    },
    
    recvMessage: function (msg, linkId) {
        var link = this.topology.nodes[linkId];
        return this.exts.dispatch('cluster', msg, link);
    },
    
    connect: function (link) {
        this.addLink(link);
        this.exts.invokeAsync('onConnect', [link]);
        return this;
    },
    
    disconnect: function (linkId) {
        var link = this.topology.nodes[linkId];
        delete this.topology.nodes[linkId];
        this.exts.invokeAsync('onDisconnect', [link]);
        return this;
    }
});

/** @class Link
 * @description A looped master link simulator
 */
var Link = Class({
    constructor: function (masterContainer, id, messageHandler) {
        this.master = masterContainer;
        if (typeof(id) == 'function') {
            this.messageHandler = id;
        } else {
            this.id = id;
            this.messageHandler = messageHandler;
        }
        if (!this.id) {
            this.id = ++ masterContainer.idBase;
        }

        this.master.addLink(this);
    },
    
    /** @function
     * @description looped message to member
     *
     * It is invoked on master side, and the message should be received
     * on member side. Property 'messageHandler' is simulated to be
     * invoked on member side.
     */
    send: function (event, data) {
        if (this.messageHandler) {
            this.messageHandler({ event: event, data: data });
        }
    },
    
    /** @function
     * @description send message to master
     *
     * It simulates the member sending a message to master.
     */
    sendToMaster: function (event, data) {
        this.master.recvMessage({ event: event, data: data }, this.id);
        return this;
    },
    
    /** @function
     * @description simulate onConnect event
     */
    connect: function () {
        this.master.connect(this);
        return this;
    },
    
    /** @function
     * @description simulate onDisconnect event
     */
    disconnect: function () {
        this.master.disconnect(this.id);
        return this;
    }
});

/** @class Service
 * @description LocalService simulator
 */
var Service = Class({
    constructor: function (extClasses, connector) {
        this.exts = new Extensions(extClasses.map(function (extClass) { return new extClass(this); }.bind(this)));
        this.connector = connector;
        this.idBase = 0;
        this.connections = {};
    },
    
    addConnection: function (conn) {
        this.connections[conn.id] = conn;
        return this;
    },
    
    sendToMaster: function (event, data) {
        return this.connector ? this.connector.sendToMaster(event, data) : false;
    },
    
    send: function (connId, event, data) {
        var conn = this.connections[connId];
        if (conn) {
            conn.send({ event: event, data: data });
            return true;
        }
        return false;
    },
    
    broadcast: function (event, data) {
        var msg = { event: event, data: data };
        for (var connId in this.connections) {
            var conn = this.connections[connId];
            if (conn) {
                conn.send(msg);
            }
        }
    },
    
    multicast: function (connIds, event, data) {
        var msg = { event: event, data: data };
        connIds.forEach(function (connId) {
            var conn = this.connections[connId];
            if (conn) {
                conn.send(msg);
            }
        }, this);
    },
    
    onStateChanged: function (state) {
        this.exts.invokeAsync('stateChanged', [state]);
        this.broadcast('state', state);
    },
    
    onMessage: function (msg) {
        this.exts.dispatch('cluster', msg);
    },
    
    onLocalMessage: function (msg, conn) {
        this.exts.dispatch('client', msg, conn);
    }
});

/** @class Connection
 * @description Local connection simulator
 */
var Connection = Class({
    constructor: function (service, id, messageHandler) {
        this.service = service;
        if (typeof(id) == 'function') {
            this.messageHandler = id;
        } else {
            this.id = id;
            this.messageHandler = messageHandler;
        }
        if (!this.id) {
            this.id = ++ service.idBase;
        }

        this.service.addConnection(this);
    },
    
    send: function (msg) {
        if (this.messageHandler) {
            this.messageHandler(msg);
        }
    },
    
    sendLocalMessage: function (event, data) {
        this.service.onLocalMessage({ event: event, data: data }, this);
        return this;
    }
});

module.exports = {
    MasterContainer: MasterContainer,
    Link: Link,
    Service: Service,
    Connection: Connection
};