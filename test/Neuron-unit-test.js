var assert   = require('assert'),
    sandbox  = require('sandboxed-module'),
    async    = require('async'),
    Class    = require('js-class'),
    elements = require('evo-elements'),
    Config   = elements.Config,
    Try      = elements.Try,
    
    Neuron = require('../lib/Neuron');
    
describe('Neuron', function () {
    describe('#constructor', function () {
        it('opts.config', function () {
            var conf = {};
            assert.strictEqual(new Neuron('name', { config: conf }).cfg, conf);
            assert.strictEqual(new Neuron('name').cfg, Config.conf());
        });
        
        it('opts.connects', function () {
            assert.deepEqual(new Neuron('name', { connects: 'abc' })._connects, ['abc']);
            assert.deepEqual(new Neuron('name', { connects: ['abc', 'def'] })._connects, ['abc', 'def']);
        });
        
        it('opts.connectOpts', function () {
            var opts = {};
            assert.strictEqual(new Neuron('name', { connectOpts: opts })._connectOpts, opts);
            assert.strictEqual(new Neuron('name')._connectOpts, undefined);
        });
    });
    
    describe('#start', function () {
        var ReceptorHook = Class({
            constructor: function () {
                this.events = {};                            
            },

            on: function (event, callback) {
                this.events[event] = callback;
                return this;
            },
            
            emit: function (event, args) {
                if (this.events[event]) {
                    this.events[event].apply(null, args);
                }
            }
        });
        
        var StubConnector = Class(process.EventEmitter, {
            constructor: function (path, opts) {
                this.path = path;
                this.opts = opts;
            }
        });
        
        function createNeuron(synapseClass, name, opts) {
            var SandboxedNeuron = sandbox.require('../lib/Neuron', {
                requires: {
                    './Synapse': synapseClass
                }
            });
            return new SandboxedNeuron(name, opts);
        }
        
        it('register events', function () {
            var uri, receptor = new ReceptorHook();
            createNeuron({
                listen: function (pathUri) {
                    uri = pathUri;
                    return receptor;
                }
            }, 'name').start();
            assert.equal(uri, 'unix:/tmp/neuron-name.sock');
            ['connection', 'error', 'close', 'ready'].forEach(function (event) {
                assert.ok(receptor.events[event], 'expect event ' + event);
            });
        });
        
        it('connect services provided in opts', function () {
            var receptor = new ReceptorHook(), readyFnCalled;
            var neuron = createNeuron({
                listen: function () {
                    return receptor;
                },
                connect: function (path, opts) {
                    return new StubConnector(path, opts);
                }
            }, 'name', {
                connects: ['abc', 'def'],
                connectOpts: {
                    key: 3425
                }
            }).start(function () { readyFnCalled = true });
            receptor.emit('ready');
            assert.ok(readyFnCalled);
            assert.deepEqual(neuron.axon, {
                abc: {
                    id: undefined,
                    name: 'abc',
                    alias: 'abc',
                    state: 'connecting'
                },
                def: {
                    id: undefined,
                    name: 'def',
                    alias: 'def',
                    state: 'connecting'
                }
            });
            assert.equal(neuron._axon.branches['abc'].connector.path, 'unix:/tmp/neuron-abc.sock');
            assert.deepEqual(neuron._axon.branches['abc'].connector.opts, { key: 3425 });            
            assert.equal(neuron._axon.branches['def'].connector.path, 'unix:/tmp/neuron-def.sock');
            assert.deepEqual(neuron._axon.branches['def'].connector.opts, { key: 3425 });
        });
    });
    
    describe('#send', function () {
        it('validate message', function () {
            var neuron = new Neuron();
            [undefined, null, {}, '', { event: 'something' }, { event: 'event', data: '' }].forEach(function (msg) {
                assert.throws(function () {
                    neuron.send('branch', msg, { strict: true });
                }, /bad message/i);
            });
        });
        
        it('validate branch', function () {
            var neuron = new Neuron();
            assert.throws(function () {
                neuron.send('branch', { event: 'test', data: { } }, { strict: true })
            }, /not found axon branch/i);
            var ret = neuron.send('branch', { event: 'test', data: {} });
            assert.ok(ret instanceof Error);
        });
        
        it('params', function () {
            var neuron = new Neuron();
            var branch = Object.create({
                send: function (params) {
                    this.params = params;
                    return true;
                }
            });
            neuron._axon.branches['test'] = branch;
            var msg = { event: 'test', data: { key: 'val' } };
            
            neuron.send('test', msg, function () { });
            assert.deepEqual(branch.params.msg, msg);
            assert.equal(typeof(branch.params.callback), 'function');
            assert.deepEqual(branch.params.opts, {});
            
            var opts = { someOption: 'value' };
            neuron.send('test', msg, opts);
            assert.deepEqual(branch.params.msg, msg);
            assert.deepEqual(branch.params.opts, opts);
            assert.equal(branch.params.callback, undefined);
            
            neuron.send('test', msg, opts, function () { });
            assert.deepEqual(branch.params.msg, msg);
            assert.deepEqual(branch.params.opts, opts);
            assert.equal(typeof(branch.params.callback), 'function');
        });
    });
    
    describe('#cast', function () {
        var StubDendrite = Class({
            constructor: function (name, neuron) {
                var index = (neuron._dendrites[name] || (neuron._dendrites[name] = [])).push(this) - 1;
                this.name = name;
                this.id = name + '.' + index;
                this.sends = [];
            },
            
            send: function (params) {
                this.sends.push(params);
                return true;
            }
        });
        
        var msg = { event: 'test', data: { key: 'val' } };
        var neuron, dendrite;
        
        beforeEach(function () {
            neuron = new Neuron();
            dendrite = new StubDendrite('test', neuron);
        });
        
        it('unicast', function () {
            neuron.cast(msg, { target: 'test.0' });
            assert.deepEqual(dendrite.sends[0].msg, msg);
        });
        
        it('multicast with array', function () {
            var d = [dendrite, new StubDendrite('test', neuron), new StubDendrite('test', neuron)];
            var opts = { target: ['test.0', 'test.2'] };
            neuron.cast(msg, opts);
            assert.deepEqual(d[0].sends, [ { msg: msg, opts: opts } ]);
            assert.deepEqual(d[1].sends, []);
            assert.deepEqual(d[2].sends, [ { msg: msg, opts: opts } ]);
        });
        
        it('multicast with regexp', function () {
            var d = [dendrite, new StubDendrite('test-x1', neuron), new StubDendrite('test-y', neuron)];
            var opts = { target: /-\w+/ };
            neuron.cast(msg, opts);
            assert.deepEqual(d[0].sends, []);
            assert.deepEqual(d[1].sends, [ { msg: msg, opts: opts } ]);
            assert.deepEqual(d[2].sends, [ { msg: msg, opts: opts } ]);
        });
        
        it('multicast with function', function () {
            var d = [dendrite, new StubDendrite('test', neuron), new StubDendrite('test', neuron)];
            var opts = { target: function (id) {
                var index = parseInt(id.substr(id.indexOf('.') + 1));
                return index == 2;
            } };
            neuron.cast(msg, opts);
            assert.deepEqual(d[0].sends, []);
            assert.deepEqual(d[1].sends, []);
            assert.deepEqual(d[2].sends, [ { msg: msg, opts: opts } ]);
        });
        
        it('broadcast', function () {
            var d = [dendrite, new StubDendrite('test', neuron), new StubDendrite('test', neuron)];
            neuron.cast(msg);
            assert.deepEqual(d[0].sends, [ { msg: msg, opts: {} } ]);
            assert.deepEqual(d[1].sends, [ { msg: msg, opts: {} } ]);
            assert.deepEqual(d[2].sends, [ { msg: msg, opts: {} } ]);            
        });
    });
    
    describe('#request', function () {
        var neuron, branch;
        
        beforeEach(function () {
            neuron = new Neuron();
            branch = Object.create({
                name: 'test',
                send: function (params) {
                    this.params = params;
                    return true;
                }
            });
            neuron._axon.branches['test'] = branch;
        });

        var msg = { event: 'test', data: { key: 'val' } };
        
        it('map request with msg.id', function () {
            var resp = { event: 'resp', data: { key: 'v' } };
            var recv;
            neuron.request('test', msg, function (err, msg) {
                recv = { err: err, msg: msg };
            });
            assert.ok(branch.params.msg.id);
            assert.equal(branch.params.msg.event, msg.event);
            assert.deepEqual(branch.params.msg.data, msg.data);
            resp.id = branch.params.msg.id;
            neuron._axon._branchMessage(resp, branch);
            assert.ok(recv);
            assert.equal(recv.err, null);
            assert.deepEqual(recv.msg, resp);
            
            recv = undefined;
            neuron._axon._branchMessage(resp, branch);
            assert.equal(recv, undefined);
            neuron.request('test', msg, function (err, msg) {
                recv = { err: err, msg: msg };
            });
            assert.ok(branch.params.msg.id);
            assert.notEqual(resp.id, branch.params.msg.id);
            neuron._axon._branchMessage(resp, branch);
            assert.equal(recv, undefined);
        });
        
        it('request timeout', function (done) {
            var recv;
            async.series([
                function(next) {
                    neuron.request('test', msg, { timeout: 5 }, function (err, msg) {
                        Try.final(function () {
                            assert.ok(err instanceof Error);
                            assert.equal(err.message, 'timeout');
                            assert.equal(msg, undefined);
                        }, next);
                    });
                    Try.tries(function () {
                        assert.ok(branch.params.msg.id);
                    }, next);
                },
                function (next) {
                    var resp = { id: branch.params.msg.id, event: 'resp', data: { key: 'v' } };
                    neuron._axon._branchMessage(resp, branch);
                    Try.final(function () {
                        assert.equal(recv, undefined);
                    }, next);
                }
            ], done);
        });
    });
    
    describe('#dispatch', function () {
        var StubDendrite = Class({
            constructor: function (name, neuron) {
                var index = (neuron._dendrites[name] || (neuron._dendrites[name] = [])).push(this) - 1;
                this.name = name;
                this.id = name + '.' + index;
                this.sends = [];
            },
            
            send: function (params) {
                this.sends.push(params);
                return true;
            }
        });
        
        var msg = { event: 'test', data: { key: 'val' } };
        var neuron, dendrite;
        
        beforeEach(function () {
            neuron = new Neuron();
            dendrite = new StubDendrite('test', neuron);
        });
        
        function captureArgs(target) {
            return function () {
                var args = [].slice.call(arguments);
                Array.isArray(target) ? target.push(args) : (target.args = args);
            };
        }
        
        it('dispatch message by event', function () {
            var caps = {}, msgs = [];
            neuron
                .on('message', function (msg, info) { msgs.push({ msg: msg, info: info }); })
                .dispatch('test', captureArgs(caps))
                ._dendriteMessage(msg, dendrite);
            assert.ok(caps.args);
            assert.deepEqual(caps.args[0].raw, msg);
            assert.deepEqual(typeof(caps.args[1]), 'function');
            caps.args[1]();
            assert.notEqual(msgs.length, 0);
            assert.deepEqual(msgs[0].msg, msg);
            assert.deepEqual(msgs[0].info, { src: 'd', id: dendrite.id });
        });
        
        it('dispatch message by regexp', function () {
            var caps1 = {}, caps2 = {};
            neuron
                .dispatch(/^[^-]+$/, captureArgs(caps1))
                .dispatch(/-/, captureArgs(caps2))    
                ._dendriteMessage({ event: 'test-xyz', data: {} }, dendrite);
            neuron._dendriteMessage({ event: 'abc', data: {} }, dendrite);
            assert.ok(caps1.args);
            assert.equal(caps1.args[0].event, 'abc');
            assert.ok(caps2.args);
            assert.equal(caps2.args[0].event, 'test-xyz');
        });
        
        it('use respond in wrapped message', function () {
            var caps = {};
            neuron
                .dispatch('test', captureArgs(caps))
                ._dendriteMessage({ id: 1234, event: 'test', data: {} }, dendrite);
            assert.ok(caps.args);
            assert.equal(caps.args[0].event, 'test');
            caps.args[0].respond({ event: 'response', data: {} });
            assert.equal(dendrite.sends.length, 1);
            assert.deepEqual(dendrite.sends[0].msg, { id: 1234, event: 'response', data: {} });
        });
    });
});