<a id="top"></a>

<div align="center">

<img src="docs/banner.png" alt="Chakor - your AI, on your hardware" width="100%" />

<br/>
<br/>

<a href="https://github.com/TYFSADIK/chakor/stargazers"><img src="https://img.shields.io/github/stars/TYFSADIK/chakor?style=for-the-badge&color=22c55e&labelColor=0b110e&logo=github" alt="Stars"/></a>
<img src="https://img.shields.io/badge/version-2.7.1-22c55e?style=for-the-badge&labelColor=0b110e" alt="Version 2.7.1"/>
<img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge&labelColor=0b110e" alt="MIT License"/>
<img src="https://img.shields.io/badge/node-%3E%3D20-22c55e?style=for-the-badge&labelColor=0b110e&logo=nodedotjs" alt="Node 20 or newer"/>
<img src="https://img.shields.io/badge/docker-compose%20up-22c55e?style=for-the-badge&labelColor=0b110e&logo=docker" alt="Docker"/>
<img src="https://img.shields.io/badge/self--hosted-100%25-22c55e?style=for-the-badge&labelColor=0b110e" alt="Self-hosted"/>
<img src="https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge&labelColor=0b110e" alt="PRs welcome"/>
<img src="https://img.shields.io/badge/built%20with-Next.js%2015-0b110e?style=for-the-badge&labelColor=0b110e&color=334155&logo=nextdotjs" alt="Next.js 15"/>

<br/>
<br/>

**Run any AI model on your own machine. Keep every conversation.**
**No cloud, no tracking, no big tech.**

[Quick start](#quick-start) &nbsp;·&nbsp; [Get a model](#get-a-model) &nbsp;·&nbsp; [Switch models](#switch-models-any-time) &nbsp;·&nbsp; [Features](#everything-it-does) &nbsp;·&nbsp; [On your phone](#use-it-on-your-phone) &nbsp;·&nbsp; [Config](#configuration) &nbsp;·&nbsp; [Develop](#for-developers)

</div>

<br/>

Chakor is an open source AI workspace you run yourself. Point it at a local model or your own API keys, then chat, search the web, talk to your documents, compare models side by side, and run real research. Your conversations live in a database on your machine, not in someone else's data center.

Think of it as a lighter, friendlier alternative to Open WebUI, and an open source answer to LM Studio that also runs on a server and on your phone.

<br/>

<div align="center">

<img src="docs/shot-chat.png" alt="The Chakor interface: a step-by-step answer with a live rendered mermaid flowchart, the Agent Workspace panel on the right" width="100%" />

<sub>Real screenshot: a step-by-step answer with an inline rendered diagram. The Agent Workspace panel sits on the right.</sub>

</div>

<!-- The banner and social card are generated from code in docs/build-assets.mjs so they
     stay on-brand and easy to regenerate. The screenshots are real captures of the app.
     The one thing that beats them is a real 10-second screen recording saved as
     docs/demo.gif at the very top. See docs/README.md. -->

## Why this exists

Every big AI app wants the same deal. You hand over your questions, your documents, your half formed ideas at 2am, and they keep all of it on servers you will never see, to train on, to profile, to sell around. That is the price of "free."

Self hosting flips that. You run the model. You hold the data. No account to harvest, no telemetry phoning home, no data broker in the middle, no government letter they can answer with your chat history because they never had it.

> **Privacy is not a setting you toggle. It is where the software runs.**

Chakor runs on your machine, talks to nobody you did not ask it to, and still tries to be genuinely nice to use. That is the whole pitch.

## Built different

Three things you will not find stitched together anywhere else.

### It knows what your machine can run

Most apps let you download a model, load it, and find out it was too big when it crashes. Chakor reads your RAM and GPU first and tags every model **FITS**, **TIGHT**, or **TOO BIG**, then points you at the best one that actually runs. A 4 GB laptop and a 24 GB workstation each get an honest answer, not a crash.

<div align="center">
<img src="docs/shot-models.png" alt="Settings showing detected hardware, live engine status, and local models tagged by how they fit the machine" width="94%"/>
</div>

### Get models without touching a terminal

Search Hugging Face from inside the app, see every quant with its size and a fit tag, and click once. It downloads in the background, straight into your models folder, ready for llama.cpp. Close the tab and it keeps going.

<div align="center">
<img src="docs/download.png" alt="In-app Hugging Face browser with quants tagged by fit, and a downloads tray showing live progress, speed, and time remaining" width="94%"/>
</div>

### Switch engines without the crashes

Flip between llama.cpp, Ollama, and LM Studio in one tap. Chakor unloads the previous model first, so two models never fight for the same VRAM. On a roomy GPU, turn that off and keep several loaded for instant switching.

### An agent that builds real things

Turn on Agent Mode and the chat stops being just answers. The agent plans, searches the web, runs Python in a sandbox, and hands you back actual files: slide decks, Word documents, charts, spreadsheets. Everything lands in a per-conversation workspace you can download from, and the Python side runs with CPU, memory, and filesystem limits so the agent cannot wander off your disk.

### Research that reads the pages, not just the snippets

Deep Research is a pipeline, not a single search. It plans four angles, searches them in parallel, reads the top pages in full, and writes a cited briefing from what it actually read. The whole pipeline streams into the chat as it runs, so you can watch it think.

### Image generation on your own GPU

Chakor runs stable-diffusion.cpp's `sd-server` for you (no separate service to start): the composer grows a Create image pill, you type a prompt (or just say "draw a fox"), and the picture appears in the chat, saved into the conversation's workspace and downloadable from there. While it renders you watch it happen: the chat shows a live in-progress preview frame that sharpens with every sampling step, a step progress bar, and a live elapsed/estimated-remaining timer (`SDCPP_PREVIEW=none` turns the preview off). The default model is an Iris-architecture GGUF (Sakura-Iris-3B) with a Qwen3-VL text encoder — ComfyUI can't run this architecture, which is why Chakor talks to `sd-server` directly. Admins pick who gets access, choose between installed GGUF models and text encoders, upload new ones straight from the browser (all models — chat, image, encoder — share one folder), pick a quality preset (fast 512², balanced 768², quality 1024²), and regular users get a sane daily limit (admins run the hardware, so they're never capped). On small cards the engine runs in *swap* mode — the chat model pauses while an image renders (honestly: minutes, not seconds — a full-quality render is ~30 min on a 4 GB card, and you can close the tab while it works), then comes back; with 12+ GB VRAM both stay resident in *parallel* mode.

![An image Chakor generated: misty mountain lake at sunrise](docs/image-gen.png)

*Generated by Chakor on a 4 GB GTX 1650 Ti — Sakura-Iris-3B Q8_0, 1024×1024, 30 steps.*

## Everything it does

**Models, your way**
- ✓ Local models through Ollama, LM Studio, or llama.cpp, on GPU or plain CPU
- ✓ Cloud models with your own keys: OpenAI, Anthropic, Google, OpenRouter
- ✓ Switch model per message, and swap the local model or its context size from the web, no terminal
- ✓ Hardware-aware: Chakor reads your RAM and GPU and tags each local model FITS, TIGHT, or TOO BIG, so you never load one that crashes
- ✓ Download GGUF models from Hugging Face in the app, on a background job with progress and speed you can watch from anywhere
- ✓ Switch engines (llama.cpp, Ollama, LM Studio) from the model menu; it frees the old one first so a modest GPU never OOMs, and points you at a running engine if one is down
- ✓ Full GPU offload with a lean VRAM serving budget, and automatic offload recovery if a model ever OOMs — no crash loops, no silent CPU fallback
- ✓ Load and unload local models and see their size and quant from the model picker

**Knowledge and the web**
- ✓ Web search built in, on per message, with SearXNG then Brave then DuckDuckGo fallback
- ✓ Talk to your files: drop in PDFs, text, or markdown and ask questions grounded in them
- ✓ Deep Research pipeline: plans search angles, reads full pages, and writes a cited briefing from up to 24 sources
- ✓ Tools and function calling: web search, fetch a URL, a calculator, the current time

**Agent workspace**
- ✓ Agent Mode: the assistant plans, runs tools in a loop, and produces real files, not just chat text
- ✓ Sandboxed Python for charts, data crunching, and scripts, with CPU, memory, and path limits
- ✓ Generates Word documents and PowerPoint decks you can download straight from the workspace panel
- ✓ Live activity log shows every step the agent takes, in plain language

**More than a chat box**
- ✓ Image generation via stable-diffusion.cpp (started on demand by Chakor itself): a Create image pill in the composer, natural prompts ("draw a fox") detected automatically, pictures saved into the conversation workspace and shown inline — admin allowlist, per-user daily limit, and swap/parallel GPU scheduling included
- ✓ Answers with visuals: detailed replies come with rendered mermaid diagrams, comparison tables, and step-by-step structure, while quick questions get quick answers
- ✓ Compare: run the same prompt across models side by side, blind, vote, and keep a leaderboard
- ✓ Memory: the assistant remembers facts you want it to, across conversations
- ✓ Notes: a built-in Keep-style notepad with checklists, colors, pinning, and archive
- ✓ Organize: folders, pinning, tags, and archive for your conversations
- ✓ Share a conversation with a link, or import chats you exported elsewhere
- ✓ Image input (vision) on models that support it, attach a picture and ask about it
- ✓ Custom system prompts you can save and reuse

**Yours and private**
- ✓ No telemetry. Conversations stay in a local SQLite database on your disk
- ✓ Multi user with accounts and an admin panel, clean separation between people
- ✓ Hosting for others? Regular users only ever see your brand name as the model — the real model, engine, and hardware details stay admin-only
- ✓ Theme editor: recolor the whole app live from the settings
- ✓ Rebrand the name, tagline, and look from a config file, no code edits
- ✓ Installable as an app on phone and desktop, built for small screens too

## Chakor vs the usual options

Both Open WebUI and LM Studio are good. Here is where Chakor is different.

| | **Chakor** | Open WebUI | LM Studio |
| --- | :---: | :---: | :---: |
| Open source | ✓ | ✓ | ✗ |
| Self host on a server | ✓ | ✓ | desktop only |
| Run the server on a phone | ✓ Termux | partial | ✗ |
| Local models (Ollama / llama.cpp) | ✓ | ✓ | ✓ |
| One UI for llama.cpp + Ollama + LM Studio | ✓ | partial | ✗ |
| Knows your hardware, fit tag per model | ✓ | ✗ | partial |
| Download GGUF from Hugging Face in-app | ✓ | ✗ | ✓ |
| Background downloads you can walk away from | ✓ | ✗ | ✓ |
| Frees the old model so you don't OOM on switch | ✓ | ✗ | n/a |
| Bring your own cloud keys | ✓ | ✓ | limited |
| Swap local model + context from the UI | ✓ | partial | ✓ |
| Web search built in | ✓ | ✓ | ✗ |
| Deep research that reads full pages | ✓ | partial | ✗ |
| Sandboxed agent that writes files (docx, pptx, charts) | ✓ | ✗ | ✗ |
| Chat with your documents | ✓ | ✓ | beta |
| Multi user + admin panel | ✓ | ✓ | ✗ |
| Blind A/B model compare + leaderboard | ✓ | partial | ✗ |
| Notes + assistant memory | ✓ | partial | ✗ |
| Rebrand from one config file | ✓ | ✗ | ✗ |
| One small codebase you can read | ✓ | heavy | closed |

## Quick start

Pick whichever fits you. All paths end with the app on **http://localhost:3001**. The first account you register becomes the admin.

**Requirements:** Node.js 20 or newer. Python 3 is needed for the Agent Workspace (the installers set up its virtualenv for you). Everything else — Ollama, llama.cpp, cloud keys — is optional.

> The default `.env` ships with `REGISTRATION_MODE=invite` and `INVITE_CODE=change-me`. For a solo setup, set `REGISTRATION_MODE=open` before you register, or just use the invite code on the register screen. Either way, account number one is the admin.

### Option 1: Docker (Linux, macOS, Windows)

The least fuss. Install Docker Desktop or Docker Engine, then:

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
docker compose up -d
```

That is it. A secret key is generated for you and stored in the data volume. Want a local model bundled in too:

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull llama3.2
```

### Option 2: One command installer (Linux, macOS, Android)

The hands-off path. The installer works out your OS and package manager, then installs everything Chakor needs and starts it: Git, a C/C++ build chain, Node 20+, and Ollama so you can run local models right away. It asks for your password at most once and keeps that grant alive, so it runs start to finish without stopping to ask again. On a box where you are already root (a typical VPS or container) there is no prompt at all.

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
bash install.sh
```

Want the works — a local llama.cpp build with NVIDIA CUDA, GPU image generation (sd-server plus the Sakura-Iris-3B model and its text encoder, downloaded for you), and a local SearXNG for web search:

```bash
bash install.sh --all
```

On **Windows**, open PowerShell in the folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

On **Android**, install [Termux](https://termux.dev), then run the same `bash install.sh`. It uses Termux packages automatically, and your phone becomes the server.

**Installer options**

| Flag | What it does |
| --- | --- |
| `--all` | Everything: core tools, Ollama, llama.cpp, image generation, and SearXNG. |
| `--with-llama-cpp` | Also build a local `llama-server` from source. |
| `--with-cuda` | Build llama.cpp with NVIDIA CUDA (implies `--with-llama-cpp`). |
| `--with-images` | Build stable-diffusion.cpp's `sd-server` and download the default image model + text encoder (~6 GB). |
| `--with-searxng` | Run a local SearXNG container for web search (needs Docker; without it search falls back to DuckDuckGo). |
| `--service` | Install and start a systemd service so it runs 24/7 (needs root or sudo). |
| `--no-ollama` | Skip Ollama. Bring your own engine or a cloud key. |
| `--minimal` | Just Node and the app. |
| `--yes` | Non-interactive, for unattended setups like a fresh server. |
| `--no-start` | Set everything up but do not start. |
| `--dry-run` | Print the plan and change nothing. |

Fresh server, fully unattended:

```bash
sudo bash install.sh --yes --service
```

A few honest notes. The installer never writes permanent passwordless-sudo rules and never runs the app itself as root, so a server that faces the network is not one bug away from owning the whole machine. CUDA is large and version-sensitive, so it is used when the toolkit is already there and otherwise pointed to, not force-installed onto your drivers. LM Studio is a desktop app with no headless installer, so grab it yourself if you want it; Chakor finds it the moment its local server is running.

### Option 3: setup.sh (already have Node 20+)

The middle path: no system packages installed, just the app. It installs npm dependencies, creates the Python virtualenv the Agent Workspace uses, generates your `AUTH_SECRET`, initializes the database, builds, and finishes by running the doctor — a full environment checkup that reports what is ready and what is missing. You can re-run that checkup any time with `npm run doctor`.

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
bash setup.sh
npm start
```

### Option 4: Manual (for developers)

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
npm install --legacy-peer-deps
cp .env.example .env.local            # then set AUTH_SECRET (openssl rand -base64 32)
python3 -m venv .venv && .venv/bin/pip install python-docx python-pptx matplotlib pandas numpy openpyxl Pillow   # optional, for Agent Workspace
npm run build
npm start
```

## Get a model

Chakor needs something to talk to. Easiest options, in order:

1. **Ollama (recommended).** Install it from [ollama.com](https://ollama.com), then pull a model:
   ```bash
   ollama pull llama3.2
   ```
   Chakor finds installed Ollama models on its own and lists them in the model picker. This is the simplest way to "run any model."

2. **LM Studio.** Already use LM Studio? Open its **Developer** tab and **Start Server**. Chakor talks to it at `http://127.0.0.1:1234/v1` (override with `LMSTUDIO_BASE_URL`) and the models you have loaded there appear in the picker automatically, the same as Ollama.

3. **llama.cpp + download from Hugging Face.** Point `LLAMA_SERVER_BIN` at your `llama-server` and Chakor runs it for you as part of the same service. No model yet? In **Settings → Models → Download from Hugging Face**, search for one, see every quant with its size and a fit tag for your machine, and download it with a progress bar straight into your models folder, no terminal. Or drop `.gguf` files in `~/Downloads`, `~/models`, or `~/.lmstudio` (or set `CHAKOR_MODELS_DIR`) yourself. Already run your own `llama-server`? Set `LLAMA_BASE_URL` and `CHAKOR_SUPERVISE_LLAMA=false` and Chakor just uses it.

4. **Cloud keys.** Paste a key into `.env.local` and that provider's models show up:
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`.

5. **OpenRouter.** One key for hundreds of models, including the big ones. Set `OPENROUTER_API_KEY` and list the models you want in `OPENROUTER_MODELS`.

Not sure what your machine can handle? **Settings → Models** shows your detected RAM and GPU and marks each local model FITS, TIGHT, or TOO BIG, with a RECOMMENDED pick. Start there and you won't load something that just crashes.

## Switch models any time

This is the part people usually have to fight a terminal for. In Chakor it is all in the UI.

- **Per message.** Click the model name in the chat header and pick any model you have set up, local or cloud. Your choice sticks to that conversation.
- **Switch engines from the menu.** The model menu has a row for llama.cpp, Ollama, and LM Studio with a live running light and model count. Tap one to move your whole stack to it. If the engine you are on crashed or isn't up, it points you at a running one, so you are never stuck on a dead backend.
- **One model at a time, automatically.** Switching engines unloads the previous model first, so two models never fight over the same VRAM and crash. Got a roomy GPU? Flip on "keep multiple models loaded" in **Settings → Models** for instant switching. On a modest machine it stays safely one-at-a-time.
- **Download in the background.** A Hugging Face download runs on the server, not in your browser, so you can close the tab and it keeps going. A chip in the chat header shows progress, speed, and time left, and lets you cancel from anywhere.
- **Swap the local model live.** Go to **Settings → Models**. Chakor lists every `.gguf` it found on your machine, each tagged with how well it fits your hardware. Click one and it loads, no editing config files, no restart in the terminal. The change is an in process restart of the bundled `llama-server`, so it just happens.
- **Change the context size.** Same screen. It maps to a real `num_ctx` for Ollama, a server reload for the local model, and a history budget for cloud models, so the number means something everywhere. **Max** loads at the biggest window your hardware can back.
- **Vision turns on by itself** when the running local model supports images, and the attach button appears.
- **Add a cloud key without redeploying.** Each user can paste their own API keys under **Settings**, so a key is per person, not baked into the server.
- **Load and unload** local models and read their size and quant straight from the picker (admin only for load and unload).

## Use it on your phone

Two ways:

- **From any phone on your network.** Open the server address in your phone browser, then use "Add to Home Screen." It installs like a normal app, full screen, no browser bars.
- **On the phone itself.** Install [Termux](https://termux.dev) and run `bash install.sh`. Your phone becomes the server.

## Configuration

Everything lives in `.env.local`. The ones you will actually touch:

| Setting | What it does |
| --- | --- |
| `AUTH_SECRET` | Required. Signs login sessions. Generate with `openssl rand -base64 32`. |
| `REGISTRATION_MODE` | `open`, `invite`, or `closed`. With `invite`, also set `INVITE_CODE`. |
| `OLLAMA_BASE_URL` | Where Ollama runs. Default is fine for a local install. |
| `LMSTUDIO_BASE_URL` | Where LM Studio's server runs. Default `http://127.0.0.1:1234/v1`. Loaded models appear automatically. |
| `LLAMA_SERVER_BIN`, `LLAMA_GGUF` | llama.cpp binary plus the default model Chakor runs for you. Switch both live in Settings → Models. |
| `LLAMA_HOST` | Interface the supervised llama-server binds to. Now defaults to `127.0.0.1`: llama-server has no auth of its own, so it stays loopback-only. Set `0.0.0.0` only if you deliberately want the raw model reachable from your LAN. |
| `CHAKOR_MODEL_HOME` | One shared folder for every GGUF — chat, image, and encoder models. The admin can set and upload into it from the panel (Admin → Image Generation); blank falls back to `<SDCPP_DIR>/models` for the image pipeline. |
| `CHAKOR_MODELS_DIR`, `CHAKOR_SUPERVISE_LLAMA` | Extra folders to scan for chat `.gguf` files. Set supervise to `false` to run llama-server yourself. |
| `CHAKOR_LLAMA_MAX_CRASHES` | How many fast crashes before Chakor stops relaunching a too-big model and tells you to pick a smaller one. Default 4. |
| `HF_TOKEN` | Optional Hugging Face token for the in-app downloader. Lifts rate limits and reaches gated repos. Public models need none. |
| `SDCPP_URL`, `SDCPP_DIR`, `SDCPP_ENCODER` | Image generation backend. Chakor spawns stable-diffusion.cpp's `sd-server` on demand from `<SDCPP_DIR>/build/bin` (default `~/stable-diffusion.cpp`); model GGUFs live in the shared models folder (`CHAKOR_MODEL_HOME`, or `<SDCPP_DIR>/models` by default). `SDCPP_ENCODER` points at the Qwen3-VL text encoder — leave it blank and the admin picks one under Admin → Image Generation (or Chakor auto-discovers one). Enable per user under Admin → Image Generation, where you also upload models, pick the quality preset (fast / balanced / quality), and set the models folder. `IMAGE_ENGINE_MODE` (`auto`/`swap`/`parallel`) controls whether the chat model pauses while an image renders. |
| `IMAGE_DAILY_LIMIT`, `IMAGE_JOB_TIMEOUT_MINUTES` | Image-generation guardrails. Per-user daily render cap (default 10 — each render monopolizes the GPU, so keep one on public sites; admins are never limited), and the hard cap on one render job in minutes (default 45 — a 1024px/30-step image takes ~30 min on a 4 GB card). |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` | Turn on cloud models. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` | One key, many models. List them as `id\|Label`, comma separated. |
| `SEARXNG_URL`, `BRAVE_SEARCH_API_KEY` | Web search backends. |
| `CHAKOR_PYTHON`, `CHAKOR_WORKSPACE` | Agent Workspace. Python interpreter for the sandbox (blank = auto-detect `.venv`, then system `python3`) and the root folder workspaces must stay under (blank = `./data/workspaces`). |
| `TOOLS_ALLOW_PRIVATE` | DANGEROUS. Set `true` only on a fully trusted network to let the fetch tools reach private/LAN addresses. Default blocks them (SSRF protection). |
| `TRUST_PROXY` | Set `true` only behind a reverse proxy that sets a trusted `x-forwarded-for`, so rate limits apply per real client IP. |
| `NEXT_PUBLIC_APP_URL` / `CHAKOR_APP_URL` | Public URL of your instance. Used for canonical links, Open Graph, the sitemap, and JSON-LD. Falls back to `AUTH_URL`, then `http://localhost:3001`. |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `APP_CREATOR` | Rebrand the app. |

### Security notes

- Login and registration are rate limited, so hammering them gets nowhere fast. Login timing is equalized so response time cannot reveal whether a username exists.
- Every response carries baseline security headers including a Content Security Policy (see `next.config.mjs`).
- API tokens for the OpenAI-compatible `/v1` API are stored as sha256 hashes. The raw token is shown once and never saved.
- Registration defaults to invite mode, enforced server-side. Set `REGISTRATION_MODE=closed` to lock the doors entirely.
- Sessions are invalidated when a password changes or a user is deleted — no waiting for JWT expiry.
- The fetch tools (web search, URL reads, Deep Research) refuse private, loopback, and link-local addresses, and re-validate every redirect hop against a DNS-resolved blocklist, so web content cannot reach your LAN or cloud metadata endpoints.
- The Agent Workspace sandbox runs Python with CPU and memory limits, an isolated working directory, and every file path is re-checked against the workspace root — escapes are rejected.

### Make it yours

Set these and rebuild, and the name shows up everywhere from the sidebar to the browser tab to the assistant's own answers:

```bash
NEXT_PUBLIC_APP_NAME="Acme AI"
NEXT_PUBLIC_APP_TAGLINE="Our team's private assistant."
APP_CREATOR="Your Name"
```

Swap the logo by replacing `public/logo.svg` and the icons in `public/`. Want different colors without touching code? Open the **theme editor** in settings and recolor the app live.

## For developers

- **Stack:** Next.js 15, React 19, TypeScript, Tailwind, SQLite via better-sqlite3, Auth.js v5.
- **Where things live:**
  - Assistant behavior and personality: `lib/system-prompt.ts` (plain English, edit away)
  - Model providers and streaming: `lib/providers.ts`, `lib/dispatch.ts`, `lib/models.ts`
  - Local llama.cpp supervisor: `lib/llama-supervisor.ts`, `lib/local-llama.ts`
  - Tools and the agent loop: `lib/tools.ts`, `lib/agent.ts`
  - Web search: `lib/searxng.ts`
  - Document retrieval: `lib/rag.ts`
  - Theme tokens: `lib/theme.ts`
  - Database: `lib/db.ts` (schema self creates on first run)
  - Branding and config: `lib/config.ts`
- **Add a model provider:** add a `stream*` function in `lib/providers.ts`, register it in `lib/models.ts`, and route it in `app/api/chat/route.ts`. The existing providers are short and copy friendly.
- **Health check:** `GET /api/health` is unauthenticated and returns `{ ok, db, version }`: 200 when the app is alive and the database answers, 503 when it does not. Point uptime monitors at it; the Docker image uses it for its own HEALTHCHECK.
- **Run for development:** `npm run dev` (hot reload on port 3001).
- Before a pull request, run `npm run build` so it type checks. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

```
Browser  (app/, components/)
  |
  v
Next.js app
  |
  +-- /api/chat ---> lib/system-prompt.ts     how the assistant behaves
  |                  lib/dispatch.ts           routes to the right provider + trims context
  |                  lib/providers.ts          ollama, openai, anthropic, google, openrouter
  |                  lib/llama-supervisor.ts   runs local llama.cpp as a child process
  |                  lib/agent.ts + tools.ts   function calling loop
  |                  lib/agent-executor.ts     Agent Workspace ReAct loop
  |                  scripts/sandbox-runner.py sandboxed Python (docx, pptx, charts)
  |                  lib/searxng.ts            web search, with fallbacks
  |                  lib/rag.ts                document retrieval
  |
  +-- lib/db.ts ---> SQLite  (your data, on your disk)
```

## Running it 24/7

Easiest: let the installer set up the service for you. It writes a systemd unit pointed at the right folder, runs the app as a normal user (not root), and starts it on boot, restarting on crash.

```bash
bash install.sh --service
```

Prefer to do it by hand? There is a unit at `scripts/chakor.service`. Edit the paths inside, then:

```bash
sudo cp scripts/chakor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chakor
```

Already had the old two service setup (a separate llama server)? Run `scripts/use-single-service.sh` once to fold it into one. Or just leave the Docker container running, it restarts itself.

## FAQ

**Do I need a GPU?** No. CPU works, just slower. Or use a cloud key and run nothing locally.

**Is my data sent anywhere?** No, unless you turn on web search or pick a cloud model. Then only those requests go out, and only to the provider you chose.

**Can I change the model mid conversation?** Yes. Pick a different one from the header and the next message uses it. See [Switch models any time](#switch-models-any-time).

**Answers too long or too short?** Edit `buildSystemPrompt()` in `lib/system-prompt.ts`. It is written in normal language.

**How is this different from Open WebUI or LM Studio?** It is lighter than Open WebUI and simpler to run, it is open source unlike LM Studio, and it runs anywhere including a phone. It is also openly opinionated about privacy and self hosting. See [the table](#chakor-vs-the-usual-options).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Not sure what is wrong | Run `npm run doctor` — it checks every piece Chakor uses and prints the fix for whatever is missing. |
| Installer stopped partway | Just run `bash install.sh` again. It is safe to re-run and skips what is already done. The full log is in `install.log`. |
| `npm install` fails on peer deps | Use `npm install --legacy-peer-deps`. |
| Chat says it cannot connect | Is Ollama, LM Studio, or llama.cpp running, or did you set a cloud key. The model menu and Settings → Models both show which engines are up. |
| Local model keeps crashing | It is probably too big for your machine. Settings → Models marks it TOO BIG and suggests one that fits, or switch to Ollama or LM Studio from the model menu. |
| No models in the picker | Pull a model with `ollama pull`, load one in LM Studio, or add an API key, then reload. |
| Search finds nothing | Turn on `json` format in SearXNG, or set `BRAVE_SEARCH_API_KEY`. |
| Image generation unavailable | Run `bash install.sh --with-images` — it builds `sd-server` and downloads the model + text encoder. Then enable it per user under Admin → Image Generation. |
| Cannot sign in after first run | First account registered is the admin. Check `REGISTRATION_MODE` and `INVITE_CODE`. |

## What's next

A few directions being explored, in no particular order and with no promises:

- Voice input and output for local models
- More agent tools: spreadsheet editing, image generation backends, scheduled tasks
- Shared workspaces for multi-user setups
- Deeper vision support across more local model families

Want one of these sooner, or have a better idea? Open an issue.

## Contributing

Pull requests are welcome. Keep the voice human (no emoji, no em dashes), run `npm run build` before you open one, and see [CONTRIBUTING.md](CONTRIBUTING.md) for the rest.

If Chakor is useful to you, **star the repo**. It is the single easiest way to help other people find a private alternative to the big AI apps.

## License

MIT. Do what you want with it. See [LICENSE](LICENSE).

<br/>

<div align="center">

### Your AI should answer to you, not to a data broker.

Run it on your laptop. Run it on a server. Run it on your old phone in a drawer. Keep every word.

<a href="#quick-start"><img src="https://img.shields.io/badge/Get%20started-one%20command-22c55e?style=for-the-badge&labelColor=0b110e" alt="Get started"/></a>
&nbsp;
<a href="https://github.com/TYFSADIK/chakor"><img src="https://img.shields.io/badge/Star%20on%20GitHub-help%20it%20spread-0b110e?style=for-the-badge&labelColor=0b110e&color=334155&logo=github" alt="Star on GitHub"/></a>

<br/>
<br/>

**Built by [tyfsadik](https://github.com/TYFSADIK), for people who would rather run their own tools.**

<sub>No cloud · No tracking · No big tech · <a href="#top">back to top</a></sub>

</div>
