/** @fileoverview
 * This is an internal module
 * 
 * Dendrite represents a down-stream connection from a client
 */

var Class = require('js-class');

// Internal class - a dendrite represents a connection
var Dendrite = Class({
    constructor: function (synapse, soma) {
        this.soma = soma;
        this.synapse = synapse
            .on('message', this.onMessage.bind(this))
            .on('error', this.onError.bind(this))
            .on('close', this.onClose.bind(this))
            .setTimeout(soma.cfg.query('neuron.dendrite.timeout', 3000));  // the connection must request id by name first within timeout interval
    },
    
    send: function (params) {
        return this.synapse.send(params.msg, params.opts);  // callback is meaningless here
    },
    
    onMessage: function (msg) {
        if (this.id) {
            this.soma._dendriteMessage(msg, this);
        } else if (msg.event == 'register' && msg.data) {
            this.name = msg.data.name;
            if (this.name) {
                this.id = this.soma._dendriteId(msg.data.name, this);
                this.synapse.setTimeout(null);
                this.synapse.send({ event: 'id', data: { id: this.id } });
            } else {
                this.synapse.send({ event: 'error', data: { message: 'no name' } });
            }
        } else {
            this.synapse.send({ event: 'error', data: { message: 'unregistered' } });
        }
    },

    onError: function (err) {
        this.soma._dendriteError(err, this);
    },
    
    onClose: function () {
        this.soma._dendriteClose(this);
    }
});

module.exports = Dendrite;