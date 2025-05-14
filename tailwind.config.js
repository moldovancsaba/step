/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class', // 'media' or 'class'
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        secondary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
        // For the globe visualization
        globe: {
          ocean: '#1e3a8a', // deep blue
          land: '#15803d', // forest green
          highlight: '#f59e0b', // amber
          selected: '#dc2626', // red for selected triangles
        },
      },
      fontFamily: {
        sans: ['Inter var', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      spacing: {
        '128': '32rem',
        '144': '36rem',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
      },
      transitionDuration: {
        '2000': '2000ms',
        '3000': '3000ms',
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'bounce-slow': 'bounce 3s infinite',
        'globe-rotate': 'rotate 60s linear infinite',
      },
      keyframes: {
        rotate: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      gridTemplateColumns: {
        'auto-fit': 'repeat(auto-fit, minmax(250px, 1fr))',
        'auto-fill': 'repeat(auto-fill, minmax(250px, 1fr))',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
    require('tailwindcss-animate'),
  ],
  safelist: [
    // For dynamic color classes in the globe visualization
    'bg-[#f8fafc]', // 100% brightness (white)
    'bg-[#e2e8f0]', // 90% brightness
    'bg-[#cbd5e1]', // 80% brightness
    'bg-[#94a3b8]', // 70% brightness
    'bg-[#64748b]', // 60% brightness
    'bg-[#475569]', // 50% brightness
    'bg-[#334155]', // 40% brightness
    'bg-[#1e293b]', // 30% brightness
    'bg-[#0f172a]', // 20% brightness
    'bg-[#020617]', // 10% brightness
    'bg-[#000000]', // 0% brightness (black)
    'bg-red-600', // Selected state
    // For dynamic size classes
    'scale-100',
    'scale-105',
    'scale-110',
    'scale-125',
    'scale-150',
    // For visibility transitions
    'opacity-0',
    'opacity-25',
    'opacity-50',
    'opacity-75',
    'opacity-100',
  ],
};

