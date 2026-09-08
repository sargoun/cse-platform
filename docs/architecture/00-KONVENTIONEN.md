# Phase 0 — Binding conventions

Authoritative for every other document in `docs/architecture/`. Where a domain
document and this file disagree, **this file wins** and the domain document is
wrong and must be corrected.

These are not style preferences. Each one resolves a conflict that an adversarial
review found between two requirements that are individually correct — the kind of
conflict that produces a silent, expensive, late-discovered failure. Conventions
carry IDs (`K-nn`); reference them in PRs.

---

## K-01 · Database roles

Six named Postgres roles. The application never connects as `postgres`, and
**no application role holds `BYPASSRLS`.**

| Role | Used by | Holds |
|---|---|---|
| `cse_migrator` | migrations in CI | DDL. Never used at runtime. |
| `cse_definer` | owner of every `SECURITY DEFINER` helper | The only role exempt from FORCE RLS, and only on the tables named in K-06 and K-08. Cannot log in. |
| `cse_app` | every authenticated request | DML through RLS. No table grants beyond the column grants of K-05. |
| `cse_anon` | pre-session requests | `EXECUTE` on exactly its rows of the K-08 register. No table grants at all. |
| `cse_checkin` | the tokenised check-in endpoint and its offline replay | `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` only (K-08). |
| `cse_job` | cron and Edge Functions | Per-job grants, enumerated in the job definition. |

**`ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant table.** Without
`FORCE`, RLS does not apply to the table owner, and a migration-owned connection
silently sees everything.

`SECURITY DEFINER` functions are owned by `cse_definer`, and every one carries
`SET search_path = pg_catalog, public` — an unqualified `search_path` on a definer
function is a privilege-escalation vector.

---

## K-02 · Session state

Set with `set_config(..., true)` — transaction-local — inside `withTenant` /
`withGroupScope`. Never set from a URL parameter (invariant 3, TEN-04, AUT-04).

| GUC | Meaning |
|---|---|
| `app.benutzer_id` | the authenticated `benutzer` |
| `app.person_id` | the `person` behind that login, or NULL |
| `app.mandant_id` | **exactly one** mandant, or NULL in every multi-tenant scope |
| `app.mandant_ids` | the mandanten the user may read — group, person and kunde scope; **always derived server-side** (K-18) |
| `app.scope` | `mandant` \| `gruppe` \| `person` \| `kunde` — see K-18 |
| `app.portal` | `intern` \| `mitarbeiter` \| `kunde` |
| `app.readonly` | `on` \| `off` — **defaults to `on`** |
| `app.aal` | `aal1` \| `aal2` — assurance level of the session |
| `app.akteur_typ` | `mensch` \| `agent` \| `system` — for SEC-A9 |
| `app.akteur_id` | the agent run or job run behind a non-human write |
| `app.ip` | request IP, for `audit_log` |

The last three are **audit-only**: they exist so `audit_log` can record who acted
(SEC-A9 requires actor kind, and a typed actor with no identity is not an audit
trail). **No RLS policy may reference them** — a policy keyed on a
self-declared actor type would let the caller widen its own access by asserting
one. CI asserts no policy names them.

**Fail-closed.** Every accessor coalesces a missing GUC to the most restrictive
value: no mandant, no rights, read-only. An unset session must produce zero rows,
never all rows.

`CHECK ((scope = 'mandant') = (mandant_id IS NOT NULL))` is asserted by the
session helper, not merely assumed — in the three multi-tenant scopes
`app.mandant_id` is NULL and `app.mandant_ids` carries the set.

### The `[mandant]` path segment is routing only

It exists so URLs are shareable and bookmarkable. It is **validated against the
session, never trusted**. On mismatch: **404, not 403** (AUT-06) — a 403 confirms
the record exists.

---

## K-03 · The standard policy shape

`app.hat_recht()` **takes a mandant argument.** A global permission predicate
carries a right granted in one entity into every other entity the user can reach —
which is precisely the leak RLS exists to stop.

```sql
app.hat_recht(p_recht text, p_mandant uuid) returns boolean
```

Every tenant table gets exactly two policies, and no others:

```sql
-- 1. tenant scope: read and write
create policy t_mandant on <tabelle>
  for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and app.hat_recht('<modul>.<aktion>', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('<modul>.schreiben', mandant_id));

-- 2. group scope: SELECT ONLY — this policy has no write counterpart, ever
create policy t_gruppe on <tabelle>
  for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('gruppe.<modul>.lesen', mandant_id));
```

**Invariant 10 is enforced by Postgres, not by a service check.** Because no
`INSERT`/`UPDATE`/`DELETE` policy anywhere references group scope, a write under
group scope matches no policy and is refused by the database. The service-layer
guard is the first line; this is the second.

A policy that omits the `hat_recht` conjunct is a defect. Tenant membership alone
must never grant read access to a module — otherwise a `kunde` login reads the
staff directory and every colleague's MiLoG hour records.

---

## K-04 · Portal ceilings

`app.portal()` is derived from **the role of the active membership**, not from the
existence of a membership. A `mitarbeiter` membership resolves to
`portal = 'mitarbeiter'` however many other memberships exist; `intern` requires
the active membership's role ∈ {`super_admin`, `admin`, `leitung`}.

That derivation applies in `mandant` scope, where there is an active membership.
In the three multi-tenant scopes of K-18 there is none, so `app.portal` is **bound
when the scope is entered** and never recomputed from `aktiver_mandant` — see
K-20, which exists because recomputing it there falls through to the fail-closed
`mitarbeiter` and fires every ceiling below inside the group view.

EMP-13 is structural. Every table hanging off `anstellung_id` or `person_id`
carries a **restrictive** ceiling in addition to K-03:

```sql
create policy p_ma_ceiling on <tabelle> as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select id from anstellung
                              where person_id = app.aktuelle_person()));
```

Enumerated, not exemplified — `anstellung`, `person`, `stundenkonto`,
`urlaubskonto`, `abwesenheit`, `zeit_einwand`, `antrag`, `einsatz`,
`einsatz_zuordnung`, `zeiteintrag`, `zeiteintrag_korrektur`, `medien`,
`da_kenntnisnahme`, `nachweis`, `bewacher_eintrag`. **`src/server/db/rls.ts`
holds the list and the build fails when an anstellung-hung or person-hung table
has no ceiling.** The same shape exists for `portal() = 'kunde'`, keyed on the
customer's own `kunde_id`.

---

## K-05 · Wage confidentiality: column privileges, not masking views

D-09 §6 — *a cleaning manager must not see security wage rates* — is enforced with
**column-level `GRANT`**, which composes correctly with RLS.

Masking views are forbidden for this purpose. `select a.*, case … end as
rate_masked from anstellung a` hands out the raw column and adds a masked copy
beside it. And the two ways to make a view work are both wrong: with
`security_invoker = true` the caller needs base-table privileges that were just
revoked, so the table is unreadable; without it the view runs as its owner and, if
that owner can bypass RLS, returns every tenant's rows with the tenant predicate
silently ignored.

```sql
revoke select on anstellung from cse_app;
grant  select (id, person_id, mandant_id, personalnummer, eintritt, austritt,
               status, arbeitszeitmodell, wochenstunden, erstellt_am, geaendert_am)
       on anstellung to cse_app;   -- stundensatz_intern, tarifgruppe omitted
```

The rate is reachable only through
`app.entgelt_lesen(p_anstellung uuid)` — `SECURITY DEFINER`, re-checks
`personal.entgelt_lesen` **and** `mandant_id = app.aktiver_mandant()`, and writes
`audit_log`.

---

## K-06 · The ArbZG cross-entity window — the one legitimate crack

TIM-14, LEG-03 and D-09 consequences 1 and 2 require aggregating one person's
hours **across entities**. K-03 makes that impossible by design: a planner in
`reinigung` cannot see a `security` shift. Left unresolved, the check silently
returns "no conflict" and a 6h + 5h day is scheduled as lawful — the exact failure
D-09 was written to prevent, with no error to notice.

So there is exactly one sanctioned crossing, and it is narrow, audited and tested.

**Storage.** `zeit_intern.arbeitszeit_fenster` lives in a schema **not exposed by
PostgREST**, one row per assignment:

```
zuordnung_quelle_id uuid   the einsatz_zuordnung this window derives from
quelle              enum   plan | ist
aktiv               bool   the ist row supersedes its plan row in the same statement
beginn_utc, ende_utc timestamptz
```

One window per assignment. Without `zuordnung_quelle_id` and the supersede rule,
the detector sums the planned shift and the worked shift and reports 12h for a 6h
day — and a foreign-tenant plan/actual pair is indistinguishable from two genuine
back-to-back shifts, so the error cannot be filtered out downstream.

**Reading.**

```sql
app.arbzg_belastung(p_person uuid, p_von timestamptz, p_bis timestamptz)
  returns table (fenster_gruppe text,   -- opaque hash, for deduplication only
                 beginn_utc timestamptz, ende_utc timestamptz,
                 minuten integer, fremd boolean)
```

`SECURITY DEFINER`, owned by `cse_definer`. It returns **durations and interval
boundaries and nothing else** — never `mandant_id`, never the entity's name, never
`objekt`, `kunde`, `personalnummer` or `stundensatz_intern`. The caller learns
*that* the person is otherwise committed, never *where* or *for whom*.

Preconditions, checked inside the function: the caller can already see the person
via `app.person_sichtbar(p_person)`, and holds `dienstplan.arbzg_pruefen` in the
active mandant. Every call writes `audit_log` with
`aktion = 'arbzg.aggregat_gelesen'`.

**Writing findings.** `arbeitszeit_verstoss` has **no INSERT policy for
`cse_app`**. A breach spanning two entities must be recorded in both, and a
request scoped to mandant A cannot write a row in mandant B. Findings are written
only by `app.arbzg_befund_schreiben(...)`, `SECURITY DEFINER`, which asserts the
caller was entitled to the person in the active mandant before writing the mirror
row.

**Only caller:** `src/server/services/arbzg/`. **Isolation test:** a `reinigung`
planner gets the breach and gets zero fields identifying the `security` shift.

---

## K-07 · URL namespace

The portal lives under `/portal`. Public marketing keeps the root.

```
/                          public
/unternehmen/[bereich]     public company profile — canonical
/portal/[mandant]/…        tenant portal
/portal/gruppe/…           group view, read-only
/portal/mein/…             employee portal
/check-in/[token]          tokenised, session-less
```

Without the prefix, `/reinigung` is simultaneously a public profile and a tenant
dashboard. Next.js route groups do not appear in the URL, so one of the two
silently wins: either every mandant switch lands a manager on a marketing page, or
the four short marketing URLs 404. There is no configuration in which both work.

The prefix also shrinks the reserved-slug problem from ~25 public and auth
segments to the portal's own three. `mandant.slug` carries a `CHECK` excluding
`gruppe`, `mein`, `api`, and **a CI test walks the App Router tree and fails when
a new static segment under `/portal` is added without being added to the
constraint** — TEN-08 promises a fifth area needs a DB row and no code change, and
a hand-maintained list with no test does not deliver that.

---

## K-08 · The pre-session data path

Some requests have no session yet, or never will: the login that creates one, the
tokenised check-in (TIM-07), the offline replay that follows it, and the read-only
iCal feed (CAL-03). Each needs the database before any principal is known.

These paths are governed by a **closed register**, not by a count. The register
below is exhaustive; a function not on it may not execute outside `withTenant` or
`withGroupScope`, and the **route-manifest test fails the build on any new one
that is not added here in the same PR.**

| Function | Role | Purpose |
|---|---|---|
| `app.sitzung_aufloesen(token_hash)` | `cse_anon` | resolve a session before any principal is known |
| `app.versuch_protokollieren(...)` | `cse_anon` | rate limiting and lockout (AUT-07) |
| `app.checkin_verbrauchen(token_hash, geraet_zeit, ip)` | `cse_checkin` | TIM-07 / TIM-08 |
| `app.offline_ereignis_annehmen(token_hash, ereignisse, ip)` | `cse_checkin` | TIM-09 — late arrival of the same trust boundary as check-in |
| `app.ical_feed_lesen(feed_token_hash)` | `cse_anon` | CAL-03 — read-only, single user, no write path |

The offline replay is check-in data arriving late over the same token: same
subject, same authentication, same conditional-write discipline (K-09). Splitting
it onto a different mechanism would mean two trust boundaries for one fact. The
iCal feed is read-only by construction and returns one user's own entries.

All five are `SECURITY DEFINER` owned by `cse_definer`. The check-in path has no
session, so it has no GUCs, so every K-03 policy evaluates false for it — it
therefore does no table access of its own at all. The function derives
`mandant_id` and `anstellung_id` from the `einsatz` and inserts the `zeiteintrag`
itself.

**A route-manifest test asserts no other code path reaches the database outside
`withTenant` or `withGroupScope`.**

---

## K-09 · Single-use tokens are a conditional write

Check-then-act is a race. A worker double-tapping a link on a slow connection is
not an edge case, and a duplicated `zeiteintrag` is duplicated billable time
(FIN-07, TIM-12) and a duplicated §17 MiLoG record.

```sql
update checkin_token
   set eingeloest_am = now(), ip_adresse = $ip, user_agent = $ua
 where token_hash = $hash and eingeloest_am is null
   and now() between gueltig_ab and gueltig_bis
returning einsatz_id, mandant_id;
```

The match is on `token_hash`, not on `id`: the worker's link carries the token,
and looking the row up by id first would reintroduce the read-then-write this
convention exists to remove.

Zero rows returned **is** the 409. The `zeiteintrag` is inserted in the same
transaction, only if a row came back. Pre-checks may exist to produce a friendlier
message, never to decide. Concurrency test: N simultaneous requests against one
token yield exactly one `zeiteintrag`.

---

## K-10 · The AI supplies no number, and no input that determines one

Invariant 6 and AGT-07 are defeated at the entry point if a tool accepts
model-authored figures. A model that writes `netto_cent: '250000'` gets an
invented amount back stamped "computed by a tested service", with a green
confidence chip in the approval UI. Proving the *arithmetic* ran in code proves
nothing about where the *inputs* came from.

Every money, quantity or formula argument is either

- **a handle** — an entity id the service dereferences to stored rows, or
- **a token** from a prior result in the same run's number register.

Never a numeric literal, never an expression string. `berechne_preis` derives
`leistung_ids`, quantities and the Zuschlagsprofil from the contract and the
catalogue. `aufmass` takes an `AufmassHandle` and reads the stored `rechenansatz`.
Cleaning standard time derives room ids from `revier`/`turnus`.

**Choosing the surcharge profile is choosing the margin, which is setting a
price** — SPEC §17 says the Back-office agent never sets prices, so
`zuschlag_profil_id` is never a model argument.

Test: no branch of `berechne_preis` accepts a numeric literal or an expression
string originating in a tool argument.

---

## K-11 · Calendar boundaries are Berlin wall-clock

Instants are stored UTC (invariant 2). But a day, a month and a billing period are
**Berlin** boundaries converted to instants — never UTC midnight.

`splitteNachMonat('2026-01-31T21:00Z', '2026-02-01T05:00Z')`
→ `[{2026,1,120}, {2026,2,360}]`

21:00Z is 22:00 Berlin (CET); the Berlin month boundary is at `23:00Z`. Splitting
at UTC midnight misattributes 60 minutes — and in CEST, 120. That error
propagates into §17 MiLoG records (TIM-13, LEG-02), Stundenkonto month locking
(EMP-04) and the invoice period split (FIN-07).

Every reference test carries **a CET case and a CEST case**, so a UTC
implementation cannot pass by accident.

### The DST reference cases, verified

The transition **night** begins on the evening *before* the transition day. Naming
the shift by the transition date is off by one and asserts a value the shift does
not have — the same class of error as splitting at UTC midnight, and just as
permanent once a test enshrines it.

| Case | Shift (Berlin wall-clock) | UTC instants | Expected |
|---|---|---|---|
| Normal night | `2026-03-27 22:00` → `2026-03-28 06:00` | `21:00Z` → `05:00Z` | **480 min** |
| **Spring forward** | `2026-03-28 22:00` → `2026-03-29 06:00` | `21:00Z` → `04:00Z` | **420 min** |
| **Fall back** | `2026-10-24 22:00` → `2026-10-25 06:00` | `20:00Z` → `05:00Z` | **540 min** |

In 2026 the transitions fall on Sunday **29 March** (01:00Z, CET→CEST) and Sunday
**25 October** (01:00Z, CEST→CET). A shift starting at 22:00 *on* either of those
days is an ordinary 480-minute shift and proves nothing.

Month split, Berlin boundary: `2026-01-31 20:00` → `2026-02-01 04:00`
→ `[{2026,1,240}, {2026,2,240}]`.

---

## K-12 · A finalised invoice is immutable, and the hash covers identity

Invariant 4 admits no exceptions, so nothing that changes after finalisation may
live on the invoice row. `versendet_am` and the Storno back-reference move to
child tables — `rechnung_versand` and `rechnung_beziehung`. The immutability
trigger stays unconditional, and a test asserts
`UPDATE rechnung SET versendet_am = … WHERE status = 'festgeschrieben'` raises.

A column allowlist in that trigger would leave invariant 4 with no database-level
guarantee at all.

**The canonical payload snapshots identity**, not references to it:

```
leistender { name, anschrift, steuernummer | ustid, hrb, gericht }
empfaenger { name, anschrift, ustid, leitweg_id }
je Steuerzeile { satz, netto_cent, steuer_cent, hinweistext }
abrechnungsart · bauabzugsteuer_cent · kleinbetrag · leistungszeitraum
```

With only `kunde_id` and `mandant_id` as references, editing the customer master
record or the entity's tax number later changes what the invoice, the XRechnung
and the PDF say, while chain verification still reports `intakt: true`. The §14
UStG pre-flight would then validate fields the hash does not protect. The rendered
PDF and the XRechnung are produced **from the snapshot**, never from live master
data.

---

## K-13 · Approval chain and review duration

Chain only `freigabe_snapshot`, which is immutable. `freigabe` is a row whose
status changes; hashing it means either covering columns that change or silently
covering an undeclared subset.

`freigabe_snapshot.kette_nr bigint` is assigned under `SELECT … FOR UPDATE` on a
per-mandant `freigabe_kette` head row — the same construction as FIN-03, and for
the same reason: a chain needs a serialised total order, or two concurrent
approvers fork it and the nightly verification job reports a break every busy day.
`freigabe_snapshot` carries `id`, `mandant_id`, `freigabe_id`, `erstellt_am` and
RLS like any other tenant table.

**APR-08 is measured server-side.** `GET /api/freigaben/[id]` writes
`freigabe_ansicht(freigabe_id, benutzer_id, geoeffnet_am_server)`; the decision
computes `pruefdauer_sek` from that row and is **refused when no view row exists**.
`geoeffnet_am` never appears in a request body. A rubber-stamping detector that
trusts a client timestamp is defeated by the exact actor it targets — and then
reports a fabricated distribution under a signed audit trail.

---

## K-14 · Derived memberships are additive

A `leitung` of CSE Dienstleistungen is normally also *employed* by CSE
Dienstleistungen. A trigger that maintains `benutzer_mandant` from `anstellung`
must not collide with her manual grant: with PK `(benutzer_id, mandant_id)` and a
single `rolle_id`, it either overwrites `leitung` with `mitarbeiter` — silent
privilege loss, she loses her whole area — or throws and blocks the employment
insert.

`benutzer_mandant.aus_anstellung boolean not null default false`. The trigger
inserts only when absent and removes only rows it owns. Ending an employment never
strips a manually granted role. Test: a person with `leitung` in A plus an
`anstellung` in A keeps `leitung` after the trigger runs **and** after `austritt`.

---

## K-15 · Where the 2FA gate sits

AUT-02 requires 2FA for `super_admin` and `admin` only. Every `leitung`,
`mitarbeiter` and `kunde` runs at `aal1`.

A restrictive `aal2` policy on `benutzer_mandant` therefore returns zero rows for
them, `sichtbare_mandanten()` returns `{}`, and **every** policy keyed on it is
false: the whole platform goes blank for every non-admin, including the check-in
worker and the customer portal.

The gate belongs on the **write path of the permission-administration tables** —
`rolle_berechtigung`, `benutzer_mandant` INSERT/UPDATE/DELETE — never on SELECT of
a table that membership resolution depends on.

---

## K-16 · Common columns and deletion

Every table: `id uuid primary key default gen_random_uuid()`,
`erstellt_am timestamptz not null default now()`; mutable tables add
`geaendert_am timestamptz`. Accountability adds `erstellt_von` / `geaendert_von`
referencing `benutzer`.

Tenant tables add `mandant_id uuid not null references mandant(id)`. Where a
composite FK is used to keep a child in its parent's tenant, the parent **must**
declare the matching `UNIQUE (mandant_id, id)` — seven such FKs in the first drafts
referenced a parent that never declared it.

**No hard deletes** in finance, time tracking or audit (invariant 8): those tables
carry `archiviert_am` / `storniert_am` and a `BEFORE DELETE` trigger that raises.
Deletion protection is stated per table, not assumed globally.

Money is `bigint` cents. Quantities are `numeric(12,3)` — they are not money and
must not be cents. Durations are `integer` minutes or seconds, named with the unit
(`minuten`, `zeitabweichung_sek`).

### Four permitted deviations, and only these

Each was found by review to be forced by Postgres or by the domain. A deviation
not on this list is a defect.

**(a) Composite primary key where partitioning requires it.** Postgres requires
the partition key in the primary key, so a `PARTITION BY LIST (mandant_id)` table
takes `PRIMARY KEY (mandant_id, id)` — `wissens_chunk` is the case. Every FK
pointing at such a table is composite and its parent declares the matching
`UNIQUE`.

**(b) Sub-cent accounting for AI cost only.** Model token pricing is genuinely
sub-cent; rounding each step to a cent destroys the budget arithmetic that AGT-05
depends on. Columns named `*_mikrocent bigint` (10⁻⁶ €) are permitted **only** in
agent cost and budget accounting — `agent_schritt`, `agent_budget` and their carry
columns. Conversion to cents happens **once**, at the budget boundary, half-up,
and the rounding rule is stated at the conversion site. Nothing invoiced, booked
or exported may be micro-cents: a figure that reaches `rechnung`, `buchungssatz`
or DATEV is `bigint` cents, full stop.

**(c) Computed target durations may be fractional.** A *measured* duration —
worked time, a MiLoG record, a rest period — is `integer` and never fractional; it
is evidence. A *computed target* — `revier.sollzeit_minuten` derived from
`Σ m² ÷ Leistungswert` — is `numeric(8,2)`, because rounding each room to a whole
minute accumulates a visible error across a Revier of eighty rooms. The
distinction is target vs. actual, and each column states which it is.

**Catalogues are never nullable-tenant.** A shared catalogue (`qualifikation`,
`belagsart`, `nachweis_art`) is either group-wide — **no `mandant_id` column at
all**, classified `global` — or per-tenant with `mandant_id NOT NULL`. A nullable
tenant column on a catalogue means "sometimes shared, sometimes not", which no RLS
predicate can express without a branch that leaks the shared rows into every
tenant's writes. Choose one per catalogue and say which.

**(d) `audit_log.mandant_id` is nullable.** A failed login, a lockout and the
*source* side of a mandant switch all precede or transcend tenancy; forcing a
tenant onto them would mean inventing one. `audit_log` therefore carries
`ebene enum('plattform','mandant')` with
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, so a NULL is a stated
platform-level fact rather than a missing value. It is the only tenant-adjacent
table with a nullable `mandant_id`, and its RLS reads platform rows only for
`super_admin`.

---

## K-17 · What must never be invented

Where SPEC or DECISIONS leaves a legal, financial or tariff value open, the
document states a **labelled placeholder**, an interface that makes the unknown
swappable, and `// TODO(client): <the exact question>` — and the question is
recorded in `docs/DECISIONS.md` under **Open**.

This applies to: the exact five billing types (O-04), DATEV account mapping and
the Steuerschlüssel table (O-05), tariff and wage rates, retention periods beyond
those the SPEC states, dunning fees and interest, the SMS provider (no provider is
chosen), Bewacher-ID formats, and any CPV code not verified against the official
list.

A concrete legal or financial value that SPEC does not state and that is not
marked `TODO(client)` is a defect, not a detail.

---

## K-18 · Four read scopes, not two

`app.scope` takes four values, not two. The first drafts had only `mandant` and
`gruppe`, so the employee and customer portals were routed through **group**
scope — and that is a category error with a concrete consequence: K-03's group
policy requires `gruppe.<modul>.lesen`, a management right an employee or a
customer will never hold. Both portals would read zero rows. Widening the group
right to make them work would hand every cleaner a group-level read.

The two portals genuinely span tenants — EMP-14 shows one person's shifts across
all employments, CRM-06 shows a customer's history across all four areas — but
they span them **as a subject**, not as a manager.

| `app.scope` | Who | Row visibility | Writes |
|---|---|---|---|
| `mandant` | staff working in one entity | `mandant_id = app.aktiver_mandant()` + `hat_recht` | yes, per K-03 |
| `gruppe` | management, TEN-05 | `= any(sichtbare_mandanten())` + `gruppe.<modul>.lesen` | **never** |
| `person` | the employee portal | `= any(sichtbare_mandanten())`, that array derived server-side from the person's `anstellung` rows | only through the objection and request flows (EMP-07, EMP-10) |
| `kunde` | the customer portal | `= any(sichtbare_mandanten())`, derived from the customer's own `auftrag` / `angebot` / `rechnung` rows | only their own messages and uploads |

`person` and `kunde` scope each get a SELECT-only policy keyed on **the subject**,
never on a group right:

```sql
create policy t_person on <tabelle>
  for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and <the row belongs to app.aktuelle_person()>);
```

The subject predicate is not a second implementation of the K-04 ceiling — the
ceiling is `restrictive` and still applies on top. The ceiling says *at most your
own rows*; this policy says *these rows, in these tenants*. Both must pass.

`sichtbare_mandanten()` is **derived server-side** in every scope — from
`benutzer_mandant`, from `anstellung`, or from the customer's own records. It is
never taken from the request (K-02).

The write columns above are narrow by design: EMP-07 is explicit that an employee
raises a `zeit_einwand` and **never** edits a `zeiteintrag`. Every other write in
both portals goes through a service that re-enters `mandant` scope with a
resolved single tenant.

---

## K-19 · One permission catalogue, and CI proves it

`app.hat_recht()` returns **false** for a key it does not know. That is the right
fail-closed default, and it makes every misspelled or unregistered right key a
**silent, permanent zero-row failure** rather than an error — no exception, no log
line, just a screen that is always empty. Twelve documents writing right keys
independently produced roughly forty such keys.

**`03-AUTH-BERECHTIGUNGEN.md` owns the catalogue.** Its module vocabulary and its
action vocabulary are the only ones. A right key used in an RLS policy, a route
gate, a service check or a seed, anywhere in the platform, must have a row there.

`berechtigung_aktion` must contain at least these, because the conventions
themselves name them:

| Action | Required by |
|---|---|
| `lesen` | K-03 policy 1, K-18 |
| `schreiben` | **K-03's `WITH CHECK` on every tenant table** |
| `loeschen` | K-16 archival paths |
| `pruefen` | **K-06 `dienstplan.arbzg_pruefen`** |
| `freigeben` | invariant 7, APR-01…08 |
| `exportieren` | K-03 group scope, REP-07, ACC-09 |
| `verwalten` | AUT-03 permission administration |

An action vocabulary omitting `schreiben` means **no write path in the platform
can be authorised at all** — every `WITH CHECK` names `<modul>.schreiben`.

**The enforcement is a test, not vigilance.** CI extracts every right-key literal
from policies, route manifests and services, and fails on any key absent from the
catalogue — and on any catalogue key no code uses, so the catalogue cannot rot
into a wish list.

---

## K-20 · Every scope accessor must resolve in every scope

An accessor that reads `app.aktiver_mandant()` returns NULL in the three
multi-tenant scopes of K-18, because `app.mandant_id` is NULL there by
construction. Any predicate built on it is then false, and the page reads zero
rows — the same silent failure K-18 was written to remove, reappearing one layer
down.

Two accessors were found with exactly this defect and are fixed here:

- **`app.aktueller_kunde()` / `app.aktuelle_kunden()`** resolve from the session's
  `kunde_zugang` binding, **never** through `aktiver_mandant()`. In `kunde` scope
  that binding is the whole subject of the request.
- **`app.portal()`** is bound when the scope is entered and is defined in all four
  scopes. It is **not** recomputed from `aktiver_mandant`: doing so makes it fall
  through to the fail-closed `mitarbeiter` in group, person and kunde scope, which
  fires every K-04 employee ceiling inside the group view and ceilings every
  customer as though they were staff.

**Rule:** every `app.*` accessor states its value in all four scopes. One that is
undefined in a scope must say so and must not be referenced by a policy reachable
from it. A CI test enumerates the accessors and asserts each returns a defined
value, or a documented NULL, under all four.

---

## K-21 · Table ownership and canonical names

Each table is **declared exactly once**, in the document that owns its domain.
Other documents reference it and never redeclare it. Eight tables were referenced
by up to six documents and declared by none — `job_lauf` was written with four
different column sets — so ownership is recorded here.

| Table | Owner | Canonical form |
|---|---|---|
| `job_lauf` | `02-datenmodell/01-KERN.md` | `id, job text, gestartet_am, beendet_am, ergebnis enum, kennzahlen jsonb, fehlertext` — **platform-level, no `mandant_id`** |
| `job_lauf_mandant` | `02-datenmodell/01-KERN.md` | per-tenant outcome of one run: `job_lauf_id, mandant_id, ergebnis, kennzahlen` |
| `mandant_einstellung` | `02-datenmodell/01-KERN.md` | `id, mandant_id, schluessel, wert jsonb`, `UNIQUE (mandant_id, schluessel)` |
| `nachweis_art` | `02-datenmodell/01-KERN.md` | certificate-type catalogue |
| `sicherheitsvorfall` | `02-datenmodell/01-KERN.md` | SEC-A9 security events |
| `loeschprotokoll` | `02-datenmodell/01-KERN.md` | DSGVO deletion record (LEG-09, REC-07) |
| `steuersatz_gruppe` | `02-datenmodell/05-FINANZEN.md` | **there is no `steuersatz` table**; every FK is `*.steuersatz_gruppe_id` |
| `rechnung_beziehung` | `02-datenmodell/05-FINANZEN.md` | K-12's name and columns win over `storno_verweis` |
| `agent_artefakt` | `02-datenmodell/06-RADAR-KI-INHALT.md` | agent run output |

`job_lauf` carries **no** `mandant_id`: it is a platform operations log, not tenant
data, so K-16(d) keeps `audit_log` as the only tenant-adjacent table with a
nullable one. Per-tenant results of a run live in `job_lauf_mandant`.

### Canonical spellings

Where two documents named one thing two ways, the owner wins:

| Use | Not |
|---|---|
| `mandant.slug` (K-07) | `mandant.schluessel` |
| `mandant.ist_rechtseinheit` | `ist_rechtstraeger` |
| `agent_budget.budget_cent` (the cap) | `monatslimit_cent` |
| `agent_budget.verbrauch_mikrocent` (K-16 b) | a stored `verbrauch_cent` — the cents figure is **computed** at the boundary |
| `mandant_einstellung` keys for the O-06 monitoring switches | `mandant.geo_erfassung_aktiv`, `mandant.ueberwachung_aktiv` |
| the nine AGT-02 tool names in `06-AGENTEN-FREIGABEN.md` | any tenth tool invented by a domain document |

Reserved `mandant.slug` values, one list: `gruppe`, `mein`, `kunde`, `konto`,
`api` — the portal statics of K-07, plus `api`.
