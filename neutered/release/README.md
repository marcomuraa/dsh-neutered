# Prepare a Homebrew release

Build a macOS arm64 application archive and a Homebrew formula for a repository you control. Packaging does not create a tag, upload files, or publish a tap. The generated formula uses the release tag `v<VERSION>` and the exact archive SHA-256.

## Build and verify

Use an Apple Silicon Mac with the repository's supported Node.js and pnpm versions. Install dependencies and build before packing:

```sh
pnpm install --frozen-lockfile
pnpm run build
```

Download the llama.cpp asset identified by [VERSION](../llama/VERSION). The packer invokes the [server installer](../llama/install.sh), which verifies the archive and extracted files against the committed checksums. For the current pin:

```sh
curl -fL --retry 2 -o /tmp/llama-b10798-bin-macos-arm64.tar.gz https://github.com/ggml-org/llama.cpp/releases/download/b10798/llama-b10798-bin-macos-arm64.tar.gz
node neutered/release/pack.cjs --version 0.1.0-alpha.1 --repository marcomuraa/dsh-neutered --llama-archive /tmp/llama-b10798-bin-macos-arm64.tar.gz
```

Use a new version for each release. Output defaults to `.artifacts/homebrew/<VERSION>/`; `--output DIRECTORY` chooses another destination, which must not exist. The directory contains the application archive, `SHA256SUMS`, and `dsh-neutered.rb`.

The packer verifies both shipped profiles, blocked network egress, model-server checksums, and native PTY execution with a temporary Harness home. It rejects dangling symlinks and links outside the archive. To repeat those checks after extraction:

```sh
tar -xzf .artifacts/homebrew/0.1.0-alpha.1/dsh-neutered-0.1.0-alpha.1-darwin-arm64.tar.gz -C /tmp
node neutered/release/verify.cjs /tmp/dsh-neutered-0.1.0-alpha.1-darwin-arm64
```

These checks need no model download. They do not prove model inference; run a task against a local model before publishing a release intended for users.

## Installation contents

Homebrew installs the runtime and pinned llama-server under its versioned `libexec` directory and exposes `dsh-neutered` on PATH. Node comes from Homebrew. The formula preserves the server's bytes so the launcher's checksum checks remain valid. Intel Macs and Linux are outside this release target.

Run `dsh-neutered setup` after installation to select a model. The launcher puts its pinned server on PATH for setup, so setup does not install a second llama.cpp. Models and settings live under `~/.dsh`, or `DSH_HOME` when set, outside the Homebrew installation.

## Publish the prepared files

Create the versioned GitHub release in the repository passed to the packer and attach the archive and `SHA256SUMS`. Put the generated formula in `Formula/dsh-neutered.rb` in a Homebrew tap, then install and run `brew test` against that tap. See [Homebrew's tap guide](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).

Publish the exact verified archive: rebuilding changes its SHA-256 and requires a newly generated formula. `release.json` records the source revision, whether the source checkout contains uncommitted work, and the Node version used to prepare it. Development artifacts can record a dirty checkout; public release artifacts must be prepared from the committed release source.

## Maintainer details

The packer copies the workspace to a temporary directory, changes local `link:` overrides to deployable `file:` dependencies there, and supplies required workspace peers to the CLI installation. [pnpm deploy](https://pnpm.io/cli/deploy) copies production dependencies and each package's declared files. Package names inside the archive retain their upstream scope without publishing anything to npm.

Deployment disables install scripts. The runtime uses dependency-provided native prebuilds, and the subprocess package's existing helper restores node-pty's executable bit. Installed-artifact checks exercise that result. The temporary workspace is removed on success or failure.
