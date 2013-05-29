var assert  = require('assert'),
    async   = require('async'),
    Helpers = require('./Helpers'),
    ClusterManager = require('./ClusterManager');

describe('Connector Functional', function () {
    var cluster;
    
    beforeEach(function () {
        cluster = new ClusterManager();
    });
    
    afterEach(function () {
        cluster.stop();
    });
    
    it('Simply creates a network with 16 nodes', function (done) {
        this.timeout(5000);
        cluster
            .on('allready', function (ready) {
                if (ready) {
                    done();
                }
            })
            .start(16, 'connector');
    });
});