# Go Media Ops Hub

Internal web app for Go Media's 4–6 week pilot (BC26 Team 6 capstone):

- **S1 on Lark (brief A2.3, 1.2)**: staff create parent / sub-tasks through the Lark bot (`/taomoi …`) with code checks, preview and confirm; tasks live on Lark Tasks; every day at 09:00 the bot reminds the group at D-3, D-2, D-1 and from D+1, tagging the assignee, in the CEO's card layout, until the sub-task is Completed with valid codes. One message per task per day (database key), retries on send errors, restart-safe. Simulation mode runs the whole flow without a Lark app. Admin → "Kết nối Lark" holds App ID, secrets (Vault), group, code rules.
- **Quotation Builder (S2 Option A)**: Pricing Library, price-band check (send now / PM / CEO), approvals, Reference Archive, PDF in Go Media's own layout (1.1: client block, numbered sections, scope text per line, VAT shown separately, terms checklist, pass-through money such as ads budgets kept out of discount, band and VAT).
- **Review on the quote (1.3)**: the Account copies the quote's link for the PM / CEO, who sign in and comment on the exact line, section or block (no PDF or email round-trip). Open comments block approving and sending; the Account replies and marks each one done, then exports the final PDF. Comments are internal (PM, CEO, Admin and the quote's owner).
- **Task Checkpoint Bot (S1 Option A)**: 4 verifiable milestones per task, check-ins at 25/50/75/99% of working time over Telegram or the web, alerts for Behind / Blocked / No reply / Overdue, closing at the deadline.
- **KPI dashboard**: every figure computed from stored timestamps in working hours, with CSV export.

UI in Vietnamese. Requirements and decisions: the "Go Media Ops Hub — PRD & Build Guide" doc (PRD wins over the Build Guide). Deployment, step by step in Vietnamese: its tab **Hướng dẫn triển khai (b)**.

## Layout

| Path | What it is |
| --- | --- |
| `src/domain/` | Every business rule, pure TypeScript (no React, no database): working-hour calendar, band check, checkpoint times, answer effects, KPIs, CSV validation, the 15 Diagnostics cases. Runs in Vitest, in the browser (Diagnostics) and in the Edge Function. |
| `src/` (rest) | React 18 + Vite + Tailwind web app. Runtime config in `public/config.js`, so one build serves the Pilot and the Demo projects. |
| `supabase/functions/ops-hub/` | The single Edge Function: `/api` (user actions), `/telegram-webhook`, `/dispatch-checkpoints`, `/close-tasks`, `/health`. |
| `supabase/setup/` | `01_schema.sql` (14 tables, RLS, service-only SQL functions; re-runnable), `upgrade_1.1_quote_format.sql`, `upgrade_1.2_lark.sql` and `upgrade_1.3_quote_review.sql` (minimal upgrades, no drops), `clear_sample_data.sql`, `02_cron.sql` (pg_cron + Vault), `03_first_admin.sql`, `email_magic_link.html`. |
| `scripts/build-function.mjs` | Bundles the function and the domain into one paste-in file, `dist/edge/ops-hub/index.ts`. |
| `scripts/prepare_data.py` | Step 0 data prep: anonymises clients, builds the library from median approved prices, cleans the task sheet. Standard library only. |
| `step0/` | CSV templates and the Step 0 guide (Vietnamese). |
| `tools/local-stack/` | Local test stack: Postgres + PostgREST + a gateway that mocks Supabase Auth and the Telegram Bot API; RLS, API and Playwright end-to-end tests. |

## Commands

```bash
npm install
npm test                      # domain + CSV unit tests (Vitest)
npm run typecheck
npm run build                 # web app → dist/web (upload this folder; edit dist/web/config.js first)
npm run build:function        # Edge Function → dist/edge/ops-hub/index.ts
python -m unittest scripts/test_prepare_data.py
```

The local stack tests (`tools/local-stack/rls.test.mjs`, `api.test.mjs`, `e2e.mjs`) need a local Postgres 16 with `tools/local-stack/supabase-stub.sql`, PostgREST and Playwright; see the header of each file.

## Rules for changes

- One feature at a time; run Diagnostics after every change. Business rules stay in `src/domain`.
- Never disable RLS to make something work. Secrets live only in Supabase Edge Function secrets and Vault.
- Never commit real client data: `private/` and `step0/out/` are git-ignored.
- No new features while the pilot runs (it changes the measurement conditions).
