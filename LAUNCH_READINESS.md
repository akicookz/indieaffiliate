# Launch Readiness Audit — UnlockAffiliate

## ✅ Phase 0 (blockers) — implemented 2026-07-06

All six do-not-launch blockers are fixed. `bun run build` and `tsc` pass; lint clean (only pre-existing warnings).

1. **Payout mark-paid D1 transaction** → rewritten to validate up front + `db.batch()` (`worker/index.ts`). Empirically confirmed D1 rejects the old `BEGIN`/`COMMIT` (exact runtime error reproduced), so the old path was genuinely broken. The up-front check + atomic batch + existing unique link index also closes the double-click race. **Final gate before prod: one click-through of mark-paid with seeded data** (needs an authed session + approved commissions).
2. **Fabricated join-page terms** → both the live page (`JoinPartnerProgram.tsx`) and the designer preview (`PartnerPageDesigner.tsx`) now derive the "Earn alongside" bullets from the real commission program and only render the FAQ when the owner has actually written one. No invented payout timing / clawback / minimum.
3. **Commission idempotency** → new unique index `(project_id, external_event_id)` via migration `0029` (applied to **local and prod**); CSV commission import now uses a deterministic key and reports repeat rows as skipped duplicates instead of duplicating money.
4. **Import validation** → one bad row no longer rejects the whole file; each row is validated individually and reported with row number + field (`partitionImportRows`); numbers are normalized (`$1,234.56`/`30%` parse correctly); partner email is required; imported amounts are rounded to cents.
5. **Cross-tenant IDOR** → `dashboard`, `analytics`, and `customers` stats now intersect the requested `projectId` with the caller's owned projects.
6. **Money rounding + webhook** → commission amounts rounded to cents at creation (`worker/money.ts`); both Stripe webhooks now hard-fail (500) when `STRIPE_WEBHOOK_SECRET` is unset instead of processing forged events.

## ✅ Phase 1 (payout clarity + money policy) — implemented 2026-07-06

Per product decisions: payout clarity first, a 30-day hold + clawback, and USD-only at launch. `tsc` + `bun run build` pass, lint clean.

7. **Failed-payout dead-end + ledger guard** — marking a payout failed now frees its commissions back to `approved` and deletes the `payout_commissions` links so they can be paid again; re-marking a payout paid only promotes still-`approved` commissions and never resurrects rejected/fraud ones (`worker/index.ts` PATCH `/api/payouts/:id`, new `deleteLinks` / `markApprovedCommissionsPaid` / `revertPaidCommissionsToApproved`).
8. **Confirmations + clarity copy** — every mark-paid path (single, bulk, ledger flip) now confirms with money-explicit text; a persistent banner on the Payouts page states that paying happens off-platform and "marking as paid does not transfer any money."
9. **Partner sees minimum + schedule** — `/api/partner/dashboard` now returns the program's `minPayout` and payout cadence; PortalPayouts shows the real minimum and schedule, replaced the always-$0 "Scheduled" card with "Minimum payout," and fixed the phantom "scheduled by the project owner" copy.
10. **Payout drill-down (both sides)** — wired the previously-dead `getLinkedCommissions`: new `GET /api/payouts/:id/commissions` (creator) and `GET /api/partner/payouts/:id/commissions` (partner, masked); both ledgers now expand a payout to show which commissions (customer + amount + date) it covered.
11. **30-day hold + clawback** — commissions are not payable until 30 days after the sale (enforced server-side in `commissionPayoutDueDate` and client-side in `isCommissionDue`, matched to the refund window); refunded charges void their not-yet-paid commission during Stripe sync. _Gap: subscription refunds issued via credit notes aren't auto-detected yet (direct charge refunds are); manual flag-customer clawback remains available._
12. **USD-only** — every commission-persisting path (both sync loops + Pending Review derivation) skips non-USD charges/invoices so amounts are never silently mislabeled as dollars.

## ✅ Phase 2 (frontend dead-links + silent failures) — implemented 2026-07-06

13. **"All Projects" fraud filter** now aggregates flags across every owned project (server accepts no-project = all owned; `getFlagsByProject`/`getFlagStats` take multiple ids) instead of silently querying only the first.
14. **Landing dead CTAs** — "View Demo" (bounced logged-out users to /login) is now a working "Sign in"; "Contact Sales" (no handler) is now a real `mailto:hello@unlockaffiliate.com`.
15. **Sidebar** — removed the duplicate "Integrations & API"/"Settings" entry; wired the nav badge counts to real `activePartners` / `pendingCommissionsCount` fields now returned by `/api/dashboard`.
16. **Portal nav + join sign-in** — added the orphaned Referrals page to the portal nav; the public join page "Sign in" now links to `/partner-login` (was the owner OAuth `/login`).
17. **Silent failures** — Partners list now shows a load error instead of "No partners match"; PartnerDetailDrawer shows an error instead of spinning forever; Payments per-row assign/unassign errors and new-project plan-limit errors are surfaced. _(Global 401→login redirect on mid-session expiry still deferred — needs a shared fetch layer.)_
18. **Onboarding + dashboard deep-links** — the onboarding trash button now deletes the partner server-side (not just local state); Dashboard "top partner" and "pending review" links now land on the Partners page with the right tab/drawer (Partners reads `?status=` and `?partner=`).
19. **Pricing copy reconciled to the code** — the billing engine gates purely on project count (Starter free/1 · Growth $39/5 · Scale $99/unlimited); the Landing cards claimed a fictional MRR-overage fee model ("9% above $2k", "3% above $10k") that no billing code implements. Cards now state the real project limits and match the Onboarding copy and the real `$1,000 MRR` upgrade prompt. The "Coming Soon" badge on the (live) Stripe integration was removed.
20. **Styled confirm/alert dialogs** — added a promise-based `ConfirmProvider`/`useConfirm`; replaced every `window.confirm`/`window.alert` (delete project/partner/webhook/coupon, revoke key, disconnect Stripe, archive program, all mark-paid money actions) with themed dialogs, and dropped a redundant double-confirm on the month "mark paid" button.

**Deferred (not yet done):** attribution unification (`monthIndex` divergence + reattribution), payout notification emails, PayPal/Wise batch export, bulk invite after import, auto-map column-swap, per-row import row-number precision, credit-note refund detection, and the global 401→login redirect.

> **Migrations (fixed 2026-07-06):** `bun run db:generate` now works — the drizzle `meta/` was re-baselined to a single current-schema snapshot at idx 29, so `generate` diffs correctly and emits the next migration as `0030_*` (previously its snapshots were frozen at idx 12 and it produced a bogus full-schema migration). `bun run deploy` now auto-applies remote migrations (`build && db:migrate:prod && wrangler deploy`), so prod no longer needs a manual apply step. Migration `0029` (the commission idempotency index) has been **applied to prod** and verified.

---



_Full-repo sweep: bugs, UX gaps, and launch blockers, with deep focus on affiliate import and payouts. Benchmarked against Rewardful, Tolt, FirstPromoter, PromoteKit, Affonso, and PartnerStack._

Severity: **P0** = do not launch / broken or harmful · **P1** = major, fix before real customers · **P2** = polish.

Build passes (`bun run build` ✓), lint clean (13 warnings, no errors). The problems are logic, money-correctness, security, and UX — not the toolchain.

---

## The "do not launch" list (P0)

| # | Area | Blocker | Location |
|---|------|---------|----------|
| 1 | Payouts | **"Mark as paid" uses `db.transaction()`, which Cloudflare D1 does not support** (Drizzle issues raw `begin`/`commit`; D1 rejects them). The single most important money action likely 400s in production — or runs without atomicity. Rewrite with `db.batch()`. **Verify against a deployed D1 before anything else.** | `worker/index.ts:596` |
| 2 | Public page | **Join page shows fabricated program terms & FAQ** the owner never wrote and cannot edit: hardcoded "Recurring 30%", "Net-15 payouts", "$50 minimum", "30-day clawback window", "Payouts run on the 12th." Every project's public page promises these regardless of the real program. Legal/financial misrepresentation. | `src/pages/JoinPartnerProgram.tsx:80-92` |
| 3 | Import | **Re-importing a commissions CSV duplicates every row** — `externalEventId = csv_import_${randomUUID()}` per insert, so dedupe never fires and there's no natural unique index. A retried/uncertain import doubles everyone's owed balance, straight into payouts. | `worker/services/import-service.ts:298` |
| 4 | Import | **One bad cell rejects the entire import** with a single row-less message. 3 missing emails in a 200-row file → whole POST 400s → "Invalid email", no row/column. Same for capitalized status, `cancelled` vs `canceled`, ragged rows. | `CsvImportPanel.tsx:150`, `worker/index.ts:191-205` |
| 5 | Import | **`parseFloat("1,234.56")` → `1`** silently. Excel/locale-formatted money columns import at a fraction of value with no warning; `$2,500` commission becomes `$2`. | `CsvImportPanel.tsx:141` |
| 6 | Security | **Cross-tenant IDOR on `/api/dashboard` & `/api/analytics`** — client `?project=<id>` is used with no ownership check. Any authenticated user reads any project's revenue, partner names+emails, customer emails. | `dashboard-service.ts:26`, `analytics-service.ts:30` |

> **Verification note (self-review):** every P0 above was independently re-read against the source and holds. One finding was **downgraded from the original P0 list to P1**: the Stripe webhook "fail-open" (`worker/index.ts:4678`) is a real fail-open *default* (verification is skipped when `STRIPE_WEBHOOK_SECRET` is unset while `STRIPE_SECRET_KEY` is set), but it requires a deploy misconfiguration to exploit — it is not guaranteed-broken like the other six. It's tracked under Backend Security below. The D1 transaction blocker (#1) is confirmed at the mechanism level (Drizzle issues raw `begin`/`commit`, which D1 does not support); still worth a one-shot empirical `wrangler d1` test when fixing, since it's the highest-stakes item.

---

## Import & migration — "crystal clear" gap analysis

**Industry standard (what you're measured against):** export CSV from the old tool → map columns with a **preview** → validate **per row** with actionable errors → create affiliates **preserving their existing referral slugs** → imported affiliates are **silent by default** with an explicit "send invites" toggle → **idempotent re-runs** (Affonso/PartnerStack do this; even Rewardful/Tolt at minimum let you set an existing slug + payout email per affiliate). Historical commissions, when imported, come in flagged **already-paid** so balances start correct without re-invoicing.

**Where UnlockAffiliate stands:** the skeleton exists (CSV upload, field mapper, 3-row preview, Stripe backfill) but it fails the "crystal clear and safe" bar on almost every axis.

### P0/P1 import bugs
- **P0 — commission dupes on re-import** (#3 above).
- **P0 — whole-file rejection on one bad cell** (#4). Fix = per-row server validation returning `{row, field, message}`; this single change removes the biggest "not clear" cluster.
- **P0 — number corruption** (#5). Strip `$`, `,`, `%` before parsing; show interpreted values in the confirm step.
- **P1 — partners CSV has zero required fields.** Email unmapped → row 1 inserts `email=""`, rows 2-N die on `UNIQUE constraint failed` shown verbatim; the empty-email partner can never log in. `FieldMapper.tsx:22-29`, `import-service.ts:127-151`.
- **P1 — auto-mapper column swap.** A `partner_email,email` header order maps `partner_email` → *Customer Email*, silently swapping fields. Intermittent (order-dependent), so hard to diagnose in support. `FieldMapper.tsx:48-79`.
- **P1 — referral codes silently replaced on collision, and code uniqueness is GLOBAL across all tenants.** Migrate "Sarah" with code `SARAH`; if any other customer of yours already has `SARAH`, she's silently reassigned `X7KQ2B9F` and all her existing `?ref=SARAH` links break. Not reported anywhere. Also case-sensitive vs. Stripe sync's uppercasing → misattribution. `import-service.ts:137-145`, `schema.ts:59`.
- **P1 — customer import corrupts partner stats.** Reads `referredCustomers`/`totalRevenue` from a snapshot taken before inserts, never refreshed → new partner with 10 customers ends at `referredCustomers=1`, `totalRevenue=last row`. `import-service.ts:213-220`.
- **P1 — non-transactional import dies on Workers subrequest cap.** ~3 D1 calls/row × 400 rows ≈ 1,200 calls > 1,000 limit → 500 mid-import, ~330 partners created, no record of which. No chunking, no progress, no resume. `import-service.ts:123-167`.
- **P1 — imported affiliates activated silently.** No invite email, no option, no disclosure; no bulk "send invites" action anywhere. 80 migrated affiliates sit sharing dead old-platform links and never learn the new portal exists. This is the #1 gap vs. Rewardful/FirstPromoter migration flows. `import-service.ts:154`, `Partners.tsx`.
- **P1 — historical commissions have no date field at all.** Every imported commission is undated → all MRR/time-series charts blank; "balances owed" only half-migrates. `FieldMapper.tsx:39-44`, `import-service.ts:299-311`.
- **P1 — rate heuristic turns "1" into 100%.** `num>1 → num/100` else raw fraction → a 1% partner imports at rate `1.0` = full-sale payout. Never surfaced for confirmation. `CsvImportPanel.tsx:143-145`.
- **P1 — Stripe "Assign Partner" backfill is unbounded & partial-failure-invisible.** Selecting 30 long-tenured subs paginates each one's full history in a single request → cap/timeout → partial commissions, generic error, no preview of how many will be created. `worker/index.ts:3354-3364`.

### P2 import polish
- Empty/header-only/unparseable CSV fails silently (`error: () => {}`). `CsvImportPanel.tsx:99,111`.
- Result row numbers don't match CSV lines (header + filtered rows unaccounted). `CsvImportPanel.tsx:475`.
- Error list truncates at 20, no overflow indicator, **no downloadable failed-rows CSV** (industry standard). `CsvImportPanel.tsx:487`.
- No undo / batch id / source tag on imported partners & customers.
- **Import page not in the sidebar** — reachable only via buried Dashboard/Settings links; customers/commissions import & Stripe browser are near-undiscoverable. `app-sidebar.tsx:63-78`.
- No CSV template / expected-columns guidance; headerless file eats row 1.
- Stripe "select all" selects only the loaded page, not all subscribers. `StripeCustomerTable.tsx:280`.
- Commission import doesn't verify the customer belongs to the named partner (typo → payout to wrong person). `import-service.ts:236-244`.
- Payments ledger never populated by import despite cache invalidation. `CsvImportPanel.tsx:86`.
- No payload caps; `Papa.parse` without `worker:true` freezes the UI on large files.

### Missing vs. industry standard
No commission dedupe/upsert mode · no downloadable error report or dry-run · no referral-code migration guarantees · no historical-balance/"already paid" import · **no bulk invite after import** · no one-click competitor API migration (Affonso's "paste your Tolt/Rewardful key" is the modern bar).

---

## Payouts & commissions — "crystal clear" gap analysis

**How it actually works:** money never moves through the platform. "Paying" = the creator manually sends money off-platform (PayPal.me etc.), then clicks "mark paid," which writes a `payouts` ledger row. This is a legitimate model (it's Rewardful/Tolt/PromoteKit's manual tier) — **but the app never says so**, and the money math underneath is shaky.

**Canonical lifecycle to match:** `pending → due/approved → paid` + `voided/rejected`, with a **configurable hold period (default ~30 days, "match your refund policy")** that auto-promotes pending→due, **NET-15/30/60** terms, a **minimum threshold** with below-threshold roll-over, and **PayPal Mass Pay / Wise batch CSV export + "mark all as paid"** as the actual payout mechanic.

### P0/P1 money bugs
- **P0 — D1 transaction breaks mark-paid** (#1 above).
- **P1 — approve race double-creates a commission for the same Stripe invoice.** Idempotency is read-then-insert and `idx_commissions_event` is **non-unique**. Two tabs / a retry → same invoice paid twice. Fix: unique index on `(projectId, externalEventId)`. `commission-service.ts:222-237`, `schema.ts:283`.
- **P1 — commission amounts never rounded to cents.** `$29.99 × 30% = 8.996999…` stored raw; per-row display, ledger, and payout total disagree by cents and drift with volume (the min-payout check needs a `+0.005` fudge because of it). Round at creation or store integer cents. `commission-service.ts:112-115`, `worker/index.ts:622`.
- **P1 — Stripe currency ignored; `amount_paid/100` assumed USD 2-decimal.** EUR invoice shows as "$"; JPY (zero-decimal) is off by 100×. Commissions have no currency column; payout stats sum mixed currencies naively and render "$100.00 EUR". `worker/index.ts:3097,3146`, `payout-service.ts:179`.
- **P1 — payout ledger PATCH bypasses every lifecycle guard.** Flipping a `failed` payout to `paid` re-pays linked commissions with no method/minimum/schedule check — including commissions later **rejected for fraud**, which silently flip back to paid. One dropdown click, no confirmation. `worker/index.ts:3904-3958`.
- **P1 — failed-payout dead end.** Marking a payout failed reverts commissions to `approved` but never deletes the `payout_commissions` links, so every future "Mark Paid" throws "already attached." A bounced PayPal transfer becomes permanently unpayable through the normal flow. `worker/index.ts:3931-3938`.
- **P1 — no refunds/clawbacks and the hold period is neither enforced nor displayed.** "refunded" is display-only; nothing reverses a commission on refund, and a commission can be approved+paid the day after the sale. Customer refunds on day 5 → creator is out the commission with no product recourse. Industry-standard 30-60 day hold does not exist. `schema.ts:101-110`.
- **P1 — approve endpoint trusts client-supplied money values** (`revenue`, `commissionAmount`, `mrr`) instead of re-deriving from Stripe; a stale tab records stale amounts. `worker/index.ts:223-272`.

### Lifecycle coherence problems
- **`scheduled` payout status is never produced by any flow**, yet the partner portal's empty state says "Payouts will appear here once they are **scheduled** by the project owner" and shows a permanently-$0 "Scheduled" card. Copy describes a flow that doesn't exist. `PortalPayouts.tsx:163-234`.
- Partner "Pending Review" **includes fraud-flagged commissions** the creator's totals exclude → partner sees more pending money than will ever be approved. `partner-dashboard-service.ts:240`.
- Partner's own two pages disagree: PortalCommissions "Total" **includes rejected** commissions; the dashboard's `totalEarnings` excludes them. `PortalCommissions.tsx:73-82`.
- "Paid Out" computed by two different fallback formulas across portal vs. dashboard. `PortalPayouts.tsx:168`.

### Attribution & traceability (the structural problem)

A Stripe payment can become a commission via **three independent paths** that disagree with each other: daily auto-sync (cron + "Sync" button, keys off referral metadata), manual Pending Review approval (owner picks the partner), and customer-browse "assign partner." They produce different statuses and compute `monthIndex` two different ways.

- **P1 — `monthIndex` computed two ways → recurring caps and "Month X of N" badges disagree.** Pending Review uses the subscription billing anchor (`worker/index.ts:3136`); auto-sync and customer-browse use a count-based fallback (`commission-service.ts:117-139`). Same subscription, different month number, different `isFinalMonth`/cap decision.
- **P1 — count-based `monthIndex` drifts when a prior commission is rejected.** The prior-count query excludes rejected rows, so a rejected month-2 makes the month-4 invoice count as month-3 → **pays a month outside the program's duration window** (or silently drops a legitimate in-window month). `commission-service.ts:122,154-169`.
- **P1 — auto-sync and manual assignment race; first writer wins silently.** A subscription with referral metadata (auto-synced to partner A) that the owner also manually assigns to partner B → whichever runs first wins, nondeterministically (cron timing vs click). `syncCustomerHistory` splits one customer's history across two partners as "duplicatesSkipped." `worker/index.ts:2987`, `stripe-sync-service.ts:969`.
- **P1 — attribution cannot be corrected once a commission exists.** No reattribution path; `payments/unassign` only deletes the snapshot row, leaving the commission attributed to the wrong partner, still payable, with its event id permanently "actioned." A metadata typo → wrong partner is paid, forever, with no UI fix. `payment-service.ts:200-214`.
- **P1 — currency hardcoded `/100` in every ingestion path** (not just display): `stripe-sync-service.ts:296,392,956,980`, `worker/index.ts:3097,3146`. The `StripeInvoice` type doesn't even parse `currency`. JPY off by 100×, EUR mislabeled as USD, at the source.
- **P1 — payout↔payment line items are fully modeled but surfaced nowhere.** `payout_commissions` records the exact batch and `commissions.externalEventId` is the Stripe invoice id, but the creator ledger shows only a count and the partner page shows nothing. The method that would answer "which referrals is this payout for?" (`PayoutService.getLinkedCommissions`, `payout-service.ts:239`) **is dead code — never called by any route.** No `GET /api/payouts/:id/commissions`. This is the single highest-value "crystal clear" add: a payout drill-down showing customer + invoice + amount on both sides.
- **P2 — charge path uses `charge.amount` (authorized), not `amount_captured`** → over-pays commission on partially-captured charges. `stripe-sync-service.ts:296,956`.
- **P2 — no reverse lookup** (from a commission/customer to the payout that paid it) and **no payout reference field** for the real PayPal/Wise transaction id.
- **P2 — sync "in progress" guard is a check-then-act race** — two simultaneous syncs (or manual + cron) both read `idle` and run, double-processing invoices (idempotency saves commission creation but wastes rate limit and interleaves counts). `worker/index.ts:2722`.
- **P2 — encryption key entropy silently weakened** — `getKey` pads/truncates `ENCRYPTION_KEY` to 32 chars with a single static salt for every record; a short key collapses to low entropy and identical keys encrypt identically. `stripe-service.ts:204`.

_Verified sound on the ingestion side: restricted-key scope probing, charge-vs-invoice de-dup, customer search merge/dedupe, ascending-by-created ordering._

### UX gaps (the "crystal clear" failures)
- **P1 — nothing tells the creator that "mark as paid" doesn't move money.** A new user can reasonably believe "Mark All Paid" pays the partner. No copy anywhere says "this records a payment you sent off-platform."
- **P1 — no confirmation on irreversible money actions.** Mark-all-paid, single mark-paid, bulk mark-paid, the status Select, and every ledger flip fire instantly; only "mark month paid" has a `window.confirm`. Since `paid` is terminal, one misclick permanently misstates money owed.
- **P1 — the partner cannot see their minimum payout or payout schedule.** The dashboard API returns neither, yet the portal says "payable when the program minimum and payout schedule are met" without stating either value. This is exactly the "crystal clear" requirement, unmet on the affiliate side.
- **P2 — no bulk payout artifact.** "Copy Note" is one clipboard string per partner; no PayPal Mass Pay / Wise batch CSV export, no cross-partner pay-run. At 20+ partners that's 20 manual PayPal sessions. This is table-stakes for every competitor.
- **P2 — payout-method field accepts anything** (`max(500)` only); "asdf" passes the server-side "has a method" check and renders as `https://asdf`. `worker/validation.ts:251`.
- **P2 — invalid nested `<button>`** inside the month toggle. `Payouts.tsx:1094`.
- **P2 — no payout notification email** (partners must log in to discover they were paid), **no per-payout line items** for the partner (data exists, no endpoint), **no receipt/reference field** to record the PayPal transaction id for disputes.

---

## Backend security & correctness (beyond the P0s above)

- **P1 — Stripe webhook fails open** (#7).
- **P2 — cross-tenant aggregate leak on `/api/customers` stats** (same IDOR pattern as dashboard/analytics; leaks counts). `customer-service.ts:71`.
- **P2 — webhook replay / no idempotency.** No timestamp tolerance check, no processed-event-id store; a captured signed event replays indefinitely. Non-constant-time signature compare. `stripe-webhook.ts:22`.
- **P2 — open redirect on the tracking endpoint** when a project has no configured domain: `/api/t/<code>?url=https://evil.com` 302s anywhere. `worker/index.ts:827-852`.
- **P2 — partner OTP has no rate limit / attempt cap.** ~30-bit code, 10-min window; brute-force → partner session → attacker repoints that partner's payout link. `worker/index.ts:1345-1416`.
- **P2 — SSRF via user-supplied outbound webhook URLs** (`http://169.254.169.254/...`), response body stored and readable via logs. `webhook-service.ts:183`.
- **P2 — outbound webhooks delivered inline** (`await` with 1s/2s/4s backoff, no `ctx.waitUntil`) — a slow subscriber stalls the user's request up to ~7s per endpoint. `webhook-service.ts:162`.
- **P2 — rate limiting is per-isolate in-memory** → effectively bypassable at the edge; the advertised join/click/conversion limits don't really hold. Use KV/DO/D1. `worker/index.ts:171-188`.
- **P2 — conversion idempotency is optional** (`eventId` optional); a leaked API key can mint unlimited commissions. `validation.ts:151`.
- **P2 — SVG uploads served inline same-origin** = stored XSS; also two-segment upload keys 404 against a single-segment `:key` route, so branding logos won't load. `worker/index.ts:3770,1006`.
- **P2 — non-crypto `Math.random()` referral codes** (guessable/enumerable). `partner-service.ts:684`.

**Verified clean:** no secrets in `wrangler.jsonc` or git; API keys stored SHA-256-hashed; Stripe keys AES-GCM encrypted; all *mutating* routes verify project ownership; partner-portal routes strictly scoped; Drizzle fully parameterized (no SQL injection); outbound webhooks HMAC-signed. The IDOR holes are confined to three read/stats endpoints — a targeted fix, not a rewrite.

---

## Frontend UX (beyond import/payouts)

### P0
- Fabricated public join-page terms & FAQ (#2) — the top user-facing blocker.

### P1
- **"All Projects" fraud filter only queries the first project** → owner with 3 projects sees "no flags" while flags exist elsewhere. `FraudFlags.tsx:130`.
- **"Contact Sales" button does nothing** (no handler/href); **"View Demo" links to `/app`** which bounces logged-out visitors to `/login` — there is no demo. `Landing.tsx:539,90`.
- **Sidebar has duplicate "Settings"/"Integrations & API" entries** to the same URL, both highlight active. `nav-projects.tsx:39-45`.
- **Sidebar nav counts read fields the API never returns** → always hidden (dead feature). `app-sidebar.tsx:36-49` vs `dashboard-service.ts:84`.
- **Onboarding "delete partner" only removes local state** — the partner was already created server-side and reappears later. `Onboarding.tsx:1005`.
- **Dead deep-links:** Dashboard "top partners" → `/app/customers?partner=` redirects and drops the query; "+N pending review" → `?status=pending` never read. Filters silently no-op. `Dashboard.tsx:688,514`.
- **Silent failures:** failed partners fetch renders "No partners match these filters"; PartnerDetailDrawer spins forever on fetch error; per-row assign/unassign mutations surface no errors; "New project" over plan limit just stops spinning with no message. `Partners.tsx:227`, `PartnerDetailDrawer.tsx:270`, `Payments.tsx:314`, `nav-projects.tsx:62`.
- **Join page "Sign in" links to `/login`** (owner OAuth) instead of `/partner-login` → returning affiliate lands on owner signup. `JoinPartnerProgram.tsx:1031`.
- **`/portal/referrals` is orphaned** — full page exists, not in portal nav; partners can't find their referrals. `PartnerLayout.tsx:13-17`.
- **Delete Project guarded only by native `window.confirm`** — the most destructive action in the app. `ProjectSettings.tsx:315`.
- **Pricing contradicts itself** across Landing ("free until $1,000 MRR" vs Starter card "up to $2k / 9% above") and Onboarding ("free forever, 1 project", no fee); Stripe marked "Coming Soon" on Landing while it's the core onboarding step. `Landing.tsx:74,308,268`.

### P2 (grouped)
- **No global 401 handling** — mid-session expiry shows "Error loading dashboard" instead of redirecting to login; retry predicate checks `error.status` but queryFns throw statusless errors → 4xx retried 3×. `query-client.ts:9`.
- Native browser dialogs for destructive actions across Webhooks/ProjectSettings/PartnerDetailDrawer (delete/revoke/disconnect) — no styled confirm, no type-to-confirm.
- Webhooks "Test" gives zero feedback unless logs panel is open; delete errors unsurfaced.
- Onboarding-added partners use `sendInvite:false` with **no later "send/resend invite" action anywhere** — they never learn the portal exists (compounds the import gap).
- Partners search has no debounce (one request/keystroke); Payments does it right at 300ms.
- Inconsistent dates (raw ISO `2026-07-06` in Payments/Drawer vs `toLocaleDateString` elsewhere); "Your Better Auth account details" leaks the library name; `pr-2text-primary` typo kills a color; footer links are non-clickable `<li>`s.
- Inconsistent page scaffolding (some pages `PageHeader`+`p-6`, others hand-rolled, no padding) → visibly different gutters.
- `team-switcher.tsx` is dead code with an unhandled "Add team" — delete before it's wired in accidentally.
- Unused-payout POST endpoint (`/api/payouts`) double-counts earnings and enables double payment; no UI calls it but it's live and authenticated. `worker/index.ts:3855`.

**In good shape:** OAuth callback handling, magic-link states, ErrorBoundary, NotFound, portal loading/error states, InvitePartnerDialog copy.

---

## Recommended fix order

**Phase 0 — unbreak & de-risk (before any customer):**
1. Verify & rewrite the payout `db.transaction` → `db.batch` (#1). Test mark-paid against a real D1.
2. Delete/replace the fabricated join-page FEATURES + FAQ with owner-configured values, or hide until set (#2).
3. Add unique index `(projectId, externalEventId)` on commissions; give commission import a deterministic idempotency key (#3, approve-race).
4. Fix the three IDOR endpoints to intersect `projectId` with owned projects (#6); make the Stripe webhook hard-fail without a secret (#7).
5. Round money to cents at creation (#money drift).

**Phase 1 — make import & payouts "crystal clear":**
6. Per-row import validation with `{row, field, message}` + number normalization + interpreted-value preview (#4, #5, rate heuristic).
7. Require/warn on email mapping; report (don't silently swap) referral-code collisions; scope code uniqueness per project.
8. Chunk imports via `db.batch`, show progress + a real results summary (imported/skipped/failed + downloadable errors).
9. Bulk "send invites to imported partners"; stop silently activating.
10. Add copy that "mark as paid records an off-platform transfer," confirmations on money actions, and fix the failed-payout dead end + ledger-flip guard.
11. Surface minimum payout + schedule to partners; fix the `scheduled`-status phantom copy.
12. Add PayPal Mass Pay / Wise batch CSV export ("one-click payout") — table stakes.

**Phase 2 — coherence & polish:** payout drill-down (wire up the dead `getLinkedCommissions` → line items on both dashboards), unify `monthIndex` on the anchor-based derivation and pick one canonical attribution path + add a reattribution/undo, refund/clawback + hold period, currency handling at ingestion, payout notification emails, the frontend dead-links/silent-failures cluster, styled confirm dialogs, global 401 redirect, pricing-copy reconciliation, discoverability (Import in sidebar).
