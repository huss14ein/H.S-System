/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./{components,pages,hooks,App,context}/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        primary: '#2563eb', // blue-600
        secondary: '#7c3aed', // violet-600
        accent: '#db2777', // pink-600
        success: '#16a34a', // green-600
        warning: '#f97316', // orange-600
        danger: '#dc2626', // red-600
        light: '#f8fafc', // slate-50
        dark: '#1f2937', // gray-800
      },
    },
  },
  plugins: [],
}
