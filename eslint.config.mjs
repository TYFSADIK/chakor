// Flat ESLint config for the Next.js app (`next lint` is deprecated in 15.5).
// Run with: npx eslint .
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next*/**', 'node_modules/**', 'tests/**', 'next-env.d.ts', 'chakor-agent-workspace/**', '.venv/**'],
  },
];

export default config;
