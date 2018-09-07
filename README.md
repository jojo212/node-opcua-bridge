# node-opcua-bridge

A bridge between two OPCUA servers

> Note: still experimental

This application will connect to an OPC UA server, subscribe to the measurements in your configuration and transfer them to another OPCUA server via another client.

## Installation

Make sure you have a recent version of node installed (>4), then execute the following commands.

```
$ git clone https://github.com/vova292/node-opcua-bridge.git
$ cd node-opcua-bridge
$ npm install
```

## Things to know

If a bad value is encountered by the reader, the writer will not be able to push it to the output server. There are no default values that are pushed in this case.

If the reader gets disconnected the writer again does not push anything to the output server

## Configuration

Modify the `config.toml` file to match your configuration. The input section should contain the url of the OPC server (no advanced authentication supported yet).

```
[input]
url             = "opc.tcp://opcua.demo-this.com:51210/UA/SampleServer"
failoverTimeout = 5000     # time to wait before reconnection in case of failure
```

Modify the output section to contain the url of the output OPC server which could be the same or different from the input server(no advanced authentication supported yet).

```
[output]
url             = "opc.tcp://opcua.demo-this.com:51210/UA/SampleServer"
failoverTimeout = 5000     # time to wait before reconnection in case of failure
```

Then, for each OPC value you want to log, repeat the following in the config file, d:

```
# A polled node:
[[measurements]]
collectionType = "polled"
pollRate = 30
nodeIn = "ns=2;i=10849"
nodeOut = "ns=37;i=10849"
deadbandAbsolute   = 0 		# Absolute max difference for a value not to be transferred
deadbandRelative   = 0    	# Relative max difference for a value not to be transferred

# A monitored node
#[[measurements]]
#nodeIn = "ns=2;s=10850"
#nodeOut = "ns=37;s=10850"
#collectionType     = "monitored"
#monitorResolution  = 2000    # ms
```

## Run

```
$ node bridge.js
```
