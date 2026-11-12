---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/Layout.tsx"]
---

Scope: whole Ops Hub web app (all authenticated screens + login). Mode: Operate. Primary users Account and PM on laptops; CEO glances on phone.

## Direction contract

THESIS: Ops Hub reads like Go Media's own service rate card, not a lavender SaaS admin. It refuses the white-card-on-tinted-ground dashboard with purple accents and eyebrow labels.

OWN-WORLD: Deep brand-navy rail owns the left edge; content sits on a neutral ivory-grey ground with white work sheets separated by hairline rules, not stacked cards. One family, Be Vietnam Pro, self-hosted, tabular figures for money. Orange appears only on money totals and over-band prices; red only for CEO-level and errors; green only for within-band and done. Service groups are banded like rate-card sections.

STORY: Account sees which quotes are running and how many working hours each has used, builds a quote line by line, sees at once whether each price sits inside its band, and knows who must approve before sending.

FIRST VIEWPORT: Quote builder: navy rail left; header row with quote code, status and the working-hours clock; client fields as a compact two-row sheet; the line table full width with every column visible at 1280–1440 (review panel moves below or collapses); totals right-aligned under the table.

FORM: Agency rate card (position 5 of 7 grounded list; degraded roll, no challengers). seed:253921a54e4e8dc1. Signature move: the band ruler on each quote line, a thin scale of the library band with a tick at the entered price, coloured by band result.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Unresolved: dashboard S1 KPI source (business decision, untouched).
