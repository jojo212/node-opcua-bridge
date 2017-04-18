"use strict"

var async = require("async");
var opcua = require("node-opcua");

function ReadPump(config, measurements) {
    this.uaServerUrl = config.url;
    this.uaClient = new opcua.OPCUAClient();
    this.uaSession;
    this.uaSubscription;
    this.measurements = measurements;
    this.polledPoints = [];
    this.monitoredPoints = [];
    this.poller;
}

ReadPump.prototype.ConnectOPCUA = function (callback) {
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

ReadPump.prototype.DisconnectOPCUA = function (callback) {
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

ReadPump.prototype.ExecuteOPCUAReadRequest = function (nodes, callback) {
    let self = this;
    
    if (!self.uaSession) {
        callback("The readpump has no active session. Can't read.", [], []);
        return;
    }
    
    self.uaSession.read(nodes, 0, callback);
}

ReadPump.prototype.StartMonitoring = function (callback) {
    let self = this;
    
    // create an OPCUA subscription
    self.uaSubscription = new opcua.ClientSubscription(self.uaSession, {
        requestedPublishingInterval: 1000,
        requestedLifetimeCount: 10,
        requestedMaxKeepAliveCount: 2,
        maxNotificationsPerPublish: 20,
        publishingEnabled: true,
        priority: 1
    });
    let sub = self.uaSubscription;
    sub.on("started", function () {
        console.log("subscription", sub.subscriptionId, "started");
    }).on("keepalive", function () {
        //console.log("subscription", sub.subscriptionId, "keepalive");
    }).on("terminated", function () {
        let err = "subscription" + sub.subscriptionId + "was terminated";
        console.log(err);
        callback(err);
    });
    
    // install a monitored item on the subscription for each measurement in
    // the readpump's monitored items.
    self.monitoredPoints.forEach(
        function (m) {
            let uaMonitoredItem =
                sub.monitor(
                m, {
                    clienthandle: 13,
                    samplingInterval: m.monitorResolution,
                    discardOldest: true,
                    queueSize: 1000
                },
                    opcua.read_service.TimestampsToReturn.Both,
                    function (err) {
                    if (err) callback(err);
                });
            uaMonitoredItem.on("changed", function (dataValue) {
                if (DataValueIsValid(dataValue)) {
                    m.measurement.dataValue = dataValue; 
                    m.measurement.changeEmitter.emit('changed', dataValue);
                } else {
                    console.log("Invalid point returned from subscription.", DataValueIsValid(p), PointMatchesType(p));
                }
            });
            
            uaMonitoredItem.on("err", function (err_message) {
                console.log(uaMonitoredItem.itemToMonitor.nodeId.toString(),
                    " ERROR :", err_message);
            });
            
            // add the monitored item to the measurement in the list.
            m.uaMonitoredItem = uaMonitoredItem;
        }
    );
}

ReadPump.prototype.StartPolling = function (callback) {
    let self = this;
    
    // install a schedule that triggers every second.
    let schedule = require('node-schedule');
    let rule = new schedule.RecurrenceRule();
    rule.second = new schedule.Range(0, 59, 1);
    
    self.poller = schedule.scheduleJob(rule, function () {
        let d = new Date();
        let s = d.getSeconds();
        
        let nodesToRead = self.polledPoints.filter(function (m) {
            return s % m.pollInterval === 0
        });
        
        if (nodesToRead.length > 0) {
            self.ExecuteOPCUAReadRequest(nodesToRead, function (err, nodes, dataValues) {
                if (err) {
                    callback(err);
                    return;
                }
                
                // filter the results. Check for deadband. If all checks pass, set
                // the measurement's lastValue
                dataValues.forEach(function (p, i) {
                    //put dataValue in Point
                    nodes[i].measurement.dataValue = p;
                    if (!DataValueIsValid(p)) {
                        // Set de default value for the type specified
                        console.log("Invalid point:", p.measurement.name, p.measurement.nodeId.value, p.value)
                            
                    }
                    else {
                            
                        // Check for deadband and fire event if not within deadband
                        SetValue(nodes[i]);
                            
                        // if we retain the point, we must update the measurment's
                        // last value!
                        nodes[i].lastDataValue = nodes[i].measurement.dataValue;
                        
                    }
                });                
            });
        }
    });
}

ReadPump.prototype.InitializePoints = function () {
    let self = this;
    self.measurements.forEach(function (m) {
        
        if (m.hasOwnProperty("collectionType")) {
            m.dataValue = null; //add the datavalue property which will be updated with new data when received
            switch (m.collectionType) {
                case "monitored":
                    if (m.hasOwnProperty("monitorResolution")) {
                        self.monitoredPoints.push({
                            nodeId: m.nodeIn,
                            attributeId: opcua.AttributeIds.Value,
                            measurement : m,
                           lastDataValue : null
                        });
                    } else {
                        console.log("Measurement was specified as monitored but has no monitorResolution", m);
                    }
                    break;
                case "polled":
                    if (m.hasOwnProperty("pollRate") &&
                        m.pollRate >= 1 &&
                        m.pollRate <= 60) {
                        var pollInterval = Math.round(60 / m.pollRate);
                        while (60 % pollInterval !== 0) {
                            pollInterval += 1;
                        }                        
                        self.polledPoints.push({
                            nodeId: m.nodeIn,
                            attributeId: opcua.AttributeIds.Value,
                            measurement : m,
                            pollInterval: pollInterval,
                            lastDataValue : null
                        });
                    } else {
                        console.log("Measurement was specified as polled but has no or invalid pollRate", m);
                    }
                    break;
                default:
                    console.log("Invalid collectionType for measurement", m);
            }
        } else {
            console.log("Property collectionType not found for measurement", m);
        }
    });
}


ReadPump.prototype.Run = function (callback) {
    let self = this;
    
    self.InitializePoints();
    
    // declare 2 vars to avoid double callbacks
    let monitoringCallbackCalled = false;
    let pollingCallbackCalled = false;
    
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
                polling: function (parallel_callback) {
                    // start polling
                    self.StartPolling(function (err) {
                        if (self.poller) self.poller.cancel();
                        self.poller = null;
                        console.log("Polling error:", err);
                        if (!pollingCallbackCalled) {
                            pollingCallbackCalled = true;
                            parallel_callback("Polling error: " + err);
                        } else {
                            console.log('WARNING: polling callback already called');
                        }
                    });
                }
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


function PointHasGoodOrDifferentBadStatus(p) {
    let curr = p.measurement.dataValue.statusCode.name;
    let prev = p.lastDataValue ? p.lastDataValue.statusCode.name : "Bad";
    
    if (curr === "Good" || curr !== prev) return true;
    return false;
}

function DataValueIsValid(p) {
    // check if the value is a type that we can handle (number or a bool).
    return (
        ((typeof p.value.value === "number" || typeof p.value.value === "boolean") && !isNaN(p.value.value)) 
        || typeof p.value.value === "string"
)
}

function PointMatchesType(p) {
    // check if the value is a type that we can handle (number or a bool).
    let match = (typeof p.value === p.measurement.dataType)
    if (!match) {
        console.log(p.measurement, "Types don't match: ", typeof p.value, p.measurement.dataType)
    }
    return match
}

function SetValue(p) {
    // some vars for shorter statements later on.
    if (!p.measurement.dataValue.value) return;

    let curr = p.measurement.dataValue.value.value;
    let prev = p.lastDataValue ? p.lastDataValue.value.value : null;
    
    let dba = p.measurement.deadbandAbsolute;
    let dbr = p.measurement.deadbandRelative;
    
    // return early if the type of the previous value is not the same as the current.
    // this will also return when this is the first value and prev is still undefined.
    if (typeof curr !== typeof prev) return;
    
    // calculate deadbands based on value type. For numbers, make the
    // calculations for both absolute and relative if they are set. For bool,
    // just check if a deadband has been set and if the value has changed.
    switch (typeof curr) {
        case "number":
            if (dba > 0 && Math.abs(curr - prev) < dba) {
                // console.log("New value is within absolute deadband.", p);
                p.measurement.dataValue.value.value = p.lastDataValue.value.value;
                return;
            }
            if (dbr > 0 && Math.abs(curr - prev) < Math.abs(prev) * dbr) {
                // console.log("New value is within relative deadband.", p);
                p.measurement.dataValue.value.value = p.lastDataValue.value.value;
                return;
            }
            break;
        case "boolean":
            if (dba > 0 && prev === curr)
                return;
                // console.log("New value is within bool deadband.", p);
            break;
        case "string":
            break;
        default:
            console.log("unexpected type for deadband calc", p);
    }
    
    //If not within deadband
    p.measurement.changeEmitter.emit('changed', p.measurement.dataValue);
    
}

module.exports = ReadPump;
