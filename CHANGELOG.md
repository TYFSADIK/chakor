# Changelog

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
