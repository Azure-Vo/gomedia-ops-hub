/** @type {import('tailwindcss').Config} */
// Visual system: "Paper & ink" (see DESIGN.md, Figma AgendalV1 · 04 Web). Warm paper canvas, white sheets
// on hairlines, near-black ink for text, one blue for anything you can click. Serif (Newsreader) for page
// titles only; Archivo for everything else. The kit's Instrument Sans has no Vietnamese glyphs and Be Vietnam
// Pro has no tabular figures, so Archivo (Vietnamese + tnum) stands in for it.
// Orange stays reserved for money totals and over-band prices.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Ops Amp', 'Archivo', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        display: ['Newsreader', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      borderRadius: {
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        // Paper sits flat: hairline edge, no blur.
        sheet: '0 0 0 0 transparent',
        lift: '0 16px 40px -12px rgba(27, 27, 26, 0.28), 0 2px 6px rgba(27, 27, 26, 0.08)',
        // Hard offset "ink" shadow from the kit's event cards; colour comes from --hard.
        hard: '3px 3px 0 var(--hard, #1B1B1A)',
      },
      colors: {
        // Dark surfaces (toasts, login side panel): ink, not navy.
        rail: { DEFAULT: '#1B1B1A', hover: '#2A2A28', active: '#2F5BD3', text: '#D9D9D4', group: '#A3A39C' },
        // 10 % · Primary: links, buttons, selection, today.
        brand: { DEFAULT: '#2F5BD3', dark: '#2549B0', soft: '#E8EDFB', line: '#B9C8F0' },
        accent: { DEFAULT: '#C2410C', strong: '#C24A00', soft: '#FFF0E8', line: '#F6B793' },
        // 30 % · Neutral
        ink: { DEFAULT: '#1B1B1A', 2: '#545450', 3: '#62625D' },
        line: { DEFAULT: '#DCDCD8', soft: '#E4E4E1', edge: '#D4D4D0', control: '#8A8A85' },
        // 60 % · Base
        canvas: '#EEEEEC',
        paper: '#FFFFFF',
        ok: { DEFAULT: '#2F7D4A', ink: '#226238', soft: '#E7F2EA', line: '#A6D2B4' },
        warn: { DEFAULT: '#8A4B00', soft: '#FBEFD9', line: '#EDC583' },
        bad: { DEFAULT: '#B42318', soft: '#FBE9E7', line: '#EBB0A9' },
        info: { DEFAULT: '#2F5BD3', soft: '#E8EDFB' },
        project: { blue: '#4E79D9', orange: '#E08A2E', green: '#4E9F6B', purple: '#8C63D2' },
      },
    },
  },
  plugins: [],
};
