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
                                    sources: {
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
                                        sources: {
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
                                    sources: {
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
        
    });
});