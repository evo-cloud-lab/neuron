var http      = require('http'),
    Class     = require('js-class'),
    express   = require('express'),
    SocketSrv = require('websocket').server,

    LinkProtocol = require('./LinkProtocol');

var Server = Class(process.EventEmitter, {
    constructor: function (opts) {
        app = express();
        app.configure('development', function () {
            app.use(express.logger('dev'));
        });
        
        app.configure(function () {
            app.use(express.bodyParser());
            app.use(express.methodOverride());
            app.use(app.router);
        });

        app.configure('development', function () {
            app.use(express.errorHandler());
        });
        
        this.app = app;

        if (opts && opts.routes) {
            var routes = Array.isArray(opts.routes) ? opts.routes : [opts.routes];
            routes.forEach(function (route) {
                if (typeof(route) == 'function') {
                    route(app, this);
                }
            });
        }
        
        this.httpServer = http.createServer(app)
            .on('close', function () { this.emit('close'); }.bind(this));
        
        this.sockets = new SocketSrv({ httpServer: this.httpServer })
            .on('request', opts.accept ? opts.accept : this.onSocketRequest.bind(this));
    },
    
    listen: function (portOrPath, callback) {
        this.httpServer.listen(portOrPath, callback);
        return this;
    },
    
    close: function (callback) {
        this.httpServer.close(callback);
        return this;
    },
    
    onSocketRequest: function (request) {
        var conn = Server.accept(request);
        if (conn) {
            this.emit('connection', conn.connection, conn.protocol, this);
        }
    }
}, {
    statics: {
        accept: function (request) {
            var protocolClass = LinkProtocol.select(request.requestedProtocols);
            if (!protocolClass) {
                request.reject(400, 'Unsupported protocol');
                return null;
            }
            var connection = request.accept(protocolClass.id, request.origin);
            return {
                connection: connection,
                protocol: protocolClass.create()
            };
        }
    }
});

module.exports = Server;