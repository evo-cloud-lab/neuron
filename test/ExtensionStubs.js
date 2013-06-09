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

module.exports = {
    MasterContainer: MasterContainer,
    Link: Link
};