---
name: Go Media Ops Hub
description: Internal operations tool for Go Media, set in the "Paper & ink" system (Figma AgendalV1 · 04 Web).
colors:
  canvas: "#EEEEEC"
  paper: "#FFFFFF"
  ink: "#1B1B1A"
  ink-2: "#545450"
  ink-3: "#62625D"
  line: "#DCDCD8"
  line-soft: "#E4E4E1"
  line-edge: "#D4D4D0"
  line-control: "#8A8A85"
  brand: "#2F5BD3"
  brand-dark: "#2549B0"
  brand-soft: "#E8EDFB"
  brand-line: "#B9C8F0"
  accent: "#C2410C"
  accent-strong: "#C24A00"
  accent-soft: "#FFF0E8"
  ok: "#2F7D4A"
  ok-ink: "#226238"
  ok-soft: "#E7F2EA"
  warn: "#8A4B00"
  warn-soft: "#FBEFD9"
  bad: "#B42318"
  bad-soft: "#FBE9E7"
  rail: "#1B1B1A"
  project-blue: "#4E79D9"
  project-orange: "#E08A2E"
  project-green: "#4E9F6B"
  project-purple: "#8C63D2"
  star: "#E39A12"
typography:
  page-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "38px"
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  nav-group:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
    textTransform: uppercase
rounded:
  tag: "6px"
  control: "12px"
  nav: "8px"
  sheet: "16px"
  button: "999px"
components:
  button-primary: { backgroundColor: "{colors.brand}", textColor: "{colors.paper}", rounded: "{rounded.button}", height: "38px" }
  button-secondary: { backgroundColor: "{colors.paper}", border: "1px {colors.line-edge}", textColor: "{colors.ink}", rounded: "{rounded.button}" }
  input: { backgroundColor: "{colors.paper}", border: "1px {colors.line-control}", rounded: "{rounded.control}", height: "40px", focus: "1px brand border + 1px brand ring" }
  sheet: { backgroundColor: "{colors.paper}", border: "1px {colors.line}", rounded: "{rounded.sheet}", padding: "20px" }
  nav-item-active: { backgroundColor: "{colors.brand-soft}", textColor: "{colors.brand}", rounded: "{rounded.nav}", height: "36px" }
---

# Design System: Go Media Ops Hub · Paper & ink

## Overview

Since 1.7 (23/11/2026) Ops Hub follows the **Paper & ink** system from the Figma file *AgendalV1 Prototype · 04 Web* (variables `60 Base`, `30 Neutral`, `10 Primary`). A warm grey paper canvas, white sheets on hairlines, near-black ink for text and rules, and one blue for everything you can click. Page titles are set in a serif like a printed heading; everything else is a plain grotesque. The quote PDF keeps its own Go Media letterhead (navy and orange from the logo) and is not themed.

## Colors

- **60 % Base**: `canvas` #EEEEEC behind everything, `paper` white for sheets, sidebar, modals and inputs.
- **30 % Neutral**: `ink` #1B1B1A text and rules, `ink-2` secondary text, `ink-3` tertiary/placeholder; `line` hairlines, `line-edge` card and secondary-button edges, `line-control` input borders (3:1 on white).
- **10 % Primary**: `brand` #2F5BD3 for buttons, links, the selected nav item, today, focus. Never decorative.
- **Money orange** `accent` / `accent-strong`: only money totals and over-band prices (unchanged Money Rule).
- **Semantic** ok / warn / bad are for status only. `rail` is now ink and is used for dark surfaces (login panel, toasts).
- **Project colours** `project-*` from the kit are available for project swatches and the hard offset shadow (`shadow-hard` with `--hard`).

## Typography

- **Newsreader 600** (serif, Vietnamese + tabular figures) for every `h1`: page titles 32/38, the login wordmark, the sidebar "Ops Hub".
- **Archivo** for everything else. The kit uses Instrument Sans, which has no Vietnamese glyphs (ơ, ư, ạ…); Be Vietnam Pro was tried but has no tabular figures, so money columns would not line up. Archivo has both.
- Body 14.5, section titles 17/600, labels 13/500, table heads 12.5/600 ink-2. Nav group labels are small uppercase with 0.06em tracking, as in the kit's eyebrows.

## Layout

- Desktop: 260 px white sidebar with a right hairline, content up to 1440 px with 40 px gutters. Mobile (< 1024 px): white top bar with a hairline and a disclosure menu.
- Page header: serif title + one-line subtitle in ink-2, actions on the right, no rule underneath.
- Lists of items (Inbox groups, project lists) sit in one white sheet (radius 16, 1 px line) with hairline separators, the section title above the sheet.

## Elevation & shapes

Paper sits flat: no blur shadows on sheets or buttons. Modals and toasts use `shadow-lift`. The kit's hard offset shadow (`3px 3px 0`) is available as `shadow-hard` for event-like cards. Radii: tags 6, nav items 8, inputs 12, sheets/modals 16, buttons fully round (pills).

## Icons

One set: **Lucide** (`lucide-react`, ISC), 1.75 px stroke, through `<Icon name="…">` in `components/ui.tsx`. No emoji or unicode glyphs as icons (Lark message previews excepted, since they show what the bot sends). Add a name to the `ICONS` map rather than importing ad hoc; Go Star's filled stars are Lucide `Star` with `fill-current`.

## Components

- **Buttons**: primary blue pill; secondary white pill with `line-edge`; ghost text with a 6 % ink hover; success is an ink pill; danger white with red text.
- **Inputs**: white, `line-control` border, radius 12, focus = blue border + 1 px blue ring.
- **Card (section)**: white sheet, radius 16, 1 px `line`, 20 px padding, title 17/600.
- **Stat**: white sheet with label, 30 px figure.
- **Badges**: radius 6, 12/500, soft tone backgrounds; always sans even inside a serif title.
- **Navigation**: ink items, 18 px Lucide icons; active = `brand-soft` field with blue semibold text; counts as an ink pill.
- **Modal**: white, radius 16, no header/footer rules, 30 % ink scrim.

## Do's and Don'ts

### Do
- Use the tokens; add a token before adding a hex value.
- Keep a 2 px ink rule under table heads (the "ink" in Paper & ink).
- Keep every label and status text unchanged when restyling (e2e tests read them).

### Don't
- Don't use emoji or unicode glyphs as icons, gradient text or glass.
- Don't use blue for decoration or orange for anything that is not money.
- Don't nest sheets inside sheets.
- Don't reveal price-band thresholds outside the CEO's rules page.
