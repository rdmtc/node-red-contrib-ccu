# node-red-contrib-ccu

[![NPM version](https://badge.fury.io/js/node-red-contrib-ccu.svg)](http://badge.fury.io/js/node-red-contrib-ccu)
[![Dependency Status](https://img.shields.io/gemnasium/hobbyquaker/node-red-contrib-ccu.svg?maxAge=2592000)](https://gemnasium.com/github.com/hobbyquaker/node-red-contrib-ccu)
[![Build Status](https://travis-ci.org/hobbyquaker/node-red-contrib-ccu.svg?branch=master)](https://travis-ci.org/hobbyquaker/node-red-contrib-ccu)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License][mit-badge]][mit-url]

> Node-RED Nodes for the Homematic CCU

__Work in Progress__ Not yet finished, possibly many Bugs, documentation incomplete, ...

With these Nodes you can connect Homematic and [Node-RED](https://nodered.org/). 
[Homematic](https://github.com/hobbyquaker/awesome-homematic) is a series of smart home automation hardware from the 
manufacturer [eQ-3](http://www.eq-3.de/), popular especially in Germany.

For the communication with the CCU both RPC and ReGaHSS remote script are used. It's possible to connect to multiple CCUs from one Node-RED instance.

These nodes are included in [ccu-addon-node-red](https://github.com/hobbyquaker/ccu-addon-node-red) which installs 
Node-RED as an addon on a Homematic CCU3 or RaspberryMatic.

Some example flows can be found in the [ccu-addon-node-red wiki](https://github.com/hobbyquaker/ccu-addon-node-red/wiki/Flows) (German language).


## License

MIT (c) Sebastian Raff

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
