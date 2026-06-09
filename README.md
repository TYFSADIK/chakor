<div align="center">

<img src="public/logo.svg" width="84" height="84" alt="Chakor logo" />

# Chakor

**Your AI, on your hardware. No cloud, no tracking, no big tech.**

Chakor is an open source AI workspace you run yourself. Point it at a local model or your own API keys, then chat, search the web, talk to your documents, and run real research. Your conversations stay on your machine, not in someone else's data center.

Think of it as a lighter, friendlier alternative to Open WebUI, and an open source answer to LM Studio that also runs on a server and on your phone.

[Quick start](#quick-start) &nbsp;·&nbsp; [Get a model](#getting-a-model) &nbsp;·&nbsp; [On your phone](#use-it-on-your-phone) &nbsp;·&nbsp; [For developers](#for-developers) &nbsp;·&nbsp; [Config](#configuration)

</div>

---

## Why this exists

Every big AI app wants the same deal. You hand over your questions, your documents, your half formed ideas at 2am, and they keep all of it on servers you will never see. That is the price of "free."

Self hosting flips that. You run the model. You hold the data. Nobody gets to mine your chats to sell you something later. Privacy is not a setting you toggle, it is where the software runs.

Chakor is built around that idea, and it tries to be genuinely nice to use while doing it.

## What you get

- **Run any model.** Local models through Ollama or llama.cpp, on GPU or plain CPU. Or bring your own keys for OpenAI, Anthropic, Google, and OpenRouter. Switch model per message, and swap the local model or its context size from the web with no terminal.
- **Stays private.** No telemetry. Conversations live in a local database on your machine. Cloud models only see a message if you pick a cloud model.
- **Web search built in.** Flip search on per message. Uses SearXNG, and falls back to Brave or DuckDuckGo on its own.
- **Talk to your files.** Drop in PDFs, text, or markdown and ask questions grounded in them.
- **Real research mode.** It plans a few angles, gathers sources, and writes a cited briefing instead of dumping links.
- **Multi user.** Accounts, an admin panel, and clean separation between users.
- **Works on your phone.** Installable as an app, and the interface is built for small screens too.
- **Yours to rebrand.** Change the name, tagline, and look from a config file. No code edits.

## Quick start

Pick whichever fits you. All three end with the app on **http://localhost:3001**. The first account you register becomes the admin.

### Option 1: Docker (works on Linux, macOS, Windows)

The least fuss. Install Docker Desktop or Docker Engine, then:

```bash
git clone <your-repo-url> chakor && cd chakor
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
git clone <your-repo-url> chakor && cd chakor
bash install.sh
```

On **Windows**, open PowerShell in the folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

On **Android**, install [Termux](https://termux.dev), then run the same `bash install.sh`. It uses Termux packages automatically.

### Option 3: Manual (for developers)

```bash
git clone <your-repo-url> chakor && cd chakor
npm install --legacy-peer-deps
cp .env.example .env.local            # then set AUTH_SECRET (openssl rand -base64 32)
npm run build
npm start
```

## Getting a model

Chakor needs something to talk to. Easiest options, in order:

1. **Ollama (recommended).** Install it from [ollama.com](https://ollama.com), then pull a model:
   ```bash
   ollama pull llama3.2
   ```
   Chakor finds installed Ollama models on its own and lists them in the model picker. This is the simplest way to "run any model."

2. **llama.cpp.** Point `LLAMA_SERVER_BIN` at your `llama-server` and `LLAMA_GGUF` at a model, and Chakor runs it for you as part of the same service. From **Settings → Models** you then switch the model and context size from the web, no terminal. Drop more `.gguf` files in `~/Downloads` (or set `CHAKOR_MODELS_DIR`) and they show up to switch to. Already run your own `llama-server`? Set `LLAMA_BASE_URL` and `CHAKOR_SUPERVISE_LLAMA=false` and Chakor just uses it.

3. **Cloud keys.** Paste a key into `.env.local` and that provider's models show up:
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`.

4. **OpenRouter.** One key for hundreds of models, including the big ones. Set `OPENROUTER_API_KEY` and list the models you want in `OPENROUTER_MODELS`.

## Use it on your phone

Two ways:

- **From any phone on your network.** Open the server address in your phone browser, then use "Add to Home Screen." It installs like a normal app, full screen, no browser bars.
- **On the phone itself.** Install Termux and run `bash install.sh`. Your phone becomes the server.

## Configuration

Everything lives in `.env.local`. The ones you will actually touch:

| Setting | What it does |
| --- | --- |
| `AUTH_SECRET` | Required. Signs login sessions. Generate with `openssl rand -base64 32`. |
| `REGISTRATION_MODE` | `open`, `invite`, or `closed`. With `invite`, also set `INVITE_CODE`. |
| `OLLAMA_BASE_URL` | Where Ollama runs. Default is fine for a local install. |
| `LLAMA_SERVER_BIN`, `LLAMA_GGUF` | llama.cpp binary + default model Chakor runs for you. Switch both live in Settings → Models. |
| `CHAKOR_MODELS_DIR`, `CHAKOR_SUPERVISE_LLAMA` | Extra folders to scan for `.gguf` files; set supervise to `false` to run llama-server yourself. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` | Turn on cloud models. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` | One key, many models. List them as `id|Label`, comma separated. |
| `SEARXNG_URL`, `BRAVE_SEARCH_API_KEY` | Web search backends. |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TAGLINE`, `APP_CREATOR` | Rebrand the app. |

### Make it yours

Set these and rebuild, and the name shows up everywhere from the sidebar to the browser tab to the assistant's own answers:

```bash
NEXT_PUBLIC_APP_NAME="Acme AI"
NEXT_PUBLIC_APP_TAGLINE="Our team's private assistant."
APP_CREATOR="Your Name"
```

## For developers

- **Stack:** Next.js 15, React 19, TypeScript, Tailwind, SQLite via better-sqlite3, Auth.js v5.
- **Where things live:**
  - Assistant behavior and personality: `lib/system-prompt.ts` (plain English, edit away)
  - Model providers and streaming: `lib/providers.ts`, `lib/llama.ts`, `lib/models.ts`
  - Web search: `lib/searxng.ts`
  - Document retrieval: `lib/rag.ts`
  - Database: `lib/db.ts` (schema self creates on first run)
  - Branding and config: `lib/config.ts`
- **Add a model provider:** add a `stream*` function in `lib/providers.ts`, register it in `lib/models.ts`, and route it in `app/api/chat/route.ts`. The existing providers are short and copy friendly.
- **Run for development:** `npm run dev` (hot reload on port 3001).
- Before a pull request, run `npm run build` so it type checks. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

```
Browser
  |
  v
Next.js app (app/, components/)
  |
  +-- /api/chat ---> lib/system-prompt.ts   (how the assistant behaves)
  |                  lib/llama.ts            (local llama.cpp)
  |                  lib/providers.ts        (ollama, openai, anthropic, google, openrouter)
  |                  lib/searxng.ts          (web search, with fallbacks)
  |                  lib/rag.ts              (document retrieval)
  |
  +-- lib/db.ts ---> SQLite (your data, on your disk)
```

## Running it 24/7

There is a systemd unit at `scripts/chakor.service`. Edit the paths inside, then:

```bash
sudo cp scripts/chakor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chakor
```

Or just leave the Docker container running, it restarts itself.

## FAQ

**Do I need a GPU?** No. CPU works, just slower. Or use a cloud key and run nothing locally.

**Is my data sent anywhere?** No, unless you turn on web search or pick a cloud model. Then only those requests go out, and only to the provider you chose.

**Answers too long or too short?** Edit `buildSystemPrompt()` in `lib/system-prompt.ts`. It is written in normal language.

**How is this different from Open WebUI or LM Studio?** It is lighter than Open WebUI and simpler to run, it is open source unlike LM Studio, and it runs anywhere including a phone. It is also openly opinionated about privacy and self hosting.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm install` fails on peer deps | Use `npm install --legacy-peer-deps`. |
| Chat says it cannot connect | Is Ollama or llama.cpp running, or did you set a cloud key. |
| No models in the picker | Pull a model with `ollama pull`, or add an API key, then reload. |
| Search finds nothing | Turn on `json` format in SearXNG, or set `BRAVE_SEARCH_API_KEY`. |
| Cannot sign in after first run | First account registered is the admin. Check `REGISTRATION_MODE`. |

## License

MIT. Do what you want with it. See [LICENSE](LICENSE).

<div align="center">
<br>
Built for people who would rather run their own tools.
</div>
