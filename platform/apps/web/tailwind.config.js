/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core palette
        'bg-base':       '#080b12',
        'bg-surface':    '#0e1219',
        'bg-elevated':   '#141925',
        'bg-card':       '#1a2030',
        'bg-input':      '#1e2535',
        border:          '#252d40',
        'border-subtle': '#161d2b',
        'border-bright': '#2f3a54',

        // Text
        'text-primary':   '#edf0f8',
        'text-secondary': '#8b96b5',
        'text-muted':     '#4e5872',
        'text-faint':     '#323a52',

        // Brand accent
        accent:         '#5b8ef0',
        'accent-hover': '#4a7de0',
        'accent-dim':   '#3a6cd0',
        'accent-bright':'#7aaeff',
        purple:         '#bf5af2',

        // Semantic
        green:   '#30d158',
        red:     '#ff453a',
        amber:   '#ffa940',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        DEFAULT: '12px',
        lg: '16px',
        xl: '20px',
        pill: '999px',
      },
      boxShadow: {
        xs:     '0 1px 2px rgba(0,0,0,0.5)',
        sm:     '0 2px 6px rgba(0,0,0,0.55)',
        DEFAULT:'0 6px 20px rgba(0,0,0,0.6)',
        lg:     '0 12px 40px rgba(0,0,0,0.7)',
        accent: '0 4px 20px rgba(91,142,240,0.22)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.45', transform: 'scale(0.85)' },
        },
        'msg-in': {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'verdict-in': {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.97)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'typing-bounce': {
          '0%, 70%, 100%': { opacity: '0.3', transform: 'translateY(0)' },
          '35%':           { opacity: '1',   transform: 'translateY(-4px)' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
        'count-up-fade': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-dot':     'pulse-dot 2.4s ease-in-out infinite',
        'pulse-dot-fast':'pulse-dot 1.8s ease-in-out infinite',
        'msg-in':        'msg-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in':       'fade-in 200ms ease',
        'verdict-in':    'verdict-in 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        'typing-bounce': 'typing-bounce 1.3s ease-in-out infinite',
        'spin':          'spin 0.65s linear infinite',
        'count-up-fade': 'count-up-fade 400ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
