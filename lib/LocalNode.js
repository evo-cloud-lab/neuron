var Class = require('js-class'),
    
    Node         = require('./Node'),
    LinkProtocol = require('./LinkProtocol');

var LocalNode = Class(Node, {
    constructor: function (identity, connector) {
        Node.prototype.constructor.call(this, identity);
        this.connector = connector;
    },
    
    // route to connector
    send: function (event, data) {
        process.nextTick(function () {
            this.connector.onMessage({ event: event, data: data });
        }.bind(this));
        return this;
    }
});

module.exports = LocalNode;