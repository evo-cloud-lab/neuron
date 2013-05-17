var _ = require('underscore');

exports.register = function (app, connector) {
    app.get('/topology', function (req, res) {
        res.json(connector.topology.toObject());
    });
    
    app.get('/state', function (req, res) {
        res.json({ state: connector.stateName, topologyVer: connector.topology.V });
    });
};