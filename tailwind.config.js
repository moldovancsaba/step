/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'triangle-white': '#FFFFFF',
        'background-gray': '#E6E6E6', // 10% grey
      },
      opacity: {
        '50': '0.5',
      },
    },
  },
  plugins: [],
}

