/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // NimbusVault design system colors
        background: 'var(--background, #050505)',
        foreground: 'var(--foreground, #f3f3f1)',
        card: 'var(--card, #0a0a0a)',
        'card-foreground': 'var(--card-foreground, #f3f3f1)',
        primary: 'var(--primary, #ff5100)',
        'primary-foreground': 'var(--primary-foreground, #050505)',
        secondary: 'var(--secondary, #1a1a1a)',
        'secondary-foreground': 'var(--secondary-foreground, #f3f3f1)',
        muted: 'var(--muted, #1a1a1a)',
        'muted-foreground': 'var(--muted-foreground, #888)',
        accent: 'var(--accent, #1a1a1a)',
        'accent-foreground': 'var(--accent-foreground, #f3f3f1)',
        destructive: 'var(--destructive, #ff5100)',
        'destructive-foreground': 'var(--destructive-foreground, #050505)',
        border: 'var(--border, rgba(255,255,255,.14))',
        ring: 'var(--ring, #ff5100)',
      },
      borderRadius: {
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
      },
      fontFamily: {
        sans: ['Arial', 'Helvetica', 'sans-serif'],
        condensed: ['Arial Narrow', 'Roboto Condensed', 'Impact', 'Haettenschweiler', 'sans-serif'],
      },
      animation: {
        'rise-in': 'rise-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'core-float': 'core-float 5s ease-in-out infinite',
        'orbit-spin': 'orbit-spin 20s linear infinite',
        'node-pulse': 'node-pulse 2.4s ease-in-out infinite',
        'soft-pulse': 'soft-pulse 3.5s ease-in-out infinite',
        'grid-drift': 'grid-drift 18s linear infinite',
        'scan-sweep': 'scan-sweep 0.9s ease',
        'section-reveal': 'section-reveal 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'orb-pulse': 'orb-pulse 3.2s ease-in-out infinite',
        'auth-page-in': 'auth-page-in 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'core-float': {
          '0%, 100%': { transform: 'rotate(-8deg) skewY(3deg) translateY(0)' },
          '50%': { transform: 'rotate(-5deg) skewY(3deg) translateY(-11px)' },
        },
        'orbit-spin': {
          to: { transform: 'rotate(394deg)' },
        },
        'node-pulse': {
          '50%': { transform: 'scale(1.8)', opacity: '0.55' },
        },
        'soft-pulse': {
          '50%': { boxShadow: '0 0 40px rgba(94, 220, 243, 0.22)' },
        },
        'grid-drift': {
          to: { backgroundPosition: '72px 72px' },
        },
        'scan-sweep': {
          to: { transform: 'translateX(100%)' },
        },
        'section-reveal': {
          from: { opacity: '0.35', transform: 'translateY(34px) scale(0.985)', filter: 'blur(5px)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        },
        'orb-pulse': {
          '0%, 100%': { boxShadow: '0 0 70px rgba(135, 103, 240, 0.42), inset 0 0 27px rgba(226, 217, 255, 0.2)' },
          '50%': { boxShadow: '0 0 110px rgba(135, 103, 240, 0.7), inset 0 0 38px rgba(226, 217, 255, 0.35)' },
        },
        'auth-page-in': {
          from: { opacity: '0', transform: 'scale(1.015)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}