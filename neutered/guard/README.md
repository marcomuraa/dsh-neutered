# dsh-neutered runtime egress guard

The [dsh-neutered wrapper](../bin/dsh-neutered) loads [loopback-only.cjs](loopback-only.cjs) before starting the harness. The guard intercepts selected Node networking APIs and checks where each call tries to connect. Calls through those APIs can reach the local model server. Other destinations fail.

The preload can also be supplied explicitly:

```
NODE_OPTIONS="--require=/abs/path/to/neutered/guard/loopback-only.cjs" node …
```

Starting the underlying CLI directly does not automatically attach this guard. Both launch paths use the same fork source. Skipping the wrapper does not restore deleted integrations. Children and workers retain the guard only when their launch options preserve the preload.

## What it does

For the APIs it wraps, the guard permits TCP connections only to `127.0.0.1:1234`, the local model server. A rejected call throws or rejects with an `EGRESS_BLOCKED` error. Callback DNS calls receive that error through their callback.

The guard wraps these APIs:

- `net.Socket.prototype.connect` and `tls.connect`. Both use the same host and port restriction.
- `http`/`https` request and get, and `globalThis.fetch`. Fetch also requires plain HTTP.
- `dgram` send and connect. Both operations are blocked.
- The DNS methods listed in `DNS_METHODS` in the implementation, including their callback, promise and Resolver variants. Those methods reject all resolution attempts, including `localhost`.

Unix domain sockets are allowed. A local process listening on one could relay data elsewhere. The guard opens no socket of its own.

## Matching is exact

Socket destination checks accept only the string `127.0.0.1` with port `1234`. `localhost`, `::1`, `::ffff:127.0.0.1`, other `127.x.x.x` addresses and `0.0.0.0` fail that check. URL-based calls are parsed before comparison, so URL normalization can produce the accepted address. The allowed destination has no configuration or environment override.

## Logging

The first block for each destination/API combination attempts to write one line to stderr and append the same line, with an ISO timestamp, to `$DSH_HOME/egress-blocked.log`. Without `DSH_HOME`, the file is `~/.dsh/egress-blocked.log`. Logging failures never mask the block.

## Known limits

The guard does not intercept every networking API. DNS methods absent from `DNS_METHODS`, including `resolveCaa`, `resolveNaptr` and `resolveSoa`, are not wrapped. Native code, pre-existing network handles and deliberate replacement of the JavaScript wrappers are not covered by this mechanism.

Workers can start without the guard. The [workflow worker launcher](../../packages/workflow/workflow-worker-thread/src/host.ts), for example, clears its worker environment and `execArgv`. Loading the guard in the parent does not establish coverage of that worker. The preload also does not isolate arbitrary plugin or configuration code.

Non-Node children such as curl, git and Python require separate OS restrictions. The [macOS Seatbelt profile](../../packages/sandbox/sandbox-local/src/profiles.ts) restricts networking for shell children it wraps. This does not establish equivalent enforcement on other platforms or cover the native model server. An existing model-port listener is trusted and may itself have external network access.

These exclusions describe what the guard cannot guarantee. They do not demonstrate external traffic from those paths. The tests below check specific behavior and do not prove complete application isolation.

## Test

```
node --test 'neutered/guard/test/**/*.test.cjs'
```
