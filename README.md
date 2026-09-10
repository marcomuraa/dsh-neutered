# dsh-neutered

Run a coding agent against a local OpenAI-compatible model server at `http://127.0.0.1:1234/v1`. This macOS fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) removes the remote integrations described in the [fork reference](neutered/README.md).

The launcher loads a Node network guard, and macOS Seatbelt restricts network access for shell-tool children. These protections cover specific APIs and processes; they do not guarantee complete network isolation. Read the [guard's limits](neutered/guard/README.md#known-limits) before relying on them.

## Quick start

Use macOS with Node.js `^22.19.0 || >=24.0.0` and Homebrew. Apple Silicon is recommended. Setup needs internet access to install dependencies and download a model.

```sh
git clone https://github.com/marcomuraa/dsh-neutered.git
cd dsh-neutered
bash neutered/bin/install
```

Setup detects your machine's memory, asks you to choose a model, downloads it into `~/.dsh/neutered/models/`, and selects a context window. It also installs Homebrew's llama.cpp. The launcher uses a separate pinned server build, which you must install from a tarball following the [llama-server instructions](neutered/llama/README.md).

```sh
bash neutered/llama/install.sh /path/to/llama-b10798-bin-macos-arm64.tar.gz
neutered/bin/dsh-neutered -- "run the tests and fix the first failure"
```

Alternatively, start your own OpenAI-compatible server on port 1234. The launcher reuses an existing listener without verifying its implementation or whether it forwards requests elsewhere.

Each run starts the pinned server when nothing is listening and stops it afterward. Pass `--keep-server` to leave it running. With no task text and a terminal on stdin, the launcher opens the REPL.

```sh
neutered/bin/dsh-neutered settings
neutered/bin/dsh-neutered settings --model <id>
neutered/bin/dsh-neutered settings --context 65536
neutered/bin/dsh-neutered -h
```

## Choosing a model

Setup lists models that fit the detected memory and puts its recommendation first. Model sizes and context limits live in the [catalog](neutered/setup/catalog.json). Setup also accepts a Hugging Face `owner/repo:file.gguf` identifier or a local `.gguf` path. See the [setup reference](neutered/setup/README.md) for sizing and configuration.

## Repository layout

The fork's launch and setup code lives in `neutered/`. Shared agent code remains in the upstream workspace structure.

| Path | Contents |
|---|---|
| [neutered/](neutered/README.md) | Launcher, model setup, network guard, and fork documentation |
| [apps/cli/](apps/cli/README.md) | CLI source and profiles |
| [packages/](packages/README.md) | Shared agent plugins and services |
| [docs/](docs/architecture.md) | Inherited architecture and contributor references |
| [scripts/](scripts/) | Build tools and repository checks |
| [vendor/](vendor/README.md) | Pinned framework source |
| [native/](native/README.md) | Native sandbox support |

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for development. [Repository maintenance](neutered/docs/maintenance.md) explains generated files, audit records, and the fork's CI.

## Homebrew releases

The [release guide](neutered/release/README.md) prepares an Apple Silicon application archive and a Homebrew formula with its SHA-256. The archive includes the pinned model server; models are downloaded separately during setup. Homebrew publication requires uploading the verified archive and adding the generated formula to a tap.

## Safety and licence

Read [SAFETY.md](SAFETY.md) before running an autonomous agent on your files. This fork retains upstream's [MIT licence](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
