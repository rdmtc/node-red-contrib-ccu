/* global describe, it, after, before, afterEach */
/* eslint-disable no-template-curly-in-string, no-undef, no-unused-vars, unicorn/filename-case */

const fs = require('fs');
const path = require('path');
const should = require('should');
const helper = require('node-red-node-test-helper');
const HmSim = require('hm-simulator/sim');

const nodeMqtt = require('../nodes/ccu-mqtt.js');
const nodeConnection = require('../nodes/ccu-connection.js');
const {removeFiles} = require('./utils');

helper.init(require.resolve('node-red'));
