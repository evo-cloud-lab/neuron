var assert   = require('assert'),
    Class    = require('js-class'),
    
    Axon = require('../lib/Axon');

describe('Axon', function () {
    var StubConnector = Class({
        constructor: function () {
            this.events = {};
            this.sends = [];
        },
        
        on: function (event, handler) {
            this.events[event] = handler;
            return this;
        },
        
        send: function () {
            this.sends.push([].slice.call(arguments));
            return true;
        }
    });
    
    var connector, axon;
    
    beforeEach(function () {
        connector = new StubConnector();
        axon = new Axon({});
    });
    
    it('#addBranch', function () {
        axon.addBranch('test', connector);
        ['message', 'error', 'connecting', 'ready', 'close'].forEach(function (event) {
            assert.ok(connector.events[event]);
        });
        var branch = axon.branches['test'];
        assert.ok(branch);
        assert.equal(branch.name, 'test');
        assert.equal(branch.alias, 'test');
        assert.equal(branch.state, 'connecting');
    });
    
    it('#addBranch with alias', function () {
        axon.addBranch('test', connector, { alias: 'abc' });
        var branch = axon.branches['test'];
        assert.ok(branch);
        assert.equal(branch.name, 'test');
        assert.equal(branch.alias, 'abc');        
    });
    
    it('#toObject', function () {
        axon.addBranch('test', connector, { alias: 'abc' });
        assert.deepEqual(axon.toObject(), {
            test: {
                id: undefined,
                name: 'test',
                alias: 'abc',
                state: 'connecting'
            }
        });
    });

    it('#send', function () {
        axon.addBranch('test', connector);
        axon.send('test', { msg: 1, opts: 2, callback: 3 });
        assert.deepEqual(connector.sends, [
            [1, 2, 3]
        ]);
    });
    
    describe('events', function () {
        var StubConnector = Class(process.EventEmitter, {
            constructor: function () {
                this.sends = [];
            },
            
            send: function () {
                this.sends.push([].slice.call(arguments));
                return true;
            }
        });

        var StubSoma = Class({
            _axonMessage: function (msg, branch) {
                this.msg = msg;
            },
    
            _axonError: function (err, branch) {
                this.error = err;
            },
    
            _axonState: function (state, branch) {
                this.state = state;
            }
        });
        
        var soma, connector, axon;
        
        beforeEach(function () {
            soma = new StubSoma();
            connector = new StubConnector();
            axon = new Axon(soma);
            axon.addBranch('test', connector);
        });
        
        it('#error', function () {
            connector.emit('error', new Error('something'));
            assert.ok(soma.error instanceof Error);
            assert.equal(soma.error.message, 'something');
        });
        
        it('#ready', function () {
            connector.emit('ready');
            assert.deepEqual(connector.sends, [
                [{ event: 'register', data: { name: 'test' } }]
            ]);
            assert.equal(soma.state, 'connected');
        });
        
        it('#connecting', function () {
            connector.emit('connecting');
            assert.equal(soma.state, undefined);    // state not changed
            connector.emit('close');
            assert.equal(soma.state, 'disconnected');
            connector.emit('connecting');
            assert.equal(soma.state, 'connecting');
        });

        it('#message', function () {
            connector.emit('message', { key: 'val' });
            assert.deepEqual(soma.msg, { key: 'val' });
        });
        
        it('#message id', function () {
            connector.emit('message', { event: 'id', data: { id: 1 } });
            assert.deepEqual(axon.toObject(), {
                test: {
                    id: 1,
                    name: 'test',
                    alias: 'test',
                    state: 'connecting'
                }
            });
            assert.deepEqual(soma.msg, { event: 'id', data: { id: 1 } });
        });
        
        it('#close', function () {
            connector.emit('message', { event: 'id', data: { id: 1 } });
            assert.equal(axon.branches['test'].id, 1);
            connector.emit('close');
            assert.equal(axon.branches['test'].id, undefined);
        });
    });
});