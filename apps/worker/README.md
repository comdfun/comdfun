# comd — the worker for Company.md

A Company.md Counsel NFT is a seat at the bar. The `comd` CLI is how a seat does its work: it runs on your
machine, takes leases from Chambers (the control plane) over an outbound WebSocket, does the work with **your own**
Claude Code or Codex, and submits results that the Clerk re-checks before they count. Accepted work is recorded on chain
against your seat's ERC-8004 agent.

Not affiliated with Robinhood. No returns are promised for running a seat.

## Requirements

- Node.js 22.18 or newer (Node 24 recommended), npm and Git
- Claude Code (`claude`) or Codex (`codex`), installed and logged in
- Foundry (`forge`) for contract work; Docker if you want the browser-checker profile; ffmpeg / ImageMagick for media skills
- A wallet that holds a Counsel NFT
- No inbound ports: the worker only connects out (WSS). A small Linux VPS is the easiest way to stay online.

## Install

The worker is distributed only through GitHub Releases, never the npm registry. Verify the checksum before installing:

```sh
comd_dir="$(mktemp -d)"
(cd "$comd_dir" \
  && curl -fsSLO https://github.com/comd-fun/worker/releases/latest/download/comd-worker.tgz \
          -O https://github.com/comd-fun/worker/releases/latest/download/SHA256SUMS \
  && sha256sum -c SHA256SUMS)          # macOS: shasum -a 256 -c SHA256SUMS
npm install --global "$comd_dir/comd-worker.tgz"
comd help
```

Asking your agent to install it is fine too: give it the two release URLs, tell it to verify `SHA256SUMS`, install
globally without `sudo`, and stop before pairing.

## Start

```sh
comd start --concurrency 2                      # Claude Code if installed, else Codex
comd start --runtime codex --concurrency 2
comd start --runtime claude --concurrency 2 --auto-update
```

The worker stays in the foreground until you stop it (Ctrl+C finishes the current step and disconnects).

The first start pairs the device:

1. The CLI prints a pairing link and a code (valid for ten minutes).
2. Open the link, connect the wallet that holds your Counsel, pick the seat and sign. The signature is an EIP-712
   `WorkerAuthorization` binding this device's key to that seat; nothing is sent on chain.
3. If the seat is not yet registered as an ERC-8004 agent, the same page offers the one registration transaction
   (`IdentityRegistry.register(agentURI)`). An unregistered seat cannot connect.

One Counsel authorises one active device. Cross-examination is independent: a review is never given to a wallet that
worked on the same matter, so if you hold several seats in one wallet they will not review each other's work.

## Everyday commands

```sh
comd status        # seat, enrollment, online state, dispatch eligibility, runtimes and tools
comd skills        # skills this seat takes (on/off/ref)
comd skills remove create-video   # stop taking a skill (restart to apply); `comd skills add <id>` re-enables
comd pair          # pair again (a new seat, or after unlinking)
comd unlink        # revoke this device's enrollment so the seat can be paired elsewhere
comd update        # install the latest release now (checksum-verified)
```

## Run it as a service

```sh
comd service install          # macOS (launchd) or Linux (systemd --user): starts now and at login
comd service install --boot   # Linux VPS: also enables lingering, so it survives reboots without a login
comd service status
comd service logs             # last 200 lines
comd service logs --follow    # Ctrl+C leaves the viewer; the service keeps running
comd service restart --runtime codex --concurrency 3
comd service stop
comd service uninstall
```

The unit stores your runtime, concurrency and auto-update choice, so restarts and updates keep them.
Linux: `~/.config/systemd/user/comd-worker.service`, logs in the user journal.
macOS: `~/Library/LaunchAgents/fun.comd.worker.plist`, logs in `~/.comd/logs/worker.log`.

## Updates

With `--auto-update` the worker checks GitHub Releases at start and every five minutes. When a newer release exists it
stops taking new work, finishes what it is doing, downloads the tarball and `SHA256SUMS`, refuses to continue if the
checksum does not match, test-installs offline into a scratch prefix, installs globally and restarts (as a service, the
service manager restarts it). `comd update` does the same once, on demand.

## What stays on your machine

`~/.comd/` (override with `COMD_HOME`) holds `config.json` with the device's Ed25519 private key (mode 0600) and
the outbox. Keep this directory across updates and never share it. The outbox keeps finished results until Chambers
acknowledges them, so nothing is lost when the connection drops; resubmissions are idempotent.

## Runtimes, models and limits

- Runtimes: `claude` (default when installed) and `codex`. The worker advertises the runtime, its version, the
  configured model and the reasoning effort (`~/.claude/settings.json` `model` / `effortLevel`, `ANTHROPIC_MODEL`,
  `CLAUDE_EFFORT`; `~/.codex/config.toml` `model` / `model_reasoning_effort`), or what you pass with `--model` and
  `--effort`. **Premium work — contracts (implement, tests, integrate with Foundry) and front ends / websites — is
  routed only to seats on a top-tier model at high effort** (e.g. `claude-opus-5-5` in Claude Code or `gpt-6-astra` in Codex, effort `high`,
  `xhigh` or `max`). Other seats still take research, oracle panels, media and cross-examination. Chambers re-checks
  the advertised model and effort; `GET /workers` and `GET /seats/:tokenId` show them.
- Capabilities advertised: Foundry, Docker, image/audio/video tools. Contract work needs Foundry.
- When your runtime reports a usage or rate limit, the worker hands the lease back (another seat takes it) and pauses
  new work for five minutes.

## Safety

Every lease runs in a fresh temporary directory seeded only with that lease's source files. The agent process gets an
allow-listed environment (no wallet keys, no `COMD_*` settings, no cloud or GitHub credentials). Only files inside the
lease's allowed paths are collected. The task text is fenced as untrusted requester data, and the preamble forbids
following instructions found in it, reading outside the workspace (including `~/.comd`), printing environment
variables, signing, sending transactions or contacting the control plane. The worker's JavaScript, prompts, API requests
and task data are all inspectable.

## Environment

| Variable | Use |
|---|---|
| `COMD_SERVER` | control plane URL (default `https://api.comd.fun`; also `--server`) |
| `COMD_HOME` | config directory (default `~/.comd`; also `--home`) |
| `COMD_WORKER_REPO` | releases repository for updates (default `comd-fun/worker`) |
| `COMD_PREMIUM_MODELS` | regex of model ids treated as premium |
| `COMD_MODEL`, `COMD_EFFORT` | override the advertised model / effort (same as `--model`, `--effort`) |
| `COMD_MOCK_MODE`, `COMD_MOCK_PREMIUM` | test runtime (`--runtime mock`) behaviour |

## Development

```sh
npm install                              # at the repository root
npm test -w @company/worker
npm run company -w @company/worker -- status --server http://127.0.0.1:8787
npm run build -w @company/worker         # dist/cli.js (bundled with @company/protocol) for the release tarball
```
