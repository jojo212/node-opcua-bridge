"use strict"

var async = require("async");
let readpump = require("./readpump.js");
var writepump = require("./writepump.js");
var toml = require("toml");
const EventEmitter = require('events');

var config = loadConfig();

// get write 
let wp = new writepump(config.output, config.measurements);

// get a readpump
var rp = new readpump(config.input, config.measurements);

async.forever(
    function (forever_next) {
        rp.Run(function (err) {
            console.log("An error occured in the Readpump:", err)
            let wait = config.failoverTimeout || 5000;
            console.log("Restarting readpump in", wait, "seconds.")
            setTimeout(forever_next, wait)
        });
    },
	function (err) {
        console.log("Restarting readpump...");
    }
);

async.forever(
    function (forever_next) {
        wp.Run(function (err) {
            console.log("An error occured in the Writepump:", err)
            let wait = config.failoverTimeout || 5000;
            console.log("Restarting Writepump in", wait, "seconds.")
            setTimeout(forever_next, wait)
        });
    },
	function (err) {
        console.log("Restarting writepump...");
    }
);

function loadConfig() {
    var path = require("path").resolve(__dirname, 'config.toml');
    var text = require("fs").readFileSync(path, "utf8");
    let tom = toml.parse(text);
    tom.measurements.forEach(function (p, i){
        p.changeEmitter = new EventEmitter();
    })
    return tom;
}
