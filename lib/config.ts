/**
 * Central app configuration — makes the whole project rebrandable from .env.
 *
 * Every name/tagline the user sees flows through here. Fork the repo, set
 * APP_NAME in your .env.local, and the UI, metadata, and the assistant's
 * own identity all update — no code changes required.
 */

export const APP = {
  /** Product name shown in the UI, metadata, and the assistant's identity. */
  name: process.env.NEXT_PUBLIC_APP_NAME ?? process.env.APP_NAME ?? 'Chakor',
  /** One-line tagline for the landing page and social cards. */
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ??
    process.env.APP_TAGLINE ??
    'Your AI, on your hardware. No cloud, no tracking, no big tech.',
  /** Longer description for SEO / Open Graph. */
  description:
    process.env.APP_DESCRIPTION ??
    'An open source AI workspace you run yourself. Use local models with llama.cpp or Ollama, or plug in your own API keys. Web search, chat with your documents, and a real research mode. Your data never leaves your machine.',
  /** Optional public URL (used for canonical links + Open Graph). */
  url: process.env.AUTH_URL ?? process.env.APP_URL ?? 'http://localhost:3001',
  /** Credit line — set to your name/handle, or leave blank. */
  creator: process.env.APP_CREATOR ?? '',
} as const;

export type AppConfig = typeof APP;
