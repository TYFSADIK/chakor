# Changelog

## Unreleased

Image generation on your own GPU, powered by stable-diffusion.cpp.

- New Create image pill in the composer (or just write "draw a …" — natural
  prompts are detected automatically). The picture renders inline in the
  chat, is saved into the conversation's workspace for download, and shows
  up on shared conversation pages.
- Backend is stable-diffusion.cpp's `sd-server` (SDCPP_URL/SDCPP_DIR), which
  Chakor spawns on demand — no separate service to run. The default model is
  an Iris-architecture pixel-space DiT GGUF (Sakura-Iris-3B) with a Qwen3-VL
  text encoder; ComfyUI cannot run this architecture, so Chakor talks to
  sd-server's job API directly. Requests use the Iris-recommended sampling
  (dpm++2m, CFG 3, ≤1024², dimensions rounded to multiples of 16).
- Swap vs. parallel GPU scheduling (IMAGE_ENGINE_MODE=auto|swap|parallel):
  on cards under 12 GB VRAM the chat model is stopped while an image renders
  and brought back afterwards; with 12+ GB VRAM (or 32+ GB unified memory)
  both stay resident. Any GPU can attempt generation — small cards are slow
  (minutes per image), not disqualified.
- Admins manage it from a new Image Generation section in the admin panel:
  enable/disable, per-user allowlist (admins are always allowed, off by
  default), engine status and mode, and the installed diffusion-model GGUFs
  with set-active and delete (no download pipeline — drop .gguf files into
  the models folder).
- Generation runs in the background with progress in the bubble; the stop
  button cancels the sd-server job. The Create image pill is one-shot — it
  resets after each send so a follow-up question lands in chat instead of
  becoming another render. Error text shown to non-admins never leaks model
  file names or server paths.
- Slow-render proof: jobs run to completion no matter how long they take
  (hard cap IMAGE_JOB_TIMEOUT_MINUTES, default 45; a no-progress watchdog
  applies only when the engine actually reports step progress), and closing
  or refreshing the tab never kills a render — the result is persisted and
  waiting when you come back.
- Quality presets (Admin → Image Generation): fast (512²/12 steps),
  balanced (768²/20), quality (1024²/30, the default). While a render runs,
  the composer shows a live elapsed/remaining timer driven by a
  hardware-aware estimate.
- Response style preset (Admin → Model Behavior): concise, balanced
  (default), or detailed — applied server-wide to every chat's system
  prompt, alongside the existing free-form custom instructions.
- Per-user rate limit of 10 images per day (IMAGE_DAILY_LIMIT), persisted in
  the database. Admins are never limited — they run the hardware.
- Workspace file downloads now serve images inline (and to share-link
  viewers) so generated pictures render instead of downloading.

## 2.7.1

Hardening and polish across the board: a tighter sandbox, more reliable
models, a calmer UI, and the app now presents itself properly to search
engines and home screens.

Security
- Agent sandbox: the Python runner now gets an isolated environment (scrubbed
  env vars, isolated cwd/HOME, no inherited credentials) in addition to the
  existing CPU, memory, and path containment.
- SSRF protection now resolves DNS and checks the resulting addresses, so a
  public hostname that resolves to a private or link-local IP is blocked the
  same as a literal one. Redirect hops stay re-validated.
- Changing your password invalidates your other sessions immediately.
- Shared conversations can be unshared: revoking the link really revokes it.
- Input caps tightened on chat and API endpoints; oversized payloads are
  rejected before work starts.

Model reliability
- The default local model is picked hardware-aware: Chakor chooses the best
  model that actually fits your RAM/VRAM instead of blindly grabbing the
  largest file.
- Hugging Face downloads verify integrity with sha256 before a model is
  marked ready, so a truncated or corrupted file can never half-load.
- Crash diagnostics say what actually happened (OOM, missing file, bad
  flags) instead of the generic "model too large" guess.
- Vision projectors are paired by filename stem, so the right mmproj lands
  with the right model even in crowded folders.
- Vision support for gemma-4 and qwen-vl family models.

UI and UX
- The agent now has a stop button: halt a runaway workspace run mid-step.
- Message actions (copy, retry, delete) are reachable on mobile, not just
  on hover.
- Shared conversation pages render with the same theme and markdown parity
  as the in-app view.
- Accessibility pass: labels, focus handling, keyboard-reachable controls.
- Admin panel overhaul: cleaner user management, clearer stats.

SEO and PWA
- Full metadata: Open Graph and Twitter cards with a generated social image,
  JSON-LD SoftwareApplication schema, canonical URLs, sitemap.xml and
  robots.txt routes, and a proper web app manifest for install-to-homescreen.

Installers and Docker
- install.sh, setup.sh, install.ps1, and the Docker image now set up the
  Python environment the Agent Workspace needs (venv with python-docx,
  python-pptx, matplotlib, pandas, numpy, openpyxl, Pillow), so the agent
  tools work out of the box.

## 2.7

Agent Workspace: the assistant can now create real files in a sandboxed
workspace.

Agent loop
- New ReAct agent (`lib/agent-executor.ts`) with a 15-step tool loop: the
  model emits XML tool calls, results stream back as observations, and the
  final answer lands in the chat as a normal assistant message.
- Tool-call parser tolerates small-model output quirks (missing tags, raw
  JSON forms, truncated or trailing-comma JSON) and asks the agent to retry
  with a concrete example when a call is unrecoverable.
- Tools (`lib/workspace-tools.ts`, zod-validated): write_file, read_file,
  execute_python, list_files, web_search (existing SearXNG), generate_docx
  and generate_pptx (python-docx / python-pptx from the project venv).

Sandbox and security
- Python runs only through `scripts/sandbox-runner.py`: subprocess with
  30-second CPU/wall timeout, 512MB address-space limit, isolated cwd/HOME,
  no bytecode writes. NPROC limit scales from current thread count so BLAS
  thread pools do not break under a fixed cap.
- Every file path resolves against `data/workspaces/{conversationId}` and
  escapes are rejected, in tools and in the API routes.
- All new routes require a session and verify conversation ownership;
  download/delete reject names with slashes or leading dots; 50MB download
  cap; 10MB per file and 100 files per workspace in tools.

UI
- New `AgentWorkspace` panel beside the chat (bottom sheet on mobile):
  Agent Mode toggle, live activity log with plain-language steps, file list
  with download/delete, collapsible to a rail, state persisted.
- Chat input routes to the agent while Agent Mode is on; the placeholder
  changes to "Tell the agent what to create...".

Notes
- Agent chat turns are not persisted to the database; files in the workspace
  persist until deleted.
- Python dependencies live in `.venv` (python-docx, python-pptx, matplotlib,
  pandas, numpy, openpyxl, Pillow).

## 2.6

Smarter answers: honest context handling and a real deep-research pipeline.

Deep Research
- Deep Research is now a pipeline, not a single search: the selected model
  plans 4 distinct search angles, all angles are searched in parallel, sources
  are ranked by cross-query consensus, the top 6 pages are read in full
  (SSRF-protected fetch, shared with the `fetch_url` tool), and the model
  synthesizes from full page text — up to 24 cited sources instead of 20
  snippets.
- Research progress streams into the chat as tool chips (plan, search, pages
  read) so the work is visible while it happens.
- Research synthesis runs at lower temperature (0.4) for factual grounding.

Context handling
- History is now always trimmed to a budget — the UI's context choice, else the
  model's declared window, else a safe 8192 default. Previously an unset
  control meant no trimming at all, so long chats silently overflowed.
- The tool-calling agent loop trims its history too (it was untrimmed).
- Ollama gets an explicit `num_ctx` even when the UI control is unset.

Internals
- `lib/safe-fetch.ts`: the redirect-validated, blocklist-enforced page fetcher,
  now shared by the `fetch_url` tool and Deep Research (was duplicated).
- `lib/research.ts`: planning, consensus ranking, page reading, context
  assembly — with 12 new unit tests (44 total).

## 2.5

Production hardening pass: security, reliability, and a full audit.

Security
- Dependency CVEs cleared: Next.js 15.0.3 → 15.5.23 (SSRF, server-function
  disclosure), React RC → 19.2.8 stable, next-auth beta.32, postcss/sharp
  overrides. `npm audit` reports zero vulnerabilities.
- llama-server now binds 127.0.0.1 by default (it has no auth of its own).
  Set `LLAMA_HOST=0.0.0.0` only if you deliberately serve the raw model to the LAN.
- `REGISTRATION_MODE=invite` is now actually enforced server-side (it was never
  checked), with an invite field on the register form.
- Rate limiting: login (per username) and registration (per IP).
- Login timing equalized (no username enumeration via response time), and
  deleted users lose session identity immediately instead of at JWT expiry.
- `/v1` API tokens are stored as SHA-256 hashes, not plaintext.
- The `fetch_url` tool re-validates every redirect hop against the private-host
  blocklist (a public URL 302ing to 169.254.169.254 no longer bypasses it) and
  unwraps IPv4-mapped IPv6.
- Share links are 128-bit slugs (was 40-bit).
- Security headers everywhere: CSP, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy. Browser-side connections restricted to this origin.
- Source cards no longer load favicons from Google (searched domains stayed on
  the wire) — a local letter chip replaces them.
- Input caps on the /v1 completions endpoint; internal error details no longer
  leak to API clients (generic messages out, real errors in the server log).

Reliability
- Supervisor: a missing llama-server binary no longer reports "running" forever;
  restart races and the port-conflict "model too large" misdiagnosis are fixed;
  backoff actually backs off now.
- Switching engines never kills an in-flight chat stream anymore.
- Cold-start-after-switch waits for the model to be healthy instead of erroring 503.
- All inference streams get a 120s idle watchdog (a wedged server can't hang a
  request forever); the agent loop gets total timeouts.
- Downloads: stall watchdog, disk-space preflight, failed jobs no longer
  advertise a path that doesn't exist.
- Structured JSON logging (lib/logger) with secret redaction across backend
  failure paths.
- Chat UI: streams can't write into the wrong conversation after a mid-stream
  switch; conversation loads are race-free; failed mutations roll back with a
  toast; destructive actions confirm; forms surface network errors instead of
  spinning forever.
- Database: first-user admin race closed, imports are atomic, tokens migrate to
  hashed storage automatically, indexes added (documents, folder_id, message
  timestamps), admin user list no longer cartesian-joins.

Frontend
- Streaming re-renders memoized (no full-tree markdown re-parse per token) and
  auto-scroll throttled.
- Accessibility: aria-labels on icon buttons, keyboard-visible action rows,
  Escape closes panels, dialog semantics, label associations on auth forms.
- The share page renders with its intended theme again (missing Tailwind
  tokens), the Appearance text-size setting actually works, and error/404
  pages exist app-wide.

Operations
- `GET /api/health` for uptime monitors (public, minimal).
- Docker: runs as non-root, HEALTHCHECK included, Ollama bound to localhost,
  model downloads land in the data volume.
- Tests: `npm test` (vitest, 32 tests) plus `node scripts/smoke-test.mjs` for
  live end-to-end checks. `npm run typecheck`, flat ESLint config.
- systemd unit no longer fails when `.env.local` is absent.

## 2.4.1

A real installer, so the public can run one command and walk away.

Hands-off install
- `bash install.sh` now installs everything Chakor needs, not just Node. It works
  out your OS and package manager (apt, dnf, yum, pacman, zypper, apk, Homebrew,
  Termux) and pulls in Git, a C/C++ build chain, Python, OpenSSL, Node 20+, and
  Ollama so you can run local models with no compiling.
- It asks for your password at most once and keeps that grant alive in the
  background, so it runs start to finish without stopping to ask again. On a box
  where you are already root (a typical VPS or container) there is no prompt at
  all. It never writes permanent passwordless-sudo rules.
- Optional extras behind a flag: `--all` or `--with-llama-cpp` builds a local
  llama-server from source, with NVIDIA CUDA when the toolkit is present (a CPU
  build otherwise, plus the one command to add GPU later).
- `--service` writes a systemd unit and starts Chakor 24/7, running it as a
  normal user rather than root. Also `--minimal`, `--no-ollama`, `--yes` for
  unattended servers, `--no-start`, and `--dry-run` to preview the plan.
- Resilient by design: optional steps that fail are skipped with a note instead
  of killing the install, network steps retry, and the whole run is logged to
  `install.log`. Re-running is safe and picks up where it can.
- Windows `install.ps1` matches: installs Git, Node 20+, and Ollama via winget
  (Chocolatey fallback), with the same skip-and-continue behavior.

## 2.4

Downloads that don't quit on you, and never two models fighting for memory.

Background downloads
- Hugging Face downloads run on the server now, not in your browser. Start one,
  close the tab, walk away. A chip in the chat header shows progress, speed, and
  time left from anywhere in the app, and you can cancel from there too. Reopen
  the page later and it's still going, or done and ready.

One model at a time, so modest machines don't crash
- Switching engines unloads the previous model first, so two models never fight
  over the same VRAM and OOM-crash. On a roomy rig, flip on "keep multiple models
  loaded" in Settings for instant switching; on a modest one it stays safely
  one-at-a-time and says so. Chakor reads your hardware to decide what to offer.
- A "Max" context button loads the local model at the biggest window your machine
  can actually back, worked out from your RAM and VRAM.

Privacy, as ever
- Models download from the source straight to your disk. Nothing routes through
  us, no account, no telemetry, no data broker in the middle. Once a model is
  down it runs fully offline.

## 2.3

Switch engines from the web, and get models without a terminal.

Switch engines from the model menu
- The model menu has an engine row: llama.cpp, Ollama, and LM Studio with a live
  running light and a model count. Tap one to move your whole stack to it. Been
  on llama.cpp and want LM Studio instead? One tap, no config files. If the
  engine you are on goes down, it points you at a running one.

Download models from Hugging Face
- Search Hugging Face for a GGUF right inside the app, see every quant with its
  size and a FITS / TIGHT / TOO BIG tag for your machine, click Download, and
  watch the progress bar. The file lands in your models folder, ready to run with
  llama.cpp. Sharded models and vision projectors are handled for you.
- Pulling from Ollama works again behind a reverse proxy or Cloudflare tunnel.
  The progress was being buffered and looked frozen; the stream is flushed
  straight through now.

## 2.2

Runs on whatever hardware you have, and never gets you stuck on a dead engine.

Hardware-aware models
- Chakor detects your RAM, CPU, and GPU (VRAM), and tells you in Settings →
  Models exactly what your machine can run. Each local model file is tagged
  FITS, TIGHT, or TOO BIG against your hardware, with a RECOMMENDED pick, so a
  4 GB laptop stops loading a model that was only ever going to crash.
- llama.cpp no longer crash-loops forever. If a model is too big and the server
  keeps dying on launch, Chakor stops after a few tries and says so in plain
  language, instead of pinning your CPU retrying the impossible.

LM Studio, and switching when one engine is down
- LM Studio is now a first-class backend. Start its local server and the models
  you have loaded there show up automatically, the same as Ollama.
- The model menu shows which local engines (llama.cpp, Ollama, LM Studio) are
  actually running. If the one you picked is down, it offers the running ones as
  one-click switches right there, so "llama.cpp crashed, now what" has an answer
  that isn't the terminal.

## 2.1

Everything controllable from the web, and one service instead of two.

Models
- Switch the local model from the UI. Chakor lists the `.gguf` files on your
  machine in Settings → Models, you click one, and it loads. No editing configs,
  no terminal.
- Change the context size from the UI too. Real `num_ctx` for Ollama, a server
  reload for the local model, and a history budget for cloud models so the
  control means something everywhere.
- Vision turns on by itself when the running local model supports it.

Under the hood
- Chakor now runs llama.cpp itself, supervised in-process, so the app and the
  model are a single service. Switching a model is just an in-process restart,
  no sudo. Run `scripts/use-single-service.sh` once to fold an existing
  two-service setup into one.
- If you already run llama-server or use Ollama/cloud only, Chakor adopts it and
  stays out of the way (`CHAKOR_SUPERVISE_LLAMA=false`).

## 2.0

The open source release. Built to be a lighter alternative to Open WebUI and an
open answer to LM Studio that also runs on a server and on your phone.

Models
- Run local models through Ollama, with installed models discovered automatically.
- Run local models through a llama.cpp server.
- Bring your own keys for OpenAI, Anthropic, Google, and OpenRouter.
- Switch model per message from the picker.

Assistant
- Rewrote how it answers. It now matches length to the question instead of turning
  every question into an essay. Short question, short answer.
- Plain, human voice. No corporate filler, no made up facts, no em dashes.

Features
- Web search per message (SearXNG, with Brave and DuckDuckGo fallbacks).
- Chat with your own documents (PDF, text, markdown).
- Research mode that plans several searches and writes a cited briefing.
- Installable as an app on phones and desktops (PWA).
- Multi user accounts with an admin panel.

Setup
- One command installers for Linux, macOS, Windows, and Android (Termux) that set
  up Node for you if it is missing.
- Docker and docker compose for a run anywhere option, with an optional bundled
  Ollama.
- Rebrandable from a config file. Set a name and tagline, no code changes.

Fixes
- Static assets and the web manifest are reachable without a login, so favicons,
  icons, social cards, and add to home screen work.
- Auth pages and the chat layout behave correctly on small screens.
