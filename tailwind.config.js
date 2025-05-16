/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}', // Next.js app directory
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Base colors for the application
        border: "#e5e7eb",
        background: "#ffffff",
        foreground: "#171717",
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
          DEFAULT: '#0ea5e9',
        },
        // Triangle state colors
        triangle: {
          new: 'white',
          ready: '#d1d5db', // gray-300
          subdivide: '#f97316', // orange-500
          maxLevel: 'red',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)'],
        mono: ['var(--font-roboto-mono)'],
      },
      spacing: {
        '128': '32rem',
        '144': '36rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      transitionProperty: {
        'height': 'height',
        'spacing': 'margin, padding',
      },
      // Add OpenStreetMap specific styles
      zIndex: {
        'map': '10',
        'overlay': '20',
        'controls': '30',
        'modal': '50',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms')({ strategy: 'class' }),
  ],
}

