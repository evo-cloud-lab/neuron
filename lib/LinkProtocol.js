var _       = require('underscore'),
    Class   = require('js-class'),
    msgpack = require('msgpack');

var PREFIX = 'evo-neuron-';

function defineProtocol(name, ops) {
    ops.constructor = function () {
        Object.defineProperty(this, 'id', { value: PREFIX + name, configurable: false, writable: false});
    };
    var protocolClass = Class(ops, {
        statics: {
            id: PREFIX + name,
            create: function () {
                return new protocolClass();
            }
        }
    });
    
    return protocolClass;
}

var supportedProtocols = [
    defineProtocol('json', {
        decode: function (message) {
            if (message && message.type == 'utf8') {
                try {
                    return JSON.parse(message.utf8Data);
                } catch (e) {
                    
                }
            }
            return null;
        },
        
        encode: function (object) {
            return JSON.stringify(object);
        }        
    }),
    defineProtocol('msgpack', {
        decode: function (message) {
            if (message && message.type == 'binary') {
                return msgpack.unpack(message.binaryData);
            }
            return null;
        },
        
        encode: function (object) {
            return msgpack.pack(object);
        }
    })
];

exports.select = function (protocols) {
    return _.find(supportedProtocols, function (proto) {
        return protocols.indexOf(proto.id) >= 0;
    });
};

exports.preferred = supportedProtocols[0];