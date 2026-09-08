# Phase 0 — Pull request plan

How the whole build is cut into pull requests. Ninety-six of them, each a
complete unit that can be tested on its own and merged on its own without
breaking anything merged before it.

Three properties are non-negotiable and are checked, not promised:

- **No PR is a chapter.** Nothing is titled "part 2 of". Every PR ends with
  something a reviewer can run or click and judge.
- **The large phases are split.** Phase 5 becomes sixteen PRs, Phase 6 twelve,
  Phase 7 ten, Phase 8 fifteen. A phase is a heading here, never a unit of work.
- **The mandated money and time tests come before any UI.** They are PR 1, they
  have no table, no route and no React in them, and every later module calls the
  functions they prove.

Feature IDs refer to `docs/SPEC.md`. Conventions `K-nn` refer to
`00-KONVENTIONEN.md`. Open questions `O-nn` refer to `docs/DECISIONS.md`.

⚑ marks a PR that satisfies a ROADMAP acceptance criterion.

---


**96 PRs, numbered 0–95, covering ROADMAP phases 0–10.** PR 0 is the Phase 0 scaffold. **PR 1 is the first code PR and contains the money and time tests before any UI.**

## Rules binding every PR (stated once)

- **Done =** `pnpm lint && typecheck && test && test:e2e` green · `pnpm db:seed` exercises it in all four mandanten · `DECISIONS.md` updated.
- **Complete unit.** No PR is titled "part N". Each is mergeable alone and leaves everything merged before it working (CLAUDE.md "do not break what works" is a CI check on removed exported symbols).
- **Migrations are additive only.** A rename is expand → backfill → contract across two PRs.
- **Money `bigint` cents; timestamps `timestamptz`; genuine calendar facts (`geburtsdatum`, `eintritt`, `austritt`, `leistungsdatum`) `date`.** CI fails otherwise.
- **A table with `mandant_id` ships with RLS + policy + an isolation-registry entry in the same migration.** CI fails otherwise.
- **Route handlers: authorize → service → return.** CI greps `app/**/route.ts` for `db.`.
- **No invented business rule.** Interface + labelled placeholder + `// TODO(client): …` + a DECISIONS.md row, in the same PR. CI fails if a `TODO(client)` line is absent from DECISIONS.md.
- **No fake integrations.** Missing credentials ⇒ interface exists, UI says `nicht verbunden`, no simulated success — asserted by a test that fails if an adapter returns success without a configured client.
- **Registries make later PRs self-policing:** isolation registry (PR 3), KPI-tile registry (PR 18), notification-kind registry (PR 11), document-category registry (PR 9), job registry (PR 10), navigation registry (PR 8), customer-portal tab registry (PR 29), billing-strategy registry (PR 48). A tile/kind/table that is not registered fails the build; an unregistered KPI is **absent**, never a fabricated zero.

## Deviations from strict ROADMAP sequence — five, each deliberate

| # | Move | Why (one line) |
|---|---|---|
| A | Money/time/ArbZG kernel before Phase 1 (PR 1) | Client condition 5 and SPEC §9 both demand the tests before any scheduling UI. |
| B | `person`/`anstellung` in the first migration (PR 3) | D-09; retrofitting it is a rewrite, not a migration. |
| C | `nummernkreis` + hash-chain **primitives** to Phase 1 (PR 5) | They are FIN-03/FIN-06 mechanisms, not invoice features; proving gaplessness under real concurrency before ten domains depend on them is the cheapest de-risking available — and it shrinks PR 46 to a lifecycle PR that is itself fully testable. |
| D | Four kernels hoisted to Phase 1.5 (PRs 9–12: storage, jobs, notifications, outbound/Freigabe gate) | The Phase 2 lead form already needs file upload (REQ-04), a scheduled escalation (REQ-06), a notification (NOT-01) and a policy-gated send (invariant 7). Building them inside a marketing feature buries platform primitives. |
| E | Customer portal moves from Phase 3 to Phase 4 (PR 29) + Phase 6 (PR 57) | Built before `auftrag` it is an empty shell — the definition of a chapter. Each half is a demonstrable unit. |

## Where the three input plans disagreed — decisions

1. **Number circle placement.** Risk plan pulls it to Phase 1; the others bury it in the invoice PR. **Decided: Phase 1 (PR 5)**, because the concurrency and rollback tests are independent of invoices and PR 46 re-asserts the 1000-draft gap test end to end.
2. **Approval machinery.** One plan splits gate/inbox oddly across phases. **Decided: gate kernel at PR 12 (Phase 1.5, single choke point), diff-review inbox at PR 62 with its first consumer ACC-05, automation (batch/delay/undo/APR-08) at PR 77 with the agents.** Each of the three is a capability, not a chapter.
3. **ACC-05 ownership.** One plan put incoming-invoice OCR in Phase 8. **Decided: Phase 7 (PR 63)** — it is an accounting flow; PR 81 wraps it as an agent.
4. **Design system.** One plan folded tokens + components + CI + architecture docs into PR 0. **Decided: split (PR 0 scaffold, PR 2 design system)** — PR 0 was too large to review.
5. **Dashboards.** **Decided: registry (PR 18)** — an unbuilt module's tile is absent, never zero. This is the fix for "Super Admin dashboard" being finishable only in Phase 9.
6. **Trade granularity.** **Decided: cleaning 1 PR, security 2, construction 3** — Aufmaß/parser, Nachträge, Bautagebuch are separately demonstrable.
7. **Employee portal.** One plan shipped hours before `zeiteintrag` existed. **Decided: login shell in Phase 3 (PR 20), full portal after Stundenkonto (PR 39)** — the shell's own acceptance is the negative-scope enumeration test, so it is a unit, not a stub.
8. **Open questions.** All three surfaced different unstated gaps. **Decided: adopt the union as O-14…O-29**, with placeholders that fail loudly rather than defaulting.

## Critical path (22 deep)

`0 → 1 → 3 → 6 → 8 → 12 → 21 → 23 → 25 → 26 → 27 → 30 → 32 → 34 → 36 → 46 → 48 → 49 → 58 → 60`, plus the legal spurs `3 → 4 → 5 → 46` and `1 → 32` (ArbZG across entities). Money cannot be invoiced before it is measured; it cannot be measured before an `objekt`, an `auftrag` and a `zeiteintrag` exist.

---

# Phase 0 · Analysis & architecture

### PR 0 · Repo scaffold, CI invariant guards, Drizzle chain
Phase 0 · **L** · deps: —
**Scope:** Next.js 15 App Router, TS strict (`noUncheckedIndexedAccess`), folder structure exactly per CLAUDE.md; Drizzle with in-repo migrations; Supabase pinned **EU Frankfurt**, Vercel functions `fra1`; Zod boundary + server-only `env.ts` (SEC-A4, SEC-A5); Vitest + Playwright; CI: typecheck, lint, unit, e2e, `pnpm audit` (SEC-A8); the eight merge-safety guards above; the architecture documents the ROADMAP Phase 0 requires (schema, auth, permission, page, API, agent, integration maps); DPA register rows in DECISIONS.md (D-04).
**Acceptance:** (1) Clean clone: install, typecheck, lint, test, e2e all exit 0; `pnpm dev` serves `/healthz` 200. (2) `db:generate && db:migrate` applies `0000_baseline` to a fresh Postgres and is idempotent. (3) A fixture branch adding `numeric` column `betrag_netto` fails CI; one adding `timestamp without time zone` fails CI. (4) A fixture route handler containing `db.` fails CI. (5) A `TODO(client)` line absent from DECISIONS.md fails CI. (6) A test reads `supabase/config.toml` and asserts `eu-central-1`.
**NOT:** any domain table, any design token, any UI beyond `/healthz`, any auth.
**Migrations:** `0000_baseline` (extensions only).
**Open:** O-11 — managed EU (Frankfurt) with the D-04 tension recorded; nothing in code assumes a host beyond the connection string.

### PR 1 · Geld-, Zeit- und ArbZG-Kern — the mandated tests, before any UI ⚑
Phase 0 (gate for Phases 5 and 6) · **L** · deps: 0 · ‖ PR 2
Pure functions in `src/server/services/`. **No table, no route, no React.**
**Scope:** everything lands under `src/server/services/finanz/` and `src/server/services/zeit/` — one directory per K-21's owner, never a parallel `finanzen/`. `geld` (branded `Cents = bigint`, add/sub/multiply, German parse/format `1.234,56 €`); `finanz/steuer/satz.ts` → `berechneSteuer()` — VAT per **`steuersatz_gruppe`** (the only tax catalogue; there is no `steuersatz` table, K-21), half-up per group, **never from a gross total**; `zeit` (`dauerMinuten(vonUtc,bisUtc)`, `berlinAnzeige`, `splitteNachMonat` — the K-11 spelling, not `teileNachMonat`, `verteileSpalten` lane packer for TIM-04); `arbzg.pruefeArbzg(schichtenEinerPerson[])` keyed by `person_id` across employments — §3 8h/10h, §5 11h rest, §4 breaks — returning the six `arbzg_regel` values `02-datenmodell/04-PLANUNG-ZEIT.md` §3 owns (`tagesarbeitszeit_ueber_8h`, `tagesarbeitszeit_ueber_10h`, `ruhezeit_unter_11h`, `pause_fehlt_ueber_6h`, `pause_fehlt_ueber_9h`, `ausgleichszeitraum_ueberschritten`) with severity from `verstoss_schwere` (`hinweis · warnung · verstoss`), never a coarser vocabulary of this PR's own — `app.arbzg_befund_schreiben(p_regel arbzg_regel, p_schwere verstoss_schwere, …)` is the only writer, so a verdict that does not map onto those values cannot be persisted at all. Custom lint rules `no-float-money`, `no-client-clock`. SPEC: TIM-04, TIM-06, TIM-14, FIN-01 (primitive), LEG-03; invariants 1, 2, 6, 9.
**Acceptance (all `pnpm test kern`):** (1) 22:00–06:00 Berlin → **480 min**. (2) Spring-forward night **2026-03-28 22:00 → 2026-03-29 06:00** (`21:00Z→04:00Z`) → **420 min**. (3) Fall-back night **2026-10-24 22:00 → 2026-10-25 06:00** (`20:00Z→05:00Z`) → **540 min**. (3a) Control: a shift starting 22:00 *on* either transition day (29.03 / 25.10) is an ordinary **480 min** — asserted, so an off-by-one-day fixture cannot pass (K-11). (4) Ten shifts with an identical start instant on one `objekt` → `verteileSpalten` returns **ten** distinct lanes, none merged, none dropped. (5) One `person`, 6h `reinigung` + 5h `security` same day → 660 minutes on the Berlin calendar day, raising **both** `tagesarbeitszeit_ueber_8h` **and** `tagesarbeitszeit_ueber_10h` with `minuten === 660` — the two §3 rules are separate `arbzg_regel` values and collapsing them into one would make the 10h finding unpersistable; **the same shifts evaluated per employment return no breach** — all asserted, which is what proves the aggregation. (6) 23:00 end in A, 07:00 start next day in B → `ruhezeit_unter_11h`, `minuten === 480`. (7) Shift 31.01 20:00 → 01.02 04:00 splits 240/240. (8) `19,99 €` → `1999n`; a type test proves a `number` cannot reach a money parameter. (9) 19% + 7% basket: per-group VAT correct, and a control assertion proves a blended rate on the gross **differs** — the test fails if anyone "simplifies" it. (10) `pnpm lint` fails on a fixture typing money as `number` and on `Date.now()` inside `server/services/`.
**NOT:** persistence, `einsatz`, Dienstplan, invoices, holiday calendar (PR 30), Rechenansatz parser (PR 43).
**Migrations:** none.
**Open:** O-18 (10h exception) — the daily limit is a parameter, default 8h with a warning band to 10h, `// TODO(client): is the 10h ArbZG exception in use, and over which compensation window?`

### PR 2 · DESIGN.md as code — tokens and base components
Phase 0 · **M** · deps: 0 · ‖ PR 1
**Scope:** every DESIGN §1–3 token as CSS variables **and** Tailwind theme; Inter + Caveat self-hosted; Button (primary/secondary/ghost/danger), Card, KpiStat, StatusPill (fixed §5 vocabulary), FilterPill, DataTable (tabular-nums, right-aligned money, stacked cards < 768px), FormField (`aria-live` errors), AreaBadge, hue bar; motion tokens + `prefers-reduced-motion`; `theme.ts` reused later by PDF/email; `/dev/kitchensink` excluded from production and sitemap. SPEC: PUB-04, PUB-05, LEG-07 groundwork; DESIGN §5, §7, §8, §9, §10.
**Acceptance:** (1) A test asserts every §1–3 token exists in both CSS and Tailwind with the documented value, and fails if one exists in only one. (2) axe on `/dev/kitchensink` = **zero** violations; contrast test asserts `--text-muted` on `--surface` ≥ 4.5:1 and `--text-subtle` only at `xs`. (3) A stylesheet scan asserts no `outline: none`; every interactive element shows the `--red-ring` focus ring. (4) With `prefers-reduced-motion: reduce`, no transform transition runs. (5) At 375px DataTable renders as stacked cards with `scrollWidth === clientWidth`. (6) An ad-hoc hex in a component file fails `no-raw-color`. (7) Money renders `1.234,56 €` with NBSP.
**NOT:** portal shell, switcher, public pages, any data.
**Migrations:** none.
**Open:** O-12 — `--red: #E30613` from DESIGN §1 with `// TODO(client): sample the exact red from the official logo file`; brand SVGs are marked placeholders listed in `lib/placeholder-assets.ts` and a test asserts the marker renders.

---

# Phase 1 · Tenancy, auth, permissions

### PR 3 · `mandant` · `person`/`anstellung` · RLS · `withTenant` · `audit_log`
Phase 1 · **L** · deps: 0, 1
The first migration with domain tables. **The D-09 split lands here and is never merged later.**
**Scope:** TEN-01, TEN-03, TEN-04, TEN-08, TEN-09, AUT-05, SEC-A2, SEC-A3, SEC-A9, EMP-14/15 foundation. `mandant` seeded with the four areas (legal name, tax number, identity hue); `person` (vorname, nachname, `geburtsdatum date`, telefon, sprache); `anstellung` (person_id, mandant_id, personalnummer, `eintritt`/`austritt date`, arbeitszeitmodell, wochenstunden, **`stundensatz_intern bigint`** — cents, and the column carries **no `_cent` suffix**: that suffix exists only on the HTTP wire field per `05-API-KARTE.md` R-12, K-05); `audit_log` with `ebene enum('plattform','mandant')` and `CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))` — the only tenant-adjacent table with a nullable `mandant_id`, K-16(d) — plus `auditiere()`; the four K-18 scope entries `withTenant()` / `withGroupScope()` / `withPersonScope()` / `withKundeScope()`, each reading its mandant or mandant set **from the server session only** (K-02) — no helper accepting a mandant from a param or body exists; **every `app.*` accessor defined in all four scopes** (K-20): `app.portal` is *bound when the scope is entered* and never recomputed from `aktiver_mandant`, and `app.aktuelle_kunden()` resolves from the session's `kunde_zugang` binding, never through `aktiver_mandant()`; `assertGenauEinMandant()`; **asymmetric RLS** (a `person` is visible to every mandant it has an `anstellung` with; `anstellung` and below strictly tenant-scoped); the isolation registry + harness `assertIsolated()`.
**Acceptance:** (1) A `reinigung` session selecting `security` `anstellung` rows returns **0 rows at the database level with the service-layer filter deliberately removed** — RLS proven as a real second line. (2) A dual-employed `person` is one row readable from both tenants; that person's `security` `stundensatz_intern` is **not** readable from `reinigung` — asserted on the serialised payload, not the query (D-09.6). (3) A write called without exactly one active mandant throws `KeinAktiverMandant` before any SQL — asserted for insert, update, delete. (4) Inserting a fifth `mandant` row makes every query, policy and seed work with **zero code changes** (TEN-08). (5) A schema meta-test enumerates `information_schema` and fails on any `mandant_id` table without RLS + policy + registry entry. (6) A guard test asserts costed tables may only FK to `anstellung_id` and person-facts only to `person_id`. (7) **K-20 accessor test:** a CI test enumerates every `app.*` accessor and asserts each returns a defined value — or a *documented* NULL — under all four values of `app.scope`; an accessor that resolves through `aktiver_mandant()` in `gruppe`, `person` or `kunde` scope fails it, because NULL there makes every predicate on it false and the page reads zero rows with no error.
**NOT:** authentication (PR 6), switcher UI (PR 8), any employment-costed table.
**Migrations:** `0001_mandant`, `0002_person_anstellung`, `0003_audit_log`, `0004_rls_baseline`.
**Open:** none — O-03 is answered by D-09. O-01 affects the invoice circle only (PR 5/46).

### PR 4 · Unveränderbarkeit, Soft-Delete, Audit-Trigger
Phase 1 · **M** · deps: 3 · ‖ PR 5
**Scope:** invariant 8, LEG-01, SEC-A9, DOC-07 groundwork. A `no_hard_delete` trigger plus revoked `DELETE` grants for tables in a **delete-lock registry** (one reviewable file); `geloescht_am` soft-delete convention with finders excluding it by default; a generic `audit_trigger` writing actor (human/agent/system), action, before, after, timestamp, IP.
**Acceptance:** (1) `DELETE FROM audit_log` fails at the **database** layer even as the service role. (2) A soft-deleted row disappears from the default finder and is still present in a raw count. (3) An `UPDATE` on a registered table writes exactly one `audit_log` row whose before/after differ only in the changed column. (4) A test enumerates the registry and fails if a delete-locked table lacks the trigger.
**NOT:** invoice-specific immutability (PR 46), GoBD 10-year lock (PR 64), retention scheduler.
**Migrations:** `0005_immutability_audit`.
**Open:** none.

### PR 5 · Nummernkreis und Hash-Kette — die Mechanismen *(deviation C)*
Phase 1 (mechanism for Phase 6) · **M** · deps: 3, 4
**Scope:** FIN-03, FIN-06, TEN-02, LEG-01. `nummernkreis` exactly as its owner `02-datenmodell/05-FINANZEN.md` §3.3 declares it — `(mandant_id, kreis_typ, kontext_id, jahr)` with `UNIQUE … NULLS NOT DISTINCT`, plus `bezeichnung`, `lueckenlos`, `format_maske`, `zuruecksetzung`, **`naechste_nummer`** (the counter — there is no column `stand`), `letzter_hash`, `vorgaenger_nummernkreis_id`, `genesis_hash`, `geoeffnet_am`, `geschlossen_am`, `ist_platzhalter`. **`kontext_id` is not optional:** `03-GEWERKE.md` needs `(mandant_id,'wachbuch',objekt_id,jahr)` and `(mandant_id,'leistungsnachweis',null,jahr)`, which a circle keyed without it cannot hold. The draw resolves on the **open** key `(mandant_id, kreis_typ, kontext_id) WHERE geschlossen_am IS NULL` — never by `jahr(heute)`, which is the trap: a `zuruecksetzung = 'nie'` circle carries `jahr = 0`, a today-year lookup finds nothing, and finalisation fails for every entity that numbers continuously across years. `vergebeNummer(tx, { kreis_typ, kontext_id, jahr })` via `SELECT … FOR UPDATE` on that row. `services/finanz/hash-chain.ts` → `hashChain` / `verifyChain` over a generic chained-record contract: `hash = SHA256(canonical_bytes ‖ 0x1E ‖ vorheriger_bytes)` where `vorheriger_bytes` is the predecessor hash as **32 raw bytes** and genesis is **32 zero bytes** (`vorheriger_hash text NOT NULL`, 64 `0` characters, or the circle's `genesis_hash` when a circle continues another), `algorithmus = 'sha256-jcs-v1'` naming the RFC 8785 canonicalisation. The `0x1E` separator and the zero genesis are part of the digest: a null genesis or a missing separator produces a different hash for the same record, so the two are stated here and not left to the implementation. Nightly `verifiziereHashKette` job registered on Supabase cron that **reports, never repairs**.
**Acceptance:** (1) 200 concurrent transactions on one circle yield 200 numbers, no duplicate, no gap (`max − min + 1 === count`). (2) A transaction that takes a number and **rolls back leaves the counter unadvanced** — this is what proves gaps are impossible rather than unlikely. (3) Two mandanten increment independently; a third circle is a row, not code (TEN-02/TEN-08). (4) Mutating one byte of a chained payload makes `verifiziereHashKette` name the first broken record and exit non-zero. (5) Chain verification is green after a restore from a snapshot. (6) A `zuruecksetzung = 'nie'` circle (`jahr = 0`) is resolved by the open-key lookup and draws a number; a fixture that looks the circle up by the current year fails the test — the continuous-numbering entity must not be the one that discovers this in production. (7) A golden-vector test pins the genesis digest: the first record of a circle hashes against 32 zero bytes with the `0x1E` separator, and a variant computed without the separator or against a NULL predecessor produces a **different** digest — asserted, so the two implementations cannot silently diverge.
**NOT:** **no invoice model, no VAT, no §14 logic, no PDF.**
**Migrations:** `0006_nummernkreis`, `0007_hash_kette`.
**Open:** O-01 — the `operations` circle row ships `aktiv = false`; the number-format string is a per-row placeholder, `// TODO(client): invoice number format per entity (prefix, year reset, width); and is CSE Operations a GmbH with its own circle or a department?`

### PR 6 · Supabase Auth, 2FA, `authorize()`, 404-statt-403
Phase 1 · **L** · deps: 3
**Scope:** AUT-01, AUT-02, AUT-04, AUT-06, AUT-07, AUT-08, SEC-A1, SEC-A4. Login/logout/session; TOTP **enforced server-side at session issue** for `super_admin` and `admin`; `authorize(actor, aktion, ressource)` on every route handler and server action; cross-tenant/unauthorised → **404** with a body byte-identical to a genuinely missing record; rate limit + lockout; every auth event audited; the active mandant written into the session at login and switch only.
**Acceptance:** (1) An `admin` without an enrolled factor is refused **every** portal route at the API, not only redirected in the UI. (2) `GET /api/kunde/<foreign-id>` returns 404 with the same body as a missing id — asserted for direct fetch, API route and deep link. (3) Eleven failed logins lock the account and write eleven audit rows; the twelfth with correct credentials still fails inside the window. (4) A forged cookie carrying a mandant with no `benutzer_mandant` row is rejected and audited. (5) A route handler added without `authorize()` fails a CI test enumerating `app/api/**`.
**NOT:** permission editor (PR 7), employee SMS login (PR 20), switcher (PR 8).
**Migrations:** `0008_benutzer_auth`.
**Open:** none.

### PR 7 · Rollen- und Berechtigungsmatrix mit Editor
Phase 1 · **M** · deps: 6
**Scope:** AUT-01, AUT-03, AUT-04, AUT-05, SEC-A1, SEC-A3 (route-level enumeration). Five roles, permissions per role **per mandant** in `berechtigung`, editable in the UI; RLS policies generated from the same matrix; the route-manifest enumeration test. **The catalogue is `03-AUTH-BERECHTIGUNGEN.md`'s and only its** (K-19): the module vocabulary of its §7.4 and the action vocabulary of its §7.2 — which must contain `lesen`, `schreiben`, `loeschen`, `pruefen`, `freigeben`, `exportieren` and `verwalten`, since K-03's `WITH CHECK` names `<modul>.schreiben` on every tenant table and K-06's ArbZG reader names `dienstplan.arbzg_pruefen`. This PR seeds that catalogue and no key of its own.
**Acceptance:** (1) Revoking `finanzen.lesen` from `leitung` in `bau` takes effect on the next request in `bau` and **not** in `reinigung`, with **no deploy**. (2) Application-deny and RLS-deny are both asserted for the same case (AUT-05). (3) A table-driven test asserts the SPEC §3 scope per role: `leitung` own area, `mitarbeiter` own work, `kunde` own records. (4) The UI cannot grant a permission the granting user lacks. (5) The last `super_admin` cannot be locked out. (6) The enumeration test reads the route manifest, so a new route is covered automatically. (7) **K-19 catalogue test:** CI extracts every right-key literal from policies, the route manifest, services and seeds, and fails on any key with no row in the catalogue **and** on any catalogue key no code uses. `app.hat_recht()` returns false for a key it does not know, so an unregistered or misspelled key is a silent permanent zero-row screen, not an error — a fixture introducing `rechnung.lesen` (module `rechnung` does not exist; the key is `finanzen.lesen`) fails the build.
**NOT:** role creation (five are fixed), field-level permissions.
**Migrations:** `0009_berechtigung_matrix`.
**Open:** none.

### PR 8 · Portal-Shell, Bereichsumschalter, schreibgeschützte Gruppenansicht
Phase 1 · **L** · deps: 2, 6, 7
**Scope:** TEN-05, TEN-06, TEN-07, TEN-09, TEN-10, DESIGN §6 in full. Sidebar 248px (64px collapsed, phone tab bar), permanent 3px identity-hue top bar, 32px avatar + 2px hue ring, 320px dropdown with **live counters**, `Gruppenübersicht` row with `NUR LESEN` pill, `⌘K`/arrows/Enter/Esc; `(portal)/gruppe` backed by `withGroupScope()` / `readOnlyGroupContext()` that **has no write methods**; the navigation registry. Group scope is `app.scope = 'gruppe'` with `app.mandant_id` NULL and `app.mandant_ids` carrying the set (K-02, K-18) — the group view is **not** a wide `mandant` scope.
**Acceptance:** (1) A user with one mandant sees a static logo — **no chevron, no dropdown in the DOM**. (2) Switching lands on the new area's dashboard, changes the top-bar computed colour to that area's DESIGN token, and writes one audit row with old and new mandant. (3) In group view every create/update control is absent **and** a direct POST to any write endpoint returns `KeinAktiverMandant` — the test iterates the service registry, so future modules are covered automatically. (4) Counters come from live queries — asserted by mutating a row and reopening; the per-mandant switcher count is gated on `gruppe.bericht.lesen` (module `bericht`; there is no module `dashboard`). (5) `⌘K` opens; keyboard-only operation complete; axe zero violations on the open dropdown. (6) **K-20 in group scope:** `app.portal()` resolves to `intern`, bound at scope entry — asserted. Recomputing it from `aktiver_mandant` there yields the fail-closed `mitarbeiter`, which fires every K-04 employee ceiling *inside* the group view and blanks it for exactly the management audience TEN-05 built it for.
**NOT:** dashboard tiles (PR 18).
**Migrations:** none.
**Open:** O-12 — placeholder brand avatars.

---

# Phase 1.5 · Cross-cutting kernels *(deviation D)*
PRs 9, 10 land in parallel; 11 needs 8+10; 12 needs 4, 7, 10, 11.

### PR 9 · Dokumente und Storage-Kern
ROADMAP Phase 3, hoisted · **L** · deps: 4, 6 · ‖ PR 10
**Scope:** DOC-01…DOC-06, DOC-08, SEC-A6, and the DOC-07 retention *framework*. Nine categories behind a category registry; **private buckets only**, signed URLs **15-minute** expiry; MIME sniffing by magic bytes; size limits; **EXIF stripped**; versioning; tag/search/filter; one-click bundle.
**Acceptance:** (1) No storage object is reachable without a signature; a URL is dead at minute 16 (clock-advanced). (2) An `.exe` renamed `.pdf` is refused by content sniffing. (3) A JPEG with GPS EXIF is stored with EXIF removed — asserted on the stored bytes. (4) A `bau` user gets 404 on a `reinigung` document, including through a stale signed URL. (5) A category marked non-deletable refuses deletion at service **and** database level.
**NOT:** GoBD 10-year archive (PR 64).
**Migrations:** `0010_dokument`.
**Open:** O-25 — retention beyond the legal minimum; placeholder = legal minimum only, `// TODO(client): Aufbewahrungsfristen je Dokumentkategorie über das gesetzliche Minimum hinaus?`

### PR 10 · Job- und Scheduler-Kern
SPEC §14 infra, hoisted · **M** · deps: 3 · ‖ PR 9
**Scope:** Supabase cron + Edge Function runner; the two run-log tables `02-datenmodell/01-KERN.md` owns under K-21, used here with the owner's exact names and never redeclared: **`job_lauf (id, job text, gestartet_am, beendet_am, ergebnis enum, kennzahlen jsonb, fehlertext)` — a platform operations log with *no* `mandant_id`**, and **`job_lauf_mandant (job_lauf_id, mandant_id, ergebnis, kennzahlen)`** for the per-tenant outcome of one run. Not `job_schluessel`, not `begonnen_am`, not `befund`, not `status`. The absent `mandant_id` is the point: K-16(d) keeps `audit_log` as the only tenant-adjacent table with a nullable one, and a nightly cross-tenant run has no single tenant to name. Idempotency keys, retry with backoff, job registry, failed-job alert hook. n8n explicitly not used for business logic.
**Acceptance:** (1) A registered job runs on schedule locally and records one `job_lauf` row plus one `job_lauf_mandant` row per tenant it touched. (2) A throwing job retries, is marked failed and raises an alert — no silent death. (3) The same job with the same idempotency key does the work once (row count). (4) A job registered without an explicit mandant context or a declared cross-mandant scope fails at registration. (5) A schema test asserts `job_lauf` has **no** `mandant_id` column and is absent from the isolation registry, while every per-tenant figure a job produces is reachable only through `job_lauf_mandant` — so a job result can never be read as tenant data with a missing tenant.
**NOT:** any concrete job (each arrives with its module), monitoring dashboards (PR 91).
**Migrations:** `0011_job_lauf` (both tables).
**Open:** none.

### PR 11 · Benachrichtigungs-Kern, Kanalpräferenzen, Kind-Registry
ROADMAP Phase 9, hoisted · **M** · deps: 8, 10
**Scope:** NOT-01 (mechanism + registry), NOT-02, NOT-03, EMP-11 (`nachricht`). In-app inbox in the shell, email channel, per-user per-kind preferences, digest batching.
**Acceptance:** (1) A notification without a resolvable target link fails validation at creation (NOT-03). (2) Disabling email for a kind stops email within the same request and keeps in-app. (3) A `reinigung` user gets 404 on a `bau` notification by direct id. (4) A registry test asserts every registered kind has a German title, body and link resolver. (5) An approval request is never merged into a digest.
**NOT:** the nine concrete NOT-01 kinds (registered by PRs 17, 31, 34, 38, 44, 55, 71, 82 — completeness asserted in PR 82).
**Migrations:** `0012_benachrichtigung`, `0013_nachricht`.
**Open:** none.

### PR 12 · Ausgangs-Gate und Freigabe-Kern — `server/agent/policy.ts`
ROADMAP Phase 8, hoisted · **M** · deps: 4, 7, 10, 11
Invariant 7 must exist before the first outbound message (PR 17's confirmation mail). Single choke point.
**Scope:** APR-07, AGT-03 evaluation half, SOC-08/REC-09/FIN-15 enforcement, LEG-08 hard gate. `freigabe` with an **immutable snapshot + payload hash**, approver, timestamp; `agent_richtlinie` table; `versand` as the only egress path; `gate(aktion, nutzlast)`.
**Acceptance:** (1) A send without an approved `freigabe` throws `FreigabeErforderlich`; a repo-guard test fails the build if any module imports a mail transport or HTTP send outside `versand`. (2) Editing the payload after approval invalidates the `freigabe` by hash mismatch and the send is refused. (3) A contact with `rechtsgrundlage = 'keine'` is refused **regardless of any approval** — LEG-08 is a hard gate, not a policy toggle. (4) With no policy row configured the gate **denies** — fail-closed, asserted. (5) A property test enumerating the whole `agent_richtlinie` configuration space proves **no configuration permits auto-sending an offer ≥ €20.000** — and none permits auto-sending any offer at all. (6) Every allow and refusal is audited.
**NOT:** approval inbox UI (PR 62), automation (PR 77), agent runtime (PR 74).
**Migrations:** `0014_freigabe`, `0015_agent_richtlinie`.
**Open:** none.

---

# Phase 2 · Public website & profiles
Lane A. PR 14 ‖ 15 after 13; PR 17 needs 13 + the kernels.

### PR 13 · Öffentliche Shell, Inhaltsmodell, Startseite
Phase 2 · **L** · deps: 2, 3, 9
**Scope:** PUB-01 (shells), PUB-02, PUB-03 (four brand cards, DESIGN §4), PUB-04, PUB-05, PUB-06, PUB-07 (`seite`/`abschnitt`/`medien` — **no hard-coded copy**), PUB-10 (`next/image`, hero `priority` only), PUB-13 (no third-party trackers ⇒ no cookie banner), PUB-14 (circular brand-avatar row). Header 72px with blur-on-scroll, footer, mobile overlay menu.
**Acceptance:** (1) Changing a `seite` row changes the page with no deploy. (2) Each brand card shows its identity hue as a 3px top border and the mandatory DESIGN §4.4 overlay gradient — asserted on computed style; a card without it fails. (3) The script face appears **exactly once** per page (node count) and one red accent word. (4) Playwright request interception asserts zero third-party requests on first load. (5) Hero renders 21:9 desktop / 4:5 mobile; no horizontal scroll at 375px; every `img` has `alt`.
**NOT:** profiles (15), forms (17), SEO/a11y gate (16), real content (14).
**Migrations:** `0016_seite_abschnitt_medien`.
**Open:** O-08 — `lib/domains.ts` empty, path-based `/[bereich]` under one group domain, `// TODO(client): eigene Domains je Bereich oder Pfade unter einer Gruppendomain?` O-13 — all imagery from the placeholder register.

### PR 14 · Übrige Seiten und Inhaltsmigration
Phase 2 · **M** · deps: 13 · ‖ PR 15
**Scope:** PUB-01 remaining routes (Unternehmen, four area pages, Leistungen, Projekte, Über uns, News, Kontakt), PUB-08 idempotent import from cse-dienstleistungen.de, NAP block from `mandant` rows.
**Acceptance:** (1) Every PUB-01 route returns 200 and renders from `seite`. (2) `pnpm content:import` run twice changes zero rows. (3) NAP strings are identical on every page and equal the `mandant` rows — asserted. (4) Every legacy URL 301s through a tested redirect map.
**NOT:** imagery migration (rights unclear until O-13), copywriting.
**Migrations:** none (data).
**Open:** O-13.

### PR 15 · Unternehmensprofile
Phase 2 · **M** · deps: 13 · ‖ PR 14
**Scope:** PRO-01 (logo, cover 3:1, description), PRO-02, PRO-03, PRO-05 through a `ReferenzQuelle` interface returning only entries with `freigegeben_vom_kunden = true` (the real `auftrag`-backed implementation lands in PR 27).
**Acceptance:** (1) All four profiles render with their own hue, logo and cover; `security` shows SSE Security's identity, not a CSE sub-brand (D-11). (2) A reference without customer release is **absent from the HTML and from the API response**. (3) Switching between profiles works from any profile, keyboard-operable, scroll preserved. (4) Each profile emits its own `LocalBusiness` JSON-LD with that entity's NAP.
**NOT:** posts (PR 83), the real reference source (PR 27).
**Migrations:** `0017_profil_referenz`.
**Open:** O-12, O-13.

### PR 16 · SEO, strukturierte Daten, WCAG- und Lighthouse-Gate
Phase 2 · **M** · deps: 13, 14, 15
**Scope:** PUB-09/LEG-07, PUB-10, PUB-11, PUB-12, sitemap, robots.
**Acceptance:** (1) axe over **every** public route reports zero AA violations and the CI job is required from this PR on. (2) Lighthouse mobile ≥ 90 performance, 100 accessibility on Home and one profile, enforced as a budget that fails on regression. (3) `LocalBusiness` + `Service` + `FAQPage` validate per area against the schema shape. (4) `/llms.txt`, `/sitemap.xml`, `/robots.txt` resolve; the sitemap lists published pages only and excludes `/dev/*`. (5) Keyboard-only traversal of Home reaches every interactive element with a visible focus ring.
**NOT:** portal accessibility (PR 92).
**Migrations:** none.
**Open:** O-08 (canonical host).

### PR 17 · Angebotsanfrage-Formulare → `lead` mit SLA, Eigentümer, Eskalation ⚑ *(Phase 2 acceptance)*
Phase 2 · **L** · deps: 8, 9, 10, 11, 12, 13
**Scope:** REQ-01 (`formular_definition`-driven), REQ-02, REQ-03, REQ-04 (LV upload via PR 9), REQ-05 (`lead` with SLA deadline + named owner), REQ-06 (hourly escalation via PR 10), REQ-07 (UTM + referrer), CRM-07, CRM-08 (`rechtsgrundlage = 'anfrage'` set automatically); honeypot + rate limit; minimal lead inbox; registers the *neuer Lead* notification kind.
**Acceptance:** (1) **The ROADMAP Phase 2 acceptance as an e2e test:** the cleaning form submitted at 375px produces, within one reload, an owned `lead` in the portal with deadline, `quelle`, `utm_*` and referrer. (2) Advancing the clock past the SLA and running the job escalates once per hour, audited; a second run in the same window sends nothing. (3) The confirmation email passes through `versand`/`policy.ts` and is audited; bypass is impossible (PR 12 repo guard). (4) A non-PDF/XLSX LV upload is refused by real MIME sniffing; the stored file is private, 15-minute signed URL. (5) A `security` submission is invisible to a `reinigung` user (isolation registry entry added in this PR).
**NOT:** lead scoring/pipeline (PR 21), auto-reply drafting (PR 80).
**Migrations:** `0018_lead`, `0019_formular_definition`.
**Open:** O-14 — `sla_stunden` per mandant seeded 24h, marked *provisorisch* in the UI, `// TODO(client): SLA-Frist je Bereich und Eskalationsempfänger?`

---

# Phase 3 · Portals & dashboards

### PR 18 · Kennzahl-Registry, Super-Admin- und Admin-Dashboard
Phase 3 · **L** · deps: 8, 17
**Scope:** DSH-01, DSH-02, DSH-03 (super_admin, admin), DSH-04. Each tile declares label, query, area scoping and — mandatory — a link target. Tiles available now: neue Leads, Leads über SLA, Benutzer, Personen, Anstellungen je Entität, letzte Aktivität, anstehende Aufgaben. Later PRs register their own.
**Acceptance:** (1) A test walks every rendered tile and asserts the KPI equals a direct SQL count **and** that clicking it lands on a filtered list whose row count equals the KPI (DSH-04, no dead numbers). (2) A tile registered without a query or link resolver fails the build. (3) The area filter changes every tile, the URL and the resulting lists, and never leaks a foreign row. (4) A tile whose module has not merged is **absent from the DOM** — "0" can never mean "not built". (5) KPI cards match DESIGN §5 at 4/2/1 columns.
**NOT:** DSH-05 (PR 34), money tiles (PR 56), tender pipeline (PR 71).
**Migrations:** none (views).
**Open:** none.

### PR 19 · Leitung-Dashboard, rollenbezogene Portal-Shells, Isolationssuite je Rolle
Phase 3 · **M** · deps: 18
**Scope:** DSH-03 (leitung), AUT-04, EMP-13, SEC-A1, SEC-A3 at role level.
**Acceptance:** (1) **The ROADMAP Phase 3 acceptance:** a table-driven enumeration over the full route manifest asserts a `mitarbeiter` session receives 404 on group financials, any other person's record and every customer commercial value — new routes are covered automatically because the test reads the manifest. (2) A `leitung` of `bau` gets 404 on every `security` record. (3) A hidden nav entry typed directly still 404s. (4) At 375px the five-destination bottom tab bar renders.
**NOT:** dashboard figures owned by later modules, employee hours (PR 39).
**Migrations:** none.
**Open:** none.

### PR 20 · Mitarbeiter-Zugang: Telefon + SMS, ein Login je Person, Sprachgerüst
Phase 3 · **M** · deps: 6, 19
**Scope:** EMP-01 (**no password**), EMP-02 shell, EMP-12 (de/en/ar/tr with RTL), EMP-13, EMP-14 (one login per **person**, `mitarbeiter_zugang` on `person_id`, D-09).
**Acceptance:** (1) Login with phone + 6-digit code succeeds and **no password field exists in the DOM**; a replayed or expired code fails; codes are rate-limited. (2) `mitarbeiter_zugang` is unique on `person_id` — a dual-employed person has exactly one login, asserted by a failing second insert. (3) Switching to `ar` sets `dir="rtl"` with no clipped text at 375px; a locale-completeness test asserts no untranslated key in any of the four locales. (4) The PR 19 enumeration test is re-run against the new routes and stays green.
**NOT:** hours, Stundenkonto, certificates, requests (PR 39).
**Migrations:** `0020_mitarbeiter_zugang`, `0021_sprache`.
**Open:** none.

---

# Phase 4 · CRM & operations

### PR 21 · CRM-Kern: Firmen, Kontakte, Lead-Pipeline, §7-UWG-Gate
Phase 4 · **L** · deps: 12, 17, 18
**Scope:** CRM-01, CRM-02, CRM-06, CRM-07, CRM-08, LEG-08. `firma`, `ansprechpartner`; `lead` extended with score, status, priority, source, owner, next action; `rechtsgrundlage` **not null** on every contact; `darfKontaktiertWerden()` that every outbound path passes.
**Acceptance:** (1) `versand` to a contact with `rechtsgrundlage = 'keine'` throws `KeineRechtsgrundlage` **in the service layer**, and a repo guard asserts no send path bypasses it. (2) A contact saved without an explicit basis defaults to `keine` — the safe default is asserted, not assumed; the UI states the reason in German and disables send. (3) CRM-06 renders one customer's history across three entities **only** in the read-only group context and offers no write control; in a single tenant it shows that tenant only. (4) Lead source is never null (DB constraint); every status transition is audited and preserves the PR 17 SLA deadline.
**NOT:** notes/history (PR 22), offers (PR 26).
**Migrations:** `0022_firma_ansprechpartner`, `0023_lead_pipeline`.
**Open:** O-15 — `score` is a stored integer with **no** automatic computation, `// TODO(client): welche Faktoren erzeugen einen Lead-Score, mit welchen Gewichten und Schwellen?`

### PR 22 · Notizen, Kommunikationsverlauf, Wiedervorlagen
Phase 4 · **S** · deps: 21 · ‖ PR 23
**Scope:** CRM-03, CRM-04.
**Acceptance:** (1) A note is append-only; editing creates a new version and the original stays readable. (2) A follow-up due today produces exactly one reminder linking to the record. (3) The timeline shows inbound submissions, outbound messages and calls in one ordered list in Europe/Berlin.
**NOT:** email integration (drafting in PR 80, sending gated by PR 12).
**Migrations:** `0024_notiz_kommunikation_wiedervorlage`.
**Open:** none.

### PR 23 · Kunden, Objekte, Raumbuch, Belagsart-Katalog
Phase 4 · **M** · deps: 21 · ‖ PR 22
**Scope:** OPS-01, OPS-02, OPS-03. `kunde`, `objekt` (address, optional coordinates), `raum` (`flaeche_qm` as fixed-scale decimal / integer cm² — never float), `belagsart` (**`leistungswert_qm_pro_stunde`** — the owner's spelling in `02-datenmodell/02-CRM-OPERATIONS.md` §4.2, whose room-level twin is `revier_raum.leistungswert_qm_pro_stunde`; neither `leistungswert` nor `leistungswert_qm_h` exists — plus `reinigungsklasse`).
**Acceptance:** (1) `Σ flaeche_qm` per object is computed by a service and matches a hand-checked fixture to two decimals; `3 × 4,20 m²` does not drift (asserted). (2) A `raum` cannot be created without a `belagsart`; a `belagsart` in use cannot be deleted. (3) A `belagsart` without a performance value **blocks a costing run with a named error** — never a silent zero. (4) `bau` gets 404 on a `reinigung` object. (5) Coordinates are optional and never required for a save.
**NOT:** import (PR 24), pricing (PR 25), Reviere (PR 40).
**Migrations:** `0025_kunde_objekt`, `0026_raum_belagsart`.
**Open:** O-17 — the catalogue ships **empty**, never with invented values, `// TODO(client): Leistungswerte je Belagsart bestätigen (Quelle, Tarif, Freigabe)`.

### PR 24 · Raumbuch-Import aus Excel/CSV mit Vorschau
Phase 4 · **M** · deps: 9, 23 · ‖ PR 25
**Scope:** OPS-04, DOC-06, SEC-A4. Upload, column mapping, **preview with per-row create/update/skip**, commit in one transaction, import log.
**Acceptance:** (1) A 2.000-row preview writes **nothing** — asserted by an unchanged `raum` count. (2) Committing the same file twice produces zero duplicates (idempotent on objekt + Raumnummer). (3) `12,50` parses correctly; a control row `12.50` is **flagged, not silently coerced**. (4) A malformed row blocks only itself and is reported with its line number.
**NOT:** employee or contract import (PR 89).
**Migrations:** `0027_import_lauf`.
**Open:** O-09 — batch size configurable, preview paginated so a 20k-row file does not depend on the answer.

### PR 25 · Leistungskatalog und Kalkulationsmaschine ⚑ *(Phase 4 acceptance)*
Phase 4 · **L** · deps: 1, 23 · ‖ PR 24
**Scope:** OPS-06, OPS-07, CLN-05 (glass, special cleaning, Warenräumung as distinct catalogue services). Pure services: `kalkuliere()` = labour + material + equipment + overhead + risk/profit, every amount in cents via PR 1, each intermediate rounded once at the defined step; `berechne_preis` exposed as a pure function for AGT-02.
**Acceptance:** (1) **The ROADMAP Phase 4 acceptance:** `Σ (raum m² ÷ Leistungswert) × Frequenzfaktor` prices a seeded Berlin object with **no manual arithmetic anywhere in the path**, asserted against a hand-computed fixture to the cent. (2) Every amount crossing the service boundary is `bigint`; a float in the module fails CI. (3) Changing one `belagsart` value re-prices deterministically and the run records the catalogue version used; finalised offers are untouched. (4) With surcharge rates unset the engine **refuses to produce a total** and the UI says "Kalkulationssätze nicht hinterlegt" — it does not compute with 0%. (5) A run against an unconfirmed catalogue returns a visible `unbestaetigte_grundlage` warning the offer UI must display.
**NOT:** offer document (PR 26), Aufmaß pricing (PR 48), any model involvement.
**Migrations:** `0028_leistungskatalog`, `0029_kalkulation`, `0030_zuschlagssatz`.
**Open:** O-16 — `// TODO(client): Gemeinkosten-, Wagnis- und Gewinnzuschläge sowie Stundenverrechnungssätze je Gewerk?`; O-17 carried from PR 23.

### PR 26 · Angebot mit entitätsrichtigem PDF
Phase 4 · **L** · deps: 9, 25
**Scope:** OPS-08, DESIGN §11. `angebot`, `angebotsposition`, versioning, status pills from the fixed vocabulary; PDF per entity — own logo, address, tax number, bank details, register court, HRB, managing director; A4, 20mm, 10pt, white page, `#111` text.
**Acceptance:** (1) The same offer rendered under `reinigung` and under `bau` produces different footers, logos and bank details — asserted on extracted PDF text. (2) Amounts print `1.234,56 €`, right-aligned, tabular; the PDF total equals the service total to the cent. (3) The PDF is private, signed-URL only. (4) Sending an offer requires an approved `freigabe` and a contact passing `darfKontaktiertWerden()`.
**NOT:** order conversion (PR 27), ZUGFeRD (PR 53).
**Migrations:** `0031_angebot_position`.
**Open:** O-24 — register court, HRB, managing director, USt-IdNr. and bank details are `mandant` fields; when blank the PDF renders a visible `FEHLT` marker so an incomplete document cannot pass as final, `// TODO(client): Handelsregisterdaten, USt-IdNr. und Bankverbindung je Entität?`

### PR 27 · Auftrag/Projekt, Angebot→Auftrag, Aufgaben, Referenzfreigabe, Attribution
Phase 4 · **L** · deps: 15, 21, 26
**Scope:** OPS-05, OPS-09, OPS-11, CRM-05, REQ-07 (UTM carried to `auftrag`), PRO-05 (real `ReferenzQuelle` implementation).
**Acceptance:** (1) Accepting an offer creates the order in **one action** with all positions, customer, term, responsible manager and the offer's UTM intact; the offer becomes immutable and links back. (2) The conversion is idempotent — a second accept creates no second order. (3) Marking an order `freigegeben_vom_kunden` makes it appear as a reference on the public profile; revoking removes it in the same request. (4) Lead → offer → order is walkable in both directions in the UI and in one test. (5) Registers the *aktive Aufträge* / *aktive Projekte* tiles, both linking through.
**NOT:** contract wizard (PR 28), billing (Phase 6), scheduling (Phase 5).
**Migrations:** `0032_auftrag_projekt`, `0033_aufgabe`.
**Open:** none.

### PR 28 · Neuer-Vertrag-Assistent
Phase 4 · **M** · deps: 27 · ‖ PR 29
**Scope:** OPS-10.
**Acceptance:** (1) The wizard surfaces, in order, location, staff needed, hours, equipment, start date and responsible manager, and **refuses to finish with any of them empty**. (2) Finishing creates the `auftrag`, links the `objekt` and stores planning defaults; abandoning creates **nothing** (row counts before/after). (3) Every step is completable by keyboard with announced validation errors.
**NOT:** generating the `planungsserie` (PR 30 provides the service; until merged the step is captured and marked *folgt*).
**Migrations:** none.
**Open:** none.

### PR 29 · Kundenportal I: Projekte, Aufträge, Dokumente, Nachrichten *(deviation E)*
ROADMAP Phase 3, dependency-deferred · **M** · deps: 9, 19, 27
**Scope:** DSH-03 (kunde), CRM-05 customer view, DOC-04, NOT-03; the customer-portal tab registry.
**Acceptance:** (1) A `kunde` sees only rows joined to its own customer identity; every foreign id returns 404 (enumeration test). The portal runs in `kunde` scope, and every predicate is `kunde_id = any (app.aktuelle_kunden())` — **the array accessor bound from `kunde_zugang`**. The scalar `app.aktueller_kunde()` resolves through `app.aktiver_mandant()`, which is NULL in `kunde` scope by construction, so a policy written with it reads zero rows and the whole portal ships dead with no error (K-20). (2) **No internal cost, no other customer, appears in any serialised payload** — neither the `anstellung.stundensatz_intern` column nor its `stundensatz_intern_cent` wire spelling — asserted field by field, not on the rendered page. (3) Documents open only through 15-minute signed URLs. (4) A customer message appears in the internal thread with the correct actor in `audit_log`. (5) A tab whose module has not merged states which module is not yet in service — never a fabricated figure. (6) `app.portal()` is `kunde` in this scope, bound at entry — asserted, because the fail-closed `mitarbeiter` fallback would ceiling every customer as though they were staff (K-20).
**NOT:** offers, invoices, payments (PR 57).
**Migrations:** none (uses `0013_nachricht`).
**Open:** none.

---

# Phase 5 · Scheduling, time and trade modules
PR 1's tests are the entry gate. The engine (PR 32) precedes the board (PR 33). Trade lanes 40 ‖ 41 ‖ 43 are mutually independent.

### PR 30 · `planungsserie` (RRULE), `einsatz`, Generator, Berliner Feiertage
Phase 5 · **L** · deps: 1, 10, 23, 27
**Scope:** TIM-02, TIM-03, CLN-02, CLN-03. RFC 5545 RRULE with single-occurrence overrides and exceptions; `einsatz` on **`anstellung_id`** (D-09) with **`beginn_zeitpunkt` / `ende_zeitpunkt timestamptz`** — the owner's names in `02-datenmodell/04-PLANUNG-ZEIT.md` §5.3, stored UTC and displayed Europe/Berlin (invariant 2); `beginn_utc` / `ende_utc` are the columns of K-06's `zeit_intern.arbeitszeit_fenster` and belong to no tenant table; nightly generator filling **eight weeks**; Berlin holiday table as data (8 March Frauentag included).
**Acceptance:** (1) A weekly series produces exactly the expected eight weeks of `einsatz`; a second generator run adds none. (2) An occurrence overridden once stays overridden after regeneration; the series stays intact. (3) A weekly RRULE across DST keeps the correct **local** time on both sides while `beginn_zeitpunkt` shifts by an hour — both fields asserted. (4) A series crossing 3 October produces no `einsatz` with the holiday rule on, and does with it off. (5) Durations of the 22:00–06:00 series on the two DST nights are **480/420/540** via PR 1's function, with no second implementation. (6) Every `einsatz` hangs off `anstellung_id`, never `person_id`.
**NOT:** conflicts (PR 32), UI (PR 33), time capture (PR 34).
**Migrations:** `0034_planungsserie`, `0035_einsatz`, `0036_feiertag`.
**Open:** O-09 (generator batch sizing configurable).

### PR 31 · Nachweise, Qualifikationen, §34a-Hartsperre, Bewacherregister
Phase 5 · **M** · deps: 3, 11 · ‖ PR 30
**Scope:** SEC-02, SEC-03, SEC-04, LEG-04, EMP-08 data. `nachweis`, `qualifikation`, `bewacher_eintrag`, `qualifikationsanforderung` — all person-facts on **`person_id`**; the 60/30/7-day notification kinds.
**Acceptance:** (1) Assigning a person whose required certificate expires **before the shift date** fails **in the service**, called directly with the UI bypassed (SEC-04). (2) A certificate valid at the shift date but expired today still permits that past shift — validity is evaluated at the shift date. (3) The same certificate is seen identically from both employments; a per-employment copy is **structurally impossible** (there is no column to hang it on) — asserted by a failing insert. (4) A `reinigung` planner sees qualification validity without any `security` wage data — asserted on the returned object shape. (5) 60/30/7 notices fire once each.
**NOT:** Posten/Wachbuch (PR 41); **no Bewacherregister API** — status is recorded manually and the UI says so.
**Migrations:** `0037_nachweis_qualifikation`, `0038_bewacher_eintrag`.
**Open:** none.

### PR 32 · Konflikt- und ArbZG-Prüfung über Entitäten hinweg ⚑
Phase 5 · **M** · deps: 1, 30, 31 — *the highest-risk PR of the phase; it lands before the board*
**Scope:** TIM-05, TIM-06, TIM-14, LEG-03. `pruefeEinsatz()` loading **all** shifts of a `person_id` across every `anstellung` regardless of active mandant — a deliberate, audited, service-layer-only cross-tenant read with a documented legal basis.
**Acceptance:** (1) **The ROADMAP Phase 5 acceptance at DB level:** a 6h `reinigung` shift plus a 5h `security` shift for one person on one day raises `tagesarbeitszeit_ueber_8h` **and** `tagesarbeitszeit_ueber_10h` (660 minutes on the Berlin calendar day); the per-employment control returns clean. Findings are written only by `app.arbzg_befund_schreiben(p_regel arbzg_regel, p_schwere verstoss_schwere, …)` — `arbeitszeit_verstoss` has no INSERT policy for `cse_app` (K-06), so a verdict that does not map onto the six `arbzg_regel` values cannot be recorded at all. (2) 23:00 finish in one entity, 07:00 start in another → `ruhezeit_unter_11h`. (3) The cross-entity read returns times and certificate validity **only** — never wage rates, customers or objects (asserted field by field; this is the D-09.6 tension and this test is the contract). (4) Overlap detection catches two `einsatz` rows for one `anstellung` at the same instant. (5) Every cross-tenant evaluation writes an audit row naming its purpose.
**NOT:** UI (PR 33).
**Migrations:** `0039_konflikt`.
**Open:** O-18 (10h exception parameter from PR 1).

### PR 33 · Dienstplan: Wochen- und Monatsansicht mit Parallelspalten ⚑
Phase 5 · **L** · deps: 2, 32
**Scope:** TIM-01, TIM-04, surfacing of PR 31/32 findings, DSH-04 drill-through.
**Acceptance:** (1) **Ten `einsatz` rows at the same instant on one `objekt` render as ten visible columns** — Playwright counts ten elements at distinct x-positions, none clipped, none merged. (2) A 22:00–06:00 shift renders across both days reading `8,00 h`; the DST nights read `7,00 h` and `9,00 h`. (3) An ArbZG breach and an expired-certificate assignment are flagged with **text, not colour alone** (DESIGN §9), before the planner can save. (4) A warning can be overridden only with a logged reason; the §34a block **cannot** be overridden. (5) The plan renders in Europe/Berlin under `TZ=UTC` and `TZ=America/New_York`; month view at 375px does not scroll horizontally.
**NOT:** drag-and-drop optimisation, auto-staffing.
**Migrations:** none.
**Open:** none.

### PR 34 · Tokenisierter Check-in, serverautoritative Zeit, Korrekturspur
Phase 5 · **L** · deps: 9, 10, 30
**Scope:** TIM-07 (token single-use, valid within the shift window ±1h), TIM-08 (server clock authoritative; the device readings `geraete_zeit_beginn` / `geraete_zeit_ende` and `zeitabweichung_sek` stored **separately** and never used as the authoritative instant), K-08/K-09 (the check-in path holds no session, so it does no table access of its own: `app.checkin_verbrauchen(p_token_hash text, p_geraete_zeit timestamptz, p_ip inet, p_user_agent text, p_geo jsonb default null)` — the owner's **five-argument** signature, since Postgres overloads on the argument list and a `GRANT EXECUTE` written against a three-argument form reaches nothing — redeems the token as one conditional write matched on `token_hash` with `eingeloest_am is null`, and inserts the `zeiteintrag` only if a row came back), TIM-11 (immutable correction trail), LEG-10 (single point at start and end, never continuous), DSH-05 (registers *Aktuell im Einsatz*).
**Acceptance:** (1) A client posting a timestamp two hours off is stored with the **server** instant and `zeitabweichung_sek = -7200`; the client value never becomes the record. (2) A token used twice returns 410; used 90 minutes before the window it is refused; both are logged. (3) Correcting an entry creates a new revision with actor, time and reason — the original is never overwritten and hard delete fails at the **database** layer. (4) The check-in screen fits one 375×812 screen with no scrolling, one primary button, 44px targets (DESIGN §8), axe clean. (5) With the `mandant_einstellung` key **`zeit.geolokalisierung`** off **no coordinate is captured or stored anywhere** — asserted on the request payload and on the row, and the `z_geo_gate` trigger of `02-datenmodell/04-PLANUNG-ZEIT.md` §5.6 reads it through `app.einstellung`. There is no `mandant.geo_erfassung_aktiv` column and no `mandant.ueberwachung_aktiv` column: one boolean on `mandant` cannot express the per-*Einrichtung* granularity §87 Abs. 1 Nr. 6 BetrVG requires (K-21). (6) The *Aktuell im Einsatz* tile equals a direct count of open entries, live. (7) `zeitabweichung_sek` is still **stored** with `zeit.abweichungsauswertung` off — invariant 5 requires the fact — while no report, ranking or alert aggregates it per person; storing a fact and evaluating it as a performance measure are different acts and only the second is gated.
**NOT:** offline queue (PR 35), Stundenkonto (PR 37).
**Migrations:** `0040_zeiteintrag`, `0041_checkin_token`, `0042_zeiteintrag_revision`.
**Open:** O-06 — the five monitoring switches ship as `mandant_einstellung` rows, each defaulting **false**: `zeit.geolokalisierung`, `zeit.geraetekennung`, `zeit.abweichungsauswertung`, `zeit.korrekturstatistik`, `zeit.nichterschienen_auswertung`. `// TODO(client): O-06 — Gibt es einen Betriebsrat? §87 Abs. 1 Nr. 6 BetrVG entscheidet, ob LEG-10 überhaupt ausgeliefert wird — und die Frage betrifft neben der Geolokalisierung auch Gerätekennung, Geräteabweichung, Korrekturstatistik und Nicht-erschienen-Auswertung.`

### PR 35 · Offline-Warteschlange und Medienerfassung
Phase 5 · **M** · deps: 9, 34
**Scope:** TIM-09, TIM-10, DOC-06.
**Acceptance:** (1) With the network disabled, a capture queues; on reconnect it submits flagged `nacherfasst` and stores **both** the claimed instant and the server receipt instant — neither overwrites the other, both visible to the planner. (2) The queue survives a page reload and a browser restart; a duplicate submission of the same queued item creates one row. (3) A queued entry never overwrites a server-recorded one. (4) An uploaded photo has no EXIF GPS and is served only through a signed URL; oversized video is refused client- and server-side.
**NOT:** native app.
**Migrations:** `0043_medien`, `0044_offline_warteschlange`.
**Open:** none.

### PR 36 · Zeit → Auftrag, Monatssplit, MiLoG-Aufzeichnung, Zeit-Einwand
Phase 5 · **M** · deps: 27, 34
**Scope:** TIM-12, TIM-13, LEG-02, EMP-07 (record + planner queue).
**Acceptance:** (1) Every `zeiteintrag` resolves to exactly one `auftrag` through its `einsatz`; an unresolvable entry is reported, never dropped — billing needs no manual transfer. (2) A shift crossing month-end splits by **actual minutes**, both parts summing to the whole — asserted for 31.10 → 01.11 including the DST change. (3) An `anstellung` and its `auftrag` must belong to the same `mandant` — a DB constraint, proven by a failing insert (D-09.5). (4) An employee **cannot** update a `zeiteintrag` under any role configuration: the attempt returns 404 and the only affordance creates a `zeit_einwand` reaching the planner (EMP-07). (5) The §17 MiLoG export lists start, end and duration per employee for a month, matches the entry sum exactly, and `DELETE` on it fails.
**NOT:** invoicing from time (PR 48).
**Migrations:** `0045_zeiteintrag_auftrag`, `0046_zeit_einwand`.
**Open:** none.

### PR 37 · Stundenkonto, Urlaubskonto, Monatsabschluss
Phase 5 · **M** · deps: 36
**Scope:** EMP-04, EMP-05, EMP-15, REP-04 source.
**Acceptance:** (1) **A locked month cannot change:** any write returns `MonatGesperrt`, the locked figures are byte-identical afterwards, and a correction posts into the following month — reopening is impossible, only a compensating entry exists. (2) A dual-employed person has **two** `stundenkonto` rows per month with different rates; the combined figure is computed for display and never stored. (3) Carry-forward across twelve months is exact to the minute. (4) A month-crossing shift is split by actual minutes at DB level (PR 1's rule).
**NOT:** payroll calculation (D-06); the export lands in PR 67.
**Migrations:** `0047_stundenkonto`, `0048_urlaubskonto`.
**Open:** O-18 — the contracted hours are `anstellung_kondition.wochenstunden` (dated, with `anstellung.wochenstunden` as its derived mirror) and the leave entitlement is `urlaubskonto.anspruch_tage` per `anstellung` and year; there is no `anstellung.urlaubstage_jahr` column. Both are data with **no** automatic accrual rule, `// TODO(client): O-18 — Arbeitszeitmodelle, Sollstundenherleitung, Urlaubsanspruch, Übertragung und Überstundenverfall je Entität/Tarif?`

### PR 38 · Abwesenheiten und Anträge: Krankmeldung, Urlaub, Schichttausch
Phase 5 · **M** · deps: 11, 37
**Scope:** EMP-10, `abwesenheit` (on `anstellung_id`), `antrag`, planner queue with approve/reject and reasons.
**Acceptance:** (1) An approved leave request writes `abwesenheit` and the Dienstplan flags every affected `einsatz`. (2) A rejected request keeps its reason and both timestamps. (3) A sickness report at 05:40 for a 06:00 shift alerts the planner immediately. (4) An absence in one entity is visible to the other entity's planner **as unavailability only, without the reason** — health-data minimisation, asserted on the payload.
**NOT:** agent replacement proposals (PR 80).
**Migrations:** `0049_abwesenheit`, `0050_antrag`.
**Open:** O-18.

### PR 39 · Mitarbeiterportal: Stunden, Monats-PDF, Nachweise, Anträge, vier Sprachen
Phase 5 · **L** · deps: 20, 31, 35, 37, 38
**Scope:** EMP-02, EMP-03, EMP-06, EMP-07 (screen), EMP-08, EMP-11, EMP-12, EMP-14, EMP-15.
**Acceptance:** (1) One login shows shifts from both employments each labelled with its entity; header hours are combined while the two `stundenkonto` figures stay separate (EMP-15). (2) The employee UI offers **no edit control** on a `zeiteintrag`; the API refuses with 404 and only `zeit_einwand` exists. (3) The monthly PDF total equals the `stundenkonto` figure to the minute and is signed-URL only. (4) The employee sees no wage rate but their own and no customer price anywhere — asserted on payloads. (5) An expired certificate warns the employee and blocks assignment in PR 31 — one source, two consumers. (6) Arabic sets `dir="rtl"` with zero axe violations.
**NOT:** Dienstanweisung acknowledgement (PR 42 owns EMP-09 with the versioned document).
**Migrations:** none.
**Open:** O-18 (displayed leave entitlement).

### PR 40 · Reinigung: Reviere, Turnus, Leistungsnachweis, Reklamation
Phase 5 · **L** · deps: 23, 25, 30, 35 · ‖ PR 41 ‖ PR 43
**Scope:** CLN-01, CLN-02 (consumer), CLN-04, CLN-05 (consumer), plus `reklamation` and `qualitaetspruefung` from SPEC §22 (no feature ID — recorded in DECISIONS.md as derived from the data model).
**Acceptance:** (1) Signing a Leistungsnachweis stores signer name, **server** time, location and an **immutable snapshot of the items exactly as displayed**; changing the underlying `revier` afterwards does not change the snapshot — asserted by hash comparison before and after. (2) The device timestamp is stored separately from the server one; the signature image is private, signed-URL only. (3) `Σ revier_raum.sollzeit_minuten` equals `revier.sollzeit_minuten` and reconciles with the PR 25 costing for the same rooms — both carriers are `numeric(8,2)` **computed targets** under the K-16(c) deviation, so the engine never rounds twice between them; every *measured* duration in the platform stays `integer`. (4) A Reklamation links to the Leistungsnachweis it disputes and to the responsible `einsatz`.
**NOT:** invoicing the Leistungsnachweis (PR 48).
**Migrations:** `0051_revier`, `0052_turnus`, `0053_leistungsnachweis`, `0054_reklamation_qualitaetspruefung`.
**Open:** O-29 — both are plain records with a free-text result and **no** scoring, `// TODO(client): Was löst eine Qualitätsprüfung aus, welche Skala gilt, und was folgt auf eine nicht bestandene Prüfung?`

### PR 41 · Security A: Posten, Wachbuch, kurzfristige Eventbesetzung
Phase 5 · **L** · deps: 31, 33, 35 · ‖ PR 40 ‖ PR 43
**Scope:** SEC-01, SEC-05, SEC-08.
**Acceptance:** (1) A post below minimum staffing cannot be published as staffed and is selected by the urgent-alert query (wired in PR 82). (2) Assigning an unqualified or expired-certificate person to a post fails **in the service** — PR 31's block re-asserted through the security path, with no bypass route. (3) A `wachbuch_eintrag` (patrol / incident / handover / key / alarm) is append-only with the **server** timestamp; an update or delete fails at the database layer and a correction is a new linked entry. (4) A manipulated device clock changes no recorded time. (5) Short-notice event staffing creates `einsatz` rows through the same PR 32 checks — asserted that no bypass path exists.
**NOT:** Dienstanweisung, keys (PR 42).
**Migrations:** `0055_posten`, `0056_wachbuch`.
**Open:** none.

### PR 42 · Security B: versionierte Dienstanweisung mit Kenntnisnahme, Schlüsselverwaltung
Phase 5 · **M** · deps: 20, 41
**Scope:** SEC-06, SEC-07, EMP-09.
**Acceptance:** (1) Publishing version 3 marks every prior acknowledgement outdated and requires a new one; the old version and its acknowledgements stay intact, and the acknowledgement stores the version hash. (2) An employee sees an unacknowledged instruction before their next shift and acknowledges in one tap on a phone. (3) A key handover produces a receipt with signature, both parties and the server time; the return closes it and both states remain logged. (4) A second handover without a return is refused — a key can never be in two places.
**NOT:** access-control hardware.
**Migrations:** `0057_dienstanweisung_kenntnisnahme`, `0058_schluessel_quittung`.
**Open:** none.

### PR 43 · Bau A: Leistungsverzeichnis mit OZ-Hierarchie und Aufmaß mit Rechenansatz-Parser ⚑
Phase 5 · **L** · deps: 27, 35 · ‖ PR 40 ‖ PR 41
**Scope:** BAU-01, BAU-02, BAU-03.
**Acceptance:** (1) **`"3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"` → `30,87 m²`**, and the formula text is stored verbatim and displayed beside the result. (2) The parser accepts German decimal commas, `×`/`x`/`*`, `−`/`-`, `+` and nested parentheses and **rejects everything else** with a character offset; a 10.000-input fuzz test yields a value or a typed error — never a crash, never `NaN`, and no `eval` exists. (3) An Aufmaß cannot be finalised without countersignature and at least one photo. (4) OZ ordering places `1.2.10` after `1.2.9`; `Σ` per Titel and per Los reconcile with the LV total to the cent. (5) The result is stored at fixed scale (integer cm²), never as a float.
**NOT:** unit-price invoicing (PR 48), Nachträge (PR 44), GAEB round-trip.
**Migrations:** `0059_lv_position`, `0060_aufmass`.
**Open:** O-23 — **no** automatic VOB/C deduction is applied; the parser evaluates exactly what the human wrote, `// TODO(client): sollen VOB/C-Abzugsregeln automatisch angewandt werden, oder bleibt der Rechenansatz vollständig manuell?`

### PR 44 · Bau B: Nachträge, Behinderungsanzeige, Warnung außerhalb des LV
Phase 5 · **M** · deps: 11, 43 · ‖ PR 45
**Scope:** BAU-04, BAU-05, BAU-06.
**Acceptance:** (1) `angemeldet_am` and `eingereicht_am` are separate columns, separately displayed; one announced and unsubmitted after 14 days is selected by the watchdog query (wired in PR 82) and notifies once. (2) Logging time or an Aufmaß against a position not in the LV raises a visible warning naming the position and offers to create a Nachtrag. (3) A Behinderungsanzeige is generated from a template, its send date is documented, it is archived as a document, and the send passes `policy.ts`. (4) The §2 VOB/B basis is a required selection from a config table, never free text or a default.
**NOT:** pricing the Nachtrag (PR 48).
**Migrations:** `0061_nachtrag`, `0062_behinderung`.
**Open:** O-23 — the basis list is seeded from the statute text and flagged `unbestaetigt`, `// TODO(client): welche §2-VOB/B-Grundlagen (Abs. 3/5/6/7/8) verwendet die Gruppe?`

### PR 45 · Bau C: Bautagebuch mit DWD-Wetter
Phase 5 · **M** · deps: 34, 43 · ‖ PR 44
**Scope:** BAU-07, BAU-08 (DWD open data — a genuinely public source, no credentials, no simulation).
**Acceptance:** (1) A daily entry records weather, Mannstunden per trade, equipment, deliveries, incidents and photos, append-only with an immutable correction trail. (2) Weather comes from DWD for the site's coordinates and is stored **with observation time and station**; when DWD is unreachable the field reads "Wetterdaten nicht verfügbar" and the entry still saves — nothing is fabricated. (3) Mannstunden per trade reconcile against `zeiteintrag` for that day and site; a divergence is reported, not hidden.
**NOT:** forecast, radar imagery, site cameras.
**Migrations:** `0063_bautagebuch`, `0064_wetter_beobachtung`.
**Open:** none.

---

# Phase 6 · Finance
The counter and the chain already exist and are proven (PR 5).

### PR 46 · Rechnungs-Lebenszyklus, Nummernvergabe, Unveränderbarkeit, Kettenbindung, Storno ⚑
Phase 6 · **L** · deps: 1, 5, 27
**Scope:** FIN-02, FIN-03, FIN-06, FIN-16 groundwork, TEN-02, LEG-01, invariants 4 and 8. `rechnung`, `rechnungsposition` (all cents; the tax reference on a line is **`steuersatz_gruppe_id`** — the platform's one tax catalogue, K-21), `status rechnung_status` with **exactly the three values `entwurf · festgeschrieben · verworfen`** and exactly two transitions, `entwurf→festgeschrieben` and `entwurf→verworfen`. **There is no `storniert` status:** a Storno is a separate invoice drawing its own number and linked back through **`rechnung_beziehung`** (K-12, owned by `02-datenmodell/05-FINANZEN.md`), and `verworfen` exists because invariant 8 forbids deleting a discarded draft. A `festgeschrieben→storniert` transition would be built only to be refused by the immutability trigger. `finalisiere()` taking the number from `vergebeNummer` **inside the same transaction** and writing the chain hash; a trigger rejecting any UPDATE on a finalised row, unconditional and with no column allowlist — which is why `versendet_am` and the Storno back-reference live in the child tables `rechnung_versand` and `rechnung_beziehung` rather than on the invoice row (K-12).
**Acceptance:** (1) **Creating and deleting 1.000 drafts leaves zero gaps** in the finalised sequence. (2) A draft has `nummer IS NULL`, enforced by a CHECK that makes `festgeschrieben` with a null number impossible. (3) Fifty **concurrent** finalisations produce fifty consecutive numbers, no duplicate, no gap. (4) `UPDATE rechnung SET netto_gesamt_cent = … WHERE status='festgeschrieben'` **fails at the database layer as the service role**, application bypassed — and so does `UPDATE rechnung SET versendet_am = …`, because that column is not on the invoice row at all. (5) Correcting a finalised invoice produces a Storno plus a new invoice, related through `rechnung_beziehung`; the original stays readable and both are chained. Discarding a draft sets `verworfen` and never deletes. (6) Tampering with a payload makes the nightly job name the first broken invoice number. (7) Two mandanten finalise concurrently and each keeps its own gapless circle.
**NOT:** §14 validation (47), billing types (48), PDF, XRechnung.
**Migrations:** `0065_rechnung`, `0066_rechnung_immutability_trigger`, `0067_rechnung_hash`.
**Open:** O-01 — finalising an `operations` invoice is refused with "Rechnungskreis für CSE Operations nicht freigegeben"; the answer is a data change, not code.

### PR 47 · §14-UStG-Pre-Flight-Validator, Leistungszeitraum, Kleinbetragsrechnung
Phase 6 · **M** · deps: 46
**Scope:** FIN-04, FIN-05, FIN-13, LEG-05.
**Acceptance:** (1) Finalisation is blocked with a German **field-by-field** list — one table-driven test per §14 Abs. 4 field: both parties' name and address, tax number or USt-IdNr., issue date, sequential number, quantity and nature, Leistungszeitpunkt/-zeitraum, net per tax rate, rate and amount or exemption reference, advance-payment note. (2) A missing Leistungszeitraum alone blocks finalisation: a finalised invoice has non-null **`leistung_von` / `leistung_bis`** by constraint (the owner's column names — there is no `leistungszeitraum_von`), **or**, for an `abschlag` / `anzahlung`, a non-null `vereinnahmung_geplant_am`. §14 Abs. 4 Nr. 6 UStG asks for the Zeitpunkt der Leistung *or* der Vereinnahmung, and an unconditional requirement would make every Vorauszahlungsrechnung FIN-08 needs impossible to finalise — both branches asserted. (3) 249,99 € finalises under §33 UStDV; 250,00 € does not — both sides of the boundary asserted. (4) The validator is one pure service called by finalisation, the preview and the API — asserted by a repo guard; a client skipping it still cannot finalise.
**NOT:** §13b/§48 (PR 51).
**Migrations:** `0068_rechnung_pflichtfelder`.
**Open:** O-24 — USt-IdNr./Steuernummer per entity are required on `mandant`; blank **blocks** finalisation rather than defaulting.

### PR 48 · Fünf Abrechnungsarten hinter einem Interface
Phase 6 · **L** · deps: 25, 47
**Scope:** FIN-01. `Abrechnungsart` registry with the five FIN-01 implementations — hourly (`zeiteintrag`), monthly flat (contract), fixed-price lot, unit price by `aufmass`, single call-off.
**Acceptance:** (1) Each of the five produces a correct invoice from seed data to the cent, with VAT **per tax-rate group**. (2) An hourly line equals the sum of its `zeiteintrag` minutes × rate **recomputed by the service**, never carried from the UI, and matches the Stundenkonto figure. (3) The unit-price strategy uses the **stored** Aufmaß result, never re-parsing at billing time, prints the Rechenansatz on the line, and refuses an un-countersigned Aufmaß. (4) An `auftrag` without a billing type cannot be invoiced (typed error, no default). (5) Registering a sixth strategy requires **no change** to the invoice service — proven with a test double.
**NOT:** partial/final deduction (50).
**Migrations:** `0069_abrechnungsart`, `0070_rechnungsposition_typ`.
**Open:** O-04 — implemented exactly as FIN-01 names them, each class marked *provisorisch* in the UI and carrying `// TODO(client): sind dies exakt die fünf Abrechnungsarten? Bezeichnung, Rundung und Satzbasis je Art bestätigen.`

### PR 49 · Positionsherkunft und Warnung bei fehlender Zeiterfassung
Phase 6 · **M** · deps: 36, 43, 48
**Scope:** FIN-07, FIN-18, CRM-05 final link.
**Acceptance:** (1) Every line carries a typed `quelle_typ`/`quelle_id`; a line without a source **cannot be created** (constraint). (2) Clicking a line opens the exact `zeiteintrag` or `aufmass` behind it and the sources sum to the line to the cent. (3) Finalising a completed order with zero recorded minutes raises a blocking FIN-18 warning naming the order, overridable only with a logged reason, **before a number is taken**. (4) An already-invoiced `zeiteintrag` cannot be silently re-invoiced.
**NOT:** material purchasing.
**Migrations:** `0071_position_herkunft`.
**Open:** none.

### PR 50 · Abschlags- und Schlussrechnung mit automatischem Abzug
Phase 6 · **M** · deps: 49
**Scope:** FIN-08.
**Acceptance:** (1) Three Abschläge of 10.000,00 € against a 50.000,00 € order produce a Schlussrechnung deducting exactly 30.000,00 €. (2) Finalising a Schlussrechnung that omits a prior partial is **refused**, naming the missing invoice number. (3) An Abschlag reversed by a Storno (its own invoice, linked through `rechnung_beziehung` — there is no `storniert` status) is excluded from the deduction basis and blocks finalisation until reviewed. (4) The deduction is computed in cents as the sum of prior net amounts **per tax group**, never from a gross total; a 1/3-split rounding test is included. (5) The invoice prints the deduction table.
**NOT:** Sicherheitseinbehalt.
**Migrations:** `0072_abschlag_bezug`.
**Open:** O-20 — `// TODO(client): behält die Gruppe einen Sicherheitseinbehalt ein, in welcher Höhe und über welche Frist?`

### PR 51 · §13b UStG Reverse Charge und §48 EStG Bauabzugsteuer
Phase 6 · **M** · deps: 47, 48
**Scope:** FIN-09, FIN-10, LEG-06.
**Acceptance:** (1) A construction service to a recipient flagged Bauleistender prints the mandatory §13b note with 0,00 € VAT and shifts the liability — asserted in the stored payload and the PDF text; the same service to a non-Bauleistender does not. (2) Without a Freistellungsbescheinigung valid at the relevant date, 15% is withheld as its own line computed in cents; with one valid, nothing is. (3) A certificate expiring the day **before** withholds, the day after does not — both boundaries asserted. (4) §13b and §48 combined on one invoice produce the correct payable — the combination is tested, not only each rule. (5) Applying §13b to a non-construction customer is refused; neither rule can be switched off per invoice without an audited reason. (6) Both are pure services with no model involvement.
**NOT:** Bagatellgrenzen, tax filing (D-06).
**Migrations:** `0073_freistellungsbescheinigung`, `0074_steuerfall_kennzeichen`.
**Open:** O-21 — `// TODO(client): §48 EStG knüpft im Gesetzeswortlaut an die Gegenleistung (Zahlung) an, SPEC FIN-10 an das Leistungsdatum — welchen Stichtag muss die Plattform anwenden (Steuerberater)?` The date is one injected parameter: a one-line change plus a test.

### PR 52 · XRechnung (UBL, EN 16931) mit Leitweg-ID, KoSIT-validiert in CI ⚑
Phase 6 · **L** · deps: 47, 51 · ‖ PR 54
**Scope:** FIN-11. Without it the group cannot invoice GIZ, DRV Bund or Berlin districts at all.
**Acceptance:** (1) A finalised invoice for a public buyer produces XML that the **KoSIT validator passes with zero errors as a required CI job**, validator pinned by version and checksum so a pass is reproducible. (2) A missing or malformed Leitweg-ID **blocks generation** with a German message — never a placeholder ID. (3) XML amounts equal the stored cents exactly with the VAT breakdown per tax group; a §13b invoice exports with the correct EN 16931 tax category code and still validates. (4) Umlauts, € amounts and dates round-trip.
**NOT:** transmission — no Peppol access point, no OZG-RE client; the channel shows `nicht verbunden`.
**Migrations:** `0075_leitweg_id`.
**Open:** O-22 — Leitweg-ID captured per `kunde`; `// TODO(client): Leitweg-IDs je öffentlichem Auftraggeber und welcher Übertragungsweg wird verlangt — OZG-RE, Peppol oder E-Mail-Anhang?`

### PR 53 · ZUGFeRD 2.x, PDF/A-3
Phase 6 · **M** · deps: 26, 52
**Scope:** FIN-12, DESIGN §11.
**Acceptance:** (1) The file passes a **PDF/A-3** conformance check (veraPDF) in CI and the embedded CII XML validates against the ZUGFeRD 2.x schema. (2) A test extracts the XML and asserts its totals equal the printed totals **in both directions**. (3) The layout follows DESIGN §11 with the correct entity's footer — snapshot per entity.
**NOT:** email dispatch (gated by PR 12).
**Migrations:** none.
**Open:** none.

### PR 54 · Eingangsrechnungen, Belege, Ausgaben, Zahlungen
Phase 6 · **M** · deps: 9, 46 · ‖ PR 52
**Scope:** FIN-14, DOC-01, LEG-01.
**Acceptance:** (1) An incoming invoice is captured with supplier, number, date and amounts **per tax rate** in cents — never a gross with a blended rate — and linked to its document. (2) Hard delete fails at the database layer; cancellation leaves the record with a reason. (3) Duplicate detection by (supplier, number) warns before saving. (4) A partial payment leaves the correct open amount in cents; an over-payment is flagged, never silently absorbed. (5) Every expense carries `mandant_id` and is 404 cross-tenant.
**NOT:** OCR (PR 63), bank import (PR 61), booking records (PR 58).
**Migrations:** `0076_eingangsrechnung`, `0077_beleg`, `0078_ausgabe`, `0079_zahlung`.
**Open:** none.

### PR 55 · Mahnwesen
Phase 6 · **M** · deps: 11, 12, 54
**Scope:** FIN-15; registers the "overdue > 14 days" watchdog rule.
**Acceptance:** (1) An invoice 15 days overdue produces a **proposal**, never a sent letter (invariant 7). (2) A payment received between proposal and approval cancels the dunning automatically and re-opens the correct state if the allocation is reversed. (3) Fees and interest are computed by a tested service from **configured** values; with rates unconfigured the letter shows the principal only and no invented fee. (4) A level cannot be skipped without an audited override, and the same level is never sent twice for one invoice.
**NOT:** collection handover, legal dunning procedure.
**Migrations:** `0080_mahnung`, `0081_mahnstufe_konfiguration`.
**Open:** O-19 — levels 1–3 configurable, **fee 0,00 €**, interest unset, `// TODO(client): Mahnstufen, Intervalle, Mahngebühren und Verzugszinssatz (§288 BGB-Basis bestätigen)?`

### PR 56 · Rechnungsausgangsbuch und Umsatz/Kosten/Ergebnis
Phase 6 · **M** · deps: 46, 54
**Scope:** FIN-16, FIN-17; registers the money tiles (DSH-01, DSH-02, DSH-04).
**Acceptance:** (1) The Ausgangsbuch per circle lists an unbroken, ordered sequence and reconciles to the sum of its invoices to the cent — no gap, no duplicate. (2) Group figures equal the sum of the four areas to the cent, and the group view offers no write control. (3) Drafts are excluded from revenue — a test asserts a draft never moves a KPI. (4) A Storno reduces revenue in the storno period, never by editing the original. (5) Every figure drills through to the invoices behind it.
**NOT:** BWA-style monthly figures (PR 65), reporting suite (PR 88).
**Migrations:** none (views).
**Open:** none.

### PR 57 · Kundenportal II: Angebote, Rechnungen, Zahlungsstatus
Phase 6 · **S** · deps: 29, 53, 56
**Scope:** the remaining `kunde` scope via the PR 29 tab registry.
**Acceptance:** (1) A customer sees only their own invoices; a foreign id returns 404. (2) **Draft invoices are never visible to a customer** — asserted; drafts have no number and no legal existence. (3) The downloaded PDF is byte-identical to the hashed finalised payload. (4) Accepting an offer in the portal triggers the PR 27 conversion path.
**NOT:** online payment.
**Migrations:** none.
**Open:** none.

---

# Phase 7 · Accounting & DATEV
**Nothing here simulates DATEV.** The phase is not done until the tax advisor accepts a real EXTF file (PR 60's open question).

### PR 58 · Kontenrahmen SKR03/04, `konto_mapping`, automatische Buchungssätze
Phase 7 · **L** · deps: 46, 54
**Scope:** ACC-01. SKR03 and SKR04 as **data** behind a `KontenrahmenAdapter`; `konto_mapping` (mandant, business case, tax key → account); `buchungssatz` generation from finalised invoices, incoming invoices and payments.
**Acceptance:** (1) A finalised 19% invoice produces a **balanced** booking record (debit = credit to the cent); an unbalanced record cannot be stored (constraint). (2) An **unmapped** business case produces no booking and a visible "Kontenzuordnung fehlt" — it never guesses an account. (3) Switching an entity's profile SKR03↔SKR04 is a row change with **no code change** — the same fixture is run through both. (4) Reverse-charge and Bauabzugsteuer cases produce the mapping slots they need, empty and blocked until configured. (5) A Storno generates the counter-booking automatically; booking records are immutable.
**NOT:** export (60), document link (59), bank data (61).
**Migrations:** `0082_konto`, `0083_konto_mapping`, `0084_buchungssatz`.
**Open:** O-05 — SKR choice, Sachkontenlänge, Steuerschlüssel, Beraternummer, Mandantennummer, fiscal-year start are `mandant` configuration rows seeded **empty**, `// TODO(client): DATEV-Stammdaten je Entität vom Steuerberater.`

### PR 59 · Belegverknüpfung — das Dokument reist mit der Buchungszeile
Phase 7 · **M** · deps: 9, 58
**Scope:** ACC-03, DOC-04. This is where the tax advisor's bill actually shrinks.
**Acceptance:** (1) Every booking line resolves to exactly one document; a line without one is listed as incomplete and **blocks the export**. (2) Opening the document from the line uses a signed URL and the file is byte-identical to the archived original. (3) A document referenced by a booking cannot be deleted. (4) The export package pairs each booking with its file per a manifest.
**NOT:** DATEV transmission.
**Migrations:** `0085_beleg_verknuepfung`.
**Open:** O-05 (link format sits behind the PR 60 interface).

### PR 60 · DATEV-EXTF-Export ⚑
Phase 7 · **L** · deps: 58, 59
**Scope:** ACC-02. **No DATEV API client, no simulated transmission.**
**Acceptance:** (1) The writer emits **Windows-1252** — `ü` is byte `0xFC`, no UTF-8 BOM — with a **comma decimal separator** and CRLF, asserted on the raw bytes, not a decoded string. (2) With the O-05 configuration empty the export button is disabled and the API **refuses**, naming the missing values in German — no partially-correct file is ever produced. (3) A round-trip test re-reads the file and reconciles every booking to the cent; the same period exported twice yields identical bytes. (4) The UI shows "Format nicht gegen ein echtes Muster geprüft" while no client sample is in the fixture set, and a test asserts that badge is present while the fixture is absent.
**NOT:** DATEVconnect, any live call.
**Migrations:** `0086_datev_export`.
**Open:** **O-05, blocking the phase.** The golden fixture is marked *spec-derived, not client-derived*. The ROADMAP's Phase 7 acceptance is met by a follow-up once the real sample arrives — this is a merge-blocking note for the **phase**, not for the PR.

### PR 61 · CAMT.053-Import und Abgleich
Phase 7 · **M** · deps: 54, 56 · ‖ PRs 58–60
**Scope:** ACC-04.
**Acceptance:** (1) A CAMT.053 file imports idempotently — re-importing adds nothing. (2) An exact amount + invoice number + IBAN match allocates and marks the invoice paid; an ambiguous match is **queued for a human, never auto-assigned**. (3) Amounts parse into cents with no float step, asserted on `1234,56` and on a negative amount. (4) An unmatched movement stays visible in a queue rather than disappearing; a matched payment is reversible and audited, and the reversal updates the dunning state.
**NOT:** bank API, PSD2/FinTS, outgoing SEPA files.
**Migrations:** `0087_kontoauszug`, `0088_umsatz_zuordnung`.
**Open:** none.

### PR 62 · Freigabe-Posteingang: Diff-Review, Quellenangabe, Konfidenz
Phase 7 (APR core, first consumer is ACC-05) · **L** · deps: 12, 19
**Scope:** APR-01, APR-02, APR-03, APR-07 (surfacing the PR 12 kernel).
**Acceptance:** (1) The inbox sorts by deadline and risk and renders a **diff** — *"Wie im Vormonat, zusätzlich +12 Nachtstunden Kurfürstendamm → +456,00 €"* — and the reviewer never sees the full document unless they ask. (2) Every extracted value shows its source page/table and a confidence flag; a low-confidence field is visibly flagged. (3) The approved snapshot is byte-identical to what was rendered and cannot be altered afterwards (database level); changing the underlying record does not change the snapshot. (4) An item with any low-confidence field cannot be batch-approved — the batch action is disabled with the reason shown.
**NOT:** batch/delayed release/undo/APR-08 (PR 77), agents.
**Migrations:** `0089_freigabe_posteingang`.
**Open:** none.

### PR 63 · Eingangsrechnung: OCR → Extraktion → Buchungsvorschlag → Freigabe
Phase 7 · **L** · deps: 54, 58, 62
**Scope:** ACC-05, invariant 6. `BelegExtraktion` interface (OpenAI, EU processing, zero retention) producing a `buchungsvorschlag`; **every number re-computed by the PR 1 services**.
**Acceptance:** (1) A proposal whose net + VAT ≠ gross is **rejected by the service before a human sees it** — the model's arithmetic is never trusted; asserted with a deliberately wrong fixture, and the model's own gross is discarded when it disagrees with the computed one. (2) Nothing is booked without a `freigabe`; a test asserts no direct-booking path exists; approving creates the `eingangsrechnung`, its `buchungssatz` and the Belegverknüpfung in one transaction, rejecting creates nothing. (3) Each field shows source page and confidence; the entity assignment is always explicit, never defaulted. (4) With no OpenAI credentials, upload still works, extraction is skipped and the UI says `nicht verbunden`. (5) An unmapped account yields "Kontenzuordnung fehlt", never an invented account.
**NOT:** the agent wrapper (PR 81), bank matching.
**Migrations:** `0090_buchungsvorschlag`, `0091_ocr_extraktion`.
**Open:** O-05 — proposals stall visibly rather than defaulting.

### PR 64 · GoBD-Archiv: Aufbewahrung, Löschsperre, Prüfbündel
Phase 7 · **M** · deps: 9, 59
**Scope:** ACC-06, DOC-07 finance lock, DOC-08 for finance, LEG-01.
**Acceptance:** (1) Deleting an archived finance document fails from the application, from SQL **and** from the storage API, for the full ten years, including as the service role. (2) A retention-expiry test proves nothing in the finance categories expires before ten years; retention start is computed from the fiscal-year end and is configurable, never hard-coded. (3) The bundle for one fiscal year contains every invoice, its PDF and its booking line, verified against the Ausgangsbuch.
**NOT:** Z3 export (PR 66), external archive provider.
**Migrations:** `0092_archiv_aufbewahrung`.
**Open:** O-05 (fiscal-year start) — calendar year, flagged.

### PR 65 · Offene Posten, Debitoren/Kreditoren, Monatszahlen
Phase 7 · **M** · deps: 58, 61
**Scope:** ACC-07, ACC-08.
**Acceptance:** (1) The open-item total equals finalised invoices minus allocated payments per entity, to the cent, asserted against SQL. (2) Ageing buckets (0–30/31–60/61–90/>90) sum to the total and use Europe/Berlin calendar dates — asserted across a DST boundary. (3) Group monthly figures equal the sum of the four entities. (4) Every figure drills through (DSH-04). (5) The output is labelled "BWA-artig", never "BWA".
**Migrations:** none (views).
**Open:** O-05 (fiscal-year start) — every figure is period-parameterised, never hard-coded to January.

### PR 66 · Z3-Export und Verfahrensdokumentation aus Live-Konfiguration
Phase 7 · **M** · deps: 5, 64
**Scope:** ACC-09, ACC-10, LEG-01.
**Acceptance:** (1) The Z3 package (§147 Abs. 6 AO) contains data, `index.xml` description and structure; a test re-reads it and reconciles a fiscal year by checksum. (2) The Verfahrensdokumentation is **generated from live configuration** — changing a number circle or a mapping changes the document, asserted by diffing two generations. (3) It names every processor and DPA recorded in DECISIONS.md, and every number circle, role, retention rule, job schedule and the hash procedure.
**Migrations:** `0093_z3_verfahrensdoku`.
**Open:** O-05.

### PR 67 · Jahrespaket und Lohnzeit-Export
Phase 7 · **M** · deps: 37, 66
**Scope:** ACC-11, ACC-12, D-06 boundary.
**Acceptance:** (1) One click produces a dated package — booking stack, documents, open items, Ausgangsbuch, chain-verification result, Verfahrensdokumentation — with a manifest and checksums; generating twice for the same period yields identical checksums. (2) The payroll export contains hours per `anstellung` per month from **locked** months only; an unlocked month is refused. (3) A dual-employed person produces **two** rows in two entities, never a merged one (D-09.5); exported minutes equal the `stundenkonto` figure exactly. (4) Nothing in the package computes payroll or tax — asserted and stated in the manifest.
**NOT:** payroll calculation, Jahresabschluss, E-Bilanz, filing (D-06).
**Migrations:** `0094_jahrespaket`.
**Open:** O-27 — a `LohnExportAdapter` with a neutral documented CSV, `// TODO(client): welches Lohnsystem empfängt den Export, in welchem Format?`

---

# Phase 8 · Tender radar & AI agents
Radar first. The gate already exists (PR 12); the inbox already exists (PR 62).

### PR 68 · Radar-Ingest: oeffentlichevergabe.de (OCDS)
Phase 8 · **M** · deps: 3, 10 · ‖ Phases 6/7
**Scope:** RAD-01 (including below-threshold, where most of this client's opportunities live), RAD-03, behind an `AusschreibungsQuelle` interface.
**Acceptance:** (1) Re-ingesting the same release creates **zero** new rows and updates only changed fields. (2) The parsed row is re-derivable from the retained raw payload. (3) A malformed release is recorded as a failed ingest with its payload — never silently skipped. (4) A source outage marks the run failed and alerts, leaving prior data intact — no partial wipe. (5) The importer runs in CI against recorded fixtures with **no network**.
**Migrations:** `0095_ausschreibung`, `0096_ingest_rohdaten`.
**Open:** none.

### PR 69 · Radar-Ingest: TED Search API v3
Phase 8 · **M** · deps: 68 · ‖ PR 70
**Scope:** RAD-02, RAD-03 for this source.
**Acceptance:** (1) A notice present in both sources appears **once**, with both `quell_id`s recorded. (2) The ingest suite runs unchanged against both adapters — the interface is proven swappable. (3) Pagination is followed to completion; a partial run is marked incomplete, never reported as success. (4) API failure leaves prior data intact.
**Migrations:** `0097_ausschreibung_quelle`.
**Open:** none.

### PR 70 · `radar_profil` und deterministische Bewertung mit Begründung
Phase 8 · **L** · deps: 68 · ‖ PR 69
**Scope:** RAD-04 (CPV, NUTS DE3/DE300, positive/negative keywords, value bounds per area), RAD-05.
**Acceptance:** (1) The same notice scored 100 times yields an identical score and identical reason string. (2) A CI test fails if the scoring module imports the model client — **no LLM in ranking**. (3) The reason names the matched CPV, region, keyword and value band in German; a negative-keyword exclusion says which keyword did it. (4) The three trade profiles produce disjoint, correctly attributed inboxes; a `bau` user never sees `reinigung` scores.
**Migrations:** `0098_radar_profil`, `0099_bewertung`.
**Open:** CPV lists seeded from SPEC §6 and flagged unverified in the UI, `// TODO(client): CPV-Listen gegen den amtlichen Katalog bestätigen.` O-15 (threshold, see PR 71).

### PR 71 · Radar-Arbeitsfläche: Countdown, Statusworkflow, Schwellen-Benachrichtigung ⚑
Phase 8 · **M** · deps: 11, 21, 70
**Scope:** RAD-06, RAD-07, RAD-08, CRM-07 (radar as a lead source), REP-06 source; registers the pipeline tile and the "<5 days untouched" watchdog rule.
**Acceptance:** (1) **The ROADMAP Phase 8 acceptance:** real notices appear daily, separated by area, **each showing why it scored**. (2) A notice four days from its deadline renders in the danger colour **and** carries the text "4 Tage" — colour is never the only signal (DESIGN §9); five days does not. (3) `verworfen` without a reason is refused; the transition is audited. (4) Crossing the score threshold notifies exactly once, not on every ingest run.
**Migrations:** `0100_ausschreibung_status`.
**Open:** O-15 — threshold configurable per profile, **default off**, `// TODO(client): ab welchem Score soll benachrichtigt werden, und wen?`

### PR 72 · Vergabeplattform-Register
Phase 8 · **S** · deps: 71
**Scope:** RAD-09, D-07.
**Acceptance:** (1) A notice whose platform is not in the registry is flagged with the platform named and the registration lead-time field visible. (2) With the registry empty **every** notice is flagged as possibly unregistered — the safe direction, asserted; it never implies "registriert". (3) Adding a platform is a row, not code. (4) **No submission action exists anywhere** — asserted by a route scan (D-07).
**Migrations:** `0101_vergabeplattform`.
**Open:** O-07 — `// TODO(client): auf welchen Vergabeplattformen ist die Gruppe registriert, mit welchem Kontoinhaber?`

### PR 73 · pgvector-Wissensindex
Phase 8 · **M** · deps: 9, 26, 27 · ‖ PRs 68–72
**Scope:** AGT-06 over contracts, objects, offers and correspondence; incremental re-indexing; tenant-scoped retrieval.
**Acceptance:** (1) Retrieval as a `reinigung` user **never** returns a `security` chunk — RLS asserted on the vector table itself, in its own test file, because this is the easiest place in the platform to leak. (2) Deleting a source removes its chunks within one cycle; re-indexing is idempotent and incremental. (3) Retrieval is reproducible for a fixed query and corpus and returns the source record id for every chunk. (4) Without embedding credentials, indexing is skipped and search says `nicht verbunden`. (5) Embeddings run under EU processing with zero retention, recorded in DECISIONS.md.
**Migrations:** `0102_wissens_chunk` (+ pgvector).
**Open:** none.

### PR 74 · Agent-Laufzeit: Aufgaben, Schritte, Kosten, Budget-Hartstopp
Phase 8 · **L** · deps: 7, 12
**Scope:** AGT-04, AGT-05, and the task/step model behind AGT-01.
**Acceptance:** (1) Every step is logged with tool, input, output, model, tokens, cost in **`kosten_mikrocent bigint`** and duration **before the next step runs**; a step that fails to log fails the run. Micro-cents are the K-16(b) deviation and exist **only** in agent cost and budget accounting — `agent_schritt.kosten_mikrocent`, `agent_kosten.kosten_mikrocent`, `agent_reservierung.betrag_mikrocent`, `agent_budget.verbrauch_mikrocent` + `.reserviert_mikrocent`, `agent_preisliste.preis_*_je_mio_token_mikrocent` — because model token pricing is genuinely sub-cent and rounding each step destroys the AGT-05 arithmetic. Nothing invoiced, booked or exported is ever micro-cents. (2) Exceeding the monthly budget **hard stops** with a notification — the next call is refused, not degraded, downgraded, truncated or switched to a cheaper model (asserted by cost injection). The comparison is `verbrauch_mikrocent + reserviert_mikrocent + neu_mikrocent > budget_cent * 10000`; the cap column is **`agent_budget.budget_cent`**, not `monatslimit_cent`. (3) Monthly agent cost reconciles with the sum of its steps, and the cents figure shown to a human is **computed once at the boundary**, half-up, with the rounding rule stated at the conversion site — there is no stored `verbrauch_cent` column to drift from it (K-21). (4) With the budget exhausted, the manual path still works unchanged.
**NOT:** tools (75), Agent Center UI (76), agent behaviour.
**Migrations:** `0103_agent_aufgabe`, `0104_agent_schritt`, `0105_agent_budget`.
**Open:** O-26 — `agent_budget.budget_cent` ships `NULL` = agents disabled, `// TODO(client): O-26 — monatliches KI-Budget je Mandant?`

### PR 75 · Agent-Werkzeuge und Autonomiematrix im Policy-Gate ⚑
Phase 8 · **L** · deps: 12, 25, 31, 73, 74
**Scope:** AGT-02 — **the nine tools, and only these** (K-21, fixed in `06-AGENTEN-FREIGABEN.md`): `lies_dokument · extrahiere_lv · suche_bestand · berechne_preis · pruefe_nachweise · pruefe_bilder · entwirf_text · sende_email · erstelle_vorgang`. The enum `agent_werkzeug_name` carries exactly these values and `agent_schritt.werkzeug` is typed by it, so a tenth tool cannot be logged — and therefore cannot be budgeted, replayed or audited. A missing capability is a new *art* of an existing tool or a service-side pre-flight, never a tenth name. AGT-03 enforcement, SPEC §17 autonomy matrix from `agent_richtlinie`; invariants 6 and 7. **K-10 at the tool boundary:** every money, quantity or formula argument is a handle or a register token, never a numeric literal or an expression string, and `zuschlag_profil_id` is never a model argument — choosing the surcharge profile is setting a price.
**Acceptance:** (1) **With the most permissive policy row the schema allows, a €25.000 offer still cannot be sent automatically** — PR 12's property test re-run through the tool path; and no configuration permits auto-sending any offer. (2) `berechne_preis` delegates to the PR 25 service and **contains no model call** — asserted by a test that fails if the module imports the model client — and returns identical cents for identical input. (3) Asked for an amount no service produces, the agent returns "kann ich aus den Daten nicht berechnen" and produces **no number** (adversarial prompt fixtures). (4) Every discount or concession request is refused outright. (5) `sende_email` without an approved `freigabe` throws, one test per caller. (6) A tool called for the wrong mandant returns 404 through the same guard as a human request. (7) Every autonomy-matrix row has a corresponding test. (8) A registry test asserts the tool set is exactly the nine `agent_werkzeug_name` values — a tenth tool, however plausible, fails the build rather than running unlogged.
**Migrations:** `0106_agent_werkzeug`.
**Open:** none.

### PR 76 · Agent Center
Phase 8 · **M** · deps: 74, 75 · ‖ PR 77
**Scope:** AGT-01, AGT-03 (UI half).
**Acceptance:** (1) The centre shows status, tasks, activity, logs, permissions, connected tools and approval requirements for all four agents, with per-step tokens and cost and monthly spend against the cap. (2) Editing a policy changes behaviour on the next run with **no deploy** and writes a before/after audit row. (3) The UI **rejects at save time** any combination PR 12 would refuse, with a clear German message.
**Migrations:** none.
**Open:** none.

### PR 77 · Freigabe-Automatisierung: Stapel, verzögerte Freigabe, Undo, Rubber-Stamp-Erkennung
Phase 8 · **M** · deps: 62, 74 · ‖ PR 76
**Scope:** APR-04, APR-05, APR-06, APR-08.
**Acceptance:** (1) A batch containing one flagged item approves the rest and leaves the flagged one open, writing **one snapshot per item**, not one per batch. (2) A delayed-release action fires after its window unless an objection is recorded; an objection inside the window stops it. (3) Undo inside the window reverses a reversible action and logs both directions; after the window the control is absent. (4) Ten consecutive approvals under three seconds raise a rubber-stamping flag to the administrator — asserted with synthetic timings.
**Migrations:** `0107_freigabe_stapel_undo_metrik`.
**Open:** none.

### PR 78 · CEO Assistant ⚑
Phase 8 · **M** · deps: 34, 75 · ‖ PRs 79–81
**Scope:** AGT-07, DSH-05 (same service).
**Acceptance:** (1) **"Wie viele Mitarbeiter arbeiten heute?"** is answered from live `zeiteintrag` rows and **equals the DSH-05 tile exactly** — one service, two consumers. (2) Asked something the schema cannot answer it says so plainly; a test fails if any number appears without a tool call that produced it. (3) It holds **no write tool** — asserted by enumerating its registered tool set. (4) Answers respect tenant and role scope (cross-tenant probe set) and cite the records behind them.
**Migrations:** none.
**Open:** none.

### PR 79 · Acquisition Agent und Vergabemappe
Phase 8 · **L** · deps: 25, 43, 71, 72, 73, 75 · ‖ PRs 78, 80, 81
**Scope:** SPEC §17 Acquisition, AGT-02 `extrahiere_lv`, RAD-07, APR-03, D-07.
**Acceptance:** (1) Rooms, areas and frequencies are extracted with page-level provenance and priced **through `berechne_preis`** — every price in the sheet equals a direct call to the PR 25 service. (2) The completeness checklist names every missing document and the folder cannot be marked complete while one is missing; the folder ends "bereit zum manuellen Upload". (3) **No submission path to any platform exists in the codebase** — asserted by absence. (4) A failed extraction yields "nicht extrahiert", never a guess. (5) The PR 72 platform flag is surfaced in the folder.
**Migrations:** `0108_vergabemappe`.
**Open:** O-07 (format-pluggable assembler).

### PR 80 · Back-office Agent
Phase 8 · **M** · deps: 21, 48, 55, 75, 77 · ‖ PRs 78, 79, 81
**Scope:** SPEC §17 Back-office — drafts replies, monthly invoices from contracts, dunning proposals, job-ad drafts.
**Acceptance:** (1) A monthly invoice proposal is a **draft with no number** (invariant 4), every line traceable (FIN-07), arriving in the inbox as a diff against last month; approving runs the normal finalisation path including the §14 validator. (2) The agent **cannot set or change a price** — the price fields on its proposals are read-only and sourced from PR 25/48; an override attempt is refused. (3) A reply to a contact with `rechtsgrundlage = 'keine'` can be drafted but **not sent**, even when approved. (4) A dunning proposal never executes without approval; no configuration permits autonomous sending.
**Migrations:** none.
**Open:** O-04 (contract → invoice mapping uses the PR 48 placeholder).

### PR 81 · Finance Agent
Phase 8 · **M** · deps: 58, 63, 75, 77 · ‖ PRs 78–80
**Scope:** SPEC §17 Finance — wraps PR 63's extraction as a logged, budgeted, policy-gated agent.
**Acceptance:** (1) No code path books without a `freigabe` — asserted. (2) Every proposed amount is re-derived by the money services; a model total failing net + VAT = gross is rejected before review. (3) An unmapped account yields "Kontenzuordnung fehlt", never an invented account. (4) All steps appear in `agent_schritt` with cost; with the budget exhausted manual entry works unchanged.
**Migrations:** none.
**Open:** O-05.

### PR 82 · Watchdog-Jobs (alle acht) und NOT-01-Vollständigkeit
Phase 8 · **M** · deps: 10, 11, 17, 30, 31, 44, 46, 55, 71 · ‖ PRs 78–81
**Scope:** SPEC §14 — plain scheduled jobs, **no LLM**: tender deadline < 5 days untouched (daily) · lead past SLA (hourly) · shift ended with no `zeiteintrag` (hourly) · tomorrow's shift unstaffed (18:00) · certificate expiring 60/30/7 (daily, escalating) · invoice overdue > 14 days → propose dunning (daily) · Nachtrag announced, unsubmitted after 14 days (daily) · **hash chain broken (nightly, immediate alert)**.
**Acceptance:** (1) Each of the eight has a test that builds the triggering state and asserts exactly **one** notification with a working deep link; a second run in the same window sends nothing. (2) A module-import scan asserts **no watchdog imports the model client**. (3) The chain watchdog against a deliberately tampered row alerts immediately and names the first broken invoice number. (4) A failed watchdog run is itself alerted — no silent job death. (5) A test enumerates the **nine NOT-01 kinds** and asserts each is registered with a title, body and resolving link — closing NOT-01.
**Migrations:** `0109_watchdog_zustand`.
**Open:** O-14 (SLA durations for the lead watchdog).

---

# Phase 9 · Social, recruiting, reporting, calendar
Three independent lanes: (83→84) ‖ (85→86) ‖ 87, with 88 last.

### PR 83 · Social Media Center (eigene Profile)
Phase 9 · **L** · deps: 12, 15, 27, 77 · ‖ PR 85 ‖ PR 87
**Scope:** SOC-01…SOC-05, SOC-08, PRO-04.
**Acceptance:** (1) Draft → review → approve → schedule → publish; an approved post appears on the correct public profile within its scheduled minute, asserted across a DST boundary with stored UTC and Berlin display. (2) An unapproved post never appears anywhere — asserted against the public route, enforced at the service by PR 12. (3) A post referencing an `auftrag` without `freigegeben_vom_kunden` **cannot** be published (SOC-04/PRO-05). (4) The approval snapshot shows exactly the published text and images.
**NOT:** external networks (PR 84).
**Migrations:** `0110_social_post`.
**Open:** O-13.

### PR 84 · Externe Kanäle hinter `SocialChannel` — "nicht verbunden"
Phase 9 · **S** · deps: 83
**Scope:** SOC-06, SOC-07.
**Acceptance:** (1) Instagram, Facebook, LinkedIn, TikTok and YouTube each show `nicht verbunden`, the publish control is disabled and **no network call is attempted** (request interception). (2) A test asserts **no adapter returns success without a configured client** — the fake-success path does not exist in the code. (3) Adding credentials for one channel enables only that one and requires no change to the composer. (4) A publish attempt to an unconnected channel returns a clear German error and is audited.
**Migrations:** `0111_social_channel`.
**Open:** O-10 — `// TODO(client): welche Social-Konten existieren je Marke, und wer hält die Zugangsdaten?`

### PR 85 · Recruiting: Stellen, Bewerbungseingang, Lebenslauf-Parsing, DSGVO-Purge
Phase 9 · **L** · deps: 9, 11, 12, 13 · ‖ PR 83 ‖ PR 87
**Scope:** REC-03 (career-page form **and** monitored mailbox), REC-04, REC-07, LEG-11, D-02.
**Acceptance:** (1) An application from the form and one from the mailbox produce identical record shapes with documents in a private bucket, invisible to `leitung` outside the hiring mandant. (2) A CV parse failure keeps the raw document usable and flags the record for manual entry — never a half-parsed silent record; parsed fields carry provenance and low-confidence markers. (3) The purge job past the retention horizon deletes applicant data and **records the deletion without retaining the content** — the one place a hard delete is required by law, explicitly outside invariant 8's finance/time/audit scope and stated as such in DECISIONS.md. (4) A repo and dependency scan asserts **no job-board scraping code exists** (D-02).
**Migrations:** `0112_stelle`, `0113_bewerbung_kandidat`.
**Open:** O-25 — retention configurable, purge job **disabled until set**, `// TODO(client): Aufbewahrungsdauer für Bewerberdaten (AGG-Frist vs. DSGVO-Löschpflicht)?` O-28 — `// TODO(client): welches Postfach wird überwacht, und wem gehört es?`

### PR 86 · Recruiting: Anzeigenentwurf, Ranking mit sichtbaren Kriterien, Interviews, Jobbörsen-Interface
Phase 9 · **M** · deps: 75, 85, 87
**Scope:** REC-01, REC-02, REC-05, REC-06, REC-08, REC-09, LEG-12, D-02.
**Acceptance:** (1) Every shortlist entry shows the criteria and weights that produced it in German; a rank without a reason string cannot render, and the ranking is reproducible for a fixed input. (2) **No status transition can be performed by an agent** — the tool set excludes it; rejection and invitation are named human actions, recorded (REC-08, DSGVO Art. 22), and a UI banner states the ranking is a suggestion (text asserted). (3) A drafted ad reaches the approval inbox and cannot publish unapproved. (4) With no board credentials the publish action is disabled, the API refuses and no call is attempted; adding one real credential enables exactly that board. (5) REC-01's staffing requirement equals a direct count of unstaffed `einsatz` rows and links through. (6) Scheduling an interview creates a `kalender_eintrag` for both sides.
**Migrations:** `0114_bewerbung_bewertung`, `0115_jobboard`.
**Open:** O-10.

### PR 87 · Zentraler Kalender und iCal-Feed
Phase 9 · **M** · deps: 22, 27, 30 · ‖ PR 83 ‖ PR 85
**Scope:** CAL-01, CAL-02, CAL-03.
**Acceptance:** (1) The calendar shows projects, assignments, meetings, customer appointments, deadlines, follow-ups and interviews, filterable by area, team and person, with composed filters matching the underlying lists. (2) The per-user feed validates against RFC 5545 and opens correctly in Apple Calendar and Outlook fixtures; a shift over the fall-back night shows **9h**. (3) The feed is **read-only** (a PUT is refused), token-authenticated and contains nothing outside that user's tenant and role scope. (4) Revoking a token invalidates the feed immediately.
**NOT:** two-way sync.
**Migrations:** `0116_kalender_eintrag`, `0117_ical_token`.
**Open:** none.

### PR 88 · Reporting mit Kanal-Attribution und Export ⚑
Phase 9 · **L** · deps: 17, 27, 36, 56, 71
**Scope:** REP-01…REP-07.
**Acceptance:** (1) **REP-03 end to end:** a form submission from PR 17, converted through PR 27, appears in the attribution report under its `utm_source` — one test spanning five PRs, and the answer to the question the business case rests on. (2) Every report total equals the finance figures to the cent and reconciles to its record list on click-through (DSH-04). (3) Employee utilisation and overtime come from **locked** Stundenkonto months only. (4) CSV uses German number format and a recorded UTF-8-BOM/Windows-1252 decision; PDF matches DESIGN §11. (5) A `leitung` report contains only their area; the group report is read-only and equals the sum of the four.
**NOT:** ad-hoc query builder, scheduled report emails.
**Migrations:** `0118_kanal_statistik` (+ views).
**Open:** none.

---

# Phase 10 · Hardening & launch

### PR 89 · Datenmigration aus Aplano, Lexware und Excel
Phase 10 · **L** · deps: 23, 37, 46, 54
**Scope:** ROADMAP Phase 10; importers per source reusing the PR 24 preview pattern.
**Acceptance:** (1) Every importer runs dry first with a per-row report and commits nothing until confirmed; a real run is idempotent and reversible before commit. (2) A reconciliation report compares source totals to imported totals and **fails loudly** on any difference — hours to the minute, money to the cent. (3) Historical invoices import as `festgeschrieben` with their original numbers into a **separate legacy circle that cannot be extended**, so the live circle stays gapless — PR 46's 1.000-draft gap test still passes afterwards. (4) Historical `zeiteintrag` rows are marked `migriert` and are **not** treated as server-recorded time — invariant 5 is not retroactively falsified. (5) A person present in two source systems becomes one `person` with two `anstellungen`, proven by the reconciliation report.
**Migrations:** `0119_migration_herkunft`, `0120_legacy_nummernkreis`.
**Open:** O-09 — streaming importers with configurable batch size, `// TODO(client): Datenmengen und Exportformate je Altsystem?`

### PR 90 · Sicherheitshärtung und Isolationssuite als Release-Gate
Phase 10 · **M** · deps: 6, 9, 88 · ‖ PR 91
**Scope:** SEC-A1, SEC-A3, SEC-A5, SEC-A7, SEC-A8, SEC-A9, AUT-07.
**Acceptance:** (1) The isolation suite runs over **every** table with `mandant_id` and every route **by enumeration, not a hand-written list**, is green, and coverage below 100% fails CI — SEC-A3 is the highest-priority test in the codebase. (2) CSP is **enforced, not report-only**, with HSTS and X-Frame-Options asserted on responses; an e2e run under CSP fails on any console error. (3) OWASP ZAP baseline in CI reports no medium-or-above finding. (4) A test enumerates every mutating service and asserts an `audit_log` write. (5) `pnpm audit` and a secrets scan are clean and both fail the build otherwise; no secret appears in the client bundle (build-output scan).
**NOT:** external penetration test.
**Migrations:** none.
**Open:** none.

### PR 91 · Backups, getesteter Restore, Monitoring
Phase 10 · **M** · deps: 5, 10 · ‖ PR 90
**Scope:** SEC-A10, SPEC §21.
**Acceptance:** (1) A restore into a scratch project is **executed in the PR**, and the restored database passes the **hash-chain verification** and the isolation suite — a restore that is not tested is not a backup. (2) Point-in-time recovery and daily snapshots are configured and evidenced from the provider API. (3) A deliberately failing job raises an alert within its interval; uptime and error alerting fire in a deliberate failure test. (4) Backups are encrypted, stored in the EU, and the key is not in the repository. (5) The drill is itself a scheduled job whose last result is visible in the admin UI.
**NOT:** DR failover to a second region.
**Migrations:** none.
**Open:** O-11 — the drill script is host-agnostic.

### PR 92 · Last-, Geräte- und Portal-Accessibility-Tests
Phase 10 · **M** · deps: 90
**Scope:** PUB-10, DESIGN §8, TIM-04, DSH-01, portal WCAG 2.1 AA.
**Acceptance:** (1) A Dienstplan month at the O-09 volumes renders within the budget and the ten-parallel-shift case still shows ten columns. (2) A shift-change burst (all guards at 06:00) sustains the latency budget with **no duplicate `zeiteintrag`**, and concurrent finalisation under load still produces gapless numbers (PR 46's test at load). (3) The check-in flow completes on a real mid-range Android over a throttled connection, **one-handed with gloves** — recorded manual test with a checklist. (4) axe reports zero violations on the ten most-used portal screens; no API endpoint exceeds its p95 budget.
**Migrations:** none.
**Open:** O-09 drives the load fixtures.

### PR 93 · DSGVO-Paket, Löschkonzept, Betroffenenanfragen, Geo-Hinweis
Phase 10 · **M** · deps: 34, 64, 85
**Scope:** LEG-09, LEG-10, LEG-11 verification, LEG-12 verification, D-04.
**Acceptance:** (1) A subject-access export returns one `person`'s data across all employments and entities in one package, without exposing another person. (2) An erasure request executes where lawful and is **refused with a stated reason** where retention law overrides (finance, time) — a documented, tested outcome, never a silent partial deletion. (3) The processing register is generated from the live schema and configuration (table, purpose, legal basis, retention, processor, EU region, DPA reference) and changes when a table is added. (4) Geolocation stays **off** until O-06 is answered; enabling it requires the notice to be acknowledged first, and with the flag off no notice and no capture exist at all (PR 34's assertion re-run).
**NOT:** legal review itself.
**Migrations:** `0121_betroffenenanfrage`.
**Open:** O-06, O-11.

### PR 94 · Schulungsmaterial, Runbook, Übergabe
Phase 10 · **M** · deps: 66, 88, 93
**Scope:** ACC-10 (final regeneration), ROADMAP Phase 10 handover.
**Acceptance:** (1) Each of the five roles has material that walks a real task end to end on staging, and every step matches the shipped UI (checklist test referencing route names); the check-in one-pager exists in de/en/ar/tr. (2) The runbook's restore, key-rotation, number-circle, budget-cap and DATEV-profile procedures each name an executable command that exists in the repository, and the restore is performed successfully by someone who did not write it. (3) A script lists every remaining `// TODO(client)` and the count **matches** DECISIONS.md — that list is the handover register. (4) The handover enumerates every credential, region and DPA, and a test asserts every external system in the registry appears in it.
**Migrations:** none.
**Open:** all remaining, enumerated as the client's outstanding decision list.

### PR 95 · Marken- und Fotografie-Austausch — Launch-Gate ⚑
Phase 10 · **S** · deps: 2, 13, 15, 26 · **launch blocker**
**Scope:** DESIGN §1, §4, PUB-04, D-10, O-12, O-13.
**Acceptance:** (1) `--red` is replaced with the value sampled from the logo file and every derived token recomputes from that one change; contrast tests still pass. (2) The four real SVG logos replace the placeholders in the switcher, the public header, all four profiles and every PDF template, at every size. (3) `pnpm test:platzhalter` enumerates the placeholder register and **fails the production build if any placeholder asset remains** — this test gates the production deploy. (4) No AI-generated person appears anywhere in the repository, verified against the asset manifest (D-10).
**NOT:** the photo shoot itself.
**Migrations:** none.
**Open:** **O-12 and O-13 — both blocking. This PR cannot merge before they are answered, and launch cannot happen before it merges. That is the point of it.**

---

# Parallel lanes

| Lane | PRs | Why they do not collide |
|---|---|---|
| Kernel ‖ design system | 1 ‖ 2 | `services/**` vs `components/ui/**`, both need only 0 |
| Phase 1 tail | 4 ‖ 5 | triggers on merged tables vs new counter tables |
| Kernels | 9 ‖ 10 | storage vs job runner |
| Public site | 14 ‖ 15 | pages vs profiles, both after 13 |
| Operations breadth | 22 ‖ 23; 24 ‖ 25; 28 ‖ 29 | CRM history vs Raumbuch; import vs costing; wizard vs customer portal |
| Scheduling | 30 ‖ 31 | series/einsatz vs person certificates |
| Trades | 40 ‖ 41 ‖ 43, then 44 ‖ 45 | `services/reinigung` ‖ `services/security` ‖ `services/bau` |
| Finance | 52 ‖ 54 | XRechnung vs incoming invoices/payments |
| Accounting | 61 ‖ (58→59→60) | CAMT needs only 54/56 |
| Radar ‖ finance | 68–73 ‖ Phases 6–7 | disjoint tables; radar can start once 10 is merged |
| Radar internals | 69 ‖ 70; 73 ‖ 68–72 | TED adapter vs scoring; vector index vs radar |
| Agents | 76 ‖ 77; 78 ‖ 79 ‖ 80 ‖ 81 ‖ 82 | four personas over one runtime |
| Phase 9 | (83→84) ‖ (85→86) ‖ 87 | social ‖ recruiting ‖ calendar |
| Hardening | 90 ‖ 91 | scans vs backups |

# Where the client's mandated tests live

| Required test | First proven | Re-asserted |
|---|---|---|
| Shift 22:00–06:00 = 8h | **PR 1** (pure) | 30 (RRULE), 33 (UI), 34 (DB read-back) |
| DST spring-forward = 7h | **PR 1** | 30, 33 |
| DST fall-back = 9h | **PR 1** | 30, 33, 87 (iCal) |
| Ten shifts at one instant, all visible | **PR 1** (lane packer) | **33** as a rendered UI count, 92 under load |
| One person, two entities, ArbZG breach | **PR 1** (pure) | **32** against real `anstellung` rows |
| Money as integer cents | **PR 1** + a CI guard on every later migration | 25, 46, 48 |
| VAT per tax-rate group | **PR 1** (with the blended-rate control) | 47, 48, 50, 63 |
| Month-end split by actual minutes | **PR 1** | 36, 37 |

# SPEC coverage — every ID to its PR

**TEN** 01·3 02·5,46 03·3 04·3 05·8 06·8 07·8 08·3 09·3,8 10·8
**PUB** 01·13,14 02·13 03·13 04·2,13 05·13 06·13 07·13 08·14 09·16 10·13,16 11·16 12·16 13·13 14·13
**PRO** 01·15 02·15 03·15 04·83 05·15,27
**REQ** 01–06·17 07·17,27
**AUT** 01·6,7 02·6 03·7 04·6,7 05·3,7 06·6 07·6 08·6
**DSH** 01·18,56 02·18 03·18,19,20,29 04·18 05·34
**CRM** 01·21 02·21 03·22 04·22 05·27,49 06·21 07·17,21,71 08·17,21
**RAD** 01·68 02·69 03·68,69 04·70 05·70 06·71 07·71 08·71 09·72
**OPS** 01·23 02·23 03·23 04·24 05·27 06·25 07·25 08·26 09·27 10·28 11·27
**CLN** 01·40 02·30,40 03·30 04·40 05·25,40
**SEC(trade)** 01·41 02·31 03·31 04·31 05·41 06·42 07·42 08·41
**BAU** 01·43 02·43 03·43 04·44 05·44 06·44 07·45 08·45
**TIM** 01·33 02·30 03·30 04·1,33 05·32 06·1,32 07·34 08·34 09·35 10·35 11·34 12·36 13·36 14·1,32
**EMP** 01·20 02·39 03·39 04·37 05·37 06·39 07·36,39 08·39 09·42 10·38 11·11,39 12·20,39 13·19,20 14·20,39 15·37,39
**FIN** 01·48 02·46 03·5,46 04·47 05·47 06·5,46 07·49 08·50 09·51 10·51 11·52 12·53 13·47 14·54 15·55 16·56 17·56 18·49
**ACC** 01·58 02·60 03·59 04·61 05·63 06·64 07·65 08·65 09·66 10·66,94 11·67 12·67
**DOC** 01–06·9 07·9,64 08·9,64
**CAL** 01–03·87
**NOT** 01·11 + registering PRs 17,31,34,38,44,55,71,82 (completeness asserted in 82) · 02·11 · 03·11
**SOC** 01–05·83 06·84 07·84 08·12,83
**REC** 01·86 02·86 03·85 04·85 05·86 06·86 07·85 08·86 09·86
**AGT** 01·74,76 02·75 03·12,75,76 04·74 05·74 06·73 07·78
**APR** 01·62 02·62 03·62 04·77 05·77 06·77 07·12,62 08·77
**REP** 01–07·88
**LEG** 01·5,46,64 02·36 03·1,32 04·31 05·47 06·51 07·2,16 08·12,21 09·93 10·34,93 11·85 12·86
**SEC-A** A1·6,7 A2·3 A3·3,19,90 A4·0,6 A5·0 A6·9 A7·0,90 A8·0,90 A9·3,4,90 A10·91
**SPEC §14 watchdogs** · 82 (rules registered by 17, 31, 44, 55, 71)
**SPEC §17 autonomy matrix** · 12 (property test), 75 (per-row tests)
**SPEC §22 data model** — every named table appears in a migration above; `reklamation`/`qualitaetspruefung` are derived from §22 with no feature ID and are recorded as such in DECISIONS.md (PR 40).

# Open questions — what is blocked, and what ships instead

## Existing (DECISIONS.md)

| # | Blocks | Placeholder that ships |
|---|---|---|
| O-01 | 5, 46 | `nummernkreis` row for `operations` with `aktiv = false`; finalisation refused by name — the answer is a data change |
| O-04 | 48, 80 | The five FIN-01 types behind `Abrechnungsart`, each marked *provisorisch*; a sixth is a new class, not a refactor |
| O-05 | 58, 59, 60, 63, 64, 65, 66, 67, 81 | Empty configuration; export **disabled** with "DATEV-Stammdaten nicht hinterlegt"; format badged unverified until a real sample exists |
| O-06 | 34, 93 | The five `mandant_einstellung` monitoring keys (`zeit.geolokalisierung`, `zeit.geraetekennung`, `zeit.abweichungsauswertung`, `zeit.korrekturstatistik`, `zeit.nichterschienen_auswertung`) all default **false** — they are settings rows, not columns of `mandant` (K-21); a test asserts no coordinate is written anywhere |
| O-07 | 72, 79 | Empty registry ⇒ **every** notice flagged; never "registriert" |
| O-08 | 13, 16 | One group domain with `/[bereich]` paths; empty domain map |
| O-09 | 24, 30, 89, 92 | Paginated importers, configurable batch sizes, assumed volumes recorded |
| O-10 | 84, 86 | `nicht verbunden`; no call attempted; no simulated success path exists |
| O-11 | 0, 91, 93 | Managed EU (Frankfurt) per D-04, tension recorded; host-agnostic restore drill |
| O-12 | 2, 8, 13, 15, 26, 95 | DESIGN §1 `#E30613` + marked placeholder SVGs; **launch blocker** |
| O-13 | 13, 14, 15, 83, 95 | Placeholder register; production build fails while any remains; **launch blocker** |

## New — surfaced by this plan, to be added to DECISIONS.md "Open"

| # | Question | Blocks | Placeholder |
|---|---|---|---|
| O-14 | SLA-Frist je Bereich und Eskalationsempfänger | 17, 82 | 24h per mandant, marked *provisorisch* |
| O-15 | Lead-Scoring-Faktoren/Gewichte; Radar-Benachrichtigungsschwelle | 21, 70, 71 | Manual integer score; radar threshold off |
| O-16 | Gemeinkosten-, Wagnis-, Gewinnzuschläge; Stundenverrechnungssätze je Gewerk | 25 | Rates empty; the engine **refuses to total** and says so |
| O-17 | Leistungswerte je Belagsart (Quelle, Freigabe) | 23, 25 | Catalogue ships **empty**; costing blocks, never defaults |
| O-18 | Arbeitszeitmodelle, Sollstunden, Urlaub, Überstundenverfall; ArbZG-10h-Ausnahme und Ausgleichszeitraum | 1, 32, 37, 38, 39, 67 | `anstellung_kondition.wochenstunden` and `urlaubskonto.anspruch_tage` as data, no automatic accrual; 8h default with a 10h warning band, and the two limits stay the separate `arbzg_regel` values `tagesarbeitszeit_ueber_8h` / `_ueber_10h` |
| O-19 | Mahnstufen, Intervalle, Mahngebühren, Verzugszinssatz | 55 | Levels configurable, fee 0,00 €, no interest applied |
| O-20 | Sicherheitseinbehalt / Gewährleistungsbürgschaft | 50 | Not implemented; recorded, not guessed |
| O-21 | §48 EStG: Leistungsdatum (FIN-10) oder Zahlungszeitpunkt (Gesetzeswortlaut) | 51 | Injected date parameter; SPEC's reading applied and flagged |
| O-22 | Leitweg-IDs je öffentlichem Auftraggeber; Übertragungsweg (OZG-RE/Peppol/E-Mail) | 52 | Per-`kunde` field; blank blocks generation; transmission `nicht verbunden` |
| O-23 | §2-VOB/B-Grundlagenliste; VOB/C-Abzugsregeln automatisch oder manuell | 43, 44 | Statute-derived list flagged unconfirmed; **no** automatic deduction |
| O-24 | Handelsregisterdaten, USt-IdNr., Bankverbindung je Entität | 26, 47 | Visible `FEHLT` marker in the PDF; blank blocks finalisation |
| O-25 | Aufbewahrungsfristen je Dokumentkategorie; Bewerberdaten-Frist | 9, 85 | Legal minimum only; applicant purge **disabled until set** |
| O-26 | Monatliches KI-Budget je Mandant | 74 | `NULL` = agents disabled; the hard stop is active regardless |
| O-27 | Lohnexport-Zielsystem und Format | 67 | `LohnExportAdapter` with a neutral documented CSV |
| O-28 | Überwachtes Bewerbungspostfach und Eigentümer | 85 | Form intake only until answered |
| O-29 | Reklamation/Qualitätsprüfung: Auslöser, Skala, Folge | 40 | Plain records, free text, **no** scoring |
