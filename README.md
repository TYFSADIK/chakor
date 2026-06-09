<a id="top"></a>

<div align="center">

<img src="docs/banner.png" alt="Chakor - your AI, on your hardware" width="100%" />

<br/>
<br/>

<a href="https://github.com/TYFSADIK/chakor/stargazers"><img src="https://img.shields.io/github/stars/TYFSADIK/chakor?style=for-the-badge&color=22c55e&labelColor=0b110e&logo=github" alt="Stars"/></a>
<img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge&labelColor=0b110e" alt="MIT License"/>
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

<img src="docs/preview.png" alt="The Chakor chat interface: sidebar with conversations, folders, Compare, Notes and Memory, a model picker, web search, tool use, and code blocks" width="100%" />

<sub>One workspace: local and cloud models, web search, tools, documents, compare, notes, and memory.</sub>

</div>

<!--
  Want real screenshots in here instead of the illustration above?
  Run the app, grab a few PNGs, drop them in docs/, and swap the <img src> lines.
  A short screen recording exported as docs/demo.gif at the very top is the single
  biggest thing you can add to make this page pop. See docs/README.md for tips.
-->

## Why this exists

Every big AI app wants the same deal. You hand over your questions, your documents, your half formed ideas at 2am, and they keep all of it on servers you will never see. That is the price of "free."

Self hosting flips that. You run the model. You hold the data. Nobody gets to mine your chats to sell you something later. Privacy is not a setting you toggle, it is where the software runs.

Chakor is built around that idea, and it tries to be genuinely nice to use while doing it.

## Everything it does

**Models, your way**
- ✓ Local models through Ollama, LM Studio, or llama.cpp, on GPU or plain CPU
- ✓ Cloud models with your own keys: OpenAI, Anthropic, Google, OpenRouter
- ✓ Switch model per message, and swap the local model or its context size from the web, no terminal
- ✓ Hardware-aware: Chakor reads your RAM and GPU and tags each local model FITS, TIGHT, or TOO BIG, so you don't load one that crashes
- ✓ If one local engine is down, the model menu offers the running ones as one-click switches
- ✓ Load and unload local models and see their size and quant from the model picker

**Knowledge and the web**
- ✓ Web search built in, on per message, with SearXNG then Brave then DuckDuckGo fallback
- ✓ Talk to your files: drop in PDFs, text, or markdown and ask questions grounded in them
- ✓ Real research mode that plans angles, gathers sources, and writes a cited briefing
- ✓ Tools and function calling: web search, fetch a URL, a calculator, the current time

**More than a chat box**
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
| Bring your own cloud keys | ✓ | ✓ | limited |
| Swap local model + context from the UI | ✓ | partial | ✓ |
| Web search built in | ✓ | ✓ | ✗ |
| Chat with your documents | ✓ | ✓ | beta |
| Multi user + admin panel | ✓ | ✓ | ✗ |
| Blind A/B model compare + leaderboard | ✓ | partial | ✗ |
| Notes + assistant memory | ✓ | partial | ✗ |
| Rebrand from one config file | ✓ | ✗ | ✗ |
| One small codebase you can read | ✓ | heavy | closed |

## Quick start

Pick whichever fits you. All three end with the app on **http://localhost:3001**. The first account you register becomes the admin.

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

No Node installed? These scripts handle that for you, then set everything up and start it.

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
bash install.sh
```

On **Windows**, open PowerShell in the folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

On **Android**, install [Termux](https://termux.dev), then run the same `bash install.sh`. It uses Termux packages automatically, and your phone becomes the server.

### Option 3: Manual (for developers)

```bash
git clone https://github.com/TYFSADIK/chakor.git && cd chakor
npm install --legacy-peer-deps
cp .env.example .env.local            # then set AUTH_SECRET (openssl rand -base64 32)
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

3. **llama.cpp.** Point `LLAMA_SERVER_BIN` at your `llama-server` and `LLAMA_GGUF` at a model, and Chakor runs it for you as part of the same service. From **Settings → Models** you then switch the model and context size from the web, no terminal. Drop more `.gguf` files in `~/Downloads`, `~/models`, or `~/.lmstudio` (or set `CHAKOR_MODELS_DIR`) and they show up to switch to. Already run your own `llama-server`? Set `LLAMA_BASE_URL` and `CHAKOR_SUPERVISE_LLAMA=false` and Chakor just uses it.

4. **Cloud keys.** Paste a key into `.env.local` and that provider's models show up:
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`.

5. **OpenRouter.** One key for hundreds of models, including the big ones. Set `OPENROUTER_API_KEY` and list the models you want in `OPENROUTER_MODELS`.

Not sure what your machine can handle? **Settings → Models** shows your detected RAM and GPU and marks each local model FITS, TIGHT, or TOO BIG, with a RECOMMENDED pick. Start there and you won't load something that just crashes.

## Switch models any time

This is the part people usually have to fight a terminal for. In Chakor it is all in the UI.

- **Per message.** Click the model name in the chat header and pick any model you have set up, local or cloud. Your choice sticks to that conversation.
- **Switch when an engine is down.** The model menu shows which local engines (llama.cpp, Ollama, LM Studio) are running. If the one you are on crashed or isn't up, the menu offers the running ones as one-click switches, so you are never stuck on a dead backend.
- **Swap the local model live.** Go to **Settings → Models**. Chakor lists every `.gguf` it found on your machine, each tagged with how well it fits your hardware. Click one and it loads, no editing config files, no restart in the terminal. The change is an in process restart of the bundled `llama-server`, so it just happens.
- **Change the context size.** Same screen. It maps to a real `num_ctx` for Ollama, a server reload for the local model, and a history budget for cloud models, so the number means something everywhere.
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
| `CHAKOR_MODELS_DIR`, `CHAKOR_SUPERVISE_LLAMA` | Extra folders to scan for `.gguf` files. Set supervise to `false` to run llama-server yourself. |
| `CHAKOR_LLAMA_MAX_CRASHES` | How many fast crashes before Chakor stops relaunching a too-big model and tells you to pick a smaller one. Default 4. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` | Turn on cloud models. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` | One key, many models. List them as `id\|Label`, comma separated. |
| `SEARXNG_URL`, `BRAVE_SEARCH_API_KEY` | Web search backends. |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `APP_CREATOR` | Rebrand the app. |

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
  |                  lib/searxng.ts            web search, with fallbacks
  |                  lib/rag.ts                document retrieval
  |
  +-- lib/db.ts ---> SQLite  (your data, on your disk)
```

## Running it 24/7

There is a systemd unit at `scripts/chakor.service`. Edit the paths inside, then:

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
| `npm install` fails on peer deps | Use `npm install --legacy-peer-deps`. |
| Chat says it cannot connect | Is Ollama, LM Studio, or llama.cpp running, or did you set a cloud key. The model menu and Settings → Models both show which engines are up. |
| Local model keeps crashing | It is probably too big for your machine. Settings → Models marks it TOO BIG and suggests one that fits, or switch to Ollama or LM Studio from the model menu. |
| No models in the picker | Pull a model with `ollama pull`, load one in LM Studio, or add an API key, then reload. |
| Search finds nothing | Turn on `json` format in SearXNG, or set `BRAVE_SEARCH_API_KEY`. |
| Cannot sign in after first run | First account registered is the admin. Check `REGISTRATION_MODE` and `INVITE_CODE`. |

## Contributing

Pull requests are welcome. Keep the voice human (no emoji, no em dashes), run `npm run build` before you open one, and see [CONTRIBUTING.md](CONTRIBUTING.md) for the rest.

If Chakor is useful to you, **star the repo**. It is the single easiest way to help other people find a private alternative to the big AI apps.

## License

MIT. Do what you want with it. See [LICENSE](LICENSE).

<div align="center">
<br/>

**Built for people who would rather run their own tools.**

<sub><a href="#top">back to top</a></sub>

</div>
