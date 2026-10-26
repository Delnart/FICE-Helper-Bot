import type { Config } from 'tailwindcss';

// Every color is a CSS variable from globals.css, so light/dark themes come for free.
// Opacity modifiers (`bg-accent/10`) don't work with these — use the *-soft tokens instead.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' },
        line: { DEFAULT: 'var(--line)', 2: 'var(--line-2)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
        accent: {
          DEFAULT: 'var(--accent)',
          ink: 'var(--accent-ink)',
          soft: 'var(--accent-soft)',
          text: 'var(--accent-text)',
        },
        lime: { DEFAULT: 'var(--lime)', ink: 'var(--lime-ink)' },
        now: {
          bg: 'var(--now-bg)',
          'bg-2': 'var(--now-bg-2)',
          ink: 'var(--now-ink)',
          muted: 'var(--now-muted)',
          accent: 'var(--now-accent)',
          'accent-ink': 'var(--now-accent-ink)',
        },
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        bad: { DEFAULT: 'var(--bad)', soft: 'var(--bad-soft)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)' },
      },
      borderRadius: {
        xl: '14px',
        '2xl': '20px',
        '3xl': '24px',
      },
      boxShadow: {
        card: 'var(--shadow)',
        bar: 'var(--shadow-bar)',
      },
      // Size only: line-height comes from the type classes (.h1/.h3/.small…) or the body,
      // so `h3 text-base` doesn't silently swap .h3's 1.35 for Tailwind's 1.5rem.
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
