# node-red-contrib-ccu

[![NPM version](https://badge.fury.io/js/node-red-contrib-ccu.svg)](http://badge.fury.io/js/node-red-contrib-ccu)
[![Dependencies Status](https://david-dm.org/hobbyquaker/node-red-contrib-ccu/status.svg)](https://david-dm.org/hobbyquaker/node-red-contrib-ccu)
[![Build Status](https://travis-ci.org/hobbyquaker/node-red-contrib-ccu.svg?branch=master)](https://travis-ci.org/hobbyquaker/node-red-contrib-ccu)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License][mit-badge]][mit-url]

> Node-RED Nodes for the Homematic CCU

With these Nodes you can connect [Homematic](https://github.com/hobbyquaker/awesome-homematic) and 
[Node-RED](https://nodered.org/). Homematic is a series of smart home automation hardware from the manufacturer 
[eQ-3](http://www.eq-3.de/), popular especially in Germany.

For the communication with the CCU both RPC and ReGaHSS remote script are used. It's possible to connect to multiple 
CCUs from one Node-RED instance. RPC setValue calls can be comfortably complemented with ON_TIME and RAMP_TIME values
and special nodes ease the control of displays and mp3 actuators. RPC events can be filtered comprehensively (even 
through regular expressions and also by rooms and functions). It's possible to start rega-programs and set 
rega-variables and last but not least there are nodes to execute arbitrary rega-scripts and RPC calls.

These nodes are included in [RedMatic](https://github.com/hobbyquaker/RedMatic) which ships Node-RED as an addon package 
for installation on a Homematic CCU3 or RaspberryMatic.

Some example flows can be found in the [RedMatic Wiki](https://github.com/hobbyquaker/RedMatic/wiki/Flows) (German language).


## License

MIT (c) Sebastian Raff

[mit-badge]: https://img.shields.io/badge/License-MIT-blue.svg?style=flat
[mit-url]: LICENSE
