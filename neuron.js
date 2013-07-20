var elements     = require('evo-elements'),
    opts         = elements.Config.conf().opts,
    LocalService = require('./lib/LocalService');

if (!opts.port) {
    opts.port = process.env.PORT;
}

new LocalService(opts).start();