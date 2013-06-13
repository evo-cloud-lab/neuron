var assert = require('assert'),
    async  = require('async'),

    Helpers = require('./Helpers'),
    Stubs   = require('./ExtensionStubs'),
    AdvertiseExt = require('../lib/AdvertiseExt');

describe('Ext - Advertise', function () {
    function createWatchers(master, opts, done) {
        var watchers = [];
        if (typeof(opts) == 'function') {
            done = opts;
            opts = {};
        }
        if (opts.onContents) {
            watchers.onContents = opts.onContents;
        }
        if (opts.onUpdate) {
            watchers.onUpdate = opts.onUpdate;
        }
        process.nextTick(function () {
            async.times(opts.count || 1, function (n, next) {
                watchers[n] = new Stubs.Link(master, 'w' + n, function (msg) {
                    if (msg.event == 'ad.contents') {
                        Helpers.expects(function () {                    
                            if (watchers.onContents) {
                                watchers.onContents(n, msg);
                            }
                        }, next, true);
                    } else if (msg.event == 'ad.update') {
                        if (watchers.onUpdate) {
                            watchers.onUpdate(n, msg);
                        }
                    }
                }).sendToMaster('ad.watch', { names: opts.watches || ['topic'] });
            }, done);
        });
        return watchers;
    }
    
    describe('Master', function () {
        var master, ext;
        
        beforeEach(function () {
            master = new Stubs.MasterContainer([AdvertiseExt.Master]);
            ext = master.exts.extensions[0];
        });
        
        it('#ad.pub', function (done) {
            createWatchers(master, {
                onContent: function (n, msg) {
                    assert.deepEqual(msg.data.contents, {});
                },
                onUpdate: function (n, msg) {
                    Helpers.expects(function () {
                        assert.deepEqual(msg.data.update, {
                            topic: {
                                p: {
                                    event: 'pub',
                                    content: {
                                        src: 'value'
                                    }
                                }
                            }
                        });
                    }, done, true);
                }
            }, function () {
                new Stubs.Link(master, 'p').sendToMaster('ad.pub', { contents: { topic: { src: 'value' } } });
            });
        });
        
        it('#ad.pub multiple watchers', function (done) {
            var WATCHERS = 5;
            createWatchers(master, {
                count: WATCHERS,
                onUpdate: function (n, msg) {
                    this[n].recv = true;
                    if (this.every(function (w) { return w.recv; })) {
                        done();
                    }
                }
            }, function () {
                new Stubs.Link(master, 'p').sendToMaster('ad.pub', { contents: { topic: { src: 'value' } } });
            });
        });
        
        it('#unpub', function () {
            var link1 = new Stubs.Link(master, 'p1')
                .sendToMaster('ad.pub', { contents: { topic: { src: 'value' } } });
            assert.deepEqual(ext.ads.map('ad'), {
                topic: {
                    p1: {
                        src: 'value'
                    }
                }
            });
            var link2 = new Stubs.Link(master, 'p2')
                .sendToMaster('ad.pub', { contents: { topic: { src: 'value2' } } });
            assert.deepEqual(ext.ads.map('ad'), {
                topic: {
                    p1: {
                        src: 'value'
                    },
                    p2: {
                        src: 'value2'
                    }
                }
            });
            
            link1.sendToMaster('ad.unpub', { names: ['topic'] });
            assert.deepEqual(ext.ads.map('ad'), {
                topic: {
                    p2: {
                        src: 'value2'
                    }
                }
            });
            link2.sendToMaster('ad.unpub', { names: ['topic'] });
            assert.deepEqual(ext.ads.map('ad'), {});            
        });
        
        it('#unwatch', function (done) {
            var watchers, link;
            async.series([
                function (next) {
                    watchers = createWatchers(master, {
                        count: 5,
                        onUpdate: function (n, msg) {
                            this[n].recv = true;
                            if (this.every(function (w) { return w.recv; })) {
                                next();
                            }
                        }
                    }, function () {
                        link = new Stubs.Link(master, 'p')
                            .sendToMaster('ad.pub', { contents: { topic: { src: 'value' } } });
                    });
                },
                function (next) {
                    watchers.onUpdate = function (n, msg) {
                        Helpers.expects(function () {
                            assert.notEqual(n, 0);
                            assert.deepEqual(msg.data, { update: {
                                topic: {
                                    p: {
                                        event: 'pub',
                                        content: {
                                            src: 'value1'
                                        }
                                    }
                                }
                            }});
                        }, next);
                        this[n].recv1 = true;
                        if (this.slice(1).every(function (w) { return w.recv1; })) {
                            next();
                        }                        
                    }
                    watchers[0].sendToMaster('ad.unwatch', { names: ['topic'] });
                    link.sendToMaster('ad.pub', { contents: { topic: { src: 'value1' } } });
                }
            ], done);
        });
        
        function connectOrDisconnect(action, done) {    
            var watchers;
            async.series([
                function (next) {
                    watchers = createWatchers(master, { count: 2, watches: ['t1', 't2'] }, next);
                },
                function (next) {
                    watchers.onUpdate = function (n, msg) {
                        watchers[n].phase1 = true;
                        if (watchers.every(function (w) { return w.phase1 })) {
                            next();
                        }
                    };
                    watchers[0].sendToMaster('ad.pub', { contents: { t1: { src: 'phase1' } } });
                },
                function (next) {
                    watchers.onUpdate = function (n, msg) {
                        Helpers.expects(function () {
                            assert.notEqual(n, 0);
                            assert.deepEqual(msg.data.update, { t1: {
                                w0: {
                                    event: 'off'
                                }
                            }});
                        }, next, true);
                    };
                    watchers[0][action]();
                },
                function (next) {
                    watchers.onUpdate = function (n, msg) {
                        Helpers.expects(function () {
                            assert.notEqual(n, 0);
                            assert.deepEqual(msg.data.update, { t1: {
                                p: {
                                    event: 'pub',
                                    content: {
                                        src: 'phase2'
                                    }
                                }
                            }});
                        }, next, true);          
                    };
                    new Stubs.Link(master, 'p').sendToMaster('ad.pub', { contents: { t1: { src: 'phase2' } } });
                }
            ], done);
        }
        
        it('#onConnect clear watchers and pubs', function (done) {
            connectOrDisconnect('connect', done);
        });


        it('#onDisconnect clear watchers and pubs', function (done) {
            connectOrDisconnect('disconnect', done);
        });
    });
    
    describe('Member', function () {
        var service, ext;
        
        beforeEach(function () {
            service = new Stubs.Service([AdvertiseExt.Member]);
            ext = service.exts.extensions[0];
        });
        
        it('#pub', function (done) {
            service.connector = {
                sendToMaster: function (event, data) {
                    Helpers.expects(function () {
                        assert.equal(event, 'ad.pub');
                        assert.deepEqual(data, { contents: {
                            topic: {
                                c1: 'Hello'
                            }
                        }});
                    }, done, true);
                }
            };
            new Stubs.Connection(service, 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
        });
        
        it('#unpub', function (done) {
            var conn = new Stubs.Connection(service, 'c1');
            async.series([
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    conn.sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
                },
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.unpub');
                                assert.deepEqual(data, { names: ['topic'] });
                            }, next, true);
                        }
                    };
                    conn.sendLocalMessage('ad.unpub', { names: ['topic'] });                    
                }
            ], done);
        });
        
        it('#pub multiple sources', function (done) {
            async.series([
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    new Stubs.Connection(service, 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
                },
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello',
                                        c2: 'Hello c2'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    new Stubs.Connection(service, 'c2').sendLocalMessage('ad.pub', { contents: { topic: 'Hello c2' } });                    
                }
            ], done);            
        });
        
        it('#unpub multiple sources', function (done) {
            var conn1 = new Stubs.Connection(service, 'c1');
            var conn2 = new Stubs.Connection(service, 'c2');
            async.series([
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    conn1.sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
                },
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello',
                                        c2: 'Hello c2'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    conn2.sendLocalMessage('ad.pub', { contents: { topic: 'Hello c2' } });
                },
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.pub');
                                assert.deepEqual(data, { contents: {
                                    topic: {
                                        c1: 'Hello'
                                    }
                                }});
                            }, next, true);
                        }
                    };
                    conn2.sendLocalMessage('ad.unpub', { names: ['topic'] });
                },
                function (next) {
                    service.connector = {
                        sendToMaster: function (event, data) {
                            Helpers.expects(function () {
                                assert.equal(event, 'ad.unpub');
                                assert.deepEqual(data, { names: ['topic'] });
                            }, next, true);
                        }
                    };
                    conn1.sendLocalMessage('ad.unpub', { names: ['topic'] });
                },
            ], done);
        });
        
        it('#pub when state changed to ready', function (done) {
            new Stubs.Connection(service, 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            service.connector = {
                sendToMaster: function (event, data) {
                    Helpers.expects(function () {
                        assert.equal(event, 'ad.pub');
                        assert.deepEqual(data, { contents: {
                            topic: {
                                c1: 'Hello'
                            }
                        }});
                    }, done, true);
                }
            };
            service.onStateChanged({ name: 'connected', ready: true });
        });
        
        it('#watch', function (done) {
            service.connector = {
                sendToMaster: function (event, data) {
                    Helpers.expects(function () {
                        assert.equal(event, 'ad.watch');
                        assert.deepEqual(data, { names: ['topic'] });
                    }, done, true);
                }
            };
            new Stubs.Connection(service, 'c1').sendLocalMessage('ad.watch', { names: ['topic'] });
        });
        
        it('#unwatch', function (done) {
            var conn = new Stubs.Connection(service, 'c1').sendLocalMessage('ad.watch', { names: ['topic'] });
            service.connector = {
                sendToMaster: function (event, data) {
                    Helpers.expects(function () {
                        assert.equal(event, 'ad.unwatch');
                        assert.deepEqual(data, { names: ['topic'] });
                    }, done, true);
                }
            };
            conn.sendLocalMessage('ad.unwatch', { names: ['topic'] });
        });
        
        it('#watch once', function (done) {
            var count = 0;
            service.connector = {
                sendToMaster: function (event, data) {
                    if (event == 'ad.watch') {
                        count ++;
                    } else if (event == 'ad.pub') {
                        Helpers.expects(function () {
                            assert.equal(count, 1);
                        }, done, true);
                    }                    
                }
            };
            new Stubs.Connection(service, 'c1').sendLocalMessage('ad.watch', { names: ['topic'] });
            new Stubs.Connection(service, 'c2').sendLocalMessage('ad.watch', { names: ['topic'] });
            new Stubs.Connection(service, 'c3').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
        });
        
        it('#unwatch once', function (done) {
            var count = 0;
            service.connector = {
                sendToMaster: function (event, data) {
                    if (event == 'ad.unwatch') {
                        count ++;
                    } else if (event == 'ad.pub') {
                        Helpers.expects(function () {
                            assert.equal(count, 1);
                        }, done, true);
                    }                    
                }
            };
            var conn1 = new Stubs.Connection(service, 'c1').sendLocalMessage('ad.watch', { names: ['topic'] });
            var conn2 = new Stubs.Connection(service, 'c2').sendLocalMessage('ad.watch', { names: ['topic'] });
            conn1.sendLocalMessage('ad.unwatch', { names: ['topic'] });
            conn2.sendLocalMessage('ad.unwatch', { names: ['topic'] });
            new Stubs.Connection(service, 'c3').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });            
        });
    });
    
    describe('Master and Member', function () {
        var master;
        
        function createService(id) {
            var link = new Stubs.Link(master, id);
            var service = new Stubs.Service([AdvertiseExt.Member], link);
            service.ext = service.exts.extensions[0];
            link.messageHandler = function (msg) {
                service.onMessage(msg);
            };
            return service;
        }
        
        beforeEach(function () {
            master = new Stubs.MasterContainer([AdvertiseExt.Master]);
            master.ext = master.exts.extensions[0];
        });
        
        it('pub and watch on the same service', function (done) {
            var service = createService('p');
            new Stubs.Connection(service, 'c1', function (msg) {
                Helpers.expects(function () {
                    assert.deepEqual(msg, {
                        event: 'ad.update',
                        data: {
                            update: {
                                topic: {
                                    p: {
                                        event: 'pub',
                                        content: {
                                            c2: 'Hello'
                                        }
                                    }
                                }
                            }
                        }
                    });
                }, done, true);
            }).sendLocalMessage('ad.watch', { names: ['topic'] });
            new Stubs.Connection(service, 'c2').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
        });
        
        it('pub and watch on different services', function (done) {
            new Stubs.Connection(createService('p1'), 'c', function (msg) {
                Helpers.expects(function () {
                    assert.deepEqual(msg, {
                        event: 'ad.update',
                        data: {
                            update: {
                                topic: {
                                    p2: {
                                        event: 'pub',
                                        content: {
                                            c: 'Hello'
                                        }
                                    }
                                }
                            }
                        }
                    });
                }, done, true);
            }).sendLocalMessage('ad.watch', { names: ['topic'] });
            new Stubs.Connection(createService('p2'), 'c').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
        });
        
        it('pub updates are merged by delayed job', function (done) {
            new Stubs.Connection(createService('p1'), 'c', function (msg) {
                Helpers.expects(function () {
                    assert.deepEqual(msg, {
                        event: 'ad.update',
                        data: {
                            update: {
                                topic: {
                                    p2: {
                                        event: 'pub',
                                        content: {
                                            c: 'Hello'
                                        }
                                    },
                                    p3: {
                                        event: 'pub',
                                        content: {
                                            c: 'Hello3'
                                        }
                                    }
                                }
                            }
                        }
                    });
                }, done, true);
            }).sendLocalMessage('ad.watch', { names: ['topic'] });
            new Stubs.Connection(createService('p2'), 'c').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            new Stubs.Connection(createService('p3'), 'c').sendLocalMessage('ad.pub', { contents: { topic: 'Hello3' } });
        });
        
        it('initial contents for watch', function (done) {
            new Stubs.Connection(createService('p1'), 'c').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            // use setTimeout because ad.pub is send by delayed job to all clients
            setTimeout(function () {
                new Stubs.Connection(createService('p2'), 'c', function (msg) {
                    Helpers.expects(function () {
                        assert.deepEqual(msg, {
                            event: 'ad.contents',
                            data: {
                                contents: {
                                    topic: {
                                        p1: {
                                            c: 'Hello'
                                        }
                                    }
                                }
                            }
                        });
                    }, done, true);
                }).sendLocalMessage('ad.watch', { names: ['topic'] });
            }, 1);
        });
        
        it('initial contents for watch in single service', function (done) {
            var service = createService('p');
            new Stubs.Connection(service, 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            // use setTimeout because ad.pub is send by delayed job to all clients
            setTimeout(function () {
                new Stubs.Connection(service, 'c2', function (msg) {
                    Helpers.expects(function () {
                        assert.deepEqual(msg, {
                            event: 'ad.contents',
                            data: {
                                contents: {
                                    topic: {
                                        p: {
                                            c1: 'Hello'
                                        }
                                    }
                                }
                            }
                        });
                    }, done, true);
                }).sendLocalMessage('ad.watch', { names: ['topic'] });
            }, 1);
        });
        
        it('disconnect event', function (done) {
            var service = createService('p1');
            var conn1 = new Stubs.Connection(service, 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            var conn2 = new Stubs.Connection(createService('p2'), 'c2');
            async.series([
                function (next) {
                    setTimeout(function () {
                        conn2.messageHandler = function (msg) {
                            Helpers.expects(function () {
                                assert.deepEqual(msg, {
                                    event: 'ad.contents',
                                    data: {
                                        contents: {
                                            topic: {
                                                p1: {
                                                    c1: 'Hello'
                                                }
                                            }
                                        }
                                    }
                                });
                            }, next, true);
                        };
                        conn2.sendLocalMessage('ad.watch', { names: ['topic'] });
                    }, 1);
                },
                function (next) {
                    conn2.messageHandler = function (msg) {
                        Helpers.expects(function () {
                            assert.deepEqual(msg, {
                                event: 'ad.update',
                                data: {
                                    update: {
                                        topic: {
                                            p1: {
                                                event: 'off'
                                            }
                                        }
                                    }
                                }
                            });
                        }, next, true);
                    };
                    service.connector.disconnect();
                }
            ], done);
        });
        
        it('unpub event', function (done) {
            var conn1 = new Stubs.Connection(createService('p1'), 'c1').sendLocalMessage('ad.pub', { contents: { topic: 'Hello' } });
            var conn2 = new Stubs.Connection(createService('p2'), 'c2');
            async.series([
                function (next) {
                    setTimeout(function () {
                        conn2.messageHandler = function (msg) {
                            Helpers.expects(function () {
                                assert.deepEqual(msg, {
                                    event: 'ad.contents',
                                    data: {
                                        contents: {
                                            topic: {
                                                p1: {
                                                    c1: 'Hello'
                                                }
                                            }
                                        }
                                    }
                                });
                            }, next, true);
                        };
                        conn2.sendLocalMessage('ad.watch', { names: ['topic'] });
                    }, 1);
                },
                function (next) {
                    conn2.messageHandler = function (msg) {
                        Helpers.expects(function () {
                            assert.deepEqual(msg, {
                                event: 'ad.update',
                                data: {
                                    update: {
                                        topic: {
                                            p1: {
                                                event: 'unpub'
                                            }
                                        }
                                    }
                                }
                            });
                        }, next, true);
                    };
                    conn1.sendLocalMessage('ad.unpub', { names: ['topic'] });
                }
            ], done);
        });        
    });
});