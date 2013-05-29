var elements     = require('evo-elements'),
    opts         = elements.Config.conf().opts,
    Connector    = require('../lib/Connector'),
    LocalService = require('../lib/LocalService');

function hostConnector() {
    var connector = new Connector(opts)
        .on('state', function (state) {
            process.send({ event: 'state', data: state });
        })
        .on('ready', function () {
            process.send({ event: 'ready' });
        })
        .on('topology', function () {
            process.send({ event: 'topology', data: connector.topology.toObject() });
        })
        .start();
}

function hostService() {
    
}

switch (opts.mode) {
    case 'connector':
        hostConnector();
        break;
    default:
        hostService();
}