# Evo Cloud Network Infrastructure

## Overview

The self-managed network infrastructure for Evo Cloud.

## Install

```bash
npm install evo-neuron
```

## How to Use

The following configuration properties are required:
- `address`: the IP address used to identify this node;
- `port`: the port this node used to for communication.

If there's bootstraps, set `bootstraps` as an array of bootstrap URLs.

Example:

```bash
node neuron.js --address 192.168.100.101 --port 680
```

As no `bootstraps` is specified, the command above will start the node in master mode.

```bash
node neuron.js --address 192.168.100.102 --port 680 --bootstraps 'json:["http://192.168.100.102:680"]'
```

With `bootstraps` specified, the node will try to join the network.

## License

MIT/X11 License
