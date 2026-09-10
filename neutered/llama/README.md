# Vendored llama-server

`dsh-neutered` can run its own model server: the `llama-server` binary from an
official llama.cpp release, pinned by SHA-256, started and stopped by the
wrapper for each run. Nothing here reaches the network: the tarball is
downloaded once on a connected machine, and `install.sh` only verifies and
unpacks a local file.

## Install

1. Download the asset named in `VERSION` from the llama.cpp release page:
   `https://github.com/ggml-org/llama.cpp/releases/download/<tag>/<asset>`
   (with the current `VERSION`, `tag` is `b10798` and `asset` is
   `llama-b10798-bin-macos-arm64.tar.gz`, about 11 MB).
2. `bash neutered/llama/install.sh /path/to/llama-b10798-bin-macos-arm64.tar.gz`

The script refuses a tarball whose SHA-256 differs from `VERSION`, unpacks only
the files listed in `SHA256SUMS` into `bin/` (which git ignores), checks each of
them, and prints the server version. The wrapper repeats the `SHA256SUMS` check
before every start, so a modified or half-installed `bin/` never runs.

## What is kept

`llama-server` and the libraries it links through `@loader_path`: the server
implementation, `libllama`, `libllama-common`, `libmtmd`, and the ggml
backends (`base`, `cpu`, `blas`, `metal`, `rpc`), about 13 MB. The Metal
shader library is embedded in `libggml-metal`, so no extra files are needed.
`libggml-rpc` is present only because the binary links it; the wrapper refuses
the `--rpc` flag that would use it.

## How the wrapper runs it

```
llama-server --host 127.0.0.1 --port 1234 -m <model>.gguf -c <ctx> -ngl 99 \
  --jinja --alias local --no-webui --offline --sleep-idle-seconds <idle>
```

`--offline` disables llama.cpp's own model download path, `--no-webui` drops
the browser UI, `--jinja` applies the model's chat template so tool calls
work, and `--sleep-idle-seconds` unloads the weights and KV cache after that
many idle seconds and reloads them on the next request (`/health` keeps
answering 200 while the server sleeps). Extra flags pass through
`--server-arg`, except any that download (`-hf*`, `--model-url`,
`--docker-repo`), reach another machine (`--rpc`), change the bind
(`--host`, `--port`), switch to router mode (`--models-*`), or enable the
server's own UI, tools or MCP features.

## Updating the pin

Pick a release, download its macOS arm64 tarball, then:

```
shasum -a 256 llama-<tag>-bin-macos-arm64.tar.gz     # -> VERSION sha256=
tar -xzf llama-<tag>-bin-macos-arm64.tar.gz
cd llama-<tag> && shasum -a 256 llama-server LICENSE libllama-server-impl.dylib \
  libllama-common.0.*.dylib libllama-common.0.dylib libmtmd.0.*.dylib libmtmd.0.dylib \
  libllama.0.*.dylib libllama.0.dylib libggml*.0.*.dylib libggml*.0.dylib > SHA256SUMS
```

Check with `otool -L llama-server` that the linked library names have not
changed, update `VERSION`, replace `SHA256SUMS`, reinstall, and run
`bash neutered/bin/test/dsh-neutered.test.sh`.
