# Contributing

Thanks for your interest in improving Chakor! This is a small, friendly project.

## Getting set up

1. Follow the [Quickstart](README.md#-quickstart) to get it running locally.
2. Use `npm run dev` for hot-reload during development (runs on port 3001).

## Workflow

- Branch off `main`, make your change, open a pull request.
- Keep PRs focused — one logical change per PR is easier to review.
- Run `npm run build` before submitting; it must compile and type-check cleanly.
- Match the existing code style (no separate formatter is enforced — just keep it consistent with nearby code).

## Where things live

| Area | Path |
|---|---|
| Assistant behavior / prompts | `lib/system-prompt.ts` |
| Model providers & streaming | `lib/providers.ts`, `lib/llama.ts`, `lib/models.ts` |
| Web search | `lib/searxng.ts` |
| Document retrieval (RAG) | `lib/rag.ts` |
| Database | `lib/db.ts` |
| Main chat UI | `components/ChatShell.tsx` |
| Branding / config | `lib/config.ts` |

## Good first contributions

- New model providers or updated model IDs.
- Additional document loaders for RAG.
- UI polish and accessibility improvements.
- Documentation and translation fixes.

## Reporting bugs

Open an issue with: what you expected, what happened, and steps to reproduce. Include your
Node version and whether you're using a local or cloud model.

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
