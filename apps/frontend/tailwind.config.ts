import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark with a subtle blue undertone — softer than pure black, still reads as "ink".
        ink: {
          900: '#16243C',
          700: '#2F3E5C',
          500: '#5C6A82',
          300: '#A4ADBE',
          100: '#E6E9EE',
        },
        paper: {
          50: '#FFFFFF',
          100: '#FAFBFC',
          200: '#F3F5F7',
          300: '#E6E9EE',
        },
        // Vibrant brand blue — used for "live" / active surfaces alongside the dark `ink`.
        accent: {
          DEFAULT: '#2B6CFF',
          soft: '#E7EFFF',
          ring: '#A6C0FF',
        },
        success: '#1DBF73',
        warn: '#F5A524',
        danger: '#E5484D',
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
        '3xl': '24px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(14, 16, 19, 0.04), 0 4px 16px rgba(14, 16, 19, 0.04)',
        bar: '0 -4px 24px rgba(14, 16, 19, 0.06)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
