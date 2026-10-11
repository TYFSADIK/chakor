import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Newsreader', 'Georgia', '"Times New Roman"', 'serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        display: ['"Old Standard TT"', 'Georgia', 'serif'],
        gothic: ['UnifrakturMaguntia', '"Old Standard TT"', 'serif'],
        type: ['"Special Elite"', '"JetBrains Mono"', 'monospace'],
        fell: ['"IM Fell English"', 'Georgia', 'serif'],
      },
      colors: {
        bg:    { DEFAULT: 'var(--bg)', 1: 'var(--bg-1)', 2: 'var(--bg-2)', 3: 'var(--bg-3)', 4: 'var(--bg-4)' },
        fg:    { DEFAULT: 'var(--fg)', 2: 'var(--fg-2)', 3: 'var(--fg-3)', 4: 'var(--fg-4)' },
        green: { DEFAULT: 'var(--g)', dim: 'var(--g-dim)', text: 'var(--g-text)' },
        ok:    'var(--ok)',
        err:   'var(--err)',
        warn:  'var(--warn)',
        // Terminal-flavored aliases used by the public share page.
        term: {
          bg:     'var(--bg)',
          panel:  'var(--bg-2)',
          text:   'var(--fg)',
          dim:    'var(--fg-3)',
          border: 'var(--bd-2)',
          green:  'var(--g-text)',
          amber:  'var(--warn)',
          cyan:   'var(--cyan)',
        },
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
