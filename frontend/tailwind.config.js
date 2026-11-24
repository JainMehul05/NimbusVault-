/** @type {import('tailwindcss').Config} */
// NimbusVault design tokens. Values live as CSS variables in src/index.css (:root);
// Tailwind only maps names to them so every screen draws from one palette.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: token('card'),
        'card-foreground': token('foreground'),
        surface: {
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
        },
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          foreground: token('primary-foreground'),
        },
        'primary-foreground': token('primary-foreground'),
        secondary: token('surface-raised'),
        'secondary-foreground': token('foreground'),
        muted: token('surface-raised'),
        'muted-foreground': token('muted-foreground'),
        subtle: token('subtle-foreground'),
        accent: token('surface-raised'),
        'accent-foreground': token('foreground'),
        destructive: token('danger'),
        'destructive-foreground': token('danger-foreground'),
        danger: token('danger'),
        success: token('success'),
        warning: token('warning'),
        info: token('info'),
        border: {
          DEFAULT: 'rgb(var(--border) / 0.10)',
          strong: 'rgb(var(--border) / 0.18)',
        },
        ring: token('primary'),
      },
      borderRadius: {
        // The brand is sharp-edged; radii stay small and consistent.
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        full: '9999px',
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
        condensed: ['"Arial Narrow"', '"Roboto Condensed"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['22px', { lineHeight: '28px' }],
        '2xl': ['28px', { lineHeight: '32px' }],
        '3xl': ['36px', { lineHeight: '40px' }],
      },
      boxShadow: {
        // Elevation scale: e1 cards, e2 menus/popovers, e3 dialogs. "brand" is the offset accent shadow.
        e1: '0 1px 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px rgb(0 0 0 / 0.4)',
        e2: '0 8px 24px rgb(0 0 0 / 0.5), 0 0 0 1px rgb(255 255 255 / 0.08)',
        e3: '0 24px 64px rgb(0 0 0 / 0.65), 0 0 0 1px rgb(255 255 255 / 0.10)',
        brand: '6px 6px 0 rgb(255 81 0 / 0.12)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '280ms',
      },
      animation: {
        'rise-in': 'rise-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in': 'slide-in 0.3s ease-out',
        'fade-in': 'fade-in 160ms ease-out both',
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'toast-in': 'toast-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'drawer-in': 'drawer-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'drawer-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.9' },
        },
      },
    },
  },
  plugins: [],
}
