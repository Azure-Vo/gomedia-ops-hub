# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Account** (primary, on a laptop most of the day): turns a client request into a quote, keeps it inside the price bands, sends it for review when needed, then exports the PDF and sends it.
- **PM** (primary, laptop): reviews quotes that fall outside the bands, comments on specific lines through a review link, keeps the price library and quote terms, and scores staff for Go Star.
- **CEO**: approves quotes that need CEO level, edits price rules, closes the Go Star month; often glances from a phone.
- **E-commerce Exec and Staff**: work Lark tasks; staff see the Go Star board read-only.
- **Admin**: users, settings, Lark connection, diagnostics.

All users work in Vietnamese.

## Product Purpose

Ops Hub is Go Media's internal operations tool, built as the BC26 capstone prototype for a digital marketing agency in Đà Nẵng. It targets two measured problems:

- **S2 · Slow quotes**: 52.6% of quotes took more than 8 working hours. Ops Hub gives Account a quote builder on a shared price library, a band check that routes only out-of-band quotes to PM or CEO, line-level review by link, and a PDF in Go Media's own format. Success: late-quote rate ≤ 30% and a shorter average time per quote.
- **S1 · Late e-commerce tasks**: 55.2% of tasks were late. Ops Hub creates tasks through a Lark bot, reminds at D-3/D-2/D-1 and every day after, and recognises people monthly through Go Star.

A KPI dashboard computes these figures from saved timestamps in working hours.

## Positioning

The time spent on every quote is measured in Go Media's own working hours, from the moment the client asked. Approval is triggered by the price band, not by habit, so only exceptions wait for a manager.

## Operating Context

- Quotes are made at a desk during working hours, often several in parallel; the client is waiting.
- Review happens by link: a PM or CEO opens the quote and comments on the exact line.
- The output that leaves the company is the PDF in Go Media's template.
- Notifications go to Lark (S1) and Telegram (S2).
- The prototype is presented to the CEO and the capstone committee; the Pilot holds labelled showcase data until the real pilot.

## Capabilities and Constraints

- Stack: React 18 + Vite + TypeScript + Tailwind on GitHub Pages; Supabase (Postgres + RLS, one Edge Function).
- Business rules live in `src/domain`. Visible copy follows the A3.1 deck.
- Roles gate routes and data (RLS); UI must not imply actions a role cannot take.
- Open decisions: Go Star thresholds, D0 reminders, Lark task code format, VAT on pass-through budget, dashboard S1 KPI source (old checkpoint module vs Lark).

## Brand Commitments

- Go Media logo and mark (`public/brand/`).
- Brand colours stay recognisable: the logo navy (#082774, sampled from the logo; the earlier UI used violet #1800AD) and orange from the logo. Tones and proportions may be adjusted.
- UI typeface: Archivo, self-hosted, chosen for Vietnamese support and tabular figures (Be Vietnam Pro has none).
- Quote PDF uses Go Media's template colours (navy #1F2238, orange #D9822B, cream).

## Evidence on Hand

- Real: 23 price library items and 10 quote terms from the CEO (prices not yet confirmed as final); baselines from 19 historical quotes and 29 tasks.
- Synthetic: all people, clients and showcase quotes/tasks on the Pilot are invented and labelled "(mẫu)" or DEMO-. Never present them as real results.

## Product Principles

1. Time is the product: anything that slows an Account down is a defect.
2. Show exceptions, not everything: managers see what needs them.
3. Every number traces back to a timestamp and a definition in the PRD.
4. Labels and states must match the database truth for every role.

## Accessibility & Inclusion

WCAG 2.1 AA for contrast and keyboard use; Vietnamese diacritics must render cleanly at all sizes.
