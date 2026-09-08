# Authentication Model and Permission Model

This document fixes how a request acquires an identity, how that identity acquires exactly one
business area, how a permission is decided, and how the same decision is repeated inside Postgres.
It covers SPEC §3 in full (AUT-01 … AUT-08), the tenancy requirements that authentication carries
(TEN-01, TEN-03 … TEN-10), the security requirements (SEC-A1 … SEC-A7, SEC-A9), the worker login and
its structural ceiling (EMP-01, EMP-12, EMP-13, EMP-14, EMP-15), the three session-less bearer
capabilities (TIM-07, TIM-08, TIM-09, CAL-03, DOC-03), customer access (DOC-04, CRM-06) and the
agent principal (AGT-01, AGT-03, APR-07). Everything named here — table, column, function, GUC,
right key, error class, audit event — is the name the implementation must use. It is subordinate to
`docs/architecture/00-KONVENTIONEN.md`: every rule below that touches roles, session state, RLS,
portals, approvals or invented values is an application of a numbered convention (K-01 … K-18) and
cites it inline. Where this document and a convention appear to disagree, **the convention wins and
this document is defective**. Where SPEC and DECISIONS leave a legal, financial or operational value
open, it appears as a labelled placeholder plus `// TODO(client)` and in §20, never as a quietly
chosen number (K-17).

---

## 0. Standing, scope, and the documents this one is bound to

**Binding inputs, in order of precedence:** `00-KONVENTIONEN.md` → `CLAUDE.md` (the ten invariants)
→ `docs/SPEC.md` → `docs/DECISIONS.md` → `docs/DESIGN.md` → `docs/ROADMAP.md`.

**This document owns:** the principal taxonomy, the session lifecycle, 2FA enrolment and the
assurance level, lockout and rate limiting, every bearer-token format, the authorization pipeline and
its TypeScript contract, the right-key catalogue, the seeded role × module × mandant matrix, the
error taxonomy behind AUT-06, the auth and tenancy audit-event catalogue, and the tenant-isolation
suite that proves all of it.

**This document does not own:**

| Question | Owner |
|---|---|
| Column definitions, types, indexes and triggers as DDL | `02-datenmodell/01-KERN.md` and its four siblings |
| Physical file placement, import zones, CI gates | `01-ORDNERSTRUKTUR.md` |
| Per-page content, states and German copy | `04-SEITENKARTE.md` |
| Request/response shapes per endpoint | `05-API-KARTE.md` |
| Agent prompts, tool schemas, orchestration loop | `06-AGENTEN-FREIGABEN.md` |

Where this document names a table or a column it does so to fix a **contract**; the data-model
document owns the exact type. Names used here are binding on those documents, and §21 lists the
obligations this document places on them.

**Language.** Domain identifiers are German because they carry legal meaning
(`benutzer · rolle · berechtigung · benutzer_mandant · benutzer_sitzung · mitarbeiter_zugang ·
kunde_zugang · anmeldeversuch · checkin_token`). Infrastructure identifiers are English
(`withTenant`, `resolveSession`, `NotFoundError`). UI copy is German; worker-facing screens are
additionally translatable de / en / ar / tr (EMP-12, SPEC §10).

---

## 1. Principals — who can act

### 1.1 The five kinds

A principal is always a `benutzer` row. What differs before any permission is evaluated is **how the
row is authenticated**, which is a property of the credentials Supabase Auth holds for it, not a
column on the row.

| Principal | Authenticates with | Bound to | Session issuable | SPEC |
|---|---|---|---|---|
| Internal staff user | e-mail + password, **plus TOTP where the role requires it** | `benutzer` | yes | AUT-01, AUT-02 |
| Worker (Mitarbeiter) | phone + SMS one-time code, **no password** | `benutzer.person_id` via `mitarbeiter_zugang` | yes | EMP-01, EMP-14 |
| Customer user | e-mail + password | `kunde_zugang` per mandant | yes | AUT-01, DOC-04 |
| AI agent | none — never interactive | a service `benutzer` + `agent_richtlinie` | **no** | AGT-01, AGT-03 |
| System / job runner | none — cron and Edge Function identity | a service `benutzer` | **no** | SPEC §14, §21 |

**There is no `benutzer.art` column, and there is no nullable `auth_user_id`** (review B12). The
data model fixes `benutzer.id = auth.users.id` as a primary key that is itself the foreign key
(`02-datenmodell/01-KERN.md` §6.4). Every principal therefore has an `auth.users` row, including a
service principal — the PK *is* the auth reference, so there is no construction in which one does
not. The objection the review raised is not that the row exists; it is that **an operator who
removes a credential must not thereby create a login**, and that is what a flag answers and an
absence does not:

> A **service principal** is a `benutzer` with `person_id IS NULL`, a non-routable internal
> address, **no password, no phone identity and no MFA factor**, and `benutzer.ist_dienstkonto =
> true`. `resolveSession()` refuses to build a session for such a row — the refusal is by the flag,
> not by the absence of credentials, because absence is a state an operator could accidentally
> change. A service principal reaches the database only through `withSystemTenant(mandantId, grund,
> fn)` or the agent orchestrator (§14).

**How the row is created**, because a Drizzle migration cannot insert into `auth.users` and an
undefined creation path becomes a hand-made row with a password on it. `scripts/seed/dienstkonten.ts`
calls the **Supabase Admin API** (`auth.admin.createUser`) with `email_confirm: true`, a non-routable
address at a reserved internal domain, **no `password`, no `phone`**, and immediately writes the
`benutzer` row with `ist_dienstkonto = true` and the id the API returned. The two steps are not one
transaction — no API and one database can be — so the invariant is asserted rather than assumed:
`tests/invariants/dienstkonto.test.ts` fails when any `benutzer` with `ist_dienstkonto = true` has a
matching `auth.users` row carrying `encrypted_password`, `phone`, an identity in `auth.identities`,
or any row in `auth.mfa_factors`, **and** when any `auth.users` row exists with no `benutzer` row at
all. A half-finished seed is a failure, not a silent orphan that later gets a password.

The pattern is already in use: `02-datenmodell/02-CRM-OPERATIONS.md` §1.6 gives the public website
renderer a service `benutzer` holding exactly `oeffentlich.lesen` in the four mandanten. Agents and
jobs use the same construction, which keeps AGT-01's promise that an agent's reach is edited in the
same permission UI as a human's, with no back door and no `service_role` shortcut (SEC-A5).

### 1.2 Three things that look like principals and are not

| Capability | What it actually is | Never has | SPEC |
|---|---|---|---|
| Check-in link token | a single-use capability for exactly one `einsatz_zuordnung`, redeemable twice at most (`checkin` then `checkout`) | session, cookie, permission set, list endpoint | TIM-07, TIM-08 |
| Signed storage URL | a time-boxed capability for one object, minted **after** an authorization decision has already been made | any authority of its own; it cannot be exchanged for a session | DOC-03, SEC-A6 |
| iCal feed token (`benutzer_feed_token`) | a long-lived, revocable read secret for one user's own calendar feed | write access, mandant switching, any row the holder could not read interactively | CAL-03 |

All three are bearer secrets. All three are stored as `sha256` hashes only, are revocable without a
hard delete (invariant 8), appear in `audit_log` on issue, use and revocation, and are covered by
the rate-limit table of §10. None of them is an authentication mechanism: possession grants a
specific, enumerated act on a specific, pre-resolved row.

### 1.3 One human, one login

**One human = one `benutzer`** (EMP-14, D-09 consequence 4). A person who cleans for `reinigung` and
leads a team in `security` has one login, one `benutzer` row with `person_id` set, and two
`benutzer_mandant` rows with different roles. Uniqueness is a partial unique index
`benutzer_person_key UNIQUE (person_id) WHERE person_id IS NOT NULL AND deaktiviert_am IS NULL`, not
a convention — two accounts pointing at one human would make the combined portal view of EMP-15
depend on which one they logged in with.

Which portal that human lands in is a property of **the active membership's role**, not of the
account (§1.4, K-04).

### 1.4 Portals (K-04)

Every authenticated request runs in exactly one **portal context**. It is derived server-side from
the role of the active membership and written into the `app.portal` GUC; a client value is never
read.

```sql
-- 02-datenmodell/01-KERN.md §3.2, quoted because this document's ceilings depend on it verbatim
app.portal_fuer(p_benutzer uuid, p_mandant uuid) returns text
-- global role's portal, else the active membership's rolle.portal, else 'mitarbeiter'
```

| Portal | URL space (K-07) | Reached when | Data reachable |
|---|---|---|---|
| `intern` | `/portal/[mandant]`, `/portal/gruppe` | the active membership's role has `rolle.portal = 'intern'` — seeded for `super_admin`, `admin`, `leitung` | everything the permission set allows, tenant-scoped |
| `mitarbeiter` | `/portal/mein` | the active membership's role has `rolle.portal = 'mitarbeiter'` | own `person`, own `anstellung`-hung rows only (EMP-13) |
| `kunde` | `/portal/kunde` | the active membership's role has `rolle.portal = 'kunde'` | own `kunde` rows, across every mandant in which that login holds a live `kunde_zugang` (CRM-06, K-18) |

**Portal is not scope.** `app.portal` is the *ceiling* — at most whose rows (K-04). `app.scope` is
the *reach* — which tenants, and by which permissive policy (K-18, §8.3). They are set from
different facts and neither substitutes for the other: a `mitarbeiter` portal session runs in
`person` scope while reading `/portal/mein` and in `mandant` scope for the two writes EMP-07 and
EMP-10 allow, with the ceiling unchanged in both. Reading tenancy off the portal would give a worker
employed by two entities either one entity or all of them; reading the ceiling off the scope would
lift EMP-13 the moment the reach widened.

**The review's B4 is correct and K-04 states the fix.** Deriving the portal from the *existence* of a
membership makes every worker eligible for `portal = 'intern'`, because §2 makes every worker a
derived `benutzer_mandant` row. In the internal portal the `app.portal() <> 'mitarbeiter'` ceilings
do not fire, so EMP-13 would rest on a service-layer call rather than on the database. Deriving it
from the **role of the active membership** closes that: a `mitarbeiter` membership resolves to
`portal = 'mitarbeiter'` however many other memberships exist, and a `kunde` membership can never
resolve to `intern`.

`app.portal()` **defaults to `mitarbeiter` when the GUC is unset**, not to `intern` — an unset
session must narrow the ceiling, never lift it (K-02, `02-datenmodell/01-KERN.md` §3.1). A person
who is both a Leitung and an employee holds two memberships and reaches both portals from the same
login, in two different portal contexts, with the management rights inert in the employee one.

---

### 1.5 The identity tables, as this document needs them

The full column lists are owned by `02-datenmodell/01-KERN.md` §6.1 and §6.4. Restated here are the
columns this document's rules depend on, because a contract that names a column must say what it
means (review MISSING).

**`mandant`** — one business area (TEN-01):

| Column | Type | Contract |
|---|---|---|
| `id` | `uuid` PK | |
| `schluessel` | text UNIQUE | `reinigung` \| `security` \| `bau` \| `operations`; a fifth area adds a value as data, not as code (TEN-08) |
| `slug` | text UNIQUE | the `[mandant]` URL segment (§4.5). `CHECK` excludes `gruppe`, `mein`, `kunde`, `api` (K-07) |
| `firma`, `rechtsform` | text | the legal name that appears on an invoice snapshot (K-12) |
| `ist_rechtstraeger` | boolean | whether the area is a legal entity, and therefore whether it gets its own number circle (TEN-02). **Its value for `operations` is unknown — O-01** |
| `module` | `text[]` | enabled modules; `'{}'` means all (TEN-08, §7.3 stage 4) |
| `identitaets_hue`, `logo_pfad` | text | the identity hue of DESIGN §5 and the app-shell logo (TEN-07); never a button colour (D-10) |
| `archiviert_am` | `timestamptz` | archived areas stay **readable** (LEG-01, ACC-06) but leave `app.switcher_mandanten()` |

**`benutzer`** — one login account, and the actor that appears in `audit_log`:

| Column | Type | Contract |
|---|---|---|
| `id` | `uuid` PK | **is** the FK to `auth.users.id`, so RLS predicates compare against `auth.uid()` with no join |
| `person_id` | `uuid` NULL | set when a human of the group stands behind the account (D-09, EMP-14); NULL for customer and service accounts |
| `email` | text NULL | partial UNIQUE over `lower(email)`; NULL is legitimate — a phone login has no e-mail. `CHECK (email IS NOT NULL OR person_id IS NOT NULL)` |
| `name` | text NOT NULL | display name; the audit row additionally snapshots the name as at the moment of the act |
| `sprache` | enum | **only** for accounts with no `person_id`; a human's language is `person.sprache` (§5.1, EMP-12) |
| `globale_rolle_id` | `uuid` NULL | the global role — how `super_admin` reaches a fifth area with no membership row (TEN-08, §2) |
| `ist_dienstkonto` | boolean | a service principal: never issued a session (§1.1) |
| `status`, `gesperrt_bis` | enum, `timestamptz` | AUT-07 lockout state |
| `letzter_login_am`, `letzte_ip` | `timestamptz`, `inet` | SEC-A9 |
| `deaktiviert_am` | `timestamptz` | soft delete only — `audit_log` references the account permanently (invariant 8) |

There is **no** `art`, no `auth_user_id`, no `kunde_id`, no `zwei_faktor_aktiv`, no
`zuletzt_genutzter_mandant_id` and no `fehlversuche` column. Each is removed for a stated reason:
§1.1 (principal kind), §1.1 (the PK is the auth reference), §13.1 (a customer identity is resolved
per mandant), §3.1 (2FA state is never mirrored), §4.4 (`benutzer_mandant.ist_standard` carries the
landing area) and §10 (per-user counters cannot rate-limit attacks on accounts that do not exist).

---

## 2. AUT-01 — the five roles and their exact scope

The five roles are seeded rows in `rolle` with `ist_system = true`: their `schluessel`,
`geltungsbereich` and `portal` are immutable, their **rights are data and editable in the UI**
(AUT-03). Additional mandant-specific roles may be created in the UI (`rolle.mandant_id` set); the
five system roles cannot be deleted or renamed.

| Role | `rolle.schluessel` | `geltungsbereich` | `portal` | Scope, exactly as SPEC §3 states it | Mandant reach |
|---|---|---|---|---|---|
| Super Admin | `super_admin` | `global` | `intern` | all four areas, all modules, permission management | every `mandant` row, automatically including a fifth (TEN-08) |
| Admin | `admin` | `mandant` | `intern` | assigned modules within assigned areas | the mandanten in `benutzer_mandant`, intersected with `benutzer_mandant.module` |
| Leitung | `leitung` | `mandant` | `intern` | own business area only: employees, schedules, projects, orders, customers, tasks, approvals | exactly the mandanten in `benutzer_mandant` |
| Mitarbeiter | `mitarbeiter` | `mandant` | `mitarbeiter` | own work only (SPEC §10) | derived from live `anstellung` rows (K-14) |
| Kunde | `kunde` | `mandant` | `kunde` | own projects, orders, offers, invoices, documents, messages | the mandant of their `kunde_zugang` row |

Five consequences the implementation must respect:

1. **`super_admin` is a global role, not a fan-out of memberships** (review B20). It is carried by
   `benutzer.globale_rolle_id`, and `app.sichtbare_mandanten()` returns every mandant for it. A user
   promoted to `super_admin` after the mandanten exist therefore sees all of them immediately, and a
   fifth area needs no membership rows (TEN-08). The draft's "trigger creates a `benutzer_mandant`
   row for every `super_admin` on mandant insert" is deleted: it left a newly promoted super-admin
   with `{}` and no way into the permission editor they were promoted to use.
2. **`super_admin` is gated on `aal2` and on a live session.** `app.ist_super_admin()` is false at
   `aal1`, false for a deactivated or locked account, and false without an unexpired
   `benutzer_sitzung` row. This is not the construction K-15 forbids — the gate sits inside the
   elevation predicate for the one role AUT-02 says must hold `aal2`, not on the SELECT path of
   `benutzer_mandant`.
3. **`admin` is two-dimensional.** The effective set is the role's bindings **intersected with**
   `benutzer_mandant.module`. An admin without a module has no right in it even where the role
   binding grants one, and `mandant.module` intersects again on top (TEN-08).
4. **`mitarbeiter` memberships are derived and additive** (K-14).
   `benutzer_mandant.aus_anstellung boolean not null default false`; the trigger on `anstellung`
   inserts only when no live row exists and removes only rows it owns. Ending an employment never
   strips a manually granted `leitung`. Test: a person with `leitung` in A plus an `anstellung` in A
   keeps `leitung` after the trigger runs **and** after `austritt` (review B6).
5. **`kunde` is a role in the same catalogue**, so a customer's rights are editable per mandant
   (AUT-03) — but its structural ceiling is the restrictive `portal() = 'kunde'` policy set (§8.5),
   never the binding table alone.

```
// TODO(client, O-85): Are roles beyond these five required — "Objektleiter", "Buchhaltung",
// "Disponent" as distinct roles — or are the five fixed, with per-mandant right bindings and
// mandant-specific roles doing the differentiation?
// TODO(client, O-85): May an Admin appoint a second Admin, and may a Leitung authorise a deputy
// within their own area? (The rank/delegation rule of the draft data model is not shipped
// until this is answered — 02-datenmodell/01-KERN.md §6.5.)
```

---

## 3. AUT-02 — Supabase Auth and the second factor

### 3.1 What Supabase Auth owns, and what the platform owns

| Supabase Auth owns | The platform owns |
|---|---|
| credential storage and password hashing | the active mandant — never in a token (invariant 3, TEN-04) |
| TOTP factors and the AAL of the verified session | the effective right set and the portal ceiling |
| SMS OTP issuance and verification (EMP-01) | instant, per-device session revocation |
| e-mail verification and password-reset tokens | read-only context, group context |
| `auth.users`, `auth.uid()` | everything German-domain: `benutzer`, `person`, `mandant`, `rolle` |

**No second authentication stack is built.** EMP-01's "phone number + SMS code, no password" is
Supabase phone OTP. A home-grown OTP store is forbidden: a six-digit code has 10⁶ preimages and a
SHA-256 of it is reversible in milliseconds by anyone who can read the row
(`02-datenmodell/01-KERN.md` §2).

**2FA state is never mirrored.** There is no `benutzer.zwei_faktor_aktiv` column and no
`zwei_faktor_pflicht` generated column. Enrolment is read live by
`app.hat_zweiten_faktor(p_benutzer)` against `auth.mfa_factors`; the *session's* level is the
`app.aal` GUC set from the verified Supabase session (K-02). A mirror maintained by a hook has no
reconciliation path: a user who removes their factor in Supabase leaves `true` behind, and the
trigger meant to implement AUT-02 then approves an account with no second factor. (This also
resolves the review's MINOR on "generated column … maintained by trigger", which is not a
construction Postgres supports across tables — the column is gone, not corrected.)

**The Supabase Data API (PostgREST) is disabled for application data.** First migration:

```sql
revoke all on schema public from anon, authenticated;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
```

The browser therefore never talks to Postgres. All access is server-side Drizzle on the six roles of
K-01. A leaked anon key is not a data path, and RLS is genuinely the *second* line of defence
(§8.10). SEC-A5: the `service_role` key exists only in server environment variables, is read only by
the migration runner, and appears in no route handler and no client bundle.

### 3.2 Where the 2FA gate sits — and where it must not (K-15)

AUT-02 requires 2FA for `super_admin` and `admin` **only**. Every `leitung`, `mitarbeiter` and
`kunde` legitimately runs at `aal1`.

**The review's B1 is correct, and K-15 is the resolution.** A restrictive `aal2` policy on
`benutzer_mandant` returns zero rows for every non-admin; `app.sichtbare_mandanten()` then returns
`{}` and every policy keyed on it is false. The whole platform goes blank for every Leitung, every
worker and every customer, including the check-in path. The gate belongs on the **write path of the
permission-administration tables**, never on the SELECT of a table membership resolution depends on.

| Layer | Mechanism | Result when it fires |
|---|---|---|
| 1 · Role data | `rolle.erfordert_2fa = true` for `super_admin` and `admin`; `berechtigung.erfordert_2fa` marks individual high-risk rights | — |
| 2 · Account | trigger `benutzer_2fa_pflicht` refuses `status = 'aktiv'` when a held role requires 2FA and `app.hat_zweiten_faktor()` is false | account stays `eingeladen` |
| 3 · Session resolution | `resolveSession()` returns `{ status: 'mfa_erforderlich_nicht_eingerichtet' \| 'mfa_erforderlich_nicht_verifiziert' }` when a held role requires 2FA and the Supabase AAL is not `aal2`. **No tenant context is built.** | enrolment-only session (§3.3) |
| 4 · Routing | `middleware.ts` redirects to `/auth/zwei-faktor/einrichten` or `/auth/zwei-faktor/pruefen`. **Cosmetic only** — middleware is a routing convenience, not a boundary | 302 |
| 5 · Authorization | `requireAal2()` in `src/server/auth/guards.ts`; `app.hat_recht()` returns false for any right with `erfordert_2fa` when `app.aal() <> 'aal2'`; `app.ist_super_admin()` is false at `aal1` | 403 `MFA_ERFORDERLICH` |
| 6 · Database | one restrictive policy, on the **write path only**, on `rolle_berechtigung` and on `benutzer_mandant` INSERT/UPDATE/DELETE | write refused |

```sql
-- K-15. Reads are never gated, so no policy below is `for select` and none is `for all`.
-- DELETE consults only USING and never WITH CHECK, so a `for all … using (true)` policy
-- leaves DELETE ungated — which would let an aal1 holder of system.rolle_verwalten revoke
-- memberships and rights with no second factor, the exact act K-15 names.
create policy rb_aal2_neu    on rolle_berechtigung as restrictive for insert to cse_app
  with check (app.aal() = 'aal2');
create policy rb_aal2_aendern on rolle_berechtigung as restrictive for update to cse_app
  using (app.aal() = 'aal2') with check (app.aal() = 'aal2');
create policy rb_aal2_weg    on rolle_berechtigung as restrictive for delete to cse_app
  using (app.aal() = 'aal2');

create policy bm_aal2_neu    on benutzer_mandant   as restrictive for insert to cse_app
  with check (app.aal() = 'aal2');
create policy bm_aal2_aendern on benutzer_mandant  as restrictive for update to cse_app
  using (app.aal() = 'aal2') with check (app.aal() = 'aal2');
create policy bm_aal2_weg    on benutzer_mandant   as restrictive for delete to cse_app
  using (app.aal() = 'aal2');
```

The `delete` halves are **belt and braces, not the only control**: neither table has a permissive
`DELETE` policy for `cse_app` at all (`02-datenmodell/01-KERN.md` §6.7 and §6.8 — "Kein `DELETE`"),
because revocation is `rolle_berechtigung.gewaehrt = false` and `benutzer_mandant.entzogen_am`, never
a row removal (invariant 8). Writing the restrictive half anyway means that if a `DELETE` policy is
ever added, it lands already gated instead of silently ungated — which is how the draft's
`for all … using (true)` failed: it *looked* like it covered DELETE and did not.

A restrictive `for update … using` narrows which rows may be updated; it does not touch `SELECT`, so
the "reads are never gated" property of K-15 is preserved and `tests/invariants/aal2-gate.test.ts`
still asserts that no `SELECT` policy anywhere mentions `app.aal()`.

`tests/invariants/aal2-gate.test.ts` asserts two things: exactly the permission-administration
action files call `requireAal2()`, and **no SELECT policy anywhere in `src/server/db/rls/*.sql`
mentions `app.aal()`**.

`nummernkreis` carries **no** `aal2` policy (review B11). It is an ordinary tenant table with rights
`nummernkreis.lesen` / `nummernkreis.verwalten` (`02-datenmodell/05-FINANZEN.md` §1.3) plus the
`portal() = 'intern'` ceiling. Under an `aal2`-only policy an `aal1` Leitung holding
`finanzen.festschreiben` reads zero rows from the counter table, so the `SELECT … FOR UPDATE` of
FIN-03 either fails opaquely or — worse, if "no row" is read as "first invoice" — restarts the
sequence and produces duplicate numbers inside a GoBD-relevant circle (LEG-01). Where a step-up is
genuinely wanted for finalisation it is data, not a blanket policy: `berechtigung.erfordert_2fa` on
`finanzen.festschreiben`.

```
// TODO(client, O-90): Should invoice finalisation (finanzen.festschreiben), Storno and DATEV export
// additionally require a second factor at the moment of the act, even for a Leitung who has no
// standing 2FA obligation under AUT-02?
```

### 3.3 The administrator who has not enrolled

The account is authenticated and **has no tenant context at all**. It holds an *enrolment-only
session*:

| Property | Value |
|---|---|
| Session row | **none.** No `benutzer_sitzung` row is created (see below) |
| Reachable routes | `/auth/zwei-faktor/einrichten`, `/auth/zwei-faktor/pruefen`, `/auth/abmelden`, `/api/auth/zwei-faktor/*` — an explicit allowlist; everything else is `notFound()` |
| Reachable data | none. No `withTenant`, no GUCs, every K-03 policy false |
| Switcher | not rendered — no membership is resolved |
| Identity hue | the neutral group hue, never an area hue (DESIGN §6 rule 4; the bar is still drawn) |
| Audit | `auth.zwei_faktor_pflicht_ausgeloest` on first refusal, then `auth.zwei_faktor_einrichtung_gestartet`, `auth.zwei_faktor_einrichtung_abgeschlossen` |

**There is no `ansicht = 'keine'`, and this document previously asked for one in error.** K-18 gives
`app.scope` exactly four values — `mandant | gruppe | person | kunde` — and
`02-datenmodell/01-KERN.md` §6.9 makes `sitzung_ansicht` the source of that GUC, with the same four.
A fifth `ansicht` value would therefore be a fifth scope, which K-18 forbids; the convention wins and
this document is corrected (review B13's requirement is met a different way).

The state needs no enum value because it needs **no session row**. The account is authenticated by
Supabase and nothing more: `resolveSession()` returns
`{ status: 'mfa_erforderlich_…' }` **without inserting `benutzer_sitzung`**, the allowlisted
enrolment routes talk to the Supabase Auth API and to no application table, and the only database
call on the path is `app.versuch_protokollieren` (K-08) for rate limiting. Every K-03, K-18 and K-04
policy is false for it because every GUC is unset — which is the fail-closed default of K-02, not a
special case. A session row appears at the first request that reaches `aal2`, and it appears with
`ansicht = 'mandant'` or `'gruppe'` like any other.

That is strictly narrower than a context-less session row: a row that exists can be found, refreshed
and — if a later policy is written carelessly — read from. A row that does not exist cannot.

The draft's `sitzung.portal text not null` and `berechtigung_version bigint not null` are both
deleted: the portal is derived per request by `app.portal_fuer()` and there is no cross-request
permission cache to version (§7.3).

A `leitung` who is **promoted** to `admin` enters this state on their next request. The promotion
writes `benutzer.rolle_zugewiesen` to `audit_log` and revokes every session of that account,
forcing a fresh login and enrolment.

### 3.4 Losing the factor — break-glass

Supabase Auth's TOTP factors carry no built-in recovery-code mechanism, so recovery is a platform
decision and is therefore **not decided here**. Two paths are specified; only the first ships until
the client answers.

1. **Second-administrator reset (ships).** A second holder of `system.zwei_faktor_zuruecksetzen`
   clears the factor. The right is `nur_global = true`, so only a global role can hold it: an
   `admin` able to clear another `admin`'s factor would defeat AUT-02 in one step. The reset revokes
   every session of the target account, writes `auth.zwei_faktor_faktor_entfernt` with both actor and
   subject, and notifies the account owner.
2. **Single-use recovery codes (placeholder).** Behind the interface
   `ZweiFaktorWiederherstellung` in `src/server/auth/two-factor.ts`, backed by a table
   `mfa_wiederherstellungscode (benutzer_id, code_hash bytea, verwendet_am timestamptz,
   erstellt_am timestamptz)` that is **not created** until the question below is answered. The code
   count, length and re-issue rule are client policy, not a default.

```
// TODO(client, O-83): How many super_admin accounts will exist, who physically holds the second
// factor for each, and what is the documented break-glass procedure when the sole holder loses
// both device and access? (The platform does not require two super_admins on its own authority —
// that would be an invented governance rule.)
// TODO(client, O-83): Should the platform additionally issue single-use recovery codes at 2FA
// enrolment — how many, and who may re-issue them?
// TODO(client, O-84): Grace period for 2FA enrolment on admin accounts that exist before enforcement
// goes live — how many days, and on expiry does the account lock or does the role fall back to
// `leitung`?
```

---

## 4. Sessions

### 4.1 Why the platform keeps its own session record

The Supabase access token is a bearer JWT with a fixed lifetime. It cannot carry the active mandant
(invariant 3 forbids client-held tenant state), it cannot be revoked before expiry, and it cannot be
invalidated when a right binding changes. So `benutzer_sitzung` is the server-side record and the
JWT establishes only *who* and *at what assurance level*.

| Cookie | Contents | Attributes |
|---|---|---|
| `sb-*` (Supabase, via `@supabase/ssr`) | Supabase access + refresh token | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| `__Host-cse_sitzung` | 32 random bytes, base64url — an opaque handle carrying no data | `HttpOnly; Secure; SameSite=Lax; Path=/` — the `__Host-` prefix forbids `Domain` and any non-`/` path |

`benutzer_sitzung.token_hash` stores `encode(sha256(handle), 'hex')`; lookup is by hash, so a
database dump yields no usable handles. A 256-bit random handle has no searchable preimage set,
which is why it may be stored as a plain SHA-256 while a six-digit OTP may not (§3.1).

SEC-A7: `Strict-Transport-Security` (2 years, `includeSubDomains`, `preload`), `X-Frame-Options:
DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` and a
nonce-based CSP with no `unsafe-inline`, set in `next.config.ts` and in `middleware.ts` for the
per-request nonce. `tests/e2e/auth/headers.spec.ts` asserts them on a public page, an auth page and a
portal page.

### 4.2 `benutzer_sitzung` — the auth-relevant contract

The column list is owned by `02-datenmodell/01-KERN.md` §6.9. What this document fixes is the
meaning of four of them, because the tenancy model rests on them:

| Column | Type | Contract |
|---|---|---|
| `token_hash` | `text` UNIQUE | SHA-256 of the cookie handle. The raw handle is never stored, logged or audited |
| `aktiver_mandant_id` | `uuid` NULL | **the only authoritative source of the active tenant** (TEN-04, invariant 3, K-02) |
| `ansicht` | `sitzung_ansicht` | `mandant` \| `gruppe` \| `person` \| `kunde` — **the four scopes of K-18**, and the source of the `app.scope` GUC (§8.3). `CHECK ((ansicht = 'mandant') = (aktiver_mandant_id IS NOT NULL))`, so all three multi-tenant scopes have no active mandant by construction |
| `aal` | `sitzung_aal` | `aal1` \| `aal2`, refreshed from the verified Supabase session on every resolve — never trusted from a prior request |

Every timestamp on the row is `timestamptz` stored UTC and rendered `Europe/Berlin` (invariant 2):
`erstellt_am`, `letzte_aktivitaet_am`, `ablauf_am`, `mandant_gewechselt_am`, `beendet_am`. Ending a
session sets `beendet_am` and `ende_grund`; there is no `DELETE` policy — sessions are part of the
security record (invariant 8).

Trigger `sitzung_mandant_pruefen` asserts that `aktiver_mandant_id` lies in
`app.switcher_mandanten()` of the session's user, so a tampered cookie cannot activate a foreign
area even if the application layer were bypassed entirely.

### 4.3 Lifetimes are configuration, not constants

| Portal | Idle | Absolute | Why it is a placeholder |
|---|---|---|---|
| `intern` | **PLACEHOLDER** | **PLACEHOLDER** | shared office machines argue short; a finance context argues shorter still |
| `mitarbeiter` | **PLACEHOLDER** | **PLACEHOLDER** | a personal phone on a building site cannot re-type a password (EMP-01), but a lost phone is an unrevoked login |
| `kunde` | **PLACEHOLDER** | **PLACEHOLDER** | — |

Values live in the `einstellung` store and are read by `app.einstellung(schluessel)`; none is
compiled in. `app.sitzung_aufloesen` (K-08) stamps `letzte_aktivitaet_am` **in the same statement
that validates the session**, so a session cannot be validated and then silently not refreshed.

```
// TODO(client, O-79): Idle timeout and absolute lifetime per portal. In particular the worker portal:
// how long may a phone stay logged in without re-authenticating, and what is the device-loss
// revocation process — who calls whom, and who may revoke?
```

Sessions are revoked (`beendet_am` set, `ende_grund` recorded) on: logout; password change (all
other sessions of that account); any 2FA factor change; any role, module or membership change; a
change to `person.mobil_e164`; deactivation of the `benutzer`; the end of the last live `anstellung`
of a worker **whose only memberships are `aus_anstellung = true`** (K-14 — a manually granted role
survives, and so does the session it authorises); and by `system.sitzung_widerrufen` from the
administration UI.

### 4.4 Establishing the active mandant (AUT-04, TEN-04, TEN-06)

```
login succeeds
  └─ memberships := app.switcher_mandanten() for this benutzer
       ├─ 0 memberships and no global role
       │      → no context; 403 "Kein Bereich zugewiesen"; audited as auth.kein_bereich
       ├─ exactly 1 → aktiver_mandant_id := that mandant; no switcher rendered (TEN-06, DESIGN §6 rule 1)
       └─ n > 1     → land on /auth/bereich. Nothing is auto-selected. The membership flagged
                      benutzer_mandant.ist_standard is offered first; it is a hint, never an
                      automatic choice.
```

Switching is an explicit, authenticated, audited **POST** and is the only writer of the active
mandant (`src/server/auth/switch-mandant.ts`):

```
POST /api/sitzung/mandant      body: { mandantSlug: string } | { gruppe: true }
  1. requireSession()
  2. resolve slug -> mandant; unknown slug            -> notFound()   (404, never 403 — AUT-06)
  3. assert a live benutzer_mandant row exists, or a global role; absent -> notFound()
  4. derive the portal from the TARGET membership's role                (K-04)
  5. update benutzer_sitzung: aktiver_mandant_id, ansicht, mandant_gewechselt_am
  6. audit: TWO mirror rows via app.protokolliere — one keyed to the old mandant_id, one to the
     new, each carrying mandant_id_alt and mandant_id_neu                (TEN-09)
  7. redirect('/portal/<slug>')                                          (DESIGN §6 rule 6)
```

Step 6 exists because a switch spans two entities by definition: a single row keyed on one
`mandant_id` is invisible in the other entity's audit view, and TEN-09 promises *every* switch is
recorded.

Group entry sets `ansicht = 'gruppe'`, `aktiver_mandant_id = NULL`, and is audited as
`sitzung.gruppenansicht_geoeffnet`. The switcher counters (TEN-10) are read through
`app.mandant_kennzahlen()`, restricted to `app.switcher_mandanten()` and filtered by the viewer's
own read rights, so the dropdown never advertises records the viewer could not open.

### 4.5 The `[mandant]` path segment is routing, never authority (K-02, K-07)

`/portal/[mandant]/…` exists so URLs are shareable, bookmarkable and legible, and so the shell can
paint the right identity hue on first paint (TEN-07). It is **user input**, validated against the
session and never trusted. The rule is implemented once, in the `[mandant]` layout, and used by every
page, handler and action beneath it:

| Case | Behaviour | Status |
|---|---|---|
| slug equals the active mandant's slug | proceed | 200 |
| slug is `gruppe` and `ansicht = 'gruppe'` | proceed in the read-only group context | 200 |
| slug is `gruppe`, `ansicht <> 'gruppe'`, user has ≥ 2 switcher mandanten | render the switch interstitial with a POST button: *"Sie arbeiten gerade in CSE Dienstleistung. Zur Gruppenübersicht wechseln?"* | 200 |
| slug is `gruppe`, `ansicht <> 'gruppe'`, user has exactly 1 membership and no group right | `notFound()` — DESIGN §6 rule 1 gives a single-area user no group entry at all | **404** |
| slug is a mandant the user **is** a member of, but not the active one | the same interstitial for that area. **A GET never switches the tenant.** Audited as `sitzung.wechsel_angeboten` | 200 |
| slug is a mandant the user is **not** a member of | `notFound()` | **404** |
| slug does not exist in `mandant` | `notFound()` | **404** |
| slug is a reserved segment (`mein`, `kunde`, `gruppe`, `api`) | handled by its own route; never resolved as a mandant | — |
| no session | redirect to `/auth/login?weiter=<path>` | 302 |

The interstitial rather than an automatic redirect is the whole point: if a GET could change the
active tenant, the URL *would be* tenant state, and a mis-pasted link would silently move a manager
into another GmbH — which is the mistake D-10 and DESIGN §6 exist to prevent. **404, not 403** on a
foreign slug (AUT-06): a 403 confirms the entity exists and that the user is not in it.

Reserved-slug protection is K-07's: `mandant.slug` carries a `CHECK` excluding `gruppe`, `mein`,
`kunde` and `api`, and a CI test walks the App Router tree and fails when a new static segment is
added under `/portal` without being added to the constraint. TEN-08 promises a fifth area needs a DB
row and no code change; a hand-maintained list with no test does not deliver that.

**Data loaders never receive the slug.** Every service takes a `SessionContext` whose `mandantId`
came from the session row. An ESLint rule forbids `params.mandant` outside the `[mandant]` layout,
and `tests/invariants/session-context.test.ts` asserts a single construction site for
`SessionContext` and that no file under `src/server/**` reads `params`.

---

## 5. The worker login and the three session-less capabilities

### 5.1 One login per person (EMP-01, EMP-14, D-09)

```
person                                   the human (D-09) — identity, contact, language
  ├── person.mobil_e164                  THE single mobile number in the system
  ├── person.sprache                     THE master for portal UI, SMS text and worker documents
  └── mitarbeiter_zugang                 1:1 on person_id — never on anstellung_id
        ├── benutzer_id  → benutzer      → auth.users (phone identity, no password)
        └── benutzer_mandant             ← DERIVED from live anstellung rows (K-14)
```

**The review's B16 is correct and is fixed at the source.** `sprache` and the mobile number are
facts about the human and stay on `person` (D-09 states the row explicitly; invariant 9 states the
rule). Two consequences the draft got wrong: a person with no `mitarbeiter_zugang` — a candidate, a
new hire entered by HR, a Leitung whose SMS path is disabled — would have had no language at all, so
EMP-12 and every notification to them lost their locale; and two E.164 columns for one fact with no
stated master is how an OTP goes to the old number after HR updates the record. There is exactly one
number, `person.mobil_e164`, with
`person_mobil_uk UNIQUE (mobil_e164) WHERE mobil_e164 IS NOT NULL AND anonymisiert_am IS NULL`.

`mitarbeiter_zugang` keeps only login and consent facts: `person_id` (unique — one login per human),
`benutzer_id` (unique, `CHECK (status <> 'aktiv' OR benutzer_id IS NOT NULL)`), `status`,
`einladung_token_hash`, `einladung_gueltig_bis`, `einladung_verwendet_am`, `einladung_verwendet_ip`,
`datenschutz_hinweis_am`, `geolokalisierung_hinweis_am`, `deaktiviert_am` — every time value
`timestamptz` (invariant 2). There is **no** second `auth_user_id` on it (review MINOR): the auth
identity is reached through `benutzer`, and `zugang_benutzer_konsistenz` asserts
`benutzer.person_id = mitarbeiter_zugang.person_id` so a login can never point at another human.

**Invitation is not on the K-08 register**, and does not need to be. K-08 is a **closed register of
five** functions — `app.sitzung_aufloesen`, `app.versuch_protokollieren`, `app.checkin_verbrauchen`,
`app.offline_ereignis_annehmen`, `app.ical_feed_lesen` — and the route-manifest test fails the build
on any sixth. Invitation stays off it: the invitation link opens Supabase phone verification; that
produces an authenticated session; activation then runs *inside* it, as a single-use conditional
write (K-09):

```sql
-- app.zugang_aktivieren(p_token_hash text) returns uuid   -- the person_id
update public.mitarbeiter_zugang z
   set benutzer_id = app.aktueller_benutzer(), status = 'aktiv',
       einladung_verwendet_am = now(), einladung_verwendet_ip = inet_client_addr(),
       einladung_token_hash = null
 where z.einladung_token_hash = p_token_hash
   and z.benutzer_id is null and z.status = 'eingeladen'
   and z.einladung_gueltig_bis > now()
   and exists (select 1 from public.person p join auth.users u on u.id = app.aktueller_benutzer()
                where p.id = z.person_id and p.mobil_e164 = u.phone)   -- bound to the phone
returning z.person_id;
```

**Zero rows returned is the 409** (K-09). Pre-checks may exist to produce a friendlier message, never
to decide. Concurrency test: N simultaneous redemptions of one invitation activate exactly one
access. Staff and customer invitations use the same shape — a `benutzer` row at
`status = 'eingeladen'` plus Supabase's own invite link, and `kunde_zugang.status = 'eingeladen'`
respectively — so no separate `einladung` table exists (review MISSING).

**When one human is both a worker and a manager.** They hold one `benutzer` with `person_id` set and
both a `mitarbeiter` (derived) and a `leitung`/`admin` (manual) membership. Because the strongest
role determines the credential requirement, that account authenticates with e-mail + password (plus
TOTP where the role requires it), and the SMS-only path is disabled for it
(`mitarbeiter_zugang.status = 'gesperrt'`, reason `rolle_erfordert_passwort`). They still reach the
worker portal from that same session, in `portal = 'mitarbeiter'` context, where they see only their
own rows.

```
// TODO(client, O-88): Confirm — a Leitung or Admin who is also employed logs in with e-mail +
// password (+2FA where required) and reaches the worker portal from that same login; the
// SMS-only login is disabled for those people. Correct?
// TODO(client, O-82): Which EU-hosted SMS gateway delivers the OTP and the check-in link (DPA
// required, D-04), and what monthly spend cap triggers a hard stop? No provider is chosen
// (K-17) and the interface `SmsGateway` ships marked "nicht verbunden" until one is.
// TODO(client, O-87): On `austritt`, is the worker login disabled immediately, or kept for N days so
// the person can still download their Stundennachweise (EMP-06)?
```

### 5.2 What a worker session grants

- `portal = 'mitarbeiter'`, `app.person_id` set from `benutzer.person_id`. Reads run under
  **`withPersonScope`** — `app.scope = 'person'`, `app.mandant_id` NULL, `app.mandant_ids` derived
  server-side from the person's live `anstellung` rows — so shifts from all entities appear in one
  list, each labelled with its entity (EMP-14), and `app.readonly = 'on'` for that transaction.
  **Not `withGroupScope`** (K-18): the group policy of K-03 requires `gruppe.<modul>.lesen`, a
  management right a cleaner will never hold, so a worker routed through group scope reads zero rows
  — and widening that right to fix it would hand every cleaner a group-level read of the platform.
  The rows come from the `t_person` policies of §8.5, keyed on the subject.
- **Writes narrow to exactly one mandant.** `withAnstellung(anstellungId, fn)` resolves the mandant
  *from the record*, never from the caller, and opens an ordinary single-mandant transaction. Raising
  a `zeit_einwand` against a `zeiteintrag` of the `security` employment executes with
  `app.mandant_id` = SSE Security. Invariant 10 admits no exception for workers.
- `stundenkonto` stays per employment (EMP-15); the combined view is a read across employments and
  computes nothing — every figure comes from a tested service (invariant 6).
- **EMP-13 is structural, not a permission.** The `mitarbeiter` role holds none of `crm`, `angebot`,
  `kalkulation`, `auftrag`, `abrechnung`, `finanzen`, `personal`, and the restrictive ceilings of
  §8.5 make the rows unreachable even if a binding were mis-set.
- Self-access — own hours, own certificates, own absences, own objection, own acknowledgement — is a
  **policy branch keyed on `app.aktuelle_person()`, not a right** (§7.5).

### 5.3 The check-in token is not a session (TIM-07, TIM-08, K-08, K-09)

| | Worker session (EMP-01) | Check-in link (TIM-07) |
|---|---|---|
| Authenticates a person | yes — phone + SMS code | **no. It authenticates nothing.** |
| Represented by | `benutzer` + `benutzer_sitzung` + `__Host-cse_sitzung` | one `checkin_token` row; the secret exists only in the URL |
| Sets a cookie | yes | **never** — the response carries no `Set-Cookie` |
| Actor in `audit_log` | `akteur_art = 'mensch'`, the worker's `benutzer` | `akteur_art = 'mensch'`, the worker's `benutzer` **resolved from the assignment**, never from anything the browser sent |
| Grants | the worker's right set across employments | exactly one act on exactly one `einsatz_zuordnung`: `checkin` or `checkout` |
| Lifetime | §4.3 | shift window ± tolerance, **single use** |
| Reachable data | per rights and ceiling | nothing. No list endpoint, no navigation, no second record |
| DB role | `cse_app` | `cse_checkin`, holding `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` and nothing else (K-01, K-08) |

The check-in path has no session, so it has no GUCs, so every K-03 policy evaluates false for it —
which is exactly why it does no table access of its own. It calls one function, which derives
`mandant_id`, `anstellung_id` and `person_id` from the token's assignment (K-08):

```sql
app.checkin_verbrauchen(p_token_hash text, p_geraete_zeit timestamptz,
                        p_ip inet, p_user_agent text, p_geo jsonb default null)
  returns table (ergebnis text, zeiteintrag_id uuid, objekt text, beginn timestamptz)
-- SECURITY DEFINER, owner cse_definer, SET search_path = pg_catalog, public   (K-01)
```

**Consumption is one conditional write, and zero rows is the 409** (K-09, review B7):

```sql
update public.checkin_token
   set eingeloest_am = now(), ip_adresse = p_ip, user_agent = p_user_agent
 where token_hash = p_token_hash
   and eingeloest_am is null and widerrufen_am is null
   and now() between gueltig_ab and gueltig_bis
returning *;
-- not found -> app.versuch_protokollieren(...) and ONE generic 'abgelehnt' result
```

The `zeiteintrag` is written in the same transaction, only if a row came back. `beginn_zeitpunkt` is
`now()` — the **server clock** (invariant 5, TIM-08); the phone's reading goes to
`geraete_zeit_beginn` and `zeitabweichung_beginn_sek` is derived from it. Check-then-act is a race,
and a worker double-tapping a link on a slow connection is not an edge case: a duplicated
`zeiteintrag` is duplicated billable time (FIN-07, TIM-12) and a duplicated §17 MiLoG record.
**Concurrency test: N simultaneous requests against one token yield exactly one `zeiteintrag`.**

Two corrections to the draft, both from the review's MINOR list:

- The claim "single indexed lookup; **constant-time compare**" is deleted. An index probe on the hash
  is not constant time and the hash *is* the lookup key, so the phrase asserts a mitigation that does
  not exist. The real controls are the 256-bit token (no exploitable timing margin), one generic
  result shape for every failure, and the rate limiter of §10.
- The actor is **not** `system`. A check-in is a human act and the token resolves to
  `einsatz_zuordnung → anstellung → person → benutzer`, so the audit row names that human. Recording
  it as `system` would make a worker's check-in indistinguishable from a cron job and weaken the §17
  MiLoG and EMP-07 evidentiary record.

`checkin_token` carries no `INSERT`/`UPDATE`/`DELETE` policy for `cse_app` at all: issue runs through
`app.checkin_ausgeben(...)`, redemption through `app.checkin_verbrauchen`, and a column grant
withholds `token_hash` from `cse_app` entirely — a planner screen never needs it and a `select *`
from a debugging session must not hand out the lookup key. The full token is never written to the
database, to logs or to the audit trail; support lookups use `token_praefix`, whose length is a
configured value (§20), not a constant chosen here.

Geolocation at check-in is written only when `app.einstellung('zeit.geolokalisierung')` is on, is
limited to exactly two points per record by the absence of any table in which a third could be
stored, and requires `mitarbeiter_zugang.geolokalisierung_hinweis_am` on every affected worker
(LEG-10). It is blocked on O-06.

### 5.4 Late and offline submission (TIM-09)

The draft's §5.3 actively contradicted TIM-09: a phone that lost signal at 06:00 cannot present its
link at 09:00, because the window check and the single-use check both reject it. The resolution is a
distinct path, not a widened window (`02-datenmodell/04-PLANUNG-ZEIT.md` §9.4):

1. The device replays queued events to
   `app.offline_ereignis_annehmen(p_token_hash, p_ereignisse, p_ip)` under `cse_checkin` — the
   fourth entry on K-08's closed register, sanctioned there because it is check-in data arriving
   late over the same token: same subject, same authentication, same conditional-write discipline
   (K-09). Splitting it onto a different mechanism would mean two trust boundaries for one fact.
2. The **arrival** is server-authoritative (`empfangen_am`) and is what "late" is measured against.
3. The **claim** is recorded (`behauptete_zeit`, plus the byte-faithful payload and its hash) and is
   never an authoritative instant on its own (invariant 5).
4. `client_ereignis_id` + `geraet_id` make replay idempotent: a flapping connection produces one row,
   not two shifts.
5. Otherwise the row waits in the planner's queue. Promotion is
   `app.offline_uebernehmen(p_ereignis, p_beginn, p_ende, p_begruendung)`, which requires the right
   **`zeit.nacherfassung_pruefen`**, writes `quelle_* = 'planer_entscheidung'`, `nacherfasst = true`,
   and writes the `zeiteintrag_korrektur` row in the same transaction (TIM-11).

So a purely offline shift produces no `zeiteintrag` until a human decides, and the hourly "shift
ended, no `zeiteintrag`" watchdog surfaces it. A record a planner created from a worker's written
claim is defensible in a wage dispute; a record whose start time the platform accepted from an
unauthenticated phone is not.

### 5.5 Uploads on the session-less path (TIM-10, DOC-06)

`app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` are the only **write** paths in the
platform with no session behind them — the other three entries on K-08's closed register are a
session resolve, a rate-limit write against no principal, and a read-only feed — so their upload
rules are stated here rather than assumed:

| Control | Rule |
|---|---|
| Content types | server-side allowlist — `image/jpeg`, `image/png`, `image/heic`, `video/mp4`; sniffed from the bytes, never from the declared header (DOC-06) |
| Size | a configured per-file and per-request cap (`app.einstellung('medien.max_bytes')`), enforced before the body is buffered |
| EXIF | stripped server-side on ingest, including GPS, before the object is stored (TIM-10) |
| Storage | private bucket only; the path is never returned to the client (DOC-03, SEC-A6) |
| Rate | counted by `app.versuch_protokollieren` under the `checkin` kind (§10) |
| Audit | `medien.hochgeladen` with `akteur_art = 'mensch'` and the resolved `person_id` |

### 5.6 The iCal feed token (CAL-03)

`benutzer_feed_token (id, benutzer_id, zweck, token_hash, letzte_nutzung_am, widerrufen_am,
erstellt_am, erstellt_von)` — `zweck = 'ical'`, one live token per user and purpose, SHA-256 of a
256-bit value, the raw value shown exactly once.

**The feed is the fifth entry on K-08's closed register**, and this document previously said the
opposite. The earlier design — resolve the token, then open a `withGroupScope` transaction for that
principal — is wrong twice under the amended conventions. It is wrong under K-08, because resolving
a bearer token against a table before any principal exists *is* a pre-session database path however
it is dressed up, and K-08 now names it rather than leaving it to a domain document to sanction. And
it is wrong under K-18: a personal calendar feed is a **person**-scope read, and K-03's group policy
demands `gruppe.kalender.lesen`, a management right the holder will not have — the feed would have
returned zero events for every worker it exists for.

```sql
app.ical_feed_lesen(p_feed_token_hash text)
  returns table (uid text, beginn_utc timestamptz, ende_utc timestamptz,
                 titel text, ort text, geaendert_am timestamptz)
-- SECURITY DEFINER, owner cse_definer, SET search_path = pg_catalog, public   (K-01, K-08)
-- EXECUTE granted to cse_anon and to no other role.
```

It resolves `benutzer_feed_token` to one `benutzer_id`, refuses a revoked or unknown token with one
generic empty result, stamps `letzte_nutzung_am` in the same statement that validates the token, and
returns **only that user's own** `kalender_eintrag` rows. It is read-only by construction — there is
no write path on the register entry at all — it exposes no mandant switch, it returns no
`mandant_id`, no `kunde`, no colleague and no `objekt` the holder could not read interactively, and
it is rate-limited under `art = 'feed'` (§10). Rotation and revocation are self-service plus
`system.feed_token_widerrufen` for an administrator. Every issue, use-after-revocation and revocation
is audited.

Because it runs as the definer under FORCE RLS, `benutzer_feed_token` and `kalender_eintrag` both
carry a narrow `cse_definer` read policy and both are named in the definer registry of §8.2 — without
that the function reads zero rows and the feed is empty with no error, which is the failure mode K-01
warns about.

### 5.7 Signed storage URLs (DOC-03, DOC-04, SEC-A6)

Objects live under `dokument/<mandant_id>/<jahr>/<dokument_id>/<version>.<ext>` in private buckets. A
signed URL (15 minutes, DOC-03) is minted **only** by `dokumentService.signierteUrl(ctx, id)`, after
`dokument.lesen` has been checked, the ceiling has applied and the row has actually been read through
RLS. Customer visibility additionally requires `dokument.sichtbar_fuer_kunde = true` (default `false` —
deny by default) and a matching `kunde_id`. List endpoints never return URLs for rows the caller
cannot read, and never return the storage path.

---

## 6. AUT-04 / SEC-A1 — the server-side authorization pipeline

### 6.1 Every request, without exception

```
request
  │
  ├─ middleware.ts ················· cheap redirects + CSP nonce. NOT a security boundary.
  │
  ├─ resolveSession() ·············· cookie -> app.sitzung_aufloesen (K-08) -> SessionContext
  │      └─ throws AuthError | MfaRequiredError | AccountLockedError
  │
  ├─ [mandant] layout ·············· slug validated against the session (§4.5) -> notFound()
  │
  ├─ authorize(recht) ·············· catalogue lookup -> effective set for (benutzer, mandant)
  │      └─ throws PermissionError | MfaRequiredError | NotFoundError
  │
  ├─ Zod parse of params / query / body ····· SEC-A4, at the boundary, before the service
  │
  ├─ service(ctx, input) ··········· src/server/services — pure, tested, no HTTP
  │      └─ one of the seven session helpers (§6.3) opens the transaction and sets the GUCs
  │             └─ RLS evaluated ··· the second line of defence (K-03, K-04)
  │
  └─ toHttpResponse(...) ··········· one mapper, one error taxonomy (§9)
```

`mandant_id` is **never accepted from an input schema**. It is written by the schema default or set
by the service from the session context; `tests/isolation/db/write-check.test.ts` asserts that an
INSERT and an UPDATE carrying a foreign `mandant_id` both raise.

### 6.2 The contract

```ts
// src/server/auth/typen.ts — the design contract, not an implementation

export type RolleSchluessel = 'super_admin' | 'admin' | 'leitung' | 'mitarbeiter' | 'kunde' | (string & {});
export type Portal          = 'intern' | 'mitarbeiter' | 'kunde';           // the K-04 ceiling
export type Scope           = 'mandant' | 'gruppe' | 'person' | 'kunde';    // K-18; = app.scope
export type Ansicht         = Scope;   // benutzer_sitzung.ansicht IS the scope — one vocabulary

/** `<modul>.<aktion>` or `<modul>.<objekt>_<aktion>`; the union is generated from the seed. */
export type RechtSchluessel = `${string}.${string}`;

export interface Principal {
  readonly benutzerId: string;          // = auth.users.id
  readonly personId: string | null;     // D-09: the human, not an employment
  readonly istDienstkonto: boolean;     // service principals are never issued a session
  readonly aal: 'aal1' | 'aal2';
  readonly sitzungId: string;
  readonly akteurTyp: 'mensch' | 'agent' | 'system';   // audit only (SEC-A9), never authorisation
  readonly ip: string | null;                          // audit only
}

interface BasisKontext {
  readonly principal: Principal;
  readonly portal: Portal;                       // derived by app.portal_fuer (K-04)
  readonly sichtbareMandanten: readonly string[];
  hat(recht: RechtSchluessel, mandantId: string): boolean;   // mirrors app.hat_recht (K-03)
}

/** Exactly one active mandant. The only context that may write. */
export interface MandantKontext extends BasisKontext {
  readonly kind: 'mandant';
  readonly readonly: false;
  readonly mandantId: string;
  readonly mandantSlug: string;
  readonly rolle: RolleSchluessel;
}

/**
 * The three multi-tenant scopes of K-18: TEN-05 group view, the worker cross-employment read,
 * and the customer portal read. Never writes.
 *
 * `scope` replaces the draft's `grund`. That is not a rename: `grund` was a TypeScript-only
 * discriminator, so the database could not tell an employee-portal read from a group-view read
 * and had exactly one multi-tenant policy — K-03's `t_gruppe`, which demands a management right.
 * `scope` is written into the `app.scope` GUC, which is what lets Postgres apply `t_person` or
 * `t_kunde` instead (K-18, §8.5).
 */
export interface MehrmandantKontext extends BasisKontext {
  readonly kind: 'mehrmandant';
  readonly readonly: true;
  readonly mandantIds: readonly string[];
  readonly scope: 'gruppe' | 'person' | 'kunde';    // -> app.scope, set by the session helper
}

export type TenantKontext   = MandantKontext | MehrmandantKontext;
export type WritableKontext = MandantKontext;      // structural: the union excludes the rest

// --- entry points. Every route handler and server action calls exactly one. -------------------

export function requireSession(): Promise<Principal>;

/** Internal portal, one active mandant. Throws before it returns anything useful. */
export function requireMandant(recht: RechtSchluessel): Promise<MandantKontext>;

/** TEN-05 read-only group context. Rejects any right whose aktion is not lesen/exportieren. */
export function requireGruppeLesend(recht: RechtSchluessel): Promise<MehrmandantKontext>;

/** Worker portal. Cross-employment READ context (EMP-14, EMP-15). `person` scope, read-only by type. */
export function requireSelbst(): Promise<MehrmandantKontext & { scope: 'person' }>;

/** Customer portal. `kunde` scope (CRM-06). READ-ONLY by type — see below. */
export function requireKunde(recht: RechtSchluessel): Promise<MehrmandantKontext & { scope: 'kunde' }>;

/** APR-*: an approval may never be granted by an agent or by a job (invariant 7, APR-07). */
export function requireMensch(ctx: TenantKontext): asserts ctx is TenantKontext & {
  principal: Principal & { akteurTyp: 'mensch' };
};

/** AUT-02 step-up for a single act, where berechtigung.erfordert_2fa is set (K-15). */
export function requireAal2(ctx: TenantKontext): void;

// --- narrowing and writing -------------------------------------------------------------------

/** Invariant 10 as a type: a write needs exactly one mandant. */
export function assertWritable(ctx: TenantKontext): asserts ctx is WritableKontext;
```

**The review's B15 is correct.** `requireKunde` returning a `MandantKontext` made every customer
context assignable to every mutating service signature, so the compile-time guard did nothing for the
customer portal — while the question of whether a customer may write anything at all is open and
carries legal effect (OPS-09, "accepted offer converts to order in one action"). `requireKunde`
therefore returns a **read-only** context. A customer write, when the client authorises one, is an
individually named door:

```ts
/** Per-action customer write. Resolves the mandant FROM THE RECORD, never from the caller. */
export function withKundenVorgang<T>(
  ctx: MehrmandantKontext & { scope: 'kunde' },
  aktion: KundeSchreibaktion,          // a closed union — today it is `never`
  vorgangId: string,
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T>;
```

`KundeSchreibaktion` is `never` until O-74 (§20) is answered. Adding a member to it is a deliberate,
reviewable act, not a consequence of a type widening.

Service convention (services are pure, tested, no HTTP):

```ts
// src/server/services/rechnung/festschreiben.ts
export async function rechnungFestschreiben(
  ctx: WritableKontext,                     // compile-time: no group, worker or customer context
  input: { rechnungId: string },
): Promise<Rechnung> { … }
```

Route handler and server action share one wrapper, because a server action is a public HTTP endpoint
with a generated name and must never be treated as internal:

```ts
// src/app/portal/[mandant]/rechnungen/[id]/festschreiben/route.ts
export const POST = handler({
  recht:  'finanzen.festschreiben',
  params: z.object({ mandant: z.string(), id: z.string().uuid() }),
  body:   FestschreibenSchema,                                    // SEC-A4
  run:    ({ ctx, params, body }) => rechnungFestschreiben(ctx, { rechnungId: params.id, ...body }),
});
```

### 6.3 The seven session helpers, and no eighth (K-08, K-18)

Every database access runs inside exactly one of these. The **five** functions of K-08's closed
register are the only code that reaches Postgres outside them, and
`tests/invariants/route-manifest.test.ts` asserts it — walking every route, action, job and script
and failing on a database call that is neither inside a helper nor on the register.

| Helper | `app.scope` | `app.mandant_id` | `app.mandant_ids` | `app.readonly` | Role | Used by |
|---|---|---|---|---|---|---|
| `withTenant(ctx, fn)` | `mandant` | exactly one | — | `off` | `cse_app` | `/portal/[mandant]/**`, its actions, most of `api/` |
| `withGroupScope(ctx, fn)` | `gruppe` | NULL | the readable set | `on` | `cse_app` | `/portal/gruppe/**` — **and nothing else** |
| `withPersonScope(ctx, fn)` | `person` | NULL | derived from the person's live `anstellung` rows | `on` | `cse_app` | every read in `/portal/mein/**` |
| `withKundeScope(ctx, fn)` | `kunde` | NULL | derived from the login's live `kunde_zugang` rows | `on` | `cse_app` | every read in `/portal/kunde/**` |
| `withAnstellung(ctx, anstellungId, fn)` | `mandant` | resolved from the `anstellung` | — | `off` | `cse_app` | every write in `/portal/mein/**` |
| `withKundenVorgang(ctx, aktion, vorgangId, fn)` | `mandant` | resolved from the record | — | `off` | `cse_app` | every write in `/portal/kunde/**` (today: none) |
| `withSystemTenant(mandantId, grund, fn)` | `mandant` | explicit | — | `off` | `cse_job` | jobs, scripts, agent runs, public form intake |

**`withPersonScope` and `withKundeScope` are new, and they are structural, not convenience** (K-18).
The draft routed both portals through `withGroupScope`, which is a category error with a concrete
consequence: under `app.scope = 'gruppe'` the only permissive `SELECT` policy that can match is
K-03's `t_gruppe`, and it requires `gruppe.<modul>.lesen` — a management right the seeded matrix
gives neither `mitarbeiter` nor `kunde` (§12). **Both portals would have read zero rows**, and the
obvious repair — granting the group right to those two roles — would have handed every cleaner and
every customer a group-level read of every table not covered by a K-04 ceiling. The two portals do
span tenants (EMP-14, CRM-06), but they span them **as the subject**, which is a different policy,
not a wider right (§8.5).

In all three multi-tenant scopes `app.mandant_ids` is **derived server-side** — from
`benutzer_mandant`, from `anstellung`, or from `kunde_zugang` — and never taken from the request
(K-02, K-18). All three additionally issue `set transaction read only`.

`withSystemTenant` is a constructor, not a bypass: it builds a synthetic `SessionContext`
(`akteurTyp = 'system'` or `'agent'`, the service principal as `benutzer_id`) and goes through the
same GUC-setting path. `grund` is mandatory, is a literal never derived from a request body, and is
written to `audit_log`. Containment comes from `cse_job`'s enumerated per-job grants and policies
(K-01), not from the portal GUC.

### 6.4 Mechanically guaranteeing "every route" (AUT-04, SEC-A1)

Three CI controls, none skippable:

1. **Lint rule `cse/route-needs-recht`** — every `export const GET|POST|PUT|PATCH|DELETE` under
   `src/app/**/route.ts` must be produced by `handler()`, and every `"use server"` export by
   `action()`.
2. **Route-manifest test** — walks the App Router tree, asserts each route resolves to a declared
   `recht` (or to the explicit `oeffentlich: true` allowlist for the public and auth segments), and
   emits the manifest as a build artefact. A new route without a right fails the build.
3. **Tenant-isolation suite** (SEC-A3, §17) runs against that manifest, so a new route is covered by
   the isolation assertions the day it appears.

---

## 7. AUT-03 — the permission model as data

Nothing about a right is hard-coded in a page or a component. The **catalogue** is seeded by
migration (a module must exist in code before it can be granted); the **bindings are data and are
edited in the UI**, so a permission change or a fifth mandant needs no deploy (TEN-08).

### 7.1 Tables

| Table | Purpose | Key columns | SPEC |
|---|---|---|---|
| `rolle` | the five system roles plus mandant-specific roles | `schluessel`, `geltungsbereich`, `portal`, `erfordert_2fa`, `ist_system`, `archiviert_am` | AUT-01, AUT-02, K-04 |
| `berechtigung` | the catalogue of rights | `schluessel` UNIQUE, `modul`, `objekt`, `aktion`, `nur_global`, `erfordert_2fa`, `risiko`, `bezeichnung` | AUT-03, AUT-05 |
| `rolle_berechtigung` | **the editable binding** — platform default (`mandant_id IS NULL`) and per-mandant override | `rolle_id`, `berechtigung_id`, `mandant_id`, `gewaehrt`, `begruendung` | AUT-03 |
| `benutzer_mandant` | membership + role + optional module restriction | `rolle_id`, `module text[]`, `aus_anstellung`, `ist_standard`, `gueltig_ab/bis`, `entzogen_am` | AUT-01, TEN-06, K-14 |
| `mandant.module` | which modules the entity has enabled | `text[]`, `'{}'` = all | TEN-08 |

**There is no `benutzer_mandant_modul` table** (review MISSING resolved by the peer data model):
the admin's module restriction is `benutzer_mandant.module text[]`, validated by trigger
`bm_module_pruefen` against `SELECT DISTINCT modul FROM berechtigung`, which also answers the
review's MINOR about free-text module names with no constraint.

**There is no `geltungsbereich` column on a binding, and no `bindbar_fuer` array.** The draft carried
both; both are replaced by two mechanisms that are enforced by the database rather than by a column
an editor could mis-set:

- *Which module* a role may act in → the right binding (`rolle_berechtigung`).
- *Whose rows* it may touch → the restrictive portal ceilings of K-04 (§8.5).
- *Whether a right may exist for a mandant role at all* → `berechtigung.nur_global`.

That is also what fixes the review's B19: `zugewiesen` scope stops being a service-layer predicate
with no database counterpart and becomes an `einsatz`-derived ceiling (§8.5).

A `berechtigung` row is never deleted; retiring a right sets `gewaehrt = false` on its bindings so
historic audit entries stay resolvable (invariant 8).

### 7.2 The key scheme

```
schluessel := <modul> '.' [<objekt> '_'] <aktion>          -- the objekt segment is elided when
                                                           -- objekt = modul
gruppe.<modul>.<aktion>                                    -- the group-scope read keys (K-03)

  crm.lesen                       modul=crm        objekt=crm        aktion=lesen
  system.benutzer_lesen           modul=system     objekt=benutzer   aktion=lesen
  personal.entgelt_lesen          modul=personal   objekt=entgelt    aktion=lesen     (K-05)
  dienstplan.arbzg_pruefen        modul=dienstplan objekt=arbzg      aktion=pruefen   (K-06)
  gruppe.finanzen.lesen           modul=gruppe     objekt=finanzen   aktion=lesen
```

`CHECK (schluessel ~ '^[a-z_]+(\.[a-z_]+){1,2}$')` and `UNIQUE (modul, objekt, aktion)`. German
verbs throughout; the scope never appears in the key.

Shared `aktion` vocabulary — the `berechtigung_aktion` enum:

`lesen · erstellen · aendern · schreiben · loeschen · exportieren · importieren · zuweisen ·
freigeben · genehmigen · entscheiden · verwalten · pruefen · melden · planen · veroeffentlichen ·
versenden · festschreiben · stornieren · korrigieren · quittieren · uebersteuern · verbinden ·
einreichen · anmelden · widerrufen`

`schreiben` exists because K-03's `WITH CHECK` clause names `<modul>.schreiben` verbatim; every
module that has any write path must carry it.

### 7.3 Effective right resolution

Four stages, deterministic, evaluated by `app.hat_recht(p_recht, p_mandant)` in the database and
mirrored by `src/server/services/berechtigung.ts` in the application:

```
1. platform default   rolle_berechtigung where mandant_id is null
2. mandant override   rolle_berechtigung where mandant_id = <the mandant being asked about>
                      — beats the default, including revoking it (gewaehrt = false)
3. user module filter  benutzer_mandant.module, when set          (AUT-01 "assigned modules")
4. mandant module filter mandant.module, when non-empty            (TEN-08)
```

with these gates applied first, in this order:

| Gate | Result |
|---|---|
| `p_mandant is null` | **false** — a right is always asked about a specific entity (K-03) |
| no live session for the principal | **false** |
| unknown key | **false**, never an error — a typo in a policy must fail closed |
| `berechtigung.erfordert_2fa` and `app.aal() <> 'aal2'` | **false** (AUT-02) |
| `app.ist_super_admin()` | **true** — skipping stages 2–4 only, never the gates above |
| `berechtigung.nur_global` and the holder is not global | **false** |
| `app.scope() <> 'mandant'` and `aktion not in ('lesen','exportieren')` | **false** — invariant 10 inside the resolver. Keyed on the scope and **not** on `ist_gruppenansicht()`, so `person` and `kunde` scope inherit it (K-18): neither portal resolves a write right at all, and neither can acquire one by a mis-set binding |

**Deny by default.** No wildcard, no inheritance between roles, no "all except" list. Absent means
forbidden.

**Caching: per request only.** The resolved set is memoised once per request and discarded with it.
There is no cross-request cache, no TTL and therefore no `mandant.berechtigung_version` column and no
cache-flush endpoint. This is the review's MINOR on stale module grants, answered by removing the
staleness rather than by adding a version bump: editing a binding takes effect on the **next
request**, which is what AUT-03 promises, and a 60-second window in which a revoked module is still
live is not something a permission system should have.

**A fifth mandant (TEN-08)** is a `mandant` row. `super_admin` reaches it through the global role
with no membership rows at all; the platform-default bindings apply to it automatically because they
carry `mandant_id IS NULL`; its module set is `mandant.module`. What the trigger must **not** do is
create a `nummernkreis` row automatically:

```
// TODO(client, O-01): is CSE Operations a legal entity or an internal department? A number
// circle belongs to a Rechtsträger (TEN-02); creating one for every mandant row would answer
// O-01 in the affirmative for every future area. `mandant.ist_rechtstraeger` is the flag, and
// its value for `operations` is unknown.
```

### 7.4 The module catalogue

`berechtigung.modul` is the assignable unit of AUT-01's "assigned modules within assigned areas". The
vocabulary is shared with the data-model documents, which name the module for every table they
define; this document owns the complete list.

| `modul` | Covers | SPEC |
|---|---|---|
| `system` | `mandant`, `mandant_identitaet`, `benutzer`, `rolle`, `berechtigung`, `benutzer_mandant`, `benutzer_sitzung`, `audit_log`, `einstellung` | TEN-01, TEN-02, TEN-08, AUT-01, AUT-03, AUT-08, SEC-A9 |
| `gruppe` | the read-only group aggregation keys | TEN-05, TEN-10, REP-01 … REP-06 |
| `oeffentlich` | the public renderer's read path | PUB-07, PRO-01 … PRO-05, REQ-01 |
| `datenschutz` | data-subject requests, erasure review, retention holds | LEG-09, LEG-11 |
| `stammdaten` | `qualifikation`, `abwesenheitsart`, `antragsart`, `belagsart`, `reinigungsklasse` | OPS-03, EMP-05, EMP-10 |
| `personal` | `person`, `anstellung`, `anstellung_kondition`, `nachweis`, `bewacher_eintrag`, `mitarbeiter_zugang` | EMP-08, EMP-14, SEC-02, SEC-03, D-09 |
| `dienstplan` | `planungsserie`, `einsatz`, `einsatz_zuordnung`, `planungs_konflikt`, `arbeitszeit_verstoss` | TIM-01 … TIM-06, TIM-14, LEG-03 |
| `zeit` | `zeiteintrag`, `zeiteintrag_korrektur`, `checkin_token`, `offline_ereignis`, `medien`, `stundenkonto`, `urlaubskonto`, `abwesenheit`, `zeit_einwand`, `antrag` | TIM-07 … TIM-13, EMP-03 … EMP-07, EMP-10, EMP-15, LEG-02 |
| `crm` | `firma`, `kunde`, `ansprechpartner`, `lead`, `lead_aktivitaet`, `kunde_zugang` | CRM-01 … CRM-08 |
| `crm_entgelt` | column-level: `kunde.zahlungsziel_tage`, `kunde.debitorennummer`, dunning block | CRM-01, FIN-15 |
| `objekt` | `objekt`, `raum` (Raumbuch) | OPS-01, OPS-02 |
| `objekt_import` | `raumbuch_import` staging | OPS-04 |
| `katalog` | `leistungskatalog` and its positions | OPS-06 |
| `formular` | `formular_definition`, `formular_zustaendigkeit`, `formular_eingang` | REQ-01 … REQ-07 |
| `angebot` | `angebot`, `angebotsposition` | OPS-08, OPS-09 |
| `kalkulation` | `kalkulation` and its positions — the margin | OPS-07 |
| `auftrag` | `auftrag`, `auftrag_leistung`, `projekt` linkage | OPS-05, OPS-10, OPS-11 |
| `abrechnung` | `vertrag_abrechnung`, `kunde_bauleistender_status`, `freistellungsbescheinigung` | FIN-01, FIN-09, FIN-10, LEG-06 |
| `reinigung` | `revier`, `revier_raum`, `turnus`, `sonderleistung` | CLN-01, CLN-02, CLN-05 |
| `nachweis` | `leistungsnachweis` and its signature | CLN-04 |
| `security` | `postenart`, `posten`, `einsatzanforderung`, `veranstaltung`, `kontrollpunkt` | SEC-01, SEC-08 |
| `dienstanweisung` | `dienstanweisung`, versions, `da_kenntnisnahme` | SEC-06, EMP-09 |
| `wachbuch` | `wachbuch_eintrag` | SEC-05 |
| `schluessel` | `schluessel`, `schluessel_quittung` | SEC-07 |
| `bau` | `leistungsverzeichnis`, `lv_position`, `aufmass`, `nachtrag`, `behinderung`, `bautagebuch`, `abnahme` | BAU-01 … BAU-08 |
| `qualitaet` | `reklamation`, `qualitaetspruefung` | OPS-11 |
| `finanzen` | `rechnung`, positions, tax lines, snapshot, hash | FIN-01 … FIN-13, LEG-01, LEG-05 |
| `versand` | `rechnung_versand` | FIN-11, FIN-12 |
| `nummernkreis` | `nummernkreis` | TEN-02, FIN-03, FIN-16 |
| `zahlung` | `zahlung`, `offener_posten`, CAMT import | ACC-04, ACC-07, FIN-14 |
| `mahnung` | `mahnstufe`, `mahnung` | FIN-15 |
| `eingang` | `lieferant`, `eingangsrechnung`, `beleg`, `ausgabe` | FIN-14, ACC-05 |
| `buchhaltung` | `periode`, `buchungssatz`, DATEV export | ACC-01, ACC-02, ACC-08, ACC-09, ACC-11 |
| `buchhaltung_konfiguration` | `datev_konfiguration`, `konto_mapping`, `verfahrensdokumentation` | ACC-01, ACC-10, O-05 |
| `dokument` | `dokument`, `dokument_version`, retention, bundles | DOC-01 … DOC-08 |
| `radar` | `ausschreibung`, `radar_profil`, `bewertung`, `vergabeplattform` | RAD-01 … RAD-09 |
| `vergabe` | `vergabemappe` | RAD-07, D-07 |
| `agent` | `agent_aufgabe`, `agent_schritt`, `agent_richtlinie`, `agent_budget` | AGT-01 … AGT-07 |
| `freigabe` | the approval inbox and its snapshots | APR-01 … APR-08, K-13 |
| `referenz` | `seite`, `referenz` — published website content | PUB-07, PRO-05 |
| `social` | `social_post`, `social_channel`, `kanal_statistik` | SOC-01 … SOC-08 |
| `recruiting` | `stelle`, `bewerbung`, `kandidat`, `gespraech` | REC-01 … REC-09, LEG-11, LEG-12 |
| `kalender` | `kalender_eintrag`, `benutzer_feed_token` | CAL-01 … CAL-03 |
| `aufgabe` | `aufgabe` | OPS-11, SPEC §14 |
| `nachricht` | `nachricht`, `benachrichtigung`, `benachrichtigung_praeferenz` | NOT-01 … NOT-03 |
| `bericht` | reporting surfaces | REP-01 … REP-07 |

**46 modules.** Adding one is a migration that inserts `berechtigung` rows plus platform-default
bindings; it is never a schema change to the permission tables.

### 7.5 Self-access is a policy branch, not a right

This is the structural answer to the review's B10, and it is stronger than the `bindbar_fuer` array
the draft used.

Four acts in the draft's matrix were marked "never bindable for anyone but the subject":
acknowledging a Dienstanweisung, raising a `zeit_einwand`, editing one's own contact details,
submitting an absence or swap request. A right is granted to a **role**, and a role is held by many
people, so expressing "only the subject may do this" as a right is a category error — and
`super_admin` resolving to the whole catalogue then hands a manager exactly the acts the matrix
declared unreachable.

Instead, these rows are reached through a permissive policy disjunct keyed on the server-set
`app.person_id` GUC, with no right involved at all:

```sql
using (   (mandant_id = app.aktiver_mandant()
           and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())))
       or person_id = app.aktuelle_person())          -- EMP-14, D-09 consequence 4
```

| Act | Table | Reached by | SPEC |
|---|---|---|---|
| Acknowledge a Dienstanweisung | `da_kenntnisnahme` | self-branch on `person_id`; the row records who acknowledged | SEC-06, EMP-09 |
| Raise an objection to a time entry | `zeit_einwand` | self-branch; **the worker never edits the entry itself** | EMP-07 |
| Report absence / request leave / request a swap | `abwesenheit`, `antrag` | self-branch, plus the right `zeit.abwesenheit_melden` for the reporting act | EMP-10 |
| Edit own contact details and language | `person` | self-branch, narrowed to a column grant | EMP-12 |
| Read own hours, own certificates, own Stundenkonto | `zeiteintrag`, `nachweis`, `stundenkonto` | self-branch | EMP-03, EMP-08, EMP-15 |

The disjunct above is the **`mandant`-scope** form, used when a worker acts through `withAnstellung`
and when a manager reads the same table. In `person` scope — the whole of `/portal/mein`'s read path
— `app.aktiver_mandant()` is NULL, so the first branch is false and the row is reached by the
`t_person` policy of §8.5 instead, which carries the same subject predicate keyed on the same
server-set GUC (K-18). One subject predicate, two policies, because the two scopes differ in how the
tenant is established and not in whose rows the caller may see.

Three properties make the disjunct safe, and all three are structural: it matches only rows whose
subject **is** the caller; `app.person_id` is a server-set GUC that no client can influence (K-02);
and the K-04 ceiling still applies on top, so a worker session cannot reach a colleague's row even if
a right were mis-granted. A manager can *decide* an objection (`zeit.einwand_entscheiden`) but can
never *raise* one, and cannot acknowledge an instruction on someone's behalf.

### 7.6 What is deliberately not a permission

| Not a right | Why | SPEC |
|---|---|---|
| overriding the §34a certificate block | SEC-04 is a **hard block in the service layer with no override path**. A right that no role may hold should not exist as a key: its existence is an invitation to bind it. An unqualified or expired-certificate guard cannot be assigned, by anyone, including a `super_admin` | SEC-04, LEG-04, D-05 |
| approving one's own agent output | `requireMensch` plus the approval chain (K-13); not expressible as a binding | invariant 7, APR-07 |
| sending externally without approval | `server/agent/policy.ts` runs **after** authorization and is not a right | invariant 7, SOC-08 |
| computing money, quantities or deadlines | a tested service does it; no right unlocks a model-authored number | invariant 6, K-10 |

Two rights that do exist and must be read together with SEC-04: `dienstplan.arbzg_uebersteuern`
acknowledges an **ArbZG warning** (TIM-06) with a written reason and an audit row — a warning, not a
block — and `dienstplan.arbzg_pruefen` (K-06) is what lets the planner query the cross-entity load at
all.

---

## 8. AUT-05 / SEC-A2 / TEN-03 — RLS that mirrors application authorization

### 8.1 Why not `request.jwt.claims`

`request.jwt.claims` is populated by PostgREST/GoTrue when a browser calls the Supabase Data API.
That API is disabled here (§3.1), so the setting simply is not present on our connections. More
importantly, the active mandant must not live in a token the browser holds: a JWT issued before a
switch would keep asserting the old tenant until it expired, and invariant 3 forbids tenant state
outside the server session. The platform therefore uses transaction-local `set_config` GUCs written
by the server from the `benutzer_sitzung` row (K-02).

### 8.2 Database roles (K-01)

Six named roles. The application never connects as `postgres`, and **no application role holds
`BYPASSRLS`**.

| Role | Used by | Holds |
|---|---|---|
| `cse_migrator` | migrations in CI | DDL. Never used at runtime |
| `cse_definer` | owner of every `SECURITY DEFINER` helper | the narrow read policies of the definer registry; the only role that may be exempt from FORCE RLS, and only on the tables K-06 and K-08 name. **Cannot log in** |
| `cse_app` | every authenticated request | DML through policy, with the column grants of K-05 |
| `cse_anon` | pre-session requests | `EXECUTE` on exactly its three rows of K-08's closed register — `app.sitzung_aufloesen`, `app.versuch_protokollieren`, `app.ical_feed_lesen`. **No table grants at all** |
| `cse_checkin` | the tokenised check-in endpoint **and its offline replay** | `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` only (K-01, K-08) |
| `cse_job` | cron, Edge Functions, agent runs | per-job grants and policies, enumerated in the job definition |

```sql
alter table <t> enable row level security;
alter table <t> force  row level security;      -- K-01: the owner is not exempt either
```

**The review's B2 is correct: the definer's owner must be named, and FORCE RLS applies to it too.**
The resolution is not a privilege but a policy. Every table a definer helper must read carries **one
narrow `cse_definer` policy**, and the list is literal (`02-datenmodell/01-KERN.md` §3.5):

```
mandant · benutzer · benutzer_mandant · benutzer_sitzung · rolle · berechtigung
rolle_berechtigung · mandant_kennzahl · kern.audit_kette · kern.audit_feld_klassifikation
kern.anmeldeversuch · mitarbeiter_zugang · kunde_zugang
```

— the schema-qualified `kern.` names are the ones `02-datenmodell/01-KERN.md` §3.5 fixes for
`kern.audit_kette`, `kern.audit_feld_klassifikation` and `kern.anmeldeversuch` — plus, named
individually because they are tenant tables and therefore exceptional: `anstellung` and
`anstellung_kondition` (K-05), `abwesenheit`, `audit_log`, and the K-08 / K-06 paths on
`checkin_token`, `zeiteintrag`, `offline_ereignis`, `medien`, **`benutzer_feed_token` and
`kalender_eintrag`** (the read path of `app.ical_feed_lesen`, §5.6),
`zeit_intern.arbeitszeit_fenster`, `arbeitszeit_verstoss`. A CI test enumerates `pg_policies` and
fails on any `cse_definer` policy outside that list; a second asserts no role holds `BYPASSRLS`; a
third asserts every `SECURITY DEFINER` function is owned by `cse_definer` and carries
`SET search_path = pg_catalog, public` — an unqualified `search_path` on a definer function is a
privilege-escalation vector (K-01).

### 8.3 The GUCs set per transaction (K-02)

Set with `set_config(..., true)` — transaction-local — as the first statement inside a session
helper. Transaction-local is mandatory under Supavisor/PgBouncer transaction pooling, and is why a
request may never touch the pool outside a transaction.

| GUC | Value | Meaning |
|---|---|---|
| `app.benutzer_id` | uuid | the authenticated `benutzer` |
| `app.person_id` | uuid or `''` | the `person` behind that login, or none |
| `app.mandant_id` | uuid or `''` | **exactly one** mandant, or none in **every** multi-tenant scope (K-02, K-18) |
| `app.mandant_ids` | uuid[] | the mandanten the caller may read — `gruppe`, `person` **and** `kunde` scope; **always derived server-side** (K-18), never from the request |
| `app.scope` | `mandant` \| `gruppe` \| `person` \| `kunde` | the four read scopes of K-18 (§8.5) |
| `app.portal` | `intern` \| `mitarbeiter` \| `kunde` | derived by `app.portal_fuer` (K-04) |
| `app.readonly` | `on` \| `off` | **defaults to `on`** |
| `app.aal` | `aal1` \| `aal2` | assurance level of the session |
| `app.sitzung_id` | uuid | audit correlation |
| `app.akteur_typ` | `mensch` \| `agent` \| `system` | **audit only** (SEC-A9) |
| `app.ip` | inet | **audit only** (SEC-A9) |

`CHECK ((scope = 'mandant') = (mandant_id IS NOT NULL))` is asserted by the session helper, not
merely assumed (K-02): in `gruppe`, `person` and `kunde` scope `app.mandant_id` is NULL and
`app.mandant_ids` carries the set.

`app.akteur_typ` and `app.ip` extend K-02's list for one reason: `audit_log` is written inside the
database and a value never transported into the session cannot be recorded there. **Neither carries
authorisation weight: no policy may reference them**, and
`tests/invariants/rls-guc-nutzung.test.ts` asserts that.

All three multi-tenant scopes — `gruppe`, `person`, `kunde` — additionally issue
`set transaction read only`.

### 8.4 Accessors — fail closed

```sql
-- All STABLE. The GUC readers are SECURITY INVOKER; the resolvers are SECURITY DEFINER,
-- owned by cse_definer, with SET search_path = pg_catalog, public.   (K-01, K-02)
app.aktueller_benutzer()  returns uuid     -- NULL when unset
app.aktuelle_person()     returns uuid     -- NULL when unset
app.aktiver_mandant()     returns uuid     -- NULL unless scope = 'mandant'
app.scope()               returns text     -- 'mandant' when unset; K-18's four values
app.sitzung_id()          returns uuid
app.sichtbare_mandanten() returns setof uuid  -- every mandant the caller may READ, DERIVED PER
                                              -- SCOPE: benutzer_mandant | anstellung | kunde_zugang
app.switcher_mandanten()  returns setof uuid  -- the subset activatable as a working context
app.ist_gruppenansicht()  returns boolean  -- false when unset
app.ist_readonly()        returns boolean  -- TRUE when unset   <- the default that matters
app.portal()              returns text     -- 'mitarbeiter' when unset — the narrower ceiling
app.aal()                 returns text     -- 'aal1' when unset
app.ist_super_admin()     returns boolean  -- false at aal1, false without a live session
app.hat_recht(p_recht text, p_mandant uuid) returns boolean   -- false when unset
app.rechte_mandanten(p_recht text)          returns setof uuid
app.person_sichtbar(p_person uuid)          returns boolean   -- SECURITY INVOKER, deliberately
app.aktuelle_kunden()                       returns uuid[]    -- resolved, never a GUC (K-02)
app.aktueller_kunde()                       returns uuid      -- the single element in mandant scope
app.hat_zweiten_faktor(p_benutzer uuid)     returns boolean
```

Three properties worth stating outright:

- **An unset GUC yields NULL, the predicate is NULL, and no rows are returned.** Forgetting to set
  the context denies access; it never opens it.
- `app.ist_readonly()` uses `coalesce(nullif(current_setting('app.readonly', true), ''), 'on') =
  'on'`. The draft's `coalesce(current_setting(...), 'on')` treated an **empty-string** GUC as
  not-readonly — a fail-open path in the one helper it called fail-closed (review MINOR).
- `app.sichtbare_mandanten()` re-derives the readable set inside the database, **per scope** (K-18):
  from `benutzer_mandant` and the global role in `mandant` and `gruppe` scope, from the person's
  live `anstellung` rows in `person` scope, and from the login's live `kunde_zugang` rows in `kunde`
  scope. `app.mandant_ids` is a hint the accessor may cross-check, never the authority — if the
  application ever set a mandant the caller does not belong to, the database still returns nothing.
  Archived mandanten are **included** in the readable set (LEG-01/ACC-06 require ten-year retention
  *and availability*) but excluded from `switcher_mandanten()`, so data that may not be deleted
  never becomes data nobody can read.
- `app.aktuelle_kunden()` returns an **array**, not a scalar (`02-datenmodell/02-CRM-OPERATIONS.md`
  §1.4). One company served by `reinigung` and by `security` is two `kunde` rows, and a scalar
  resolver would silently show that customer one of the two areas — CRM-06's failure with no error.
  `app.aktueller_kunde()` is kept as the single-element form used inside `mandant` scope, where
  `app.aktiver_mandant()` is set; in `kunde` scope it is NULL by construction and every policy must
  use the array form.

**Inside a `SECURITY DEFINER` function, every precondition is written as an explicit predicate
against the caller's GUCs, never by calling an invoker helper** — an invoker helper called from a
definer evaluates as the definer and silently returns true for everything.

### 8.5 Policy classes

**Class T — tenant tables** (`mandant_id not null`). K-03's two permissive policies, plus — on the
tables a subject portal must reach — K-18's two. Four is the ceiling, not the default: a table that
no worker and no customer reaches carries exactly K-03's two and nothing else.

```sql
-- 1. tenant scope: read and write                                   (K-03)
create policy t_mandant on <tabelle>
  for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('<modul>.<aktion>', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('<modul>.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

-- 2. group scope: SELECT ONLY — no write counterpart, ever          (K-03)
create policy t_gruppe on <tabelle>
  for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (select app.rechte_mandanten('gruppe.<modul>.lesen')));

-- 3. person scope: SELECT ONLY, keyed on THE SUBJECT                (K-18)
create policy t_person on <tabelle>
  for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and <the row belongs to app.aktuelle_person()>);

-- 4. kunde scope: SELECT ONLY, keyed on THE SUBJECT                 (K-18)
create policy t_kunde on <tabelle>
  for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and <the row belongs to app.aktuelle_kunden()>);
```

Policy 2 is written above in the index-friendly form. It is semantically identical to K-03's literal
`app.ist_gruppenansicht() and mandant_id = any (app.sichtbare_mandanten()) and
app.hat_recht('gruppe.<modul>.lesen', mandant_id)`; because `mandant_id` genuinely varies across
rows in group scope, the set-returning `app.rechte_mandanten()` lets the planner hoist a
`SECURITY DEFINER` call that would otherwise run once per candidate row
(`02-datenmodell/01-KERN.md` §1.3, which fixes both forms as the ones `src/server/db/rls.ts` emits).
The same reasoning produces the `(select …)` hoist inside policy 1.

Both halves of policy 1 matter. A `USING`-only policy filters reads and leaves `INSERT` and the
post-image of `UPDATE` unconstrained. **A policy that omits the `hat_recht` conjunct is a defect**
(K-03): tenant membership alone must never grant read access to a module, or a `kunde` login reads
the staff directory and every colleague's MiLoG record.

**Policies 3 and 4 are not "the group policy for smaller audiences", and the difference is the whole
of K-18.** They key on **the subject** — this person, this customer — and never on a right. Routing
the two portals through policy 2 instead, as the draft did, requires `gruppe.<modul>.lesen`: a
management right neither `mitarbeiter` nor `kunde` holds in the seeded matrix (§12), so both portals
read zero rows; and granting it to make them work would give a cleaner a group-level read of the
platform. They are also **not** a second implementation of the K-04 ceiling: the ceiling is
`restrictive` and says *at most your own rows*, policies 3 and 4 are permissive and say *these rows,
in these tenants*, and **both must pass**.

**Invariant 10 is enforced by Postgres, not by a service check.** No `INSERT`/`UPDATE`/`DELETE`
policy anywhere references any multi-tenant scope, and `app.aktiver_mandant()` is NULL in all three,
so every `t_mandant` `WITH CHECK` is false there. A write under `gruppe`, `person` or `kunde` scope
matches no policy and is refused by the database even with the service guard disabled. The two writes
EMP-07 and EMP-10 give an employee, and any customer write O-74 ever authorises, are performed by a
service that **re-enters `mandant` scope with the single resolved tenant** (`withAnstellung`,
`withKundenVorgang`, §6.3), where the ordinary K-03 write path applies unchanged.

**No `DELETE` policy is created for finance, time-tracking or audit tables** (invariant 8, LEG-01):
absent policy = impossible operation, plus `revoke delete` and a `BEFORE DELETE` trigger that raises.

**Class P — person-scoped, employment-derived** (`person`, `nachweis`, `qualifikation`,
`bewacher_eintrag`, `mitarbeiter_zugang`). D-09 §6:

```sql
create policy person_select on person for select to cse_app
using (
      id = app.aktuelle_person()                                    -- the human sees themselves
   or (app.person_sichtbar(id)
       and (select app.hat_recht('personal.lesen', app.aktiver_mandant())))
);
```

`app.person_sichtbar` is `SECURITY INVOKER` by design, so its inner `exists` over `anstellung` is
filtered by `anstellung`'s own policies — which is exactly D-09 §6 ("visible to any mandant the
person has an employment with") with no bypass. The bootstrap case (a person entered before any
employment exists) is anchored on `person.erfasst_von_mandant_id`, and the anchor **expires with the
first `anstellung`**; the column is write-once. `anstellung` and everything below it stay **Class
T** — a cleaning manager must not see security wage rates.

The `id = app.aktuelle_person()` disjunct is what makes Class P work in `person` scope, where
`app.aktiver_mandant()` is NULL: these four tables carry no `mandant_id` at all, so K-18's tenant
conjunct is simply absent and the subject predicate is the whole policy — stricter, not looser,
because the row belongs to the human and the human is the caller
(`02-datenmodell/01-KERN.md` §1.12). `qualifikation` is a two-level catalogue with a nullable
`mandant_id` and is read in every scope through
`mandant_id is null or mandant_id = any (app.sichtbare_mandanten())`; a catalogue row is about no
one, so it needs no subject predicate.

**Class G — global catalogue and the permission model itself** (`mandant`, `mandant_identitaet`,
`mandant_kennzahl`, `rolle`, `berechtigung`, `rolle_berechtigung`, `benutzer`, `benutzer_mandant`,
`belagsart`, `abwesenheitsart`, `antragsart`, `feiertag`). The draft named six of these throughout
the document — in the definer registry of §8.2, in §7.1 and in the indexes of §18 — and put none of
them in a class. Under FORCE RLS a table with no permissive policy returns zero rows, so as written
`cse_app` could read neither `benutzer` nor `benutzer_mandant`: the user list of §12.1, the
permission editor, `app.sichtbare_mandanten()`'s own backing table and therefore **every** policy
keyed on it. The class map of §17.3 would have failed on the first migration. The permissive
predicates, mirroring `02-datenmodell/01-KERN.md` §6.1 and §6.6 – §6.8:

| Table | `SELECT` for `cse_app` | Write |
|---|---|---|
| `mandant` | `id = any (app.sichtbare_mandanten())` (TEN-06) | `system.mandant_verwalten`, `nur_global` |
| `mandant_identitaet` | as `mandant` | `system.identitaet_verwalten` |
| `mandant_kennzahl` | `mandant_id = any (app.switcher_mandanten())`, further filtered by the viewer's own read rights inside `app.mandant_kennzahlen()` (TEN-10) | none for `cse_app`; written by the job |
| `benutzer` | `id = app.aktueller_benutzer()` **or** `app.ist_super_admin()` **or** a live `benutzer_mandant` row in `app.aktiver_mandant()` together with `system.benutzer_lesen` there | `system.benutzer_verwalten` in the active mandant; no `DELETE` (`deaktiviert_am`) |
| `benutzer_mandant` | `benutzer_id = app.aktueller_benutzer()` **or** `app.ist_super_admin()` **or** (`mandant_id = app.aktiver_mandant()` and `system.benutzer_lesen`) | `system.benutzer_verwalten` + the K-15 restrictive write policies of §3.2; no `DELETE` |
| `rolle`, `berechtigung` | the matching `system.rolle_lesen`, **or** the rows describing a role the caller holds — a customer login must not be able to enumerate the platform's whole permission model | `super_admin` only; no `DELETE` (retire with `gewaehrt = false`) |
| `rolle_berechtigung` | as `berechtigung` | `system.rolle_verwalten` in `coalesce(mandant_id, app.aktiver_mandant())` + the K-15 policies; no `DELETE` |
| `belagsart`, `abwesenheitsart`, `antragsart`, `feiertag` | `mandant_id is null or mandant_id = any (app.sichtbare_mandanten())` — readable in every scope, because a worker's screen must resolve its own labels | `stammdaten.verwalten` |

**`benutzer_mandant`'s `SELECT` carries no `aal2` gate, deliberately** (K-15): a restrictive `aal2`
policy here returns zero rows for every `leitung`, `mitarbeiter` and `kunde`,
`app.sichtbare_mandanten()` is then empty, and the whole platform goes blank for every non-admin.
The gate is on the write path only (§3.2).

**Class A — `audit_log`** (K-16(d)). The table is the **only** tenant-adjacent table with a nullable
`mandant_id`, and the NULL is a stated fact rather than a missing value: it carries
`ebene enum('plattform','mandant')` with
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, because a failed login, a lockout and the
*source* side of a mandant switch all precede or transcend tenancy and forcing a tenant onto them
would mean inventing one.

```sql
create policy a_mandant on audit_log for select to cse_app
  using (ebene = 'mandant'
         and mandant_id = any (app.sichtbare_mandanten())
         and (select app.hat_recht('system.audit_lesen', mandant_id)));

create policy a_plattform on audit_log for select to cse_app
  using (ebene = 'plattform' and app.ist_super_admin());     -- K-16(d), verbatim
```

Platform rows are readable **only** by `super_admin` (K-16(d)); the draft let any principal read
platform rows naming them as actor, which would have exposed one user's login and lockout history to
anyone able to guess the shape of the query. There is **no** `INSERT` policy for `cse_app` at all —
the only writer is `app.protokolliere(...)` — and no `UPDATE`/`DELETE` policy, plus
`revoke update, delete` and a `before update or delete` trigger raising `AUDIT_UNVERAENDERLICH`.

**Class S — session and security infrastructure** (review B9). These tables are not in SPEC §22 and
were unclassified in the draft, which left `benutzer_sitzung` — the single authority for invariant 3
— readable and writable by any request with a forgotten `WHERE` clause:

| Table | Policy |
|---|---|
| `benutzer_sitzung` | `select`/`update`: `benutzer_id = app.aktueller_benutzer()`; additionally `select` under `system.sitzung_lesen`. No `insert` for `cse_app` (sessions are created through the auth service), no `delete` |
| `mitarbeiter_zugang` | §5.1; `insert`/`update` only under `personal.zugang_verwalten`; redemption only through `app.zugang_aktivieren` |
| `kunde_zugang` | Class T in module `crm`, **internal-only** — a customer never reads the access table, so it carries no `t_kunde` and its customer ceiling is the degenerate form below |
| `benutzer_feed_token` | `select`/`insert`/`update` only where `benutzer_id = app.aktueller_benutzer()`, plus the narrow `cse_definer` read policy `app.ical_feed_lesen` needs (§5.6, §8.2) |
| `kern.anmeldeversuch` | **no policy for `cse_app` at all.** Written and read only by `app.versuch_protokollieren` and the retention job; a definer read policy for the forensic query |
| `kern.audit_kette`, `kern.audit_feld_klassifikation` | **no policy for `cse_app` at all**; read by `app.protokolliere` and `app.audit_feld_lesen` under `cse_definer` (§8.2) |
| `einstellung` | read under `system.einstellung_lesen`; write under `system.einstellung_verwalten` with the K-15 restrictive policy |
| `checkin_token` | read under `zeit.checkin_verwalten`; no write policy for `cse_app` (§5.3) |
| `mfa_wiederherstellungscode` (if built) | **no policy for `cse_app` at all**; reachable only from the auth service under `cse_definer` |

Every table this document names is now in exactly one class, which is what §17.3's build check
requires. `src/server/db/rls.ts` holds the class map, and adding a table without a class fails the
build rather than shipping a table that silently returns zero rows.

#### Restrictive portal ceilings — one per portal, never a blanket

**The draft's shape 1 was wrong, and wrong in the way it warned about elsewhere.** It created
`p_intern_ceiling … using (app.portal() = 'intern')` on *every* table and then added the worker and
customer ceilings "on top". Restrictive policies are **ANDed** with every other restrictive policy,
so a worker session evaluated `false and (…)` on every table in the system and a customer session
did the same: both portals read zero rows everywhere. That contradicts §12.7, §5.2 and isolation
assertions 7, 16 and 17, and it contradicts the peer document `02-datenmodell/01-KERN.md` §1.4,
where the ceilings are alternatives rather than layers.

The correct construction keeps deny-by-default without the blanket. **Each table carries exactly one
restrictive ceiling per non-internal portal, and no internal ceiling exists at all** — internal-only
is the *absence* of an opt-in disjunct, not a third ANDed policy:

```sql
-- worker ceiling: on every table, in one of the three keyed forms below
create policy p_ma_ceiling on <tabelle> as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter' or <worker disjunct, or false>);

-- customer ceiling: on every table, keyed or degenerate
create policy p_kunde_ceiling on <tabelle> as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or <customer disjunct, or false>);
```

Where a table has no path for that portal the emitter writes `false`, which reduces to the
degenerate `app.portal() <> '<portal>'` — the same form `02-datenmodell/01-KERN.md` §1.4 uses for
the personnel domain's customer ceiling. **The default in `rls.ts` is `false`, so a table onboarded
with no entry is internal-only**: a forgotten opt-in is a missing feature, a forgotten opt-out would
have been a leak. What the blanket policy bought is bought here without the ANDing.

`app.portal() = 'intern'` appears in no policy anywhere, and
`tests/invariants/rls-ceilings.test.ts` asserts four things against `pg_policies`:

1. no restrictive policy is written as `app.portal() = 'intern'`;
2. no table carries **two** restrictive policies for the same portal — the ANDing defect;
3. every table carries **at most one** restrictive policy per non-internal portal, and every table in
   the class map declares which form it takes;
4. a table that carries **no** portal ceiling must instead carry a named own-row ceiling of form D,
   which binds every portal including `intern` — so "no ceiling" is never a state a table can reach
   by omission.

**The keyed forms of the worker disjunct** — K-04's enumeration mixes anstellung-hung and
person-hung tables, and the draft applied the `anstellung_id` form to all of them, including four
tables that have no such column, so the policy was **not creatable** on `person`, `nachweis`,
`bewacher_eintrag` or `mitarbeiter_zugang`. Form D is listed alongside them because a table takes
exactly one of the four, but it is **not a portal ceiling**: it is a disjunction that is true for the
principals it does not narrow, which is why it composes with the others and why it binds an `intern`
session too:

| Form | Disjunct | Tables — enumerated in `src/server/db/rls.ts`, not exemplified |
|---|---|---|
| **A · anstellung-hung** | `anstellung_id in (select id from anstellung where person_id = app.aktuelle_person())` | `anstellung_kondition`, `stundenkonto`, `stundenkonto_bewegung`, `urlaubskonto`, `abwesenheit`, `zeit_einwand`, `antrag`, `einsatz_zuordnung`, `zeiteintrag`, `zeiteintrag_korrektur`, `medien` |
| **B · person-hung** | `person_id = app.aktuelle_person()` — and `id = app.aktuelle_person()` on `person` itself | `person` (`id`), `anstellung` (`person_id`), `nachweis`, `bewacher_eintrag`, `bewacher_meldung`, `mitarbeiter_zugang`, `da_kenntnisnahme`, `schluessel_quittung`, `kalender_eintrag`, `nachricht_empfaenger` |
| **C · assignment-derived** | `id`/`<fk>` `in (select … from einsatz e join einsatz_zuordnung ez on ez.einsatz_id = e.id join anstellung a on a.id = ez.anstellung_id where a.person_id = app.aktuelle_person())` — this is what `zugewiesen` means in the database (review B19) | `objekt` (`id` ← `e.objekt_id`), `einsatz` (`id` ← `ez.einsatz_id`), `auftrag`, `dienstanweisung`, `wachbuch_eintrag`, `schluessel`, `lv_position`, `aufmass`, `bautagebuch`, `leistungsnachweis`, `dokument` |
| **D · own-row, named by the owning domain** | not a portal ceiling at all — a disjunction true for the principals it does not narrow | `aufgabe` (`p_zustaendig`, keyed on `zugewiesen_an` / `zugewiesen_team_id` / `erstellt_von`), `kalender_eintrag` (`p_sichtbarkeit`), `nachricht`, `nachricht_anhang`, `nachricht_empfaenger` (`p_beteiligt`), `benachrichtigung`, `benachrichtigung_praeferenz` (`p_eigene`) — all five owned and enumerated by `02-datenmodell/06-RADAR-KI-INHALT.md` §1.4, which this document does not duplicate. They bind an `intern` session too: nobody reads another user's notifications, private calendar entries or message read-status, whatever portal they are in |

`anstellung` takes form B rather than form A: it *is* the employment row, so keying it on
`anstellung_id` would be circular. This is the review's B5 in full — `anstellung` carries
`stundensatz_intern` and `personalnummer`, and without its ceiling a worker session would read every
colleague's employment row in every entity they are employed by.

The customer disjunct is `kunde_id = any (app.aktuelle_kunden())` — the **array** form (§8.4), plus a
per-table visibility clause where one is required: `angebot` additionally `versendet_am is not null`
(a customer never sees a draft), `dokument` additionally `sichtbar_fuer_kunde = true`, `rechnung`
additionally `status = 'festgeschrieben'`. The enumerated list is owned by
`02-datenmodell/02-CRM-OPERATIONS.md` §1.4 and mirrored in `rls.ts`; every other table takes the
degenerate form.

`db/rls/portal-ceiling.sql` is generated from `rls.ts`, so the list has exactly one source.

#### The permissive path behind the `S` glyph — per table, named

**A restrictive ceiling narrows; it never grants.** The draft marked thirteen rights `S` in §12.3 and
pointed at "the ceiling of §8.5 shape 3", which grants nothing: with no permissive policy matching,
a guard could read no Dienstanweisung, no Wachbuch entry and no object at all, and SEC-05, SEC-06,
CLN-04 and BAU-02 had no worker path. The permissive policy is `t_person` (K-18), and its subject
predicate is the same form-C subquery the ceiling uses, stated per table so it can be generated:

| Table | `t_person` subject predicate | Reached for |
|---|---|---|
| `objekt` | `id in (select e.objekt_id from einsatz e join einsatz_zuordnung ez … where a.person_id = app.aktuelle_person())` | `objekt.lesen` (OPS-01) |
| `einsatz`, `einsatz_zuordnung` | the assignment itself | TIM-04, EMP-14 |
| `auftrag` | `id in (select e.auftrag_id from einsatz e join …)` | `auftrag.lesen` |
| `dienstanweisung` | `objekt_id in (…)` or `posten_id in (…)` | SEC-06, EMP-09 |
| `wachbuch_eintrag` | `objekt_id in (…)` | SEC-05 |
| `schluessel` | `objekt_id in (…)`; `schluessel_quittung` by `person_id` | SEC-07 |
| `lv_position`, `aufmass`, `bautagebuch` | `projekt_id`/`objekt_id in (…)` | BAU-01, BAU-02, BAU-07 |
| `leistungsnachweis` | `einsatz_id in (…)` | CLN-04 |
| `dokument` | `objekt_id in (…)` **and** `sichtbar_fuer_mitarbeiter = true` — deny by default, the exact mirror of the `sichtbar_fuer_kunde` column `02-datenmodell/02-CRM-OPERATIONS.md` §`dokument` already declares. A document is **not** worker-visible merely because it hangs off an object they cleaned; §21 places the column on that document rather than inventing a rule here | DOC-01, DOC-04 |
| `kalender_eintrag` | `benutzer_id = app.aktueller_benutzer()`, narrowed further by that table's own `p_sichtbarkeit` (form D) | CAL-01, CAL-03 |
| `aufgabe` | `zugewiesen_an = app.aktueller_benutzer()` — the column is a FK to `benutzer`, not to `person` (`02-datenmodell/06-RADAR-KI-INHALT.md`); the team branch is that document's `p_zustaendig` | OPS-11 |
| `nachricht`, `nachricht_empfaenger` | that domain's `p_beteiligt`, resolved per `empfaenger_typ` — this document does not restate it | NOT-01 |
| `person`, `nachweis`, `bewacher_eintrag`, `mitarbeiter_zugang` | the subject predicate alone — no `mandant_id` on these tables (Class P) | EMP-08, EMP-12, SEC-02 |
| `anstellung`, `anstellung_kondition`, `stundenkonto`, `urlaubskonto`, `abwesenheit`, `zeit_einwand`, `antrag`, `zeiteintrag`, `zeiteintrag_korrektur`, `medien`, `da_kenntnisnahme` | form A or B as above | EMP-03 … EMP-10, EMP-15, TIM-13 |

**Reads are `t_person`; writes are not.** `t_person` has no write counterpart, so the four acts a
worker performs on site — a Wachbuch entry (SEC-05), an Aufmaß (BAU-02), a Leistungsnachweis
signature (CLN-04), a document or photo upload (DOC-06) — run through `withAnstellung`, in `mandant`
scope, under the ordinary `t_mandant` write path. That path requires `hat_recht('<modul>.schreiben')`,
so those four rights are **granted** to `mitarbeiter` in the seeded matrix rather than marked `S`
(§12.3), and the form-C ceiling narrows each one to the objects of that person's own assignments. A
right the policy needs and the matrix does not grant is a write that silently affects zero rows; the
matrix and the policy are corrected together.

### 8.6 Wage confidentiality: column privileges, not masking views (K-05)

D-09 §6 — *a cleaning manager must not see security wage rates* — is enforced with column-level
`GRANT`, which composes correctly with RLS. Masking views are forbidden for this purpose: with
`security_invoker = true` the caller needs base-table privileges that were just revoked, and without
it the view runs as its owner and can return every tenant's rows with the tenant predicate silently
ignored.

```sql
revoke select on anstellung from cse_app;
grant  select (id, person_id, mandant_id, personalnummer, eintritt, austritt,
               status, arbeitszeitmodell, wochenstunden, erstellt_am, geaendert_am)
       on anstellung to cse_app;   -- stundensatz_intern, tarifgruppe omitted
```

The rate is reachable only through `app.entgelt_lesen(p_anstellung uuid, p_stichtag date)` —
`SECURITY DEFINER`, re-checks `personal.entgelt_lesen` **and** `mandant_id = app.aktiver_mandant()`,
and writes `audit_log`. The same construction protects `kunde.zahlungsziel_tage` /
`debitorennummer` (`crm_entgelt.lesen`) and `person.geburtsdatum` / `geburtsort` /
`staatsangehoerigkeit` (`personal.stammdaten_lesen`).

`personal.entgelt_lesen` is **not granted to `leitung` by default**, and that default is a placeholder
until the client answers §20 (O-75).

### 8.7 The ArbZG cross-entity window — the one sanctioned crossing (K-06)

**The review's B3 is correct, and K-06 resolves it.** TIM-14, LEG-03 and D-09 consequences 1 and 2
require aggregating one person's hours across entities. K-03 makes that impossible by design: a
planner in `reinigung` cannot see a `security` shift. Left unresolved the check silently returns "no
conflict" and a 6h + 5h day is scheduled as lawful — with no error to notice.

| Element | Contract |
|---|---|
| Storage | `zeit_intern.arbeitszeit_fenster` in a schema **not exposed by PostgREST**, one row per assignment: `zuordnung_quelle_id`, `quelle (plan\|ist)`, `aktiv`, `beginn_utc`, `ende_utc`. The `ist` row supersedes its `plan` row in the same statement, or the detector sums both and reports 12h for a 6h day |
| Reading | `app.arbzg_belastung(p_person, p_von, p_bis) returns table (fenster_gruppe text, beginn_utc, ende_utc, minuten integer, fremd boolean)` — durations and interval boundaries **and nothing else**: never `mandant_id`, never the entity's name, never `objekt`, `kunde`, `personalnummer` or `stundensatz_intern` |
| Preconditions | checked inside the function as explicit predicates: the caller can already see the person in the active mandant, and holds `dienstplan.arbzg_pruefen` there |
| Audit | every call writes `audit_log` with `aktion = 'arbzg.aggregat_gelesen'` |
| Writing findings | `arbeitszeit_verstoss` has **no INSERT policy for `cse_app`**. A breach spanning two entities must be recorded in both, and a request scoped to mandant A cannot write a row in mandant B; only `app.arbzg_befund_schreiben(...)` writes them |
| Only caller | `src/server/services/arbzg/` — nothing else in the tree may call either function |
| Isolation test | a `reinigung` planner gets the breach and **zero fields identifying the `security` shift** |

The caller learns *that* the person is otherwise committed, never *where* or *for whom*. Widening
that return shape requires amending K-06 first.

### 8.8 Finding a person who already exists (D-09, LEG-09)

`person_select` deliberately hides a human employed only in another entity, which guarantees
duplicates unless there is a designed path — and a duplicate `person` defeats the cross-entity ArbZG
aggregation the same section just built (review MISSING). The path is a narrow existence probe, not a
lookup:

```sql
app.person_existenz_pruefen(p_nachname text, p_geburtsdatum date, p_mobil_e164 text)
  returns table (treffer boolean, hinweis text)
-- SECURITY DEFINER, owner cse_definer. Requires `personal.erstellen` in the active mandant.
-- Returns exactly one of:
--   (false, null)
--   (true,  'Eine Person mit diesen Angaben existiert bereits in der Gruppe.
--            Bitte Zusammenführung anfordern.')
-- It returns no name, no entity, no employment, no id. Every call writes audit_log
-- (`personal.existenz_geprueft`) so probing is visible.
```

Merging is a request handled by a holder of `personal.zusammenfuehren`, is a soft merge
(`person.zusammengefuehrt_in_person_id`, never a hard delete, invariant 8), and is audited with both
ids.

### 8.9 Time never crosses an invoice circle (D-09 consequence 5, K-16)

Tenant isolation would still be breached silently if a costed row could name an `anstellung` of one
entity and a `mandant_id` of another. `zeiteintrag` carries both, and nothing in the draft asserted
that they agree (review MISSING). Agreement is made structural with a composite foreign key, and the
parent therefore **must** declare the matching unique key — K-16 names this as the mistake seven
foreign keys in earlier drafts made:

```sql
alter table anstellung  add constraint anstellung_mandant_uk unique (mandant_id, id);

alter table zeiteintrag add constraint zeiteintrag_anstellung_fk
  foreign key (mandant_id, anstellung_id) references anstellung (mandant_id, id);
```

The same pair exists for `einsatz_zuordnung`, `stundenkonto`, `urlaubskonto`, `abwesenheit`,
`zeit_einwand` and `antrag`. A mismatch then cannot be written at all, rather than being merely
unlikely — which matters because such a row would carry billable time into the wrong number circle
(TEN-02, FIN-03) and into the wrong §17 MiLoG record (LEG-02).

**Membership validity is a Berlin calendar boundary** (K-11). `benutzer_mandant.gueltig_ab` and
`gueltig_bis` are `date` columns compared against `app.berlin_heute()`, never against `current_date`
on a UTC server: between 23:00 and 24:00 Berlin time in winter — 22:00 in summer — a UTC-evaluated
comparison places the boundary on the wrong calendar day, so a membership that ends "today" would
still grant access, or one that starts "tomorrow" would grant it early.

### 8.10 Why RLS is the second line and never the only one

| RLS can | RLS cannot |
|---|---|
| guarantee no query returns another tenant's row | be reviewed as easily as a TypeScript function, or unit-tested per business rule |
| refuse a write with no active mandant | produce a 404-rather-than-403 response (AUT-06) — it produces zero rows, which the application must still translate |
| stop a raw `psql` session or a forgotten `WHERE` clause | validate input, enforce §14 UStG completeness, or hold a `SELECT … FOR UPDATE` invoice counter |
| survive an application bug | express the *reason* for a refusal in a way a user can act on |

So application authorization is the primary control, RLS mirrors it, and the two are proven
consistent by the isolation suite (§17). Anything only RLS enforced would be invisible in code
review; anything only the application enforced would fall to a single missing call.

**A recorded divergence from AUT-05's literal wording.** AUT-05 says "RLS policies mirror application
authorization". They mirror the *tenant, portal and module* decision exactly, through
`app.hat_recht`. They do not re-implement input validation, §14 UStG completeness or the approval
chain. This is deliberate and belongs in `DECISIONS.md` as a numbered entry (§21), so a later auditor
reading AUT-05 does not treat the difference as an omission.

---

## 9. AUT-06 — cross-tenant access returns 404, uniformly

### 9.1 The mechanism

Because every read runs inside a session helper under RLS, a record from another mandant simply
**does not exist** for the query. The repository helper returns `null` and turns `null` into
`NotFoundError` before any business logic runs, so cross-tenant access never reaches a code path that
could answer 403 — it is not an `if` a developer has to remember.

```ts
// src/server/db/laden.ts
export async function ladenOderNichtGefunden<T>(
  tx: TenantDb, tabelle: Tabelle<T>, id: string,
): Promise<T> {
  const [row] = await tx.select().from(tabelle).where(eq(tabelle.id, id)).limit(1);
  if (!row) throw new NotFoundError(tabelle.name, id);      // RLS already hid it
  return row;
}
```

**AUT-06 holds for writes as well as reads.** An `UPDATE` naming a foreign id affects zero rows;
the service must translate "zero rows affected" into `NotFoundError` and never into a silent success.
`tests/isolation/db/write-check.test.ts` covers both directions.

### 9.2 Error taxonomy and the single mapper

| Error | HTTP | Body code | When |
|---|---|---|---|
| `AuthError` | 401, or 302 to login for page requests | `NICHT_ANGEMELDET` | no session, expired session, revoked session |
| `MfaRequiredError` | 403 | `MFA_ERFORDERLICH` | AUT-02, §3.2 |
| `AccountLockedError` | 403 | `KONTO_GESPERRT` | AUT-07 lockout, uniform message |
| `NotFoundError` | **404** | `NICHT_GEFUNDEN` | row invisible, wrong tenant, unknown id, unknown mandant slug, unknown token |
| `TenantMismatchError` | **404** | `NICHT_GEFUNDEN` | a mandant the user is not a member of |
| `PermissionError` | 403 | `KEINE_BERECHTIGUNG` | the record **is** in the active mandant and visible, but the right is not held |
| `ReadonlyContextError` | 403 | `NUR_LESEN_KONTEXT` | a mutation attempted in any of the three multi-tenant scopes — `gruppe`, `person`, `kunde` (K-18) |
| `NoActiveMandantError` | 409 | `KEIN_BEREICH_AKTIV` | a write attempted with no single active mandant (invariant 10) |
| `RateLimitError` | 429 | `ZU_VIELE_VERSUCHE` | AUT-07 |
| `ValidationError` | 422 | `UNGUELTIGE_EINGABE` | Zod (SEC-A4) |
| `NotConnectedError` | 503 | `NICHT_VERBUNDEN` | an external system with no credentials — never simulated |
| anything else | 500 | `SERVERFEHLER` + `vorfall_id` | never a message, never a stack |

`NotFoundError` and `TenantMismatchError` produce **byte-identical** responses: same status, same
body, same headers, same cache directives, same timing budget. The distinction is recorded only
internally, in `audit_log` with `ergebnis = 'fehler'` and the true reason. For RSC pages the wrapper
calls `notFound()`, so a deep link to another entity's record renders the standard 404 page with no
flash of a layout that would confirm the record's area.

**The one deliberate asymmetry.** Inside the active mandant, a *visible* record the user may not act
on returns **403**, not 404 — the record is on their screen, and a 404 there would make the UI
unusable. Only existence **across a tenant boundary** is hidden. SPEC's AUT-06 ("403 confirms
existence") can be read either way, so this is recorded in `DECISIONS.md` as a numbered entry rather
than left as prose (§21) — otherwise a later reviewer treats every in-tenant 403 as a bug.

---

## 10. AUT-07 — rate limiting and lockout

Implemented in Postgres in the same EU region (D-04), not in a third-party edge service: a
rate-limiting processor would need its own DPA, and PUB-13's no-third-party-trackers posture argues
against a hosted CAPTCHA.

| Table | Contract |
|---|---|
| `kern.anmeldeversuch` | `(id, kennung_hash text, ip inet, art text, erfolg boolean, grund text, erstellt_am timestamptz)` — schema `kern`, as `02-datenmodell/01-KERN.md` §6.12 fixes it, and written that way everywhere in this document including the indexes of §18. The identifier — e-mail, phone, token prefix — is stored **only as a hash**. Written and read exclusively by `app.versuch_protokollieren` (K-08) |
| `benutzer.gesperrt_bis` | `timestamptz`, set by the same function; the account-level lockout |
| `einstellung` | every threshold, window and duration, read by `app.einstellung(schluessel)` |

**Why a dedicated table and not `audit_log`.** The lockout query is "failed attempts from this IP,
and for this identifier, in the last N minutes". Per-user counters cannot rate-limit attempts against
**non-existent** accounts, which is exactly the enumeration case AUT-07 exists for; and `audit_log`
is hash-chained and append-only, so one row per failed attempt would serialise every login behind the
chain head. One summarising `audit_log` row per lockout event still satisfies AUT-08.

**This also resolves the review's B18.** `kern.anmeldeversuch` is DSGVO-scoped telemetry with a
retention period read from `app.einstellung('retention.anmeldeversuch_tage')` and a scheduled prune
(`job:anmeldeversuch_purge`). **That period is a labelled PLACEHOLDER, not a decided rule**: SPEC
states no retention for auth telemetry, and K-17 requires a retention period the SPEC does not state
to appear as a placeholder plus `TODO(client)` rather than as a number an implementer will read as
settled. The proposal carried into §11.2 and **O-92** is 30 days; the seed ships that value marked
*vorläufig* and the DSGVO deletion concept (LEG-09) confirms or replaces it. `audit_log` carries only
events with evidentiary value and is **never row-deleted**. Where an erasure obligation reaches `audit_log`, it is executed as partition
detach for whole expired months plus field-level pseudonymisation of `ip` and `user_agent` under the
field-classification rules — never as a row delete, which would destroy the GoBD/LEG-01 guarantee for
the ten-year permission-change records that share the table.

### 10.1 The endpoints that must be covered

Every unauthenticated or token-guessable endpoint, including the three the draft omitted (review
MISSING):

| Endpoint | Dimensions counted | Kind (`art`) |
|---|---|---|
| `POST /auth/login` (password) | IP, identity | `passwort` |
| `POST /auth/mitarbeiter` (SMS request, EMP-01) | IP, phone, **global daily SMS budget** | `otp_anfrage` |
| `POST /auth/mitarbeiter/code` (SMS verify) | IP, phone, per-issued-code attempts | `otp_pruefung` |
| `POST /auth/zwei-faktor/pruefen` | IP, benutzer | `zwei_faktor` |
| `POST /auth/passwort-vergessen` (request) | IP, identity | `reset_anfrage` |
| `POST /auth/passwort-neu` (**token consumption**) | IP, token prefix | `reset_einloesung` |
| `POST /auth/einladung/[token]` (**invitation acceptance**) | IP, token prefix | `einladung` |
| `POST /check-in/[token]` | IP for unknown hashes, per-`einsatz_zuordnung` for known ones | `checkin` |
| `GET /api/kalender/feed/[token]` (**iCal**) | IP, token prefix | `feed` |
| `POST /api/sitzung/mandant` | benutzer | `wechsel` |

All thresholds are **placeholders** in `einstellung`, not values chosen here:

```
// TODO(client, O-80): AUT-07 thresholds — attempts per identifier and per IP, the window, the lockout
// duration and whether it expires automatically or requires an administrator to unlock; and
// whether a locked account is notified by e-mail.
// TODO(client, O-81): Anti-abuse on the public login and OTP endpoints without a third-party CAPTCHA
// (PUB-13). Is Postgres-side rate limiting alone acceptable, or should an EU-hosted challenge
// provider with a DPA be added?
// TODO(client, O-82): The monthly SMS spend cap that triggers a hard stop, and who is notified.
```

### 10.2 Cross-cutting rules

- **Uniform responses.** A wrong password and an unknown e-mail return the same message. An OTP
  request for an unknown phone returns the same 200 and sends nothing. Password reset always answers
  identically. Same reasoning as AUT-06: a differentiated response is an enumeration oracle.
- Lockouts are per identity **and** per IP; a locked identity is never revealed
  ("Bitte versuchen Sie es später erneut").
- **The check-in row is per assignment, not per token** (review MINOR). An unknown hash names no
  token, so nothing can be invalidated by it; unknown-hash traffic is limited by IP, while repeated
  failures against a token that *exists* are counted on its `einsatz_zuordnung`. A blunt per-IP limit
  would lock out a building site where ten workers share one connection or one carrier NAT, so a
  successfully redeemed token exempts its IP from the unknown-hash counter for the shift window.
- Every limit hit and every lockout writes `audit_log` (`auth.sperre_gesetzt`,
  `auth.sperre_aufgehoben`).

---

## 11. AUT-08 / TEN-09 / SEC-A9 — audit coverage

`audit_log` is append-only, monthly-partitioned, hash-chained per partition chain, and written in the
**same transaction** as the change it records — so a rollback cannot leave a phantom entry and a
committed change cannot lack one. Its columns are owned by `02-datenmodell/01-KERN.md` §6.11; what
this document fixes is the **event catalogue** and the redaction rule.

`cse_app` holds no `INSERT` on it. The only writer is `app.protokolliere(...)`.

### 11.1 The auth and tenancy event catalogue — complete

```
auth.login_erfolg · auth.login_fehler · auth.logout · auth.kein_bereich
auth.otp_angefordert · auth.otp_erfolg · auth.otp_fehler
auth.zwei_faktor_pflicht_ausgeloest · auth.zwei_faktor_einrichtung_gestartet
auth.zwei_faktor_einrichtung_abgeschlossen · auth.zwei_faktor_verifiziert
auth.zwei_faktor_fehler · auth.zwei_faktor_faktor_entfernt
auth.wiederherstellungscode_verwendet
auth.passwort_reset_angefordert · auth.passwort_geaendert
auth.mobilnummer_geaendert · auth.sperre_gesetzt · auth.sperre_aufgehoben
sitzung.erstellt · sitzung.widerrufen · sitzung.abgelaufen
sitzung.mandant_gewechselt (TEN-09, two mirror rows) · sitzung.wechsel_angeboten
sitzung.gruppenansicht_geoeffnet
mandant.erstellt · mandant.archiviert · mandant.module_geaendert
benutzer.eingeladen · benutzer.aktiviert · benutzer.deaktiviert
benutzer.rolle_zugewiesen · benutzer.rolle_entzogen
benutzer.module_geaendert · benutzer.sitzungen_widerrufen
berechtigung.bindung_geaendert · rolle.erstellt · rolle.archiviert
zugang.erstellt · zugang.aktiviert · zugang.gesperrt · zugang.entsperrt
kunde_zugang.erstellt · kunde_zugang.widerrufen
checkin.token_erstellt · checkin.token_verwendet · checkin.token_abgelehnt
checkin.token_widerrufen · offline.ereignis_empfangen · offline.ereignis_uebernommen
feed_token.erstellt · feed_token.verwendet · feed_token.widerrufen
personal.entgelt_gelesen · personal.stammdaten_gelesen · personal.existenz_geprueft
personal.zusammengefuehrt · arbzg.aggregat_gelesen
zugriff.verweigert (every 403) · zugriff.nicht_gefunden (every tenant-boundary 404)
agent.lauf_gestartet · agent.richtlinie_geaendert · agent.budget_geaendert
freigabe.erteilt · freigabe.abgelehnt · freigabe.angesehen
```

Each carries `akteur_art` (`mensch` / `agent` / `system`), the actor's readable name **as at the
moment of the act**, `ebene`, `mandant_id`, `sitzung_id`, `ip`, `user_agent`, the object type and id,
the before/after diff and a correlation id — one request is one correlation id, across services and
jobs (SEC-A9).

**`ebene` is what makes the NULL mandant legible** (K-16(d)). Every `auth.*` event, every
`sitzung.abgelaufen`, `mandant.erstellt` and the *source* row of a `sitzung.mandant_gewechselt` pair
carries `ebene = 'plattform'` with `mandant_id IS NULL`; everything else carries `ebene = 'mandant'`
with the tenant set. `CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))` makes the two
inseparable, so a NULL is a **stated platform-level fact** rather than a forgotten value, and
`audit_log` is the only tenant-adjacent table in the platform permitted a nullable `mandant_id`.
Platform rows are readable only by `super_admin` (§8.5 Class A).

### 11.2 What is never written

Passwords, TOTP secrets, recovery codes, OTP codes, full check-in tokens (only the prefix), session
handles, feed tokens, signed URLs, and the raw e-mail or phone in rate-limit rows (hashed). Redaction
is driven by `audit_feld_klassifikation` per field, not by a hand-written secrets list in application
code — `geaenderte_felder` still names a redacted field, so it stays provable *that* the value
changed.

```
// TODO(client, blocked on O-06): If a Betriebsrat exists, do login-time metadata (IP, user
// agent, timestamps), the check-in audit trail and the APR-08 review-duration measurement
// require a Betriebsvereinbarung under §87 BetrVG before they may be collected per employee
// rather than in aggregate?
// TODO(client, O-92): Retention for auth events. Proposal, to be confirmed against the DSGVO deletion
// concept (LEG-09): 30 days for `anmeldeversuch`; role, module and permission changes for the
// GoBD period because they are the evidence of who could do what.
```

---

## 12. The seeded permission matrix

Read together with §7.3: a cell shows the **platform-default binding**
(`rolle_berechtigung.mandant_id IS NULL`). Every non-`—` cell is editable per mandant in the UI
(AUT-03). For `admin`, every ✔/○ additionally requires the module in `benutzer_mandant.module`, and
every cell requires the module in `mandant.module` (TEN-08).

| Glyph | Meaning |
|---|---|
| `✔` | granted by default |
| `○` | not granted by default; a binding may be created in the UI |
| `—` | not bindable for this role: `berechtigung.nur_global`, or the role's `portal` makes the module unreachable |
| `S` | **a read reached without a right**, through the `t_person` / `t_kunde` subject policies of K-18 (§8.5) or the self-access disjunct of §7.5. `S` never denotes a write: a restrictive ceiling grants nothing, so every write needs a granted right on the `t_mandant` path |

Legend: `SA` super_admin · `AD` admin · `LT` leitung · `MA` mitarbeiter · `KD` kunde.

`super_admin` resolves through the global role and therefore holds every right whose gates it passes
— but the `S` cells are not rights at all, so no role, including `super_admin`, can acknowledge an
instruction or raise an objection on another person's behalf (§7.5).

### 12.1 System, group and data protection

| Right | SA | AD | LT | MA | KD | Note |
|---|---|---|---|---|---|---|
| `system.mandant_lesen` | ✔ | ✔ | ✔ | — | — | own area master data |
| `system.mandant_verwalten` | ✔ | — | — | — | — | `nur_global`; TEN-08 fifth area |
| `system.identitaet_verwalten` | ✔ | ○ | — | — | — | logo, hue, address (TEN-07) |
| `system.benutzer_lesen` | ✔ | ✔ | ✔ | — | — | only accounts attached to the active mandant |
| `system.benutzer_verwalten` | ✔ | ✔ | ○ | — | — | invite, edit, deactivate |
| `system.rolle_lesen` | ✔ | ○ | ○ | — | — | the permission editor, read |
| `system.rolle_verwalten` | ✔ | ○ | — | — | — | **write path requires `aal2` (K-15)**; default open to `admin` pending O-76 |
| `system.module_zuweisen` | ✔ | ○ | — | — | — | pending O-76 — an admin widening their own module set is the risk |
| `system.zwei_faktor_zuruecksetzen` | ✔ | — | — | — | — | `nur_global` — delegating it would defeat AUT-02 |
| `system.sitzung_lesen` | ✔ | ✔ | ○ | — | — | other users' active sessions |
| `system.sitzung_widerrufen` | ✔ | ✔ | ○ | — | — | device loss, offboarding |
| `system.feed_token_widerrufen` | ✔ | ✔ | ○ | — | — | CAL-03 |
| `system.audit_lesen` | ✔ | ○ | ○ | — | — | scoped to the active mandant |
| `system.audit_exportieren` | ✔ | ○ | — | — | — | DOC-08 evidence bundle |
| `system.einstellung_lesen` | ✔ | ○ | ○ | — | — | integrations, DPA register (LEG-09) |
| `system.einstellung_verwalten` | ✔ | ○ | — | — | — | includes the AUT-07 thresholds; pending O-76 |
| `gruppe.*.lesen` | ✔ | ○ | ○ | — | — | TEN-05 read-only aggregation, one key per module |
| `datenschutz.auskunft_erstellen` | ✔ | ○ | — | — | — | DSGVO Art. 15 (LEG-09) |
| `datenschutz.berichtigung_bearbeiten` | ✔ | ○ | — | — | — | Art. 16 |
| `datenschutz.loeschung_pruefen` | ✔ | ○ | — | — | — | Art. 17 **against** the retention holds — see §12.8 |
| `oeffentlich.lesen` | ✔ | — | — | — | — | bindable to no mandant role; held in practice only by the public-renderer service principal (§14.3). `SA` holds it through the global role, where it grants nothing beyond published content |
| `bericht.dashboard_lesen` | ✔ | ✔ | ✔ | S | S | DSH-01, DSH-03; the figures a role sees are its own rights, so one key serves all five dashboards |

### 12.2 Acquisition and content

| Right | SA | AD | LT | MA | KD | Note |
|---|---|---|---|---|---|---|
| `crm.lesen` / `crm.schreiben` | ✔ | ✔ | ✔ | — | — | EMP-13: never for `mitarbeiter` |
| `crm.rechtsgrundlage_lesen` | ✔ | ✔ | ○ | — | — | CRM-08 |
| `crm.rechtsgrundlage_setzen` | ✔ | ✔ | ○ | — | — | CRM-08 |
| `crm.kommunikation_senden` | ✔ | ✔ | ✔ | — | — | blocked when `rechtsgrundlage = keine` (LEG-08, §7 UWG) and passes `agent/policy.ts` |
| `crm.exportieren` | ✔ | ○ | ○ | — | — | |
| `crm_entgelt.lesen` | ✔ | ✔ | ○ | — | — | payment terms, debtor number (K-05 column grant) |
| `radar.lesen` | ✔ | ✔ | ✔ | — | — | RAD-01, RAD-02 |
| `radar.profil_schreiben` | ✔ | ✔ | ✔ | — | — | RAD-04 |
| `radar.status_setzen` | ✔ | ✔ | ✔ | — | — | RAD-07 |
| `radar.plattform_verwalten` | ✔ | ✔ | ○ | — | — | RAD-09 |
| `vergabe.lesen` / `vergabe.schreiben` | ✔ | ✔ | ✔ | — | — | bid folder assembly |
| `vergabe.einreichung_erfassen` | ✔ | ✔ | ✔ | — | — | D-07: submission is manual; this records that a human submitted |
| `formular.lesen` / `formular.schreiben` | ✔ | ✔ | ✔ | — | — | REQ-01 … REQ-05 |
| `referenz.lesen` | ✔ | ✔ | ✔ | — | — | PUB-07 |
| `referenz.schreiben` | ✔ | ✔ | ○ | — | — | |
| `referenz.veroeffentlichen` | ✔ | ○ | ○ | — | — | |
| `referenz.kundenfreigabe_erfassen` | ✔ | ✔ | ✔ | — | — | PRO-05 needs `freigegeben_vom_kunden` on file |
| `social.schreiben` | ✔ | ✔ | ✔ | — | — | SOC-03 draft |
| `social.freigeben` | ✔ | ✔ | ○ | — | — | SOC-08, `requireMensch` |
| `social.planen` | ✔ | ✔ | ○ | — | — | |
| `social.kanal_verbinden` | ✔ | ○ | — | — | — | SOC-07: unconnected channels show "nicht verbunden", never simulated |
| `recruiting.stelle_schreiben` | ✔ | ✔ | ✔ | — | — | REC-02 |
| `recruiting.stelle_veroeffentlichen` | ✔ | ✔ | ○ | — | — | REC-09, only where a real API exists |
| `recruiting.bewerbung_lesen` | ✔ | ✔ | ✔ | — | — | |
| `recruiting.bewerbung_bewerten` | ✔ | ✔ | ✔ | — | — | ranking is a suggestion (REC-08) |
| `recruiting.entscheiden` | ✔ | ✔ | ✔ | — | — | `requireMensch` — LEG-12, DSGVO Art. 22 |
| `recruiting.daten_loeschen` | ✔ | ✔ | ○ | — | — | REC-07 / LEG-11 purge |

### 12.3 Operations

| Right | SA | AD | LT | MA | KD | Note |
|---|---|---|---|---|---|---|
| `objekt.lesen` | ✔ | ✔ | ✔ | S | ○ | MA: objects of own assignments, through the `t_person` predicate of §8.5, narrowed by the form-C ceiling |
| `objekt.schreiben` | ✔ | ✔ | ✔ | — | — | includes the Raumbuch (OPS-02) |
| `objekt_import.lesen` / `.schreiben` | ✔ | ✔ | ✔ | — | — | OPS-04, preview before commit |
| `katalog.lesen` | ✔ | ✔ | ✔ | — | — | OPS-06 |
| `katalog.schreiben` | ✔ | ✔ | ○ | — | — | includes time values (OPS-03) |
| `angebot.lesen` | ✔ | ✔ | ✔ | — | ○ | KD: released offers only |
| `angebot.schreiben` | ✔ | ✔ | ✔ | — | — | |
| `angebot.preis_freigeben` | ✔ | ○ | ✔ | — | — | |
| `angebot.versenden` | ✔ | ✔ | ✔ | — | — | passes `agent/policy.ts` (invariant 7) |
| `angebot.annahme_erfassen` | ✔ | ✔ | ✔ | — | — | KD write is blocked on O-74 |
| `kalkulation.lesen` / `.schreiben` | ✔ | ✔ | ✔ | — | — | **the margin** — internal-only ceiling; OPS-07 computed in services (invariant 6) |
| `auftrag.lesen` | ✔ | ✔ | ✔ | S | ○ | |
| `auftrag.schreiben` | ✔ | ✔ | ✔ | — | — | OPS-05, OPS-10 |
| `auftrag.abschliessen` | ✔ | ✔ | ✔ | — | — | FIN-18 warning applies |
| `abrechnung.lesen` / `.schreiben` | ✔ | ✔ | ○ | — | — | billing type per contract (FIN-01, O-04) |
| `abrechnung.freistellung_pflegen` | ✔ | ✔ | ○ | — | — | §48 EStG Freistellungsbescheinigung, validity at the **service date** (FIN-10, LEG-06) |
| `reinigung.lesen` / `.schreiben` | ✔ | ✔ | ✔ | — | — | CLN-01, CLN-02, CLN-05 |
| `nachweis.lesen` | ✔ | ✔ | ✔ | S | ○ | CLN-04 Leistungsnachweis |
| `nachweis.schreiben` | ✔ | ✔ | ✔ | **✔** | — | CLN-04, signed on site. A **granted** right, not `S`: the write runs under `withAnstellung` in `mandant` scope on the `t_mandant` path, and the form-C ceiling narrows it to the worker's own assignments |
| `security.lesen` / `.schreiben` | ✔ | ✔ | ✔ | — | — | SEC-01, SEC-08 |
| `dienstanweisung.lesen` | ✔ | ✔ | ✔ | S | — | SEC-06; MA sees the instruction for their own posts |
| `dienstanweisung.schreiben` | ✔ | ✔ | ✔ | — | — | versioned |
| `wachbuch.lesen` | ✔ | ✔ | ✔ | S | — | SEC-05; **not** in the default `mitarbeiter` grant — a guard reaches their own entries through the ceiling |
| `wachbuch.schreiben` | ✔ | ○ | ✔ | **✔** | — | SEC-05, server time only. Granted, not `S` — same construction as `nachweis.schreiben`; a guard with no write right would have written nothing at all |
| `schluessel.lesen` | ✔ | ✔ | ✔ | S | — | SEC-07; keys of own objects |
| `schluessel.schreiben` | ✔ | ✔ | ✔ | **✔** | — | SEC-07 handover receipt, countersigned on site; ceiling-narrowed |
| `bau.lesen` | ✔ | ✔ | ✔ | S | ○ | BAU-01 |
| `bau.schreiben` | ✔ | ✔ | ✔ | — | — | LV, Bautagebuch (BAU-07) |
| `bau.aufmass_erfassen` | ✔ | ✔ | ✔ | **✔** | — | BAU-02, Rechenansatz preserved; granted, ceiling-narrowed to own assignments |
| `bau.aufmass_freigeben` | ✔ | ✔ | ✔ | — | — | BAU-03 countersignature |
| `bau.nachtrag_anmelden` | ✔ | ✔ | ✔ | — | — | BAU-04 `angemeldet_am` |
| `bau.nachtrag_einreichen` | ✔ | ✔ | ✔ | — | — | BAU-04 `eingereicht_am` |
| `bau.behinderung_erstellen` | ✔ | ✔ | ✔ | — | — | BAU-06, §6 VOB/B |
| `qualitaet.lesen` / `.schreiben` | ✔ | ✔ | ✔ | — | ○ | Reklamation intake; KD write blocked on O-74 |
| `dokument.lesen` | ✔ | ✔ | ✔ | S | ○ | DOC-04; KD additionally needs `sichtbar_fuer_kunde = true` |
| `dokument.schreiben` | ✔ | ✔ | ✔ | **✔** | — | DOC-06 upload from site; granted, ceiling-narrowed. MA read is `S` and additionally requires `sichtbar_fuer_mitarbeiter = true` (§21) |
| `dokument.kunde_freigeben` | ✔ | ✔ | ✔ | — | — | flips `sichtbar_fuer_kunde` |
| `dokument.aufbewahrung_verwalten` | ✔ | ○ | — | — | — | DOC-07 retention rules |
| `dokument.buendel_export` | ✔ | ✔ | ○ | — | — | DOC-08 |
| `kalender.lesen` | ✔ | ✔ | ✔ | S | ○ | CAL-01 |
| `kalender.schreiben` | ✔ | ✔ | ✔ | — | — | |
| `aufgabe.lesen` | ✔ | ✔ | ✔ | S | — | own assigned tasks — `zugewiesen_an`, or the team branch of `p_zustaendig` |
| `aufgabe.schreiben` | ✔ | ✔ | ✔ | **✔** | — | completing an assigned task; granted, ceiling-narrowed |
| `aufgabe.zuweisen` | ✔ | ✔ | ✔ | — | — | |
| `nachricht.lesen` | ✔ | ✔ | ✔ | S | ○ | own threads, via `nachricht_empfaenger.person_id` |
| `nachricht.senden` | ✔ | ✔ | ✔ | **✔** | ○ | MA replies in own threads under `withAnstellung`; KD send blocked on O-74 |

**`dokument.loeschen` does not exist as a key.** DOC-07 and LEG-01 make financial documents
undeletable, and a key that must never resolve true for the categories that matter is a key waiting
to be bound. Removal of a wrongly filed document is `dokument.archivieren` (soft, audited), and the
finance categories are excluded from it by the service.

### 12.4 People and time

| Right | SA | AD | LT | MA | KD | Note |
|---|---|---|---|---|---|---|
| `personal.lesen` | ✔ | ✔ | ✔ | **—** | **—** | never for worker or customer — the staff directory (D-09 §6, EMP-13) |
| `personal.erstellen` / `.aendern` / `.schreiben` | ✔ | ✔ | ✔ | — | — | own `person` data is `S`, §7.5 |
| `personal.stammdaten_lesen` | ✔ | ✔ | ○ | — | — | birth date, birthplace, nationality — column-protected (SEC-03, LEG-09) |
| `personal.entgelt_lesen` | ✔ | ○ | ○ | — | — | **K-05.** Default is not-granted for `leitung` and `admin` pending O-75 |
| `personal.entgelt_schreiben` | ✔ | ○ | — | — | — | |
| `personal.nachweis_lesen` / `.nachweis_verwalten` | ✔ | ✔ | ✔ | S | — | SEC-02, EMP-08 — hangs off `person_id` |
| `personal.bewacher_verwalten` | ✔ | ✔ | ✔ | — | — | SEC-03 Bewacherregister |
| `personal.zugang_verwalten` | ✔ | ✔ | ○ | — | — | `mitarbeiter_zugang`; **see §12.6** |
| `personal.zusammenfuehren` | ✔ | ○ | — | — | — | soft merge, audited (§8.8) |
| `personal.anstellung_beenden` | ✔ | ✔ | ✔ | — | — | revokes derived memberships and sessions (K-14) |
| `stammdaten.verwalten` | ✔ | ✔ | ✔ | — | — | qualification, absence-type and request-type catalogues |
| `dienstplan.lesen` | ✔ | ✔ | ✔ | S | ○ | TIM-01, TIM-04 |
| `dienstplan.schreiben` | ✔ | ✔ | ✔ | — | — | TIM-02, TIM-03 |
| `dienstplan.veroeffentlichen` | ✔ | ✔ | ✔ | — | — | |
| `dienstplan.arbzg_lesen` | ✔ | ✔ | ✔ | — | — | read a finding in one's own plan |
| `dienstplan.arbzg_pruefen` | ✔ | ✔ | ✔ | — | — | **K-06** — query the cross-entity load; audited per call |
| `dienstplan.arbzg_uebersteuern` | ✔ | ○ | ○ | — | — | TIM-06 **warning**, acknowledged with a written reason |
| `dienstplan.konflikt_quittieren` | ✔ | ✔ | ✔ | — | — | TIM-05 |
| `zeit.lesen` | ✔ | ✔ | ✔ | S | ○ | TIM-13 |
| `zeit.schreiben` | ✔ | ✔ | ✔ | — | — | recording for others; server clock only (invariant 5) |
| `zeit.korrigieren` | ✔ | ✔ | ✔ | — | — | immutable trail: who, when, why (TIM-11) |
| `zeit.checkin_verwalten` | ✔ | ✔ | ✔ | — | — | issue and revoke check-in links (TIM-07) |
| `zeit.nacherfassung_pruefen` | ✔ | ✔ | ✔ | — | — | TIM-09 promotion of an offline claim |
| `zeit.einwand_entscheiden` | ✔ | ✔ | ✔ | — | — | EMP-07 — raising one is `S`, deciding is a right |
| `zeit.antrag_entscheiden` | ✔ | ✔ | ✔ | — | — | EMP-10 leave and swap requests |
| `zeit.abwesenheit_lesen` | ✔ | ✔ | ✔ | S | — | health-adjacent; strictly scoped |
| `zeit.abwesenheit_melden` | ✔ | ✔ | ✔ | ✔ | — | EMP-10 — the one write right a worker holds |
| `zeit.abwesenheit_genehmigen` | ✔ | ✔ | ✔ | — | — | |
| `zeit.abwesenheit_grund_lesen` | ✔ | ✔ | ○ | — | — | Art. 9 DSGVO — reason, not merely absence |
| `zeit.konto_lesen` | ✔ | ✔ | ✔ | S | — | EMP-04, per employment (EMP-15) |
| `zeit.konto_abschliessen` | ✔ | ✔ | ✔ | — | — | monthly lock, one-way like an invoice |
| `zeit.konto_korrigieren` | ✔ | ○ | ○ | — | — | flows into the next month, never backwards |
| `zeit.freigeben_zur_abrechnung` | ✔ | ✔ | ✔ | — | — | TIM-12 |
| `zeit.exportieren` | ✔ | ✔ | ○ | — | — | ACC-12 payroll export |

### 12.5 Finance

DSH-01 gives a `leitung` revenue for their own area. EMP-13 makes every finance module structurally
unreachable for `mitarbeiter` — the internal-only ceiling, not a binding.

| Right | SA | AD | LT | MA | KD | Note |
|---|---|---|---|---|---|---|
| `finanzen.lesen` | ✔ | ✔ | ✔ | — | ○ | KD sees `festgeschrieben` invoices only, never drafts |
| `finanzen.schreiben` | ✔ | ✔ | ○ | — | — | drafts only; a finalised invoice is immutable (K-12) |
| `finanzen.entwurf_verwerfen` | ✔ | ✔ | ○ | — | — | **status transition `entwurf → verworfen`**, never a DELETE — see below |
| `finanzen.festschreiben` | ✔ | ✔ | ○ | — | — | one-way; §14 UStG pre-flight (FIN-04, LEG-05) |
| `finanzen.stornieren` | ✔ | ○ | ○ | — | — | reversing entry only (invariant 4); default pending O-77 |
| `finanzen.steuerfall_uebersteuern` | ✔ | ○ | ○ | — | — | §13b UStG / §48 EStG determination override, always audited (FIN-09, FIN-10, LEG-06) |
| `finanzen.herunterladen` | ✔ | ✔ | ✔ | — | ○ | signed URL, 15 min (DOC-03) |
| `versand.lesen` | ✔ | ✔ | ✔ | — | — | FIN-11, FIN-12 |
| `versand.freigeben` | ✔ | ✔ | ○ | — | — | passes `agent/policy.ts`; `requireMensch` |
| `nummernkreis.lesen` | ✔ | ✔ | ✔ | — | — | FIN-16 Rechnungsausgangsbuch |
| `nummernkreis.verwalten` | ✔ | ○ | — | — | — | TEN-02, FIN-03 |
| `zahlung.lesen` | ✔ | ✔ | ✔ | — | ○ | KD sees the payment status of their own invoices |
| `zahlung.schreiben` | ✔ | ✔ | ○ | — | — | ACC-04 CAMT.053 matching |
| `mahnung.lesen` | ✔ | ✔ | ✔ | — | ○ | |
| `mahnung.schreiben` | ✔ | ✔ | ○ | — | — | FIN-15 |
| `mahnung.freigeben` | ✔ | ✔ | ○ | — | — | approval required; `requireMensch` |
| `eingang.lesen` | ✔ | ✔ | ○ | — | — | FIN-14 |
| `eingang.schreiben` | ✔ | ✔ | ✔ | — | — | upload + OCR proposal (ACC-05) |
| `eingang.freigeben` | ✔ | ✔ | ○ | — | — | release for payment; `requireMensch`; default pending O-76 |
| `buchhaltung.lesen` | ✔ | ✔ | ○ | — | — | ACC-07, ACC-08 |
| `buchhaltung.schreiben` | ✔ | ✔ | ○ | — | — | |
| `buchhaltung.festschreiben` | ✔ | ✔ | ○ | — | — | period lock (ACC-01); default pending O-76 |
| `buchhaltung.exportieren` | ✔ | ✔ | ○ | — | — | ACC-02 DATEV, ACC-09 Z3, ACC-11 year-end package — interface only until O-05 |
| `buchhaltung_konfiguration.lesen` | ✔ | ✔ | ○ | — | — | |
| `buchhaltung_konfiguration.verwalten` | ✔ | ○ | — | — | — | account mapping, Steuerschlüssel — **blocked on O-05** |
| `bericht.lesen` | ✔ | ✔ | ✔ | — | — | REP-01 … REP-06, own area for `leitung` |
| `bericht.exportieren` | ✔ | ✔ | ○ | — | — | REP-07 |

**`finanzen.entwurf_verwerfen` is not a delete** (review B17). The draft granted
`rechnung.entwurf_loeschen` while its own database layer created no `DELETE` policy for finance
tables — a right that could not execute, and one whose obvious "fix" at implementation time would
have breached invariant 8 and LEG-01. The act is a status transition to `verworfen` with
`verworfen_am`, `verworfen_von` and `verworfen_grund`, executed through the `UPDATE` policy. **No row
is ever removed from `rechnung`**, and a discarded draft still has no number, which is why ROADMAP
Phase 6's "deleting 1000 drafts leaves zero gaps" holds by construction (FIN-03, invariant 4).

### 12.6 Rights that take over an authentication factor

`personal.zugang_verwalten` includes re-binding a worker's mobile number, which is a complete
takeover of their only authentication factor — and from that phone the holder can acknowledge a
Dienstanweisung (SEC-06), raise or withdraw a `zeit_einwand` (EMP-07) and check in (TIM-07),
destroying exactly the evidentiary value EMP-07 exists to create. The controls, all mandatory:

- old and new number recorded in `vorher` / `nachher` of the audit row;
- every session of the affected account revoked;
- a notification to the **old** number as well as the new one;
- the act is refused while an open `zeit_einwand` of that person is undecided.

```
// TODO(client, O-86): Should re-binding a worker's mobile number require a second approver
// (four-eyes), given that it hands one administrator the worker's only authentication factor?
```

### 12.7 Where the worker and the customer actually get their data

| Portal | Scope | Rights held | Rows reached |
|---|---|---|---|
| `mitarbeiter` | `person` (reads), `mandant` (the writes) | **reads:** none. **writes:** `zeit.abwesenheit_melden`, plus the four on-site acts — `wachbuch.schreiben`, `nachweis.schreiben`, `bau.aufmass_erfassen`, `dokument.schreiben` — and `schluessel.schreiben`, `aufgabe.schreiben`, `nachricht.senden` | reads through the `t_person` policies of §8.5 keyed on the subject; writes through `t_mandant` under `withAnstellung`. Both bounded by the K-04 form-A/B/C ceiling |
| `kunde` | `kunde` (reads), `mandant` (any write O-74 authorises) | `angebot.lesen`, `auftrag.lesen`, `objekt.lesen`, `dokument.lesen`, `finanzen.lesen`, `zahlung.lesen`, `nachweis.lesen`, `bau.lesen`, `qualitaet.lesen`, `nachricht.lesen` | reads through the `t_kunde` policies, each narrowed by `kunde_id = any (app.aktuelle_kunden())` and, for documents, by `sichtbar_fuer_kunde`; the K-04 customer ceiling on top |

This is the honest statement of EMP-13: a worker holds **no read right at all**, and the portal works
because the subject policy is structural. It is also why the two portals cannot run under group
scope — the row that would make them work there is a group right, and a group right is a management
right (K-18, §6.3).

**The seven worker write rights are granted, not `S`.** A restrictive ceiling narrows and never
grants, so a write with no right on the `t_mandant` path affects zero rows and reports success — the
silent failure this document exists to prevent. SEC-05, CLN-04, BAU-02 and DOC-06 all require a
worker to write something on site, so the right is in the matrix and the ceiling does the narrowing.
`zeiteintrag` is deliberately **not** among them: EMP-07 is explicit that an employee raises a
`zeit_einwand` and never edits a time entry, and TIM-08 puts the server clock in charge of the ones
they do create.

### 12.8 The DSGVO tension, stated rather than left silent (LEG-09)

`datenschutz.loeschung_pruefen` does not delete. It produces a **decision record** naming, per field
and per table, whether erasure is owed or overridden by a retention obligation —
`person.loeschsperre_bis` (§17 MiLoG two years, LEG-02; GoBD ten years, LEG-01), `audit_log`
immutability, and the invoice hash chain. Execution is anonymisation of the named fields plus
partition-level handling in `audit_log` (§10). The inventory of which field is erasable when is owned
by `02-datenmodell/01-KERN.md` §15; this document owns the right and the audit events.

---

## 13. Customer access (AUT-01, DOC-04, CRM-06)

### 13.1 Binding a customer login to a `kunde` row

`kunde_zugang (id, mandant_id, kunde_id, benutzer_id, ansprechpartner_id, status, eingeladen_von,
eingeladen_am, aktiviert_am, entzogen_am, entzogen_von)` — every timestamp `timestamptz` (invariant
2), `status ∈ {eingeladen, aktiv, entzogen}`, no hard delete.

**The review's B14 is correct.** The unique key is `(benutzer_id, mandant_id) WHERE entzogen_am IS
NULL`, **not** `benutzer_id` alone, and there is **no `benutzer.kunde_id` scalar**. A customer buying
from `reinigung` and from `bau` has two `kunde` rows in two mandanten; a unique constraint on
`benutzer_id` and a single mirrored column would foreclose the answer to a question the client has
not been asked, and CRM-06 ("customer history across all four areas") points the other way. The
customer identity is *resolved*, exactly as the staff identity is:

```sql
-- K-18: the customer portal is its own scope, so the resolver returns a SET, not a scalar.
create function app.aktuelle_kunden() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(kz.kunde_id), '{}')
    from public.kunde_zugang kz
   where kz.benutzer_id = app.aktueller_benutzer()
     and kz.entzogen_am is null
     and (kz.mandant_id = app.aktiver_mandant()                      -- mandant scope
          or (app.scope() = 'kunde'
              and kz.mandant_id = any (app.sichtbare_mandanten())));  -- kunde scope
$$;

-- retained for mandant scope, where exactly one element can match
create function app.aktueller_kunde() returns uuid
language sql stable as $$ select (app.aktuelle_kunden())[1] $$;
```

**A scalar resolver was the wrong shape, and CRM-06 is why.** One company served by `reinigung` and
by `security` is two `kunde` rows in two mandanten (that is what the unique key above says), so a
scalar would have shown that customer one of its two areas with no error — and under K-18 the
customer portal reads in `kunde` scope, where `app.aktiver_mandant()` is NULL and the scalar
resolver returns NULL for every row. `02-datenmodell/02-CRM-OPERATIONS.md` §1.4 owns the array form
and the twelve tables that key on it; this document fixes the contract.

The `kunde` branch of `app.sichtbare_mandanten()` (K-18) is derived from the same grant table: the
mandanten of the login's live `kunde_zugang` rows. That is a **subset** of K-18's wording ("the
customer's own `auftrag` / `angebot` / `rechnung` rows"), and deliberately the narrower one — a
customer reaches an entity only where access was actually granted under AUT-01/AUT-03, and setting
`entzogen_am` removes the entity from the set in the same statement rather than leaving it reachable
because an old invoice still exists. It is derived server-side and never read from the request (K-02).

Fail-closed by construction: with no row the array is empty, `= any('{}')` is false, both the
`t_kunde` policy and the restrictive ceiling are unsatisfied, and the session reads zero rows. In
**group** scope a customer reads nothing either — `app.ist_gruppenansicht()` is false for them and
`gruppe.<modul>.lesen` is not in the `kunde` role's bindings — because the group view exists for the
group, not for its customers.

Invitation: a holder of `system.benutzer_verwalten` issues an invitation with role `kunde` → Supabase
invite link → the customer sets a password → `kunde_zugang.status = 'aktiv'`. Whether one login may
carry two `kunde_zugang` rows with a customer-side area switcher, or whether each entity issues its
own login, stays open — `02-datenmodell/02-CRM-OPERATIONS.md` §4.1 and
`04-SEITENKARTE.md` both number that question **O-52**, and this document adopts that number
rather than raising a twentieth. The schema no longer answers it either way.

### 13.2 What a customer can see

| Area | Visible | Not visible |
|---|---|---|
| Orders and projects | own `auftrag`, `projekt`, status, deadlines, named manager | other customers' anything, internal task assignments |
| Offers | offers addressed to them, once released | `kalkulation` — cost base, margin, `stundensatz_intern` (internal-only ceiling) |
| Invoices | own `festgeschrieben` invoices, PDF and XRechnung, payment status, dunning level | drafts, the number circle, the Rechnungsausgangsbuch, other customers' invoices |
| Documents | own documents where `sichtbar_fuer_kunde = true` (DOC-04), through 15-minute signed URLs (DOC-03) | everything else, including the storage path |
| Proof of service | own `leistungsnachweis` and `aufmass` with the item snapshot as signed (CLN-04, BAU-02) | — |
| Wachbuch, Bautagebuch | **nothing, pending O-78** | see below |
| Messages | own thread | internal notes, CRM history, `rechtsgrundlage` |
| People | **nothing.** No names, no schedules, no certificates | the entire `personal` module is `—` for `kunde` |

Two of these are marked as assumptions rather than facts, because SPEC does not state them:

```
// TODO(client, O-91): Do customers see finalised invoices only, or should a draft ever be visible to
// them (e.g. a pro-forma agreed before finalisation)? The platform currently shows finalised
// invoices only.
// TODO(client, O-78): May a Wachbuch or Bautagebuch entry ever be shown to a customer? A
// Wachbuch is an incident record naming employees and third parties, so this is a question about
// employee data and §34a documentation, not a UI default. Both are `—` until answered — not a
// toggle a manager can flip.
```

Enforcement is fourfold and all four must hold: the `kunde` role's bindings (§12.7), the
service-layer scope predicate, the permissive `t_kunde` policy keyed on `app.aktuelle_kunden()`
(K-18, §8.5), and the restrictive `portal() = 'kunde'` ceiling on top. Another customer's record in
the same mandant returns **404**, exactly like a cross-tenant record (§9) — assertion 5 of the
isolation suite. A customer holding grants in two entities sees **both**, each labelled with its
entity (CRM-06, assertion 24); what they never see is a `kunde` row they hold no grant for, in any
entity.

```
// TODO(client, O-74): May a customer perform write actions in the portal — accept an offer with
// legal effect (OPS-09), report a Reklamation, send a message, upload a document — or is the
// customer portal read-only plus downloads? Until answered `KundeSchreibaktion` is `never` and
// the customer portal has no write path at all (§6.2).
// TODO(client, O-89): Does the customer portal need a counter-signature flow for the
// Leistungsnachweis (CLN-04), or is the on-site canvas signature the only path?
```

---

## 14. Agent and system principals (AGT-01, AGT-03, AGT-05, APR-07)

### 14.1 How an agent is authorised

An agent run is a service `benutzer` (§1.1) with its own `benutzer_mandant` rows and its own right
bindings, so **an agent's reach is edited in the same UI as a human's** (AGT-01) and appears in the
same matrix. It executes through `withSystemTenant(mandantId, grund, fn)` on `cse_job` with
`app.akteur_typ = 'agent'` and the run id carried for audit correlation (AGT-04). There is no back
door, no `service_role` shortcut and no separate rule engine.

Four limits hold independently of any binding:

| Limit | Mechanism | SPEC |
|---|---|---|
| An agent never approves | `requireMensch(ctx)` on every `*.freigeben`, `*.entscheiden` and every external send | invariant 7, APR-07, SOC-08 |
| An agent supplies no number and no input that determines one | every money, quantity or formula argument is a **handle** or a token from the run's number register — never a numeric literal or an expression string. `zuschlag_profil_id` is never a model argument, because choosing the surcharge profile is setting a price | invariant 6, **K-10**, AGT-02 |
| An agent cannot exceed its budget | `agent_budget.monatslimit_cent bigint` — integer cents (invariant 1, K-16); the SPEC §17 threshold of €20,000 is stored as `2000000`, never as a decimal. **The budget boundary is cents**; K-16(b) permits `*_mikrocent bigint` carry columns *inside* `agent_schritt` / `agent_budget` because model token pricing is genuinely sub-cent, converted to cents **once**, half-up, at this boundary — nothing invoiced, booked or exported is ever micro-cents. Exhaustion is a hard stop with notification, never silent degradation | AGT-05 |
| An agent's output leaves the system only through an approval | `server/agent/policy.ts` runs **after** authorization, reading `agent_richtlinie` (AGT-03), and the approval itself is chained per K-13 | invariant 7 |

### 14.2 The approval chain (K-13)

Approvals are the point at which an agent's proposal becomes an act, so the record of them is
immutable and ordered:

- Only `freigabe_snapshot` is chained — it is immutable. `freigabe` is a row whose status changes;
  hashing it would mean covering columns that change, or silently covering an undeclared subset.
- `freigabe_snapshot.kette_nr bigint` is assigned under `SELECT … FOR UPDATE` on a per-mandant
  `freigabe_kette` head row — the same construction as FIN-03 and for the same reason: without a
  serialised total order two concurrent approvers fork the chain and the nightly verification job
  reports a break every busy day.
- **APR-08 is measured server-side.** `GET /api/freigaben/[id]` writes
  `freigabe_ansicht(freigabe_id, benutzer_id, geoeffnet_am_server)`; the decision computes
  `pruefdauer_sek` from that row and is **refused when no view row exists**. `geoeffnet_am` never
  appears in a request body — a rubber-stamping detector that trusts a client timestamp is defeated
  by exactly the actor it targets, and then reports a fabricated distribution under a signed audit
  trail.

Rights: `freigabe.lesen` (APR-01), `freigabe.entscheiden` (APR-02, APR-03),
`freigabe.stapel_entscheiden` (APR-04 — never for items flagged for individual review),
`freigabe.einspruch_erheben` (APR-05 objection window), `freigabe.rueckgaengig` (APR-06 undo window),
`freigabe.pruefdauer_lesen` (APR-08), `agent.lesen`, `agent.aufgabe_starten`,
`agent.richtlinie_verwalten` (AGT-03), `agent.budget_verwalten` (AGT-05),
`agent.werkzeug_verbinden`, `agent.autonomie_setzen` — the last bounded by the SPEC §17 autonomy
matrix, in which "send an offer automatically" is not a configurable value at any price.

Defaults: `SA ✔` throughout; `AD ✔` for `agent.lesen`, `agent.aufgabe_starten`, `freigabe.lesen`,
`freigabe.entscheiden`; `LT ✔` for the same four; `agent.richtlinie_verwalten`,
`agent.budget_verwalten`, `agent.autonomie_setzen` and `agent.werkzeug_verbinden` are `SA ✔ / AD ○ /
LT —`; `freigabe.pruefdauer_lesen` is `SA ✔ / AD ○ / LT ○` and blocked on the §87 BetrVG question of
§11.2. `MA` and `KD` are `—` for the whole of `agent` and `freigabe`.

### 14.3 Jobs, n8n and the public form intake

| Caller | Mechanism | Bound by |
|---|---|---|
| Supabase cron / Edge Functions | `withSystemTenant(mandantId, grund, fn)` on `cse_job`; jobs iterate mandanten and never bypass RLS | per-job grants and policies enumerated in the job definition (K-01) |
| Vercel cron routes | `src/server/http/cron-auth.ts` verifies a rotating shared secret before the handler runs; the request is rate-limited and audited (`akteur_art = 'system'`, `akteur_dienst = 'job:<name>'`) | the same per-job grants |
| n8n (external glue only) | calls **only** named webhook endpoints that create a queued item for human review. It holds no session, no `benutzer`, and no right that writes a business record directly | the queue plus §7 approval |
| Public website form intake (REQ-01) | the public-renderer service principal holding exactly `oeffentlich.lesen`, plus a rate-limited intake endpoint that writes `formular_eingang` | `oeffentlich.lesen` and nothing else |

The draft asserted that n8n "authenticates as a `system` principal against a named, permissioned
endpoint" without defining a credential, which is the kind of sentence that becomes a shared secret
in an environment variable with no rotation (review MISSING). It is defined here: **a rotating scoped
secret verified by `cron-auth.ts`, one secret per integration, rotated on a schedule, with its own
rate-limit dimension and its own audit events** — and the integration may only enqueue.

---

## 15. TEN-06, TEN-07, TEN-10 — the switcher as an authenticated act

The switcher is the only UI that changes tenancy, so its interaction contract is part of this
document rather than only of DESIGN §6.

| Rule | Contract | Source |
|---|---|---|
| Rendered only for more than one area | `app.switcher_mandanten()` count > 1; a single-area user gets a static logo, no chevron, no dropdown | DESIGN §6 rule 1, TEN-06 |
| Live counters | `app.mandant_kennzahlen()`, restricted to `switcher_mandanten()` and filtered by the viewer's own read rights | TEN-10, DESIGN §6 rule 2 |
| Group entry carries `NUR LESEN` | the pill is rendered from `ansicht = 'gruppe'`, not from a prop | TEN-10, DESIGN §6 rule 3 |
| 3px identity-hue bar across the very top, **at all times** | rendered by the portal layout from the active mandant's hue; the neutral group hue in group view and in a context-less enrolment session (§3.3) | TEN-07, DESIGN §6 rule 4 |
| Keyboard: ⌘K opens, arrows navigate, Enter switches, Esc closes | **each row is a submit button inside its own form that POSTs to `/api/sitzung/mandant`**, so Enter activates a form submission and not a link. A GET can never switch the tenant (§4.5) | DESIGN §6 rule 5 |
| Switching lands on the new area's dashboard and is audited | the POST redirects to `/portal/<slug>`; two mirror audit rows | DESIGN §6 rule 6, TEN-09 |

The keyboard path is stated because it is the one place where an accessibility requirement and a
security rule could quietly collide: making the rows links would satisfy the keyboard contract and
break the POST-only rule.

---

## 16. The auth surfaces are in scope for BFSG / WCAG 2.1 AA (LEG-07, PUB-09)

Login, OTP entry, 2FA enrolment and verification, the area chooser, the switch interstitial, the
lockout message and the 404 page are all consumer- or worker-facing screens, and the worker screens
are additionally translated de / en / ar / tr (EMP-12). The requirements are not restated from
DESIGN §9 but applied to these screens specifically:

| Screen | Requirement |
|---|---|
| Login, OTP, TOTP entry | `<label>` bound to every input; `inputmode="numeric"` and `autocomplete="one-time-code"` on code fields; the code field is never split into six single-character inputs that break screen-reader flow |
| Every error | announced through `aria-live="polite"`, referenced by `aria-describedby`, and phrased in German without revealing whether the identity exists (§10.2) |
| Lockout | states that a retry is possible later; never "account locked", never a countdown that reveals the policy |
| Area chooser and switcher | fully keyboard-operable with a visible focus ring; the active area is marked by name and check mark, never by hue alone |
| 404 page | the standard page, identical for a wrong id and a foreign tenant, with a route back to the user's own dashboard |
| RTL | Arabic worker screens render with `dir="rtl"`; the hue bar and switcher mirror |

Colour is never the only signal: the identity hue always accompanies the entity's name.

---

## 17. SEC-A3 — the automated tenant-isolation suite

The highest-priority test in the codebase (SPEC §20). It is generated from the route manifest and the
schema, not hand-written, so it grows with them.

### 17.1 Fixtures

| Fixture | Detail |
|---|---|
| Mandanten | `reinigung` (A), `security` (B), plus `bau` and `operations` seeded |
| Users | `sa` (super_admin, global role, `aal2`); `sa_aal1` (same account at `aal1`); `admin_a` (modules {`auftrag`, `finanzen`}); `leitung_a`; `leitung_b`; `kunde_a1`, `kunde_a2` (same mandant, different `kunde`); `kunde_ab` (one login, `kunde_zugang` in A **and** B); `ma_p1` (one person, `anstellung` in **both** A and B); `ma_p2` (A only); `admin_neu` (2FA obligation, not yet enrolled); `dienst_web` (public renderer) |
| Records | at least one row per table in A and in B, one document per mandant in storage, one live check-in token, one consumed check-in token, one `benutzer_feed_token` |

### 17.2 Assertions

| # | Actor | Target | Surface | Expected |
|---|---|---|---|---|
| 1 | `leitung_a` | every entity id of B | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` | 404 |
| 2 | `leitung_a` | every RSC page route of B (deep link) | page request | 404 page, no layout flash |
| 3 | `leitung_a` | every server action with B's id in the payload | action POST | 404 |
| 4 | `leitung_a` | B's document | signed-URL mint | 404, no URL issued |
| 5 | `kunde_a1` | every record of `kunde_a2` in the same mandant | all surfaces | 404 |
| 6 | `ma_p1` | `zeiteintrag` of `ma_p2` | all surfaces | 404 |
| 7 | `ma_p1` | own shifts | worker portal list | rows from **both** A and B, each labelled with its entity (EMP-14) |
| 8 | `admin_a` | module `dienstplan` (not assigned) in A | all surfaces | 403 `KEINE_BERECHTIGUNG` |
| 9 | any actor | any mutation while `app.scope` is `gruppe`, `person` **or** `kunde` | route, action, service, raw SQL | refused at all four layers (K-18: `app.aktiver_mandant()` is NULL in all three, so every `t_mandant` `WITH CHECK` is false) |
| 10 | `leitung_a` | `POST /api/sitzung/mandant { mandantSlug: B }` | switch | 404, session unchanged, audited |
| 11 | unauthenticated | every portal route | — | 302 to login, never data |
| 12 | expired / consumed check-in token | check-in | — | one generic rejection, no session created |
| 13 | **`leitung_a`** | **`ma_p1`'s `anstellung` in B, and its `stundensatz_intern` by any route** | direct select, group scope, person view, report, `select *`, `app.entgelt_lesen` | **404 / no column / refused** — D-09 §6, K-05 |
| 14 | `leitung_a` | `ma_p1`'s `person` row | person view | **readable** — proving Class P is not over-restrictive |
| 15 | `ma_p1` | a colleague's `stundensatz_intern` | any surface | refused; the column is not granted to `cse_app` at all |
| 16 | `kunde_a1` | `app.portal()` | any request | never `intern`; every internal-only table returns zero rows |
| 17 | `ma_p2` | any `/portal/[mandant]` internal route | page request | redirected to `/portal/mein`; internal tables return zero rows |
| 18 | `sa_aal1` | every route except the 2FA allowlist | all surfaces | 403 `MFA_ERFORDERLICH`; `app.ist_super_admin()` is false |
| 19 | `admin_neu` | every route except the enrolment allowlist | all surfaces | 404 / 403; no tenant context is ever built |
| 20 | planner in A holding `dienstplan.arbzg_pruefen` | `app.arbzg_belastung` for `ma_p1` | service call | breach detected; **zero fields identifying the B shift** (K-06) |
| 21 | planner in A **without** `dienstplan.arbzg_pruefen` | the same call | service call | refused, audited |
| 22 | derived-membership trigger | `anstellung` insert then `austritt` for a person holding `leitung` in A | direct SQL | `leitung` survives both (K-14) |
| 23 | N concurrent clients | one check-in token | `POST /check-in/[token]` | exactly one `zeiteintrag` (K-09) |
| 24 | `kunde_ab` | their own records in A **and** in B | customer portal list, `kunde` scope | rows from **both**, each labelled with its entity (CRM-06); `app.aktuelle_kunden()` returns both `kunde` ids and `app.sichtbare_mandanten()` returns both mandanten |
| 24b | `kunde_ab` | `kunde_a1`'s records, in either mandant | all surfaces | 404 — a grant in an entity is not a grant to every `kunde` row in it |
| 25 | `dienst_web` | any table not carrying an `oeffentlich.*` policy | direct SQL | zero rows |
| 26 | any actor | `benutzer_sitzung` of another user | all surfaces, direct SQL | zero rows (Class S) |
| 27 | new `mandant` row | bindings, super-admin visibility, switcher entry | integration | all appear with **no deploy** (TEN-08); no `nummernkreis` is auto-created (O-01) |
| 28 | `ma_p2` | `objekt`, `dienstanweisung` and `wachbuch_eintrag` of their **own** Einsätze, and every other such row in the same mandant | worker portal, `person` scope, direct SQL | exactly the own-assignment rows are returned; every other row is 404 / zero rows — the form-C ceiling **and** its `t_person` counterpart, proven together (review B19) |
| 29 | `ma_p1` | a Wachbuch entry, an Aufmaß and a Leistungsnachweis on an own assignment | worker portal write, `withAnstellung` | each succeeds and lands in the mandant of **that** employment; the same write against a foreign assignment affects zero rows and raises `NotFoundError`, never a silent success |
| 30 | `ma_p1`, `kunde_ab` | every table in the class map | direct SQL under `app.scope = 'person'` / `'kunde'` | a non-empty result for at least one table per portal — the regression guard against a second blanket restrictive ceiling blanking both portals |
| 31 | `sa_aal1` holding `system.rolle_verwalten` | `DELETE FROM benutzer_mandant`, `DELETE FROM rolle_berechtigung` | direct SQL | refused (K-15 covers DELETE, §3.2), and refused again because neither table has a permissive `DELETE` policy at all |
| 32 | holder of a live `benutzer_feed_token` | `GET /api/kalender/feed/[token]` | `cse_anon`, `app.ical_feed_lesen` | only that user's own entries; a revoked token and an unknown hash return the same empty feed; no `mandant_id`, no colleague, no `objekt` the holder could not read interactively (CAL-03, K-08) |

### 17.3 Meta-tests against the schema

```sql
-- 1. every table carrying mandant_id has RLS enabled AND forced AND at least one policy
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = c.relname
                  and column_name = 'mandant_id')
   and (c.relrowsecurity = false or c.relforcerowsecurity = false
        or not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = c.relname));
-- must return zero rows
```

Plus, and this is what the draft's version missed (review B9): **every table in every application
schema — not only those carrying `mandant_id`, and not only those named in SPEC §22 — must appear in
the declared class map in `src/server/db/rls.ts`.** An unclassified table fails the build.

The schema list is itself a constant, `ANWENDUNGSSCHEMATA = ['public', 'kern', 'zeit_intern']`, read
by the meta-test and by the class map from one place. The draft scanned `public` and `zeit_intern`
only, which silently excluded `kern.anmeldeversuch`, `kern.audit_kette` and
`kern.audit_feld_klassifikation` — including the fastest-growing security table in the system — so
the assertion "every table appears in the class map" did not mean what it said. A fourth schema added
later fails the build until it is added to that constant, which is the point.

Plus:

- every anstellung-hung or person-hung table has a K-04 ceiling, in the correct one of the three
  keyed forms of §8.5 — the test asserts the form matches the columns the table actually has, which
  is what would have caught the `anstellung_id` predicate on `person`;
- **every table carries exactly one restrictive policy per non-internal portal, and none carries two**
  — the regression guard on the ANDed-ceiling defect;
- **no restrictive policy anywhere is written as `app.portal() = 'intern'`**;
- every table reachable in `person` or `kunde` scope has a permissive `t_person` / `t_kunde` policy,
  and no table has a ceiling for a portal it has no permissive path for (a ceiling with no policy
  behind it is a right the matrix promises and the database cannot serve);
- no `cse_definer` policy exists outside the registry of §8.2; no role holds `BYPASSRLS`; every
  `SECURITY DEFINER` function is owned by `cse_definer` and pins `search_path`;
- **exactly the five functions of K-08's closed register are `EXECUTE`-granted to `cse_anon` or
  `cse_checkin`, and no others**;
- no SELECT policy mentions `app.aal()`; no policy mentions `app.akteur_typ` or `app.ip`;
- and with `app.mandant_id` = A, `select count(*)` on every table returns zero B rows.

The suite runs on every pull request and is not skippable; a failure blocks merge. SEC-A3 is Phase 1
acceptance and is re-verified in Phase 10.

---

## 18. Indexes on the authentication hot paths

Stated here because this document creates the query shapes; the DDL lives with the tables.

| Index | Why |
|---|---|
| `benutzer_sitzung_token_key UNIQUE (token_hash)` | resolved on **every** request |
| `benutzer_sitzung_benutzer_idx (benutzer_id, letzte_aktivitaet_am desc) WHERE beendet_am IS NULL` | mass revocation on password / 2FA / role change, and the "active sessions" screen |
| `benutzer_sitzung_ablauf_idx (ablauf_am) WHERE beendet_am IS NULL` | the nightly expiry sweeper |
| `benutzer_mandant_key UNIQUE (benutzer_id, mandant_id) WHERE entzogen_am IS NULL` | `app.sichtbare_mandanten()` runs as an InitPlan on every statement of every request |
| `benutzer_mandant_mandant_idx (mandant_id, rolle_id) WHERE entzogen_am IS NULL` | the user list of an area |
| `benutzer_person_key UNIQUE (person_id) WHERE person_id IS NOT NULL AND deaktiviert_am IS NULL` | one login per human (EMP-14) |
| `kern.anmeldeversuch_ip_idx (ip, erstellt_am desc) WHERE NOT erfolg` | the windowed count on every login and OTP request, on the fastest-growing table in the system |
| `kern.anmeldeversuch_kennung_idx (kennung_hash, erstellt_am desc) WHERE NOT erfolg` | the per-identity dimension |
| `anstellung_person_idx (person_id, mandant_id)` | the `exists` inside `app.person_sichtbar` runs per person row; the worker ceiling subquery runs per statement; the K-06 aggregation needs it |
| `anstellung_mandant_idx (mandant_id, person_id) WHERE austritt IS NULL` | the staff list of an area |
| `checkin_token_hash_key UNIQUE (token_hash)` | the single probe of §5.3 |
| `checkin_token_fenster_idx (gueltig_bis) WHERE eingeloest_am IS NULL` | reissue and cleanup |
| `kunde_zugang_key UNIQUE (benutzer_id, mandant_id) WHERE entzogen_am IS NULL` | `app.aktuelle_kunden()`, in mandant **and** in `kunde` scope |
| `kunde_zugang_benutzer_idx (benutzer_id) WHERE entzogen_am IS NULL` | `app.aktuelle_kunden()` in `kunde` scope drops the `mandant_id` predicate, so the unique key above is no longer the access path |
| `feed_token_key UNIQUE (token_hash)` | CAL-03 — the single probe of `app.ical_feed_lesen` (§5.6) |
| `rolle_berechtigung_key UNIQUE NULLS NOT DISTINCT (rolle_id, berechtigung_id, mandant_id)` | exactly the `app.hat_recht` hot-path predicate; no second index is needed |
| per `audit_log` partition: `(mandant_id, erstellt_am desc)`, `(objekt_typ, objekt_id, erstellt_am desc)`, `(korrelation_id)`, `(akteur_benutzer_id, erstellt_am desc)` | `system.audit_lesen`, record history, request correlation, SEC-A9 forensics |

---

## 19. Deliberate non-goals

| Not built | Why |
|---|---|
| Support impersonation ("log in as this user") | Not in SPEC. It needs consent, a visible banner to the impersonated user, its own audit event class and a hard time box. If support access is wanted it is a designed feature, not a debug convenience |
| Single sign-on / SAML / social login | Not in SPEC. `auth.identities` leaves the door open without changing this design |
| API keys for third parties | Not in SPEC. n8n is external glue only and may only enqueue (§14.3) |
| Right inheritance or role hierarchies | Deny-by-default with an explicit matrix is auditable; inheritance is not, and "why can this person do that?" becomes unanswerable |
| A second authentication stack for workers | EMP-01 is Supabase phone OTP. A home-grown OTP store is a reversible secret in a readable row |
| Client-side permission enforcement | The UI hides what a user cannot do, but hiding is cosmetic (SEC-A1). Every check exists on the server |
| A per-user display time zone | Invariant 2: instants are stored UTC and displayed `Europe/Berlin`. A user-selectable zone puts a §17 MiLoG record and a shift boundary on different calendar days for two viewers of the same data (TIM-13, LEG-02, K-11) |

---

## 20. Open questions — the `TODO(client)` inventory

Every item below exists in the document as a labelled placeholder behind an interface (K-17) and must
be mirrored in `docs/DECISIONS.md` under **Open**.

**On the numbering.** `docs/DECISIONS.md` holds O-01 and O-04 … O-13; `08-PR-PLAN.md` claims
O-14 … O-29; sibling Phase 0 documents have already claimed O-30 … O-73. This document's nineteen
questions were numbered O-14 … O-32 in the draft, which collided with the PR plan on sixteen of them
and with four sibling documents on the rest — two different questions under one number is worse than
a gap, because a client answers the number. They are renumbered into the first free block,
**O-74 … O-92**, and each carries a **stable slug** so the question survives any later renumbering
DECISIONS.md imposes when it reconciles all Phase 0 documents at once.

| # | Slug | Question | Blocks |
|---|---|---|---|
| O-74 | `auth-kunde-schreibrechte` | May a customer perform write actions in the portal — accept an offer with legal effect (OPS-09), report a Reklamation, send a message, upload a document — or is the customer portal read-only plus downloads? | `KundeSchreibaktion`, §6.2, §13 |
| O-75 | `auth-entgelt-leitung` | May a Leitung read the internal hourly cost rates of their own area (they cost the jobs), or is that reserved to Geschäftsführung and Buchhaltung? | `personal.entgelt_lesen` default, K-05 |
| O-76 | `auth-leitung-freigaben` | Which approvals and administrative acts may a Leitung or an Admin hold: releasing an incoming invoice for payment, approving a booking, closing an accounting period, editing the permission matrix, assigning modules, editing security settings? SPEC §3 gives Leitung "approvals" without saying which | §12.1, §12.5 defaults |
| O-77 | `auth-storno-berechtigung` | Who may issue a Storno? Invariant 4 fixes the *mechanism* (reversing entry) and says nothing about the authority | `finanzen.stornieren` default |
| O-78 | `auth-wachbuch-kundensicht` | May a Wachbuch or Bautagebuch entry ever be shown to a customer? | §13.2 |
| O-79 | `auth-sitzungsdauer` | Session lifetimes per portal — idle and absolute — and the device-loss revocation process for worker phones | §4.3 |
| O-80 | `auth-sperrschwellen` | AUT-07 thresholds: attempts per identity and per IP, window, lockout duration, automatic expiry or manual unlock, and whether a locked account is notified | §10 |
| O-81 | `auth-missbrauchsschutz` | Anti-abuse on the public login and OTP endpoints without a third-party CAPTCHA (PUB-13): Postgres-side limiting only, or an EU-hosted challenge provider with a DPA? | §10 |
| O-82 | `auth-sms-anbieter` | Which EU-hosted SMS gateway delivers the OTP and the check-in link (DPA, D-04), and what monthly spend cap triggers a hard stop? | EMP-01, TIM-07 |
| O-83 | `auth-2fa-wiederherstellung` | 2FA recovery: how many super_admin accounts will exist, who holds each second factor, what is the break-glass procedure, and should the platform issue single-use recovery codes at enrolment? | §3.4 |
| O-84 | `auth-2fa-uebergangsfrist` | Grace period for 2FA enrolment on admin accounts existing before enforcement goes live — how many days, and on expiry does the account lock or does the role fall back to `leitung`? | §3.3 |
| O-85 | `auth-rollen-delegation` | Are roles beyond the five required, and may an Admin appoint another Admin / a Leitung a deputy? | §2 |
| O-86 | `auth-mobilnummer-vieraugen` | Should a second approver (four-eyes) be required to re-bind a worker's mobile number? | §12.6 |
| O-87 | `auth-austritt-login` | On `austritt`, is the worker login disabled immediately or kept for N days so the person can download their Stundennachweise (EMP-06)? | §5.1 |
| O-88 | `auth-doppelrolle-login` | Confirm: a Leitung or Admin who is also employed logs in with e-mail + password (+2FA) and reaches the worker portal from that same login; the SMS-only path is disabled for them | §5.1 |
| O-89 | `auth-nachweis-gegenzeichnung` | Does the customer portal need a counter-signature flow for the Leistungsnachweis (CLN-04)? | §13.2 |
| O-90 | `auth-zweitfaktor-festschreibung` | Should finalisation, Storno or DATEV export require a second factor at the moment of the act, even for a role with no standing 2FA obligation? | §3.2 |
| O-91 | `auth-entwurf-kundensicht` | Do customers see finalised invoices only, or may a draft ever be visible to them? | §13.2 |
| O-92 | `auth-aufbewahrung-telemetrie` | Retention for auth events and the DSGVO deletion concept for `audit_log` — confirm 30 days for `anmeldeversuch` and the GoBD period for permission changes | §10, §11.2 |
| O-06 (existing) | `betriebsrat` | Is there a Betriebsrat? §87 BetrVG governs login metadata, check-in audit trails, geolocation (LEG-10) and the APR-08 review-duration measurement | §11.2, §14.2 |
| O-01 (existing) | `operations-rechtstraeger` | Is CSE Operations a legal entity or a department? `mandant.ist_rechtstraeger` decides whether a fifth area gets a number circle | §7.3 |

---

## 21. Obligations this document places on its siblings

| Document | Obligation |
|---|---|
| `02-datenmodell/01-KERN.md` | `sitzung_ansicht` carries exactly the four K-18 scopes — `mandant · gruppe · person · kunde` — and **no `keine` value**: a fifth `ansicht` would be a fifth `app.scope`, which K-18 forbids, and the context-less enrolment session now creates no session row at all (§3.3 — a correction to what this document previously asked for). Add `benutzer.ist_dienstkonto boolean not null default false` so a service principal can never be issued an interactive session (§1.1). `kern.anmeldeversuch`, `kern.audit_kette` and `kern.audit_feld_klassifikation` keep the `kern.` prefix in every reference, and the class-map scan of §17.3 covers `public`, `kern` and `zeit_intern`. `audit_log` carries `ebene enum('plattform','mandant')` with `CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, platform rows readable only by `super_admin` (K-16(d), §8.5 Class A). The wage column is **`stundensatz_intern`** — no `_cent` suffix (K-05, §6.14). `benutzer`, `benutzer_mandant`, `rolle_berechtigung`, `mandant_kennzahl`, `kern.audit_kette` and `kern.audit_feld_klassifikation` each carry an explicit permissive policy or an explicit "no policy for `cse_app`" statement (§8.5 Class G / Class S). Seed the right keys of §12 and reconcile the `berechtigung.modul` vocabulary with §7.4 — in particular `dienstplan` is the module of `dienstplan.arbzg_pruefen` (K-06), not `einsatz` |
| `02-datenmodell/02-CRM-OPERATIONS.md` | `dokument` needs `sichtbar_fuer_mitarbeiter boolean not null default false` — the exact mirror of the `sichtbar_fuer_kunde` column it already declares, and for the same reason: DOC-04 makes customer visibility an explicit release rather than a consequence of the document's parent, and worker visibility is the same question with a different audience. Without it the worker `t_person` predicate on `dokument` has nothing to key on and either shows a worker every document hanging off an object they cleaned, or nothing at all. The visibility column is `sichtbar_fuer_kunde` throughout this document too — the draft called it `freigabe_kunde`, which is not the column. `kunde_zugang` unique key is `(benutzer_id, mandant_id) WHERE entzogen_am IS NULL`, never `benutzer_id` alone (§13.1); `app.aktuelle_kunden()` returns `uuid[]` and is the sole resolver behind both the `t_kunde` policies and the customer ceiling; the `kunde` branch of `app.sichtbare_mandanten()` is the mandanten of the login's live `kunde_zugang` rows (K-18, §13.1) |
| `02-datenmodell/04-PLANUNG-ZEIT.md` | `zeit.nacherfassung_pruefen` and `zeit.checkin_verwalten` appear in the seeded matrix of §12.4; the sessionless upload rules of §5.5 are enforced in the check-in service; `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` are the two `cse_checkin` rows of K-08's closed register and no third function is granted to that role |
| `02-datenmodell/05-FINANZEN.md` | `finanzen.entwurf_verwerfen` is a status transition, not a delete (§12.5); `nummernkreis` carries no `aal2` policy (§3.2); the customer's `rechnung` visibility clause is `status = 'festgeschrieben'` on top of `kunde_id = any (app.aktuelle_kunden())` (§8.5, §13.2) |
| `02-datenmodell/06-RADAR-KI-INHALT.md` | the agent budget boundary is `bigint` cents (`agent_budget.monatslimit_cent`); `*_mikrocent` carry columns are permitted **only** inside `agent_schritt` / `agent_budget` and are converted to cents once, half-up, at that boundary, with the rounding rule stated at the conversion site (K-16(b), §14.1) |
| `04-SEITENKARTE.md` · `05-API-KARTE.md` | `/portal/mein/**` reads run under `withPersonScope` and `/portal/kunde/**` reads under `withKundeScope`, **never** `withGroupScope` (K-18, §6.3); `GET /api/kalender/feed/[token]` executes `app.ical_feed_lesen` as `cse_anon` and opens no session helper (§5.6); the wage column is `stundensatz_intern` |
| `01-ORDNERSTRUKTUR.md` | the file it calls `03-AUTH-MODELL.md` and `04-BERECHTIGUNGSMODELL.md` is this single document, `03-AUTH-BERECHTIGUNGEN.md`; `requireKunde` yields a read-only context and customer writes go through `withKundenVorgang` with a closed action union (§6.2); the helper set is the **seven** of §6.3, and `withSystemTenant` needs `to cse_job` policies of its own — a table GRANT is not a policy under FORCE RLS |
| `docs/DECISIONS.md` | record as numbered entries: (a) in-tenant 403 versus cross-tenant 404 (§9.2); (b) RLS mirrors the tenant/portal/module decision but not input validation or the approval chain, a deliberate reading of AUT-05 (§8.10); (c) `/portal/mein` and `/portal/kunde` sit outside `[mandant]` because EMP-14 and CRM-06 require a cross-employment and cross-entity portal, a deviation from CLAUDE.md's structure block justified by K-07; (d) the nineteen new open questions **O-74 … O-92** of §20, together with the note that O-14 … O-29 belong to `08-PR-PLAN.md` and O-30 … O-73 to sibling Phase 0 documents, so this block was allocated above them rather than colliding |

---

## 22. Phase 1 acceptance mapped to this design

| ROADMAP Phase 1 criterion | Satisfied by | Proven by |
|---|---|---|
| A user of area A receives 404 on every entity of area B — direct fetch, API route, deep link | §8 RLS + §9 error mapper | §17.2 assertions 1–4 |
| No create/update path executes without exactly one active mandant | §6.2 types, §8.5 `WITH CHECK`, `set transaction read only`, absence of any write policy in **any** of the three multi-tenant scopes (K-18) | §17.2 assertion 9, plus a unit test per mutating service |
| Adding a fifth area requires a DB row only | §7.3, global role, platform-default bindings, `mandant.module` | §17.2 assertion 27 |
| Every switch and every auth event in `audit_log` | §11 catalogue, two mirror rows per switch | one test per catalogue entry asserting the row lands in the same transaction |
| 2FA for `super_admin` and `admin` | §3.2 six layers, K-15 | §17.2 assertions 18–19 |
| Five roles with rights editable in the UI | §7, §12 | flip a binding, assert the next request reflects it with no restart |
| `person` / `anstellung` split from the first migration (D-09) | §5.1, §8.5 Class P, §8.6, §8.7 | §17.2 assertions 13–15, 20–22 |
| Mandant switcher per DESIGN §6, group view read-only | §15, §4.4 | `switch.spec.ts`, §17.2 assertions 9–10 |
