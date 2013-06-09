var assert = require('assert'),
    
    Node = require('../lib/Node');

describe('Node', function () {
    var node;
    
    beforeEach(function () {
        node = new Node();
    });
    
    it('expects id', function () {
        assert.equal(node.load({ address: 'localhost', port: 1234 }), false);
        assert.equal(node.valid, false);
    });

    it('expects address', function () {
        assert.equal(node.load({ id: 'localId', port: 1234 }), false);
        assert.equal(node.valid, false);        
    });
    
    it('expects port', function () {
        assert.equal(node.load({ id: 'localId', address: 'localhost' }), false);
        assert.equal(node.load({ id: 'localId', address: 'localhost', port: 0 }), false);
        assert.equal(node.valid, false);        
    });

    it('accepts correct identity', function () {
        assert.ok(node.load({ id: 'localId', address: 'localhost', port: 1234 }));
        assert.ok(node.valid);
    });
    
    it('#linkUri', function () {
        assert.ok(node.load({ id: 'localId', address: 'localhost', port: 1234 }));
        assert.ok(node.valid);
        assert.equal(node.linkUri, 'ws://localhost:1234');        
    });

    it('#apiUri', function () {
        assert.ok(node.load({ id: 'localId', address: 'localhost', port: 1234 }));
        assert.ok(node.valid);
        assert.equal(node.apiUri, 'http://localhost:1234');
    });
    
    it('#toObject', function () {
        node.load({ id: 'localId', address: 'localhost', port: 1234 });
        assert.deepEqual(node.toObject(), { id: 'localId', address: 'localhost', port: 1234 });
    });
});