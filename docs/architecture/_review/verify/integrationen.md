# Verification findings — integrationen

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (10)

### R1. `mandant_mail_absender` is used as a tenant table but is defined nowhere. §19.1 line 1244: "Sender identity is **per mandant** (`mandant_mail_absender`, tenant table with RLS)". It appears in none of §3.2–3.9, in no row of §3.10 ("Tables owned by siblings"), and in no row of §31. It is one of the exact tables B1 listed as undeclared, so B1's fix is one table short.

**Where:** 07-INTEGRATIONEN.md §19.1 (line 1244); absent from §3 and §31

**Fix:** Either declare it in §3 as a tenant table (mandant_id NOT NULL, FORCE RLS, the two K-03 policies, K-04 p_intern_ceiling, `UNIQUE (mandant_id, absender_domain)`, `credential_ref` as a Vault key name) or add it to §3.10/§31 as an obligation on 02-datenmodell/01-KERN.md.

### R2. The K-09 single-use UPDATE targets three columns that do not exist on the parent table. §4 line 504: `update freigabe set verbraucht_am = now(), verbraucht_durch = $benutzer where id = $id and mandant_id = app.aktiver_mandant() and verbraucht_am is null and now() <= gueltig_bis`. 02-datenmodell/06-RADAR-KI-INHALT.md §4.2 defines `freigabe` with `status`, `ausfuehrung_status`, `ausgefuehrt_am`, `ausfuehrung_fehler`, `frist`, `verzoegerte_freigabe_bis` and `undo_bis` — there is no `verbraucht_am`, no `verbraucht_durch` and no `gueltig_bis` anywhere in that document. The `Freigabe` TS interface has the same phantom `gueltig_bis`. §31's obligation row for that document does not ask for them.

**Where:** 07-INTEGRATIONEN.md §4 table row "Single use is a conditional write (K-09)" (line 504) and the `Freigabe` interface (§4)

**Fix:** Express the consumption against the columns that exist — a conditional `update freigabe set ausfuehrung_status = 'laeuft', ausgefuehrt_am = now() where id = $id and mandant_id = app.aktiver_mandant() and status = 'genehmigt' and ausfuehrung_status = 'offen' and (frist is null or now() <= frist) returning vorgang_typ, payload_hash` — or add an explicit §31 obligation on 02-datenmodell/06 §4.2 to introduce `verbraucht_am`/`verbraucht_durch`/`gueltig_bis`. Keep the token field name in step with whichever wins.

### R3. `kunde.erechnung_route` is introduced as a customer column with no owning document. §12.1: "the route is a property of the **customer** (`kunde.erechnung_route`), because the buyer decides it". §3 does not own it, §3.10 has no `kunde` row, and §31 has no obligation row for `02-datenmodell/02-CRM-OPERATIONS.md` at all — so the enum (`ozg_re · zre · land_portal · peppol · email_erechnung`) and the column exist only in prose.

**Where:** 07-INTEGRATIONEN.md §12.1 (line 963); §31 obligations table

**Fix:** Add a §31 row: `02-datenmodell/02-CRM-OPERATIONS.md` — `kunde` gains `erechnung_route erechnung_route` (nullable, only meaningful when `oeffentlicher_auftraggeber`) and the enum type, with a CHECK that a public buyer flagged for XRechnung has one before FIN-11 dispatch.

### R4. A CHECK constraint containing a subquery, which PostgreSQL rejects ("cannot use subquery in check constraint"); the migration would fail on first apply. §3.3: `CHECK (verbindungs_status <> 'verbunden' OR credential_ref IS NOT NULL OR integration_id IN (SELECT id FROM integration_katalog WHERE art = 'global'))`.

**Where:** 07-INTEGRATIONEN.md §3.3, Constraints (line 293)

**Fix:** Denormalise `art integration_art` onto `integration_konfiguration` (maintained by the FK/trigger against `integration_katalog`) and write `CHECK (verbindungs_status <> 'verbunden' OR credential_ref IS NOT NULL OR art = 'global')`, or move the rule into a `BEFORE INSERT OR UPDATE` trigger. The `jobboard_kanal` CHECK quoted in §21 is fine because it references only columns of its own row.

### R5. K-16 common columns are missing on three tables this section declares. K-16: "Every table: `id uuid primary key default gen_random_uuid()`, `erstellt_am timestamptz not null default now()`" (the S1 bundle in 02-datenmodell/06 §1.11 restates it as "every table"). §3.4 `integration_status_global` is keyed `| `integration_id` | text | no | PK, FK → `integration_katalog(id)` |` with no `id` and no `erstellt_am`; §3.7 `job_plan` is keyed `| `job` | text | no | PK, matches the `/api/cron/[job]` segment |` with neither; §3.2 `integration_katalog` declares `| `id` | text | no | PK, e.g. `datev.export` |` — a text id where K-16 says uuid.

**Where:** 07-INTEGRATIONEN.md §3.2 (line 254), §3.4 (line 305), §3.7 (line 395)

**Fix:** Either add S1 (`id uuid pk default gen_random_uuid()`, `erstellt_am timestamptz not null default now()`) and make the human key a `UNIQUE` constraint (`UNIQUE (integration_id)`, `UNIQUE (job)`, `UNIQUE (schluessel)`), or state the deviation explicitly the way 02-datenmodell/06 §1.5 does for reference tables and record it, so the `src/server/db/rls.ts` build check knows these are exempt.

### R6. `integration_aufruf` renames the K-16 common creation column. §3.5 declares `| `angelegt_am` | timestamptz | no | default `now()` |` and keys three of its four indexes on it (`ia_verlauf_idx (mandant_id, angelegt_am DESC)`, `ia_integration_idx`, `ia_fehler_idx`), while K-16 names that column `erstellt_am` everywhere. `integration_aufruf_system` inherits the same name.

**Where:** 07-INTEGRATIONEN.md §3.5 (line 338) and its index list

**Fix:** Rename to `erstellt_am` and update the three index definitions, or justify the deviation in §3.1 alongside the bucket rules.

### R7. §6.2's "exactly two" claim is contradicted by the document's own definer functions. It states: "There are exactly two places where a read legitimately leaves the active tenant". But §3.4 adds `app.integration_status_global()`, which "requires `app.portal() = 'intern'` and `system.einstellung_lesen` in **any** mandant of the caller"; §3.5 adds `app.integration_aufruf_system_lesen(...)`; §3.8 reads `restore_protokoll` "through a definer function requiring `system.betrieb_lesen`"; and §19.2 adds `app.bewerbung_eingang_liste()` ("requires `recruiting.schreiben` in at least one mandant") and `app.bewerbung_zuordnen(...)`. `bewerbung_eingang` holds applicant personal data outside any tenant, so that one is unambiguously a crossing.

**Where:** 07-INTEGRATIONEN.md §6.2 opening of the numbered list, against §3.4, §3.5, §3.8, §19.2

**Fix:** Replace "exactly two places where a read legitimately leaves the active tenant" with a closed, enumerated table of every sanctioned definer function in this layer (name, role, caller, precondition, audit action), and state that each carries `SET search_path = pg_catalog, public` per K-01 and writes `audit_log` — the way §6.2 already does for `app.arbzg_belastung`. K-08 stays untouched; it governs the pre-session path only.

### R8. The unauthenticated `/api/health` has no declared database context, which collides with K-08 and K-01. §23.1: "`GET /api/health` | none | `{ status, build_id, region, db_erreichbar, migration_ok, jobs_ueberfaellig }`". `migration_ok` and `jobs_ueberfaellig` require reading the migration table and `job_plan` ⋈ `job_lauf` with no session; K-08 permits exactly three functions outside `withTenant` and adds a route-manifest test, and K-01 gives `cse_anon` "No table grants at all". §6.2 restates that test verbatim, so the endpoint as specified fails the document's own gate.

**Where:** 07-INTEGRATIONEN.md §23.1, first table row

**Fix:** State the context: either the counts are computed by `cse_job` inside the `/api/cron/job-heartbeat` run and cached into a single system row that `/api/health` reads through one named definer function granted to `cse_anon` (and add it to K-08's list, or explain why a non-tenant liveness read is outside K-08's scope), or drop `migration_ok`/`jobs_ueberfaellig` to the authenticated `/api/verwaltung/integrationen` surface and leave liveness as build id, region and a `SELECT 1`.

### R9. §30's TODO gate contradicts §32's numbering. §30: "`pnpm lint:todo` | a `TODO(client)` … has no matching entry in `DECISIONS.md` § Open". Every one of the 22 TODO(client) comments in the body cites a local number — "(Frage 15)", "(FIN-11, Frage 17)", "(REQ-04, BAU-01, Frage 18)" — and §32 says "This document therefore **does not** claim global numbers". DECISIONS.md § Open lists O-01…O-13 only, so the gate fails on every TODO in this file the day it is enabled.

**Where:** 07-INTEGRATIONEN.md §30 (`pnpm lint:todo` row) against §32

**Fix:** State in §32 that the gate is satisfied by the merge step — the Frage numbers are rewritten to their allocated `O-nn` when §32 is merged into DECISIONS.md, and `lint:todo` is enabled only after that merge — or have §32 propose a concrete non-overlapping range now (the sibling ranges are already known: 03 proposes O-14…O-32, 04 up to O-52, 02-datenmodell/04 O-30…O-42).

### R10. Minor, and cosmetic beside the rest: the register (§5) gives the KoSIT validator a runtime `Nicht verbunden` state, while 01-ORDNERSTRUKTUR.md line 2482 states "KoSIT validation lives in `tests/compliance/` … no production path depends on a validator being reachable, so it has no `nicht-verbunden` state". §10 resolves the substance correctly (finalisation never depends on it), but the two documents render the same component differently and §31 does not reconcile them.

**Where:** 07-INTEGRATIONEN.md §5 register row "KoSIT validator"; §31 obligations table

**Fix:** Add a line to §31 under `01-ORDNERSTRUKTUR.md` §11.2: the optional runtime sidecar is an integration with a not-connected state used only for the asynchronous post-finalisation report of §10 step 3; the CI validator remains a test-only concern with no adapter.

## CONVENTION VIOLATIONS (0)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

## VERIFIER VERDICT

Yes, with a short punch list. All fourteen blocking items genuinely landed in the file — I checked each against the written text rather than the claim, and each one is present as a concrete, load-bearing change rather than a sentence acknowledging the criticism: §3 is a real table catalogue with types, nullability, indexes, FORCE RLS, the K-03 pair, the K-04 ceiling and a retention placeholder; the Freigabe token carries `mandant_id` with a `MANDANT_MISMATCH` code, a K-09 conditional consumption and three new CI gates; §6.1/§6.2 replace the service-role reasoning with K-01's six roles and K-06/K-08 verbatim; KoSIT is demoted to CI plus an asynchronous report with the finalisation gate moved to our own Node validator; the ausschreibung head/rohdaten split, the §13b USt 1 TG correction, `EInvoiceDeliveryPort`, `kosten_cent` + `kosten_rest`, the split `AlertPort`, `job_plan` + heartbeat, `meldung_schluessel`, and the human-attended restore custody are all in the text. All four rejections are sound and I verified each against the cited sibling section — the `freigabe` family really is fully specified in 02-datenmodell/06 §4, K-06 really does forbid returning `mandant_id`, K-08 really does cap the pre-session path at three functions, and K-16 really does put agent cost accounting in cents. Money is bigint cents throughout, quantities are `numeric(12,3)`, instants are timestamptz and calendar facts are DATE, no costed entity hangs off `person_id` (the ACC-12 export is explicitly per `anstellung`, and `bewacher_eintrag` on `person_id` is correct under D-09), no external call is simulated, and the previously invented values — backup rotation, the DATEV period lock, the VIES-as-§13b test, the swept `exporte` bucket — are now placeholders with TODO(client) questions. What remains is nine defects of implementation hygiene rather than of design: two tables/columns used but owned by nobody (`mandant_mail_absender`, `kunde.erechnung_route`), a consumption UPDATE written against three columns that do not exist on the parent `freigabe`, a CHECK constraint with a subquery that Postgres will refuse, three tables missing the K-16 S1 bundle plus one renamed `erstellt_am`, an \"exactly two crossings\" claim the document's own definer functions outgrew, an unauthenticated `/api/health` with no declared database context, and a TODO-lint gate that contradicts the local question numbering. None of these forks the architecture; all are one-paragraph or one-row corrections, and after them this document is fit to implement against.
