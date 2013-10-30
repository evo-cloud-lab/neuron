var Class    = require('js-class'),
    _        = require('underscore'),
    elements = require('evo-elements'),
    Config   = elements.Config,
    Logger   = elements.Logger,
    Neuron   = require('./Neuron');

var Program = Class({
    constructor: function (name, opts) {
        opts || (opts = {});
        this.name = name;
        var conf = Config.conf(_.extend({ reloadSignal: true }, opts.conf || {}));
        this.options = conf.opts[name] || {};
        this.logger = new Logger(name);
        (this.neuron = new Neuron(_.extend({ name: name }, opts.neuron || {})))
            .on('error', this.onError.bind(this))
            .on('state', this.onState.bind(this))
            .on('close', this.onClose.bind(this))
            .on('connect', this.onConnect.bind(this))
            .on('disconnect', this.onDisconnect.bind(this))
            .on('message', this.onMessage.bind(this));
        conf.on('reload', this._reload.bind(this));
    },

    /** @function
     * @description Simplified version of dispatching requests
     */
    dispatch: function (event, opts) {
        var prefix = (opts && opts.prefix) || 'neuron:';
        var self = this;
        this.neuron.dispatch(event, function (req) {
            var handler = self[prefix + event];
            if (handler) {
                if (opts && opts.schema) {
                    req.accept(opts.schema, function (data) {
                        handler.call(self, req, data);
                    });
                } else {
                    handler.call(self, req);
                }
            }
        });
        return this;
    },

    /** @function
     * @description Start the program
     */
    run: function () {
        this.neuron.start();
    },

    /** @function
     * @description Reload configurations
     *
     * Override this to perform the actual logic
     */
    reload: function (options) {
        this.options = options;
    },

    /** @function
     * @description Event when receptor/axon/dendrites error
     *
     * @param {Error} err       The error
     * @param {object} extra    Extra information
     *          - receptor: undefined
     *          - axon: { src: 'a', id: branchName }
     *          - dendrite: { src: 'd', id: dendriteId }
     */
    onError: function (err, extra) {
        // by default, the error should be raised
        throw err;
    },

    /** @function
     * @description Event when axon connectivity changes
     *
     * @param {String} state    Current connectivity
     *          - connecting    connecting a branch
     *          - connected     branch connected
     *          - disconnected  branch disconnected
     * @param {String} branch   Branch name
     */
    onState: function (state, branch) {
        // do nothing
    },

    /** @function
     * @description Event when receptor closed
     */
    onClose: function () {
        // do nothing
    },

    /** @function
     * @description Event when a dendrite is connected
     *
     * @param {String} id       Dendrite Id
     */
    onConnect: function (id) {
        // do nothing
    },

    /** @function
     * @description Event when a dendrite is disconnected
     *
     * @param {String} id       Dendrite Id
     */
    onDisconnect: function (id) {
        // do nothing
    },

    /** @function
     * @description Event when a message received
     *
     * @param {object} msg      Message
     * @param {object} info     Message source info
     *          - from Axon: { src: 'a', id: branchName }
     *          - from Dendrite: { src: 'd', id: dendriteId }
     */
    onMessage: function (msg, info) {
        // do nothing
    },

    _reload: function () {
        var options = Config.conf().opts[this.name];
        if (typeof(options) == 'object') {
            this.reload(options);
        }
    }
});

module.exports = Program;
