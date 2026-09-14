# CSE Platform — Specification

Merged from the client's master build specification and the operational/legal
requirements of running three regulated German trades.

Feature IDs are stable. Reference them in commits and PRs.

---

## 0. Principles

**The client spec describes the surface. This document adds the layer beneath
it.** "Invoices" on the surface means five billing types, three gapless number
circles, XRechnung, DATEV and immutability underneath. Both layers ship
together or the platform cannot legally operate.

Three of the four business areas are **regulated**:
cleaning (MiLoG hour records, sector minimum wage), security (§34a GewO,
Bewacherregister), construction (VOB, §13b UStG, §48 EStG, SOKA-Bau).
Compliance is not a later phase.

---

## 1. Business structure & tenancy

| ID | Requirement |
|---|---|
| TEN-01 | Four business areas as `mandant` rows: `reinigung`, `security`, `bau`, `operations` |
| TEN-02 | Separate legal entities get their **own invoice number circle** |
| TEN-03 | `mandant_id` on every tenant table; Postgres RLS enabled |
| TEN-04 | Active mandant in server session only |
| TEN-05 | Group view aggregates all areas — **read-only** |
| TEN-06 | Mandant switcher, visible only to users with more than one |
| TEN-07 | Per-area identity hue and logo in the app shell; 3px hue bar across the top at all times (DESIGN §6) |
| TEN-10 | Switcher dropdown with live counters per area; group entry carries a visible `NUR LESEN` pill |
| TEN-08 | A fifth area requires a DB row, no code change |
| TEN-09 | Every switch written to `audit_log` |

`// TODO(client)`: Is **CSE Operations** a GmbH or an internal department?
A legal entity needs its own invoice circle; a department does not.

**Resolved:** the security brand is **SSE Security** — Select Security Event
GmbH — with its own logo and identity, not a CSE sub-brand. Confirmed by the
client's design mockups. It keeps its own tax number and invoice circle.

---

## 2. Public website

| ID | Requirement |
|---|---|
| PUB-01 | Pages: Home · Unternehmen · one page per business area · Leistungen · Projekte · Über uns · News · Kontakt · Angebot anfragen · Login |
| PUB-02 | Home communicates a group of professional services under one roof |
| PUB-03 | Four business areas as large visual profile cards (DESIGN §4) |
| PUB-14 | Circular brand-avatar row under the hero — tap opens that profile (DESIGN §6) |
| PUB-04 | Visual language per `docs/DESIGN.md` — deep black, CSE red, large real photography, one script accent |
| PUB-05 | Serious German business aesthetic — not futuristic |
| PUB-06 | Fully responsive: phone, tablet, desktop |
| PUB-07 | Content served from the database, not hard-coded |
| PUB-08 | Migrate useful content from cse-dienstleistungen.de |
| PUB-09 | **WCAG 2.1 AA** — BFSG applies to consumer-facing sites |
| PUB-10 | Core Web Vitals green; Next.js image optimisation |
| PUB-11 | JSON-LD: `LocalBusiness`, `Service`, `FAQPage` per area |
| PUB-12 | `llms.txt`; consistent NAP across all directories |
| PUB-13 | No third-party trackers by default → no cookie banner needed |

### Company profiles (Instagram-inspired, professional)

| ID | Requirement |
|---|---|
| PRO-01 | Profile per business area: logo, cover image, description |
| PRO-02 | Services, images, projects, posts, news, contact, company info |
| PRO-03 | Browse and switch between profiles easily |
| PRO-04 | Posts composed in the Social Media Center (§15) |
| PRO-05 | **References pulled from real jobs** where `freigegeben_vom_kunden = true` |

PRO-05 is the point: a reference is a completed `auftrag` with customer
release on file, not a marketing entry typed by hand.

### Offer request forms

| ID | Requirement |
|---|---|
| REQ-01 | One form per business area, with the fields needed to actually quote |
| REQ-02 | Cleaning: building type · m² · number of objects · frequency · start date |
| REQ-03 | Security: occasion · date & time · expected attendance · number of staff · location |
| REQ-04 | Construction: trade · volume · deadline · LV upload |
| REQ-05 | Submission creates a `lead` with SLA deadline and named owner |
| REQ-06 | Auto-escalation when the SLA passes with no response |
| REQ-07 | UTM and referrer captured, carried through to `auftrag` |

---

## 3. Authentication & permissions

| ID | Requirement |
|---|---|
| AUT-01 | Roles: `super_admin` · `admin` · `leitung` · `mitarbeiter` · `kunde` |
| AUT-02 | Supabase Auth; 2FA mandatory for `super_admin` and `admin` |
| AUT-03 | Permissions configurable per role per mandant, editable in the UI |
| AUT-04 | Server-side authorization on every route and API — never UI-only |
| AUT-05 | RLS policies mirror application authorization |
| AUT-06 | Cross-tenant access returns **404, not 403** (403 confirms existence) |
| AUT-07 | Rate limiting and lockout on auth endpoints |
| AUT-08 | All auth events in `audit_log` |

**Role scope:**

- **Super Admin** — all four areas, all modules, permission management
- **Admin** — assigned modules within assigned areas
- **Leitung** — own business area only: employees, schedules, projects, orders, customers, tasks, approvals
- **Mitarbeiter** — own work only (§10)
- **Kunde** — own projects, orders, offers, invoices, documents, messages

---

## 4. Dashboards

| ID | Requirement |
|---|---|
| DSH-01 | Super Admin: active orders, active projects, employees, **currently working**, new leads, open offers, open invoices, revenue, expenses, profit, notifications, upcoming tasks, recent activity |
| DSH-02 | Filter by all areas or one |
| DSH-03 | Admin, Leitung, Employee, Customer dashboards scoped to their role |
| DSH-04 | Every figure links to the records behind it — no dead numbers |
| DSH-05 | "Currently working" derives from open `zeiteintrag` rows, live |

---

## 5. CRM

| ID | Requirement |
|---|---|
| CRM-01 | Companies, contacts, leads |
| CRM-02 | Lead score, status, priority, source, owner, next action |
| CRM-03 | Notes and full communication history |
| CRM-04 | Follow-up scheduling with reminders |
| CRM-05 | Lead → offer → order → invoice, linked end to end |
| CRM-06 | Customer history across all four areas |
| CRM-07 | **Lead sources: website forms · tender radar · manual entry · referral** |
| CRM-08 | `rechtsgrundlage` field on every contact: `einwilligung` / `bestandskunde` / `anfrage` / `keine` |

**CRM-08 is a hard gate.** Outbound messaging is blocked to any contact whose
legal basis is `keine`. See DECISIONS.md on §7 UWG.

---

## 6. Tender radar

The strongest acquisition channel in this business, and fully legal.

| ID | Requirement |
|---|---|
| RAD-01 | Ingest **oeffentlichevergabe.de** open data (OCDS) — national, including below-threshold, where most of this client's opportunities live |
| RAD-02 | Ingest **TED Search API v3** (public, no auth) — EU, above threshold |
| RAD-03 | `quell_id` unique → idempotent re-ingestion; raw payload retained |
| RAD-04 | `radar_profil` per area: CPV codes, NUTS (DE3/DE300), positive and negative keywords, value bounds |
| RAD-05 | **Deterministic scoring — no LLM in ranking** — with a human-readable reason per notice |
| RAD-06 | Deadline countdown; red under five days |
| RAD-07 | Status: neu · geprüft · verworfen (+reason) · in Bearbeitung · eingereicht |
| RAD-08 | Notification above a score threshold |
| RAD-09 | Track which procurement platforms the group is registered on; flag notices requiring an unregistered platform |

CPV starting points — verify against the official list:
cleaning `90910000 · 90911200 · 90911300 · 90919200`;
security `79710000 · 79713000 · 79714000 · 79715000`;
construction `45000000 · 45210000 · 45400000 · 45110000`.

RAD-09 matters: registration on a platform can take days to weeks. Discovering
the gap on deadline day wastes the opportunity entirely.

---

## 7. Operations

| ID | Requirement |
|---|---|
| OPS-01 | Customers, contacts, objects (locations) with address and coordinates |
| OPS-02 | **Raumbuch**: rooms per object with area (m²), floor type, cleaning class |
| OPS-03 | Floor-type catalogue with performance values (m²/hour) |
| OPS-04 | Excel/CSV import for Raumbuch with preview before commit |
| OPS-05 | Orders and projects with type, term, value, responsible manager |
| OPS-06 | Service catalogue per trade with time values |
| OPS-07 | Costing engine: labour + material + equipment + overhead + risk/profit |
| OPS-08 | Offer generation as PDF in the correct entity's identity |
| OPS-09 | Accepted offer converts to order in one action |
| OPS-10 | New contract wizard surfaces: location, staff needed, hours, equipment, start date, responsible manager |
| OPS-11 | Tasks, deadlines, status, documents on every order and project |

OPS-02 and OPS-03 are the basis of all cleaning pricing:
`standard time = Σ (room m² ÷ floor performance value) × frequency factor`

---

## 8. Trade modules

### Cleaning

| ID | Requirement |
|---|---|
| CLN-01 | **Reviere** — work zones per object with target minutes |
| CLN-02 | **Turnus** — recurrence via RRULE (RFC 5545), not custom fields |
| CLN-03 | Berlin public holidays excluded automatically |
| CLN-04 | **Leistungsnachweis** — customer signs on canvas; stores signer name, server time, location, and a **snapshot of the items as displayed at signing** |
| CLN-05 | Glass cleaning, special cleaning, Warenräumung as distinct services |

### Security

| ID | Requirement |
|---|---|
| SEC-01 | **Schichtposten** — 24/7 posts with required qualifications and minimum staffing |
| SEC-02 | **§34a GewO Sachkunde / Unterrichtungsnachweis** tracked per person with expiry |
| SEC-03 | **Bewacherregister** — Bewacher-ID and registration status per person |
| SEC-04 | **Hard block:** assigning a person to a post whose required certificate is expired **at the shift date** fails in the service layer, not just the UI |
| SEC-05 | **Wachbuch** — patrol, incident, handover, key, alarm entries with server time and photos |
| SEC-06 | **Dienstanweisung** per object, versioned, with read acknowledgement per employee |
| SEC-07 | Key management with handover receipts and signature |
| SEC-08 | Event security — short-notice staffing |

### Construction

| ID | Requirement |
|---|---|
| BAU-01 | **Leistungsverzeichnis** with hierarchical OZ numbering |
| BAU-02 | **Aufmaß nach VOB** — stores the **Rechenansatz formula text** and the computed result, both visible |
| BAU-03 | Countersignature and measurement photos required |
| BAU-04 | **Nachträge** with §2 VOB/B basis; `angemeldet_am` separate from `eingereicht_am` |
| BAU-05 | Warning when work outside the LV is logged without a Nachtrag |
| BAU-06 | **Behinderungsanzeige** (§6 VOB/B) with template and documented send date |
| BAU-07 | **Bautagebuch** — weather, Mannstunden per trade, equipment, deliveries, incidents, photos |
| BAU-08 | Weather auto-attached from DWD open data |

BAU-02 example: `"3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"` → `30,87 m²`.
An auditor must see how the number arose, not only the number.

---

## 9. Scheduling & time

| ID | Requirement |
|---|---|
| TIM-01 | Dienstplan: week and month view, all areas |
| TIM-02 | Recurring series (RRULE) with single-occurrence overrides |
| TIM-03 | Generator job fills eight weeks ahead, refreshed nightly |
| TIM-04 | **Parallel columns** for concurrent shifts — none hidden |
| TIM-05 | Conflict detection: overlap, missing qualification, ArbZG breaches |
| TIM-06 | ArbZG warnings: >8h (10h exception), <11h rest, missing breaks |
| TIM-14 | **ArbZG checks aggregate per `person` across all employments and entities** — including a rest period spanning two entities |
| TIM-07 | **Check-in by tokenised link — no app, no login**; token valid within shift window ±1h, single use |
| TIM-08 | **Server timestamp authoritative**; device time and `zeitabweichung_sek` stored separately |
| TIM-09 | Offline capture queued locally, submitted flagged as late, claimed time recorded |
| TIM-10 | Photo and video capture, EXIF stripped, stored private |
| TIM-11 | Manual correction leaves an immutable trail: who, when, why |
| TIM-12 | Time attaches to the order directly — no manual transfer to billing |
| TIM-13 | §17 MiLoG compliant records: start, end, duration; retained two years |

**Write these tests before any scheduling UI:**
22:00–06:00 → 8h · DST spring-forward night → 7h · DST fall-back night → 9h ·
ten shifts at the same instant render side by side · a shift crossing month-end
splits by actual minutes per month.

---

## 10. Employee portal

| ID | Requirement |
|---|---|
| EMP-01 | Lightweight account: phone number + SMS code, no password |
| EMP-02 | My assignments, my schedule, my projects |
| EMP-03 | Hours today · this week · **month total** |
| EMP-04 | **Stundenkonto** — target vs actual, overtime balance, carried forward |
| EMP-05 | Leave balance and used days |
| EMP-06 | Monthly hours statement as PDF |
| EMP-07 | **Objection flow** — the employee never edits a time entry; they raise a `zeit_einwand` that reaches the planner |
| EMP-08 | Own certificates with personal expiry warnings |
| EMP-09 | Dienstanweisung acknowledgement from the phone |
| EMP-10 | Sickness / absence report; leave and shift-swap requests |
| EMP-11 | Messages and documents relevant to them |
| EMP-12 | Multilingual UI: de / en / ar / tr |
| EMP-13 | Employees never see group financials, other employees' data, or customer commercials |
| EMP-14 | One login per **person**; the portal shows shifts across all employments, each labelled with its entity |
| EMP-15 | Hours shown combined across employments; `stundenkonto` kept separately per employment |

EMP-04: `stundenkonto` locks monthly. A locked month never changes; corrections
flow into the next month — exactly like invoices.

EMP-07 preserves the record's evidentiary value in a wage dispute or audit.

---

## 11. Finance

| ID | Requirement |
|---|---|
| FIN-01 | **Five billing types** behind one interface: hourly · monthly flat · fixed-price lot · unit price by Aufmaß · single call-off |
| FIN-02 | `entwurf` → `festgeschrieben`, one-way |
| FIN-03 | **Number assigned at finalization only**, via `SELECT … FOR UPDATE` on a counter row — gaps impossible |
| FIN-04 | **Pre-flight validator blocks finalization** on any missing §14 UStG field |
| FIN-05 | `Leistungszeitraum` mandatory — the most-omitted field; its absence voids the customer's input-tax deduction |
| FIN-06 | **Hash chain** across finalized invoices + nightly verification job |
| FIN-07 | Every line traceable to its source: Zeiteintrag · Aufmaß · contract · material |
| FIN-08 | **Abschlags- and Schlussrechnung** — prior partials deducted automatically; finalization blocked otherwise |
| FIN-09 | **§13b UStG** reverse charge for construction-to-construction |
| FIN-10 | **§48 EStG** Bauabzugsteuer — 15% withheld unless a Freistellungsbescheinigung is valid **at the service date** |
| FIN-11 | **XRechnung** (UBL, EN 16931) with Leitweg-ID; validated against KoSIT in CI |
| FIN-12 | **ZUGFeRD 2.x** PDF/A-3 for commercial customers |
| FIN-13 | Kleinbetragsrechnung < €250 with reduced requirements |
| FIN-14 | Incoming invoices, receipts, expenses, payments |
| FIN-15 | Dunning with escalation levels, fees, interest |
| FIN-16 | **Rechnungsausgangsbuch** per number circle |
| FIN-17 | Revenue, expenses, profit — per area and group |
| FIN-18 | Warning: completed order with no time recorded, before invoicing |

FIN-11 is not optional: GIZ, DRV Bund and Berlin district authorities are public
buyers. **Without XRechnung the group cannot invoice them at all.**

---

## 12. Accounting automation & DATEV

| ID | Requirement |
|---|---|
| ACC-01 | Chart of accounts SKR03/SKR04; automatic booking records from invoices |
| ACC-02 | **DATEV EXTF export** — Windows-1252 encoding, comma decimal separator |
| ACC-03 | **Document linked to booking line** (Belegverknüpfung) — the PDF travels with the entry |
| ACC-04 | Bank reconciliation: CAMT.053 import, matching by amount + invoice number + IBAN |
| ACC-05 | Incoming invoice OCR → extract supplier, number, date, net, VAT, gross, category, assigned entity → **proposal for human approval** |
| ACC-06 | GoBD-compliant archive: 10-year retention, deletion impossible |
| ACC-07 | Open-item lists, debtors and creditors |
| ACC-08 | Monthly figures (BWA-style) per entity and group |
| ACC-09 | **Z3 export** for tax audit (§147 Abs. 6 AO) |
| ACC-10 | `Verfahrensdokumentation` generated from live configuration |
| ACC-11 | One-click year-end package for the tax advisor |
| ACC-12 | Time data export to a payroll system |

**ACC-03 is where the money is saved.** What inflates a tax advisor's bill is
manual document entry, not the bookkeeping itself. Linking each PDF to its
booking line removes that work.

**DATEV integration is architecture-first.** Build the interface; connect the
real service when credentials exist. Never simulate a successful DATEV call.

`// TODO(client)`: Beraternummer · Mandantennummer per entity · SKR03 or SKR04 ·
Sachkontenlänge · Steuerschlüssel table · fiscal year start. **Request a real
sample EXTF export from their tax advisor before building ACC-02.**

**Not in scope:** payroll calculation, Jahresabschluss, E-Bilanz, tax filing
submission. See DECISIONS.md.

---

## 13. Documents

| ID | Requirement |
|---|---|
| DOC-01 | Categories: customer · contracts · offers · invoices · receipts · employee · project · accounting · company |
| DOC-02 | Upload, search, filter, tag |
| DOC-03 | **Private buckets only** — signed URLs, 15-minute expiry, never a public path |
| DOC-04 | Access control mirrors role and tenant scope |
| DOC-05 | Versioning where the document type warrants it |
| DOC-06 | Real MIME-type verification on upload, size limits, EXIF stripped |
| DOC-07 | Retention rules per category; financial documents cannot be deleted |
| DOC-08 | One-click bundle for an audit or inspection |

---

## 14. Calendar & notifications

| ID | Requirement |
|---|---|
| CAL-01 | Central calendar: projects, assignments, meetings, customer appointments, deadlines, follow-ups, interviews |
| CAL-02 | Filter by area, team, person |
| CAL-03 | iCal feed per user (read-only) |
| NOT-01 | Notify on: new lead · customer response · new order · new application · missing document · invoice due · deadline approaching · AI approval request · schedule change |
| NOT-02 | Per-user channel preferences (in-app, email) |
| NOT-03 | Notifications are actionable — each links to the record |

### Watchdog jobs

Plain scheduled jobs, no LLM:

| Watch | When | Action |
|---|---|---|
| Tender deadline < 5 days, untouched | daily | notify owner |
| Lead past SLA with no reply | hourly | escalate to manager |
| Shift ended, no `zeiteintrag` | hourly | notify planner |
| Tomorrow's shift unstaffed | daily 18:00 | urgent alert |
| Certificate expiring in 60 / 30 / 7 days | daily | escalating notice |
| Invoice overdue > 14 days | daily | propose dunning |
| Nachtrag announced, not submitted after 14 days | daily | notify project manager |
| Invoice hash chain broken | nightly | alert immediately |

---

## 15. Social Media Center

| ID | Requirement |
|---|---|
| SOC-01 | Manage all four profiles from one place |
| SOC-02 | Posts, images, project showcases, news, updates |
| SOC-03 | Draft → review → approve → schedule → publish |
| SOC-04 | Content pulls from real projects and released references (PRO-05) |
| SOC-05 | Publishing to the company profiles on the CSE website works immediately |
| SOC-06 | Instagram, Facebook, LinkedIn, TikTok, YouTube behind a `SocialChannel` interface |
| SOC-07 | Unconnected channels display "not connected" in the UI and are never simulated |
| SOC-08 | Nothing publishes externally without human approval |

---

## 16. Recruiting

Scope: **inbound applications**. No scraping of job boards — see DECISIONS.md.

| ID | Requirement |
|---|---|
| REC-01 | Staffing requirement derived from unstaffed shifts and pipeline |
| REC-02 | AI drafts job description and advertisement — human edits and approves |
| REC-03 | Application intake: web form on the career page + monitored mailbox |
| REC-04 | CV parsing → structured candidate record |
| REC-05 | Match candidates against role requirements; ranked shortlist with stated reasons |
| REC-06 | Interview question preparation; scheduling via the calendar |
| REC-07 | Applicant data retention limited and auto-purged per DSGVO |
| REC-08 | **Hiring decisions are human. Ranking is a suggestion with visible criteria** |
| REC-09 | Publishing to a job board only where a real API and credentials exist |

REC-08 matters legally as well as ethically: automated decision-making about
individuals is restricted under DSGVO Art. 22.

---

## 17. AI agents

Eight agents in the client spec collapse to **four real ones plus watchdogs** —
the rest were the same machinery under different names.

| Agent | Does | Never does |
|---|---|---|
| **CEO Assistant** | Answers questions over the live database | Invents a figure it cannot query |
| **Acquisition Agent** | Tender radar, reads Vergabeunterlagen, extracts rooms/areas/frequencies, fills price sheets, assembles the bid folder, names gaps | Sends or submits anything |
| **Back-office Agent** | Drafts replies to inbound enquiries, prepares monthly invoices from contracts, proposes dunning, drafts job ads | Sends externally without approval; sets prices |
| **Finance Agent** | Extracts data from uploaded receipts and incoming invoices, proposes bookings and categories | Books anything without approval |

| ID | Requirement |
|---|---|
| AGT-01 | Agent Center: name, description, status, tasks, activity, logs, permissions, connected tools, approval requirements |
| AGT-02 | Tools: `lies_dokument` · `extrahiere_lv` · `suche_bestand` (RAG) · `berechne_preis` (**pure code**) · `pruefe_nachweise` · `pruefe_bilder` · `entwirf_text` · `sende_email` (gated) · `erstelle_vorgang` |
| AGT-03 | Policy gate reading `agent_richtlinie`, editable from the UI without code |
| AGT-04 | Every step logged: tool, input, output, model, tokens, cost, duration |
| AGT-05 | Monthly budget cap → hard stop with notification, never silent degradation |
| AGT-06 | `pgvector` index over contracts, objects, offers, correspondence |
| AGT-07 | **CEO Assistant queries the real database.** No invented data. When it cannot answer from the schema, it says so |

### Autonomy matrix

| Task | Autonomy | Limit |
|---|---|---|
| Screen and rank tenders | automatic | — |
| Fetch documents, create a Vorgang | automatic | — |
| Read a Vergabeunterlage, extract data | automatic | — |
| Internal alert | automatic | — |
| Confirm an appointment | automatic with notice | — |
| Draft reply to an enquiry | proposal | — |
| Propose a replacement for an absence | proposal | — |
| Monthly invoice from contract | proposal | — |
| **Any offer, at any value** | **proposal — never automatic** | — |
| Offer > €20,000 | **never automatic, explicitly** | €20,000 |
| Discount or concession | **never** | — |
| Any external send | approval required | — |
| Booking to accounting | approval required | — |
| Publishing a post | approval required | — |

### Approval design — the part that decides whether this works

Forty approval requests a day and the human stops reading. That is worse than
full automation: it is automation with a **fake** safety net, and the human
carries the liability for something they did not read.

| ID | Requirement |
|---|---|
| APR-01 | One approval inbox, sorted by deadline and risk |
| APR-02 | **Diff-based review** — show what changed, not the whole document |
| APR-03 | Every extracted value carries its source (page, table) and a confidence flag; uncertain fields highlighted |
| APR-04 | Batch-approve routine items; flagged items forced to individual review |
| APR-05 | Delayed release with objection window for low-risk actions |
| APR-06 | Undo window wherever the action is reversible |
| APR-07 | **Immutable snapshot of exactly what was approved**, plus approver and timestamp |
| APR-08 | Measure review duration; flag consistent sub-3-second approvals |

APR-02 in practice: *"Same as last month, except +12 night hours at
Kurfürstendamm → +€456.00"*. A five-second review that is a real review.

APR-08 detects rubber-stamping. Consistent instant approvals mean either the
task is genuinely routine — raise its autonomy — or the screen has failed.

---

## 18. Reporting

| ID | Requirement |
|---|---|
| REP-01 | Revenue, expenses, profit — per area and group |
| REP-02 | Orders, leads, conversion rate |
| REP-03 | **Channel attribution** — which source produced signed orders |
| REP-04 | Employees: hours, utilisation, overtime |
| REP-05 | Projects: status, margin, deadline adherence |
| REP-06 | Tender pipeline: found, screened, bid, won |
| REP-07 | Export to CSV and PDF |

REP-03 answers the question the original business case rests on: which channel
actually produced work.

---

## 19. Legal & compliance

Not a phase. Built in from the first migration.

| ID | Requirement |
|---|---|
| LEG-01 | **GoBD** — no deletion, gapless numbering, 10-year retention, Verfahrensdokumentation |
| LEG-02 | **§17 MiLoG** — hour records for cleaning and construction; start, end, duration; two-year retention |
| LEG-03 | **ArbZG** — max hours, 11h rest, break warnings in the Dienstplan |
| LEG-04 | **§34a GewO + Bewacherregister** — enforced at assignment |
| LEG-05 | **§14 UStG** — mandatory invoice fields enforced at finalization |
| LEG-06 | **§13b UStG / §48 EStG** — construction VAT and withholding |
| LEG-07 | **BFSG / WCAG 2.1 AA** on public sites |
| LEG-08 | **§7 UWG** — outbound blocked without recorded legal basis (CRM-08) |
| LEG-09 | **DSGVO** — processing register, DPAs (Supabase, Vercel, OpenAI), deletion concept, data-subject request process |
| LEG-10 | **Geolocation at check-in** — single point at start and end, no continuous tracking; documented legal basis; employee notice |
| LEG-11 | Applicant data auto-purged (REC-07) |
| LEG-12 | DSGVO Art. 22 — no automated decisions about individuals |

`// TODO(client)`: Is there a **Betriebsrat**? Performance-monitoring systems
require its involvement under §87 BetrVG. This governs whether LEG-10 ships.

**Confirmed:** one person may hold employments in several entities — see
D-09. ArbZG limits (LEG-03) therefore aggregate **per person across all
employments**, not per employment. A 6h cleaning shift plus a 5h security shift
on the same day is an 11h breach and must be detected as one.

---

## 20. Security

| ID | Requirement |
|---|---|
| SEC-A1 | Server-side authorization on every route; never UI-only |
| SEC-A2 | RLS on every tenant table, mirroring application rules |
| SEC-A3 | **Automated tenant-isolation test suite** — user of A gets 404 on every entity of B |
| SEC-A4 | Input validation with Zod at every boundary |
| SEC-A5 | No API keys in frontend code; server-side only |
| SEC-A6 | Signed URLs for all file access |
| SEC-A7 | CSP, HSTS, X-Frame-Options |
| SEC-A8 | Dependency audit in CI; OWASP ZAP baseline scan |
| SEC-A9 | Full audit log: actor (human / agent / system), action, before, after, timestamp, IP |
| SEC-A10 | Encrypted backups with a **tested** monthly restore |

SEC-A3 is the highest-priority test in the codebase. A cross-tenant leak
between three legal entities ends the engagement.

---

## 21. Infrastructure

- Supabase Postgres, **EU (Frankfurt)** — RLS, Auth, Storage, cron
- Vercel, **EU function region**
- OpenAI with EU processing and zero-retention settings where available
- n8n only for external glue, never for core business logic
- GitHub Actions: typecheck, lint, unit, e2e, dependency audit, KoSIT validation
- Staging environment mirroring production
- Monitoring: uptime, error tracking, failed-job alerting
- Backups: point-in-time recovery + daily snapshot + tested restore

Every processor needs a signed DPA recorded in `DECISIONS.md`.

---

## 22. Data model

Core entities. Full column definitions live in `src/server/db/schema/`.

```
mandant · benutzer · rolle · benutzer_mandant · berechtigung · audit_log

kunde · ansprechpartner · objekt · raum · belagsart · dokument

person · anstellung · nachweis · bewacher_eintrag · qualifikation
mitarbeiter_zugang · abwesenheit · stundenkonto · urlaubskonto
zeit_einwand · antrag

lead · angebot · angebotsposition · kalkulation · leistungskatalog
auftrag · auftrag_leistung

revier · revier_raum · turnus · leistungsnachweis
posten · dienstanweisung · da_kenntnisnahme · wachbuch_eintrag
schluessel · schluessel_quittung
projekt · lv_position · aufmass · nachtrag · behinderung · bautagebuch

planungsserie · einsatz · zeiteintrag · checkin_token · medien
reklamation · qualitaetspruefung

rechnung · rechnungsposition · zahlung · mahnung
eingangsrechnung · beleg · ausgabe
datev_export · konto_mapping · nummernkreis

ausschreibung · radar_profil · bewertung · vergabemappe · vergabeplattform

agent_aufgabe · agent_schritt · agent_richtlinie · agent_budget · wissens_chunk

seite · referenz · social_post · social_channel · formular_definition
kanal_statistik · stelle · bewerbung · kandidat

kalender_eintrag · aufgabe · benachrichtigung · nachricht
```

Every tenant-owned table carries `mandant_id` with RLS enabled.

**`person` / `anstellung` (D-09):** a person is one human; an employment is one
contract with one entity. Anything costed or invoiced — `einsatz`,
`zeiteintrag`, `stundenkonto`, `urlaubskonto`, `abwesenheit` — hangs off
`anstellung_id`. Anything true of the human — `nachweis`, `bewacher_eintrag`,
`mitarbeiter_zugang` — hangs off `person_id`.

`person` is visible to every mandant the person is employed by. `anstellung`
and everything below it remain strictly tenant-scoped: **a cleaning manager must
not see security wage rates.**

---

## 23. Explicitly out of scope

Removed deliberately. Full reasoning in `DECISIONS.md`.

| Removed | Reason |
|---|---|
| Cold outreach to scraped contacts | §7 UWG — unsolicited electronic advertising without prior consent is prohibited, including B2B |
| Scraping Indeed / StepStone | Terms-of-service violation; DSGVO exposure on candidate data |
| Payroll calculation | Three sector wage agreements plus SOKA-Bau — needs a specialist payroll system |
| Jahresabschluss, E-Bilanz, tax filing | Reserved to the tax advisor; the platform prepares and exports |
| Automated submission to procurement platforms | No API exists; submission is manual by design |
| Eight separate AI agents | Consolidated to four — the rest were the same machinery renamed |
