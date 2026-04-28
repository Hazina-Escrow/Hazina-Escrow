/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Core Hazina palette
        void: '#0A0A0F',
        'void-2': '#0F0F1A',
        'void-3': '#14141F',
        surface: '#1A1A2E',
        'surface-2': '#1E1E35',
        border: '#2A2A45',
        'border-gold': '#C9A84C',
        gold: '#C9A84C',
        'gold-light': '#E8C96A',
        'gold-dim': '#8B6F2E',
        amber: '#F59E0B',
        'amber-glow': '#FCD34D',
        muted: '#6B7280',
        'muted-2': '#4B5563',
        foreground: '#F1F0EC',
        'foreground-muted': '#A8A5A0',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #C9A84C 0%, #E8C96A 50%, #C9A84C 100%)',
        'void-gradient': 'linear-gradient(180deg, #0A0A0F 0%, #14141F 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(26,26,46,0.8) 0%, rgba(20,20,31,0.9) 100%)',
        'gold-shimmer': 'linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.15) 50%, transparent 100%)',
      },
      boxShadow: {
        gold: '0 0 20px rgba(201,168,76,0.15), 0 0 60px rgba(201,168,76,0.05)',
        'gold-md': '0 0 30px rgba(201,168,76,0.25), 0 0 80px rgba(201,168,76,0.08)',
        'gold-lg': '0 0 50px rgba(201,168,76,0.3), 0 0 100px rgba(201,168,76,0.1)',
        card: '0 4px 24px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)',
        'card-hover': '0 8px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.4), 0 0 20px rgba(201,168,76,0.1)',
        inner: 'inset 0 1px 0 rgba(201,168,76,0.1)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-delay': 'float 6s ease-in-out infinite 2s',
        'pulse-gold': 'pulseGold 3s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'count-up': 'countUp 1.5s ease-out forwards',
        'fade-up': 'fadeUp 0.6s ease-out forwards',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        pulseGold: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
