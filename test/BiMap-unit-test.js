var assert = require('assert'),
    
    BiMap = require('../lib/BiMap');
    
describe('BiMap', function () {
    var bimap;
    
    beforeEach(function () {
        bimap = new BiMap('a1', 'a2');
    });
    
    it('#add', function () {
        assert.deepEqual(bimap.names, ['a1', 'a2']);
        bimap.add('k1', 'k2');
        assert.ok(bimap.maps[0]['k1']['k2']);
        assert.ok(bimap.maps[1]['k2']['k1']);
        bimap.add('k1', 'k3');
        assert.ok(bimap.maps[0]['k1']['k3']);
        assert.ok(bimap.maps[1]['k3']['k1']);
        assert.strictEqual(bimap.maps[1]['k2']['k3'], undefined);
        assert.strictEqual(bimap.maps[1]['k3']['k2'], undefined);
    });
    
    it('add with simple value', function () {
        bimap.add('k1', 'k2', 'value');
        assert.equal(bimap.get('k1', 'k2'), 'value');
        bimap.add('k1', 'k2', 'value1');
        assert.equal(bimap.get('k1', 'k2'), 'value1');
    });

    it('add with merge', function () {
        bimap.add('k1', 'k2');
        bimap.add('k1', 'k2', { value: 1 }, true);
        assert.deepEqual(bimap.get('k1', 'k2'), { value: 1 });
        bimap.add('k1', 'k2', { value1: 2 }, true);
        assert.deepEqual(bimap.get('k1', 'k2'), { value: 1, value1: 2 });
        bimap.add('k1', 'k2', { val: 90 });
        assert.deepEqual(bimap.get('k1', 'k2'), { val: 90 });
        bimap.add('k1', 'k2', 'value');
        assert.throws(function () {
            bimap.add('k1', 'k2', { val: 80 }, true);
        }, /not mergable/i);
    });
    
    it('#remove', function () {
        bimap
            .add('k1', 'k2')
            .add('k1', 'k3')
            .remove('k1', 'k2');       
        assert.strictEqual(bimap.maps[0]['k1']['k2'], undefined);
        assert.strictEqual(bimap.maps[1]['k2'], undefined);
        assert.ok(bimap.maps[0]['k1']['k3']);
        assert.ok(bimap.maps[1]['k3']['k1']);
        bimap.remove('k1', 'k3');
        assert.strictEqual(bimap.maps[0]['k1'], undefined);
        assert.strictEqual(bimap.maps[1]['k3'], undefined);
    });
    
    it('#removeAll', function () {
        bimap
            .add('k1', 'k2')
            .add('k1', 'k3')
            .removeAll('k1', 'a1');
        assert.strictEqual(bimap.maps[0]['k1'], undefined);
        assert.strictEqual(bimap.maps[1]['k2'], undefined);
        assert.strictEqual(bimap.maps[1]['k3'], undefined);
    });
    
    it('#all', function () {
        bimap
            .add('k1', 'k2')
            .add('k1', 'k3');
        assert.ok(bimap.all('k1', 'a1')['k2']);
        assert.ok(bimap.all('k1', 'a1')['k3']);
    });
    
    it('#keys', function () {
        bimap
            .add('k1', 'k2')
            .add('k1', 'k3');
        assert.deepEqual(bimap.keys('k1', 'a1'), ['k2', 'k3']);
        assert.deepEqual(bimap.keys('none', 'a1'), []);
    });
    
    it('#map', function () {
        assert.strictEqual(bimap.map('a1'), bimap.maps[0]);
        assert.strictEqual(bimap.map('a2'), bimap.maps[1]);
    });
    
    it('throws with invalid key name', function () {
        ['removeAll', 'all', 'keys'].forEach(function (method) {
            assert.throws(function () {
                bimap[method]('k', 'none');
            }, /invalid key name/i);            
        });
        assert.throws(function () {
            bimap.map('none');
        }, /invalid key name/i);
    });
});