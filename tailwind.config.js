/** @type {import('tailwindcss').Config} */
// Visual system: "rate card" (see DESIGN.md). Deep brand-navy rail, neutral ivory-grey ground,
// white sheets on hairlines, one family (Archivo) with tabular figures. Orange is reserved for
// money totals and over-band prices.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Ops Amp', 'Archivo', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'] },
      borderRadius: {
        // Tighter corners across the app: printed-sheet feel, not pill-and-bubble SaaS.
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
      },
      boxShadow: {
        sheet: '0 1px 2px rgba(27, 26, 51, 0.06)',
        lift: '0 8px 24px -6px rgba(27, 26, 51, 0.18), 0 2px 6px rgba(27, 26, 51, 0.08)',
      },
      colors: {
        rail: { DEFAULT: '#071D57', hover: '#0E2A72', active: '#163A92', text: '#C3CDEB', group: '#8C9BCB' },
        // Logo navy #082774 is the brand; the logo's violet #600EE4 stays in the mark only.
        brand: { DEFAULT: '#082774', dark: '#051A55', soft: '#E9EEF9', line: '#AFC0E6' },
        accent: { DEFAULT: '#C2410C', strong: '#C24A00', soft: '#FFF0E8', line: '#F6B793' },
        ink: { DEFAULT: '#1B1A33', 2: '#46455C', 3: '#66657A' },
        line: { DEFAULT: '#E2E0D9', soft: '#ECEBE5' },
        canvas: '#F4F3EF',
        ok: { DEFAULT: '#1E7E3A', ink: '#17652E', soft: '#E8F3EA', line: '#9FD0AC' },
        warn: { DEFAULT: '#8A4B00', soft: '#FCEFD9', line: '#EDC583' },
        bad: { DEFAULT: '#A3213A', soft: '#FBE6EA', line: '#E4A3B1' },
        info: { DEFAULT: '#30406E', soft: '#ECEEF4' },
      },
    },
  },
  plugins: [],
};
