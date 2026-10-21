/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'Arial', 'sans-serif'] },
      colors: {
        brand: { DEFAULT: '#1800AD', dark: '#10007A', soft: '#F1EEFF', line: '#A99BF0' },
        accent: { DEFAULT: '#C2410C', soft: '#FFF3E6', line: '#F5A26B' },
        ink: { DEFAULT: '#24224F', 2: '#4A4870', 3: '#5D5B80' },
        line: { DEFAULT: '#DEDCEB', soft: '#ECEAF3' },
        canvas: '#F4F3FA',
        ok: { DEFAULT: '#1E7E3A', ink: '#17652E', soft: '#E8F6EC', line: '#8BCB9C' },
        warn: { DEFAULT: '#8A4B00', soft: '#FFF0D6', line: '#F5C27A' },
        bad: { DEFAULT: '#A3213A', soft: '#FDE4EA', line: '#E4A3B1' },
      },
    },
  },
  plugins: [],
};
