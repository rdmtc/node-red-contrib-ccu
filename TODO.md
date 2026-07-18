# node-red-contrib-ccu todo

* ~~supply config object to editors~~
* ~~implement rega polling and poll node~~
* ~~implement program node~~
* ~~implement program poll and node output~~
* ~~store sysvar types and enums~~
* ~~implement sysvar node~~
* ~~store paramset descriptions~~
* ~~extend msg with type and enums~~
* ~~implement value node~~
* ~~implement rpc node~~
* ~~rpc-event filters~~
* ~~discover ccu and interfaces~~
* ~~connect autocomplete~~
* ~~configurable init address~~
* ~~fix missing rooms/functions in msg~~
* ~~fix rpc event room/function filter~~
* ~~rpc ping~~
* ~~find free listening ports~~
* ~~topic placeholders~~
* ~~catch errors in unconfigured nodes~~ 
* ~~msg properties program and sysvar~~
* ~~submit node~~
* ~~submit type display~~ 
* ~~cast setValue~~
* ~~cast putParamset~~
* handle SPECIAL paramset key (Clarifiy: Which device uses that?! How to test?)
* documentation, i18n
* ~~node status~~
* global object
* value autocomplete / multiselect
* ~~rpc-event autocomplete / multiselect~~
* ~~rpc autocomplete / multiselect~~
* submit autocomplete
* submit limit list to 10 cmds
* fix submit display led
* submit display beep (?)
* submit payload via msg
* ~~processing working/direction datapoints~~

## Bugs

* with Node-RED 4.x users have to open nodes several times until
  interface/device/channel/datapoint selects are populated

## Infrastructure

* modernize tooling (tests, lint, code style) — see [AGENTS.md](AGENTS.md) for
  notes on the ptweety fork's tooling changes (c8, newer xo/eslint/mocha,
  build split) as reference
  * lint: replace `xo` with plain `eslint`
  * tests: adopt `jest`; evaluate modern alternatives to `mocha` (jest itself
    being one candidate) before committing to a replacement
* add GitHub Action for npm publishing via OIDC (trusted publishing, no
  long-lived npm token)

## Issues imported from GitHub tracker (unprioritized)

Imported from https://github.com/rdmtc/node-red-contrib-ccu/issues on
2026-07-16 (60 open issues at the time). Priorities to be assigned later.

* [#22](https://github.com/rdmtc/node-red-contrib-ccu/issues/22) MQTT Node: No GUI for node-input-topicInputRpc
* [#27](https://github.com/rdmtc/node-red-contrib-ccu/issues/27) Anpassungen an CCU Firmware >= 3.41
* [#39](https://github.com/rdmtc/node-red-contrib-ccu/issues/39) topic handling vereinheitlichen
* [#44](https://github.com/rdmtc/node-red-contrib-ccu/issues/44) Configuration Option to deactivate Ping Checks
* [#51](https://github.com/rdmtc/node-red-contrib-ccu/issues/51) switch node casts boolean payloads to numbers
* [#52](https://github.com/rdmtc/node-red-contrib-ccu/issues/52) RPC Event: Zeitpunkt des letzten Events und ggf. letztes Topic
* [#54](https://github.com/rdmtc/node-red-contrib-ccu/issues/54) ccu-sysvar node: aktueller Status und ggf. Zeitpunkt von wann der Status stammt unter dem node
* [#56](https://github.com/rdmtc/node-red-contrib-ccu/issues/56) make property for sysvar-node configurable
* [#58](https://github.com/rdmtc/node-red-contrib-ccu/issues/58) Hilfe Texte
* [#71](https://github.com/rdmtc/node-red-contrib-ccu/issues/71) Set value node: allow to set filter properties with incoming msg
* [#80](https://github.com/rdmtc/node-red-contrib-ccu/issues/80) Signal Node: allow to overwrite settings via msg/context/env
* [#81](https://github.com/rdmtc/node-red-contrib-ccu/issues/81) increase test coverage
* [#87](https://github.com/rdmtc/node-red-contrib-ccu/issues/87) Changelog
* [#96](https://github.com/rdmtc/node-red-contrib-ccu/issues/96) uncertain Flag das gesetzt wird wenn Rega Zeitstempel 1970-01-01 01:00:00 zurückgibt
* [#103](https://github.com/rdmtc/node-red-contrib-ccu/issues/103) switch node params via msg
* [#105](https://github.com/rdmtc/node-red-contrib-ccu/issues/105) ccu-value Node: Weiterbenutzung des Input-msg-Objects, statt Neuinstaziierung
* [#106](https://github.com/rdmtc/node-red-contrib-ccu/issues/106) Statusänderung eines Kanals wird nicht übermittelt
* [#110](https://github.com/rdmtc/node-red-contrib-ccu/issues/110) Node-RED: v1.0.4 & CCU3-3.51.6 / Error: getaddrinfo ENOTFOUND
* [#111](https://github.com/rdmtc/node-red-contrib-ccu/issues/111) ON_TIME wird nicht initial befüllt
* [#112](https://github.com/rdmtc/node-red-contrib-ccu/issues/112) Nur drei Heizungsprofile verfügbar (# 4-6 stehen nicht zur Auswahl)
* [#114](https://github.com/rdmtc/node-red-contrib-ccu/issues/114) Possible to use "localfilesystem" for Context Store
* [#115](https://github.com/rdmtc/node-red-contrib-ccu/issues/115) add get/update method to mqtt node
* [#116](https://github.com/rdmtc/node-red-contrib-ccu/issues/116) Google Home Anbindung: State von CCU wird nicht zurück an Google Home übermittelt / CCU state not reflected in Google Home App
* [#117](https://github.com/rdmtc/node-red-contrib-ccu/issues/117) Einbinden HmIP-FCI6
* [#119](https://github.com/rdmtc/node-red-contrib-ccu/issues/119) HmIP-BROLL wird nicht gefunden
* [#121](https://github.com/rdmtc/node-red-contrib-ccu/issues/121) rpc-event STICKY_UNREACH
* [#124](https://github.com/rdmtc/node-red-contrib-ccu/issues/124) poll variable description
* [#126](https://github.com/rdmtc/node-red-contrib-ccu/issues/126) Context store property name dot replacement
* [#128](https://github.com/rdmtc/node-red-contrib-ccu/issues/128) CCU Switch node - wrong resize in settings dialog
* [#129](https://github.com/rdmtc/node-red-contrib-ccu/issues/129) ccu-get-value node: bei einer Werteliste wird nur der value zurückgegeben
* [#132](https://github.com/rdmtc/node-red-contrib-ccu/issues/132) Ports
* [#133](https://github.com/rdmtc/node-red-contrib-ccu/issues/133) ccu-set-value "remembers" previous events
* [#136](https://github.com/rdmtc/node-red-contrib-ccu/issues/136) HmIP-FBL
* [#138](https://github.com/rdmtc/node-red-contrib-ccu/issues/138) Failed at the grpc@1.19.0 install script
* [#139](https://github.com/rdmtc/node-red-contrib-ccu/issues/139) CCU Node error message in the log (IoBroker)
* [#140](https://github.com/rdmtc/node-red-contrib-ccu/issues/140) "Error: unknown datapoint BidCos-RF.OEQxxxxxxx:1.STATE"
* [#143](https://github.com/rdmtc/node-red-contrib-ccu/issues/143) Ich bekomme mit get-value nur Fehlermeldungen und keinen Status
* [#144](https://github.com/rdmtc/node-red-contrib-ccu/issues/144) Signal Node: Integration of HmIP-WRCD
* [#145](https://github.com/rdmtc/node-red-contrib-ccu/issues/145) CCU value Node CUX16 no Output
* [#146](https://github.com/rdmtc/node-red-contrib-ccu/issues/146) CCU different / changing Nodes with "unknown Datapoint"
* [#148](https://github.com/rdmtc/node-red-contrib-ccu/issues/148) Signal Node: HmIP-MP3P Dynamisches Setzen von SOUNDFILE_LIST
* [#149](https://github.com/rdmtc/node-red-contrib-ccu/issues/149) XML-RPC fault mit falscher value?
* [#151](https://github.com/rdmtc/node-red-contrib-ccu/issues/151) FROLL / Nodered Problem (Cache geht nicht mit allen Geräten die 2 Kanäle für Soll / Ist haben und per Hand bedient werden)
* [#154](https://github.com/rdmtc/node-red-contrib-ccu/issues/154) HmIP-BBL datapoint LEVEL_2 cannot be set
* [#155](https://github.com/rdmtc/node-red-contrib-ccu/issues/155) Error: Local address XXX not available. Using YYY instead.
* [#156](https://github.com/rdmtc/node-red-contrib-ccu/issues/156) Set PARTY_TIME_START and PARTY_TIME_END not working
* [#158](https://github.com/rdmtc/node-red-contrib-ccu/issues/158) using in SubFlows
* [#159](https://github.com/rdmtc/node-red-contrib-ccu/issues/159) Fehlender CuxD datapoint "DIR"
* [#160](https://github.com/rdmtc/node-red-contrib-ccu/issues/160) Node-Red Absturz bei Verbindungsverlust zur CCU
* [#161](https://github.com/rdmtc/node-red-contrib-ccu/issues/161) Feature Request: Node "Party Mode"
* [#164](https://github.com/rdmtc/node-red-contrib-ccu/issues/164) Support CCU-Jack
* [#166](https://github.com/rdmtc/node-red-contrib-ccu/issues/166) Mehrere Variablen sofort schreiben und triggern
* [#167](https://github.com/rdmtc/node-red-contrib-ccu/issues/167) updated function values in ccu and functions in ccu-mqtt node
* [#169](https://github.com/rdmtc/node-red-contrib-ccu/issues/169) "Error: XML-RPC fault: Generic error (UNREACH)"
* [#170](https://github.com/rdmtc/node-red-contrib-ccu/issues/170) Auslesen System-Variable
* [#172](https://github.com/rdmtc/node-red-contrib-ccu/issues/172) Configure CCU-Value through message
* [#175](https://github.com/rdmtc/node-red-contrib-ccu/issues/175) HmIP-DRBLI4 Level_2 not working
* [#176](https://github.com/rdmtc/node-red-contrib-ccu/issues/176) Deprecated dependencies
* [#177](https://github.com/rdmtc/node-red-contrib-ccu/issues/177) HmIP-BSL 2.0.2 & Signal Node: Color Behaviour missing
* [#178](https://github.com/rdmtc/node-red-contrib-ccu/issues/178) HmIP-SWDO visible in device list but HmIP-SWDO-PL-2 not
