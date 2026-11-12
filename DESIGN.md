---
name: Go Media Ops Hub
description: Internal operations tool for Go Media, set like the agency's own service rate card.
colors:
  rail: "#071D57"
  rail-hover: "#0E2A72"
  rail-active: "#163A92"
  rail-text: "#C3CDEB"
  rail-group: "#8C9BCB"
  brand: "#082774"
  brand-dark: "#051A55"
  brand-soft: "#E9EEF9"
  brand-line: "#AFC0E6"
  accent: "#C2410C"
  accent-strong: "#C24A00"
  accent-soft: "#FFF0E8"
  accent-line: "#F6B793"
  ink: "#1B1A33"
  ink-2: "#46455C"
  ink-3: "#66657A"
  line: "#E2E0D9"
  line-soft: "#ECEBE5"
  canvas: "#F4F3EF"
  sheet: "#FFFFFF"
  ok: "#1E7E3A"
  ok-ink: "#17652E"
  ok-soft: "#E8F3EA"
  warn: "#8A4B00"
  warn-soft: "#FCEFD9"
  bad: "#A3213A"
  bad-soft: "#FBE6EA"
  info: "#30406E"
  info-soft: "#ECEEF4"
  star: "#E39A12"
typography:
  page-title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  table-head:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  tag: "4px"
  control: "6px"
  sheet: "8px"
  sheet-lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-dark}"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 16px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
    padding: "0 12px"
  tag:
    rounded: "{rounded.tag}"
    typography: "{typography.label}"
    padding: "1px 6px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
    padding: "24px"
  nav-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    height: "40px"
  total-bar:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
---

# Design System: Go Media Ops Hub

## Overview

Ops Hub is set like Go Media's own service rate card: a deep navy rail on the left and a neutral ivory-grey ground on which sections are divided by ink rules, not boxed into stacked cards. The only white sheet is the document being worked on (the quote). It is an Operate surface. Account and PM work in it all day on laptops, so familiarity, scanability and aligned figures come first; the brand shows in precise details: the logo navy, orange kept for money, and a heavy ink rule under every table head and above every key figure, the way a printed price list sets its columns.

The signature move is the **band ruler** on each quote line: a small scale centred on the library price with a marker at the entered price. It shows how far a price strays from the library. It never draws the CEO's band thresholds (those are CEO-only by RLS); it turns orange only on lines the server named as the reason the quote left the self-send band.

## Colors

### Primary
- **Logo navy** `brand` #082774: primary buttons, links, selection, focus. Sampled from the Go Media logo; it replaces the earlier violet #1800AD.
- **Rail navy** `rail` #071D57: the navigation rail, mobile header, sent-quote header and the login panel. The only large colour field in the app.

### Secondary
- **Money orange** `accent-strong` #C24A00 (white text 4.9:1) for the quote total bar; `accent` #C2410C for over-band prices only. Service-group bands are neutral (`canvas`), add actions are navy.

### Neutral
- `canvas` #F4F3EF ground, `sheet` white work areas, `line` / `line-soft` warm hairlines, `ink` / `ink-2` / `ink-3` text (ink-3 is 5.1:1 on canvas, also used for placeholders).

### Named Rules
- **The Money Rule**: orange is for money and for prices outside the band. Never decorative.
- **State colours carry meaning only**: green done/within band, amber warning and open comments, red CEO-level/overdue/error. `info` is a navy-slate, not a separate blue.

## Typography

One family, **Archivo**, self-hosted (@fontsource, weights 400–700, Vietnamese subset). Chosen over Be Vietnam Pro because Archivo has tabular figures; `font-variant-numeric: tabular-nums` is set on the body so money and hours align everywhere. Archivo's "&" reads like a letter, so U+0026 comes from the system sans through a unicode-range face named `Ops Amp`.

### Hierarchy
- Page title 26/700, tracking −0.02em. Section title 17/600. Key figure 34/600. Body 15/400. Labels 13/500. Table heads 12.5/600 in ink-2, sentence case.
- No uppercase tracked eyebrows or kickers anywhere.

## Layout

- Desktop: 240 px navy rail (sticky, full height) + content up to 1440 px with 32 px gutters. Mobile (< 1024 px): rail becomes a sticky navy top bar with a disclosure menu.
- Page header: title, subtitle (max 75ch) and actions, closed by a hairline.
- Quote builder: the quote sheet takes the full width up to ~1680 px viewports so every column (incl. Thành tiền) is visible; the review panel and similar quotes sit below it in two columns, and move beside it only on very wide screens.
- Wide tables scroll inside a `relative overflow-x-auto` wrapper (the `relative` keeps sr-only text from widening the page).

## Elevation & Depth

Flat by default. Page sections sit on the ground under a 1 px ink rule (`Card`). The quote document is the one white sheet (hairline + `shadow-sheet`). Banners are tinted bands without borders. Modals and toasts use `shadow-lift`. No glows, no glass.

## Shapes

Tight corners: tags 4 px, controls 6 px, sheets 8 px, large sheets 10 px. Pills only for avatars and status dots.

## Components

### Buttons
Primary navy fill, 40 px, 6 px radius, 1 px press. Secondary: white with a hairline, ink text (not blue outlines). Ghost: text with a 5% ink hover. Add actions: dashed orange hairline.

### Tags
Sentence-case, 12 px/600, 4 px radius, soft tone backgrounds. Price tags read "Giá thư viện", "Tự nhập +x%", "Ngoài thư viện", "Chi hộ".

### Sections (`Card`)
A section on the page ground: 1 px ink rule on top, title 17/600, subtitle, then content. No box, radius or shadow. Inside the quote sheet, status blocks are tinted bands or ruled bands (sent quote: 2 px navy rule), never bordered boxes.

### Inputs
40 px, 1 px hairline, focus = navy border + 3 px navy ring at 15%.

### Navigation
Navy rail; group labels in sentence case; active item on a lighter navy field with white semibold text.

### Key figures
Label above, 34 px figure, a 2 px ink rule on top, and a **baseline bar**: baseline vs now on one scale with the target as a tick.

### Band ruler (signature)
Spans the price column (144 px): 1 px track at 35% ink, quarter ticks, a 2 px ink centre tick = library price, an 11 px marker = entered price (clamped ±30%) joined to the centre by a 3 px run, label "+x% so với giá thư viện" underneath. Orange only when the server flagged that line. Below 640 px each quote line stacks (item / quantity + unit price with ruler / line total) so nothing scrolls sideways.

### Go Star podium
Three columns between ink rules, rank as a large numeral (no medal emoji); Employee of the Month gets a navy numeral, a navy-soft field and a brand tag. People with 0 stars show "—" for rank.

## Do's and Don'ts

### Do:
- Use the tokens; add a token before adding a hex value.
- Put a 2 px ink rule under table heads and above key figures.
- Keep every label and status text unchanged when restyling (e2e tests read them).

### Don't:
- Don't use uppercase tracked eyebrows, emoji or unicode glyphs as icons, gradient text, or coloured side stripes.
- Don't nest cards inside cards.
- Don't reveal price-band thresholds outside the CEO's rules page.
- Don't use orange for anything that is not money or an over-band price (not avatars, add buttons, section bands or awards).
