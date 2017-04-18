"use strict"

var async = require("async");
var opcua = require("node-opcua");


function WritePump(config, measurements) {
    this.uaServerUrl = config.url;
    this.uaClient = new opcua.OPCUAClient();
    this.uaSession;
    this.measurements = measurements;
    this.points = [];
}

WritePump.prototype.ConnectOPCUA = function (callback) {
    let self = this;
    self.uaClient.connect(self.uaServerUrl, function (err) {
        if (err) {
            callback(err);
            return;
        }
        self.uaClient.createSession(function (err, session) {
            if (err) {
                callback(err);
                return;
            }
            self.uaSession = session;
            callback(null);
        });
    });
}

WritePump.prototype.DisconnectOPCUA = function (callback) {
    let self = this;
    if (self.uaSession) {
        self.uaSession.close(function (err) {
            if (err) {
                console.log("session close failed", err);
            }
            self.uaSession = null;
            self.DisconnectOPCUA(callback)
        });
    } else {
        self.uaClient.disconnect(function () {
            callback();
        })
    }
}

WritePump.prototype.ExecuteOPCUAWriteRequest = function (points, callback) {
    let self = this;
    
    if (!self.uaSession) {
        console.log("The writepump has no active session. Can't write.");
        return;
    }
    
    self.uaSession.write(points, function (err, statusCodes, diagnosticInfos) {
        if (err) {
            callback(err);
            return;
        }
        
        // filter the results. Check for deadband. If all checks pass, set
        // the measurement's lastValue
        statusCodes.forEach(function (s, i) {
            //put dataValue in Point
            if (s.value) console.log("Write failed with status name:", s.name, ' for node : ' , points[i].nodeId);
                    
        });
    });
}

WritePump.prototype.StartMonitoring = function (callback) {
    let self = this;
    
    // install a monitored item on the subscription for each measurement in
    // the readpump's monitored items.
    self.points.forEach(
        function (m) {
            
            m.measurement.changeEmitter.on('changed', function (d) {
                
                m.value = d;
                self.ExecuteOPCUAWriteRequest([m], callback);
            });
        }
    );
}


WritePump.prototype.InitializePoints = function () {
    let self = this;
    self.measurements.forEach(function (m) {
        self.points.push({
            nodeId: m.nodeOut,
            attributeId: opcua.AttributeIds.Value,
            measurement : m,
            value : null
        });
    });
}

WritePump.prototype.Run = function (callback) {
    let self = this;
    
    self.InitializePoints();
    
    // declare 2 vars to avoid double callbacks
    let monitoringCallbackCalled = false;
    
    async.waterfall([
            // connect opc
        function (waterfall_next) {
            self.ConnectOPCUA(waterfall_next)
        },
            // Start both the monitoring and the polling of the measurments.
            // In case of an error, close everything.
        function (waterfall_next) {
            async.parallel({
                monitoring: function (parallel_callback) {
                    // install the subscription
                    self.StartMonitoring(function (err) {
                        console.log("Monitoring error:", err);
                        if (!monitoringCallbackCalled) {
                            monitoringCallbackCalled = true;
                            parallel_callback("Monitoring error: " + err);
                        } else {
                            console.log('WARNING: monitoring callback already called');
                        }
                    });
                },
                
            },
                    function (err) {
                waterfall_next(err);
            })
        }
    ],
        // final callback
        function (err) {
        
        // close disconnect client
        self.DisconnectOPCUA(function () {
            callback(err);
        })
    });
}

module.exports = WritePump;
