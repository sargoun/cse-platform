# Phase 0 — Seitenkarte (page map)

Every URL the platform will contain, with the scope it runs in, the permission key that
gates it, the SPEC features it serves and the ROADMAP phase that ships it. A route absent
from this map is a route nobody builds; a route present here is the contract the
implementing PR is reviewed against. The map is bound by `00-KONVENTIONEN.md` — where an
earlier draft of this document disagreed with a convention, the convention won and the
draft was corrected, with the `K-id` cited inline. It is also bound to its Phase 0
siblings: the URL namespace of `01-ORDNERSTRUKTUR.md`, the principals, session helpers,
right keys and portal ceilings of `03-AUTH-BERECHTIGUNGEN.md`, and the tables of
`02-datenmodell/`. Where this document names a right, that right exists in the seeded
catalogue of `03-AUTH-BERECHTIGUNGEN.md` §12; no page in this map invents one.

---

## 1. How to read this map

### 1.1 URL namespace (K-07)

The portal lives under `/portal`. Public marketing keeps the root. This is not a
preference: without the prefix `/reinigung` is simultaneously a public company profile and
a tenant dashboard, Next.js route groups contribute no path segment, and one of the two
silently wins — either every mandant switch lands a manager on a marketing page, or the
four short marketing URLs 404. There is no configuration in which both work.

```
/                          public website — the group
/unternehmen               public — the four areas (PUB-01)
/unternehmen/[bereich]     public company profile — the canonical entity URL (PRO-01..PRO-05)
/angebot/[bereich]         public offer request (REQ-01..REQ-07)
/karriere/[stelle]         public career pages (REC-03)
/auth/…                    login, 2FA, invitation, worker phone login (AUT-02, AUT-07, EMP-01)
/portal/[mandant]/…        tenant portal — the staff application (TEN-04, invariant 10)
/portal/gruppe/…           group view, read-only (TEN-05, TEN-10)
/portal/mein/…             worker portal, person-scoped (EMP-01..EMP-15)
/portal/kunde/…            customer portal (AUT-01 `kunde`, DSH-03, CRM-06)
/portal/konto/…            account settings of the signed-in principal (AUT-02, NOT-02, CAL-03)
/check-in/[token]          tokenised shift check-in, session-less (TIM-07..TIM-10)
/api/…                     non-UI callers only — webhooks, cron, downloads, feeds, token endpoints
```

**The four short public URLs `/reinigung`, `/security`, `/bau`, `/operations` do not
exist.** An earlier draft kept them as 308 redirects; they are deleted. `/unternehmen/[bereich]`
is the single canonical entity URL (one JSON-LD graph, one set of inbound links, no
duplicate content), and a short root-level redirect per area would have to be added by hand
for a fifth area — which TEN-08 forbids. Per-area domains, if the client wants them, are a
host rewrite (`sse-security.de/*` → `/unternehmen/security/*`) with the canonical tag
following the chosen host, and no route change (O-08).

### 1.2 Segment families and their shells

| Family | Directory | Shell | Session | `app.portal` (K-04) |
|---|---|---|---|---|
| `(public)` | `src/app/(public)/` | public header 72px, blurred once scrolled, footer with the four NAP blocks (DESIGN §5) | none | — |
| `auth` | `src/app/auth/` | bare centred card; **no** sidebar, **no** switcher, **no** identity hue | none (that is the point) | — |
| `portal/[mandant]` | `src/app/portal/[mandant]/` | app shell: 3px identity-hue bar, mandant switcher, sidebar 248px, bottom tab bar under `md` | yes | `intern` |
| `portal/gruppe` | `src/app/portal/gruppe/` | app shell with a **neutral** `--border-strong` top bar and the `NUR LESEN` pill; no primary buttons anywhere | yes | `intern` |
| `portal/mein` | `src/app/portal/mein/` | worker shell: no sidebar, no switcher, bottom tab bar always, entity badge per shift, de/en/ar/tr + `dir="rtl"` | yes (person) | `mitarbeiter` |
| `portal/kunde` | `src/app/portal/kunde/` | customer shell: own top bar with the supplying entity's name, no staff sidebar, no switcher, no counters | yes (customer) | `kunde` |
| `portal/konto` | `src/app/portal/konto/` | inherits the shell of the portal the session is in; content is portal-neutral | yes | any |
| `check-in/[token]` | `src/app/check-in/[token]/` | one screen, one primary button, no scrolling (DESIGN §8) | **none — token only** | — |
| `(dev)` | `src/app/(dev)/` | styleguide only, never deployed to production | yes, global role | `intern` |

**The `app.portal` column is a bound value, not a derived one (K-20).** In `/portal/[mandant]`
there is an active membership and K-04's derivation from that membership's role applies. In
the three multi-tenant scopes there is none — `app.mandant_id` is NULL there by construction
(K-02) — so `app.portal` is **bound when the scope is entered** and is never recomputed from
`app.aktiver_mandant()`. Recomputing it there falls through to the fail-closed `mitarbeiter`
and produces exactly the two silent failures this map cannot afford: every K-04 worker
ceiling fires **inside the group view**, so a `leitung` reads nothing on `/portal/gruppe/**`
and sees an empty page rather than a denial; and every customer is ceilinged as staff on
`/portal/kunde/**`. The four bound values are the column above: `intern` in `mandant` scope
when the active membership's role is `super_admin`/`admin`/`leitung`, `intern` in `gruppe`
scope, `mitarbeiter` in `person` scope, `kunde` in `kunde` scope. `/portal/konto` inherits
whichever of the four the session already holds and asserts none of its own (§9).

`portal` is a **literal** segment, not a route group, because K-07 requires it in the URL.
`(public)` and `(dev)` stay route groups: they share a layout and contribute no path
segment. `auth` is a literal segment so that the login screens live in one namespace and
`03-AUTH-BERECHTIGUNGEN.md`'s `redirect('/auth/login?weiter=…')` resolves.

**Why `mein`, `kunde` and `konto` are siblings of `[mandant]` and not children of it.**
EMP-14 gives one login per *person* and requires the portal to show shifts from all
employments, each labelled with its entity; EMP-15 requires hours combined across
employments while `stundenkonto` stays per employment. CRM-06 requires a customer history
across all four areas. Neither read scope is "one mandant", so nesting them under
`[mandant]` would either lie about the scope or force a cleaner who also guards to log in
twice. Account facts — the second factor, the notification channel, the language, the iCal
token — belong to the `benutzer`/`person`, and four editable copies of one truth under four
mandant paths is how a language change stops arriving. Writes are unaffected: every write
in these families resolves exactly one mandant **from the record**, server-side (§1.3), so
invariant 10 holds without exception.

### 1.3 Scope tokens and the seven session helpers (K-02, K-08, K-18)

The **Scope** column of every table below uses these tokens. They are not labels; each one
names a helper from `03-AUTH-BERECHTIGUNGEN.md` §6.3, and `tests/invariants/route-manifest.test.ts`
asserts that no route reaches the database outside one of them or outside the K-08 register.

**`app.scope` has four values — `mandant · gruppe · person · kunde` — not two** (K-18). The
employee portal and the customer portal genuinely span tenants, but they span them **as a
subject**, not as a manager, and each gets its own SELECT-only policy keyed on the subject.
Routing them through group scope, as an earlier draft of this map did, is a category error
with a concrete consequence: K-03's group policy requires `gruppe.<modul>.lesen`, a
management right no `mitarbeiter` and no `kunde` holds in the seeded matrix
(`03-AUTH-BERECHTIGUNGEN.md` §12), so **both portals would read zero rows** — empty, not
denied, with no error to notice — and widening that right to fix it would hand every cleaner
a group-level read of the platform. `app.mandant_id` is NULL in all three multi-tenant
scopes and `app.mandant_ids` carries the set, always derived server-side (K-02, K-18).

| Token | Helper | `app.scope` / `app.readonly` | Meaning |
|---|---|---|---|
| `—` | none | — | unauthenticated; reads only published content through the public service principal (§2.7) |
| `M1` | `withTenant(ctx, fn)` | `mandant` / `off` | **exactly one active mandant**, resolved from the server session (invariant 3, TEN-04). The only context that may write |
| `GRP` | `withGroupScope(ctx, fn)` | `gruppe` / `on` | read-only aggregation over `app.sichtbare_mandanten()` gated on `gruppe.<modul>.lesen` per mandant; **no write policy exists anywhere for this scope** (K-03), so a write is refused by Postgres, not only by a service check |
| `PER` | `withPersonScope(ctx, fn)` | `person` / `on` | read across every `anstellung` of the signed-in `person` (EMP-14, EMP-15) through the **`t_person`** policy of K-18 — `app.scope() = 'person'` and `mandant_id = any (app.sichtbare_mandanten())` and the row belongs to `app.aktuelle_person()` — with the restrictive K-04 worker ceiling applying on top. `sichtbare_mandanten()` is derived server-side from the person's live `anstellung` rows |
| `PER→M1` | `withAnstellung(ctx, anstellungId, fn)` | `mandant` / `off` | a worker write: the mandant is resolved **from the record**, never from the caller (§1.3.1) |
| `KDN` | `withKundeScope(ctx, fn)` | `kunde` / `on` | read across the mandanten in which the login holds a live `kunde_zugang`, through the **`t_kunde`** policy of K-18 — `app.scope() = 'kunde'` and `mandant_id = any (app.sichtbare_mandanten())` and `kunde_id = any (app.aktuelle_kunden())` — with the restrictive K-04 customer ceiling on top. `sichtbare_mandanten()` **and** `app.aktuelle_kunden()` are derived server-side from those `kunde_zugang` rows and **never** through `app.aktiver_mandant()`, which is NULL in this scope (K-20) |
| `KDN→M1` | `withKundenVorgang(ctx, aktion, vorgangId, fn)` | `mandant` / `off` | a customer write. The action union is **`never` until O-74 is answered**; today no such route exists and none is listed |
| `USR` | **not a helper — a table class**, read in whichever scope the session already holds | inherited | `benutzer`, `benutzer_sitzung`, `benutzer_feed_token`, `benutzer_mandant` (read), and the caller's own `person` row through the self-access branch of `03-AUTH-BERECHTIGUNGEN.md` §7.5. Their Class S / Class G policies are keyed on `benutzer_id = app.aktueller_benutzer()`, never on `app.aktiver_mandant()`, so they resolve identically in `mandant`, `gruppe`, `person` and `kunde` scope — which is what lets `/portal/konto` render inside any portal shell (§1.2, §9) without a tenant of its own. It is **not** "no `mandant_id` table is touched": `benutzer_mandant` carries one, and the row says so |
| `FEED` | none — the K-08 register function `app.ical_feed_lesen(feed_token_hash)` as `cse_anon` | — | the iCal feed (CAL-03). It opens **no session helper at all**: the function resolves `benutzer_feed_token` to one `benutzer_id` and returns that user's own entries through the allowlist of §9.1 |
| `TOK` | none — K-08 register functions only | — | the check-in path and its offline replay. No session, therefore no GUCs, therefore every K-03 policy is false for it; it does no table access of its own (§4) |

#### 1.3.1 The `PER→M1` write rule, stated as a numbered rule

An `anstellung_id` arriving from a phone is client state. The resolution order is fixed,
and it is the same shape as the `[mandant]` rule of §1.5:

1. Zod-parse the body at the boundary (SEC-A4); `mandant_id` is **never** an input field.
2. Load the `anstellung` under the caller's own session. The K-04 restrictive ceiling
   limits `anstellung` to rows where `person_id = app.aktuelle_person()`, so a foreign
   employment is simply **not there**.
3. Not found → `notFound()`, **HTTP 404, never 403** (AUT-06). A 403 would confirm that the
   employment exists.
4. `austritt` set and the target date after it → 404 by the same path.
5. `withAnstellung(ctx, anstellungId, fn)` opens an ordinary single-mandant transaction
   with `app.mandant_id` taken from the row, and the service re-checks the same predicate
   (AUT-04: the layout check is never the only check).
6. `audit_log` records the resolution path, so "which entity did this write land in" is
   answerable afterwards (SEC-A9).

D-09 consequence 5 — *time never crosses invoice circles* — holds because the row hangs off
exactly one `anstellung`, which belongs to exactly one mandant.

### 1.4 Permission keys

Roles (AUT-01) are only the **default bundle**; AUT-03 makes every binding editable per
role **per mandant**, so each route is gated on a permission key, never on a role name. Key
shape and vocabulary are owned by `03-AUTH-BERECHTIGUNGEN.md` §7.2 and §7.4:

```
schluessel := <modul> '.' [<objekt> '_'] <aktion>
gruppe.<modul>.[<objekt> '_'] <aktion>    -- the group-scope read keys (K-03)
```

The optional `<objekt>` segment is part of the **group** form too — `gruppe.system.audit_lesen`
is `modul = system`, `objekt = audit`, `aktion = lesen`, three dot-separated segments and
therefore inside `01-KERN.md` §6.6's `CHECK (schluessel ~ '^[a-z_]+(\.[a-z_]+){1,2}$')`. Without
that segment the cross-entity audit log has no expressible key at all: `aktion` is an enum, so
a fourth segment cannot be added and `audit` cannot become an action.

`app.hat_recht(p_recht text, p_mandant uuid)` **takes a mandant argument** (K-03): a global
permission predicate would carry a right granted in one entity into every other entity the
user can reach, which is precisely the leak RLS exists to stop. Four notations appear in the
**Right** column:

| Notation | Meaning |
|---|---|
| `modul.aktion` | the key `app.hat_recht` is asked for, in the active mandant |
| `a + b` | both keys are required |
| `S` | **no right at all** — the row is reached through the self-access policy branch keyed on the server-set `app.person_id` GUC (`03-AUTH-BERECHTIGUNGEN.md` §7.5). Acknowledging an instruction, raising an objection and reporting an absence are acts of the subject, not rights a role can hold, so no role — `super_admin` included — can perform them on someone else's behalf. The notation follows the catalogue: where §12 marks a role's cell `S` this map writes `S`, and where it marks it `✔` this map writes the key. The customer portal is the second case — its rows are narrowed by the `t_kunde` subject predicate, but the routes are still gated on granted module keys (§8) |
| `Sitzung` | authenticated only; the route reads the principal's own account rows (`USR`) |

Two rules hold for **every** row in every table below and are therefore not repeated:

- **AUT-04 / SEC-A1** — authorization runs server-side in the segment layout *and* again in
  the service. A hidden nav item is not an access control. Every input is Zod-parsed at the
  boundary (SEC-A4) and no route ships an API key to the client (SEC-A5).
- **AUT-06 / SEC-A3** — a request for an entity belonging to another mandant, or to another
  customer inside the same mandant, renders `not-found.tsx` and returns **HTTP 404, never
  403** — deep links, direct fetches, server actions and API routes alike.

The permission editor renders keys carrying `berechtigung.nur_global` as permanently
disabled with the reason shown (`system.mandant_verwalten`,
`system.zwei_faktor_zuruecksetzen`); every other key is grantable per mandant, which is why
this document never writes that a role "may never" hold one. **`oeffentlich.lesen` is not
one of them** — an earlier draft of this section listed it, and that was wrong in a way that
switches the public website off: `01-KERN.md` §6.7's `rb_nur_global_pruefen` trigger refuses
to bind a `nur_global` right to a mandant-scoped role at all, and the `t_oeffentlich`
policies of `02-datenmodell/02-CRM-OPERATIONS.md` §1.6 and
`02-datenmodell/06-RADAR-KI-INHALT.md` §1.6 call `app.hat_recht('oeffentlich.lesen',
mandant_id)` **per row**, so the key must be an ordinary per-mandant binding held by the two
service principals of §2.7. It is granted to none of the five seeded roles; that is a
default, not a constraint. The defaults, including the ones still open
(O-75 … O-77 — `auth-entgelt-leitung`, `auth-leitung-freigaben`, `auth-storno-berechtigung`),
live in `03-AUTH-BERECHTIGUNGEN.md` §12 and are not restated here.

**Approval keys compose, they do not replace.** `freigabe.entscheiden` opens the approval
inbox; deciding an item additionally requires the right that the underlying act would need
in that mandant — a DATEV booking proposal needs `buchhaltung.schreiben`, an outbound offer
needs `angebot.versenden`, a dunning proposal needs `mahnung.freigeben`. Otherwise a
`leitung` holding no `buchhaltung.*` approves a booking into the ledger from the inbox, and
the approval screen becomes a permission bypass with a diff view on top.

### 1.5 The `[mandant]` segment is routing, never authority (K-02)

The segment exists so URLs are shareable, bookmarkable and legible, and so the shell can
paint the right identity hue on first paint (TEN-07). It is user input, validated against
the session, never trusted. The rule is implemented once, in
`src/app/portal/[mandant]/layout.tsx`:

| Case | Behaviour | Status |
|---|---|---|
| slug equals the active mandant's slug | proceed | 200 |
| slug is a mandant the user **is** a member of, but not the active one | render the **switch interstitial in place** — "Dieser Bereich gehört zu REALTIME Service GmbH. Wechseln?" with a POST button. A GET never switches the tenant. Audited as `sitzung.wechsel_angeboten` | 200 |
| slug is a mandant the user is **not** a member of | `notFound()` | **404** |
| slug does not exist in `mandant` | `notFound()` | **404** |
| slug is a reserved portal segment | handled by its own route; never resolved as a mandant | — |
| no session | redirect to `/auth/login?weiter=<path>` | 302 |

There is **no `/portal/[mandant]/wechseln` route.** An earlier draft redirected a non-active
member slug to such a page — which sits under the very layout that performed the check, so
rendering it re-ran the comparison and redirected to itself: an infinite loop whose only
escape was clearing the session. The interstitial is rendered by the layout that detected
the mismatch, and the switch is `POST /api/sitzung/mandant` (§10), because switching writes
two mirror `audit_log` rows (TEN-09) and a GET must not mutate an audit trail.

`params.mandant` is never passed to a service. An ESLint rule forbids reading it outside the
`[mandant]` layout, and `tests/invariants/session-context.test.ts` asserts a single
construction site for `SessionContext`.

### 1.6 Reserved segments, static-versus-dynamic, and the CI test (TEN-08)

`mandant.slug` carries a `CHECK` excluding the static first segments under `/portal`:
**`gruppe`, `mein`, `kunde`, `konto`** — plus `api`. K-07 mandates the mechanism that keeps
that honest: `tests/invariants/reservierte-slugs.test.ts` walks the App Router tree and
**fails when a static segment that shares a level with a dynamic one is missing from the
constraint that guards that level**. TEN-08 promises a fifth area needs a DB row and no code
change; a hand-maintained list with no test does not deliver that.

**The test's scope is every level at which a dynamic segment has static siblings, not only
`src/app/portal/`** — an earlier draft said "every static first segment under
`src/app/portal/`" while the table below already relied on the same test for
`/karriere/[stelle]`, which is not under that tree, so the test as described could not
enforce what the table promised. The levels walked are: `src/app/portal/`,
`src/app/(public)/karriere/`, `src/app/(public)/unternehmen/`, `src/app/(public)/angebot/`,
`src/app/(public)/leistungen/`, `src/app/(public)/news/` and `src/app/(public)/projekte/`.
For each it collects the static children of the level and asserts every one of them is
excluded by the `CHECK` on the column that fills the sibling dynamic segment. A level with a
dynamic segment and no static sibling is still walked, so adding one later fails the build
rather than shadowing a row.

The failure mode exists wherever a dynamic segment shares a level with a static sibling,
because the App Router matches static before dynamic and does not backtrack:

| Level | Dynamic segment | Static siblings | Reservation |
|---|---|---|---|
| `/portal/[mandant]` | `mandant.slug` | `gruppe`, `mein`, `kunde`, `konto` | `CHECK` on `mandant.slug` + the CI test |
| `/unternehmen/[bereich]` | `mandant.slug` | none | the CI test asserts the level stays empty |
| `/angebot/[bereich]` | `mandant.slug` | none — see §2.3 | the CI test asserts the level stays empty |
| `/karriere/[stelle]` | `stelle.slug` | `initiativbewerbung`, **`danke`** | `CHECK` on `stelle.slug` + the same CI test |
| `/leistungen/[slug]`, `/news/[slug]`, `/projekte/[slug]` | `seite.pfad` (last segment), `social_post.slug`, `referenz.slug` | none | the CI test asserts each level stays empty |

**`seite` is addressed by `pfad`, not by a `slug` column.**
`02-datenmodell/06-RADAR-KI-INHALT.md` owns the table and declares
`seite.pfad` with `CHECK (pfad ~ '^/[a-z0-9/-]*$')` — a whole path, not a single segment — so
`/leistungen/[slug]` resolves the row whose `pfad` is the requested path and the reservation
column above is empty because that level has no static sibling to shadow. `stelle`,
`referenz` and `social_post` genuinely need a URL key and today have none; adding
`stelle.slug` (with the `CHECK` excluding `initiativbewerbung` and `danke`), `referenz.slug`
and `social_post.slug` is an obligation this map places on that document (§17), and until it
is met `tests/invariants/reservierte-slugs.test.ts` cannot be written for the
`/karriere/` level at all.

`danke` is the second static sibling of `[stelle]` (§2.1) and was missing from an earlier
draft's reservation column. Without it a `stelle` with slug `danke` is unreachable — the
exact failure this section exists to close, and one the CI test now catches because it reads
the tree rather than a hand-written list.

An earlier draft placed the offer confirmation at `/angebot/[bereich]/danke` while the four
area forms were **static** folders. `/angebot/reinigung` would then have resolved against
the static folder, which has no `danke` child, so every confirmation 404s after the lead has
already been written — and the submitter, seeing an error page, submits again, filling the
REQ-05 SLA queue with duplicates. §2.3 makes the whole `[bereich]` path dynamic.

### 1.7 Module availability is a row, not a `switch` (TEN-08)

A route under `/portal/[mandant]/<modul>/…` returns `notFound()` when `<modul>` is not
enabled for the active mandant. Enablement is `mandant.module text[]`, read once in the
`[mandant]` layout and intersected again inside `app.hat_recht` (stage 4 of
`03-AUTH-BERECHTIGUNGEN.md` §7.3). It is never a literal comparison against a trade name,
because that would make a fifth area a code change.

| Module (`berechtigung.modul`) | `reinigung` | `security` | `bau` | `operations` |
|---|---|---|---|---|
| `system`, `gruppe`, `datenschutz`, `dokument`, `kalender`, `aufgabe`, `nachricht`, `bericht` | ✓ | ✓ | ✓ | ✓ |
| `crm`, `crm_entgelt`, `formular`, `angebot`, `kalkulation`, `auftrag`, `katalog` | ✓ | ✓ | ✓ | ? see below |
| `objekt`, `objekt_import`, `stammdaten` | ✓ | ✓ | ✓ | ✓ |
| `personal`, `dienstplan`, `zeit` | ✓ | ✓ | ✓ | ✓ |
| `reinigung`, `nachweis` (Leistungsnachweis) | ✓ | – | – | – |
| `security`, `dienstanweisung`, `wachbuch`, `schluessel` | – | ✓ | – | – |
| `bau` | – | – | ✓ | – |
| `qualitaet` | ✓ | ✓ | ✓ | ? see below |
| `abrechnung` — billing type per contract, §13b evidence, §48b certificates | ✓ | ✓ | ✓ | **blocked on O-01 and O-33** |
| `finanzen`, `versand`, `nummernkreis`, `zahlung`, `mahnung`, `eingang` | ✓ | ✓ | ✓ | **blocked on O-01** |
| `buchhaltung`, `buchhaltung_konfiguration` | ✓ | ✓ | ✓ | **blocked on O-01** |
| `radar`, `vergabe` | ✓ | ✓ | ✓ | ? see below |
| `social`, `referenz` | ✓ | ✓ | ✓ | ✓ (also owns the group-level public pages) |
| `recruiting` | ✓ | ✓ | ✓ | ✓ |
| `agent`, `freigabe` | ✓ | ✓ | ✓ | ✓ |

**Two corrections to an earlier draft, both of the same kind.** Raumbuch (`objekt`) and the
floor-type catalogue (`stammdaten.belagsart`) were gated to `reinigung`. They are OPS-02,
OPS-03 and OPS-04 — SPEC §7 *Operations* requirements, deliberately kept out of the
CLN-01…CLN-05 cleaning block — and `03-AUTH-BERECHTIGUNGEN.md` §7.4 puts `raum` in the
`objekt` module. Security posts and construction sites need room-level area data too, and
the customer portal offers a read-only Raumbuch for every entity. Only the cleaning-specific
*derivations* — Reviere, Turnus, Leistungsnachweise, the `m² ÷ Leistungswert` costing — are
in the `reinigung` module.

The `?` cells are the second correction: an earlier draft decided Radar = off and
Kundenportal = off for `operations` in a table, while raising "does CSE Operations sell to
external customers at all?" as an open question elsewhere in the same document. A module
default *is* an answer to that question, so it is not decided here (K-17).

**The `?` set is exactly ten modules, and the TODO below names those ten and no others** — an
earlier draft marked nine cells, listed five in the TODO and then spoke of "the four
modules", three counts for one seed, which is not something a Phase 6 seed can be written
against. The ten are `crm`, `crm_entgelt`, `formular`, `angebot`, `kalkulation`, `auftrag`,
`katalog`, `qualitaet`, `radar`, `vergabe`. `qualitaet` joined them in this pass: a
Reklamation is raised by an external customer against an `auftrag` or an `objekt` (§5.6), so
enabling it for an area that has neither `auftrag` nor customers answers O-33 by the back
door, exactly as `radar` did. `abrechnung` is listed separately because it is blocked twice
over — it needs external customers (O-33) *and* an entity that issues its own invoices
(O-01) — and a single `?` would hide one of the two.

```ts
// TODO(client): O-01 — is CSE Operations a GmbH or an internal department? A legal entity
// gets `mandant.ist_rechtseinheit = true`, its own number circle (TEN-02) and the
// finanzen/buchhaltung modules; a department gets none of them and bills through one of
// the other three. No `nummernkreis` row is created for any mandant automatically.
// TODO(client): O-33 — does CSE Operations sell to external customers? The answer decides
// exactly the ten `?` modules of the table above — `crm`, `crm_entgelt`, `formular`,
// `angebot`, `kalkulation`, `auftrag`, `katalog`, `qualitaet`, `radar`, `vergabe` — plus
// `abrechnung` together with O-01, plus the customer portal for that area, and whether
// `/angebot/operations` exists at all. Until answered those ten are seeded off for
// `operations` and the seed carries this question, by number, as a comment on each row.
```

### 1.8 Rules every row inherits

| Rule | Source |
|---|---|
| Money is rendered `1.234,56 €` with a non-breaking space, from `bigint` integer cents; VAT is computed per tax-rate group and never from a gross total. The **one** carve-out is K-16(b): `*_mikrocent bigint` inside agent cost and budget accounting, converted to cents once at the budget boundary (§5.19). Nothing invoiced, booked or exported is ever micro-cents | invariant 1, K-16, K-16(b), DESIGN §5 |
| A **measured** duration — worked time, a MiLoG record, a rest period — is `integer` and never fractional, because it is evidence. A **computed target** — `revier.sollzeit_minuten` from `Σ m² ÷ Leistungswert` — is `numeric(8,2)`, and every screen states which of the two it is showing | K-16(c), §5.7 |
| Every instant is `TIMESTAMPTZ` stored UTC and displayed `Europe/Berlin`; every **calendar boundary** — a day, a month, a billing period, a `[datum]` path segment — is a Berlin wall-clock boundary converted to instants, never UTC midnight | invariant 2, K-11 |
| A duration is the difference of two UTC instants, so 22:00–06:00 is 480 minutes, the spring-forward night 420 and the fall-back night 540 | invariant 2, K-11 |
| Lists are DESIGN §5 tables that become stacked cards below `768px`; no data table ever gets a horizontal scrollbar on a phone | DESIGN §5, §8 |
| Every figure is a link to the records behind it; a KPI whose value does not resolve to a filtered list is a defect | DSH-04 |
| No file is served from a public path: every download goes through a handler that mints a 15-minute signed URL after the authorization decision has already been made | DOC-03, DOC-04, SEC-A6 |
| Nothing leaves the system without human approval, and the approval passes `server/agent/policy.ts` after authorization | invariant 7 |
| No screen offers a hard delete in finance, time tracking or audit; correction is a reversing or superseding row | invariant 8, K-16 |
| The AI never computes money, quantities or deadlines; every number on every screen comes from a tested function in `src/server/services/` | invariant 6, K-10 |
| WCAG 2.1 AA applies to the whole product, not only the public site (§13) | DESIGN §9, LEG-07, PUB-09 |

### 1.9 What the columns mean

**Path** — the URL. **Right** — the permission key per §1.4. **Scope** — the token of §1.3.
**SPEC** — every feature ID the route serves; a route with no ID is either infrastructure
(§2.6) or a defect. **Phase** — the ROADMAP phase in which the route first ships; a later
phase may extend it, never remove it.

---

## 2. `(public)` — website, profiles, offer requests, legal, machine surfaces

All content is read from the database (PUB-07), never hard-coded. Every page is responsive
(PUB-06), WCAG 2.1 AA (PUB-09, LEG-07), uses `next/image` with `priority` on the hero only
(PUB-10, DESIGN §4), and emits no third-party script of any kind — which is what makes
PUB-13's "no trackers by default, therefore no cookie banner" true rather than aspirational.

```ts
// TODO(client): O-08 — separate domains per business area, or one group domain with
// paths? This decides the canonical URLs, the sitemap host and the JSON-LD @id values,
// and it cannot be changed after launch without redirect debt. The route tree is
// identical either way; only the host rewrite and the canonical tag differ.
```

### 2.1 Marketing pages

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/` | — | `—` | PUB-01, PUB-02, PUB-03, PUB-04, PUB-05, PUB-06, PUB-07, PUB-10, PUB-13, PUB-14 | 2 |
| `/unternehmen` | — | `—` | PUB-01, PUB-02, PUB-03, PRO-03 | 2 |
| `/leistungen` | — | `—` | PUB-01, PUB-07, OPS-06 | 2 |
| `/leistungen/[slug]` | — | `—` | PUB-01, PUB-07, PUB-11 | 2 |
| `/projekte` | — | `—` | PUB-01, PRO-05 | 2 |
| `/projekte/[slug]` | — | `—` | PUB-01, PRO-05 | 2 |
| `/ueber-uns` | — | `—` | PUB-01, PUB-02, PUB-08 | 2 |
| `/news` | — | `—` | PUB-01, PUB-07, SOC-05 | 2 |
| `/news/[slug]` | — | `—` | PUB-01, SOC-02, SOC-05 | 2 |
| `/kontakt` | — | `—` | PUB-01, PUB-12, REQ-05, REQ-07, CRM-07 | 2 |
| `/karriere` | — | `—` | REC-03 | 9 |
| `/karriere/[stelle]` | — | `—` | REC-03, REC-09, PUB-11 | 9 |
| `/karriere/[stelle]/bewerbung` | — | `—` | REC-03, REC-04, REC-07, LEG-11, LEG-12 | 9 |
| `/karriere/initiativbewerbung` | — | `—` | REC-03, REC-07, LEG-11 | 9 |
| `/karriere/danke` | — | `—` | REC-03, REC-07 | 9 |

Notes.

- `/` carries the four brand cards (DESIGN §4 brand-card composition, PUB-03) and the
  circular brand-avatar row under the hero (PUB-14, DESIGN §6); tapping an avatar opens
  `/unternehmen/[bereich]`. The avatars navigate — they do not switch a session.
- `/projekte` lists **only `referenz` rows**, which a human creates from a completed
  `auftrag` after the customer's release is on file (PRO-05,
  `02-datenmodell/06-RADAR-KI-INHALT.md` §5.5, which owns `referenz` and
  `referenz_kundenfreigabe`). A `referenz` carries title, area, city, description
  and released photos — never the order value, never `kunde_id`, never the address. There is
  no hand-typed reference table and no path from an unreleased job to a public page.
- **The application form is a child of the job**, `/karriere/[stelle]/bewerbung`, not a
  static sibling of `[stelle]` — see §1.6. `initiativbewerbung` is the one static sibling and
  is therefore reserved in `stelle.slug`.
- The script accent (DESIGN §2) appears **at most once per page**: the pen-note on `/` sits
  in the hero, so the footer sign-off renders only on pages without a hero note. This is a
  layout condition, not a per-page decision.
- **No cookie-settings route exists**, and none may be added without first removing PUB-13's
  premise. Inter and Caveat are self-hosted through `next/font`, never fetched from a font
  CDN: a third-party font request transmits every visitor's IP to a third country and would
  make the consent-free design a false claim (PUB-13, LEG-09).
- A single-page `/karriere` with an area filter is assumed; see O-38.

### 2.2 Company profiles (PRO-01…PRO-05)

`/unternehmen/[bereich]` is **both** "one page per business area" (PUB-01) and the profile
root (PRO-01). One canonical URL per entity: one JSON-LD graph, one set of inbound links, no
duplicate content. `[bereich]` resolves against `mandant.slug`, so a fifth area gets its
profile from the same DB row that gives it a portal (TEN-08).

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/unternehmen/[bereich]` — profile root | — | `—` | PUB-01, PRO-01, PRO-02, PRO-03, PUB-11, PUB-14 | 2 |
| `/unternehmen/[bereich]/leistungen` | — | `—` | PRO-02, OPS-06, PUB-11 | 2 |
| `/unternehmen/[bereich]/galerie` | — | `—` | PRO-02, PUB-04 | 2 |
| `/unternehmen/[bereich]/projekte` | — | `—` | PRO-02, PRO-05 | 2 |
| `/unternehmen/[bereich]/projekte/[slug]` | — | `—` | PRO-05, PUB-11 | 2 |
| `/unternehmen/[bereich]/beitraege` | — | `—` | PRO-02, PRO-04, SOC-02, SOC-05 | 2 |
| `/unternehmen/[bereich]/beitraege/[slug]` | — | `—` | PRO-04, SOC-05 | 2 |
| `/unternehmen/[bereich]/news` | — | `—` | PRO-02, SOC-05 | 2 |
| `/unternehmen/[bereich]/news/[slug]` | — | `—` | PRO-02, SOC-05, PUB-11 | 2 |
| `/unternehmen/[bereich]/kontakt` | — | `—` | PRO-02, PUB-12, REQ-05 | 2 |
| `/unternehmen/[bereich]/unternehmensdaten` | — | `—` | PRO-02, PUB-12, LEG-09 | 2 |

The sub-tab bar sits under the `3:1` profile cover (DESIGN §4). Tabs render as filter pills
(DESIGN §5), horizontally scrollable on mobile, no wrap. Profile switching (PRO-03) is the
public mirror of the portal switcher: the circular avatar row repeats in the profile header
with the current area ringed in its identity hue (DESIGN §6), and it navigates.

`unternehmensdaten` prints the entity's legal identity — register court, HRB number,
Geschäftsführer, tax number — from the **same `mandant` columns the invoice footer uses**
(DESIGN §11, `02-datenmodell/05-FINANZEN.md` §5.3, whose `leistender` block snapshots
exactly those columns), so the website and an invoice can never
disagree. SSE Security renders its own logo and identity, not a CSE sub-brand (D-11).

**Canonical URLs for news and posts.** A `security` news item is one row and must have one
canonical URL: `/unternehmen/security/news/[slug]`. The group-level `/news` is an aggregated
index whose entries link to the entity-canonical URL and which emits
`<link rel="canonical">` pointing there; `/news/[slug]` exists **only** for items whose
owning mandant is `operations` (the group's own announcements). The same rule governs
`/projekte` and `/leistungen`. Without it the site ships two URLs per article and the
duplicate-content problem the short entity URLs were deleted to avoid reappears one level
down.

### 2.3 Offer request forms (REQ-01…REQ-07)

One form per business area with the fields needed to actually quote — not one generic form
with a dropdown. The whole area path is **dynamic**, per §1.6.

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/angebot` — area chooser | — | `—` | REQ-01 | 2 |
| `/angebot/[bereich]` — the form, field set from `formular_definition` | — | `—` | REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, CRM-07, CRM-08, DOC-03, DOC-06 | 2 |
| `/angebot/[bereich]/danke` | — | `—` | REQ-05, REQ-06 | 2 |

The three field sets are fixed by SPEC and rendered from `formular_definition` rows, so a
fifth area needs a row and not a component: cleaning = building type · m² · number of
objects · frequency · start date (REQ-02); security = occasion · date and time · expected
attendance · number of staff · location (REQ-03); construction = trade · volume · deadline ·
**LV upload** (REQ-04), uploaded into a private bucket with server-side MIME sniffing
(DOC-03, DOC-06).

Every submission is written by the public service principal through
`withSystemTenant(mandantId, 'formular:<bereich>', …)` — the form has no session — and
creates a `lead` with an SLA deadline and a named owner (REQ-05), captures UTM and referrer
and carries them to the eventual `auftrag` (REQ-07), and records `rechtsgrundlage = anfrage`
(CRM-08, LEG-08). The escalation watchdog (REQ-06) is a job, not a page; where it lands is
`/portal/[mandant]/benachrichtigungen` (§5.17), which is why that route ships in Phase 2 and
not later.

**`quelle` uses CRM-07's vocabulary and only that** — website forms · tender radar · manual
entry · referral. An earlier draft introduced `quelle = website_kontakt` for `/kontakt`;
that is a fifth source the SPEC does not define, and REP-03's channel attribution would then
report two channels where the SPEC defines one. The distinguishing detail is
`formular_eingang.formular_definition_id` (the owner's spelling —
`02-datenmodell/02-CRM-OPERATIONS.md` §4.4), which names *which* form was used, inside the
one source.

**An enquiry is not consent to advertise.** `rechtsgrundlage = anfrage` supports a
*transactional reply to that enquiry*. It is not one of the four cumulative conditions of
§7 Abs. 3 UWG for subsequent advertising, and `bestandskunde` requires a clear opt-out
notice at collection and in every message. `server/agent/policy.ts` therefore classifies the
*message*, not only the contact: `transaktional` passes on `anfrage`; `werblich` requires
`einwilligung`, or `bestandskunde` **plus** the notice and a working objection path (§2.4).

```ts
// TODO(client): O-34 — legal review of the outbound matrix: which message classes may be
// sent on `anfrage`, on `bestandskunde` and on `einwilligung`; the exact wording of the
// §7 Abs. 3 Nr. 4 UWG opt-out notice; and whether the four cumulative conditions are
// satisfiable for this business at all. Until answered, only `transaktional` is
// implemented and `werblich` is refused for every legal basis.
```

### 2.4 Legally required pages and the two public obligation paths

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/impressum` — all four entities, separately | — | `—` | PUB-12, LEG-09 | 2 |
| `/datenschutz` | — | `—` | LEG-09, LEG-10, PUB-13 | 2 |
| `/datenschutz/anfrage` — data-subject request intake (Art. 15–21) | — | `—` | LEG-09 | 2 |
| `/datenschutz/anfrage/danke` — states the one-month Art. 12(3) deadline | — | `—` | LEG-09 | 2 |
| `/werbewiderspruch/[token]` — one-click objection from an outbound message | — | `—` | CRM-08, LEG-08 | 4 |
| `/werbewiderspruch` — objection without a token, by e-mail address | — | `—` | CRM-08, LEG-08 | 4 |
| `/barrierefreiheit` — Barrierefreiheitserklärung | — | `—` | LEG-07, PUB-09 | 2 |
| `/barrierefreiheit/feedback` — the mandated feedback channel | — | `—` | LEG-07 | 2 |

`/impressum` lists all four entities separately: §5 DDG requires per-entity register court,
HRB number and Geschäftsführer, and three of them are distinct legal persons.

`/datenschutz/anfrage` writes a `betroffenenanfrage` row through the public service
principal and lands in the internal inbox at `/portal/[mandant]/datenschutz` (§5.25). A
public form that creates an Art. 12(3) obligation and has no internal recipient is a missed
statutory deadline with a timestamp on it.

`/werbewiderspruch/[token]` is the link **every** outbound advertising message must carry
(§7 Abs. 3 Nr. 4 UWG, Art. 21 DSGVO). The token is single-use-safe by K-09 shape but
idempotent by design — a second click on the same link says "already recorded", never an
error.

**It sets `ansprechpartner.werbewiderspruch_am`** — and `kunde.werbewiderspruch_am` where the
objection is recorded at company level — **and touches `rechtsgrundlage` not at all.** After
it, `crm.kommunikation_versenden` refuses every message classified `zweck = 'werbung'` to that
contact, agent or human (invariant 7, LEG-08, D-01), and continues to send everything
classified `vertraglich`.

An earlier draft of this map said the route sets `kontakt.rechtsgrundlage = keine`, after
which "every outbound message" is refused. That is wrong three times over and
`02-datenmodell/02-CRM-OPERATIONS.md` §5 corrects it explicitly. There is no `kontakt`
table — the tables are `ansprechpartner` and `kunde`. `rechtsgrundlage = 'keine'` is forced
by the trigger `kern.erzwinge_widerspruch()` from the *other* column, `widerspruch_am`, which
records the rarer Art. 21 objection to **processing**. And an advertising opt-out that
silenced everything would stop that customer's invoices (FIN-11), Leistungsnachweise
(CLN-04), appointment confirmations and Mahnungen (FIN-15): communication needed to perform
the contract rests on Art. 6(1)(b) and cannot be objected away. The two paths are therefore
distinct surfaces over distinct columns:

| Objection | Column set by | Effect |
|---|---|---|
| to **advertising** — this route, and the tokenless form below | `werbewiderspruch_am` | blocks `zweck = 'werbung'` only; transactional mail keeps sending |
| to **processing** — Art. 21, raised through `/datenschutz/anfrage` and decided at `M/datenschutz/[id]` (§5.25) | `widerspruch_am` | the trigger forces `rechtsgrundlage = 'keine'`; the rare, stronger case |

Both columns are write-once and not clearable, so the §7 UWG evidence survives even the
anonymisation path. The tokenless form exists because a forwarded message is not a reason to
make objection impossible; it matches on e-mail address and confirms by e-mail.

`/barrierefreiheit` is required by BFSG for consumer-facing sites and must name a reachable
feedback channel; `/barrierefreiheit/feedback` is that channel and must itself be fully
operable by keyboard and screen reader.

### 2.5 Machine surfaces (PUB-10, PUB-11, PUB-12)

| Path | Implementation | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/sitemap.xml` | `src/app/sitemap.ts` | `—` | PUB-10, PUB-12 | 2 |
| `/robots.txt` | `src/app/robots.ts` | `—` | PUB-12 | 2 |
| `/llms.txt` | route handler, `text/plain` | `—` | PUB-12 | 2 |
| `opengraph-image` per route | `opengraph-image.tsx` | `—` | PUB-04, PUB-10 | 2 |
| `/.well-known/security.txt` | route handler | `—` | not in SPEC — recommended alongside SEC-A7 | 10 |

`sitemap.xml` enumerates every public route above, including all four profile sub-tab sets
and every published `seite`, `referenz`, `social_post`, news and open `stelle` row. It
excludes `/auth`, `/portal`, `/check-in` and `/api` entirely. `robots.txt` disallows
`/api/`, `/portal/`, `/auth/`, `/check-in/` and `/werbewiderspruch/`. `llms.txt` describes
the group, names the four entities with their trades and NAP, and links the profile roots
and service pages — from the same NAP source `/impressum`, `/kontakt` and every JSON-LD
`LocalBusiness` block use, so directory consistency (PUB-12) is generated, not maintained.

`/.well-known/security.txt` ships only with a monitored mailbox behind it; a contact address
nobody reads is worse than no file at all.

```ts
// TODO(client): O-35 — which mailbox receives security reports, and who monitors it?
// Without a named owner `/.well-known/security.txt` is not published.
```

**JSON-LD per area (PUB-11)**, emitted inline in the page's server component under the
per-request CSP nonce (SEC-A7), never by a third-party script (PUB-13):

| Page | Schema types |
|---|---|
| `/` | `Organization` (the group), `WebSite`, `BreadcrumbList` |
| `/unternehmen/[bereich]` | `LocalBusiness` — that entity's NAP, opening hours, `areaServed` Berlin — plus a `Service` list and `FAQPage` |
| `/unternehmen/[bereich]/leistungen`, `/leistungen/[slug]` | `Service` with `provider` → that entity's `LocalBusiness` `@id` |
| `/unternehmen/[bereich]/projekte/[slug]`, `/projekte/[slug]` | `BreadcrumbList`, `ImageObject` |
| `/unternehmen/[bereich]/news/[slug]` | `NewsArticle` |
| `/kontakt` | four `LocalBusiness` blocks, identical NAP to `/impressum` |
| `/karriere/[stelle]` | `JobPosting` — emitted only while the `stelle` is genuinely open |

### 2.6 App-level special files

| File | Renders | Phase |
|---|---|---|
| `src/app/not-found.tsx` | 404 — identical for a wrong id, a foreign tenant and a foreign customer (AUT-06), with a route back to the caller's own dashboard | 1 |
| `src/app/error.tsx`, `src/app/global-error.tsx` | error boundary; no stack trace, no SQL, no id echo reaches the client | 1 |
| `src/app/(public)/loading.tsx`, `src/app/portal/[mandant]/loading.tsx` | skeletons built from `--surface` steps, never spinners | 2 / 1 |
| `src/middleware.ts` | CSP with a per-request nonce · locale negotiation for `/portal/mein` and `/check-in` · the AUT-07 rate-limit hook. **Not a security boundary** | 1 |
| `src/app/(dev)/styleguide/page.tsx` | every DESIGN.md token and base component; global role only, never deployed to production | 0 |

### 2.7 The public read path

Public pages have no session, so they read through the **website-renderer service principal**
holding `oeffentlich.lesen` (plus `gruppe.oeffentlich.lesen` for the group-level pages) in
the four mandanten as ordinary per-mandant bindings, at `readonly = on`, inside
`withSystemTenant` (`02-datenmodell/02-CRM-OPERATIONS.md` §1.6.1,
`03-AUTH-BERECHTIGUNGEN.md` §14.3).

**Reading and intake are two principals, not one.** The renderer cannot write, and the form
intake of §2.3 must: K-03's `WITH CHECK` demands `not app.ist_readonly()` **and**
`formular.schreiben` on `formular_eingang`, so a renderer principal holding "exactly
`oeffentlich.lesen`" at `readonly = on` fails three ways at once and REQ-01…REQ-07 would have
no functioning write path — the form would accept a submission and store nothing. The
**form-intake principal** therefore holds `oeffentlich.lesen` + `formular.schreiben` +
`dokument.schreiben` at `readonly = off`, and deliberately **not** `formular.lesen`: it
writes submissions it cannot read back. Neither key is `nur_global` (§1.4). Consequences that
belong in a page map:

- `cse_anon` holds **no table grants at all** (K-01). An anonymous request never selects from
  `mandant`; `/unternehmen/[bereich]/unternehmensdaten` reads the published projection the
  `oeffentlich.*` policies expose, which contains the legal-identity block and excludes
  `iban`, `bic`, `module`, `ist_rechtseinheit` and every operational column.
- Only rows carrying a published state are reachable. A `referenz` without a recorded
  customer release, a `seite` in draft, a `stelle` that is closed and a `social_post` not yet
  published are invisible to this principal — not filtered by a page, unreachable by policy.
- The intake endpoints (`/angebot/[bereich]`, `/karriere/[stelle]/bewerbung`,
  `/datenschutz/anfrage`, `/barrierefreiheit/feedback`, `/werbewiderspruch`) are rate-limited
  in `middleware.ts` and audited with `akteur_art = 'system'` and the resolution reason
  (AUT-07, SEC-A9).

---

## 3. `/auth` — login, second factor, invitation, worker login

No sidebar, no switcher, no identity hue: at this point there is no active mandant to colour
the shell with, and DESIGN §6 rule 4's "at all times" bar renders in its neutral state
(§11.3). Every route here is rate-limited and lockout-protected (AUT-07), writes to
`audit_log` (AUT-08), and is in scope for WCAG 2.1 AA (§13).

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/auth/login` — e-mail + password | — | `—` | AUT-01, AUT-02, AUT-07, AUT-08 | 1 |
| `/auth/zwei-faktor/pruefen` — TOTP challenge | authenticated, 2FA pending | `—` | AUT-02, AUT-07, AUT-08 | 1 |
| `/auth/zwei-faktor/einrichten` — enrolment, forced before anything else for accounts whose role requires `aal2` | authenticated | `—` | AUT-02, AUT-08 | 1 |
| `/auth/zwei-faktor/wiederherstellung` — recovery code | authenticated, 2FA pending | `—` | AUT-02, AUT-07, AUT-08 | 1 |
| `/auth/passwort-vergessen` | — | `—` | AUT-07, AUT-08 | 1 |
| `/auth/passwort-neu` — token from the reset mail | token | `—` | AUT-07, AUT-08 | 1 |
| `/auth/einladung/[token]` — accept an invitation, set a password, enrol 2FA where required | token | `—` | AUT-01, AUT-02, AUT-03, AUT-08 | 1 |
| `/auth/bereich` — area chooser after login for users with more than one membership | Sitzung | `—` | TEN-04, TEN-06, AUT-04 | 1 |
| `/auth/mitarbeiter` — phone number entry | — | `—` | EMP-01, EMP-12, AUT-07, AUT-08 | 3 |
| `/auth/mitarbeiter/code` — SMS one-time code | pending OTP challenge | `—` | EMP-01, EMP-12, AUT-07, AUT-08 | 3 |
| `/auth/kein-zugriff` — signed in, permission missing **inside** an accessible mandant | Sitzung | `—` | AUT-04 | 1 |
| `/auth/abmelden` — route handler, **POST only** | Sitzung | `—` | AUT-08 | 1 |
| `/auth/callback` — Supabase route handler | — | `—` | AUT-02 | 1 |

Notes.

- **`/auth/login` versus `/auth/mitarbeiter`.** EMP-01 gives operatives a lightweight
  account: phone number plus SMS code, no password. Both paths end at the **same
  `benutzer` row** — one human, one login (EMP-14, D-09 consequence 4) — and differ only in
  the credential Supabase Auth holds. A person who is both a Leitung and an employee
  authenticates with e-mail + password (plus TOTP where the role requires it) and reaches
  the worker portal from that same session; the SMS-only path is disabled for that account
  (`03-AUTH-BERECHTIGUNGEN.md` §5.1, O-88 `auth-doppelrolle-login`). There is no second authentication stack, no
  home-grown OTP store, and no principal that exists outside `benutzer`.
- **`/auth/kein-zugriff` is not the cross-tenant response.** Cross-tenant and cross-customer
  access is 404 (AUT-06). This page exists only for the case where the mandant *is* the
  user's and the module right is missing — telling a `leitung` that Buchhaltung exists but is
  not theirs leaks nothing, and a blank 404 there would look like a broken deploy.
- **Where the 2FA gate is not** (K-15): AUT-02 requires 2FA for `super_admin` and `admin`
  only; `leitung`, `mitarbeiter` and `kunde` run at `aal1`. A restrictive `aal2` policy on
  `benutzer_mandant` would return zero rows for them, `app.sichtbare_mandanten()` would
  return `{}`, and the whole platform would go blank for every non-admin, including the
  check-in worker. The gate sits on the **write path of the permission-administration
  tables** (§5.24) and inside `app.ist_super_admin()`, never on the SELECT path membership
  resolution depends on.
- Every error is announced through `aria-live="polite"`, phrased in German, and never
  reveals whether an identity exists. The lockout message says a retry is possible later —
  never "account locked", never a countdown that reveals the policy (AUT-07, O-80 `auth-sperrschwellen`).

### 3.1 The area chooser and the switch interstitial

`/auth/bereich` renders after a login that resolves more than one membership. **Nothing is
auto-selected**: the membership flagged `benutzer_mandant.ist_standard` is offered first as
a hint, never as an automatic choice, because auto-selecting the wrong GmbH is exactly the
mistake that puts an invoice in the wrong number circle. One membership → straight to
`/portal/<slug>` with no chooser and no switcher (TEN-06, DESIGN §6 rule 1). Zero
memberships and no global role → a 403 page reading „Kein Bereich zugewiesen", audited.

The switch interstitial rendered by the `[mandant]` layout (§1.5) is the same component with
one target. Both submit to `POST /api/sitzung/mandant`; neither is a link.

```ts
// TODO(client): O-82 `auth-sms-anbieter` — which EU-hosted SMS gateway delivers the OTP and
// the check-in link (DPA required, D-04), and what monthly spend cap triggers a hard stop?
// No provider is chosen (K-17). `SmsGateway` ships as an interface; until an adapter is registered the
// worker-login screens render "SMS-Anmeldung nicht verbunden" and send nothing, and no
// screen ever reports a delivery that did not happen.
// TODO(client): O-36 — which EU-hosted transactional e-mail sender delivers invitations,
// password resets, offer dispatch (OPS-08), dunning (FIN-15) and NOT-02 e-mail
// notifications, under which DPA? Same interface treatment, same "nicht verbunden" state.
```

---

## 4. `/check-in/[token]` — the tokenised shift check-in (TIM-07…TIM-10)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/check-in/[token]` | **token only, no login** | `TOK` | TIM-07, TIM-08, TIM-09, TIM-10, TIM-13, LEG-02, LEG-10, EMP-12 | 5 |
| `/check-in/abgelaufen` — expired, revoked or already redeemed | — | `—` | TIM-07 | 5 |

This is the only route in the product with a hard physical constraint: **phone-only, one
screen, one primary button, no scrolling, usable with gloves on and one hand** (DESIGN §8).
It is therefore one route with states, not a flow of pages — a second page is a second chance
to lose a worker in a stairwell at 05:55.

### 4.1 Screen states

| State | Screen | Rule |
|---|---|---|
| `bereit_einstempeln` | object name, shift window, one primary button `Einstempeln` | the `checkin` token of this assignment is live and inside its derived window (TIM-07) |
| `bereit_ausstempeln` | elapsed time, one primary button `Ausstempeln` | reached with the **`checkout` token**, a different row (§4.2) |
| `foto` | camera capture, optional per assignment | EXIF stripped server-side on ingest, private bucket, content type sniffed from the bytes (TIM-10, DOC-03, DOC-06) |
| `offline` | queued locally, banner „Wird gesendet, sobald wieder Netz da ist" | the replay path of §4.3 — not a widened window |
| `bestaetigt` | the **server** timestamp in `Europe/Berlin`, object, entity name | TIM-08 |
| `abgelehnt` | one generic rejection, no detail, no retry loop | every failure — unknown hash, expired, revoked, already redeemed — returns the same shape, so the URL is not an oracle |

Invariant 5 for this screen in one sentence: the device clock is captured and stored as
`geraete_zeit_beginn` with a derived `zeitabweichung_beginn_sek`, and it is never what the
`zeiteintrag` is computed from. The authoritative instant is `now()` in the database
(TIM-08); duration is the difference of two UTC instants (invariant 2), which is why the
22:00–06:00 shift and both DST nights come out at 480, 420 and 540 minutes (K-11).

Language follows `person.sprache` (de / en / ar / tr, EMP-12) resolved from the token — there
is no login to read a preference from — and Arabic renders `dir="rtl"` from this route's own
layout (§12).

Geolocation is **a single point at start and a single point at end, never a track** (LEG-10),
written only when `app.einstellung('zeit.geolokalisierung')` is on and only after the
affected worker has acknowledged the notice. It is limited to two points by the absence of
any table in which a third could be stored — not by a loop that stops.

```ts
// TODO(client): O-06 — is there a Betriebsrat? A works council must be involved under
// §87 BetrVG before any performance-monitoring feature ships. This governs whether the
// geolocation capture on /check-in/[token] is enabled at all, whether login metadata and
// the check-in audit trail may be evaluated per person, and whether the APR-08
// review-duration measurement may run. The setting ships defaulted to off.
```

### 4.2 One token per leg — single use stays literally true

TIM-07 says the token is **single use**. An earlier draft used one token for both legs
("same token, second leg"), which is a silent reinterpretation of the one constraint that
makes the link safe: a token surviving its first use is a bearer credential valid for the
whole shift window, and a worker forwarding the URL to a colleague becomes undetectable in a
§17 MiLoG record. It also left `verbraucht` undefined — consumed after which leg?

The data model already resolves it and this map follows it verbatim
(`02-datenmodell/04-PLANUNG-ZEIT.md` §5.5): `checkin_token.zweck` is
`token_zweck ∈ {checkin, checkout}`, **one row per leg**, with
`ct_live_uk UNIQUE (einsatz_zuordnung_id, zweck) WHERE eingeloest_am IS NULL AND
widerrufen_am IS NULL`. The `checkout` link is issued on a successful check-in and delivered
through the same registered dispatch adapter. Both rows store `sha256(token)` only; the full
value is never written to the database, to a log or to the audit trail, and `token_hash` is
withheld from `cse_app` by column grant, so a planner screen and a debugging `select *`
cannot hand out the lookup key.

Redemption is one conditional write, and **zero rows returned is the 409** (K-09):

```sql
update public.checkin_token
   set eingeloest_am = now(), ip_adresse = $ip, user_agent = $ua
 where token_hash = $hash
   and eingeloest_am is null and widerrufen_am is null
   and now() between gueltig_ab and gueltig_bis
returning einsatz_zuordnung_id, mandant_id, zweck;
```

The `zeiteintrag` is inserted in the same transaction, only if a row came back. Pre-checks
may exist to produce a friendlier message, never to decide. `mandant_id`, `anstellung_id`
and `person_id` are derived **from the assignment**, never from anything inside the token or
the request (K-08). Concurrency test: N simultaneous requests against one token yield
exactly one `zeiteintrag` (SEC-A3 assertion 23) — a duplicate is duplicated billable time
(FIN-07, TIM-12) and a duplicated §17 MiLoG record.

The actor in `audit_log` is **the worker**, resolved
`einsatz_zuordnung → anstellung → person → benutzer`, with `akteur_art = 'mensch'`. Recording
it as `system` would make a check-in indistinguishable from a cron job and weaken exactly the
evidentiary value EMP-07 and LEG-02 exist to create.

### 4.3 Offline capture (TIM-09)

A phone that lost signal at 06:00 cannot present its link at 09:00: the window check and the
single-use check both reject it. The resolution is a distinct path, not a widened window.
`POST /api/check-in/[token]` replays queued events into `app.offline_ereignis_annehmen`
under `cse_checkin`.

**That function is the fourth entry on K-08's closed register and `cse_checkin` holds
`EXECUTE` on it by name** (K-01). This is a convention amendment, not a local exception: the
offline replay is check-in data arriving late over the *same* token — same subject, same
authentication, same conditional-write discipline (K-09) — so splitting it onto a different
mechanism would mean two trust boundaries for one fact. An earlier draft of this map asserted
the deviation while citing a K-08 that admitted three functions; the register now names five
and the map cites it rather than contradicting it. A function not on that register may not
execute outside a session helper, and the route-manifest test fails the build on any new one
that is not added to the register in the same PR.

In the replay the **arrival** (`empfangen_am`) is server-authoritative and is what
"late" is measured against; the **claim** (`behauptete_zeit`, with the byte-faithful payload
and its hash) is recorded and is never authoritative on its own (invariant 5); and
`client_ereignis_id + geraet_id` make replay idempotent, so a flapping connection produces
one row and not two shifts.

A purely offline shift therefore produces **no `zeiteintrag` until a human decides**. The row
waits in the planner queue at `/portal/[mandant]/zeiten/nacherfassung` (§5.11), promoted by
`zeit.nacherfassung_pruefen` with a written reason and a `zeiteintrag_korrektur` row in the
same transaction (TIM-11). A record a planner created from a worker's written claim is
defensible in a wage dispute; a record whose start time the platform accepted from an
unauthenticated phone is not.

### 4.4 Issuing, re-issuing and revoking links

The check-in link has to reach a worker, and a lost link at 05:55 needs a recovery path that
is not "call the office and hope". `/portal/[mandant]/zeiten/checkin-links` (§5.11) is that
surface, gated on `zeit.checkin_verwalten`. Issue and revoke run through
`app.checkin_ausgeben(p_zuordnung, p_zweck)`; `checkin_token` carries **no INSERT, UPDATE or
DELETE policy for `cse_app` at all**. Moving or cancelling a shift revokes every live token
of that assignment and enqueues re-issue by trigger, so a token can never outlive the shift
it was minted for.

```ts
// TODO(client): O-93 `zeit-checkin-kanal` — how does the check-in link reach the worker —
// SMS, e-mail, a QR code posted at the object, or a portal link — and who carries the SMS
// cost? The dispatch adapter records which channel it used in `checkin_token.ausgabe_kanal`,
// validated against the adapters actually registered; an unregistered adapter renders
// "nicht verbunden" and sends nothing. Answer it together with O-82 `auth-sms-anbieter`,
// which names the provider: the channel and the provider are two halves of one decision and
// must not be answered twice under two numbers (§17).
```

---

## 5. `/portal/[mandant]` — the tenant-scoped staff application

Every route in §5 is `M1`: exactly one active mandant, resolved from the server session
(§1.5), every service call inside `withTenant`. This is the **only** family in which a
create or update path exists (invariant 10). All the rules of §1.8 apply to every row.

### 5.1 Shell and dashboard (DSH-01…DSH-05)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]` — role-resolved dashboard | `bericht.dashboard_lesen` | `M1` | DSH-01, DSH-03, DSH-04, DSH-05, TEN-07 | 3 |

One route, one right, five renderings. The figures a role sees are **its own rights**, which
is why one key serves all five dashboards: a tile whose underlying right the viewer lacks is
not rendered, rather than rendered empty.

| Viewer | Content | SPEC |
|---|---|---|
| global role | active orders · active projects (`auftrag` with a `projekt` row) · employees · **currently working** · new leads · open offers · open invoices · revenue · expenses · profit · notifications · upcoming tasks · recent activity | DSH-01 |
| `admin` | the same tiles, intersected with `benutzer_mandant.module` | DSH-03 |
| `leitung` | own area: today's roster gaps, unstaffed shifts tomorrow, open time objections, expiring certificates, open orders, open tasks | DSH-03 |
| `mitarbeiter` | never rendered — the portal ceiling redirects to `/portal/mein` (SEC-A3 assertion 17) | DSH-03, EMP-13 |
| `kunde` | never rendered — the portal ceiling redirects to `/portal/kunde` | DSH-03 |

- **DSH-04**: every figure links to the filtered list behind it. A KPI stat card whose value
  does not resolve to a route is a defect, not a design choice.
- **DSH-05**: "Aktuell im Einsatz" is computed live from `zeiteintrag` rows with no end
  instant. It is never a cached number and never a materialised counter.
- **DSH-02** ("filter by all areas or one") is satisfied *inside* a mandant by the fixed
  single-area scope, and *across* areas by `/portal/gruppe` (§6). There is no all-areas
  toggle on a tenant dashboard: a tenant dashboard that can show another entity's revenue is
  a tenancy leak with a filter on top.

### 5.2 CRM (CRM-01…CRM-08)

`kunde` is the single customer master. "Companies" in CRM-01 and "customers" in OPS-01 are
one table with a status; there is exactly one route family for them, linked from both the
Vertrieb and the Operations sidebar groups. Two routes over one table produce two truths and
eventually two addresses on one invoice.

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/crm` — pipeline overview | `crm.lesen` | `M1` | CRM-01, CRM-02, CRM-05, DSH-04 | 4 |
| `/portal/[mandant]/crm/leads` | `crm.lesen` | `M1` | CRM-01, CRM-02, CRM-07, REQ-05 | 4 |
| `/portal/[mandant]/crm/leads/neu` | `crm.schreiben` | `M1` | CRM-01, CRM-07, CRM-08 | 4 |
| `/portal/[mandant]/crm/leads/[id]` — tabs: Übersicht · Verlauf · Aufgaben · Angebote · Dokumente | `crm.lesen` | `M1` | CRM-02, CRM-03, CRM-04, CRM-05, REQ-06, REQ-07 | 4 |
| `/portal/[mandant]/crm/kunden` | `crm.lesen` | `M1` | CRM-01, OPS-01 | 4 |
| `/portal/[mandant]/crm/kunden/neu` | `crm.schreiben` | `M1` | OPS-01 | 4 |
| `/portal/[mandant]/crm/kunden/[id]` — tabs: Übersicht · Ansprechpartner · Objekte · Aufträge · Angebote · Rechnungen · Dokumente · Kommunikation · Portalzugang | `crm.lesen` | `M1` | CRM-01, CRM-03, CRM-05, CRM-06, OPS-01, DOC-04 | 4 |
| `/portal/[mandant]/crm/kunden/[id]/konditionen` — payment terms, debtor number, dunning block | `crm_entgelt.lesen` (+ `crm.schreiben` to edit) | `M1` | CRM-01, FIN-15 | 6 |
| `/portal/[mandant]/crm/kunden/[id]/steuer` — see §5.3 | `abrechnung.lesen` | `M1` | FIN-09, FIN-10, FIN-11, LEG-05, LEG-06 | 6 |
| `/portal/[mandant]/crm/kunden/[id]/zugang` — issue, re-issue and revoke `kunde_zugang` | `system.benutzer_verwalten` | `M1` | AUT-01, DOC-04 | 3 |
| `/portal/[mandant]/crm/kontakte` — Ansprechpartner across customers | `crm.lesen` | `M1` | CRM-01, OPS-01 | 4 |
| `/portal/[mandant]/crm/kontakte/[id]` | `crm.lesen` | `M1` | CRM-03, CRM-08, LEG-08 | 4 |
| `/portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage` — set, with evidence and date | `crm.rechtsgrundlage_setzen` | `M1` | CRM-08, LEG-08 | 4 |
| `/portal/[mandant]/crm/wiedervorlagen` — follow-ups due | `crm.lesen` | `M1` | CRM-03, CRM-04 | 4 |

- **CRM-08 is a route-level gate, not a badge.** Every screen that can start an outbound
  message renders the send control **disabled with the reason shown** when the contact's
  legal basis does not cover the message class (§2.3), and `crm.kommunikation_versenden` plus
  `server/agent/policy.ts` refuse the send regardless of what the UI did (invariant 7,
  LEG-08, D-01). The Kommunikation tab shows the recorded basis, its evidence and its date,
  and links to the objection log.
- **CRM-06** — customer history across all four areas — is the one CRM view that cannot be
  answered inside one mandant. It lives at `/portal/gruppe/kunden` (§6), read-only, matched
  on company identity, and never shows another entity's prices to a manager who is not
  entitled to them.
- CRM-04 follow-ups create `aufgabe` and `kalender_eintrag` rows and therefore also surface
  at `/portal/[mandant]/aufgaben` and `/portal/[mandant]/kalender` (§5.17).

### 5.3 The customer tax tab — the route FIN-09, FIN-10 and FIN-11 depend on

FIN-11 requires the **Leitweg-ID** on every XRechnung (BT-10; a public buyer's invoice is
rejected without it), FIN-09 needs the recipient's §13b evidence *per service type and
dated*, and FIN-10 needs a §48b Freistellungsbescheinigung with a validity window so the
validator can test validity **at the service date**. Without a route to enter them the
XRechnung path can only emit invalid documents, and SPEC's "without XRechnung the group
cannot invoice public buyers at all" stands. An earlier draft had none.

| Field group | Columns (owned by `02-datenmodell/`) | Type note | SPEC |
|---|---|---|---|
| Tax identity | `kunde.ust_id`, `kunde.steuernummer` | text | FIN-04, LEG-05 rules 2–3 |
| Electronic invoicing | `kunde.leitweg_id`, `kaeufer_referenz`, `elektronische_adresse` + schema, `uebertragungsweg`, `rechnungsformat`, `ist_oeffentlicher_auftraggeber`, `xrechnung_pflicht` | text / enum | FIN-11 |
| §13b evidence | `kunde_bauleistender_status (ist_bauleistender, gilt_ab, gilt_bis, grundlage, leistungsart)`, `EXCLUDE` on overlapping ranges | **`date` ranges** — a status holds for a period, not from an instant | FIN-09, LEG-06 |
| §48b certificate | `freistellungsbescheinigung (bescheinigung_nummer, finanzamt, gueltig_von, gueltig_bis, umfang, auftrag_id, widerrufen_am, dokument_id)` | `gueltig_von`/`gueltig_bis` are **`date`**; the scan lands in a private bucket | FIN-10, LEG-06 |

The mirror case is `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer` (§5.14): a
**subcontractor's** §48b certificate, validated at the service date before payment is
released. §48 EStG bites in both directions — the group withholds from its subcontractors
and its customers withhold from it — and a map that covers only one direction leaves the
platform withholding nothing while owing 15 %.

`/portal/[mandant]/einstellungen/steuer` (§5.24) therefore holds **only** the tax-rate groups
and the entity's own tax identity. An earlier draft put "§13b and §48 defaults" there, which
invents a tax rule: §13b Abs. 2 Nr. 4 UStG turns on whether the *recipient* is a Bauleistender
rendering Bauleistungen himself, evidenced per customer and per period; §48 EStG turns on a
certificate valid at the service date. Modelled as a tenant-level default, the screen invites
a user to set a value that produces wrong VAT treatment on every invoice to a customer who
does not match it.

### 5.4 Angebote and Kalkulation (OPS-06…OPS-09, FIN-01)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/angebote` | `angebot.lesen` | `M1` | OPS-08, CRM-05 | 4 |
| `/portal/[mandant]/angebote/neu` | `angebot.schreiben` | `M1` | OPS-07, OPS-08, CRM-05 | 4 |
| `/portal/[mandant]/angebote/[id]` — tabs: Positionen · PDF · Verlauf | `angebot.lesen` | `M1` | OPS-07, OPS-08 | 4 |
| `/portal/[mandant]/angebote/[id]/kalkulation` — labour + material + equipment + overhead + risk/profit | `kalkulation.lesen` (+ `kalkulation.schreiben`) | `M1` | OPS-07, OPS-02, OPS-03, OPS-06 | 4 |
| `/portal/[mandant]/angebote/[id]/pdf` — preview in the entity's identity | `angebot.lesen` | `M1` | OPS-08, DESIGN §11 | 4 |
| `/portal/[mandant]/angebote/[id]/freigabe` — release the price | `angebot.preis_freigeben` | `M1` | OPS-08 | 4 |
| `/portal/[mandant]/angebote/[id]/versand` — send to the customer | `angebot.versenden` | `M1` | OPS-08, invariant 7, APR-01 | 4 |
| `/portal/[mandant]/angebote/[id]/annahme` — record acceptance, convert to `auftrag` in one action | `angebot.annahme_erfassen` | `M1` | OPS-09, CRM-05 | 4 |
| `/portal/[mandant]/leistungskatalog` , `/[id]` | `katalog.lesen` / `katalog.schreiben` | `M1` | OPS-06, CLN-05 | 4 |

Every number on the Kalkulation comes from a tested function in `src/server/services/`:
cleaning standard time is
`Σ (raum.flaeche_qm ÷ belagsart.leistungswert_qm_pro_stunde) × turnus_faktor`
(OPS-02, OPS-03) — the owner's column name is
`belagsart.leistungswert_qm_pro_stunde` (`02-datenmodell/02-CRM-OPERATIONS.md` §4.2), with
the room-level override `revier_raum.leistungswert_qm_pro_stunde`; neither is spelled
`leistungswert` or `leistungswert_qm_h`. The result is `revier.sollzeit_minuten
numeric(8,2)` — a *computed target*, fractional by K-16(c), never an `integer` measured
duration. The Acquisition agent may *fill* a price sheet; it may never *compute* a
price, and it never supplies an input that determines one — every money, quantity or formula
argument is a handle or a token from the run's number register, never a numeric literal or
an expression string, and `zuschlag_profil_id` is never a model argument because choosing
the surcharge profile is choosing the margin (invariant 6, K-10, AGT-02).

The `kalkulation` module is the margin and carries the internal-only ceiling: it is
structurally unreachable for `kunde` and `mitarbeiter` sessions, not merely unbound.

**The labour rate is not invented.** OPS-07 costs labour, and the applicable rate is a
tariff or sector-minimum value that SPEC does not state — precisely the class K-17 forbids
guessing, and pricing below the applicable sector minimum wage is a disqualification ground
in the public tenders the Radar module exists to win.

```ts
// TODO(client): O-37 — which wage basis applies per area and per activity: the
// Gebäudereiniger-Tarif wage groups, the construction sector minimum wage, the security
// sector agreement, and their validity dates? `LohnkostenQuelle` ships as an interface
// with one placeholder implementation that is flagged `ist_platzhalter`; every Kalkulation
// computed from a placeholder rate renders the DESIGN §5 `warning` pill "Unbestätigter
// Wert" and cannot be released with `angebot.preis_freigeben`.
```

### 5.5 Objekte and Raumbuch (OPS-01…OPS-04)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/objekte` — list + map | `objekt.lesen` | `M1` | OPS-01 | 4 |
| `/portal/[mandant]/objekte/neu` | `objekt.schreiben` | `M1` | OPS-01 | 4 |
| `/portal/[mandant]/objekte/[id]` — tabs: Übersicht · Raumbuch · Reviere · Posten · Dienstanweisungen · Schlüssel · Aufträge · Einsätze · Dokumente · Qualität (each tab rendered only where its module is enabled and its `lesen` right held) | `objekt.lesen` | `M1` | OPS-01, OPS-11 | 4 |
| `/portal/[mandant]/objekte/[id]/raumbuch` — rooms with m², floor type, cleaning class | `objekt.lesen` | `M1` | OPS-02 | 4 |
| `/portal/[mandant]/objekte/[id]/raumbuch/[raumId]` | `objekt.schreiben` | `M1` | OPS-02, OPS-03 | 4 |
| `/portal/[mandant]/objekte/[id]/raumbuch/import` — Excel/CSV, **preview before commit** | `objekt_import.schreiben` | `M1` | OPS-04, DOC-06 | 4 |

The import is a two-step route by design: the upload parses into a staged diff — new rooms,
changed m², removed rooms — and **nothing is written until the preview is confirmed**. An
import that silently changes 400 room areas changes every cleaning price derived from them
(OPS-02, OPS-07) and every Revier target minute.

The map on `/objekte` and on `/portal/gruppe/objekte` needs a tile and geocoding provider,
which is a processor handling customer addresses.

```ts
// TODO(client): O-132 `seiten-geo-anbieter` — which EU-hosted map tile and geocoding
// provider is used for OPS-01
// coordinates, under which DPA (D-04)? Until one is configured the list renders without a
// map and coordinates are entered manually; no third-party tile is fetched from a public
// page (PUB-13) and no address is sent to an unconfigured service.
```

### 5.6 Aufträge (OPS-05, OPS-10, OPS-11)

A **project is an `auftrag` carrying a `projekt` extension row** in the Bau domain
(`02-datenmodell/02-CRM-OPERATIONS.md` §3.2) — a stated decision, not a silent fold, so that
OPS-09's one-action conversion, FIN-07 traceability and the number circle work unchanged.
DSH-01's two counters are "`auftrag` without a `projekt` row" and "`auftrag` with one".

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/auftraege` | `auftrag.lesen` | `M1` | OPS-05, CRM-05 | 4 |
| `/portal/[mandant]/auftraege/neu` — contract wizard: location · staff needed · hours · equipment · start date · responsible manager | `auftrag.schreiben` | `M1` | OPS-10, OPS-05 | 4 |
| `/portal/[mandant]/auftraege/[id]` — tabs: Übersicht · Leistungen · Einsätze · Zeiten · Nachweise · Dokumente · Rechnungen · Aufgaben | `auftrag.lesen` | `M1` | OPS-05, OPS-11, FIN-07, FIN-18 | 4 |
| `/portal/[mandant]/auftraege/[id]/abrechnung` — billing type and its parameters per contract | `abrechnung.schreiben` | `M1` | FIN-01, FIN-05, FIN-08 | 6 |
| `/portal/[mandant]/auftraege/[id]/abschluss` — mark complete; FIN-18 warnings shown first | `auftrag.abschliessen` | `M1` | OPS-05, FIN-18 | 6 |
| `/portal/[mandant]/auftraege/[id]/kundenfreigabe` — record the customer's written release for public use | `referenz.kundenfreigabe_erfassen` | `M1` | PRO-05 | 4 |
| `/portal/[mandant]/aufgaben` , `/[id]` | `aufgabe.lesen` / `aufgabe.schreiben` | `M1` | OPS-11, CRM-04, NOT-03 | 4 |
| `/portal/[mandant]/qualitaet/pruefungen` , `/neu` , `/[id]` — `qualitaetspruefung` | `qualitaet.lesen` / `qualitaet.schreiben` | `M1` | OPS-11, SPEC §22 `qualitaetspruefung` | 5 |
| `/portal/[mandant]/qualitaet/reklamationen` , `/neu` , `/[id]` — intake, cause, remedy, closure | `qualitaet.lesen` / `qualitaet.schreiben` | `M1` | OPS-11, SPEC §22 `reklamation` | 5 |

Quality lives in the `qualitaet` module rather than inside a trade module, because a
Reklamation is raised against an `auftrag` or an `objekt` in any of the three operating
areas — a complaint about a guard is the same record as a complaint about a cleaning round,
and filing it under `reinigung` would put SSE Security's complaints in another entity's
module. The customer-facing end is `/portal/kunde/reklamationen` (§8), read-only until O-74.

Recording the customer release is **not** the same act as publishing a reference: the
release is evidence on the `auftrag`, and the public `referenz` row is created afterwards by
a human in the website module (§5.21), copying only title, area, city, description and
released photos. That separation is why cleaning and security work — which hangs off
`auftrag` and `objekt`, not `projekt` — can produce a website reference at all.

### 5.7 Trade module — Reinigung (CLN-01…CLN-05)

Rendered only where `reinigung` is in `mandant.module` (§1.7).

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/reinigung` — today's Reviere, open Leistungsnachweise, Turnus health | `reinigung.lesen` | `M1` | CLN-01, CLN-02, CLN-04 | 5 |
| `/portal/[mandant]/reinigung/reviere` , `/neu` , `/[id]` — target minutes, assigned rooms | `reinigung.lesen` / `reinigung.schreiben` | `M1` | CLN-01, OPS-02, OPS-03 | 5 |
| `/portal/[mandant]/reinigung/reviere/[id]/raeume` — assign `raum` rows to the Revier | `reinigung.schreiben` | `M1` | CLN-01, OPS-02 | 5 |
| `/portal/[mandant]/reinigung/turnus` , `/neu` , `/[id]` — RRULE builder (RFC 5545), Berlin holiday exclusions, occurrence preview | `reinigung.lesen` / `reinigung.schreiben` | `M1` | CLN-02, CLN-03, TIM-02 | 5 |
| `/portal/[mandant]/reinigung/sonderleistungen` — Glas · Sonderreinigung · Warenräumung as catalogue entries with their own time values | `reinigung.lesen` / `katalog.schreiben` | `M1` | CLN-05, OPS-06 | 5 |
| `/portal/[mandant]/reinigung/leistungsnachweise` | `nachweis.lesen` | `M1` | CLN-04 | 5 |
| `/portal/[mandant]/reinigung/leistungsnachweise/neu` — office fallback for an assignment | `nachweis.schreiben` | `M1` | CLN-04 | 5 |
| `/portal/[mandant]/reinigung/leistungsnachweise/[id]` — the signed snapshot, read-only forever | `nachweis.lesen` | `M1` | CLN-04, FIN-07, LEG-01 | 5 |
| `/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift` — canvas signature | `nachweis.schreiben` | `M1` | CLN-04 | 5 |

**A Revier target minute is a computed target, and the screen says so** (K-16(c)).
`revier.sollzeit_minuten` is derived from `Σ m² ÷ Leistungswert` and is `numeric(8,2)`,
because rounding each room to a whole minute accumulates a visible error across a Revier of
eighty rooms; it is the *computed target*, and the reviere screens label it as one. Every
**measured** duration this module touches — the worked minutes on a `zeiteintrag`, the §17
MiLoG record, a rest period — stays `integer`, because it is evidence and not an estimate.
The distinction is target versus actual, it is stated per column, and no screen ever
subtracts one from the other without naming which side is which.

The signature route stores signer name, the **server** time (invariant 5), location, and a
**snapshot of the items exactly as displayed at signing** (CLN-04). The snapshot is
immutable: if the underlying assignment is corrected afterwards, the proof of what the
customer actually saw survives, and correction is a superseding row (`ersetzt_durch_id`),
never an `UPDATE`.

**One artifact, one service, two entry surfaces.** The worker signs at
`/portal/mein/schichten/[zuordnungId]/leistungsnachweis` (§7) and the office at the route
above; both call `nachweisService.signieren` and both produce the same immutable snapshot
through `withAnstellung` / `withTenant`. Two chromes over one service is not the "two routes,
two truths" failure — two *services* over one artifact would be, and there is only one.

Operator chrome is multilingual (EMP-12); the legal confirmation text the **customer** signs
stays German, because that is the text the entity is bound by.

There is no separate route for glass, special cleaning or Warenräumung beyond the catalogue
entry: CLN-05 makes them distinct `leistungskatalog`/`sonderleistung` rows with their own
time values, so they are ordered, scheduled, evidenced and billed through the same routes as
any other service.

### 5.8 Trade module — Security (SEC-01…SEC-08)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/security` — posts staffed today, expiring certificates, open incidents | `security.lesen` | `M1` | SEC-01, SEC-02, SEC-05 | 5 |
| `/portal/[mandant]/security/posten` , `/neu` , `/[id]` — required qualifications, minimum staffing, 24/7 coverage grid | `security.lesen` / `security.schreiben` | `M1` | SEC-01, SEC-04, TIM-04 | 5 |
| `/portal/[mandant]/security/veranstaltungen` , `/[id]` — event jobs | `security.lesen` | `M1` | SEC-08 | 5 |
| `/portal/[mandant]/security/veranstaltungen/[id]/besetzung` — short-notice staffing board | `dienstplan.schreiben` | `M1` | SEC-08, SEC-04, TIM-05 | 5 |
| `/portal/[mandant]/security/wachbuch` — journal across objects; filter by object, type, date | `wachbuch.lesen` | `M1` | SEC-05, LEG-01 | 5 |
| `/portal/[mandant]/security/wachbuch/neu` — Streife · Vorfall · Übergabe · Schlüssel · Alarm | `wachbuch.schreiben` | `M1` | SEC-05 | 5 |
| `/portal/[mandant]/security/wachbuch/[id]` — entry with server time and photos; corrected only by a superseding row | `wachbuch.lesen` | `M1` | SEC-05, TIM-10, LEG-01 | 5 |
| `/portal/[mandant]/security/dienstanweisungen` , `/neu` , `/[id]` — versions with a diff between them | `dienstanweisung.lesen` / `.schreiben` | `M1` | SEC-06, DOC-05 | 5 |
| `/portal/[mandant]/security/dienstanweisungen/[id]/kenntnisnahmen` — who acknowledged which version, when | `dienstanweisung.lesen` | `M1` | SEC-06, EMP-09 | 5 |
| `/portal/[mandant]/security/schluessel` , `/[id]` — current holder, full history | `schluessel.lesen` | `M1` | SEC-07 | 5 |
| `/portal/[mandant]/security/schluessel/[id]/quittung` — handover receipt with signature | `schluessel.schreiben` | `M1` | SEC-07, CLN-04 (same signature component) | 5 |
| `/portal/[mandant]/security/bewacherregister` — Bewacher-ID and registration status per person | `personal.bewacher_verwalten` | `M1` | SEC-03, LEG-04 | 5 |

`nachweis` (§34a Sachkunde/Unterrichtung) and `bewacher_eintrag` hang off **`person_id`**, not
`anstellung_id` (D-09), so the certificate register itself is the personal-module route of
§5.12 and this module links to it filtered — one table, one route family, one truth. The
Bewacherregister route is a separate surface because it holds registration state with an
external authority, not a certificate.

**SEC-04 is a hard block with no override anywhere.** Assigning a person to a post whose
required certificate is expired **at the shift date** fails in the service and in a database
trigger (`ez_qualifikation_gate`), so it fails identically from the roster UI, the
short-notice staffing board, the API and any agent tool. There is deliberately **no
permission key** that could unlock it: a right no role may hold is an invitation to bind it
(`03-AUTH-BERECHTIGUNGEN.md` §7.6). The distinct, weaker act — acknowledging an ArbZG
*warning* with a written reason — is `dienstplan.arbzg_uebersteuern`, and it never applies to
a certificate.

```ts
// TODO(client): O-40 — the exact Bewacher-ID format and the fields the Bewacherregister
// requires per person. No format is validated until confirmed; the field accepts and
// stores what the authority issued and is flagged `ist_platzhalter` in validation (K-17).
```

### 5.9 Trade module — Bau (BAU-01…BAU-08)

Project-scoped routes carry the project in the path because an Aufmaß without its project is
meaningless; the cross-project lists exist because a site manager asks "which Nachträge are
still unsubmitted", not "which of project 14's".

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/bau` — module overview | `bau.lesen` | `M1` | BAU-04, BAU-06, BAU-07 | 5 |
| `/portal/[mandant]/bau/projekte` , `/[id]` — the `auftrag` with its `projekt` extension | `bau.lesen` | `M1` | OPS-05, REP-05 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/lv` — hierarchical OZ tree | `bau.lesen` | `M1` | BAU-01 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` | `bau.lesen` | `M1` | BAU-01, BAU-05 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/lv/import` — preview before commit, same pattern as OPS-04 | `bau.schreiben` | `M1` | BAU-01, REQ-04, OPS-04 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/aufmass` | `bau.lesen` | `M1` | BAU-02 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/aufmass/neu` — Rechenansatz text **and** computed result, both shown | `bau.aufmass_erfassen` | `M1` | BAU-02, BAU-03, TIM-10 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]` — formula, result, photos, countersignature | `bau.lesen` | `M1` | BAU-02, BAU-03, FIN-07 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]/freigabe` — countersignature | `bau.aufmass_freigeben` | `M1` | BAU-03 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/nachtraege` , `/neu` — §2 VOB/B basis selector | `bau.lesen` / `bau.nachtrag_anmelden` | `M1` | BAU-04 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/nachtraege/[nachtragId]` — `angemeldet_am` and `eingereicht_am` as **separate `timestamptz` fields**, each set by its own right | `bau.lesen` / `bau.nachtrag_einreichen` | `M1` | BAU-04, BAU-05 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/behinderungen` , `/neu` — §6 VOB/B template | `bau.lesen` / `bau.behinderung_erstellen` | `M1` | BAU-06 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/behinderungen/[bid]` — documented send instant and channel | `bau.lesen` | `M1` | BAU-06, LEG-01 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/bautagebuch` — day list | `bau.lesen` | `M1` | BAU-07 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/bautagebuch/[datum]` — weather (DWD), Mannstunden per trade, equipment, deliveries, incidents, photos | `bau.schreiben` | `M1` | BAU-07, BAU-08, TIM-10 | 5 |
| `/portal/[mandant]/bau/projekte/[id]/abnahme` — §12 VOB/B protocol, reservations, defect list | `bau.schreiben` | `M1` | BAU-03, OPS-05 | 5 |
| `/portal/[mandant]/bau/aufmass` — across projects | `bau.lesen` | `M1` | BAU-02 | 5 |
| `/portal/[mandant]/bau/nachtraege` — across projects, "announced but not submitted" filter | `bau.lesen` | `M1` | BAU-04, BAU-05 | 5 |
| `/portal/[mandant]/bau/behinderungen` — across projects | `bau.lesen` | `M1` | BAU-06 | 5 |
| `/portal/[mandant]/bau/bautagebuch` — across projects | `bau.lesen` | `M1` | BAU-07 | 5 |

`[datum]` is a **Berlin calendar date** converted to a half-open UTC range
`[berlin_start, berlin_start + 1 day)` (K-11). A Bautagebuch day resolved at UTC midnight
misfiles one or two hours of Mannstunden into the neighbouring day, every day, and in CEST
the error doubles.

BAU-02: the stored `rechenansatz` text and the computed result are both visible on the
detail page and both printed on the Aufmaß PDF — `"3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"`
→ `30,87 m²`. The parser is a tested service function; no model evaluates it, and the tool
that reads an Aufmaß takes a handle and re-reads the stored `rechenansatz` (invariant 6,
K-10). BAU-05: logging work outside the LV raises a warning on the `zeiteintrag` and on the
LV position, and creates a task for the project manager.

```ts
// TODO(client): O-41 — in which format do LVs arrive: GAEB DA XML (X83/X84), a GAEB D8x
// flat file, Excel, or PDF? BAU-01's importer is written against one `LvParser` interface,
// but the first real file decides which adapter ships. Request three genuine LVs from
// recent tenders before /lv/import is built; until then the route accepts the Excel/CSV
// adapter only and says so.
```

---

### 5.10 Dienstplan (TIM-01…TIM-06, TIM-14, LEG-03)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/dienstplan/woche` — default view, parallel columns | `dienstplan.lesen` | `M1` | TIM-01, TIM-04 | 5 |
| `/portal/[mandant]/dienstplan/monat` | `dienstplan.lesen` | `M1` | TIM-01 | 5 |
| `/portal/[mandant]/dienstplan/tag` — dispatch view | `dienstplan.lesen` | `M1` | TIM-01, TIM-04, DSH-05 | 5 |
| `/portal/[mandant]/dienstplan/serien` , `/neu` , `/[id]` — RRULE builder, single-occurrence overrides | `dienstplan.lesen` / `dienstplan.schreiben` | `M1` | TIM-02, TIM-03, CLN-02 | 5 |
| `/portal/[mandant]/dienstplan/einsatz/[id]` — assignment detail: qualification check, ArbZG panel, conflicts | `dienstplan.lesen`; the ArbZG panel additionally `dienstplan.arbzg_pruefen` (K-06) | `M1` | TIM-05, TIM-06, TIM-14, SEC-04, LEG-03, LEG-04 | 5 |
| `/portal/[mandant]/dienstplan/konflikte` — conflict inbox | `dienstplan.lesen` + `dienstplan.arbzg_lesen` | `M1` | TIM-05, TIM-06, TIM-14, SEC-04 | 5 |
| `/portal/[mandant]/dienstplan/konflikte/[id]/quittung` — acknowledge a conflict | `dienstplan.konflikt_quittieren` | `M1` | TIM-05 | 5 |
| `/portal/[mandant]/dienstplan/konflikte/[id]/uebersteuern` — acknowledge an ArbZG **warning** with a written reason | `dienstplan.arbzg_uebersteuern` | `M1` | TIM-06 | 5 |
| `/portal/[mandant]/dienstplan/offene-schichten` — unstaffed shifts; feeds REC-01 | `dienstplan.lesen` | `M1` | TIM-05, REC-01 | 5 |
| `/portal/[mandant]/dienstplan/veroeffentlichung` — publish a planning period to the workers | `dienstplan.veroeffentlichen` | `M1` | TIM-01, NOT-01 | 5 |

- **TIM-04** — concurrent shifts render as parallel columns. Ten shifts starting at the same
  instant on one object are all visible; none is collapsed into a "+7 more" affordance. This
  is an acceptance test written before the UI (ROADMAP Phase 5).
- **Berlin boundaries** (K-11): the week and month grids, the day view and every "shift
  crossing midnight" render from Berlin wall-clock boundaries converted to instants. A shift
  22:00–06:00 appears on the evening it starts and is 480 minutes long.

#### 5.10.1 The ArbZG panel — the one sanctioned crossing of the tenant boundary (K-06)

TIM-14, LEG-03 and D-09 consequences 1 and 2 require aggregating one person's hours **across
entities**. K-03 makes that impossible by design: a planner in `reinigung` cannot see a
`security` shift. Left unresolved the check silently returns "no conflict" and a 6h + 5h day
is scheduled as lawful — the exact failure D-09 was written to prevent, with no error to
notice. K-06 opens exactly one narrow, audited, tested crossing, and this map renders only
what that function returns:

```sql
app.arbzg_belastung(p_person uuid, p_von timestamptz, p_bis timestamptz)
  returns table (fenster_gruppe text,   -- opaque hash, for deduplication only
                 beginn_utc timestamptz, ende_utc timestamptz,
                 minuten integer, fremd boolean)
```

`SECURITY DEFINER`, owned by `cse_definer`, preconditioned on `app.person_sichtbar(p_person)`
and on holding `dienstplan.arbzg_pruefen` in the active mandant, and audited per call as
`arbzg.aggregat_gelesen`.

**Which is why the route that renders the panel is gated on that right and not only on
`dienstplan.lesen`.** A planner holding `dienstplan.lesen` alone reaches a page whose one
function call is refused, and a refused ArbZG panel that renders empty reads as *no
conflict* — the exact silent failure K-06 exists to prevent, now with a screen vouching for
it. The panel therefore has two states and no third: with `dienstplan.arbzg_pruefen` it
renders the projection below; without it, it renders an explicit
„ArbZG-Prüfung nicht berechtigt" state (DESIGN §5 `warning` pill) and **never an empty
result**. `dienstplan.arbzg_lesen` — reading a finding already recorded in one's own plan —
is the weaker, separate right that gates `/dienstplan/konflikte`; querying another entity's
load is a different act and carries a different key
(`02-datenmodell/04-PLANUNG-ZEIT.md` §6.3).

**The conflict card therefore shows the breach type, the conflicting window and `fremd`, and
nothing else.** No `mandant_id`, no entity name, no object, no customer, no
`personalnummer`, no rate. An earlier draft had the card name the other entity; K-06 forbids
it and the convention wins. The planner learns *that* the person is otherwise committed and
for how long — which is everything needed to act — and never *where* or *for whom*. The
isolation suite asserts that a `reinigung` planner gets the breach and zero fields
identifying the `security` shift (SEC-A3 assertions 20–21).

Findings are written by `app.arbzg_befund_schreiben(...)`, because a breach spanning two
entities must be recorded in both and a request scoped to mandant A cannot write a row in
mandant B; `arbeitszeit_verstoss` has no INSERT policy for `cse_app` at all.

```ts
// TODO(client): O-42 — may an ArbZG conflict card name the other entity, given §87 BetrVG
// and data minimisation? The platform ships the K-06 minimum (breach type, window,
// `fremd`) and nothing more; naming the entity would require the works council's and the
// DPO's agreement (relates to O-06).
```

### 5.11 Zeiterfassung (TIM-07…TIM-13, EMP-04, EMP-07, LEG-02)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/zeiten` — entries; filter by object, person, week, status | `zeit.lesen` | `M1` | TIM-08, TIM-12, TIM-13, LEG-02 | 5 |
| `/portal/[mandant]/zeiten/live` — "Aktuell im Einsatz" board | `zeit.lesen` | `M1` | DSH-05, TIM-08 | 5 |
| `/portal/[mandant]/zeiten/[id]` — server time, `geraete_zeit`, `zeitabweichung_sek`, geo points, media, correction trail | `zeit.lesen` | `M1` | TIM-08, TIM-09, TIM-10, TIM-11, LEG-10 | 5 |
| `/portal/[mandant]/zeiten/[id]/korrektur` — manual correction: who, when, **why** | `zeit.korrigieren` | `M1` | TIM-11, LEG-01, SEC-A9 | 5 |
| `/portal/[mandant]/zeiten/korrekturen` — correction log across entries | `zeit.lesen` | `M1` | TIM-11, LEG-01, SEC-A9 | 5 |
| `/portal/[mandant]/zeiten/einwaende` , `/[id]` — objection inbox; the employee raises, the planner decides | `zeit.einwand_entscheiden` | `M1` | EMP-07, TIM-11 | 5 |
| `/portal/[mandant]/zeiten/nacherfassung` — offline claims awaiting a human decision | `zeit.nacherfassung_pruefen` | `M1` | TIM-09, TIM-11 | 5 |
| `/portal/[mandant]/zeiten/checkin-links` — issue, re-issue, revoke; who has a link, who used it | `zeit.checkin_verwalten` | `M1` | TIM-07 | 5 |
| `/portal/[mandant]/zeiten/freigabe` — release worked time for billing — **blocked on O-39** | `zeit.abrechnung_freigeben` (blocked on O-39) | `M1` | TIM-12, FIN-07, FIN-18 | 6 |
| `/portal/[mandant]/zeiten/milog` — §17 MiLoG record; start, end, duration; two-year retention view; export | `zeit.exportieren` | `M1` | TIM-13, LEG-02, ACC-12 | 5 |

**`/zeiten/freigabe` and its right are blocked on O-39, and the row says so rather than
shipping.** `02-datenmodell/04-PLANUNG-ZEIT.md` §1.3 owns `zeiteintrag` and records O-39
(`zeit-freigabeschritt`) as open: whether a release step between recorded time and billing
exists at all is a client decision, and K-17 forbids seeding a right for a workflow step
nobody has confirmed. Until O-39 is answered, `zeit.abrechnung_freigeben` is **not
seeded and has no default binding** in `03-AUTH-BERECHTIGUNGEN.md` §12.4, this route does not
ship, and FIN-07 sources invoice lines from `zeiteintrag` rows attached to the `auftrag`
directly (§5.14). The two adjacent Dienstplan keys this map uses on the same document's
tables — `dienstplan.veroeffentlichen` and `dienstplan.arbzg_uebersteuern`, both in §5.10 —
are **not** in that position: they are seeded in §12.4 and are load-bearing for TIM-04 and
for the K-06 override trail, so `02-datenmodell/04-PLANUNG-ZEIT.md` §1.3 must carry them in
its key table rather than this map dropping them (§17).

```ts
// TODO(client): O-39 `zeit-freigabeschritt` — is there a release step between recorded time
// and billing (a planner "releases" a week of `zeiteintrag` rows before they may be
// invoiced), or does a finalised invoice claim the rows directly? The route above and the
// right `zeit.abrechnung_freigeben` exist only if the answer is yes.
```

**The MiLoG record is enabled for all four mandanten**, not only cleaning and construction.
LEG-02 names those two, but §2a SchwarzArbG's sector list also covers the Wach- und
Sicherheitsgewerbe; module-gating this route on the strength of LEG-02's wording would leave
SSE Security without the record it is obliged to keep. Stated here so a later PR does not
"optimise" it away.

Nothing on these routes hard-deletes (invariant 8): a corrected entry keeps its predecessor,
and `zeiteintrag` attaches to the `auftrag` directly (TIM-12), which is why
`/finanzen/rechnungen/neu` can source lines from time without a manual transfer step
(FIN-07).

### 5.12 Personal — `person` and `anstellung` (D-09, EMP-*, SEC-02, SEC-03)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/personal/anstellungen` — the employments of **this** entity | `personal.lesen` | `M1` | D-09, AUT-01 | 3 |
| `/portal/[mandant]/personal/anstellungen/neu` — find or create the `person`, then create the employment | `personal.schreiben` | `M1` | D-09, EMP-14 | 3 |
| `/portal/[mandant]/personal/anstellungen/[id]` — tabs: Übersicht · Einsätze · Zeiten · Stundenkonto · Urlaubskonto · Abwesenheiten · Dokumente · (Nachweise, Zugang: **read-only mirrors**) | `personal.lesen` | `M1` | D-09, EMP-04, EMP-05, EMP-08, EMP-15 | 3 |
| `/portal/[mandant]/personal/anstellungen/[id]/vertrag` — `personalnummer`, Eintritt (`date`), Austritt (`date`), Arbeitszeitmodell, Wochenstunden | `personal.schreiben` | `M1` | D-09, EMP-04 | 3 |
| `/portal/[mandant]/personal/anstellungen/[id]/entgelt` — the internal hourly cost rate | `personal.entgelt_lesen` / `personal.entgelt_schreiben` | `M1` | D-09 §6, K-05 | 3 |
| `/portal/[mandant]/personal/anstellungen/[id]/beenden` — end the employment | `personal.anstellung_beenden` | `M1` | D-09, K-14 | 3 |
| `/portal/[mandant]/personal/personen` , `/[id]` — the human: identity, contact, language, certificates, Bewacher-ID, login, and the list of employments **by entity name only** | `personal.lesen` | `M1` | D-09, EMP-14, SEC-02, SEC-03 | 3 |
| `/portal/[mandant]/personal/personen/[id]/stammdaten` — birth date, birthplace, nationality | `personal.stammdaten_lesen` | `M1` | SEC-03, LEG-09 | 3 |
| `/portal/[mandant]/personal/personen/[id]/zugang` — invite, re-bind the mobile number, revoke | `personal.zugang_verwalten` | `M1` | EMP-01, AUT-08 | 3 |
| `/portal/[mandant]/personal/nachweise` — certificate register with 60/30/7-day expiry escalation | `personal.nachweis_lesen` | `M1` | SEC-02, EMP-08, LEG-04 | 5 |
| `/portal/[mandant]/personal/nachweise/[id]` | `personal.nachweis_verwalten` | `M1` | SEC-02, SEC-03, SEC-04 | 5 |
| `/portal/[mandant]/personal/abwesenheiten` , `/[id]` — calendar + list | `zeit.abwesenheit_lesen` | `M1` | EMP-05, EMP-10 | 5 |
| `/portal/[mandant]/personal/antraege` , `/[id]` — leave, swap and sickness inbox; approve or decline | `zeit.antrag_entscheiden` | `M1` | EMP-10, NOT-01 | 5 |
| `/portal/[mandant]/personal/stundenkonten` — target versus actual per employment, monthly lock state | `zeit.konto_lesen` | `M1` | EMP-04, EMP-15, REP-04 | 5 |
| `/portal/[mandant]/personal/stundenkonten/[anstellungId]` — balance, carry-forward, month history | `zeit.konto_lesen` | `M1` | EMP-04, EMP-15 | 5 |
| `/portal/[mandant]/personal/stundenkonten/abschluss` — lock a month (§5.12.2) | `zeit.konto_abschliessen` | `M1` | EMP-04, LEG-01 | 5 |
| `/portal/[mandant]/personal/zusammenfuehren` — merge two `person` rows that are one human | `personal.zusammenfuehren` | `M1` | D-09, LEG-09 | 5 |

#### 5.12.1 The split is in the URL on purpose, and person facts have exactly one editor

`anstellungen/[id]` is tenant-scoped and carries the money — a cleaning manager opening it
sees cleaning rates and only cleaning rates. `personen/[id]` is the human: certificates,
Bewacher-ID, login, language. It shows *that* a further employment exists and in which
entity — needed for ArbZG and EMP-14 — and never its rate, customer or object (D-09 §6).

An earlier draft put editable **Zugang** and **Nachweise** tabs on the employment page. That
is invariant 9 broken in route form: a person employed by `reinigung` and `security` would
have two employment pages, each with an editable tab over the *same* login and the *same*
certificate set — two edit surfaces over one row, which is how you get one valid and one
expired copy of the same §34a certificate, and how a cleaning admin resets the SMS login of
a person who is primarily a guard. Corrected: on `anstellungen/[id]` those tabs are
**read-only mirrors that link to `personen/[id]`**, and every write to `nachweis`,
`bewacher_eintrag`, `mitarbeiter_zugang` and `person` happens on the person route only.

Which mandant may write a person-level row when several employ the person: **any employing
mandant whose caller holds the right in the active mandant**, because `app.hat_recht` takes
the mandant argument (K-03) and `person` is visible to every mandant the person is employed
by (D-09 §6). Every such write is audited with the writing mandant, and `nachweis` keeps
every version, so a later dispute is answerable. Re-binding a worker's mobile number is a
complete takeover of their only authentication factor and carries mandatory controls: old
and new number in the audit row, every session revoked, notice to the **old** number as well
as the new one, and refusal while an open `zeit_einwand` of that person is undecided.

```ts
// TODO(client): O-43 — when two entities employ the same person, should one of them own
// certificate maintenance and the worker login, or may every employing entity edit them?
// The platform implements the second (any employing entity with the right, fully audited)
// because SEC-04 must never fail for want of an owner; confirm, or nominate an owner.
// TODO(client): O-86 `auth-mobilnummer-vieraugen` — should re-binding a worker's mobile
// number require a second approver (four eyes)?
```

Attachment rules, restated because getting them wrong is silent and expensive.
`einsatz_zuordnung`, `zeiteintrag`, `stundenkonto`, `urlaubskonto`, `abwesenheit` →
`anstellung_id`. `nachweis`, `bewacher_eintrag`, `mitarbeiter_zugang` → `person_id`.

**The types on this family are load-bearing and are fixed here rather than per PR.**
`anstellung.eintritt` and `.austritt` are `date` — an employment begins on a day, not at an
instant. `nachweis.gueltig_bis` is a `date`, and SEC-04 evaluates it against the **Berlin
calendar date of the shift**, not against `now()`: a certificate expiring on the day of a
22:00–06:00 shift must fail the assignment for that shift, and comparing an instant to a
UTC-derived date gets that wrong twice a year. Every act — `angemeldet_am`,
`eingereicht_am`, a Behinderung's send instant, an acknowledgement, a signature, a lock —
is `timestamptz` stored UTC, because an act happens at an instant and its evidentiary value
depends on which one (invariant 2, K-11, K-16).

#### 5.12.2 Locking a month is a Berlin-boundary act (EMP-04, K-11)

`stundenkonten/abschluss` closes a month one-way, exactly like an invoice. Two rules the
screen must express, because a lock cannot be undone:

1. The month boundary is **Berlin wall-clock**, converted to instants
   (`2026-01-31 23:00Z` for CET, `22:00Z` for CEST) — not UTC midnight. Splitting at UTC
   midnight misattributes 60 minutes in winter and 120 in summer, into a month that is about
   to become unchangeable.
2. A shift crossing the boundary is **split by actual minutes per month** before the lock,
   and the screen shows the split rows for confirmation. `splitteNachMonat` is the tested
   function; the ROADMAP Phase 5 acceptance case
   `2026-01-31 20:00 → 2026-02-01 04:00 → [{2026,1,240}, {2026,2,240}]` is a reference test
   with a CET and a CEST variant, so a UTC implementation cannot pass by accident.

A correction arriving after the lock books into the **first open month**, carrying a
reference back to the locked one — never backwards, exactly like an invoice (EMP-04).

### 5.13 Stammdaten (OPS-03, SEC-01, EMP-05, EMP-10)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/stammdaten/qualifikationen` — the qualification catalogue posts and assignments reference | `stammdaten.verwalten` | `M1` | SEC-01, SEC-04, LEG-04 | 5 |
| `/portal/[mandant]/stammdaten/belagsarten` — floor types with m²/h performance values | `stammdaten.verwalten` | `M1` | OPS-03 | 4 |
| `/portal/[mandant]/stammdaten/reinigungsklassen` | `stammdaten.verwalten` | `M1` | OPS-02 | 4 |
| `/portal/[mandant]/stammdaten/abwesenheitsarten` | `stammdaten.verwalten` | `M1` | EMP-05, EMP-10 | 5 |
| `/portal/[mandant]/stammdaten/antragsarten` | `stammdaten.verwalten` | `M1` | EMP-10 | 5 |

SEC-01 requires posts to declare required qualifications and SEC-04 makes an expired one a
hard block; without a route to define the catalogue, `security/posten/[id]` displays a
requirement it has no way to create. An earlier draft had no such route at all.

### 5.14 Finanzen (FIN-01…FIN-18, LEG-05, LEG-06)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/finanzen` — revenue, expenses, profit for this entity | `finanzen.lesen` | `M1` | FIN-17, REP-01, DSH-04 | 6 |
| `/portal/[mandant]/finanzen/pruefungen` — completed order with no time recorded, and the other pre-invoice checks | `finanzen.lesen` | `M1` | FIN-18 | 6 |
| `/portal/[mandant]/finanzen/rechnungen` — filter Entwurf · Festgeschrieben · Bezahlt · Storniert · Verworfen | `finanzen.lesen` | `M1` | FIN-02, FIN-16 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/neu` — billing type, then source: contract · Zeiteinträge · Aufmaß · material | `finanzen.schreiben` | `M1` | FIN-01, FIN-07, FIN-08, TIM-12 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]` — **draft editor** or **finalised read-only view**, never both | `finanzen.lesen` | `M1` | FIN-02, FIN-05, FIN-07 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/pruefung` — the §14 UStG pre-flight report | `finanzen.lesen` | `M1` | FIN-04, FIN-05, FIN-13, LEG-05 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/festschreiben` — the one-way gate | `finanzen.festschreiben` | `M1` | FIN-02, FIN-03, FIN-06, LEG-01 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/verwerfen` — discard a draft (status transition, **not** a delete) | `finanzen.entwurf_verwerfen` | `M1` | FIN-02, FIN-03, invariant 8 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/storno` — reversing entry | `finanzen.stornieren` | `M1` | FIN-02, LEG-01, invariant 4 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/abschlaege` — prior partials and their deduction | `finanzen.lesen` | `M1` | FIN-08 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/versand` — dispatch log; XRechnung / ZUGFeRD / PDF | `versand.lesen` / `versand.freigeben` | `M1` | FIN-11, FIN-12, invariant 7 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/xrechnung` — UBL preview and validation state | `finanzen.herunterladen` | `M1` | FIN-11, LEG-05 | 6 |
| `/portal/[mandant]/finanzen/rechnungen/[id]/zugferd` — PDF/A-3 preview | `finanzen.herunterladen` | `M1` | FIN-12 | 6 |
| `/portal/[mandant]/finanzen/ausgangsbuch` — per number circle, gapless, hash-chain state | `nummernkreis.lesen` | `M1` | FIN-16, FIN-06, TEN-02, LEG-01 | 6 |
| `/portal/[mandant]/finanzen/hashkette` — the nightly verification report | `finanzen.lesen` | `M1` | FIN-06, LEG-01 | 6 |
| `/portal/[mandant]/finanzen/eingangsrechnungen` , `/neu` — upload; the OCR proposal appears in Freigaben | `eingang.lesen` / `eingang.schreiben` | `M1` | FIN-14, ACC-05, DOC-06 | 6 |
| `/portal/[mandant]/finanzen/eingangsrechnungen/[id]` — extracted fields with source and confidence | `eingang.lesen` | `M1` | ACC-05, APR-03 | 6 |
| `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer` — the supplier's §48b certificate, validated at the service date | `abrechnung.freistellung_pflegen` | `M1` | FIN-10, LEG-06 | 6 |
| `/portal/[mandant]/finanzen/eingangsrechnungen/[id]/freigabe` — release for payment | `eingang.freigeben` | `M1` | FIN-14, invariant 7 | 6 |
| `/portal/[mandant]/finanzen/belege` , `/[id]` | `eingang.lesen` | `M1` | FIN-14, ACC-03 | 6 |
| `/portal/[mandant]/finanzen/ausgaben` , `/[id]` | `eingang.lesen` | `M1` | FIN-14, FIN-17 | 6 |
| `/portal/[mandant]/finanzen/zahlungen` , `/[id]` | `zahlung.lesen` | `M1` | FIN-14, ACC-04 | 6 |
| `/portal/[mandant]/finanzen/mahnungen` , `/[id]` — escalation level, fee, interest | `mahnung.lesen` | `M1` | FIN-15 | 6 |
| `/portal/[mandant]/finanzen/mahnungen/vorschlaege` — agent-proposed dunning awaiting approval | `mahnung.freigeben` | `M1` | FIN-15, APR-01, AGT-03 | 8 |
| `/portal/[mandant]/finanzen/nummernkreise` — number circles; counters read-only | `nummernkreis.lesen` / `nummernkreis.verwalten` | `M1` | TEN-02, FIN-03, FIN-16 | 6 |

#### 5.14.1 What invariant 4 forces the routes to express

- `rechnungen/[id]` renders **no number** while the invoice is `entwurf` — the field is
  absent, not blank, not „wird vergeben". A draft holding a reserved number is how gaps
  happen. The number is drawn at finalisation under `SELECT … FOR UPDATE` on the
  `nummernkreis` counter row (FIN-03), inside the same transaction that writes
  `hash = SHA256(payload ‖ previous_hash)` (FIN-06).
- **Discarding a draft is a status transition**, `entwurf → verworfen`, with
  `verworfen_am`, `verworfen_von`, `verworfen_grund`. No row leaves `rechnung`, which is why
  "deleting 1000 drafts leaves zero gaps" holds by construction.
- **A finalised invoice has no edit affordance at all** (K-12). Nothing that changes after
  finalisation lives on the invoice row: dispatch state is `rechnung_versand`, the Storno
  back-reference is `rechnung_beziehung`, and the immutability trigger is unconditional — a
  column allowlist in that trigger would leave invariant 4 with no database-level guarantee.
- The canonical payload **snapshots identity**, not references to it: issuer name, address,
  Steuernummer/USt-IdNr, HRB and court; recipient name, address, USt-IdNr, Leitweg-ID; per
  tax line the rate, net cents, tax cents and any exemption note; plus `abrechnungsart`,
  `bauabzugsteuer_cent`, the Kleinbetrag flag and the Leistungszeitraum. With only
  `kunde_id` and `mandant_id` as references, editing the customer master or the entity's tax
  number later changes what the invoice, the XRechnung and the PDF say while chain
  verification still reports `intakt: true`. **The PDF and the XRechnung are rendered from
  the snapshot**, never from live master data.
- `/storno` is the only path to a correction (invariant 4, LEG-01).

#### 5.14.2 The §14 UStG pre-flight (FIN-04, LEG-05)

`rechnungen/[id]/pruefung` renders the report of `services/finanz/ustg14.ts` — nineteen
rules, enumerated in `02-datenmodell/05-FINANZEN.md` §9, each `Befund` carrying `feld`,
`regel`, `text_de` and a link to the record that fixes it (DSH-04). Finalisation aborts on
any `fehler`; the whole report, with its ruleset version, is frozen into
`rechnung_snapshot.pflichtfeld_pruefung` so that an audit in 2032 can see which rules were
applied in 2026. The screen names, at minimum: issuer name and address; recipient name and
address; issuer Steuernummer or USt-IdNr; invoice date; the number and its circle; quantity,
unit and handelsübliche Bezeichnung per line; **Leistungszeitraum** — or
`vereinnahmung_geplant_am` on an Abschlag/Anzahlung, the §14 Abs. 4 Nr. 6 alternative; the
net split per tax-rate group with every agreed reduction; rate and tax amount per group or
the exemption note; the §14 Abs. 4 Nr. 9 / §14b retention notice where the recipient is a
private person and the service relates to a Grundstück — **reachable for Gebäudereinigung and
Bau, which is why it appears here and not only in a tax textbook**; the §13b note plus the
recipient's USt-IdNr and a matching dated `kunde_bauleistender_status`; the Schlussrechnung
deduction of every finalised partial; the XRechnung field set; and line-to-source coverage
(FIN-07).

§48 EStG has **three** outcomes, not two, and the screen says which one it applied and
against **which date**: a certificate valid at the *service* date; no certificate but the
year's expected consideration at or below the exemption threshold; otherwise withhold. While
the threshold row is a placeholder the rule is a `fehler` and finalisation is refused with
the open question named — it never defaults to withholding, because over-withholding on a
small subcontractor's invoice is unlawful and the group is liable for the amount it kept.

```ts
// TODO(client): O-04 — the exact five billing types (FIN-01) are named in SPEC; what is
// missing is their *rules*: rounding, minimum billing unit, treatment of night, Sunday and
// holiday surcharges, how a single call-off interacts with a monthly flat, and the
// Leistungszeitraum mode per type. Implemented behind one `AbrechnungsStrategie`
// interface with five clearly-labelled placeholder strategies until answered; a contract
// on a placeholder strategy renders "Unbestätigter Wert" and cannot be invoiced.
// TODO(client): O-44 — dunning: how many levels, at what day offsets, with what fee per
// level and what interest basis (§288 BGB)? `mahnstufe.ist_platzhalter` is true until
// answered and a dunning run refuses to send with an invented fee (§5.24).
```

#### 5.14.3 XRechnung validation is never claimed, only reported

FIN-11 places KoSIT validation in CI, and the KoSIT validator is a Java tool. The route
therefore shows one of exactly three states, and never a fourth that looks like a pass:
**„In CI validiert"** with the ruleset version the CI run used; **„Prüfung ausstehend"**
where an instance has not yet been validated; or **„Prüfer nicht verbunden"** where no
validator sidecar is configured, with the XML still downloadable. An unspecified
"validation report" becomes a fake one, and a fake XRechnung pass is discovered by the buyer
rejecting the invoice.

### 5.15 Buchhaltung and DATEV (ACC-01…ACC-12, LEG-01)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/buchhaltung` — overview | `buchhaltung.lesen` | `M1` | ACC-07, ACC-08 | 7 |
| `/portal/[mandant]/buchhaltung/buchungen` , `/[id]` — records generated from invoices | `buchhaltung.lesen` | `M1` | ACC-01, ACC-03 | 7 |
| `/portal/[mandant]/buchhaltung/perioden` — period lock | `buchhaltung.festschreiben` | `M1` | ACC-01, LEG-01 | 7 |
| `/portal/[mandant]/buchhaltung/konten` — SKR03/SKR04 chart and `konto_mapping` | `buchhaltung_konfiguration.verwalten` | `M1` | ACC-01 | 7 |
| `/portal/[mandant]/buchhaltung/datev` — export list + **connection status** | `buchhaltung.exportieren` | `M1` | ACC-02, ACC-03 | 7 |
| `/portal/[mandant]/buchhaltung/datev/neu` — period selection, EXTF generation | `buchhaltung.exportieren` | `M1` | ACC-02 | 7 |
| `/portal/[mandant]/buchhaltung/datev/[id]` — download + Belegverknüpfung manifest | `buchhaltung.exportieren` | `M1` | ACC-02, ACC-03 | 7 |
| `/portal/[mandant]/buchhaltung/bank` , `/import` (CAMT.053) , `/[auszugId]` — matching by amount + invoice number + IBAN, unmatched queue | `buchhaltung.lesen` / `zahlung.schreiben` | `M1` | ACC-04, FIN-14 | 7 |
| `/portal/[mandant]/buchhaltung/offene-posten` — debtors and creditors | `buchhaltung.lesen` | `M1` | ACC-07, FIN-15 | 7 |
| `/portal/[mandant]/buchhaltung/monatszahlen` — BWA-style figures per entity | `buchhaltung.lesen` | `M1` | ACC-08, REP-01 | 7 |
| `/portal/[mandant]/buchhaltung/archiv` — GoBD archive, 10-year retention, **deletion impossible** | `buchhaltung.lesen` | `M1` | ACC-06, DOC-07, LEG-01 | 7 |
| `/portal/[mandant]/buchhaltung/z3-export` — §147 Abs. 6 AO | `buchhaltung.exportieren` | `M1` | ACC-09 | 7 |
| `/portal/[mandant]/buchhaltung/verfahrensdokumentation` — generated from live configuration | `buchhaltung_konfiguration.lesen` | `M1` | ACC-10, LEG-01 | 7 |
| `/portal/[mandant]/buchhaltung/jahrespaket` — one-click package for the tax advisor | `buchhaltung.exportieren` | `M1` | ACC-11, D-06 | 7 |
| `/portal/[mandant]/buchhaltung/lohnexport` — time data for the payroll system | `zeit.exportieren` | `M1` | ACC-12, TIM-13, D-06 | 7 |

`/buchhaltung/datev` renders a **status block, never a simulation**. Until real credentials
exist it reads „DATEV: nicht verbunden — der Export erzeugt eine Datei zum Download", and
the export is a genuine EXTF file the user downloads: Windows-1252, comma decimal separator
(ACC-02). No screen in this module ever reports a transmission that did not happen.

ACC-09 covers **Z3** (data medium handover). §147 Abs. 6 AO also provides Z1 (the auditor
reading on the live system) and Z2 (evaluation by the taxpayer on request). The platform
ships Z3 only, and no read-only auditor role exists.

```ts
// TODO(client): O-05 — DATEV: Beraternummer, Mandantennummer per entity, SKR03 or SKR04,
// Sachkontenlänge, the Steuerschlüssel table and the fiscal year start — plus a real
// sample EXTF export from the tax advisor before ACC-02 is built. The phase is not done
// until they accept a file without rework. `buchhaltung_konfiguration.verwalten` stays
// blocked until then, and every mapping row is `ist_platzhalter`.
// TODO(client): O-45 — does the tax audit expect Z1 or Z2 access as well as Z3? A
// read-only Prüfer role is a designed feature with its own audit class, not a spare login.
```

---

### 5.16 Dokumente (DOC-01…DOC-08)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/dokumente` — categories, search, filter, tags | `dokument.lesen` | `M1` | DOC-01, DOC-02, DOC-04 | 4 |
| `/portal/[mandant]/dokumente/upload` — MIME sniffed from the bytes, size limits, EXIF stripped | `dokument.schreiben` | `M1` | DOC-06, TIM-10 | 4 |
| `/portal/[mandant]/dokumente/[id]` — metadata, versions, access log | `dokument.lesen` | `M1` | DOC-05, DOC-07, SEC-A9 | 4 |
| `/portal/[mandant]/dokumente/[id]/kundenfreigabe` — flip `sichtbar_fuer_kunde` | `dokument.kunde_freigeben` | `M1` | DOC-04 | 4 |
| `/portal/[mandant]/dokumente/buendel` — one-click bundle for an audit or inspection | `dokument.buendel_exportieren` | `M1` | DOC-08, ACC-09, LEG-01 | 7 |
| `/portal/[mandant]/dokumente/aufbewahrung` — retention rules per category | `dokument.aufbewahrung_verwalten` | `M1` | DOC-07, LEG-01 | 7 |

Categories are fixed by DOC-01: `kunde · vertrag · angebot · rechnung · beleg · mitarbeiter ·
projekt · buchhaltung · unternehmen`. **No file is served from a public path**: every
download goes through a handler that mints a 15-minute signed URL *after* the authorization
decision, the row has been read through RLS, and — for a customer — `sichtbar_fuer_kunde = true`
and a matching `kunde_id` (DOC-03, DOC-04, SEC-A6). List endpoints never return URLs for
rows the caller cannot read, and never return the storage path.

**There is no `dokument.loeschen` key.** DOC-07 and LEG-01 make financial documents
undeletable, and a key that must never resolve true for the categories that matter is a key
waiting to be bound. Removal of a wrongly filed document is `dokument.archivieren` — soft,
audited — and the finance categories are excluded from it by the service.

Retention periods are legal values SPEC does not state for most categories, so the screen
renders the class, its basis and its computed `aufbewahrung_bis` where one is stated, and an
explicit „Frist offen (O-46)" where it is not. A blank retention screen that silently
defaults to "keep forever" or "delete after a year" is both a GoBD risk and a DSGVO risk.

```ts
// TODO(client): O-46 — the retention period and legal basis per data class where SPEC
// states none: planning data (`einsatz`, `einsatz_zuordnung`, `planungsserie`), shift media,
// check-in tokens and offline claims, ArbZG findings, applicant data (REC-07/LEG-11), and
// each DOC-07 document category. The stated ones are fixed: §17 MiLoG two years for time
// records, §147 AO ten years from the end of the calendar year for GoBD-relevant records.
// Until the rest are answered `aufbewahrung_bis` stays NULL, `loeschsperre` stays true,
// and the purge job considers no row.
```

### 5.17 Kalender, Aufgaben, Nachrichten, Benachrichtigungen (CAL-01…CAL-03, NOT-01…NOT-03)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/kalender` — month · week · day | `kalender.lesen` | `M1` | CAL-01, CAL-02 | 9 |
| `/portal/[mandant]/kalender/[id]` | `kalender.lesen` / `kalender.schreiben` | `M1` | CAL-01 | 9 |
| `/portal/[mandant]/nachrichten` , `/[id]` — the staff-side thread inbox | `nachricht.lesen` / `nachricht.versenden` | `M1` | EMP-11, NOT-03, SPEC §22 `nachricht` | 3 |
| `/portal/[mandant]/benachrichtigungen` — notification centre; every item links to its record | `bericht.dashboard_lesen` | `M1` | NOT-01, NOT-03 | **2** |

The calendar aggregates projects, assignments, meetings, customer appointments, deadlines,
follow-ups and interviews (CAL-01) and filters by area, team and person (CAL-02). The
per-user iCal feed is **not** a tenant route: it lives at `/portal/konto/kalender-feed` (§9),
because one person may hold roles in several entities and the feed is a property of the
human.

`/nachrichten` is the office end of the customer and worker message threads. Without it a
customer message written at `/portal/kunde/nachrichten` and a worker message at
`/portal/mein/nachrichten` land where no `leitung` can read them, and NOT-03's "every
notification links to its record" has no target.

The notification centre ships in **Phase 2**, not later: Phase 2's REQ-06 SLA escalation is
the first watchdog in the product and it needs somewhere to land the same week it starts
firing. Per-user channel preferences (NOT-02) arrive with Phase 9 at
`/portal/konto/benachrichtigungen`.

### 5.18 Tender radar and Vergabe (RAD-01…RAD-09, D-07)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/radar` — notices, score, deadline countdown | `radar.lesen` | `M1` | RAD-01, RAD-02, RAD-05, RAD-06, RAD-07, RAD-08 | 8 |
| `/portal/[mandant]/radar/[id]` — score reason, raw payload, documents, platform check | `radar.lesen` | `M1` | RAD-03, RAD-05, RAD-06, RAD-07, RAD-09 | 8 |
| `/portal/[mandant]/radar/[id]/status` — the RAD-07 transition control | `radar.status_setzen` | `M1` | RAD-07, REP-06 | 8 |
| `/portal/[mandant]/radar/[id]/mappe` — Vergabemappe assembly, completeness gaps named | `vergabe.schreiben` | `M1` | RAD-07, AGT-02, APR-03, D-07 | 8 |
| `/portal/[mandant]/radar/[id]/mappe/einreichung` — record that a human submitted, with when and by whom | `vergabe.einreichung_erfassen` | `M1` | RAD-07, D-07, REP-06 | 8 |
| `/portal/[mandant]/radar/profile` , `/[id]` — CPV codes, NUTS DE3/DE300, positive and negative keywords, value bounds | `radar.profil_schreiben` | `M1` | RAD-04 | 8 |
| `/portal/[mandant]/radar/plattformen` — registration status per procurement platform | `radar.plattform_verwalten` | `M1` | RAD-09 | 8 |

**RAD-07's vocabulary is rendered as an explicit transition control**, because D-07 correctly
removes any submit button and without a control `eingereicht` and `verworfen` could never be
recorded — leaving REP-06's "found · screened · bid · won" report with no data:

| Status | Set by | Requires |
|---|---|---|
| `neu` | ingestion | — |
| `geprueft` | `radar.status_setzen` | — |
| `verworfen` | `radar.status_setzen` | **a reason, mandatory** (RAD-07) |
| `in_bearbeitung` | `radar.status_setzen` | a Vergabemappe exists |
| `eingereicht` | `vergabe.einreichung_erfassen` | the submitting human, the instant, and the platform used |

The score column shows a **human-readable reason string produced by deterministic code**
(RAD-05); no model output ranks a notice. Deadlines under five days render with the `danger`
pill (RAD-06, DESIGN §5). A notice requiring a platform the group is not registered on is
flagged **in the list**, not only on the detail page (RAD-09), because discovering that gap
on deadline day wastes the opportunity entirely. Submission is manual by design (D-07):
there is no "submit" control anywhere in this module.

**Notice values are money and are stored as `bigint` cents** (invariant 1, K-16) with an
explicit `waehrung`. TED notices arrive with decimals and occasionally in a non-EUR currency;
a value in a currency other than the profile's is marked
`bewertung.wert_kriterium = 'fremdwaehrung'` and is **unscored on the value criterion** rather
than silently converted at an invented rate. `radar_profil` value bounds carry the same
currency column.

```ts
// TODO(client): O-07 — which procurement platforms is the group registered on, and under
// whose name? Seeds `vergabeplattform` and decides which notices are flagged unreachable.
// TODO(client): O-47 — which FX source and which conversion date apply to a foreign-currency
// notice value? Until answered no conversion happens and the notice is shown unscored on
// value, never converted (K-17).
```

CPV codes are seeded from SPEC §6's starting points **only after verification against the
official list**; an unverified code is `ist_platzhalter` and shown as such in the profile
editor (K-17).

### 5.19 Agent Center (AGT-01…AGT-07, D-03)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/agenten` — the four agents with status | `agent.lesen` | `M1` | AGT-01, D-03 | 8 |
| `/portal/[mandant]/agenten/[agent]` — description, tasks, activity, connected tools, approval requirements | `agent.lesen` | `M1` | AGT-01, AGT-02, AGT-03 | 8 |
| `/portal/[mandant]/agenten/[agent]/aufgaben` , `/[id]` — the run header; the `agent_schritt` chain on the detail page additionally requires `agent.protokoll_lesen` | `agent.lesen` (+ `agent.protokoll_lesen` for the step chain) | `M1` | AGT-01, AGT-04 | 8 |
| `/portal/[mandant]/agenten/[agent]/protokoll` — per step: tool, input, output, model, tokens, cost, duration | `agent.protokoll_lesen` | `M1` | AGT-04, SEC-A9 | 8 |
| `/portal/[mandant]/agenten/[agent]/start` — start a run | `agent.aufgabe_starten` | `M1` | AGT-01 | 8 |
| `/portal/[mandant]/agenten/richtlinien` , `/[id]` — the policy gate, editable without code | `agent.richtlinie_verwalten` | `M1` | AGT-03, APR-01 | 8 |
| `/portal/[mandant]/agenten/budget` — monthly cap, consumption, reservation state, hard stop | `agent.budget_verwalten` | `M1` | AGT-05 | 8 |
| `/portal/[mandant]/agenten/wissen` — `pgvector` index sources and freshness | `agent.werkzeug_verbinden` | `M1` | AGT-06 | 8 |
| `/portal/[mandant]/agenten/assistent` — the CEO Assistant, over this entity's live data | `agent.lesen` + `agent.aufgabe_starten` | `M1` | AGT-07, DSH-01 | 8 |

**A step payload is not the run header, and the two carry different rights.** `agent.lesen`
opens the Agent Center and shows *that* a run happened, with its status, duration and cost;
reading a step's tool input and output requires **`agent.protokoll_lesen`**, because those
payloads carry verbatim customer and employee document text pulled in by `lies_dokument` and
the RAG retrieval (LEG-09, K-05 in spirit). It is the same right
`app.agent_nutzlast_lesen` re-checks server-side
(`02-datenmodell/06-RADAR-KI-INHALT.md` §1.3, §3.9; `06-AGENTEN-FREIGABEN.md` §12), so
gating the screen on `agent.lesen` alone would have rendered a page the payload reader then
refuses row by row — a blank protocol with no explanation. An earlier draft of this map did
exactly that on both routes.

`[agent]` resolves to exactly four slugs: `ceo-assistent`, `akquise`, `backoffice`,
`finanzen` (D-03). The budget page shows a **hard stop**, never degraded service (AGT-05).
The assistant answers from the schema or says plainly that it cannot — an invented figure is
a defect, not a hallucination to be tolerated (AGT-07, invariant 6).

**The assistant always runs in exactly one mandant**, and that mandant's budget pays. It is
listed here and not under `/portal/gruppe` because starting a run writes `agent_aufgabe` and
`agent_schritt` rows, which are tenant rows, and **no write policy exists in any multi-tenant scope**
(K-03): a group-scope assistant would either fail at the database or need a write path that
invariant 10 forbids. Where the caller also holds `gruppe.*.lesen`, the assistant's retrieval
tools may read the group aggregates, so the group question is answerable without a group
writer. `/portal/gruppe/assistent` therefore does not exist; the group view links to the
assistant of the entity the user picks (§6).

**Cost accounting uses the one sub-cent carve-out K-16 grants, and nothing wider.** A single
model call costs a fraction of a cent, so rounding each step to whole cents would leave the
monthly accumulator at €0,00 while real money is spent and the AGT-05 hard stop never fires —
the first signal being the provider invoice. **K-16(b)** permits `*_mikrocent bigint`
(10⁻⁶ €) **only** in agent cost and budget accounting — `agent_schritt`, `agent_budget` and
their carry columns — and requires conversion to cents **once**, at the budget boundary,
half-up, with the rounding rule stated at the conversion site. This map follows that spelling
verbatim: `agent_schritt.kosten_mikrocent`, `agent_kosten.kosten_mikrocent`,
`agent_reservierung.betrag_mikrocent`, `agent_budget.verbrauch_mikrocent` and
`.reserviert_mikrocent`. An earlier draft of this map proposed a `kosten_cent` +
`kosten_rest` carry pair to stay nominally in cents; K-16 has since been amended and the
convention's own spelling wins, so the pair is withdrawn here exactly as
`02-datenmodell/06-RADAR-KI-INHALT.md` §1.12 withdraws it.

**The boundary is cents, and it is the only place a figure leaves this domain.**
`agent_budget.budget_cent` is `bigint` cents — the cap a human enters in euros — and the
AGT-05 comparison is exact integer arithmetic against `budget_cent × 10 000`. **The cap
column is `budget_cent`, not `monatslimit_cent`, and there is no stored `verbrauch_cent`**
(K-21): the consumption figure this screen renders is **computed** at the conversion site
from `verbrauch_mikrocent`, half-up, and a wire field named otherwise must state the
column/field pair the way `stundensatz_intern` / `stundensatz_intern_cent` does. SPEC §17's
€20,000 autonomy threshold is stored as `2000000` cents, never as a decimal and never as
micro-cents. **Nothing invoiced, booked or exported is ever micro-cents**: no figure reaching
`rechnung`, `buchungssatz` or a DATEV export passes through these columns, and the budget
screen renders the converted cent figure with the half-up rule named beside it. The provider
bills in USD, so `betrag_original` and `waehrung_original` are stored alongside, and the
conversion rule is not invented here.

```ts
// TODO(client): O-48 — which FX source and which date convert the provider's USD billing
// into the EUR budget of AGT-05, and who owns that rate? Until answered the budget screen
// shows the original amount and its currency next to the converted figure and marks the
// conversion `ist_platzhalter`; the hard stop evaluates against the placeholder rate and
// says so, rather than silently under-counting.
// TODO(client): O-10 — which social and job-board accounts exist and who owns the
// credentials? Nothing is connected until an owner is named.
```

### 5.20 Freigaben — the approval inbox (APR-01…APR-08, invariant 7, K-13)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/freigaben` — one inbox, sorted by deadline and risk | `freigabe.lesen` | `M1` | APR-01, APR-04 | 8 |
| `/portal/[mandant]/freigaben/[id]` — **diff review** with source attribution and confidence flags | `freigabe.entscheiden` + the underlying act's right (§1.4) | `M1` | APR-02, APR-03, APR-07 | 8 |
| `/portal/[mandant]/freigaben/stapel` — batch-approve routine items; flagged items excluded | `freigabe.stapel_entscheiden` | `M1` | APR-04 | 8 |
| `/portal/[mandant]/freigaben/laufend` — actions inside their objection window, with a countdown | `freigabe.lesen` | `M1` | APR-05 | 8 |
| `/portal/[mandant]/freigaben/[id]/einspruch` — object before release | `freigabe.einspruch_erheben` | `M1` | APR-05 | 8 |
| `/portal/[mandant]/freigaben/[id]/rueckgaengig` — undo within the window | `freigabe.rueckgaengig` | `M1` | APR-06 | 8 |
| `/portal/[mandant]/freigaben/erledigt` — history with immutable approval snapshots | `freigabe.lesen` | `M1` | APR-07, SEC-A9, LEG-01 | 8 |
| `/portal/[mandant]/freigaben/pruefdauer` — review-duration distribution, rubber-stamping flags | `freigabe.pruefdauer_lesen` | `M1` | APR-08 | 8 |

Everything that leaves the system converges here: external e-mails, offers, social posts, job
advertisements, dunning proposals, DATEV bookings, OCR extractions (invariant 7, SOC-08,
ACC-05, FIN-15, REC-02). The detail view shows what changed — *„Wie letzten Monat, zusätzlich
+12 Nachtstunden Kurfürstendamm → +456,00 €"* (APR-02) — with every extracted value carrying
its page and table source and a confidence flag (APR-03). Flagged items cannot be
batch-approved (APR-04). No configuration of `agent_richtlinie` can make an offer send
itself, at any value: „send an offer automatically" is not a configurable value in the SPEC
§17 autonomy matrix, and `agent.autonomie_setzen` is bounded by it.

**An approval is never granted by an agent or a job** — `requireMensch(ctx)` on every decide
route (APR-07). **APR-08 is measured server-side** (K-13): opening
`/portal/[mandant]/freigaben/[id]` writes a `freigabe_ansicht` row with
`geoeffnet_am_server`, the decision computes `pruefdauer_sek` from that row, and the decision
is **refused when no view row exists**. `geoeffnet_am` never appears in a request body: a
rubber-stamping detector that trusts a client timestamp is defeated by exactly the actor it
targets, and then reports a fabricated distribution under a signed audit trail.

The approval chain hashes only `freigabe_snapshot`, which is immutable, with `kette_nr`
assigned under `SELECT … FOR UPDATE` on a per-mandant chain head — the same construction as
FIN-03 and for the same reason: without a serialised total order two concurrent approvers
fork the chain and the nightly verification reports a break every busy day.

`/portal/[mandant]/freigaben/pruefdauer` is blocked on the §87 BetrVG question (O-06): a
per-person review-duration distribution is performance monitoring.

### 5.21 Social Media Center and website content (SOC-01…SOC-08, PUB-07, PRO-01…PRO-05)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/social` — schedule overview, channel status | `social.lesen` | `M1` | SOC-01, SOC-03 | 9 |
| `/portal/[mandant]/social/posts` — Entwurf · In Prüfung · Freigegeben · Geplant · Veröffentlicht | `social.lesen` | `M1` | SOC-02, SOC-03 | 9 |
| `/portal/[mandant]/social/posts/neu` — composer; pulls from real projects and released references | `social.lesen` + `social.schreiben` | `M1` | SOC-02, SOC-04, PRO-04, PRO-05 | 9 |
| `/portal/[mandant]/social/posts/[id]` — editor and approval state | `social.lesen` / `social.freigeben` | `M1` | SOC-03, SOC-08, APR-01 | 9 |
| `/portal/[mandant]/social/posts/[id]/planung` — schedule a released post | `social.lesen` + `social.planen` | `M1` | SOC-03 | 9 |
| `/portal/[mandant]/social/kanaele` — Instagram · Facebook · LinkedIn · TikTok · YouTube behind `SocialChannel` | `social.lesen` + `social.kanal_verbinden` | `M1` | SOC-06, SOC-07 | 9 |
| `/portal/[mandant]/social/statistik` — `kanal_statistik` | `social.lesen` | `M1` | SOC-01 | 9 |
| `/portal/[mandant]/website/profil` — logo, cover, description of this area's public profile | `referenz.schreiben` + `system.identitaet_verwalten` | `M1` | PRO-01, PRO-02, TEN-07 | 2 |
| `/portal/[mandant]/website/seiten` , `/[id]` | `referenz.schreiben` | `M1` | PUB-07, PUB-08 | 2 |
| `/portal/[mandant]/website/leistungen` , `/[id]` | `referenz.schreiben` | `M1` | PRO-02, PUB-07, OPS-06 | 2 |
| `/portal/[mandant]/website/referenzen` , `/[id]` — created from an `auftrag` whose customer release is on file | `referenz.schreiben` | `M1` | PRO-05 | 2 |
| `/portal/[mandant]/website/referenzen/[id]/veroeffentlichen` | `referenz.veroeffentlichen` | `M1` | PRO-05, PUB-07 | 2 |
| `/portal/[mandant]/website/news` , `/[id]` | `referenz.schreiben` | `M1` | PRO-02, SOC-05 | 2 |
| `/portal/[mandant]/website/galerie` | `referenz.schreiben` | `M1` | PRO-02, PUB-04 | 2 |
| `/portal/[mandant]/website/formulare` , `/[id]` — `formular_definition` per area | `formular.schreiben` | `M1` | REQ-01, REQ-02, REQ-03, REQ-04 | 2 |

Publishing to the CSE profile pages works immediately (SOC-05). External channels sit behind
the `SocialChannel` interface; an unconnected channel shows **„nicht verbunden"** and its
publish control is disabled with that reason — never a simulated success (SOC-07). Nothing
publishes externally without human approval, and the approval passes
`server/agent/policy.ts` (SOC-08, invariant 7).

Group-level public pages — `/`, `/unternehmen`, `/ueber-uns`, `/kontakt`, `/impressum`,
`/datenschutz`, `/barrierefreiheit`, `/leistungen`, `/projekte` and the group `/news` — are
edited in the **`operations`** mandant, which owns them; area profiles and their sub-tabs are
edited in their own mandant. Two editors never own one page.

```ts
// TODO(client): O-49 — confirm that CSE Operations owns the group-level public pages
// (Impressum, Datenschutz, home, Über uns). If a different entity owns them, `seite.mandant_id`
// changes and nothing else does.
```

### 5.22 Recruiting (REC-01…REC-09, LEG-11, LEG-12)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/recruiting` — overview | `recruiting.bewerbung_lesen` | `M1` | REC-01 | 9 |
| `/portal/[mandant]/recruiting/bedarf` — requirement derived from unstaffed shifts and pipeline | `recruiting.bewerbung_lesen` + `dienstplan.lesen` | `M1` | REC-01, TIM-05 | 9 |
| `/portal/[mandant]/recruiting/stellen` , `/[id]` | `recruiting.stelle_lesen` | `M1` | REC-02 | 9 |
| `/portal/[mandant]/recruiting/stellen/neu` — the AI drafts, a human edits and approves | `recruiting.stelle_lesen` + `recruiting.stelle_schreiben` | `M1` | REC-02, APR-01, invariant 7 | 9 |
| `/portal/[mandant]/recruiting/stellen/[id]/veroeffentlichung` — channels; „nicht verbunden" where no API exists | `recruiting.stelle_lesen` + `recruiting.stelle_veroeffentlichen` | `M1` | REC-09, D-02 | 9 |
| `/portal/[mandant]/recruiting/bewerbungen` , `/[id]` | `recruiting.bewerbung_lesen` | `M1` | REC-03, REC-04 | 9 |
| `/portal/[mandant]/recruiting/kandidaten` , `/[id]` — the parsed CV record | `recruiting.bewerbung_lesen` | `M1` | REC-04, REC-05 | 9 |
| `/portal/[mandant]/recruiting/kandidaten/[id]/bewertung` — ranked match with **visible criteria** | `recruiting.bewerbung_bewerten` | `M1` | REC-05, REC-08, LEG-12 | 9 |
| `/portal/[mandant]/recruiting/kandidaten/[id]/entscheidung` — the hiring decision, by a human | `recruiting.entscheiden` | `M1` | REC-08, LEG-12 | 9 |
| `/portal/[mandant]/recruiting/gespraeche` , `/[id]` — scheduling and question preparation | `recruiting.bewerbung_lesen` + `kalender.schreiben` | `M1` | REC-06, CAL-01 | 9 |
| `/portal/[mandant]/recruiting/datenschutz` — retention clock and purge log | `recruiting.daten_loeschen` | `M1` | REC-07, LEG-11 | 9 |

Ranking is a suggestion with stated reasons; there is **no auto-reject control anywhere in
this module** (REC-08, LEG-12, DSGVO Art. 22), and `recruiting.entscheiden` requires
`requireMensch`. Intake is inbound only — the career form (§2.1) and a monitored mailbox
(REC-03). No route in this module reads a job board (D-02). The applicant retention period is
part of O-46 and the purge log shows what the clock is set to and why.

### 5.23 Berichte (REP-01…REP-07)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/berichte` — index | `bericht.lesen` | `M1` | REP-01…REP-06 | 9 |
| `/portal/[mandant]/berichte/umsatz` | `bericht.lesen` + `finanzen.lesen` | `M1` | REP-01, FIN-17, ACC-08 | 9 |
| `/portal/[mandant]/berichte/auftraege` — orders, leads, conversion rate | `bericht.lesen` | `M1` | REP-02, CRM-05 | 9 |
| `/portal/[mandant]/berichte/attribution` — channel to signed order | `bericht.lesen` | `M1` | REP-03, REQ-07, CRM-07 | 9 |
| `/portal/[mandant]/berichte/mitarbeiter` — hours, utilisation, overtime | `bericht.lesen` + `zeit.konto_lesen` | `M1` | REP-04, EMP-04, TIM-13 | 9 |
| `/portal/[mandant]/berichte/projekte` — status, margin, deadline adherence | `bericht.lesen` + `kalkulation.lesen` | `M1` | REP-05 | 9 |
| `/portal/[mandant]/berichte/pipeline` — found · screened · bid · won | `bericht.lesen` + `radar.lesen` | `M1` | REP-06, RAD-07 | 9 |

Every report exports to CSV and PDF from the report page itself (REP-07), gated on
`bericht.exportieren`. A margin figure requires `kalkulation.lesen`, so a report cannot be
the back door into the cost base that the module ceiling closes elsewhere.

### 5.24 Einstellungen (TEN-*, AUT-03, FIN-*, AGT-03, LEG-*)

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/einstellungen` — index | `system.mandant_lesen` | `M1` | AUT-03 | 1 |
| `/portal/[mandant]/einstellungen/mandant` — name, legal form, address, register court, HRB, Geschäftsführer, tax number, bank details, invoice footer | `system.mandant_lesen` / `system.mandant_verwalten` | `M1` | TEN-01, TEN-02, DESIGN §11 | 1 |
| `/portal/[mandant]/einstellungen/identitaet` — logo, identity hue, cover | `system.identitaet_verwalten` | `M1` | TEN-07, D-10, D-11 | 1 |
| `/portal/[mandant]/einstellungen/benutzer` , `/[id]` — users of this mandant, invitations, session list, 2FA state | `system.benutzer_lesen` / `system.benutzer_verwalten` | `M1` | AUT-01, AUT-02, AUT-08 | 1 |
| `/portal/[mandant]/einstellungen/rollen` , `/[rolle]` — the permission matrix, editable per mandant | `system.rolle_lesen` / `system.rolle_verwalten` (**write requires `aal2`**, K-15) | `M1` | AUT-03, AUT-05 | 1 |
| `/portal/[mandant]/einstellungen/module` — which modules an admin holds in this mandant | `system.module_zuweisen` (**`aal2`**) | `M1` | AUT-01, AUT-03, TEN-08 | 1 |
| `/portal/[mandant]/einstellungen/steuer` — tax-rate groups and this entity's own tax identity (§5.3) | `buchhaltung_konfiguration.verwalten` | `M1` | LEG-05, FIN-09 | 6 |
| `/portal/[mandant]/einstellungen/abrechnungsarten` — the five billing types and their parameters | `abrechnung.schreiben` | `M1` | FIN-01, O-04 | 6 |
| `/portal/[mandant]/einstellungen/mahnwesen` — escalation levels, day offsets, fee per level, interest basis | `mahnung.schreiben` | `M1` | FIN-15 | 6 |
| `/portal/[mandant]/einstellungen/arbeitszeit` — Arbeitszeitmodelle: Wochenstunden, Sollzeit, carry-forward; and any **stricter** collective break agreement | `stammdaten.verwalten` | `M1` | EMP-04, TIM-06 | 5 |
| `/portal/[mandant]/einstellungen/agent-richtlinien` | `agent.richtlinie_verwalten` | `M1` | AGT-03, APR-01 | 8 |
| `/portal/[mandant]/einstellungen/vorlagen` — offer PDF, Behinderungsanzeige, dunning and e-mail templates | `system.einstellung_verwalten` | `M1` | OPS-08, BAU-06, FIN-15 | 4 |
| `/portal/[mandant]/einstellungen/integrationen` — DATEV · social · job boards · DWD · SMS · e-mail · map · radar sources, each **verbunden / nicht verbunden** | `system.einstellung_lesen` / `system.einstellung_verwalten` | `M1` | ACC-02, SOC-06, SOC-07, REC-09, BAU-08, RAD-01, RAD-02, EMP-01 | **2** |
| `/portal/[mandant]/einstellungen/betrieb` — the operations view: every scheduled run against its protocol — **failed**, **hanging**, **absent**, never run — plus whether a trigger is installed at all | `system.betrieb_lesen` | `M1` | SPEC §14, D-540 | 10 |
| `/portal/[mandant]/einstellungen/dpa` — the processor register: service, purpose, region, DPA date | `system.einstellung_lesen` | `M1` | LEG-09, D-04 | 7 |
| `/portal/[mandant]/einstellungen/protokoll` — the audit log: actor (human · agent · system), action, before, after, instant, IP | `system.audit_lesen` | `M1` | SEC-A9, AUT-08, TEN-09, LEG-01 | 1 |
| `/portal/[mandant]/einstellungen/protokoll/export` — evidence bundle | `system.audit_exportieren` | `M1` | SEC-A9, DOC-08, LEG-01 | 7 |
| `/portal/[mandant]/einstellungen/import` — migration from Aplano, Lexware, Excel | `system.einstellung_verwalten` | `M1` | ROADMAP Phase 10 | 10 |

`/einstellungen/integrationen` ships in **Phase 2**, not Phase 7: its earliest consumers are
the Phase 2 e-mail sender and the Phase 3 SMS gateway, and a screen that lists a connection
state is the mechanism by which "no fake integrations" is visible rather than asserted. Each
row shows the adapter, whether an adapter is registered at all, the EU region and the DPA
date; an unregistered adapter renders „nicht verbunden" and the dependent controls are
disabled with that reason.

**The ArbZG limits are not settings.** The statutory maxima — 8h with the 10h exception, the
11h rest period, the 30/45-minute breaks — are identical for all four entities and live as
constants in the checking service. Exposing them as per-mandant configuration would invent
the rule that they are negotiable and would let a tenant weaken the LEG-03/TIM-06 checks from
the UI. The screen configures only the Arbeitszeitmodell and any collective agreement that is
**stricter** than the statute; a value weaker than the statute is refused by the service.

```ts
// TODO(client): O-50 — does a collective agreement (Gebäudereiniger, Bau, Sicherheit) impose
// break or rest rules stricter than the ArbZG for any of the three trades, and from which
// date? Until answered only the statutory rules are applied and the tariff fields stay
// `ist_platzhalter` (K-17).
// TODO(client): O-44 — dunning levels, offsets, fees and interest basis, as in §5.14.2.
// `/einstellungen/mahnwesen` renders the placeholder rows with the DESIGN §5 `warning` pill
// and a dunning run refuses to send while `mahnstufe.ist_platzhalter` is true.
```

The audit log itself is part of the 10-year GoBD record. It is append-only, has no delete
control on any screen, and its retention is the auth document's **O-92**
(`auth-aufbewahrung-telemetrie` — renumbered there from a draft O-32 that collided with four
sibling documents); the export route produces a signed evidence bundle rather than a CSV a
user could edit.

`/einstellungen/protokoll` reads `audit_log`, which is **the only tenant-adjacent table with
a nullable `mandant_id`** (K-16(d)): a failed login, a lockout and the *source* side of a
mandant switch precede or transcend tenancy, and forcing a tenant onto them would mean
inventing one. The table carries `ebene enum('plattform','mandant')` with
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, so a NULL is a stated
platform-level fact and not a missing value. **This screen shows `ebene = 'mandant'` rows for
the active mandant only**; platform rows are readable by `super_admin` alone, and the
`ebene` column is rendered so the two are never silently mixed in an evidence bundle.

### 5.25 Datenschutz — the internal side of LEG-09

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/[mandant]/datenschutz` — data-subject request inbox with the Art. 12(3) one-month clock | `datenschutz.auskunft_erstellen` | `M1` | LEG-09 | 7 |
| `/portal/[mandant]/datenschutz/[id]` — the request, its subject match and its deadline | `datenschutz.auskunft_erstellen` | `M1` | LEG-09 | 7 |
| `/portal/[mandant]/datenschutz/[id]/auskunft` — assemble the Art. 15 export for a person, an applicant or a customer contact | `datenschutz.auskunft_erstellen` | `M1` | LEG-09 | 7 |
| `/portal/[mandant]/datenschutz/[id]/berichtigung` — Art. 16 | `datenschutz.berichtigung_bearbeiten` | `M1` | LEG-09 | 7 |
| `/portal/[mandant]/datenschutz/[id]/loeschung` — Art. 17 **against** the retention holds; produces a decision record, never a delete | `datenschutz.loeschung_pruefen` | `M1` | LEG-09, LEG-01, LEG-02 | 7 |
| `/portal/[mandant]/datenschutz/verarbeitungsverzeichnis` — the Art. 30 register | `system.einstellung_lesen` | `M1` | LEG-09 | 7 |
| `/portal/[mandant]/datenschutz/loeschkonzept` — the deletion concept, derived from the retention rules, the purge jobs and the `KEIN_HARD_DELETE` register: what is erased, when, by which run — and what is **not**, with its reason | `system.einstellung_lesen` | `M1` | LEG-09, LEG-01, LEG-02 | 10 |
| `/portal/[mandant]/datenschutz/widersprueche` — the Werbewiderspruch log of §2.4 | `crm.rechtsgrundlage_lesen` | `M1` | CRM-08, LEG-08 | 4 |

The Art. 30 register is a different document with a different legal basis from ACC-10's GoBD
Verfahrensdokumentation, and it is generated from live configuration in the same way: the
processor list of `/einstellungen/dpa`, the retention classes of `/dokumente/aufbewahrung`
and the purpose per module. `datenschutz.loeschung_pruefen` **does not delete**: it produces
a decision record naming, per field and per table, whether erasure is owed or overridden by
a retention obligation (§17 MiLoG two years, §147 AO ten years, audit immutability, the
invoice hash chain). Execution is anonymisation plus tombstoning, and the hours themselves
survive because the law requires them to exist.

---

## 6. `/portal/gruppe` — the group view, read-only (TEN-05, TEN-10)

Every route in §6 is `GRP`, and invariant 10 is enforced **four times, in decreasing trust**:

1. **Postgres.** Per K-03 and K-18 the group, person and customer policies are `for select`
   only and have no write counterpart anywhere in the schema, and `app.aktiver_mandant()` is
   NULL in all three, so every `t_mandant` `WITH CHECK` is false there. A write under
   `app.scope = 'gruppe'` — or under `person` or `kunde` — matches no policy and is refused
   by the database even with the service guard disabled.
2. **The transaction.** `withGroupScope` opens `set transaction read only` and sets
   `app.readonly = 'on'`, which the K-03 `with check` clause also tests.
3. **The type.** `withGroupScope` yields a read-only context; `MehrmandantKontext` is not
   assignable to any mutating service signature, so a group write does not compile.
4. **The file tree.** `tests/invariants/gruppe-ohne-actions.test.ts` asserts that the glob
   `src/app/portal/gruppe/**/_actions.ts` matches nothing.

Entering the group view requires `gruppe.<modul>.lesen` **in each mandant** whose rows are
read (K-03), and `sichtbareMandanten` is derived server-side from `benutzer_mandant`, never
from the request. The rights are ordinary per-mandant bindings, so they are granted in the
same editor as everything else — `/portal/[mandant]/einstellungen/rollen` — which is the
answer to "who can ever grant `gruppe.lesen`". The first `super_admin` is seeded by the
Phase 1 migration and carries the **global role** (`benutzer.globale_rolle_id`), so it needs
no membership rows and reaches a fifth area the day the row is inserted (TEN-08).

**`app.portal` is `intern` here, bound when the scope is entered (K-20).** It is not derived
from the active membership, because in group scope there is none: `app.mandant_id` is NULL,
and an accessor that recomputed the portal from it would fall through to the fail-closed
`mitarbeiter` and fire **every** K-04 employee ceiling on this page family — a `leitung`
would open `/portal/gruppe/personen` and see only her own employment rows, and
`/portal/gruppe/finanzen` would come back empty, both without an error and both looking like
"the group has no data". The same binding makes the customer ceiling inapplicable here, and
the `NUR LESEN` guarantee comes from the absence of a write policy (1 above), never from the
portal value.

The chrome states the scope rather than relying on the user remembering it: the `NUR LESEN`
pill in the header and on the switcher's group entry (TEN-10, DESIGN §6 rule 3), a **neutral**
`--border-strong` top bar because no area is active, and **no primary buttons, no forms, no
inline edit anywhere**. Controls are *absent*, not disabled — a disabled button still tells a
user the action exists here, and it does not.

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/gruppe` — group dashboard, all areas or one via filter | `gruppe.bericht.lesen` | `GRP` | TEN-05, DSH-01, DSH-02, DSH-04 | 1 |
| `/portal/gruppe/finanzen` — revenue, expenses, profit per area and group | `gruppe.finanzen.lesen` | `GRP` | FIN-17, REP-01, ACC-08 | 6 |
| `/portal/gruppe/rechnungen` — invoices across entities, each in its own number circle | `gruppe.finanzen.lesen` | `GRP` | TEN-02, FIN-16 | 6 |
| `/portal/gruppe/offene-posten` — debtors and creditors across entities | `gruppe.buchhaltung.lesen` | `GRP` | ACC-07 | 7 |
| `/portal/gruppe/kunden` — customer history across all four areas (CRM-06) | `gruppe.crm.lesen` | `GRP` | CRM-06, CRM-01 | 4 |
| `/portal/gruppe/leads` — pipeline across areas | `gruppe.crm.lesen` | `GRP` | CRM-01, REP-02 | 4 |
| `/portal/gruppe/auftraege` — orders across areas | `gruppe.auftrag.lesen` | `GRP` | OPS-05, DSH-01 | 4 |
| `/portal/gruppe/projekte` — projects across areas | `gruppe.bau.lesen` | `GRP` | OPS-05, REP-05 | 4 |
| `/portal/gruppe/objekte` — objects across areas, one map | `gruppe.objekt.lesen` | `GRP` | OPS-01 | 4 |
| `/portal/gruppe/personen` — people and their employments per entity; certificate expiry; **identity only** | `gruppe.personal.lesen` | `GRP` | D-09, EMP-14, SEC-02, SEC-03, LEG-04 | 3 |
| `/portal/gruppe/dienstplan` — the combined roster, read-only; cross-entity ArbZG findings in one place | `gruppe.dienstplan.lesen` | `GRP` | TIM-01, TIM-04, TIM-14, LEG-03 | 5 |
| `/portal/gruppe/auslastung` — hours, utilisation and overtime aggregated per person across entities | `gruppe.zeit.lesen` | `GRP` | REP-04, EMP-15, TIM-14 | 5 |
| `/portal/gruppe/radar` — tender pipeline across areas | `gruppe.radar.lesen` | `GRP` | RAD-07, REP-06 | 8 |
| `/portal/gruppe/dokumente` — cross-entity search; downloads still mint scoped signed URLs | `gruppe.dokument.lesen` | `GRP` | DOC-02, DOC-03, DOC-04 | 4 |
| `/portal/gruppe/kalender` — combined calendar, filter by area, team, person | `gruppe.kalender.lesen` | `GRP` | CAL-01, CAL-02 | 9 |
| `/portal/gruppe/freigaben` — pending approvals across areas; each item deep-links into its owning mandant to be acted on | `gruppe.freigabe.lesen` | `GRP` | APR-01, invariant 10 | 8 |
| `/portal/gruppe/agenten` — agent activity, token cost and budget consumption across areas | `gruppe.agent.lesen` | `GRP` | AGT-04, AGT-05 | 8 |
| `/portal/gruppe/berichte` — index | `gruppe.bericht.lesen` | `GRP` | REP-01…REP-07 | 9 |
| `/portal/gruppe/berichte/umsatz` | `gruppe.bericht.lesen` + `gruppe.finanzen.lesen` | `GRP` | REP-01 | 9 |
| `/portal/gruppe/berichte/auftraege` | `gruppe.bericht.lesen` | `GRP` | REP-02 | 9 |
| `/portal/gruppe/berichte/attribution` | `gruppe.bericht.lesen` | `GRP` | REP-03 | 9 |
| `/portal/gruppe/berichte/mitarbeiter` | `gruppe.bericht.lesen` + `gruppe.zeit.lesen` | `GRP` | REP-04 | 9 |
| `/portal/gruppe/berichte/projekte` | `gruppe.bericht.lesen` | `GRP` | REP-05 | 9 |
| `/portal/gruppe/berichte/pipeline` | `gruppe.bericht.lesen` + `gruppe.radar.lesen` | `GRP` | REP-06 | 9 |
| `/portal/gruppe/protokoll` — the audit log across entities | `gruppe.system.audit_lesen` | `GRP` | SEC-A9, AUT-08, TEN-09 | 1 |

**The cross-entity audit log is gated on `gruppe.system.audit_lesen`, not on
`gruppe.system.lesen`.** An earlier draft of this map wrote the latter, and it is a key that
exists nowhere: `02-datenmodell/01-KERN.md` §6.11 resolves the visible entities for this page
with `app.rechte_mandanten('gruppe.system.audit_lesen')`, and reading one entity's audit rows
from inside another entity is precisely what K-03 forbids a plain tenant right
(`system.audit_lesen`) from doing. Since `app.hat_recht()` returns **false** for an
unregistered key (K-19), the wrong spelling would not have raised — it would have rendered a
permanently empty audit log to a `super_admin`, which is the one screen whose emptiness is
indistinguishable from "nothing happened".

**Wage data is unreachable from here, and not because a page declines to render it.** D-09 §6
— a cleaning manager must not see security wage rates — is enforced with **column-level
`GRANT`** (K-05): `stundensatz_intern` and `tarifgruppe` are not granted to `cse_app` at
all, so no `select *`, no CSV export, no future report and no accidental service query can
return them. The rate is reachable only through `app.entgelt_lesen(p_anstellung)`, which
re-checks `personal.entgelt_lesen` **and** the active mandant and writes `audit_log` — and
which is unreachable in group scope because there is no active mandant. `/portal/gruppe/personen`
and `/portal/gruppe/auslastung` therefore read identity, employment existence, certificate
expiry and durations, and nothing costed.

A masking view was considered and is **forbidden** for this purpose (K-05): `select a.*, case …
end as rate_masked` hands out the raw column and adds a masked copy beside it, and the two
ways to make a view work are both wrong — with `security_invoker = true` the caller needs
base-table privileges that were just revoked, and without it the view runs as its owner and,
if that owner can bypass RLS, returns every tenant's rows with the tenant predicate silently
ignored.

**There is no `/portal/gruppe/einstellungen` and no `/portal/gruppe/assistent`.**
Configuration belongs to an entity — number circles, tax defaults, roles, agent policies,
identity — and a group-level settings page would be a write path without exactly one active
mandant. An agent run writes rows, so it belongs to one mandant and one budget (§5.19); the
group view links to the entity's assistant instead of hosting one.

Drill-through from a group list opens the record **in its owning mandant, still in read-only
group scope**. Acting on it requires an explicit, audited switch into that mandant via the
interstitial (TEN-09). That extra click is the feature: it is the moment the user confirms
which GmbH they are acting in.

---

## 7. `/portal/mein` — the worker portal (SPEC §10)

Reads are `PER`: **`withPersonScope`**, `app.scope = 'person'`, across every `anstellung` of
the signed-in `person`, each row labelled with its entity (EMP-14). Rows come from the
**`t_person`** policy of K-18 — `app.scope() = 'person'` and
`mandant_id = any (app.sichtbare_mandanten())` and the row belongs to
`app.aktuelle_person()` — with the restrictive K-04 ceiling narrowing on top to rows whose
`anstellung_id` belongs to that person. Writes are `PER→M1` through
`withAnstellung(anstellungId, …)`, resolved from the record per §1.3.1 — invariant 10 holds
and D-09 consequence 5 holds.

**Not `withGroupScope`, and the difference is not cosmetic** (K-18). An earlier draft of this
map routed these reads through group scope with a `grund = 'eigene_anstellungen'` label. The
only SELECT policy that can match in group scope is K-03's `t_gruppe`, which requires
`gruppe.<modul>.lesen` — a management right a cleaner will never hold — so every route in
this section would have returned **zero rows, silently**: a worker opening „Meine Schichten"
sees an empty week and concludes they are not scheduled. Widening the group right to make it
work would hand every cleaner a group-level read of the platform, which is worse than the
bug. `sichtbare_mandanten()` in this scope is derived server-side from the person's live
`anstellung` rows and never from the request (K-02). The `t_person` policy is also **not** a
second implementation of the K-04 ceiling: the ceiling is `restrictive` and says *at most
your own rows*, the policy is permissive and says *these rows, in these tenants*, and both
must pass.

**Almost nothing here is a permission.** Self-access — own hours, own certificates, own
Stundenkonto, acknowledging an instruction, raising an objection, reporting an absence — is a
**policy branch keyed on the server-set `app.person_id` GUC**, not a right
(`03-AUTH-BERECHTIGUNGEN.md` §7.5). A right is granted to a role and a role is held by many
people, so "only the subject may do this" cannot be expressed as a right without
`super_admin` acquiring it. The one write right a worker holds by default is
`zeit.abwesenheit_melden`.

Chrome: no sidebar, no mandant switcher — an operative does not switch tenants, they switch
*shifts*, and each shift carries its entity badge in that entity's identity hue — a bottom tab
bar at every breakpoint, tap targets ≥ 44×44px, body text never below 16px, and de / en / ar /
tr with `dir="rtl"` for Arabic (DESIGN §8, EMP-12).

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/mein` — Heute: current or next shift, hours today · week · month | `S` | `PER` | EMP-02, EMP-03, EMP-12, EMP-14 | 3 |
| `/portal/mein/schichten` — my assignments and schedule, each labelled with its entity | `S` | `PER` | EMP-02, EMP-14, TIM-01 | 3 |
| `/portal/mein/schichten/[zuordnungId]` — object, times, Dienstanweisung link, actions | `S` | `PER` | EMP-02, EMP-09 | 5 |
| `/portal/mein/schichten/[zuordnungId]/fotos` — capture; EXIF stripped, private bucket | `S` | `PER→M1` | TIM-10, DOC-03, DOC-06 | 5 |
| `/portal/mein/schichten/[zuordnungId]/wachbuch` — Streife · Vorfall · Übergabe · Schlüssel · Alarm | `S` (`wachbuch.schreiben` for others) | `PER→M1` | SEC-05, TIM-10 | 5 |
| `/portal/mein/schichten/[zuordnungId]/leistungsnachweis` — the customer signs on canvas | `nachweis.schreiben` (`S` branch: own assignment only) | `PER→M1` | CLN-04 | 5 |
| `/portal/mein/schichten/[zuordnungId]/bautagebuch` — Mannstunden, deliveries, incidents | `S` | `PER→M1` | BAU-07 | 5 |
| `/portal/mein/zeiten` — my time entries, **read-only** | `S` | `PER` | EMP-03, TIM-13, LEG-02 | 5 |
| `/portal/mein/zeiten/[id]` — server time shown, device deviation shown | `S` | `PER` | TIM-08, TIM-11 | 5 |
| `/portal/mein/zeiten/[id]/einwand` — raise a `zeit_einwand` | `S` | `PER→M1` | EMP-07 | 5 |
| `/portal/mein/stundenkonto` — one tab per employment: target versus actual, overtime, carry-forward, lock state | `S` | `PER` | EMP-04, EMP-15 | 5 |
| `/portal/mein/monatsnachweis` — the monthly hours statement as PDF, per employment | `S` | `PER` | EMP-06, TIM-13, LEG-02 | 5 |
| `/portal/mein/urlaub` — balance and used days, per employment | `S` | `PER` | EMP-05, EMP-15 | 5 |
| `/portal/mein/antraege` , `/[id]` — leave, swap and sickness requests with status | `S` | `PER` | EMP-10, NOT-03 | 5 |
| `/portal/mein/antraege/neu` — leave request or shift swap | `S` | `PER→M1` | EMP-10 | 5 |
| `/portal/mein/abwesenheit/neu` — sickness or absence report | `zeit.abwesenheit_melden` | `PER→M1` | EMP-10 | 5 |
| `/portal/mein/nachweise` — my certificates with personal expiry warnings | `S` | `PER` (person-level, D-09) | EMP-08, SEC-02, SEC-03 | 5 |
| `/portal/mein/dienstanweisungen` , `/[id]` — read and acknowledge from the phone | `S` | `PER` / `PER→M1` | EMP-09, SEC-06 | 5 |
| `/portal/mein/dokumente` , `/[id]` — documents relevant to me, via signed URLs | `S` | `PER` | EMP-11, DOC-03, DOC-04 | 3 |
| `/portal/mein/nachrichten` , `/[id]` | `S` | `PER` | EMP-11, NOT-03 | 3 |
| `/portal/mein/objekte` , `/[id]` — objects I work on: address, access notes, contact | `S` | `PER` | EMP-02, OPS-01 | 5 |

**EMP-13 is structural, not a promise.** The `mitarbeiter` role holds none of `crm`,
`angebot`, `kalkulation`, `auftrag`, `abrechnung`, `finanzen`, `personal`; the K-04
restrictive ceiling makes anstellung-hung and person-hung rows of other people unreachable
even if a binding were mis-set; and `app.portal()` defaults to `mitarbeiter` when the GUC is
unset, so an unset session narrows the ceiling rather than lifting it. This route family has
no path that could render a group financial figure, another employee's data or a customer's
commercial terms — and SEC-A3 assertions 6, 15 and 17 prove it rather than asserting it.

**`/portal/mein/zeiten` has no edit control anywhere.** EMP-07: the employee never edits a
time record; they raise an objection that reaches the planner at
`/portal/[mandant]/zeiten/einwaende`. That is what preserves the record's evidentiary value
in a wage dispute or an audit — and it is why a manager can *decide* an objection but can
never *raise* one.

The account screens — language, notification channels, security — are **not duplicated here**.
They live once at `/portal/konto` (§9), rendered inside this shell and in this language when
the session's portal is `mitarbeiter`, so `person.sprache` has exactly one editor. The
bottom tab "Profil" points there.

```ts
// TODO(client): O-51 — must the monthly hours statement (EMP-06) be issued in the
// employee's language, or is German the required form for a §17 MiLoG record? The platform
// issues a German document with a translated cover line until answered.
// TODO(client): O-87 `auth-austritt-login` — on `austritt`, is the worker login disabled
// immediately, or kept for N days so the person can still download their Stundennachweise
// (EMP-06)?
```

---

## 8. `/portal/kunde` — the customer portal (AUT-01 `kunde`, DSH-03, CRM-06)

Reads are `KDN`: **`withKundeScope`**, `app.scope = 'kunde'`, over the mandanten in which the
login holds a live `kunde_zugang`, with the restrictive `portal() = 'kunde'` ceiling
narrowing every row to that customer's own `kunde_id` and, for documents, to
`sichtbar_fuer_kunde = true`. A customer buying from two entities sees both, each row labelled
with the supplying entity — which is what CRM-06 asks for — and **never a mandant switcher**:
switching tenancy is a staff act, and a switcher row would carry the live counters of DESIGN
§6 rule 2, which are the supplier's totals across *all* its customers. A customer learning
SSE Security's monthly order volume from a dropdown is a commercial leak shipped by a default
rendering.

#### The permissive policy that actually lets a customer read (K-18)

An earlier draft of this map ran every route below in `withGroupScope` while gating them on
the ordinary tenant module rights in the **Right** column. Those two statements cannot both
be satisfied. In group scope the only SELECT policy that can match is K-03's `t_gruppe`,
which requires `app.hat_recht('gruppe.<modul>.lesen', mandant_id)`; the seeded matrix of
`03-AUTH-BERECHTIGUNGEN.md` §12 grants `gruppe.*.lesen` to `super_admin`, `admin` and
`leitung` and never to `kunde`. The K-04 customer ceiling is `restrictive` and can only
narrow, and `02-datenmodell/02-CRM-OPERATIONS.md` §1.4 deliberately deleted the permissive
`sel_kundenportal` policy. **Every customer SELECT would therefore have matched no permissive
policy and returned zero rows** — the portal renders as an account with no orders, no
invoices and no documents, which reads to the customer as "nothing to show" rather than as an
error, and to the operator as a working deploy.

K-18 resolves it with a policy of the customer's own, keyed on **the subject** and never on a
group right:

```sql
create policy t_kunde on <tabelle>
  for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id   = any (app.aktuelle_kunden()));
```

Three consequences the rows below depend on. `app.aktuelle_kunden()` returns **`uuid[]`**,
not a scalar — a customer buying from two entities holds two `kunde` ids, and a scalar
accessor resolving through `app.aktiver_mandant()` is NULL in every multi-tenant scope, so it
would have reproduced the same empty portal from the other direction
(`02-datenmodell/02-CRM-OPERATIONS.md` §1.4, §17). `app.sichtbare_mandanten()` in this scope
is derived server-side from the login's live `kunde_zugang` rows — revoking access
(`entzogen_am`) drops the entity from the array in the same statement — and never from the
request (K-02). And the **Right** column below keeps its ordinary tenant module keys, which
the `kunde` role genuinely holds in the seeded matrix (`angebot.lesen`, `auftrag.lesen`,
`objekt.lesen`, `dokument.lesen`, `finanzen.lesen`, `zahlung.lesen`, `nachweis.lesen`,
`bau.lesen`, `qualitaet.lesen`, `nachricht.lesen`, `mahnung.lesen`, plus
`finanzen.herunterladen` for the downloads and `bericht.dashboard_lesen` for the overview):
they are the **service-layer** gate that decides whether a route renders at all, while row
visibility comes from `t_kunde` plus the ceiling. Both must pass, and neither is a `gruppe.*`
key. All thirteen are `✔` for `kunde` in the seeded matrix of
`03-AUTH-BERECHTIGUNGEN.md` §12.3/§12.5, not `○` — a customer portal whose every right is
bindable-but-unbound ships dead, because this map uses them as that gate on every
`/portal/kunde/**` route.

**The overview gate is `bericht.dashboard_lesen`, and for `kunde` it is a granted right, not
an `S` cell.** `03-AUTH-BERECHTIGUNGEN.md` §12.1 settles it that way for the reason this map
depends on: the key is the service-layer gate on `/portal/kunde`, and a gate on a key the
role does not hold is a portal that is dead at the door — a 403 on the first request rather
than a visible refusal. Granting it widens nothing, because the rows behind it are already
narrowed by the `t_kunde` subject predicate and the customer ceiling. `MA` keeps `S` on the
same key: `/portal/mein` gates on no right at all (§7).

The desktop chrome is its own: a top bar with the entity name and an entity filter, and a
compact left nav of exactly the eleven customer destinations listed below — **not** the 248px staff
sidebar, which for a principal holding only customer rights would render as an empty column
on every page.

**The customer portal has no write path today.** `KundeSchreibaktion` is `never` until O-74
is answered, so the routes below are read plus download; accepting an offer, reporting a
Reklamation, sending a message and uploading a document are listed as *blocked*, not as
shipped, and adding one is a deliberate, reviewable act rather than a type widening.

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/kunde` — overview | `bericht.dashboard_lesen` | `KDN` | AUT-01, DSH-03, DSH-04 | 3 |
| `/portal/kunde/auftraege` , `/[id]` | `auftrag.lesen` | `KDN` | OPS-05, OPS-11, CRM-06 | 3 |
| `/portal/kunde/projekte` , `/[id]` | `bau.lesen` | `KDN` | OPS-05, REP-05 | 3 |
| `/portal/kunde/angebote` , `/[id]` — released offers; **acceptance blocked on O-74** | `angebot.lesen` | `KDN` | OPS-08, OPS-09 | 4 |
| `/portal/kunde/rechnungen` , `/[id]` — **finalised invoices only** (O-91, answered conservatively); PDF, ZUGFeRD and XRechnung via signed URL | `finanzen.lesen` + `finanzen.herunterladen` | `KDN` | FIN-11, FIN-12, DOC-03 | 6 |
| `/portal/kunde/zahlungen` — payment status of their own invoices | `zahlung.lesen` | `KDN` | ACC-04, FIN-15 | 6 |
| `/portal/kunde/nachweise` — their signed Leistungsnachweise and countersigned Aufmaße | `nachweis.lesen` + `bau.lesen` | `KDN` | CLN-04, BAU-02, BAU-03 | 5 |
| `/portal/kunde/objekte` , `/[id]` — their objects, Raumbuch read-only | `objekt.lesen` | `KDN` | OPS-01, OPS-02 | 4 |
| `/portal/kunde/dokumente` , `/[id]` — only where `sichtbar_fuer_kunde = true` | `dokument.lesen` | `KDN` | DOC-01, DOC-03, DOC-04 | 4 |
| `/portal/kunde/nachrichten` , `/[id]` — read; **sending blocked on O-74** | `nachricht.lesen` | `KDN` | NOT-03, SPEC §22 `nachricht` | 3 |
| `/portal/kunde/reklamationen` , `/[id]` — read; **reporting blocked on O-74** | `qualitaet.lesen` | `KDN` | OPS-11, SPEC §22 `reklamation` | 5 |

What a customer never sees, structurally: drafts of anything, the `kalkulation` cost base and
margin, `stundensatz_intern`, the number circle or the Rechnungsausgangsbuch, another
customer's records (404, exactly like a cross-tenant record — SEC-A3 assertion 5), and the
whole `personal` module: no names, no schedules, no certificates. Wachbuch and Bautagebuch
entries are `—` pending O-78, because a Wachbuch names employees and third parties, which
makes it a question about employee data and §34a documentation rather than a UI toggle.

```ts
// TODO(client): O-74 `auth-kunde-schreibrechte` — may a customer perform write actions:
// accept an offer with legal effect (OPS-09), report a Reklamation, send a message, upload a
// document? Until answered the portal is read plus downloads, and the acceptance of an offer
// is recorded by staff at /portal/[mandant]/angebote/[id]/annahme from the customer's
// written confirmation.
// TODO(client): O-52 — does a company buying from two entities get one login with an entity
// filter, or one login per entity? The schema supports both (`kunde_zugang` is unique per
// (benutzer, mandant) where `entzogen_am IS NULL`, and `app.aktuelle_kunden()` returns an
// array either way); this map assumes one login with a filter.
// TODO(client): O-78 `auth-wachbuch-kundensicht` — may a Wachbuch or Bautagebuch entry ever
// be shown to a customer?
// TODO(client): O-89 `auth-nachweis-gegenzeichnung` — does the customer portal need a
// counter-signature flow for the Leistungsnachweis (CLN-04), or is the on-site canvas
// signature the only path?
// TODO(client): O-91 `auth-entwurf-kundensicht` — do customers see finalised invoices only,
// or may a draft ever be visible to them? This map answers it **conservatively and states
// the answer rather than assuming it**: no draft of anything is ever customer-visible, which
// is what FIN-02 and K-12 already force for an invoice (a draft has no number and is not yet
// a document in the §14 UStG sense) and what the `angebot` ceiling already does with
// `versendet_am IS NOT NULL`. Confirm, or name the exception.
```

---

## 9. `/portal/konto` — the account of the signed-in principal

Properties of the human and their login, not of any tenant, and therefore **one editor per
fact**. `konto` is the fourth static segment under `/portal` and is reserved in
`mandant.slug` accordingly (§1.6). The shell is inherited from whichever portal the session
is in, so a worker reaches these screens in the worker chrome and in their own language.

| Path | Right | Scope | SPEC | Phase |
|---|---|---|---|---|
| `/portal/konto/profil` — name, contact, **language de/en/ar/tr** | `Sitzung` (`S` branch on the caller's own `person`, column-granted) | `USR` | EMP-12 | 1 |
| `/portal/konto/sicherheit` — password, 2FA enrolment and re-enrolment, recovery codes, active sessions | `Sitzung` | `USR` | AUT-02, AUT-07, AUT-08 | 1 |
| `/portal/konto/benachrichtigungen` — per-channel preferences (in-app, e-mail) | `Sitzung` | `USR` | NOT-02 | 9 |
| `/portal/konto/kalender-feed` — the tokenised read-only iCal URL: show once, rotate, revoke | `Sitzung` | `USR` | CAL-03 | 9 |
| `/portal/konto/zugriffe` — which mandanten this account may enter and with which role | `Sitzung` | `USR` | TEN-06, AUT-01, AUT-03 | 1 |

`/portal/konto/sicherheit` renders only what the account's credential set supports: a worker
authenticating by phone OTP has no password and no recovery codes, so those sections are
absent rather than shown and broken. `/portal/konto/zugriffe` is deliberately **read-only** —
a user cannot grant themselves a mandant; membership changes happen at
`/portal/[mandant]/einstellungen/benutzer` by a holder of `system.benutzer_verwalten` in that
mandant, with `aal2` on the write path (K-15), and every change is audited. The row is `USR`
and the legend says what that means: it reads `benutzer_mandant`, which carries a
`mandant_id`. Claiming "no `mandant_id`-bearing table is touched" would have been a false
guarantee in the legend of a security-relevant table.

### 9.1 The iCal feed is the widest bearer surface in the product, and is bounded (CAL-03)

An iCal URL is polled by a calendar client every few minutes, cached on the device and synced
to whatever cloud account that client is signed into — outside any session. Four properties
make it safe enough to ship, and all four are stated rather than assumed:

- **The token is a secret, not a name.** `benutzer_feed_token` stores SHA-256 of a 256-bit
  value, the raw value is shown exactly once, one live token per `(benutzer, zweck)`,
  revocable without a hard delete, and every issue, use and revocation is audited. Each fetch
  stamps `letzte_nutzung_am`, so an abandoned feed is visible.
- **It is the fifth entry on K-08's closed register**, and an earlier draft of this map said
  the opposite. That draft resolved the token to a `benutzer` and then opened a
  `withGroupScope` transaction for that principal, which is wrong twice under the amended
  conventions. It is wrong under K-08, because resolving a bearer token against a table
  before any principal exists **is** a pre-session database path however it is dressed up,
  and K-08 now names it rather than leaving a domain document to sanction it. And it is wrong
  under K-18: a personal calendar feed is a **person**-scope read, while K-03's group policy
  demands `gruppe.kalender.lesen` — a management right the holder will not have — so the feed
  would have returned zero events for every worker it exists for.

  ```sql
  app.ical_feed_lesen(p_feed_token_hash text)
    returns table (uid text, beginn_utc timestamptz, ende_utc timestamptz,
                   titel text, ort text, geaendert_am timestamptz)
  -- SECURITY DEFINER, owner cse_definer, SET search_path = pg_catalog, public   (K-01, K-08)
  -- EXECUTE granted to cse_anon and to no other role.
  ```

- **The field set is the function's return type**, not "whatever the calendar query returns":
  `uid`, `beginn_utc`, `ende_utc`, `titel`, `ort`, `geaendert_am` and nothing else — **no
  `mandant_id`, no customer name, no commercial term, no money, no note, no conflict, no
  colleague** (EMP-13). Instants leave as UTC and the calendar client renders them in the
  subscriber's own zone, which is the one place `Europe/Berlin` display is not ours to
  impose; every screen in this map still renders Berlin (invariant 2).
- **It is read-only and switches nothing.** The register entry has no write path at all, no
  mandant switch, and no row the holder could not read interactively. A revoked token and an
  unknown hash return the same generic empty feed, so the URL is not an oracle, and
  `letzte_nutzung_am` is stamped in the same statement that validates the token.

Revoking the token in this screen invalidates the URL immediately;
`system.feed_token_widerrufen` lets an administrator revoke someone else's after a device
loss.

---

## 10. `/api` — the non-UI surfaces this map depends on

`05-API-KARTE.md` is a separate Phase 0 document and **owns these contracts, including the
exact paths and payloads**; the entries below name them by function because routes in §§2–9
are incomplete without them, and because each is a place where a page's guarantee is actually
enforced. Where a path here and there differ, the API map wins and this table follows it. Two
properties are settled and shared: the API namespace carries **no `[mandant]` segment at all**
(the active mandant comes from the session, K-02), and a server action is a public HTTP
endpoint with a generated name that runs the identical authorization preamble as a route
handler.

| Endpoint | Method | Caller | Purpose | SPEC |
|---|---|---|---|---|
| `/api/sitzung/mandant` | POST | staff session | the **only** writer of the active mandant; two mirror audit rows; redirects to `/portal/<slug>` | TEN-04, TEN-06, TEN-09 |
| `/api/check-in/[token]` | POST | `cse_checkin`, no session | the offline replay path of §4.3; executes `app.offline_ereignis_annehmen`, the fourth entry on K-08's register | TIM-09 |
| `/api/dokument/[id]/url` | POST | any authorised session | mints a 15-minute signed URL after the authorization decision | DOC-03, DOC-04, SEC-A6 |
| `/api/nachweis/monat/[anstellungId]/[monat]` | GET | worker (`PER`) | the EMP-06 monthly statement PDF; `[monat]` is a Berlin calendar month (K-11) | EMP-06, TIM-13 |
| `/api/kalender/feed/[token].ics` | GET | bearer token → `cse_anon` | the CAL-03 feed of §9.1; executes `app.ical_feed_lesen` (K-08 register) and opens **no session helper** | CAL-03 |
| `/api/export/csv`, `/api/export/pdf` | POST | any authorised session | REP-07 exports, gated on `bericht.exportieren` | REP-07 |
| `/api/formular/[bereich]`, `/api/bewerbung` | POST | public, rate-limited | REQ-01 and REC-03 intake through the public service principal | REQ-05, REC-03 |
| `/api/cron/[job]` | POST | Vercel cron, rotating shared secret | the SPEC §14 watchdogs; `withSystemTenant` per mandant, audited as `job:<name>` | SPEC §14 |
| `/api/webhook/[integration]` | POST | n8n, per-integration rotating secret | external glue **may only enqueue** an item for human review; it holds no session and no right that writes a business record | SPEC §21 |

`/api` is a reserved segment in `mandant.slug` (§1.6). No `/api` route reads `params.mandant`
as authority, and every one of them is produced by the same `handler()` wrapper that declares
its right, so `tests/invariants/route-manifest.test.ts` covers them exactly as it covers
pages (AUT-04, SEC-A1).

---

## 11. Navigation

### 11.1 The staff sidebar (DESIGN §5)

Width `248px`, background `--surface`, collapsible to `64px`, icons `18px`, labels at `sm`.
The active item takes `--surface-2` plus a **3px left bar in the current area's identity
hue** — the same hue as the 3px bar across the very top of the app, which is present at all
times (TEN-07, DESIGN §6 rule 4).

An item renders only when **the module is enabled for the mandant** (§1.7) **and** the user
holds the module's read right. A group with no visible items is not rendered: no empty
headers, no greyed placeholders. The sidebar is a convenience and never the access control
(AUT-04) — every route re-checks.

| Group | Items | Module |
|---|---|---|
| — | Dashboard | `bericht` |
| Vertrieb | CRM · Kunden · Kontakte · Wiedervorlagen · Angebote · Leistungskatalog · Radar | `crm`, `angebot`, `katalog`, `radar` |
| Operations | Objekte · Aufträge · Aufgaben · Qualität | `objekt`, `auftrag`, `aufgabe`, `qualitaet` |
| Reinigung | Reviere · Turnus · Sonderleistungen · Leistungsnachweise | `reinigung`, `nachweis` |
| Security | Posten · Veranstaltungen · Wachbuch · Dienstanweisungen · Schlüssel · Bewacherregister | `security`, `wachbuch`, `dienstanweisung`, `schluessel` |
| Bau | Projekte · Leistungsverzeichnisse · Aufmaß · Nachträge · Behinderungen · Bautagebuch | `bau` |
| Personal | Dienstplan · Zeiterfassung · Stundenkonten · Anstellungen · Personen · Nachweise · Abwesenheiten · Anträge | `dienstplan`, `zeit`, `personal` |
| Finanzen | Rechnungen · Eingangsrechnungen · Belege · Ausgaben · Zahlungen · Mahnungen · Ausgangsbuch | `finanzen`, `eingang`, `zahlung`, `mahnung`, `nummernkreis` |
| Buchhaltung | Buchungen · Konten · DATEV · Bank · Offene Posten · Monatszahlen · Archiv · Exporte | `buchhaltung`, `buchhaltung_konfiguration` |
| Marketing | Social Media · Website-Inhalte · Recruiting | `social`, `referenz`, `recruiting` |
| KI | Agent Center · Freigaben | `agent`, `freigabe` |
| — | Dokumente · Kalender · Nachrichten · Benachrichtigungen · Berichte | `dokument`, `kalender`, `nachricht`, `bericht` |
| — | Einstellungen · Protokoll · Datenschutz | `system`, `datenschutz` |

Group headers use `micro` uppercase in `--text-subtle` (DESIGN §2).

**The trade prefix in `/security/wachbuch` is a module namespace, not an entity namespace.**
For the security mandant the URL reads `/portal/security/security/wachbuch`, which is
cosmetically redundant and structurally right: the first segment is *which entity*, the
second is *which module*, and the two are independent — `mandant.module` is data, so a future
area could enable `bau` alongside `reinigung`. Dropping the module segment would make the URL
depend on the slug that happens to match, which is exactly the coupling TEN-08 forbids.

### 11.2 Mobile bottom tab bars — five destinations per portal

Below `md` (768px) the sidebar is replaced by a bottom tab bar with exactly five
destinations (DESIGN §5, §8). Because the staff portal has far more than five modules, its
fifth slot is **Mehr**, opening a full-screen sheet with the complete sidebar tree. Tap
targets ≥ 44×44px.

| Portal / role | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `intern`, global role | Dashboard | Aufträge | Dienstplan | Finanzen | Mehr |
| `intern`, `admin` | Dashboard | Aufträge | Dienstplan | Freigaben | Mehr |
| `intern`, `leitung` | Dashboard | Dienstplan | Zeiterfassung | Aufträge | Mehr |
| `mitarbeiter` (`/portal/mein`) | Heute | Schichten | Stunden | Nachrichten | Profil |
| `kunde` (`/portal/kunde`) | Übersicht | Aufträge | Rechnungen | Nachweise | Nachrichten |
| group scope (`/portal/gruppe`) | Übersicht | Finanzen | Aufträge | Radar | Berichte |

The worker row has **no Mehr tab**: everything an operative needs is in those five, and a
sixth destination behind a menu is a destination a worker in a stairwell will not find. The
group row has no Mehr tab either — every group page is read-only and reachable from the five
hubs. Data tables become stacked cards below `768px` throughout, and no data table ever gets
a horizontal scrollbar on a phone.

### 11.3 The mandant switcher (TEN-06, TEN-07, TEN-10, DESIGN §6)

- **Position:** top-left of the portal header, replacing what would otherwise be a static
  logo. One button, `44px` tall, hover `--surface-2`: circular brand avatar `32px` with a 2px
  ring in the area's identity hue, name at `sm` 600, chevron in `--text-muted`.
- **Rendered only when `app.switcher_mandanten()` returns more than one** (TEN-06, DESIGN §6
  rule 1). A single-area user sees a static logo — no chevron, no dropdown. It is **never**
  rendered in the `mitarbeiter` or `kunde` portal, in `(public)`, in `/auth` or on
  `/check-in`.
- **Dropdown:** `--surface-2`, `--r-lg`, `--shadow-pop`, width `320px`, entering with
  opacity `0→1` and `translateY(-4px→0)` over `--base`. Header `BEREICH WECHSELN` in
  `micro`/`--text-subtle`; one row per mandant with a live counter
  (`Reinigung · 24 Aufträge`); the active row on `--surface-3` with its ring and a check
  mark; last row `Gruppenübersicht` with the `NUR LESEN` pill.
- **The live counters have a defined source** — `app.mandant_kennzahlen()`, `SECURITY
  DEFINER`, restricted to `app.switcher_mandanten()`, returning
  `(mandant_id uuid, schluessel text, wert integer, berechnet_am timestamptz)` and nothing
  else (`02-datenmodell/01-KERN.md` §6.3). The column is `schluessel`, not `kennzahl`; a
  chrome element written against the wrong name is a defect on every page of the product.
  The source is named because the counters are a cross-tenant read rendered everywhere: under
  a naive `withTenant(session.mandantId)` query they would return the active mandant's number
  and zero for the other three, shipping a permanent visible defect on the platform's
  signature interaction. Three properties bound what the dropdown can leak, and all three are
  properties the data model states rather than promises this map makes: the row set is
  `switcher_mandanten()`, so it is at most the areas the user may already enter; **the return
  type carries no `bigint` and no money column at all**, so `wert` is a count and a later
  "revenue per area" wish cannot arrive through this door (EMP-13, D-09 §6); and the switcher
  is not rendered in the `mitarbeiter` or `kunde` portal, so a customer can never read the
  group's order volume from a chrome element. Whether the counts are additionally filtered by
  the viewer's per-module read rights is **not** something the definition states, and this
  map does not assume it — §17 asks `01-KERN.md` to settle it, because a count of records the
  viewer could not open is a weaker leak than a figure but still a leak.
- **Keyboard:** `⌘K` opens, arrows navigate, `Enter` switches, `Esc` closes. Each row is a
  **submit button inside its own form** that POSTs to `/api/sitzung/mandant`; making the rows
  links would satisfy the keyboard contract and break the POST-only rule. `⌘K` is reserved
  for the switcher — there is no competing command palette.
- **Switching** writes two mirror `audit_log` rows (TEN-09), sets the active mandant in the
  **server session** (TEN-04), and lands on `/portal/<slug>`. Group entry sets
  `ansicht = 'gruppe'` and lands on `/portal/gruppe`.
- **Mobile:** the switcher keeps the header's left slot at full width minus the notification
  bell; the dropdown becomes a bottom sheet. The 3px hue bar sits above the header at every
  breakpoint.
- **The bar's neutral state.** DESIGN §6 rule 4 requires the 3px identity bar "at all times",
  and there are three contexts with no active mandant: group scope, the `auth` screens and a
  context-less enrolment session. All three render the bar in neutral `--border-strong`, and
  the portal layout is never handed a null mandant and left to invent a colour. **This
  neutral state must be added to DESIGN §6 rule 4** — see §17.

### 11.4 Public navigation (DESIGN §5)

Header `72px`, `--ink` at 85 % opacity with `backdrop-filter: blur(12px)` once scrolled. Logo
left; centre nav **Unternehmen · Leistungen · Projekte · Über uns · News · Kontakt**; right a
red `Angebot anfragen` — the one primary button on the page — and a ghost `Login` pointing at
`/auth/login`. Mobile: a full-screen overlay menu. The footer carries the four entities' NAP
(PUB-12), the legal trio **Impressum · Datenschutz · Barrierefreiheit**, and — only on pages
without a hero pen-note — the single script sign-off (DESIGN §2).

---

## 12. Worker-facing surfaces — de / en / ar / tr (EMP-12)

UI copy is German (CLAUDE.md). The translated surfaces are exactly those a person without
German may have to operate to do their job or to be paid correctly.

| Surface | Routes | Locale source |
|---|---|---|
| Check-in | `/check-in/[token]`, `/check-in/abgelaufen` | `person.sprache`, resolved from the token — there is no login to read a preference from |
| Worker login | `/auth/mitarbeiter`, `/auth/mitarbeiter/code` | a cookie, defaulting to `Accept-Language`, then German |
| Worker portal | every route under `/portal/mein/**` | `person.sprache` |
| Account screens in the worker shell | `/portal/konto/**` when `app.portal() = 'mitarbeiter'` | `person.sprache`, editable at `/portal/konto/profil` |
| Shift action screens | `/portal/mein/schichten/[zuordnungId]/{fotos,wachbuch,leistungsnachweis,bautagebuch}` | operator chrome translated; the legal text a **customer** signs on the Leistungsnachweis stays German |
| Dienstanweisung acknowledgement | `/portal/mein/dienstanweisungen`, `/[id]` | the acknowledgement UI is always translated; the instruction document itself only where the entity supplies a translation (SEC-06, EMP-09) |
| Notices | absence, leave, swap and objection forms under `/portal/mein/**` | EMP-07, EMP-10 |

Rules that hold across all four languages.

- **No locale route segment.** There is no `/[locale]/…` tree. The locale comes from
  `person.sprache`, or from a cookie on the pre-login screens, and the route tree stays
  single. Quadrupling ~40 worker routes into locale variants quadruples the surface that must
  be tested for a benefit no user asked for, and it would put two URLs on one §17 MiLoG
  screen.
- **`person.sprache` is the single master** (D-09: the language is a fact about the human).
  It is edited in exactly one place, `/portal/konto/profil`, and it drives the portal UI, the
  SMS text and the worker documents. A `benutzer.sprache` exists only for accounts with no
  `person_id`.
- **Arabic is RTL.** `dir="rtl"` on the document; the bottom tab bar and the back
  affordance mirror; the identity hue bar and the 3px active indicator do not. Icons that
  encode direction get a mirrored variant; a check mark does not.
- **Numbers, money and time never localise away from the legal form.** Money renders
  `1.234,56 €` and instants render in `Europe/Berlin` in every language (invariants 1 and 2,
  and the deliberate non-goal of a per-user time zone). A worker reading Turkish sees exactly
  the hours their MiLoG record contains.
- Body text is never below `16px` in any script (DESIGN §8); Arabic and Turkish strings run
  longer than German, so every worker-facing layout must survive a 1.4× string expansion —
  and the check-in screen must survive it **without gaining a scrollbar**, because that is
  the one screen whose no-scroll rule is a physical constraint.

---

## 13. Accessibility across the whole map (LEG-07, PUB-09, DESIGN §9)

WCAG 2.1 AA is a product requirement, not a public-site requirement. BFSG reaches the
consumer-facing pages; DESIGN §9 reaches everything; and the two surfaces where failure costs
the most — the check-in screen operated one-handed at 05:55, and the worker portal in four
languages including RTL Arabic — are neither public nor optional.

| Surface | The requirement that bites hardest |
|---|---|
| `(public)` | full audit per ROADMAP Phase 2; Lighthouse accessibility green on mobile |
| `/auth/**` | labels bound to every input; `inputmode="numeric"` and `autocomplete="one-time-code"` on code fields; the code field is never split into six single-character inputs, which breaks screen-reader flow; errors announced through `aria-live="polite"` |
| `/check-in/[token]` | one primary button ≥ 44×44px, no scroll, operable with gloves; colour never the only signal for a state; the confirmation is announced, not merely coloured |
| `/portal/mein/**` | 16px minimum body text, RTL mirroring, tap targets, and a visible focus ring on every control |
| Switcher and area chooser | fully keyboard-operable; the active area marked by **name and check mark**, never by hue alone |
| Tables and KPI cards | status pills carry text as well as colour; numbers are tabular figures; every figure is a link (DSH-04) |
| 404 and error pages | identical for a wrong id and a foreign tenant, with a route back to the caller's own dashboard |

`prefers-reduced-motion` is honoured everywhere: transforms are disabled, opacity is kept
(DESIGN §7).

---

## 14. Phase plan — which routes exist when

Phases are sequential (ROADMAP). A later phase extends a route; it never removes one.

| Phase | Routes first shipped | Acceptance this map must satisfy |
|---|---|---|
| 0 | `(dev)/styleguide` | DESIGN.md exists as code |
| 1 | `/auth/**`, `/portal/[mandant]` shell + dashboard skeleton, `/portal/[mandant]/einstellungen/{mandant,identitaet,benutzer,rollen,module,protokoll}`, `/portal/gruppe` + `/portal/gruppe/protokoll`, `/portal/konto/{profil,sicherheit,zugriffe}`, `not-found`, `error` | a user of area A gets **404** on every entity of area B — deep link, fetch, action, API; no create/update path executes without exactly one active mandant; a fifth area needs a DB row only |
| 2 | all of `(public)`, `/angebot/**`, `/portal/[mandant]/website/**`, `/portal/[mandant]/einstellungen/integrationen`, `/portal/[mandant]/benachrichtigungen` | a phone form submission appears as an owned lead with a deadline inside the portal, with its source recorded |
| 3 | `/portal/mein` shell, `/portal/kunde` shell, `/portal/[mandant]/personal/**`, `/portal/[mandant]/nachrichten`, `/auth/mitarbeiter/**` | an employee account reaches nothing beyond its own data, proven by test |
| 4 | `/portal/[mandant]/crm/**`, `/objekte/**`, `/auftraege/**`, `/angebote/**`, `/stammdaten/**`, `/dokumente/**`, `/aufgaben`, the `gruppe` operational lists | a cleaning offer prices from the Raumbuch without manual arithmetic |
| 5 | `/dienstplan/**`, `/zeiten/**`, `/reinigung/**`, `/security/**`, `/bau/**`, `/personal/stundenkonten/**`, `/check-in/**`, the worker portal's time features | 22:00–06:00 → 480 min; DST nights → 420 and 540; ten concurrent shifts all visible; a month-end shift splits by actual minutes at the **Berlin** boundary; 6h cleaning + 5h security triggers one ArbZG breach; an expired §34a certificate blocks assignment; a locked Stundenkonto month cannot change |
| 6 | `/finanzen/**`, `/crm/kunden/[id]/steuer`, `/kunde/rechnungen`, `/einstellungen/{steuer,abrechnungsarten,mahnwesen}` | 1000 discarded drafts leave zero gaps; mutating a finalised invoice fails at the database; tampering breaks the hash chain and the nightly job reports it; a KoSIT-valid XRechnung is produced for a public buyer |
| 7 | `/buchhaltung/**`, `/datenschutz/**`, `/dokumente/{buendel,aufbewahrung}`, `/einstellungen/dpa` | the tax advisor accepts a real EXTF file without rework |
| 8 | `/radar/**`, `/agenten/**`, `/freigaben/**`, `/finanzen/mahnungen/vorschlaege`, the `gruppe` KI pages | real notices appear daily with a reason string; the assistant answers from live data or says it cannot; a €25,000 offer cannot be sent automatically under any configuration |
| 9 | `/social/**`, `/recruiting/**`, `/berichte/**`, `/kalender`, `/portal/konto/{benachrichtigungen,kalender-feed}`, `/karriere/**` | channel attribution answers which source produced signed orders |
| 10 | `/einstellungen/import`, `/.well-known/security.txt` | isolation suite green; ZAP baseline; tested restore; DSGVO pack complete |

---

## 15. SPEC coverage — every feature ID has a route

A feature ID with no route is a feature nobody builds. Every ID in SPEC appears exactly once
below, against the route that serves it (paths shortened: `P` = `/portal`, `M` =
`/portal/[mandant]`). IDs served entirely by a job, a policy or a database construction are
marked as such, with the screen that renders their result.

### 15.1 Tenancy, public site, profiles, offer requests

| ID | Route | ID | Route |
|---|---|---|---|
| TEN-01 | `M/einstellungen/mandant` | PUB-08 | `M/website/seiten` |
| TEN-02 | `M/finanzen/nummernkreise`, `M/finanzen/ausgangsbuch` | PUB-09 | all `(public)`, §13 |
| TEN-03 | policy on every table; §1.3 | PUB-10 | `/sitemap.xml`, image rules §2.1 |
| TEN-04 | `/api/sitzung/mandant`, §1.5 | PUB-11 | JSON-LD table §2.5 |
| TEN-05 | `P/gruppe/**` | PUB-12 | `/impressum`, `/llms.txt`, `/robots.txt`, `/kontakt` |
| TEN-06 | switcher §11.3, `/auth/bereich` | PUB-13 | §2.1 (no trackers, self-hosted fonts) |
| TEN-07 | hue bar §11.1, §11.3 | PUB-14 | `/`, `/unternehmen/[bereich]` avatar row |
| TEN-08 | §1.6, §1.7 | PRO-01 | `/unternehmen/[bereich]`, `M/website/profil` |
| TEN-09 | `/api/sitzung/mandant`, `M/einstellungen/protokoll` | PRO-02 | the profile sub-tabs §2.2 |
| TEN-10 | switcher dropdown §11.3 | PRO-03 | `/unternehmen`, profile avatar row |
| PUB-01 | §2.1 marketing table | PRO-04 | `/unternehmen/[bereich]/beitraege` |
| PUB-02 | `/`, `/unternehmen` | PRO-05 | `M/auftraege/[id]/kundenfreigabe` → `M/website/referenzen` → `/projekte` |
| PUB-03 | `/` brand cards | REQ-01 | `/angebot`, `/angebot/[bereich]`, `M/website/formulare` |
| PUB-04 | DESIGN §4 rules, `/galerie` | REQ-02 | `/angebot/[bereich]` — the `reinigung` field set |
| PUB-05 | DESIGN direction | REQ-03 | `/angebot/[bereich]` — the `security` field set |
| PUB-06 | every `(public)` route | REQ-04 | `/angebot/[bereich]` — the `bau` field set + LV upload |
| PUB-07 | `M/website/**` → all public pages | REQ-05 | `M/crm/leads` |
| | | REQ-06 | watchdog → `M/benachrichtigungen` |
| | | REQ-07 | `M/crm/leads/[id]`, `M/berichte/attribution` |

### 15.2 Auth, dashboards, CRM, radar

| ID | Route | ID | Route |
|---|---|---|---|
| AUT-01 | `/auth/login`, `M/einstellungen/benutzer` | CRM-01 | `M/crm/**` |
| AUT-02 | `/auth/zwei-faktor/**`, `P/konto/sicherheit` | CRM-02 | `M/crm`, `M/crm/leads` |
| AUT-03 | `M/einstellungen/rollen`, `/module` | CRM-03 | `M/crm/kunden/[id]`, `M/crm/kontakte/[id]` |
| AUT-04 | §1.4, every route | CRM-04 | `M/crm/wiedervorlagen`, `M/aufgaben` |
| AUT-05 | K-03 policies behind every `M` route | CRM-05 | lead → offer → order → invoice chain, §5.2/§5.4/§5.6/§5.14 |
| AUT-06 | §1.4, `not-found.tsx` | CRM-06 | `P/gruppe/kunden` |
| AUT-07 | `/auth/**`, middleware | CRM-07 | `M/crm/leads`, §2.3 vocabulary |
| AUT-08 | `M/einstellungen/protokoll` | CRM-08 | `M/crm/kontakte/[id]/rechtsgrundlage`, `/werbewiderspruch` |
| DSH-01 | `M` dashboard, `P/gruppe` | RAD-01 | `M/radar` |
| DSH-02 | `P/gruppe` filter; §5.1 | RAD-02 | `M/radar` |
| DSH-03 | the five renderings §5.1 | RAD-03 | `M/radar/[id]` raw payload |
| DSH-04 | every figure links; §1.8 | RAD-04 | `M/radar/profile/[id]` |
| DSH-05 | `M/zeiten/live` | RAD-05 | `M/radar` reason column |
| | | RAD-06 | `M/radar` countdown, `danger` pill |
| | | RAD-07 | `M/radar/[id]/status`, `/mappe/einreichung` |
| | | RAD-08 | watchdog → `M/benachrichtigungen` |
| | | RAD-09 | `M/radar/plattformen`, flag in the list |

### 15.3 Operations and trade modules

| ID | Route | ID | Route |
|---|---|---|---|
| OPS-01 | `M/objekte/**`, `M/crm/kunden` | SEC-01 | `M/security/posten/[id]`, `M/stammdaten/qualifikationen` |
| OPS-02 | `M/objekte/[id]/raumbuch` | SEC-02 | `M/personal/nachweise` |
| OPS-03 | `M/stammdaten/belagsarten` | SEC-03 | `M/security/bewacherregister` |
| OPS-04 | `M/objekte/[id]/raumbuch/import` | SEC-04 | service + trigger; surfaced on `M/dienstplan/einsatz/[id]` |
| OPS-05 | `M/auftraege/**`, `M/bau/projekte/**` | SEC-05 | `M/security/wachbuch/**`, `P/mein/schichten/[id]/wachbuch` |
| OPS-06 | `M/leistungskatalog` | SEC-06 | `M/security/dienstanweisungen/**`, `P/mein/dienstanweisungen` |
| OPS-07 | `M/angebote/[id]/kalkulation` | SEC-07 | `M/security/schluessel/**` |
| OPS-08 | `M/angebote/[id]/pdf`, `/versand` | SEC-08 | `M/security/veranstaltungen/[id]/besetzung` |
| OPS-09 | `M/angebote/[id]/annahme` | BAU-01 | `M/bau/projekte/[id]/lv/**` |
| OPS-10 | `M/auftraege/neu` | BAU-02 | `M/bau/projekte/[id]/aufmass/**` |
| OPS-11 | `M/aufgaben`, order and project tabs | BAU-03 | `…/aufmass/[id]/freigabe` |
| CLN-01 | `M/reinigung/reviere/**` | BAU-04 | `…/nachtraege/**` |
| CLN-02 | `M/reinigung/turnus/**` | BAU-05 | warning on `M/zeiten/[id]` and the LV position |
| CLN-03 | Turnus occurrence preview (Berlin holidays) | BAU-06 | `…/behinderungen/**` |
| CLN-04 | `M/reinigung/leistungsnachweise/**`, `P/mein/schichten/[id]/leistungsnachweis` | BAU-07 | `…/bautagebuch/[datum]` |
| CLN-05 | `M/reinigung/sonderleistungen` | BAU-08 | DWD weather on `…/bautagebuch/[datum]`; status in `M/einstellungen/integrationen` |

### 15.4 Scheduling, time, worker portal

| ID | Route | ID | Route |
|---|---|---|---|
| TIM-01 | `M/dienstplan/{woche,monat,tag}` | EMP-01 | `/auth/mitarbeiter/**` |
| TIM-02 | `M/dienstplan/serien/**` | EMP-02 | `P/mein`, `P/mein/schichten` |
| TIM-03 | generator job; result on `M/dienstplan/woche` | EMP-03 | `P/mein/zeiten` |
| TIM-04 | parallel columns, §5.10 | EMP-04 | `P/mein/stundenkonto`, `M/personal/stundenkonten/**` |
| TIM-05 | `M/dienstplan/konflikte` | EMP-05 | `P/mein/urlaub` |
| TIM-06 | ArbZG panel, `…/uebersteuern` | EMP-06 | `P/mein/monatsnachweis`, `/api/nachweis/monat/**` |
| TIM-07 | `/check-in/[token]`, `M/zeiten/checkin-links` | EMP-07 | `P/mein/zeiten/[id]/einwand` → `M/zeiten/einwaende` |
| TIM-08 | `M/zeiten/[id]`, check-in `bestaetigt` state | EMP-08 | `P/mein/nachweise` |
| TIM-09 | `/api/check-in/[token]`, `M/zeiten/nacherfassung` | EMP-09 | `P/mein/dienstanweisungen/[id]` |
| TIM-10 | `…/fotos`, `M/dokumente/upload` | EMP-10 | `P/mein/antraege/neu`, `/abwesenheit/neu`, `M/personal/antraege` |
| TIM-11 | `M/zeiten/[id]/korrektur`, `M/zeiten/korrekturen` | EMP-11 | `P/mein/{dokumente,nachrichten}` |
| TIM-12 | `M/zeiten/freigabe`, `M/finanzen/rechnungen/neu` | EMP-12 | §12 |
| TIM-13 | `M/zeiten/milog` | EMP-13 | §7 (structural), SEC-A3 assertions 6/15/17 |
| TIM-14 | ArbZG panel §5.10.1, `P/gruppe/dienstplan` | EMP-14 | `P/mein/schichten` labelled per entity |
| | | EMP-15 | `P/mein/stundenkonto` tabs, `P/gruppe/auslastung` |

### 15.5 Finance, accounting, documents

| ID | Route | ID | Route |
|---|---|---|---|
| FIN-01 | `M/einstellungen/abrechnungsarten`, `M/auftraege/[id]/abrechnung` | ACC-01 | `M/buchhaltung/{buchungen,konten,perioden}` |
| FIN-02 | `M/finanzen/rechnungen/[id]`, `/festschreiben` | ACC-02 | `M/buchhaltung/datev/**` |
| FIN-03 | `/festschreiben` (counter under `FOR UPDATE`) | ACC-03 | `M/buchhaltung/datev/[id]` manifest |
| FIN-04 | `M/finanzen/rechnungen/[id]/pruefung` | ACC-04 | `M/buchhaltung/bank/**`, `M/finanzen/zahlungen` |
| FIN-05 | pre-flight rule 7, §5.14.2 | ACC-05 | `M/finanzen/eingangsrechnungen/[id]` → `M/freigaben` |
| FIN-06 | `M/finanzen/hashkette` | ACC-06 | `M/buchhaltung/archiv` |
| FIN-07 | line source on `M/finanzen/rechnungen/[id]` | ACC-07 | `M/buchhaltung/offene-posten`, `P/gruppe/offene-posten` |
| FIN-08 | `…/abschlaege`, pre-flight rule 12 | ACC-08 | `M/buchhaltung/monatszahlen` |
| FIN-09 | `M/crm/kunden/[id]/steuer`, pre-flight rule 11 | ACC-09 | `M/buchhaltung/z3-export` |
| FIN-10 | `…/steuer`, `M/finanzen/eingangsrechnungen/[id]/steuer`, rule 13 | ACC-10 | `M/buchhaltung/verfahrensdokumentation` |
| FIN-11 | `…/xrechnung`, §5.14.3 | ACC-11 | `M/buchhaltung/jahrespaket` |
| FIN-12 | `…/zugferd` | ACC-12 | `M/buchhaltung/lohnexport`, `M/zeiten/milog` |
| FIN-13 | Kleinbetrag relaxation, §5.14.2 | DOC-01 | `M/dokumente` categories |
| FIN-14 | `M/finanzen/{eingangsrechnungen,belege,ausgaben,zahlungen}` | DOC-02 | `M/dokumente` search, `P/gruppe/dokumente` |
| FIN-15 | `M/finanzen/mahnungen/**`, `M/einstellungen/mahnwesen` | DOC-03 | `/api/dokument/[id]/url` |
| FIN-16 | `M/finanzen/ausgangsbuch` | DOC-04 | `M/dokumente/[id]/kundenfreigabe` |
| FIN-17 | `M/finanzen`, `P/gruppe/finanzen` | DOC-05 | `M/dokumente/[id]` versions |
| FIN-18 | `M/finanzen/pruefungen`, `M/auftraege/[id]/abschluss` | DOC-06 | `M/dokumente/upload`, every upload route |
| | | DOC-07 | `M/dokumente/aufbewahrung` |
| | | DOC-08 | `M/dokumente/buendel` |

### 15.6 Calendar, notifications, social, recruiting, agents, approvals, reporting

| ID | Route | ID | Route |
|---|---|---|---|
| CAL-01 | `M/kalender`, `P/gruppe/kalender` | AGT-01 | `M/agenten`, `M/agenten/[agent]` |
| CAL-02 | calendar filters | AGT-02 | `M/agenten/[agent]` tool list; K-10 |
| CAL-03 | `P/konto/kalender-feed`, `/api/kalender/feed/**` | AGT-03 | `M/einstellungen/agent-richtlinien` |
| NOT-01 | `M/benachrichtigungen` | AGT-04 | `M/agenten/[agent]/protokoll` |
| NOT-02 | `P/konto/benachrichtigungen` | AGT-05 | `M/agenten/budget`, `P/gruppe/agenten` |
| NOT-03 | every notification links to its record | AGT-06 | `M/agenten/wissen` |
| SOC-01 | `M/social`, `M/social/statistik` | AGT-07 | `M/agenten/assistent` |
| SOC-02 | `M/social/posts/**` | APR-01 | `M/freigaben`, `P/gruppe/freigaben` |
| SOC-03 | post status flow + `…/planung` | APR-02 | `M/freigaben/[id]` diff |
| SOC-04 | composer sources (`referenz`, `auftrag`) | APR-03 | source and confidence on `M/freigaben/[id]` |
| SOC-05 | publish to `/unternehmen/[bereich]/**` | APR-04 | `M/freigaben/stapel` |
| SOC-06 | `M/social/kanaele` | APR-05 | `M/freigaben/laufend`, `…/einspruch` |
| SOC-07 | „nicht verbunden" state, §5.21 | APR-06 | `…/rueckgaengig` |
| SOC-08 | approval before every external publish | APR-07 | `M/freigaben/erledigt` snapshots |
| REC-01 | `M/recruiting/bedarf` | APR-08 | `M/freigaben/pruefdauer` (K-13, server-measured) |
| REC-02 | `M/recruiting/stellen/neu` | REP-01 | `M/berichte/umsatz`, `P/gruppe/berichte/umsatz` |
| REC-03 | `/karriere/[stelle]/bewerbung`, mailbox | REP-02 | `M/berichte/auftraege` |
| REC-04 | `M/recruiting/kandidaten/[id]` | REP-03 | `M/berichte/attribution` |
| REC-05 | `…/bewertung` | REP-04 | `M/berichte/mitarbeiter`, `P/gruppe/auslastung` |
| REC-06 | `M/recruiting/gespraeche` | REP-05 | `M/berichte/projekte` |
| REC-07 | `M/recruiting/datenschutz` | REP-06 | `M/berichte/pipeline`, `P/gruppe/radar` |
| REC-08 | `…/entscheidung` (`requireMensch`) | REP-07 | export control on every report page |
| REC-09 | `M/recruiting/stellen/[id]/veroeffentlichung` | | |

### 15.7 Legal and security

| ID | Route | ID | Route |
|---|---|---|---|
| LEG-01 | `M/buchhaltung/archiv`, `M/finanzen/hashkette`, `M/einstellungen/protokoll` | SEC-A1 | §1.4, every route |
| LEG-02 | `M/zeiten/milog` (all four mandanten) | SEC-A2 | K-03 policies behind every `M` route |
| LEG-03 | ArbZG panel §5.10.1 | SEC-A3 | the isolation suite; every `Scope` token in this map is one of its inputs |
| LEG-04 | `M/personal/nachweise`, `M/security/bewacherregister`, SEC-04 block | SEC-A4 | Zod at every boundary, §1.4 |
| LEG-05 | `M/finanzen/rechnungen/[id]/pruefung` | SEC-A5 | no route ships a key to the client |
| LEG-06 | `M/crm/kunden/[id]/steuer`, `…/eingangsrechnungen/[id]/steuer` | SEC-A6 | `/api/dokument/[id]/url` |
| LEG-07 | §13 | SEC-A7 | CSP nonce in `middleware.ts`, §2.6 |
| LEG-08 | `…/rechtsgrundlage`, `/werbewiderspruch`, `M/datenschutz/widersprueche` | SEC-A8 | CI, not a route |
| LEG-09 | `M/datenschutz/**`, `/datenschutz/anfrage`, `M/einstellungen/dpa` | SEC-A9 | `M/einstellungen/protokoll`, `/export` |
| LEG-10 | check-in geolocation notice §4.1 | SEC-A10 | infrastructure, not a route |
| LEG-11 | `M/recruiting/datenschutz` | | |
| LEG-12 | `…/kandidaten/[id]/entscheidung` — no auto-reject control exists | | |

---

## 16. Open questions this map raises

Every entry exists in the document as a labelled placeholder behind an interface (K-17) and
must be mirrored in `docs/DECISIONS.md` under **Open**. Nothing below is guessed anywhere in
this map.

**On the numbering.** `docs/DECISIONS.md` holds O-01 and O-04 … O-13. `08-PR-PLAN.md` claims
**O-14 … O-29** for its own nineteen questions — SLA deadlines, lead scoring, overhead rates,
Leistungswerte, working-time models, dunning levels, Leitweg-IDs, retention periods, the AI
budget, the payroll target system. The one register in `docs/DECISIONS.md` holds every number and names its owner, and
`03-AUTH-BERECHTIGUNGEN.md` §20 has renumbered its nineteen into **O-74 … O-92** for exactly
this reason. This map's own questions are **O-33 … O-52 minus O-39** (§16.1) plus two added by
correction passes, **O-93** and **O-132**. O-39 is *not* this map's: it belongs to
`02-datenmodell/04-PLANUNG-ZEIT.md` as `zeit-freigabeschritt`, three documents already cite
it that way, and the geocoding question this map used to file under it has moved to O-132
(§16.1). O-132 was the next free number when this map was written; the register in `docs/DECISIONS.md` now runs to O-203 and is the only place a number is assigned.

An earlier draft of this map cited six auth questions by their pre-renumbering numbers —
O-14, O-18, O-20, O-22, O-26, O-27, O-28, O-29, O-31, O-32 — every one of which is a
*different* question in `08-PR-PLAN.md`. Two different questions under one number is worse
than a gap, because the client answers the number and the answer lands on the wrong feature.
They are corrected throughout this document to the auth document's numbers, and each carries
that document's **stable slug** so the question survives any later renumbering DECISIONS.md
imposes when it reconciles all Phase 0 documents at once:

| Cited here | Slug | Question |
|---|---|---|
| O-74 | `auth-kunde-schreibrechte` | may a customer write in the portal? |
| O-75 … O-77 | `auth-entgelt-leitung`, `auth-leitung-freigaben`, `auth-storno-berechtigung` | the still-open role defaults of §12 |
| O-78 | `auth-wachbuch-kundensicht` | may a Wachbuch or Bautagebuch entry be shown to a customer? |
| O-80 | `auth-sperrschwellen` | the AUT-07 lockout thresholds |
| O-82 | `auth-sms-anbieter` | which EU-hosted SMS gateway, and what spend cap? |
| O-86 | `auth-mobilnummer-vieraugen` | four eyes for re-binding a worker's mobile number? |
| O-87 | `auth-austritt-login` | on `austritt`, is the worker login disabled at once? |
| O-88 | `auth-doppelrolle-login` | the dual-role login of §3 |
| O-89 | `auth-nachweis-gegenzeichnung` | counter-signature flow for CLN-04? |
| O-91 | `auth-entwurf-kundensicht` | finalised invoices only for customers? |
| O-92 | `auth-aufbewahrung-telemetrie` | retention for auth events and `audit_log` |

### 16.1 Questions this document adds

| # | Question | Blocks which routes |
|---|---|---|
| O-33 | Does CSE Operations sell to external customers at all? | `/angebot` area chooser, and exactly the ten `?` module rows for `operations` in §1.7 — `crm`, `crm_entgelt`, `formular`, `angebot`, `kalkulation`, `auftrag`, `katalog`, `qualitaet`, `radar`, `vergabe` — plus `abrechnung` together with O-01 |
| O-34 | Legal review of the outbound matrix: which message classes may be sent on `anfrage`, on `bestandskunde` and on `einwilligung`; the exact §7 Abs. 3 Nr. 4 UWG opt-out wording; whether the four cumulative conditions are satisfiable here at all | `crm.kommunikation_versenden` on every screen that sends, `/werbewiderspruch/**` |
| O-35 | Which mailbox receives security reports, and who monitors it? | `/.well-known/security.txt` — not published without an owner |
| O-36 | Which EU-hosted transactional e-mail sender delivers invitations, resets, offers, dunning and NOT-02 mail, under which DPA? | `/auth/**` delivery, `M/angebote/[id]/versand`, `M/finanzen/mahnungen`, `P/konto/benachrichtigungen` |
| O-37 | Which wage basis applies per area and per activity (Gebäudereiniger tariff groups, Bau-Mindestlohn, security agreement), and from which dates? | `M/angebote/[id]/kalkulation`; a placeholder rate blocks `angebot.preis_freigeben` |
| O-38 | One group career page with an area filter, or one per area? | `/karriere/**` — one group page is assumed |
| O-132 | `seiten-geo-anbieter` — which EU-hosted map tile and geocoding provider, under which DPA? | the map on `M/objekte` and `P/gruppe/objekte`; no address is sent to an unconfigured service. **Renumbered from O-39 by this correction pass**: `02-datenmodell/04-PLANUNG-ZEIT.md` §1.3 and `03-AUTH-BERECHTIGUNGEN.md` §12.4 both use O-39 for `zeit-freigabeschritt`, and two questions under one number is worse than a gap — the client answers the number and the answer lands on the wrong feature |
| O-40 | The exact Bewacher-ID format and the fields the Bewacherregister requires | `M/security/bewacherregister` validation |
| O-41 | In which format do LVs arrive — GAEB DA XML (X83/X84), GAEB D8x, Excel, PDF? | `M/bau/projekte/[id]/lv/import` |
| O-42 | May an ArbZG conflict card name the other entity, given §87 BetrVG and data minimisation? | `M/dienstplan/konflikte` — ships at the K-06 minimum until answered |
| O-43 | When two entities employ one person, does one own certificate maintenance and the worker login, or may every employing entity edit them? | `M/personal/personen/[id]/**` |
| O-44 | Dunning: how many levels, at what day offsets, with what fee per level and what interest basis (§288 BGB)? | `M/einstellungen/mahnwesen`, `M/finanzen/mahnungen` — a run refuses to send on a placeholder |
| O-45 | Does the tax audit expect Z1 or Z2 access as well as Z3? | whether a read-only auditor role exists at all |
| O-46 | The retention period and legal basis per data class where SPEC states none: planning data, shift media, check-in tokens, offline claims, ArbZG findings, applicant data, each DOC-07 category | `M/dokumente/aufbewahrung`, `M/recruiting/datenschutz`, the purge job |
| O-47 | Which FX source and date apply to a foreign-currency tender value? | `M/radar` scoring — unscored on value until answered, never converted |
| O-48 | Which FX source and date convert the provider's USD model billing into the EUR budget of AGT-05? | `M/agenten/budget` hard stop |
| O-49 | Confirm that CSE Operations owns the group-level public pages | `M/website/seiten` ownership |
| O-50 | Does a collective agreement impose break or rest rules stricter than the ArbZG for any trade, and from when? | `M/einstellungen/arbeitszeit` |
| O-51 | Must the EMP-06 monthly statement be issued in the employee's language, or is German the required form for a §17 MiLoG record? | `P/mein/monatsnachweis` |
| O-52 | Does a company buying from two entities get one login with an entity filter, or one login per entity? | `P/kunde/**` — one login with a filter is assumed; `app.aktuelle_kunden()` returns an array either way (§8) |
| O-93 | `zeit-checkin-kanal` — how does the check-in link reach the worker: SMS, e-mail, a QR code posted at the object, or a portal link, and who carries the SMS cost? | `/check-in/[token]` delivery, `M/zeiten/checkin-links`, `checkin_token.ausgabe_kanal`. Answered together with O-82, which names the provider; **one number, not two** (§17). `02-datenmodell/04-PLANUNG-ZEIT.md` §17.1 and `07-INTEGRATIONEN.md` §32 raise the same question locally and now carry this number |

### 16.2 Existing questions this map is blocked on

| # | Question | Where it bites in this map |
|---|---|---|
| O-01 | Is CSE Operations a GmbH or a department? | the `finanzen` / `buchhaltung` module rows for `operations` (§1.7); no `nummernkreis` is auto-created |
| O-04 | The **rules** of the five billing types — rounding, minimum unit, night and Sunday surcharges, call-off versus monthly flat | `M/einstellungen/abrechnungsarten`, `M/finanzen/rechnungen/neu` |
| O-05 | DATEV parameters plus a real sample EXTF export | `M/buchhaltung/datev/**`, `M/buchhaltung/konten` |
| O-06 | Is there a Betriebsrat? | geolocation on `/check-in/[token]`, `M/freigaben/pruefdauer`, the detail level of `M/dienstplan/konflikte` |
| O-07 | Which procurement platforms is the group registered on? | `M/radar/plattformen` |
| O-08 | Separate domains per area, or one group domain? | every `(public)` canonical URL, `sitemap.xml`, the JSON-LD `@id` values |
| O-10 | Which social and job-board accounts exist, and who owns the credentials? | `M/social/kanaele`, `M/recruiting/stellen/[id]/veroeffentlichung` |
| O-74 | `auth-kunde-schreibrechte` — may a customer write in the portal? | every `KDN→M1` route — none is shipped until answered (§8) |
| O-75 … O-77 | `auth-entgelt-leitung`, `auth-leitung-freigaben`, `auth-storno-berechtigung` — the role defaults §12 leaves open | the **Right** column of every route in §5 renders against whatever §12 finally seeds; no route in this map assumes a default (§1.4) |
| O-78 | `auth-wachbuch-kundensicht` — may a Wachbuch or Bautagebuch entry be shown to a customer? | `P/kunde/**` — both `—` until answered |
| O-80 | `auth-sperrschwellen` — the AUT-07 attempt, window and lockout thresholds | the lockout copy on `/auth/**` (§3), which names no number and no countdown |
| O-82 | `auth-sms-anbieter` — which EU-hosted SMS gateway, and what spend cap? | `/auth/mitarbeiter/**`; the check-in link's *channel* is the separate O-93, answered with it |
| O-86 | `auth-mobilnummer-vieraugen` — four eyes for re-binding a worker's mobile number? | `M/personal/personen/[id]/zugang` |
| O-87 | `auth-austritt-login` — on `austritt`, is the worker login disabled immediately or kept for N days? | `P/mein/**` after the employment ends |
| O-88 | `auth-doppelrolle-login` — confirm the dual-role login path | `/auth/login` versus `/auth/mitarbeiter` (§3) |
| O-89 | `auth-nachweis-gegenzeichnung` — does the customer portal need a counter-signature flow for CLN-04? | `P/kunde/nachweise` |
| O-91 | `auth-entwurf-kundensicht` — finalised invoices only, or may a draft ever be customer-visible? | `P/kunde/rechnungen` — this map answers it conservatively (no draft of anything, ever) and records the answer rather than assuming it (§8) |
| O-92 | `auth-aufbewahrung-telemetrie` — retention for auth events and the `audit_log` deletion concept | `M/einstellungen/protokoll` and its export (§5.24) |
| O-39 | `zeit-freigabeschritt` — is there a release step between recorded time and billing at all? Owned by `02-datenmodell/04-PLANUNG-ZEIT.md` §1.3, which owns `zeiteintrag` | `M/zeiten/freigabe` and the right `zeit.abrechnung_freigeben`, neither of which ships until answered (§5.11). This map's own geocoding question has moved off this number to **O-132** |

---

## 17. Obligations this map places on its siblings

| Document | Obligation |
|---|---|
| `docs/DESIGN.md` | **§6 rule 4 needs a documented neutral state.** The bar runs "at all times", and there are now **five** contexts with no active mandant — group scope, `person` scope (the worker portal), `kunde` scope (the customer portal), the `auth` screens and a context-less enrolment session, `app.mandant_id` being NULL in all three multi-tenant scopes (K-02, K-18). All five render `--border-strong`. Two sibling documents already assert this; DESIGN must state it so the value stops being chosen in a page (D-10, CLAUDE.md). §6 rule 2 additionally needs the sentence that the switcher's live counters are **counts only** — the `app.mandant_kennzahlen()` return type carries no money column — and that the switcher is not rendered in the `mitarbeiter` or `kunde` portal |
| `01-ORDNERSTRUKTUR.md` | (a) the auth screens live under the literal segment `auth/`, not in a `(auth)` route group, so that `/auth/login`, `/auth/bereich` and `/auth/zwei-faktor/**` resolve as `03-AUTH-BERECHTIGUNGEN.md` §4.4/§4.5 requires; (b) `portal/konto/` is the **fourth** static portal segment and must be added to the reserved-slug `CHECK` and to `tests/invariants/reservierte-slugs.test.ts`; (c) `reklamationen` moves out of `portal/[mandant]/reinigung/` into `portal/[mandant]/qualitaet/`, because the module is `qualitaet` and is enabled for three areas; (d) `belagsarten` and the other catalogues move under `portal/[mandant]/stammdaten/`, matching the `stammdaten` module; (e) per-user notification preferences and the iCal token rotation move from `einstellungen/benachrichtigungen` to `portal/konto/**`, because NOT-02 and CAL-03 are per-user facts, and `einstellungen/benachrichtigungen` keeps only the mandant's own notification defaults; (f) there is no `portal/[mandant]/wechseln` route — the interstitial is rendered by the `[mandant]` layout |
| `03-AUTH-BERECHTIGUNGEN.md` | (a) **settled** — §1.2's "redeemable twice at most (checkin then checkout)" now reads as one live token per assignment and purpose, matching the data model's `token_zweck` row per leg and keeping TIM-07's single use literally true (§4.2); (b) **settled** — the set-valued customer accessor exists as `app.aktuelle_kunden() returns uuid[]` and is the sole resolver behind both the `t_kunde` policy and the K-04 customer ceiling; this map is written against that name, not the `app.eigene_kunden()` it previously proposed (§8); (c) **settled** — the customer-login question is **O-52** in both documents; (d) `mandant.slug`'s `CHECK` gains `konto`, and the reserved list is exactly `gruppe`, `mein`, `kunde`, `konto`, `api` (K-21); (e) **settled** — the absence-reason right is **`zeit.abwesenheit_grund_lesen`** (§12.4 is right; `abwesenheit` sits in the `zeit` module, so `personal.abwesenheit_grund_lesen` fails `01-KERN.md` §6.6's `split_part(schluessel,'.',1) = modul` test), and `02-datenmodell/01-KERN.md` §3.4/§11/§14.3/§15 renames it; the `leitung` default is still open between `—` and `○` and belongs in §12.4, not here; (f) **settled by K-21** — `agent_budget`'s cap column is **`budget_cent`** and there is **no stored `verbrauch_cent`**, so §12, §14.1 and `05-API-KARTE.md` §C.21 rename `monatslimit_cent` and present the cents figure as computed from `verbrauch_mikrocent` at the conversion site (§5.19); (g) **settled** — the catalogue carries a row for every key this map gates a route on (K-19: `app.hat_recht()` returns **false** for an unregistered key, so a missing row is a permanently empty screen, not an error). The one that was missing, **`agent.protokoll_lesen`**, is now a row in §14.2 with its own justification and defaults `SA ✔ / AD ○ / LT ○`; this map gates `M/agenten/[agent]/protokoll` and the step chain of `/aufgaben/[id]` (§5.19) on it while keeping page-level `agent.lesen` for the run header, and `app.agent_nutzlast_lesen` re-checks it; (h) **settled** — the group-key grammar admits the optional `<objekt>` segment (`gruppe.<modul>.[<objekt>_]<aktion>`, §7.2), which is what makes `gruppe.system.audit_lesen` insertable and this map's §1.4 grammar block matches it; (i) **settled** — the `kunde` cells of §12.7 are `✔` in the §12.3/§12.5 matrix, not `○`, and `bericht.dashboard_lesen` is a *granted* right for `kunde` (`S` only for `mitarbeiter`), because this map uses all thirteen as the service-layer gate on `/portal/kunde/**` (§8); (j) **settled** — `zeit.abrechnung_freigeben` is not seeded and carries no default binding until O-39 is answered, and this map's `/portal/[mandant]/zeiten/freigabe` carries the same marker (§5.11); (k) **half settled** — `oeffentlich.lesen` carries **no** `berechtigung.nur_global` (§12.1 now says so, and §1.4 of this map has dropped it); what remains is §14.3's last row, which still binds the form intake to "`oeffentlich.lesen` and nothing else". REQ-01 needs a **second** principal holding `oeffentlich.lesen` + `formular.schreiben` + `dokument.schreiben` at `readonly = off`, because K-03's `WITH CHECK` demands `not app.ist_readonly()` and `formular.schreiben` on `formular_eingang` (§2.7, `02-datenmodell/02-CRM-OPERATIONS.md` §1.6.1) |
| `02-datenmodell/01-KERN.md` | (a) a `betroffenenanfrage` table is required by `/datenschutz/anfrage` and `M/datenschutz/**`: subject match, request type (Art. 15/16/17/21), received instant, the Art. 12(3) deadline, the decision record and its author. LEG-09 promises the process; without the table the public form creates a statutory obligation with no internal recipient; (b) §6.3 must state whether `app.mandant_kennzahlen()` filters its counts by the viewer's per-module read rights or only by `app.switcher_mandanten()`. This map renders the dropdown from that function on every page and argues its safety from three stated properties — the mandant restriction, the count-only return type, and the switcher's absence in the `mitarbeiter` and `kunde` portals — but a count of records the viewer could not open is still a leak, and the answer belongs in the definition rather than in a page map (§11.3); (c) the wage column is **`stundensatz_intern`**, no `_cent` suffix (K-05, §6.14) — this map is corrected to that spelling in §6 and §8 |
| `02-datenmodell/02-CRM-OPERATIONS.md` | `/werbewiderspruch/[token]` needs a hashed, revocable objection token per outbound message and a `werbewiderspruch` log row (contact, channel, instant, source message). The objection sets **`ansprechpartner.werbewiderspruch_am`** — and `kunde.werbewiderspruch_am` at company level — and **does not touch `rechtsgrundlage`**: that column is forced to `'keine'` only by `kern.erzwinge_widerspruch()` from `widerspruch_am`, the separate Art. 21 objection to processing. An earlier draft of this map asked for the opposite and would have stopped that customer's invoices, Leistungsnachweise and Mahnungen; §5 of that document corrects it and this map now follows it (§2.4) |
| `02-datenmodell/04-PLANUNG-ZEIT.md` | (a) `M/zeiten/checkin-links` reads `checkin_token` per assignment and purpose; the planner list needs `ausgabe_kanal`, `gueltig_ab`/`gueltig_bis`, `eingeloest_am`, `widerrufen_am` and the token prefix, and never `token_hash`; (b) its delivery-channel question is numbered **O-32** there, a number five sibling documents use for five different questions and which `03-AUTH-BERECHTIGUNGEN.md` has vacated by renumbering its own to O-92. It is **O-93 `zeit-checkin-kanal`** in this map; adopt that number, and merge `07-INTEGRATIONEN.md` §32's local `SmsPort` item into it rather than answering the same question twice |
| `02-datenmodell/05-FINANZEN.md` | `M/einstellungen/mahnwesen` renders `mahnstufe` rows including `ist_platzhalter`; the dunning run must refuse to send while any applicable row is a placeholder (O-44) |
| `02-datenmodell/06-RADAR-KI-INHALT.md` | `M/agenten/budget` renders the **`*_mikrocent`** ledger of K-16(b) — `agent_schritt.kosten_mikrocent`, `agent_kosten.kosten_mikrocent`, `agent_reservierung.betrag_mikrocent`, `agent_budget.verbrauch_mikrocent`/`.reserviert_mikrocent` — converted **once**, half-up, at the `agent_budget.budget_cent` boundary, with the rounding rule stated at the conversion site and shown on the screen. The `kosten_cent` + `kosten_rest` carry pair both documents previously proposed is withdrawn in favour of the convention's spelling. `betrag_original`/`waehrung_original` render beside the converted figure with the conversion marked `ist_platzhalter` until O-48. Three further items: (a) the public routes need a URL key that does not exist yet — `stelle.slug` (with the `CHECK` excluding `initiativbewerbung` and `danke`), `referenz.slug` and `social_post.slug`; `seite` keeps `pfad` and this map is written against it (§1.6); (b) `agent_schritt` / `agent_schritt_beleg` and the payload reader are gated on `agent.protokoll_lesen`, which this map now uses on `M/agenten/[agent]/protokoll` and on the step chain of `/aufgaben/[id]` (§5.19); (c) module `freigabe` needs the group read key `gruppe.freigabe.lesen` for the cross-entity approval inbox of §6 — under K-03 a `t_gruppe` policy can name nothing else |
| the API map | owns the nine endpoints of §10; `POST /api/sitzung/mandant` is the only writer of the active mandant, and `/api/webhook/[integration]` may only enqueue. Two further alignments: `GET /api/kalender/feed/[token].ics` executes `app.ical_feed_lesen` as `cse_anon` and opens **no session helper** (K-08, §9.1), and `POST /api/check-in/[token]` executes `app.offline_ereignis_annehmen` as `cse_checkin` — both are register entries now, not deviations (§4.3) |
| `docs/DECISIONS.md` | **Met** — **O-33 … O-52 (minus O-39), O-93 and O-132** are rows of the one register under **Open**, each naming this map as its owner, and the register names the owner of every other number too. O-14 … O-29 belong to `08-PR-PLAN.md`, O-33 to sibling Phase 0 documents and O-74 … O-92 to `03-AUTH-BERECHTIGUNGEN.md` §20, so this map's references to the auth block are by that document's numbers and slugs (§16). Record as decided: the four short public entity URLs are deleted in favour of `/unternehmen/[bereich]`; `/portal/konto` is a fourth static portal segment; the worker portal reads in `person` scope and the customer portal in `kunde` scope, never in group scope (K-18); the customer portal has no write path until O-74; no draft of anything is ever customer-visible (O-91, answered conservatively); the CEO assistant runs in exactly one mandant and `/portal/gruppe/assistent` does not exist |

---

## 18. What this map deliberately does not contain

| Not built | Why |
|---|---|
| A short public URL per entity (`/reinigung`) | one canonical entity URL, and a per-area root redirect cannot be added by a DB row (TEN-08, §1.1) |
| A cookie-settings page | PUB-13 forbids third-party trackers by default and the fonts are self-hosted, so there is no consent to collect. Adding one means first removing that premise |
| A group settings page or a group agent runner | configuration and agent runs are writes, and there is no write path without exactly one active mandant (invariant 10, K-03) |
| A "submit bid" control anywhere in Radar | D-07: German procurement platforms expose no submission API; a human uploads, and `vergabe.einreichung_erfassen` records that they did |
| An auto-reject control in Recruiting | REC-08, LEG-12, DSGVO Art. 22 |
| An override for the §34a certificate block | SEC-04 is a hard block with no override path, so no permission key for it exists — a right no role may hold is an invitation to bind it |
| A delete control in finance, time or audit | invariant 8; correction is a reversing or superseding row, and `dokument.loeschen` is not a key |
| A per-user time zone | invariant 2: a user-selectable zone puts a §17 MiLoG record and a shift boundary on different calendar days for two viewers of the same data |
| Support impersonation ("log in as this user") | not in SPEC; it needs consent, a visible banner, its own audit class and a hard time box — a designed feature, not a debug convenience |
| A locale route segment | §12: one route tree, locale from `person.sprache` |
| Payroll, Jahresabschluss, E-Bilanz, tax filing screens | D-06: the platform prepares and exports; `M/buchhaltung/{lohnexport,jahrespaket}` are the handover points |
