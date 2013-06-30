var assert   = require('assert'),
    Class    = require('js-class'),
    
    Dendrite = require('../lib/Dendrite');

describe('Dendrite', function () {
    var StubSynapse = Class({
        constructor: function () {
            this.events = {};
            this.sends = [];
        },
        
        on: function (event, handler) {
            this.events[event] = handler;
            return this;
        },
        
        setTimeout: function (timeout) {
            this.timeout = timeout;
            return this;
        },
        
        send: function () {
            this.sends.push([].slice.call(arguments));
            return true;
        }
    });
    
    var synapse, dendrite;
    
    beforeEach(function () {
        synapse = new StubSynapse();
        dendrite = new Dendrite(synapse, { cfg: { query: function () { return 3000; } } });        
    });
    
    it('#constructor', function () {
        ['message', 'error', 'close'].forEach(function (event) {
            assert.ok(synapse.events[event]);
        });
        assert.equal(synapse.timeout, 3000);
    });
    
    it('#send', function () {
        dendrite.send({ msg: 1, opts: 2 });
        dendrite.send({ msg: { event: 'hello' }, opts: { timeout: 50 } });
        assert.deepEqual(synapse.sends, [
            [1, 2],
            [{ event: 'hello' }, { timeout: 50 }]
        ]);
    });
    
    describe('events', function () {
        var StubSynapse = Class(process.EventEmitter, {
            constructor: function () {
                this.sends = [];
            },
            
            setTimeout: function (timeout) {
                this.timeout = timeout;
                return this;
            },
            
            send: function () {
                this.sends.push([].slice.call(arguments));
                return true;
            }
        });

        var StubSoma = Class({
            constructor: function () {
                this.cfg = {
                    query: function () {
                        return 3000;
                    }
                };
            },
            
            _dendriteId: function (name, dendrite) {
                this.dendriteName = name;
                return 1;
            },
            
            _dendriteMessage: function (msg, dendrite) {
                this.msg = msg;
            },
            
            _dendriteError: function (err, dendrite) {
                this.error = err;
            },
            
            _dendriteClose: function (dendrite) {
                this.closed = true;
            }
        });
        
        var soma, synapse, dendrite;
        
        beforeEach(function () {
            soma = new StubSoma();
            synapse = new StubSynapse();
            dendrite = new Dendrite(synapse, soma);              
        });
        
        it('#error', function () {
            synapse.emit('error', new Error('something'));
            assert.ok(soma.error instanceof Error);
        });
        
        it('#close', function () {
            synapse.emit('close');
            assert.ok(soma.closed);
        });
        
        it('#message when unregistered', function () {
            synapse.emit('message', { event: 'something', data: {} });
            assert.deepEqual(synapse.sends[0][0], { event: 'error', data: { message: 'unregistered' } });
        });

        it('#message register without a name', function () {
            synapse.emit('message', { event: 'register', data: {} });
            assert.deepEqual(synapse.sends[0][0], { event: 'error', data: { message: 'no name' } });
        });

        it('#message register', function () {
            synapse.emit('message', { event: 'register', data: { name: 'dendrite_name' } });
            assert.equal(soma.dendriteName, 'dendrite_name');
            assert.strictEqual(synapse.timeout, null);
            assert.equal(dendrite.id, 1);
            assert.deepEqual(synapse.sends[0][0], { event: 'id', data: { id: 1 } });
        });

        it('#message registered', function () {
            dendrite.id = 1;
            var msg = { event: 'test', data: { key: 'val' } };
            synapse.emit('message', msg);
            assert.deepEqual(soma.msg, msg);
        });
    });
});