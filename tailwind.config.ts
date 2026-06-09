import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg:    { DEFAULT: 'var(--bg)', 1: 'var(--bg-1)', 2: 'var(--bg-2)', 3: 'var(--bg-3)', 4: 'var(--bg-4)' },
        fg:    { DEFAULT: 'var(--fg)', 2: 'var(--fg-2)', 3: 'var(--fg-3)', 4: 'var(--fg-4)' },
        green: { DEFAULT: 'var(--g)', dim: 'var(--g-dim)', text: 'var(--g-text)' },
        ok:    'var(--ok)',
        err:   'var(--err)',
        warn:  'var(--warn)',
      },
      borderColor: {
        DEFAULT: 'var(--bd)',
        2: 'var(--bd-2)',
        3: 'var(--bd-3)',
        g: 'var(--g-bd)',
      },
      boxShadow: {
        g:  'var(--sh-g)',
        md: 'var(--sh)',
        lg: 'var(--sh-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
