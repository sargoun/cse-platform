# Roadmap

Ten phases, following the client's requested order with the operational and
legal layer folded into each. **Phases are sequential.** Do not start one
before its predecessor meets its acceptance criteria.

No time estimates by design — sequence and acceptance, not duration.

Feature IDs refer to `SPEC.md`.

## Where the work actually stands

**The boxes below ARE ticked now** — and the sentence that used to stand here
("none of the boxes below have ever been ticked") was true when it was written
and false for a long time afterwards. A status paragraph that stops being
maintained is worse than none: it is read as fact.

Counted from this file, phase by phase:

| Phase | done | open | |
|---|---:|---:|---|
| 0 · Analysis & architecture | 0 | 6 | the documents exist; the boxes were never ticked |
| 1 · Tenancy, auth, permissions | 15 | 2 | |
| 2 · Public website & profiles | 8 | 3 | |
| 3 · Portals & dashboards | 4 | 1 | |
| 4 · CRM & operations | 9 | 0 | |
| 5 · Scheduling, time, trade modules | 12 | 0 | |
| 6 · Finance | 10 | 0 | |
| 7 · Accounting & DATEV | 10 | 0 | |
| 8 · Tender radar & AI agents | 14 | 0 | |
| 9 · Social, recruiting, reporting | 3 | 3 | recruiting is the open one |
| 10 · Hardening & launch | 1 | 8 | |

**Phases 4 to 9 are closed.** Phase 9 carried Social, recruiting,
notifications, the calendar and the six reports; every box in it is ticked
against the database and the suites, not against memory. Phase 10 has barely
begun.

**What a tick does NOT mean.** A ticked box means the feature is built, tested
and reachable — not that every screen behind it exists. A walk through every
portal address (2026-09-15) counted **94 real pages, 55 "this module is still
being built" placeholders and 0 server errors** for an administration in one
company. The placeholders are honest and named; they are the work of task
"160 placeholder routes".

**Where the moving numbers live** — they change with every commit and therefore
do not belong in this file:

- `docs/DECISIONS.md` — every decision with its reason, and the open questions
  under "Open" / "Offen".
- `docs/architecture/PHASE-5-STAND.md` — the hand-off of that phase.
- The pull request for the branch in hand — test counts, file and commit
  numbers of the moment.

**The named exceptions that survive the ticks:**

1. **Login is complete.** `/auth/login` with e-mail, password and the second
   factor is built (PR 77); employees sign in at `/auth/mitarbeiter` with a
   phone number and a one-time code (EMP-01). `/dev/anmelden` is a development
   surface behind `CSE_DEV_FLAECHEN` and ships as a 404 (D-386).
2. **No external channel is connected.** DATEV, the five social platforms, the
   job boards, the mail provider and the AI endpoint are built as interfaces
   and marked "not connected" in the interface. Nothing simulates a successful
   external call — that is a rule, not a gap (see "Out of scope" in CLAUDE.md).
3. **Invoice numbers stay locked until O-134 is answered.** No number is ever
   drawn from an unconfirmed circle.

---

## Phase 0 · Analysis & architecture

Before any feature code. The client asked for this explicitly.

- [ ] Read `SPEC.md` end to end; list every `TODO(client)` in `DECISIONS.md`
- [ ] Produce: folder structure · DB schema · auth model · permission model ·
      page map · API map · agent architecture · integration architecture
- [ ] Next.js 15 + TypeScript strict + Tailwind + shadcn/ui
- [ ] Supabase project, **EU (Frankfurt)**; SQL migrations in-repo under `drizzle/`,
      applied by `pnpm db:migrate` (D-582 — Drizzle itself was removed, the folder
      and its numbering keep the name)
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
- [x] Supabase Auth; 2FA for `super_admin` and `admin` — **the whole `/auth`
      path is built** (PR 77): e-mail + password, TOTP enrolment with a QR code
      computed in-repo, TOTP challenge, recovery codes, forgot-password,
      new-password, invitation, no-access, logout, callback. Supabase Auth
      stays the chosen provider; until a project is on file (O-501) the
      platform verifies the password itself (`kern.zugangsdaten`, bcrypt) and
      the login screen says so (D-501, D-502)
- [ ] Five roles with configurable permissions, editable in the UI
- [x] **Settings screens, read-only** (D-476): company data with the O-353
      caveat, users with 2FA state and own sessions, roles with the full
      permission matrix per company, modules, audit log; cards on the index
      come from the route manifest's rights
- [x] **Finance overview per company** (D-479): the tab-bar target that had
      no page; rights-gated tiles, cards from the route manifest
- [x] **Copilot round on PR 12** (D-480): definer policies cut per tenant
      (0139), archive job writes as `cse_job`, `dokument_zugriff`, CAMT reads
      direction and currency, byte-exact statement hashing, booking lock,
      bank clearing with a human as actor, UUID guards, effective role rights.
- [x] **Marks, footer, privacy notice** (D-481): provisional marks per company
      and for the group, a composed footer, the privacy notice from the live
      site adapted to this platform, six navigation glyphs, hero calls.
- [x] **Documents list and detail, employment sheet** (D-478): the last
      sidebar entry without a page; no download claimed while storage is
      not connected; rights asked before hours account and absences
- [x] **Integrations and processor register, read-only** (D-477): every
      connection with its real state from the adapter that uses it; Art. 30
      register with region and an honest "no contract date on file"
- [x] **Mandant switcher per DESIGN §6** — avatar + ring, dropdown with live
      counters, group entry marked `NUR LESEN`, top hue bar, `⌘K` shortcut
- [x] Group view route exists and is **read-only** at the service layer
- [x] **Group view pages** (D-475): overview matrix per company with group
      sums, and read-only lists for orders, customers, leads, projects,
      objects, people (identity only, D-09), finance, invoices, open items,
      approvals, documents, audit log, agents, roster with cross-entity ArbZG
      findings, utilisation — every cell rights-gated per company (a dash is
      not a zero); `radar`, `kalender`, `berichte/*` still pending (phases 8/9)
- [x] **Group session on a company page gets the switch sheet** (D-474), and
      the POST switch returns to the page that was meant (`zurueck`, allow-listed)
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
- [x] **DATEV EXTF export — Windows-1252, comma decimal** (PR 60) — ⚑ the
      format is **spec-derived, not client-derived**: the field order comes
      from the published DATEV description, not from a file this tax office
      has read in. Every export row carries `format_ungeprueft` and the
      screens say so (D-446). Bytes are asserted as bytes: `ü` is 0xFC, no
      BOM, CRLF, comma decimal, and amounts convert from integer cents by
      string arithmetic — no `Number` anywhere (D-447). The writer reads no
      clock, so the same period twice yields identical bytes (D-448). With
      the O-05 master data empty or unconfirmed, **no file is produced** and
      the German sentence names every missing field.
      **Still open — this blocks the PHASE, not the PR:** request a real EXTF
      sample from the tax advisor and reconcile `SPALTEN` against it.
- [x] **Belegverknüpfung** — document travels with the booking line (PR 59):
      `app.buchungssatz_schreiben` takes the document and routes the source id
      by `herkunft` (D-439); the outgoing invoice's ZUGFeRD PDF is archived
      after finalisation by a nightly run (D-440), `rechnung.beleg_id` is
      write-once (D-441), and a document a booking line refers to cannot be
      deleted — for that reason, not because of its category (D-442).
      `buchungssatz_unvollstaendig` lists what is missing and
      `app.export_sperre_pruefen` refuses the period, so an incomplete month
      blocks the export instead of producing a short file.
      **The creditor side now reaches the ledger too** — `buche()` writes the
      booking record it never wrote.
- [x] CAMT.053 import and reconciliation (PR 61) — **no bank connection and
      none pretended**: no PSD2, no FinTS, no outgoing SEPA file. A human
      uploads the statement. Idempotent over the file's SHA-256, not over the
      statement number (D-455). A booking-entry line is **not** a payment
      (D-454); the payment is created only on assignment, and the assignment
      is revocable. Only an unambiguous hit — amount AND invoice number AND
      the IBAN the customer last paid from — is assigned automatically; the
      IBAN is **learned, not maintained** (D-456). An amount alone assigns
      nothing even with a single candidate (D-457), an outgoing entry is never
      matched to an outgoing invoice (D-458), and nothing ever disappears from
      the queue (D-459).
- [x] Approval inbox: diff review, source attribution, confidence (PR 62,
      APR-01/02/03/07) — the **service layer, the schema and the chain**; the
      screens follow. The diff runs on the structured payload, never on
      rendered text, and computes the VAT delta **per tax-rate group** (D-463).
      Whether a surcharge belongs to a position's identity is **O-114** and
      stays open; until it is answered a changed surcharge shows as a *changed*
      position rather than an add/remove pair that would hide the price change.
      The headline sentence comes from a template, never from a model (D-464) —
      a wrong summary defeats the whole gate. Confidence is **derived, not
      asked for**: a failed check hard-zeroes it, and "nothing checked" is 0,
      not 1 (D-465); the threshold is a placeholder erring strict (**O-197**).
      The chain covers **eleven** components, so what the approver saw is in
      the hash and not only the payload (D-466), and there is **no second
      canonicaliser in SQL** — the application hands over the bytes (D-467).
      A waiting request can only be decided through `app.freigabe_entscheiden`
      (D-469): no view row, no decision.
      **The two screens and the two routes are built** (D-472): the inbox in
      the service's order, the review with headline, diff, evidence and a
      button that is the *display* of a service-side lock; opening writes the
      view row through the service, never through the page. The seed carries
      four waiting proposals and says no agent produced them.
- [x] Incoming-invoice **e-invoice** → extraction → proposal → approval (PR 63,
      D-482) — UBL 2.1, CII and the ZUGFeRD attachment of a PDF are read
      deterministically (own XML reader, no DTD/entities), every number names
      its element and is re-checked against the file; the proposal is an
      approval with per-field sources; supplier matched by VAT id → IBAN →
      name (two hits are none), tax line matched to the catalogue; an unsure
      field locks approval in the service. **Approving executes** the takeover
      in the same transaction (a failed takeover rolls the decision back); the
      incoming invoice starts at `eingegangen`, the creditor path stays.
      **No OCR:** a scanned PDF without embedded XML is not read — the
      provider is open (O-135) and the screen says so; manual entry with the
      proposal's values (`?von=`) remains.
- [x] GoBD archive with retention and deletion lock (PR 64, D-483) — the
      retention clock starts at the end of the **calendar** year the document
      arose in (§ 147 Abs. 4 AO; the plan said "fiscal-year end", the law is
      more precise), stored as `entstanden_am`, never shortened; retention
      rules per entity with legal floors (10 years finance, 6 years
      commercial letters) enforced in the service and in the trigger; one
      deletion path in code, guarded by a merge guard, proven against
      `cse_app`, `cse_job`, the owner and TRUNCATE; an audit bundle per fiscal
      year with a canonical manifest and a reproducible STORE zip. Bucket-level
      immutability at the provider stays open (O-364).
- [x] Open items and monthly figures (PR 65, D-484) — ageing in calendar
      days (asserted across both DST changes), reconciliation against the
      source tables, monthly figures **BWA-artig** from documents per fiscal
      year with drill-through on every figure, group = sum of entities
      (asserted), period lock with frozen figures and a one-way close;
      bookkeeping overview and a read-only chart-of-accounts screen.
- [x] Z3 export and Verfahrensdokumentation (PR 66, D-485) — Z3 as a
      handover, not a release: fourteen CSV tables per fiscal year with
      `index.xml` after the Beschreibungsstandard, checksums and a
      reproducible STORE zip; incomplete booking lines are counted, not
      hidden; no IBAN, no creditor/debtor numbers (K-05); the DTD is not
      bundled (O-365). The Verfahrensdokumentation is generated from the
      live configuration (17 sections, each with its source, canonical hash,
      Markdown/PDF/JSON); the schema state comes from the migration journal
      via `app.migrationsstand()` (0142) and says "not readable" where no
      journal exists.
- [x] Year-end package and payroll time export (PR 67, D-486) — one ZIP
      per fiscal year for the tax advisor (data tables, monthly figures,
      open items, invoice journal, DATEV batches with files where storage is
      connected, audit bundle with documents, Verfahrensdokumentation) that
      names every gap; a monthly payroll export (accounts, absences with type
      via a guarded definer function, every time entry from the MiLoG record)
      behind a format interface whose generic CSV is a marked placeholder
      (O-27, O-139). Neither computes wages or taxes (D-06).

**Acceptance:** the tax advisor accepts a real EXTF file without rework.
Until that happens, this phase is not done.

**Do not** build a fake DATEV API. Interface only until credentials exist.

---

## Phase 8 · Tender radar & AI agents — RAD-*, AGT-*, APR-*

Radar first — the agents operate on its output.

- [x] Ingest oeffentlichevergabe.de (OCDS) and TED v3; idempotent, raw retained
      (PR 68, D-489) — the readers take TEXT, not the network, so a field
      mapping is proved in the kern suite and not at night; idempotency is
      carried by `unique (quelle, quell_id)` plus a SHA-256 over the raw
      payload. **Neither source is connected**: both are public and need no
      key, but the query this business wants is **O-366**, and until it is
      answered the nightly run writes `uebersprungen` with the reason.
- [x] `radar_profil` per area; deterministic scoring with reason strings
      (PR 68, D-489) — six rules, an itemised breakdown and a German sentence
      built from it; `bewertung.verfahren` is CHECK-pinned to
      `deterministisch`, so no model path can write a score without a
      reviewed migration. Weights are placeholders (**O-15**), a negative
      keyword deducts rather than excludes until **O-191**, and a
      foreign-currency value is left unscored rather than converted (**O-47**).
- [x] Deadline countdown and status workflow (PR 69, D-490) — the countdown
      is text in the danger tone under five days, not a pill with invented
      vocabulary (DESIGN §5); the RAD-07 control records geprüft, in
      Bearbeitung and verworfen **with a mandatory reason**. There is no
      submit button anywhere in the module and the browser suite counts the
      word (D-07). **Notifications (RAD-08) still open** — they need the
      threshold nobody has set (O-15). **Shipped in PR 71** (D-493): the
      threshold stays unset, and that is now *visible* instead of silent.
- [x] Platform registration tracking (RAD-09) (PR 69, D-490) — the warning
      is in the LIST, not only on the detail page, because a platform
      unlock takes days to weeks. The catalogue ships **empty** and the
      page says why (O-07): a made-up list would read as a checked state.
- [x] Vergabemappe and the submission record (RAD-07 complete, PR 70, D-492) — the
      checklist that can **count** what is missing, because a missing Formblatt
      gets the bid excluded under § 57 VgV before anyone reads the price.
      **"Attached" does not count as done**: the counter only rises on
      `geprueft` or a *reasoned* non-applicability, because the commonest
      exclusions are attached but wrong documents. D-07 now sits in the
      database: `cse_app` has no write privilege on the submission columns at
      all, the only path is `app.mappe_einreichung_erfassen`, and it takes the
      human from the **session** and the instant from `now()`. The outcome
      (`zuschlag` / `nicht_beruecksichtigt` / `verfahren_aufgehoben`) closes
      REP-06's "found · screened · bid · won". The checklist ships **empty**
      and the page says why (**O-194**).
- [x] Deadline watchdog and RAD-08 notifications (PR 71, D-493) — **the first
      of SPEC §14's eight watchdogs**, and the one that needs no setting: five
      days are written in the SPEC, so it runs from day one, for an *untouched*
      case only. RAD-08 is the opposite: its threshold is **O-15's to answer**,
      so without a number nothing is sent — and the profile page says so per
      recipient while the run reports `empfaenger_ohne_schwelle`, so "0 hits"
      can never be mistaken for a quiet day. A receipt table keyed on the
      deadline instant prevents the second notice for the same situation, and
      makes a *rescheduled* deadline a new one.
- [x] `pgvector` index over contracts, objects, offers, correspondence
      (PR 74, D-496) — schema, page and rules; **deliberately empty** until an
      embedding provider is confirmed, because an index of substitute vectors
      returns plausible-looking hits whose ordering is chance and nobody
      notices. `mandant_id` sits in the primary key and **there is no group
      view on this table**: "show me similar clauses" would read across
      companies as "show me the sister's contract". Confidential is the
      default; a downgrade carries a name — and since D-498 the name comes
      from the **session**, not from the writer: those two columns are
      withheld from `cse_app` entirely. The table is `PARTITION BY LIST
      (mandant_id)` with one ANN index per company, as the design document
      specifies, because pgvector picks its `k` nearest neighbours *before*
      the tenant filter applies — a shared index runs the candidate path over
      other companies' contracts. Reading needs `wissen.lesen`, and a
      confidential passage additionally `wissen.vertraulich_lesen`; the first
      policy asked for `agent.lesen`, which every agent session holds. CI runs
      `pgvector/pgvector:pg16`.
- [x] Agent tools (AGT-02); `berechne_preis` is **pure code** (PR 73, D-495) —
      the contract, the handle vault, the value register and the nine-tool
      registry. **Two of the nine run without a model** because they create
      nothing: `berechne_preis` calls the same tested `kalkuliere()` as the
      offer page, `suche_bestand` answers from a reviewed catalogue and says
      "not in the catalogue" rather than inventing a query (AGT-07). The other
      seven return `kein_modellzugang` — a tool that produces "something"
      without a model is worse than one that stays silent. Invariant 7 is now
      a CHECK: `sende_email` cannot be un-gated, not even by direct UPDATE.
- [x] Policy gate (`agent/policy.ts`) — the floor is code, not data: an offer,
      a Nachtrag and a Behinderungsanzeige never go out automatically under
      any `agent_richtlinie` row. The gate is exhaustive over the whole
      configuration space in `tests/kern/gate.test.ts`.
      **Still open:** editing the rules from the UI (AGT-03).
- [x] Per-step logging with tokens and cost; monthly budget hard stop (PR 74)
      — `agent_aufgabe`, `agent_schritt`, `agent_kosten` in micro-cents, the
      one cent conversion (K-16(b)), and a hard stop that survives the
      transaction it rejects in (D-428). The step payload is readable only
      through `app.agent_nutzlast_lesen` with `agent.protokoll_lesen`, and
      every read is audited (D-433).
- [x] The Agent Centre reads it (PR 76): the four agents with their switch
      state, every run with steps and cost, the monthly cap with consumption
      and reserved amount, and the step chain per run.
      **The screens say plainly that no model access is configured** — and
      there is no start button until there is a provider (D-435).
- [x] Four agents: CEO Assistant, Acquisition, Back-office, Finance
      (PR 76, D-499) — **they run.** `modell_register` (§3.6) is now the only
      place a model becomes callable (`eu_verarbeitung AND zero_retention AND
      freigegeben`, all defaulting to false), callers ask for a **capability**
      and never a model, and the in-house `demo:hausintern-v1` carries those
      three flags **truthfully**: it runs in-process — no network, no
      processor, nothing stored outside this database. It is not a language
      model and does not pretend to be one: it formulates from templates and
      already-computed facts, deterministically. **Every digit in a draft must
      have appeared in the facts first** — and that is checked at RUNTIME
      (`agent/zahlenherkunft.ts`), before the approval row is written, not only
      by a test against the demo. A test against the demo would have proved
      nothing about a real provider: it could have invented a deadline or a
      quantity and still produced an approvable draft (D-510).
      The run ends in a **draft in the approval inbox**, never in an action
      (invariant 7). Swapping in a real provider is one registry row and a key;
      `app.modell_fuer` orders a real provider ahead of the demo.
- [x] Approval inbox with diff review, source attribution, confidence flags,
      batch approval, delayed release, undo, approval snapshots
      (PR 62/63, D-472; completed PR 75, D-497) — the batch is a **loop** over
      the single decision, never a collective UPDATE: APR-07 wants the proof of
      what lay before the human, and that differs per case, so fifty approvals
      are fifty snapshots and fifty chain links. Flagged rows **drop out with
      their reason** instead of killing the batch, and each row gets its own
      `SAVEPOINT`, so one failing execution rolls back alone and stands open
      again. Window **or** execution, never both: the objection window is armed
      only for `risiko = 'niedrig'`, and the seven process types that `0136`
      excludes get none — the list stays in that one CHECK, and
      `app.freigabe_verzoegern` reports its "no" as `NULL` rather than tearing
      the batch down. Undo reverses the **execution**, not the decision: the
      snapshot stays what it was, and a reversal of the decision is a NEW
      approval (§4.5). The two window lengths are placeholders (**O-108**).
      Closing the holes this found: `0012` had granted `cse_app` UPDATE on the
      whole table, so both window columns were writable **around** the definer
      functions; and three rights the catalogue already defined
      (`freigabe.stapel_entscheiden`, `freigabe.einspruch_erheben`,
      `freigabe.rueckgaengig`) were **never checked** — every route asked only
      for `freigabe.entscheiden`. A right that exists and is never checked is
      worse than none: it looks like a bolt. Who should hold them is **O-367**.
      APR-08 got the screen the page map had been promising: the distribution
      of review durations **without a name**, because flagging one person's
      consistently fast approvals is § 87 Abs. 1 Nr. 6 BetrVG territory and
      waits on **O-06** — with the batch share shown separately, since a batch
      is fast by construction and is not rubber-stamping. `/freigaben/laufend`
      and `/freigaben/erledigt` were built too; `/freigaben/stapel`,
      `/[id]/einspruch` and `/[id]/rueckgaengig` stay folded into the inbox and
      the review page on purpose. **APR-06's window is armed for nothing**
      (D-498, **O-368**): the whole path stands — window, deadline, its own
      right, protocol, refusal after expiry — but the one action that executes
      creates an incoming invoice, and no way back is built for it. A button
      that only flips `ausfuehrung_status` and leaves the invoice standing is
      the same faked success this platform refuses from a third-party service,
      so the review page says so where the button would be.
- [x] Watchdog jobs (SPEC §14) — **all eight** (PR 72, D-494). The three that
      were missing all failed on the same thing: they must notify "the planner"
      or "the site manager", and no such field exists. So `app.hat_recht` was
      split — `app.hat_recht_fuer(user, key, tenant, …)` is the core, the old
      function its shell, and `kern.traeger_des_rechts` the **inverse** on that
      same core. One implementation, two entrances; a copied resolution would
      drift and then notify people who cannot open the page they are linked to.

**Acceptance:**
- Real notices appear daily, separated by area, each showing why it scored.
- The CEO Assistant answers "how many employees are working today" from live
  data, and says so plainly when it cannot answer from the schema.
- A €25,000 offer cannot be sent automatically under any configuration.

---

## Phase 9 · Social, recruiting, reporting — SOC-*, REC-*, REP-*, NOT-*

- [x] **Social Media Center** (SOC-01…SOC-08, D-556…D-560, D-572, D-573): the
      four profiles from one place, `entwurf → vorgelegt → freigegeben →
      geplant → veroeffentlicht` with the decision falling in the approval
      inbox and never on the post page (SOC-08 — two ways to one decision
      would be one too many), the nightly `social_plan` run under `cse_job`,
      and `erneut_senden` for channels that failed. Content pulls from
      released references only (PRO-05). **Publishing to the company page on
      the CSE site works immediately** — it is not a channel, the post stands
      there the moment `status = 'veroeffentlicht'`
- [x] **External channels behind an interface, marked "not connected"**
      (SOC-06, SOC-07, O-10): Instagram, Facebook, LinkedIn, TikTok and
      YouTube implement one `SocialKanal` port; none is connected, each says
      so in the interface, and a per-channel result sheet records what came
      back. Nothing simulates a successful external call
- [x] **Recruiting** (REC-01…REC-09, D-570, D-573): staffing requirement from
      unstaffed shifts, job ad drafting, inbound applications over
      `/karriere/*` and the initiative form, the parsed candidate record,
      the ranked shortlist **computed in TypeScript with its criteria on
      screen** (REC-05/REC-08 — the model never ranks), interviews with
      prepared questions on the calendar, the hiring decision bound to the
      human who writes it (`kern.entscheidung_ist_menschlich`, REC-08,
      DSGVO Art. 22), and the nightly `bewerber_loeschung` purge against
      `aufbewahrung_bis` with `loeschsperre` honoured (REC-07). Job boards
      are built as a port and are not connected (REC-09)
- [x] **Reports** (REP-01…REP-07, D-506…D-508): revenue, orders and leads,
      **channel attribution**, hours, projects, tender pipeline — six per
      company under `/portal/[mandant]/berichte`, the same six split per
      company under `/portal/gruppe/berichte` (read-only, Invariant 10), year
      and granularity as links so a report is shareable, and CSV behind its
      own right `bericht.exportieren` (REP-07). Money stays integer cents;
      the protected columns (`anstellung.stundensatz_intern`,
      `projekt.auftragssumme_netto_cent`) are read only as an aggregate,
      through `app.projekt_kennzahlen` / `…_gruppe`
- [x] **Notifications and preferences** (NOT-01…NOT-03, D-505): the personal
      inbox at `/portal/[mandant]/benachrichtigungen` with a bell in every
      portal header, per-kind channel preferences at
      `/portal/konto/benachrichtigungen`, every entry linking to its own
      record, read-stamped rather than deleted. E-mail stays a declared
      channel and says "not connected" until O-501 is answered
- [x] **Central calendar with iCal feed** (CAL-01…CAL-03, D-515, D-516):
      month, week and day under `/portal/[mandant]/kalender`, filters by
      source and by person, an appointment page, and a read-only iCal
      subscription at `/portal/konto/kalender-feed`. The calendar **gathers**
      — meetings it owns, shifts, project dates and tender, approval and lead
      deadlines read from their own tables, so a shift moved in the roster is
      moved here without anyone touching the calendar. Below `768px` the grid
      becomes an agenda (DESIGN §5). The feed stores the SHA-256 of its token,
      shows the address once, and a revocation takes effect on the next
      request

---

## Phase 10 · Hardening & launch

- [ ] Migration from existing tools (Aplano, Lexware, Excel)
- [ ] Tenant-isolation suite green
- [ ] OWASP ZAP baseline; dependency audit clean; secrets audit
- [ ] Backups with a **tested** restore
- [ ] Monitoring: uptime, errors — **failed jobs are visible** since D-588:
      `/einstellungen/betrieb` shows every scheduled run against its protocol
      (failed · hanging · absent · never run) and whether a trigger is installed
      at all. Uptime and an on-call channel remain open (O-354).
- [ ] Load and mobile testing on real devices
- [ ] DSGVO pack: **processing register (Art. 30) generated from the live
      configuration** (D-586) and **deletion concept derived from the retention
      rules** (D-587) are built; DPAs and the employee notice for geolocation
      remain open, the latter with O-514 (works council, § 87 BetrVG)
- [x] Verfahrensdokumentation generated from live configuration (PR 66,
      D-485) — re-read before go-live: every open point in its section 5
      must be closed or accepted
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
