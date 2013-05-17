var http         = require('http'),
    express      = require('express'),
    ServerSocket = require('websocket').server,
    elements     = require('evo-elements'),
    opts         = elements.Config.conf().opts,
    trace        = elements.Trace('neuron:serv'),
    Connector    = require('./lib/Connector');

if (!opts.port && process.env.PORT) {
    opts.port = process.env.PORT;
}

var app = express();

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

var connector = new Connector(opts);

require('./routes/ConnectorApi').register(app, connector);

var server = http.createServer(app);
var sockets = new ServerSocket({ httpServer: server })
    .on('request', function (request) {
        connector.linkRequest(request);
    });

server.listen(opts.port, function () {
    if (!opts.port) {
        opts.port = server.address().port;
    }
    connector.connect();
    trace.info('Neuron is ready on %s:%d', server.address().address, opts.port);
});