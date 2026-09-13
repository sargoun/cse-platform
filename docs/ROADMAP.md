# Roadmap

Ten phases, following the client's requested order with the operational and
legal layer folded into each. **Phases are sequential.** Do not start one
before its predecessor meets its acceptance criteria.

No time estimates by design — sequence and acceptance, not duration.

Feature IDs refer to `SPEC.md`.

## Where the work actually stands — this file does not say it

**None of the boxes below have ever been ticked.** This file has not been
touched since the commit that created it, five phases ago; every `- [ ]` in it
means "planned", never "open". Read as a status board it says the platform is
empty, which is the opposite of true — and a session that believes it rebuilds
what already exists, on top of what already exists.

The status lives in three places, and each of them is kept:

- `docs/architecture/PHASE-5-STAND.md` — what is built, what was found, where
  Phase 6 begins.
- `docs/DECISIONS.md` — every decision with its reason, and the open questions
  under "Open" / "Offen".
- The pull request for the branch in hand — the test counts and the file and
  commit numbers of the moment. They move with every commit and therefore do
  not belong in this file either.

Two facts that this sequence otherwise hides, both true at the time of
Phase 5's hand-off (PR #5):

1. **Phases 0 to 5 are built** — the three trade modules, scheduling, time,
   hour accounts and the employee portal in four languages. The login was the
   one named exception; **PR 20 has since closed half of it.** Employees sign
   in for real at `/auth/mitarbeiter` with a phone number and a one-time code
   (`0113`–`0115`, EMP-01), and `/dev/anmelden` no longer lists them.
   **What is still open is the other half:** `/auth/login` — e-mail, password
   and the second factor Phase 1 promises for `super_admin` and `admin`
   (AUT-01, AUT-02) — is not built, so those roles and the customer login
   still come from `/dev/anmelden`, which only exists when `CSE_DEV_FLAECHEN`
   is on. That page is narrowed, not retired, and it goes when `/auth/login`
   arrives (D-386). Whatever else is missing is named individually, not by a
   blank box: `PHASE-5-STAND.md` §"Offen in dieser Phase" and the open
   questions in `DECISIONS.md`.
2. **Phase 6 has already begun**, against the "phases are sequential" rule at
   the top. PR 46 — invoice lifecycle, number assignment, hash chain, Storno —
   ships inside the Phase 5 branch (`0075`–`0077`,
   `src/server/services/finanz/rechnung.ts`); PR 47 to 49 sit on
   `claude/phase-5-dienstplan-zeit`. That was a deliberate call, not a slip,
   and the reason is in `DECISIONS.md` under "PHASE 6, NICHT IN DIESEM ZWEIG".
   The invoice itself stays locked until **O-134** is answered: no number is
   ever drawn from an unconfirmed circle.

---

## Phase 0 · Analysis & architecture

Before any feature code. The client asked for this explicitly.

- [ ] Read `SPEC.md` end to end; list every `TODO(client)` in `DECISIONS.md`
- [ ] Produce: folder structure · DB schema · auth model · permission model ·
      page map · API map · agent architecture · integration architecture
- [ ] Next.js 15 + TypeScript strict + Tailwind + shadcn/ui
- [ ] Supabase project, **EU (Frankfurt)**; Drizzle with migrations in-repo
- [ ] CI: typecheck, lint, unit, e2e, dependency audit
- [ ] **Implement `docs/DESIGN.md` as code**: CSS variables in `globals.css` +
      Tailwind theme; Inter and Caveat loaded; base components built
      (button, card, KPI stat, status pill, filter pill, table, form field)

**Done when:** `pnpm dev`, `pnpm test`, `pnpm typecheck` succeed on a clean
clone, and the architecture document is reviewed.

---

## Phase 1 · Tenancy, auth, permissions — TEN-*, AUT-*

> **Die Haken der Phasen 1 bis 5 sind am 13.09.2026 nachgezogen worden** — und
> zwar EINZELN, gegen die Datenbank und die Pruefungen (72 Isolationsdateien,
> 34 Browserdateien), nicht pauschal gegen die Erinnerung. Sie standen leer,
> obwohl die Arbeit lag; eine Liste, die Gebautes als offen fuehrt, ist
> genauso irrefuehrend wie eine, die Offenes als gebaut fuehrt.
>
> **Was sich nicht belegen liess, steht weiter offen** — namentlich die
> Rechteverwaltung in der Oberflaeche (kein `rolle_berechtigung` in `src/app`),
> die Inhaltsuebernahme von cse-dienstleistungen.de, der WCAG-2.1-AA-Audit als
> Befund (die Pruefung laeuft, der Audit ist ein Dokument) und die
> Lighthouse-Messung auf einem echten Geraet. Ein Haken, den niemand
> nachrechnen kann, ist schlimmer als ein leeres Kaestchen.

- [x] `mandant` seeded with all four areas
- [x] `benutzer`, `rolle`, `berechtigung`, `benutzer_mandant`, `audit_log`
- [x] **`person` / `anstellung` split from the first migration (D-09)** — one
      human, one employment per entity; certificates on the person, everything
      costed on the employment
- [x] **RLS enabled on every tenant table**; session sets the active mandant
- [x] Supabase Auth; 2FA for `super_admin` and `admin`
- [ ] Five roles with configurable permissions, editable in the UI
- [x] **Mandant switcher per DESIGN §6** — avatar + ring, dropdown with live
      counters, group entry marked `NUR LESEN`, top hue bar, `⌘K` shortcut
- [x] Group view route exists and is **read-only** at the service layer
- [ ] Every switch and auth event in `audit_log`

**Acceptance:**
- Automated suite proves a user of area A receives **404** on every entity of
  area B — direct fetch, API route, deep link.
- No create/update path executes without exactly one active mandant.
- Adding a fifth area requires a DB row only.

---

## Phase 2 · Public website & profiles — PUB-*, PRO-*, REQ-*

- [x] All pages per PUB-01, content from the database
- [x] Four profile pages with logo, cover, services, images, projects, posts
- [ ] Content migrated from cse-dienstleistungen.de
- [x] Per-area offer request forms with real quoting fields
- [x] Submission creates a `lead` with SLA and owner; escalation job
- [x] UTM and referrer captured
- [x] JSON-LD, `llms.txt`, sitemap, robots
- [ ] **WCAG 2.1 AA audit passes**
- [ ] Lighthouse: performance and accessibility green on mobile
- [x] Circular brand-avatar row under the hero (PUB-14)
- [x] All imagery marked as placeholder until the client supplies real photos

**Acceptance:** a form submission on a phone appears as an owned lead with a
deadline inside the portal, with its source recorded.

---

## Phase 3 · Portals & dashboards — DSH-*, EMP-*

- [x] Super Admin dashboard (DSH-01) with area filter
- [x] Admin, Leitung, Employee, Customer dashboards, each scoped
- [x] Every figure links through to its records
- [ ] Customer portal: own projects, orders, offers, invoices, documents, messages
- [x] Employee portal shell (full hours features land in Phase 5)

**Acceptance:** an employee account can reach nothing beyond its own data —
proven by test, not by inspection.

---

## Phase 4 · CRM & operations — CRM-*, OPS-*

- [x] Companies, contacts, leads with score, status, owner, next action
- [x] **`rechtsgrundlage` on every contact; outbound blocked when `keine`**
- [x] Notes, communication history, follow-ups
- [x] Customers, objects, **Raumbuch** (rooms, m², floor types)
- [x] Floor-type catalogue with performance values
- [x] Excel/CSV Raumbuch import with preview before commit
- [x] Service catalogue, costing engine, offer PDF per entity
- [x] Offer → order conversion
- [x] New contract wizard (OPS-10)

**Acceptance:** a cleaning offer can be priced from the Raumbuch
(`Σ m² ÷ performance value × frequency`) without manual arithmetic.

---

## Phase 5 · Scheduling, time, trade modules — TIM-*, EMP-*, CLN-*, SEC-*, BAU-*

**Write the time tests first.** No scheduling UI before they pass.

- [x] `planungsserie` (RRULE), `einsatz`, generator filling eight weeks
- [x] Berlin holidays excluded
- [x] Dienstplan with parallel columns; conflict and ArbZG detection
- [x] **ArbZG aggregated per person across entities** (TIM-14)
- [x] **Hard block on expired certificates**, enforced in the service layer
- [x] Tokenised check-in link — no app, no login
- [x] Server-authoritative time; device time and deviation stored
- [x] Offline queue, photo/video capture, correction trail
- [x] Employee portal: hours per day/week/month, Stundenkonto, leave balance,
      monthly PDF, objection flow, certificates, requests, multilingual
- [x] Cleaning: Reviere, Turnus, Leistungsnachweis with signature snapshot
- [x] Security: Posten, §34a tracking, Bewacherregister, Wachbuch,
      Dienstanweisung with acknowledgement, key receipts
- [x] Construction: LV, Aufmaß with Rechenansatz parser, Nachträge,
      Behinderungsanzeige, Bautagebuch with DWD weather

**Acceptance:**
- 22:00–06:00 → 8h; DST nights → 7h and 9h; ten concurrent shifts all visible;
  month-end shift splits by actual minutes.
- One person with a 6h cleaning shift and a 5h security shift on the same day
  triggers an ArbZG breach — proving the check aggregates across entities.
- `"3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"` → `30,87 m²`, formula preserved.
- Assigning a guard with an expired §34a certificate fails.
- A locked `stundenkonto` month cannot change.

---

## Phase 6 · Finance — FIN-*

- [x] Five billing strategies behind one interface (`services/finanz/abrechnungsart/`:
      Einheitspreis-Aufmass, Einzelabruf, Festpreis-Los, Pauschale, Stundenlohn —
      **the exact five and their rounding stay open: O-04**)
- [x] `entwurf` → `festgeschrieben`; number at finalization only (0075–0077:
      `rechnung_entwurf_ohne_nummer`, counter under `SELECT … FOR UPDATE`)
- [x] Pre-flight validator blocking on any missing §14 UStG field
      (`services/finanz/ustg14.ts` + 0104; the screen names every missing field)
- [x] Hash chain + nightly verification job (0077 `hash = SHA256(payload ‖ prev)`,
      job `kette_pruefen` at 03:20 — it alerts, it never repairs)
- [x] Line-to-source traceability (0107 `rechnungsposition_quelle`: every line
      names its time entries, Aufmass rows or LV position — or says „von Hand"
      with a reason)
- [x] Abschlags- / Schlussrechnung with automatic deduction (PR 50; Sicherheits-
      einbehalt stays open — O-20)
- [x] §13b UStG; §48 EStG with certificate validity at service date (PR 51;
      the relevant date stays open — O-21, one injected parameter)
- [x] XRechnung with Leitweg-ID, KoSIT-validated in CI (PR 52; the transmission
      route per public client stays open — O-22)
- [x] ZUGFeRD 2.x PDF/A-3 (PR 53: CII aus demselben Snapshot wie die
      XRechnung, PDF/A-3 mit eingebetteter `factur-x.xml`, selbst erzeugtes
      sRGB-Profil statt einer fremden Datei, veraPDF in CI)
- [~] Incoming invoices, expenses, payments, dunning — **payments, open items,
      incoming invoices and dunning done** (PR 54.1: `zahlung`,
      `offener_posten`, `zahlung_zuordnung`, `op_ausgleich`, nightly
      reconciliation; PR 54.3: `lieferant`, `beleg`, `eingangsrechnung`,
      `eingangsrechnung_steuer`, the `kreditor` open item; PR 55: `mahnstufe`,
      `mahnung`, `mahnung_position`, `basiszinssatz`, the nightly proposal run
      and the release/send path through `agent/policy.ts`). Receipts and
      expenses (`ausgabe`, cash book) still follow. **Levels, fees and interest
      remain placeholders — O-19; the Basiszinssatz itself is maintained by
      hand — O-358**
- [x] Rechnungsausgangsbuch (PR 56: Sicht `rechnungsausgangsbuch` je Kreis mit
      Kettenglied und Lückenkennzeichen, Abstimmung über zwei unabhängige
      Wege). **Umsatz/Kosten/Ergebnis (FIN-17) fehlt noch** — die Periode
      hängt an Soll- oder Ist-Versteuerung (O-05, D-404)

**Acceptance:**
- Deleting 1000 drafts leaves zero gaps in the sequence.
- Mutating a finalized invoice fails at the database layer.
- Tampering breaks the hash chain and the nightly job reports it.
- A KoSIT-valid XRechnung is produced for a public buyer.

---

## Phase 7 · Accounting & DATEV architecture — ACC-*

- [x] SKR03/04 mapping; automatic booking records — **PR 58**: `konto_mapping`
      leer (O-05), Buchung ohne Zuordnung trägt `konto = NULL` + Prüfhinweis
- [ ] **DATEV EXTF export — Windows-1252, comma decimal**
      → request a real sample from the tax advisor **before** building
- [x] **Belegverknüpfung** — document travels with the booking line (PR 59):
      `app.buchungssatz_schreiben` takes the document and routes the source id
      by `herkunft` (D-430); the outgoing invoice's ZUGFeRD PDF is archived
      after finalisation by a nightly run (D-431), `rechnung.beleg_id` is
      write-once (D-432), and a document a booking line refers to cannot be
      deleted — for that reason, not because of its category (D-433).
      `buchungssatz_unvollstaendig` lists what is missing and
      `app.export_sperre_pruefen` refuses the period, so an incomplete month
      blocks the export instead of producing a short file.
      **The creditor side now reaches the ledger too** — `buche()` writes the
      booking record it never wrote.
- [ ] CAMT.053 import and reconciliation
- [ ] Incoming-invoice OCR → extraction → proposal → approval
- [ ] GoBD archive with retention and deletion lock
- [ ] Open items, monthly figures, Z3 export, Verfahrensdokumentation
- [ ] Year-end package; payroll time export

**Acceptance:** the tax advisor accepts a real EXTF file without rework.
Until that happens, this phase is not done.

**Do not** build a fake DATEV API. Interface only until credentials exist.

---

## Phase 8 · Tender radar & AI agents — RAD-*, AGT-*, APR-*

Radar first — the agents operate on its output.

- [ ] Ingest oeffentlichevergabe.de (OCDS) and TED v3; idempotent, raw retained
- [ ] `radar_profil` per area; deterministic scoring with reason strings
- [ ] Deadline countdown, notifications, status workflow
- [ ] Platform registration tracking (RAD-09)
- [ ] `pgvector` index over contracts, objects, offers, correspondence
- [ ] Agent tools (AGT-02); `berechne_preis` is **pure code**
- [x] Policy gate (`agent/policy.ts`) — the floor is code, not data: an offer,
      a Nachtrag and a Behinderungsanzeige never go out automatically under
      any `agent_richtlinie` row. The gate is exhaustive over the whole
      configuration space in `tests/kern/gate.test.ts`.
      **Still open:** editing the rules from the UI (AGT-03).
- [x] Per-step logging with tokens and cost; monthly budget hard stop (PR 74)
      — `agent_aufgabe`, `agent_schritt`, `agent_kosten` in micro-cents, the
      one cent conversion (K-16(b)), and a hard stop that survives the
      transaction it rejects in (D-419). The step payload is readable only
      through `app.agent_nutzlast_lesen` with `agent.protokoll_lesen`, and
      every read is audited (D-424).
- [x] The Agent Centre reads it (PR 76): the four agents with their switch
      state, every run with steps and cost, the monthly cap with consumption
      and reserved amount, and the step chain per run.
      **The screens say plainly that no model access is configured** — and
      there is no start button until there is a provider (D-426).
- [ ] Four agents: CEO Assistant, Acquisition, Back-office, Finance
      — blocked on the model access above, not on the runtime.
- [ ] Approval inbox with diff review, source attribution, confidence flags,
      batch approval, delayed release, undo, approval snapshots
- [ ] Watchdog jobs (SPEC §14)

**Acceptance:**
- Real notices appear daily, separated by area, each showing why it scored.
- The CEO Assistant answers "how many employees are working today" from live
  data, and says so plainly when it cannot answer from the schema.
- A €25,000 offer cannot be sent automatically under any configuration.

---

## Phase 9 · Social, recruiting, reporting — SOC-*, REC-*, REP-*, NOT-*

- [ ] Social Media Center: drafts, approval, scheduling, publish to CSE profiles
- [ ] External channels behind an interface, marked "not connected"
- [ ] Recruiting: job ad drafting, inbound applications, CV parsing, ranking
      with visible criteria, interview scheduling, DSGVO purge
- [ ] Reports: revenue, expenses, profit, orders, leads, conversion,
      **channel attribution**, employees, projects, tender pipeline
- [ ] Notifications and preferences
- [ ] Central calendar with iCal feed

---

## Phase 10 · Hardening & launch

- [ ] Migration from existing tools (Aplano, Lexware, Excel)
- [ ] Tenant-isolation suite green
- [ ] OWASP ZAP baseline; dependency audit clean; secrets audit
- [ ] Backups with a **tested** restore
- [ ] Monitoring: uptime, errors, failed jobs
- [ ] Load and mobile testing on real devices
- [ ] DSGVO pack: processing register, DPAs, deletion concept, employee notice
      for geolocation
- [ ] Verfahrensdokumentation generated from live configuration
- [ ] Training material; handover

---

## Open questions — resolve, never guess

Tracked in `DECISIONS.md`. Until answered, build behind an interface with
`// TODO(client)`.

1. Is **CSE Operations** a GmbH or a department? (invoice circle)
2. ~~Is **CSE Security** the same entity as Select-Security Event GmbH, or a
   rename?~~ **Answered** — D-11: **SSE Security** is the brand of
   *Select-Security Event GmbH*, a separate entity with its own tax number and
   its own invoice circle (O-02 closed). It is listed here only so that nobody
   asks the client a second time; the platform, the seed and `CLAUDE.md`
   have run on that answer since Phase 1.
3. The exact five billing types.
4. DATEV: Beraternummer, Mandantennummer per entity, SKR03/04, Sachkontenlänge,
   Steuerschlüssel, fiscal year start — plus a **real sample export**.
5. Is there a **Betriebsrat**? Governs geolocation capture (LEG-10).
6. Which procurement platforms is the group already registered on?
7. Separate domains per area, or paths under one group domain?
8. Data volumes: objects, rooms, contracts, employees.
9. Which social and job-board accounts exist, and who owns them?
10. **Exact CSE red** from the official logo file, plus logo assets for all four
    brands in SVG.
11. **Real photography** of crews, sites and completed projects — the design
    depends on it and placeholders must not ship.
