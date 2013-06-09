var assert = require('assert'),
    Class  = require('js-class'),
    
    Node     = require('../lib/Node'),
    Topology = require('../lib/Topology');

describe('Topology', function () {
    var DummyConnector = Class({
        constructor: function () {
            this.updatedCount = 0;
        },
        
        topologyUpdated: function () {
            this.updatedCount ++;
        }
    });
    
    function localTopology(id) {
        return new Topology('local', { id: id || 'localId', address: 'localhost', port: 2000 }, new DummyConnector());
    }

    it('#V version', function () {
        assert.equal(localTopology().V, Topology.V);
    });
    
    it('#id', function () {
        assert.equal(localTopology().id, 'localId');
    });
    
    it('#valid', function () {
        var topology = localTopology();
        assert.equal(topology.valid, false);
        topology.reload({
            v: Topology.V,
            revision: 1,
            master: 'masterId',
            nodes: [
                { id: 'masterId', address: 'localhost', port: 1234 },
            ]
        });
        assert.ok(topology.valid);
    });
    
    it('#clear', function () {
        var topology = localTopology();
        topology.reload({
            v: Topology.V,
            revision: 1,
            master: 'masterId',
            nodes: [
                { id: 'masterId', address: 'localhost', port: 1234 },
            ]
        });
        assert.ok(topology.valid);
        topology.clear();
        assert.equal(topology.valid, false);
        assert.equal(topology.isMaster, false);
        assert.equal(topology.master, null);
        assert.equal(topology.id, 'localId');
    });
    
    it('#toObject', function () {
        var topology = localTopology();
        topology.reload({
            v: Topology.V,
            revision: 1,
            master: 'masterId',
            nodes: [
                { id: 'masterId', address: 'localhost', port: 1234 },
            ]
        });
        assert.deepEqual(topology.toObject(), {
            v: Topology.V,
            revision: 1,
            name: 'local',
            id: 'localId',
            master: 'masterId',
            nodes: [
                { id: 'masterId', address: 'localhost', port: 1234 },
                { id: 'localId', address: 'localhost', port: 2000 }
            ]
        });
    });
    
    it('master', function () {
        var topology = localTopology();
        assert.equal(topology.isMaster, false);
        assert.equal(topology.master, null);
        topology.becomeMaster();
        assert.ok(topology.isMaster);
        assert.ok(topology.master);
        assert.ok(topology.master.id, 'localId');
        topology.clear().reload({
            v: Topology.V,
            revision: 1,
            master: 'masterId',
            nodes: [
                { id: 'masterId', address: 'localhost', port: 1234 },
            ]
        });
        assert.equal(topology.isMaster, false);
        assert.ok(topology.master);
        assert.ok(topology.master.id, 'masterId');
    });
    
    describe('master operations', function () {
        it('forbidden in non-master state', function () {
            var topology = localTopology();
            assert.throws(function () {
                topology.add({});
            }, /in non-master state/);
            assert.throws(function () {
                topology.remove('abc');
            }, /in non-master state/);
            assert.throws(function () {
                topology.flushChanges();
            }, /in non-master state/);
        });
        
        it('add remove and changes', function () {
            var topology = localTopology().becomeMaster();
            var connector = topology.connector;
            topology.add(new Node({ id: 'node1', address: 'localhost', port: 2001 }));
            assert.equal(connector.updatedCount, 2);    // for becomeMaster and add
            topology.remove('node1');
            assert.equal(connector.updatedCount, 3);
            topology.remove('node1');
            assert.equal(connector.updatedCount, 3);
            topology.remove('node2');
            assert.equal(connector.updatedCount, 3);
            assert.equal(topology.baseRevision, 0);
            assert.equal(topology.revision, 2);
            var changes = topology.flushChanges();
            assert.equal(topology.baseRevision, topology.revision);
            assert.equal(changes.baseRevision, 0);
            assert.equal(changes.revision, 2);
            assert.equal(changes.changes.length, 1);
            assert.equal(changes.changes[0].type, 'delete');
            assert.equal(changes.changes[0].nodeId, 'node1');
            assert.equal(topology.flushChanges(), null);
        });
        
        it('should not remove local node', function () {
            var topology = localTopology().becomeMaster();
            var connector = topology.connector;
            topology.remove('localId');
            assert.equal(connector.updatedCount, 1);    // for becomeMaster
            assert.ok(topology.nodes['localId']);
            assert.equal(topology.id, 'localId');
        });
    });
    
    describe('member operations', function () {
        it('forbidden in master state', function () {
            var topology = localTopology().becomeMaster();
            assert.throws(function () {
                topology.reload();
            }, /in master state/);
            assert.throws(function () {
                topology.update();
            }, /in master state/);
            assert.throws(function () {
                topology.electMaster();
            }, /in master state/);
        });
        
        describe('#reload', function () {
            it('verify topology version', function () {
                var topology = localTopology();
                assert.throws(function () {
                    topology.reload({ v: 'abc' });
                }, /Bad topology/);
            });
            
            it('verify nodes', function () {
                var topology = localTopology();
                assert.throws(function () {
                    topology.reload({ v: Topology.V, nodes: null });
                }, /Bad topology/);                
            });
            
            it('verify revision', function () {
                var topology = localTopology();
                assert.throws(function () {
                    topology.reload({ v: Topology.V, nodes: [], revision: null });
                }, /Bad topology/);
            });
            
            it('verify master', function () {
                var topology = localTopology();
                assert.throws(function () {
                    topology.reload({ v: Topology.V, nodes: [], revision: 1 });
                }, /No master/);                
            });
            
            it('verify master id', function () {
                var topology = localTopology();
                assert.throws(function () {
                    topology.reload({ v: Topology.V, nodes: [], revision: 1, master: 'abc' });
                }, /Invalid master id/);
            });
            
            it('reloads nodes', function () {
                var topology = localTopology();
                topology.reload({
                    v: Topology.V,
                    master: 'node1',
                    revision: 1,
                    nodes: [
                        { id: 'node1', address: 'localhost', port: 2001 },
                        { id: 'node2', address: 'localhost', port: 2002 }
                    ]
                });
                assert.equal(Object.keys(topology.nodes).length, 3);
            });
            
            it('should not overwrite local node', function () {
                var topology = localTopology();
                topology.reload({
                    v: Topology.V,
                    master: 'node1',
                    revision: 1,
                    nodes: [
                        { id: 'node1', address: 'localhost', port: 2001 },
                        { id: 'localId', address: 'localhost', port: 2002 }
                    ]
                });
                assert.equal(Object.keys(topology.nodes).length, 2);
                assert.equal(topology.nodes['localId'].port, 2000);
            });
        });
        
        describe('#update', function () {
            var topology;
            
            beforeEach(function () {
                topology = localTopology();
                topology.reload({
                    v: Topology.V,
                    master: 'node1',
                    revision: 1,
                    nodes: [
                        { id: 'node1', address: 'localhost', port: 2001 },
                        { id: 'node2', address: 'localhost', port: 2002 }
                    ]
                });
                assert.equal(Object.keys(topology.nodes).length, 3);
            });
            
            it('update existed nodes', function () {
                topology.update([
                    { type: 'update', node: { id: 'node2', address: 'local', port: 2012 } }
                ]);
                assert.equal(topology.nodes['node2'].address, 'local');
                assert.equal(topology.nodes['node2'].port, 2012);
            });
            
            it('update non-existed nodes perform insert', function () {
                topology.update([
                    { type: 'update', node: { id: 'node3', address: 'local', port: 2003 } }
                ]);
                assert.ok(topology.nodes['node3']);
                assert.equal(topology.nodes['node3'].address, 'local');
                assert.equal(topology.nodes['node3'].port, 2003);
            });
            
            it('not update local node', function () {
                topology.connector.updatedCount = 0;
                topology.update([
                    { type: 'update', node: { id: 'localId', address: 'local', port: 2012 } }
                ]);
                assert.equal(topology.connector.updatedCount, 0);
                assert.equal(topology.nodes['localId'].address, 'localhost');
                assert.equal(topology.nodes['localId'].port, 2000);
            });

            it('delete existed nodes', function () {
                topology.update([
                    { type: 'delete', nodeId: 'node2' }
                ]);
                assert.equal(topology.nodes['node2'], undefined);
            });

            it('not delete local node', function () {
                topology.connector.updatedCount = 0;
                topology.update([
                    { type: 'delete', nodeId: 'localId' }
                ]);
                assert.equal(topology.connector.updatedCount, 0);
                assert.ok(topology.nodes['localId']);             
            });

            it('not delete master node', function () {
                topology.connector.updatedCount = 0;
                topology.update([
                    { type: 'delete', nodeId: 'node1' }
                ]);
                assert.equal(topology.connector.updatedCount, 0);
                assert.ok(topology.nodes['node1']);             
            });
        });
        
        it('#becomeMaster', function () {
            var topology = localTopology();
            topology.reload({
                v: Topology.V,
                master: 'node1',
                revision: 1,
                nodes: [
                    { id: 'node1', address: 'localhost', port: 2001 },
                    { id: 'node2', address: 'localhost', port: 2002 }
                ]
            });
            assert.equal(Object.keys(topology.nodes).length, 3);
            topology.becomeMaster();
            assert.ok(topology.isMaster);
            assert.equal(Object.keys(topology.nodes).length, 1);
        });
        
        it('#electMaster', function () {
            var topology = localTopology('10');
            topology.reload({
                v: Topology.V,
                master: '08',
                revision: 1,
                nodes: [
                    { id: '08', address: 'localhost', port: 2008 },
                    { id: '09', address: 'localhost', port: 2009 },
                    { id: '11', address: 'localhost', port: 2011 }
                ]
            });
            assert.equal(Object.keys(topology.nodes).length, 4);            
            topology.electMaster();
            assert.ok(topology.master);
            assert.equal(topology.master.id, '09');
            assert.equal(Object.keys(topology.nodes).length, 3);
            topology.electMaster();
            assert.ok(topology.isMaster);
            assert.equal(topology.master.id, '10');
            assert.equal(Object.keys(topology.nodes).length, 2);
        });
    });
});