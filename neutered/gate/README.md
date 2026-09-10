# dsh-neutered egress gates

Two checks prove the artifact reaches nothing but `127.0.0.1:1234`.

## Static: `egress-grep.sh`

A mechanical, exit-code check that the source tree holds no off-machine
destination and no network primitive outside the four paths allowed to have
one (`neutered/guard/`, `neutered/gate/`, `neutered/setup/`,
`packages/llm/llm-local/`). `neutered/setup/` is excluded from both scans
because `dsh-neutered setup` downloads a model from `huggingface.co` and
installs llama.cpp through Homebrew; nothing on the task path loads it
(`neutered/setup/README.md`).

The release formula template and installed-release verifier are excluded by exact path because they name download URLs and rejected test connections. They are maintainer tools and are absent from the application archive; adjacent release code remains scanned.

```
bash neutered/gate/egress-grep.sh            # scan the shipped sources
bash neutered/gate/egress-grep.sh --closure  # also scan node_modules for destinations
bash neutered/gate/egress-grep.sh --json     # machine-readable
bash neutered/gate/test/egress-grep.test.sh  # the gate's own self-test
```

Exit 0 only when both counts are zero. The patterns live in
`forbidden-patterns.txt`; the current-tree baselines are `baseline-neutered.txt`
and `baseline-neutered-closure.txt`.

What it proves: no code in the box names a DeepSeek, telemetry, or third-party
AI endpoint, and every socket/DNS/HTTP/fetch primitive is confined to the guard,
this gate, or the loopback LLM adapter. What it does not prove: run-time
behaviour — that is the capture test below.

## Dynamic: `egress-capture.sh`

Runs a real `dsh-neutered` session and polls the whole process tree's network
peers with `lsof`. Passes only when every peer is `127.0.0.1:1234`.

```
bash neutered/gate/egress-capture.sh                          # a real PONG session
bash neutered/gate/egress-capture.sh --negative-control node  # must FAIL: a raw connect to 1.1.1.1
bash neutered/gate/egress-capture.sh --negative-control bash  # the bash tool runs curl 1.1.1.1
bash neutered/gate/egress-capture.sh --model <model>.gguf     # the session with the vendored llama-server
```

Exit 0 = PASS, 1 = FAIL, 2 = usage, 3 = INCONCLUSIVE. Each run writes a Markdown
report under `reports/`. With `--model` the wrapper starts the vendored
`llama-server` inside the watched tree; the connections it accepts from the
agent have the local end `127.0.0.1:1234` and are listed in the report as
served connections, not peers, because they are the permitted listener's own
side of the one allowed destination. The **node** control has no guard and deliberately
dials `1.1.1.1:80`; it must FAIL, which proves the capture can see a leak. The
**bash** control makes the model run `curl http://1.1.1.1` through the bash
tool; with the Seatbelt network-deny in place it PASSES with `CURL_RC=7`
(connection refused at the kernel), proving the bash sandbox layer, not just the
Node guard, contains a shell child.

What it proves: a live session, including a model-driven shell command, opens no
connection except to the local model. What it does not prove: a connection
shorter than the 0.25s poll interval could be missed; `tcpdump` with BPF access
or `pf` logging is the stronger proof and is noted in each report's Limitations.
