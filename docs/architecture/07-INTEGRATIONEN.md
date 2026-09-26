# Integrationsarchitektur — external systems, ports, and the not-connected contract

Every system outside this codebase — Supabase, Vercel, OpenAI, DATEV, a bank statement file, a
tender source, a weather service, an SMS gateway, a mailbox, five social platforms, a job board,
n8n, a monitoring service, a backup target — is reached through exactly one typed port in
`src/server/integrations/`, is either genuinely connected or visibly **not connected**, and never
sends anything outward without a `Freigabe` minted by `src/server/agent/policy.ts`. This document
fixes the port contract, the tenancy and RLS of every table the integration layer owns, the
register of what is connected today, the per-system failure behaviour, the DPA and data-residency
register that LEG-09 demands, the environment-variable inventory, the CI gates, and the questions
that must be answered before a given adapter may go live. It follows `00-KONVENTIONEN.md`
throughout; where an earlier draft of this section disagreed with a convention, the convention won.

---

## 1. Placement, naming, call discipline

Two folders, because "not connected" is meaningless for the substrate the application cannot run
without (`01-ORDNERSTRUKTUR.md` §11.1):

| Folder | Holds | Not-connected state |
|---|---|---|
| `src/server/platform/` | Supabase Postgres, Auth, Storage — the managed substrate | **none.** Absent substrate is an outage, not a degraded feature |
| `src/server/integrations/` | every external system that can legitimately be absent | **mandatory.** Every integration has a `nicht-verbunden.ts` |

| Rule | Detail |
|---|---|
| Placement | `src/server/integrations/<system>/` — one directory per integration, plus `kernel/` |
| File shape | exactly four files per integration (`01-ORDNERSTRUKTUR.md` §11.2): `types.ts` (the interface — the deliverable) · `index.ts` (factory: parses config, returns the live or the not-connected adapter) · `nicht-verbunden.ts` · `<vendor>.ts` (added when credentials exist) |
| File naming | kebab-case, ASCII, per `01-ORDNERSTRUKTUR.md` §18 — `extf-writer.ts`, `camt053-parser.ts`, `modell-register.ts`. Not camelCase |
| Port names | **English** — infrastructure stays English (CLAUDE.md): `StoragePort`, `MailerPort`, `TenderSourcePort`, `EInvoiceDeliveryPort` |
| Payload names | **German**, because the payload is domain: `Ausschreibung`, `Rechnung`, `Beleg`, `Feiertag`, `Wetterbeobachtung`, `Kontoauszug`, `Bewerbungseingang` |
| Columns | German snake_case: `quell_id`, `abgerufen_am`, `letzter_fehler_am` |
| May call a port | `src/server/services/**` and `src/server/jobs/**` only, and only through an injected port |
| May **not** | `src/app/**`, `src/lib/**`, React components, Supabase Edge Functions |
| Enforcement | ESLint `no-restricted-imports` (`01-ORDNERSTRUKTUR.md` §16 layer rules) plus a CI grep; a route handler importing an integration fails the build |

Call path, without exception:

```
Route handler / Server Action / Cron route
   │ authorize — write contexts (app.scope = 'mandant'): withTenant | withAnstellung | withSystemTenant
   │             read-only scopes: withGroupScope | withPersonScope | withKundeScope   ← invariant 3, K-02, K-18, AUT-04
   ▼ src/server/services/<domain>       — all arithmetic, all business rules       ← invariant 6
   │ (outbound content only) policy.ts  → Freigabe                                 ← invariant 7, §4
   ▼ src/server/integrations/<system>   — LiveAdapter | NotConnectedAdapter
   ▼ integration_aufruf (actor, duration, result, agent step)                      ← SEC-A9, AGT-04
```

**The `mandantId` argument of every port method has one legal provenance.** It is read from the
server session opened by `withTenant` / `withAnstellung` / `withSystemTenant` and never from a
request body, a query string or a path segment (invariant 3, K-02, TEN-04). The type system carries
this: `MandantId` is a branded string minted only by the session resolver, so a value taken from a
request body does not type-check as one.

**A port call therefore runs only in `mandant` scope.** K-18 gives `app.scope` four values, and
K-02 makes `app.mandant_id` NULL in all three multi-tenant scopes — `gruppe`, `person` and `kunde`.
There is consequently no `MandantId` to hand a port in any of them, and that is the correct
behaviour rather than a gap: `/portal/gruppe` is read-only by invariant 10, and `/portal/mein` and
`/portal/kunde` read **as a subject**, never as a manager. The employee portal's own writes
(EMP-07, EMP-10) re-enter `mandant` scope through `withAnstellung` with a single resolved tenant
before any port is reachable (K-18, `03-AUTH-BERECHTIGUNGEN.md` §7).

```ts
declare const mandantMarke: unique symbol;
export type MandantId = string & { readonly [mandantMarke]: 'MandantId' };
// minted only in src/server/auth/session.ts — never parsed from a request
```

**No write-side port call executes outside `mandant` scope.** Invariant 10 and TEN-05 make
`/portal/gruppe` read-only, and K-03 enforces it in Postgres because no `INSERT`/`UPDATE`/`DELETE`
policy anywhere references group scope; K-18 adds `person` and `kunde` scope, whose policies are
`for select` only for the same reason. The integration layer adds the matching first line: every
method that sends, publishes, exports or imports asserts `app.scope = 'mandant'` and
`app.readonly = 'off'` through `assertSchreibkontext()` before it does anything, and the assertion
is a required argument of the kernel's `ausfuehren()` wrapper rather than a convention each adapter
remembers. `MailerPort.sende`, `AccountingExportPort.erzeugeBuchungsstapel`,
`SocialChannelPort.veroeffentliche`, `JobBoardPort.veroeffentliche`, `BankStatementPort.importiere`
and `EInvoiceDeliveryPort.sende` are each covered by a test that calls them under `withGroupScope`,
`withPersonScope` and `withKundeScope` and expects a refusal in all three.

```
src/server/platform/
  storage/{buckets,signed-url,mime,exif}.ts     DOC-03, DOC-06, SEC-A6
  auth/                                          AUT-02, AUT-07 (server-side only)
  db/                                            the six roles of K-01

src/server/integrations/
  registry.ts        the single source of connection status the UI reads
  errors.ts          IntegrationError, IntegrationResult, NotConnectedError
  kernel/            types · not-connected · retry · breaker · audit · redact · health · gate
  openai/            llm · embeddings · vision · modell-register            AGT-*, ACC-05, D-04
  datev/             extf-writer (pure code, services/) · transfer          ACC-02, ACC-03, O-05
  e-rechnung/        zugferd-composer · xrechnung-validator · zustellung    FIN-11, FIN-12
  banking/           camt053-import                                         ACC-04
  lv/                gaeb-import                                            REQ-04, BAU-01
  vergabe/           oeffentlichevergabe/ · ted/                            RAD-01, RAD-02
  dwd/               open weather data                                      BAU-08
  feiertage/         Berlin holiday source                                  CLN-03
  sms/               worker login codes and check-in links                  EMP-01, TIM-07
  mail/              versand/ · postfach/                                   NOT-01, REC-03
  social/            cse-profil/ · instagram/ · facebook/ · linkedin/ · tiktok/ · youtube/   SOC-06
  jobboards/         one folder per board, all not connected                REC-09, D-02
  bewacherregister/  no public API — manual entry, status recorded          SEC-03
  payroll/           ACC-12 handover, not connected                         ACC-12
  monitoring/        error reporting · metrics · alerting                   SPEC §21
  backup/            independent dump target and restore drill              SEC-A10
  geo/               geocoding                                              OPS-01
  steuer/            VIES USt-IdNr. check — intra-Community only            §12.4
  n8n/               inbound webhook + service token                        SPEC §21
```

### 1.1 One reconciliation with `01-ORDNERSTRUKTUR.md` §11.2

That document says `nicht-verbunden.ts` "throws `NotConnectedError`". **This document narrows it:
port methods return a typed result and never throw across the port boundary** (§2), because a thrown
error can be caught by an unrelated `catch` upstream and turn a failed send into a silent success,
whereas an unread discriminated union does not compile under `strict`. `NotConnectedError` survives
for the one place a throw is correct: `index.ts` refusing to construct a **live** adapter whose Zod
config fails to parse. A half-configured live client must not exist; a not-connected adapter must not
throw. `01-ORDNERSTRUKTUR.md` §11.2 is to be corrected to this wording.

---

## 2. The kernel contract

```ts
export type IntegrationStatus =
  | { kind: 'verbunden';       seit: string }
  | { kind: 'verbindbar';      hinweis_schluessel: string }                    // public/local, no credentials
  | { kind: 'nicht_verbunden'; grund_schluessel: string; blockiert_durch?: string }
  | { kind: 'gestoert';        seit: string; letzter_fehler_code: IntegrationErrorCode }
  | { kind: 'deaktiviert';     grund_schluessel: string };

export type IntegrationErrorCode =
  | 'NOT_CONNECTED' | 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'FORBIDDEN'
  | 'RATE_LIMITED'  | 'TIMEOUT'        | 'UPSTREAM_UNAVAILABLE'
  | 'INVALID_RESPONSE' | 'SCHEMA_UNSUPPORTED'
  | 'ENCODING_UNMAPPABLE'   // DATEV Windows-1252 cannot represent a character
  | 'POLICY_BLOCKED'        // policy.ts refused — invariant 7, CRM-08 / LEG-08
  | 'READONLY_SCOPE'        // called in gruppe/person/kunde scope or a read-only session — invariant 10, K-02, K-18
  | 'MANDANT_MISMATCH'      // the Freigabe belongs to another mandant — invariant 3
  | 'BUDGET_EXCEEDED'       // AGT-05 hard stop
  | 'RESIDENCY_BLOCKED'     // no EU-approved model for this capability — D-04
  | 'DUPLICATE';            // quell_id / idempotency key already processed

export interface IntegrationError {
  code: IntegrationErrorCode;
  integration: IntegrationId;
  meldung_schluessel: string;                        // i18n key, e.g. 'integration.sms.nicht_verbunden'
  parameter?: Record<string, string | number>;       // interpolated in the UI layer
  detail?: unknown;                                  // logged only, never rendered
  blockiert_durch?: string;                          // the open question that blocks it
  retry_nach_ms?: number;
  wiederholbar: boolean;
}

export type IntegrationResult<T> =
  | { ok: true;  data: T; dauer_ms: number }
  | { ok: false; error: IntegrationError };

export interface IntegrationPort {
  readonly id: IntegrationId;
  status(): Promise<IntegrationResult<IntegrationStatus>>;
  healthcheck(): Promise<IntegrationResult<{ erreichbar: boolean; geprueft_am: string }>>;
}

// kernel/not-connected.ts — a Proxy, so a newly added port method can never
// silently fall through to undefined or reach a live call.
export function nichtVerbunden<T extends IntegrationPort>(
  id: IntegrationId, grundSchluessel: string, blockiertDurch?: string): T;
```

**Errors carry a key, not a sentence** (review B13). EMP-12 and SPEC §10 require worker-facing
screens in **de / en / ar / tr**, and the errors a worker actually meets are exactly these: SMS
login not connected (EMP-01), a check-in link that failed (TIM-07), an upload rejected for its real
MIME type (DOC-06). A German-only string baked into the kernel type is copied by every adapter and
is then unfixable without touching all of them. `meldung_schluessel` resolves against the
`de/en/ar/tr` catalogues in the UI layer; German is the fallback locale, never the only
representation. Admin-only surfaces resolve the same key against the German catalogue.

| NotConnectedAdapter rule | Reason |
|---|---|
| A **read** returns `NOT_CONNECTED`, never `[]` | An empty list renders as "no data" and is a lie. "Keine Bewerbungen" and "Postfach nicht verbunden" are different facts (SOC-07 generalised) |
| A **write/send** fails before any state change | No `social_post_ziel.status = 'veroeffentlicht'`, no `rechnung_versand` row, no mailbox marker, no `stelle_veroeffentlichung` success |
| It is the registry **default** | A live adapter exists only when its Zod config schema parses; a typo in an env name yields "nicht verbunden", never a half-configured client |
| It is never used to fake success in tests | Contract tests assert `ok === false` **and** that no row changed |

**Registry.** `getIntegration(id)` resolves once per runtime from env parsed by a Zod schema per
integration; the chosen adapter is written to the boot log and exposed by
`GET /api/verwaltung/integrationen` (`05-API-KARTE.md` §C.5) — **not** by the unauthenticated
liveness endpoint, which enumerates no providers (§23.1). Only the `platform/` substrate is
required to boot; every integration degrades to `nicht_verbunden` and the rest of the platform keeps
working. `INTEGRATION_FORCE_NOT_CONNECTED` forces adapters off in staging and e2e, so the
"not connected" path is exercised rather than assumed. **Per-mandant configuration lives in DB rows
keyed by `mandant_id`** (§3), never in env — that is what makes TEN-08 hold: a fifth business area is
a row, not a deployment.

**Audit.** Every call writes `integration_aufruf` (tenant) or `integration_aufruf_system`
(group-level), §3.5. **The cost of a model call is not stored here.** It lives once, in the agent
ledger of `02-datenmodell/06-RADAR-KI-INHALT.md` §1.12, in the **K-16(b)** unit: `*_mikrocent
bigint` (10⁻⁶ €) on `agent_schritt`, `agent_kosten`, `agent_reservierung` and `agent_budget`, which
is the one deviation K-16 permits and it is permitted **only** for agent cost and budget accounting.
`integration_aufruf` therefore carries no money column at all — it carries `agent_schritt_id`
(§3.5), so the operational log joins to the cost instead of restating it in a second unit. An
earlier draft's `kosten_cent` + `kosten_rest` pair is withdrawn for exactly the reason K-16(b)
names: rounding each step to a cent destroys the AGT-05 arithmetic, and a private second carry unit
is a deviation the convention does not list. Prices come from `agent_preisliste`
(`preis_*_je_mio_token_mikrocent bigint`), and the AGT-05 comparison is
`verbrauch_mikrocent + reserviert_mikrocent + neu_mikrocent > budget_cent * 10000` in exact
integers. **The single conversion to cents is half-up at the budget boundary, with the rounding rule
written beside the expression** (`agent_aufgabe.kosten_cent = div(Σ kosten_mikrocent + 5000, 10000)`);
nothing invoiced, booked or exported is micro-cents, so no `*_mikrocent` value ever reaches
`rechnung`, `buchungssatz` or a DATEV export. There is **no** `AI_BUDGET_MIKRO_EUR_MONAT`
environment variable; the cap is `agent_budget.budget_cent` per mandant and per agent, taken under
`SELECT … FOR UPDATE` by `app.agent_budget_pruefen`.

External logs get ids and codes only — no bodies, headers, tokens, addresses, phone numbers or
document contents (`kernel/redact.ts`). Full prompt and response text stays in `agent_schritt` inside
our own EU database.

**Reliability defaults**

| Port | Timeout | Auto-retry | Idempotency handle | Breaker |
|---|---|---|---|---|
| `platform.db` | 10 s statement | 1 (read only) | — | never (substrate) |
| `platform.storage` | 30 s read / 60 s write | 2 read, **0 write** | deterministic object key + sha256 | 10 / 5 min |
| `openai` | 60 s | 1 (429 / 5xx) | request id + `agent_reservierung` | 5 / 5 min |
| `mail.versand` | 15 s | 2 | `Idempotency-Key = freigabe_id` | 5 / 5 min |
| `mail.postfach` | 30 s | 2 | `message_id` | 10 / 30 min |
| `sms` | 10 s | 1 | `code_id` | 3 / 5 min |
| `vergabe.*` | 30 s | 3 | cursor + `quell_id` + `nutzlast_hash` | 10 / 30 min |
| `dwd` | 30 s | 2 | `(station_id, zeitpunkt)` | 10 / 60 min |
| `e-rechnung.zustellung` | 60 s | **0** | `rechnung_versand` row per attempt | 3 / 15 min |
| `social.*`, `jobboard.*` | 30 s | **0** | manual retry by a human | 3 / 15 min |
| `monitoring.fehler` | 5 s | 0, fire-and-forget | — | never blocks a request |
| local tools (EXTF writer, CAMT parser, ZUGFeRD composer, GAEB parser) | 120 s | 0 | file sha256 | — |

**Publishing and e-invoice delivery are never auto-retried.** A retried publish that actually
succeeded produces a duplicate post under a company brand; a retried invoice delivery produces a
duplicate legal document at a public buyer. Both surface in the approval inbox and a human retries.

---

## 3. Tables this layer owns, and their tenancy — invariant 3, K-01, K-03, K-16

The earlier draft named ten tables and stated the RLS of none of them. `datev_profil` holds a
Beraternummer, `social_channel` holds the key name of a publishing credential, `integration_aufruf`
holds per-mandant AI spend and correlation ids that lead straight to Vorgänge. Without an explicit
policy each of those is readable by any authenticated user of any of the four entities — the exact
cross-entity leak SEC-A3 calls the highest-priority test in the codebase.

### 3.1 Three buckets, and never a nullable `mandant_id`

| Bucket | Rule |
|---|---|
| **Tenant** | `mandant_id uuid not null references mandant(id)` (K-16), `ENABLE` **and** `FORCE ROW LEVEL SECURITY` (K-01), exactly the two policies of K-03 and the `p_intern_ceiling` restrictive policy of K-04 — the **registered shorthand** for the degenerate `p_ma_ceiling` / `p_kunde_ceiling` pair (`03-AUTH-BERECHTIGUNGEN.md` §8.5), never layered beside a keyed ceiling |
| **Reference** | global, no `mandant_id`, `SELECT` granted to `cse_app`, written by `cse_migrator` or `cse_job` only — the shape `02-datenmodell/06-RADAR-KI-INHALT.md` §1.5 already uses for `ausschreibung_rohdaten` and `agent_preisliste` |
| **System** | global, no `mandant_id`, readable only through a `SECURITY DEFINER` function that checks an internal right; never granted to `cse_app` directly |

**A nullable `mandant_id` is forbidden here, and the reason is mechanical.** In Postgres `NULL` is
distinct from `NULL`, so `UNIQUE (mandant_id, integration_schluessel)` would permit unlimited duplicate
"global" rows, and no RLS predicate of the form `mandant_id = app.aktiver_mandant()` can ever match
a `NULL` — the global row becomes simultaneously duplicable and invisible. Global integration state
therefore lives in its own table (§3.4), not in a nullable column.

**Which of K-16's four permitted deviations this layer takes: none of its own.** (a) LIST
partitioning does not arise here — no table in §3 is partitioned. (b) sub-cent accounting arises
only **by reference**: the `*_mikrocent` columns live in the agent ledger of
`02-datenmodell/06-RADAR-KI-INHALT.md` §1.12, and `integration_aufruf` joins to them rather than
holding a money column of its own (§3.5). (c) every duration in §3 is measured or configured, never
a computed target, so all of them are `integer` with the unit in the name. (d) applies to
`audit_log`, which this layer writes but does not own (§3.11): it earns its nullable tenant by
declaring `ebene enum('plattform','mandant')` with
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, so a NULL there is a stated
platform-level fact and not a missing value — and it is the **only** table in the platform shaped
that way. No table in §3 takes it. Everything else here is plain K-16.

### 3.2 `integration_katalog` — reference

The catalogue of every integration the platform knows about. One row per `IntegrationId`; the code
constant and the row are kept in step by a CI test.

**The key is `schluessel`, and `id` is a uuid, because K-16 admits no fourth key shape.** K-16's
common-column rule — `id uuid primary key default gen_random_uuid()` plus
`erstellt_am timestamptz not null default now()` on **every** table — has exactly four permitted
deviations (K-16 a–d) and "a readable text primary key on a reference table" is not one of them. The
readable value keeps its meaning as a `UNIQUE` business key instead, which is also what lets a child
row carry it verbatim.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | PK, `default gen_random_uuid()` — K-16 |
| `schluessel` | text | no | `UNIQUE`; the `IntegrationId` code constant, e.g. `datev.export`, `mail.versand`, `vergabe.ted` |
| `bezeichnung` | text | no | German label for the UI |
| `art` | integration_art | no | `tenant` \| `global` — which of §3.3 / §3.4 carries its state |
| `port` | text | no | the TypeScript port name, e.g. `AccountingExportPort` |
| `personenbezug` | boolean | no | receives personal data → §28 register row and a DPA required before the live adapter merges (`01-ORDNERSTRUKTUR.md` §11.4) |
| `erfordert_freigabe` | boolean | no | outbound; every method needs a `Freigabe` (§4) |
| `spec_ids` | text[] | no | the feature IDs it serves |
| `erstellt_am` · `geaendert_am` | timestamptz | no / yes | K-16 |

- **Indexes:** PK on `id`; `katalog_schluessel_uk UNIQUE (schluessel)`;
  **`katalog_art_uk UNIQUE (schluessel, art)`** — the target of the composite FK §3.3 uses, so the
  denormalised `art` there cannot drift from this row.
- **RLS:** reference bucket. `SELECT` to `cse_app`; DDL and rows by `cse_migrator`.
- **SPEC:** SOC-07, ACC-02, LEG-09.

### 3.3 `integration_konfiguration` — tenant

Per-mandant connection state and non-secret configuration. This is what makes TEN-08 true and what
the settings screen `/portal/[mandant]/einstellungen/integrationen` (`04-SEITENKARTE.md` §5.24)
renders.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | K-16 |
| `mandant_id` | uuid | **no** | K-16, invariant 3 |
| `integration_schluessel` | text | no | FK → `integration_katalog(schluessel)` |
| `art` | integration_art | no | denormalised from the catalogue and held there by the composite FK below — it exists so the constraint underneath needs no subquery |
| `aktiv` | boolean | no | default `false` |
| `verbindungs_status` | verbindungs_status | no | default `'nicht_verbunden'` — the enum already declared in `02-datenmodell/06-RADAR-KI-INHALT.md` §13 |
| `grund_schluessel` | text | yes | i18n key rendered while not connected |
| `blockiert_durch` | text | yes | the open question that blocks it |
| `konfig` | jsonb | no | default `'{}'` — **never a secret**: sender domain, base URL, station id, board slug |
| `credential_ref` | text | yes | Supabase Vault key name only (SEC-A5), the shape `social_channel`, `jobboard_kanal` and `postfach_kanal` already use |
| `letzter_erfolg_am` · `letzter_fehler_am` | timestamptz | yes | |
| `letzter_fehler_code` | text | yes | an `IntegrationErrorCode`, never a raw provider message |
| `zuletzt_geprueft_am` | timestamptz | yes | written by `integration-healthcheck` |
| `erstellt_am` · `geaendert_am` · `erstellt_von` · `geaendert_von` | — | | K-16 |

- **Indexes:** `ik_uk UNIQUE (mandant_id, integration_schluessel)`;
  `ik_status_idx (mandant_id, verbindungs_status)`; `UNIQUE (mandant_id, id)` (K-16, so a child may
  point a composite FK at this row).
- **RLS:** K-03 two-policy shape, module `system`, rights `system.einstellung_lesen` /
  `system.einstellung_verwalten`; K-04 `p_intern_ceiling` (a `mitarbeiter` or `kunde` login never
  reads it). The `integration-healthcheck` job writes `zuletzt_geprueft_am`, `letzter_erfolg_am`,
  `letzter_fehler_am` and `letzter_fehler_code` under a **`t_job`** policy (`to cse_job`,
  `03-AUTH-BERECHTIGUNGEN.md` §8.5) — a `GRANT` alone reaches no rows under FORCE RLS.
- **Constraints:** `FOREIGN KEY (integration_schluessel, art) REFERENCES integration_katalog
  (schluessel, art)`, then
  `CHECK (verbindungs_status <> 'verbunden' OR credential_ref IS NOT NULL OR art = 'global')` — an
  external channel cannot reach "connected" without stored credentials, the same constraint
  `social_channel` carries.
- **Why the constraint reads a column and not a table.** The earlier draft wrote the same rule as
  `... OR integration_id IN (SELECT id FROM integration_katalog WHERE art = 'global')`. PostgreSQL
  rejects that outright — *"cannot use subquery in check constraint"* — so the very first migration
  would have failed to apply. A `CHECK` may only see its own row, which leaves two lawful shapes: a
  denormalised column held true by a constraint, or a trigger. The composite FK above is the
  declarative one and needs no trigger: `art` cannot hold a value the catalogue does not agree with,
  and a catalogue row that changed `art` would have to be updated in both places or the FK refuses.
  The `jobboard_kanal` `CHECK` quoted in §21 needs none of this because it references only columns of
  its own row.
- **SPEC:** TEN-08, SOC-07, ACC-02, SEC-A5.

### 3.4 `integration_status_global` — system

State for integrations that are not tenant-scoped: `openai`, `dwd`, `vergabe.oev`, `vergabe.ted`,
`feiertage`, `steuer.vies`, `monitoring.*`, `backup.*`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | PK, `default gen_random_uuid()` — K-16 |
| `integration_schluessel` | text | no | `UNIQUE`, FK → `integration_katalog(schluessel)` — one row per global integration |
| `verbindungs_status` · `grund_schluessel` · `blockiert_durch` | — | | as §3.3 |
| `letzter_erfolg_am` · `letzter_fehler_am` · `letzter_fehler_code` · `zuletzt_geprueft_am` | — | | as §3.3 |
| `erstellt_am` · `geaendert_am` | timestamptz | no / yes | K-16 |

- **Indexes:** PK on `id`; `isg_uk UNIQUE (integration_schluessel)` — the row is one per
  integration, expressed as a `UNIQUE` rather than as a text primary key (K-16, §3.2).
- **RLS:** system bucket. Written by `cse_job`; read through `app.integration_status_global()`,
  `SECURITY DEFINER` owned by `cse_definer` with `SET search_path = pg_catalog, public` (K-01),
  which requires `app.portal() = 'intern'` and `system.einstellung_lesen` in **any** mandant of the
  caller. No grant to `cse_app`.

### 3.5 `integration_aufruf` (tenant) and `integration_aufruf_system` (system)

One row per outbound call. SEC-A9 requires actor, action, before, after, timestamp and IP for the
**audit** log; `integration_aufruf` is an **operational** log and is deliberately not that. It
records that a call happened and how it ended; the business change it caused is recorded by
`app.protokolliere(...)` in `audit_log` with its before/after images. Both are append-only.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | K-16 |
| `mandant_id` | uuid | **no** (tenant table only) | invariant 3 |
| `integration_schluessel` | text | no | FK → `integration_katalog(schluessel)` |
| `methode` | text | no | the port method, e.g. `veroeffentliche` |
| `akteur_art` | akteur_art | no | `mensch` \| `agent` \| `system` (SEC-A9, the enum owned by `02-datenmodell/01-KERN.md` §4) |
| `akteur_id` | uuid | yes | `benutzer.id`, or the agent id |
| `ip` | inet | yes | present when a human request triggered the call (SEC-A9) |
| `korrelation_id` | uuid | no | one Vorgang end to end |
| `freigabe_id` | uuid | yes | composite FK `(mandant_id, freigabe_id)`; **not null when `integration_katalog.erfordert_freigabe`** |
| `dauer_ms` | integer | no | K-16: a duration is an integer with its unit in the name |
| `ergebnis` | aufruf_ergebnis | no | `erfolg` \| `fehler` \| `nicht_verbunden` \| `blockiert` |
| `fehler_code` | text | yes | an `IntegrationErrorCode` |
| `agent_schritt_id` | uuid | yes | model calls only; composite FK `(mandant_id, agent_schritt_id)` → `agent_schritt` — **the cost of the call lives there, in `*_mikrocent` (K-16(b)), and is never restated here** |
| `token_ein` · `token_aus` | integer | yes | model calls only — token counts are quantities, not money |
| `erstellt_am` | timestamptz | no | default `now()` — K-16 names this column, and this table does not rename it |

- **Indexes:** `ia_verlauf_idx (mandant_id, erstellt_am DESC)` for the Agent Center activity list
  (AGT-01, AGT-04); `ia_korrelation_idx (korrelation_id)` to trace one Vorgang; `ia_integration_idx
  (integration_schluessel, erstellt_am DESC)` for the status screen; `ia_fehler_idx (mandant_id,
  erstellt_am DESC) WHERE ergebnis = 'fehler'` for the health rollup.
- **No money column, by K-16(b).** An earlier draft carried `kosten_cent` plus a `kosten_rest`
  remainder in millionths of a cent. K-16(b) permits sub-cent accounting **only** in
  `agent_schritt`, `agent_budget` and their carry columns, in the named unit `*_mikrocent` (10⁻⁶ €);
  a second carry unit on an operational log is a deviation the convention does not list, and
  rounding each model call to a whole cent here would report `0,00 €` for almost every one of them.
  The join through `agent_schritt_id` gives the status screen the same figure without a second
  source of truth (`02-datenmodell/06-RADAR-KI-INHALT.md` §1.12).
- **RLS:** K-03, module `system`, read right `system.protokoll_lesen`; `INSERT` by `cse_app` through
  `t_mandant` and by `cse_job` through **`t_job`** — under FORCE RLS a table `GRANT` is not a policy,
  so a job that writes a tenant table needs one of its own, and `t_job` is the fifth registered
  permissive class of `03-AUTH-BERECHTIGUNGEN.md` §8.5 (`to cse_job`, scoped to the mandant the job
  entered through `withSystemTenant`). **No `UPDATE` policy, no `DELETE` policy** for either role,
  plus the `BEFORE UPDATE OR DELETE` trigger of K-16 (invariant 8). K-04 `p_intern_ceiling`.
- **Retention:** rows carry `korrelation_id` into personal-data Vorgänge, so they are not kept
  forever. The window is resolved through
  `app.aufbewahrung_intervall(mandant_id, 'integration_aufruf')` — the same catalogue
  `dokument_aufbewahrung` uses — and is a **placeholder** until the deletion concept is signed off.
  **The mandant is an argument, not an ambient value** (`02-datenmodell/02-CRM-OPERATIONS.md` §4.7,
  which owns the function): the purge runs as `cse_job` in policies and `BEFORE INSERT` triggers
  where `app.aktiver_mandant()` is NULL, and the one-argument form would silently return NULL in
  exactly those contexts and retain forever. An earlier draft here wrote the one-argument form. `// TODO(client, O-126): Wie lange dürfen die Aufrufprotokolle der Integrationen
  (integration_aufruf) aufbewahrt werden, bevor sie automatisch gelöscht werden? (LEG-09; die
  Aufbewahrung der KI-Prompt-/Antwortsätze ist die Schwesterfrage in
  02-datenmodell/06-RADAR-KI-INHALT.md, die Dokumentkategorien sind O-25)`
- **`integration_aufruf_system`** is the same shape without `mandant_id`, `freigabe_id`,
  `agent_schritt_id` and `p_intern_ceiling`, for calls made outside any tenant: the radar ingests,
  the holiday sync, the DWD station index, VIES, the healthchecks. **No model call is recorded
  here** — a model call belongs to an `agent_aufgabe`, which is a tenant row, so a cost has a tenant
  by construction. It is written by `cse_job` and read through
  `app.integration_aufruf_system_lesen(...)` (§6.2).
- **SPEC:** SEC-A9, AGT-04, LEG-09.

### 3.6 `modell_register` — reference

The only place a model becomes callable (§8). Prices are **not** here: they live in
`agent_preisliste` (`02-datenmodell/06-RADAR-KI-INHALT.md` §3.5) and join on `modell`, so a price
change and a residency approval cannot drift apart in two tables.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | K-16 |
| `modell` | text | no | provider model identifier |
| `faehigkeit` | ki_faehigkeit | no | `chat_intern` · `entwurf_text` · `extraktion_dokument` · `extraktion_beleg` · `klassifikation` · `embedding` · `vision` |
| `eu_verarbeitung` | boolean | no | default `false` |
| `zero_retention` | boolean | no | default `false` |
| `freigegeben` | boolean | no | default `false` |
| `geprueft_am` · `geprueft_von` | timestamptz · uuid | yes | who verified the evidence, and when |
| `nachweis_url` | text | yes | the vendor document the verification rests on |
| `erstellt_am` · `geaendert_am` | — | | K-16 |

- **Indexes:** `mr_uk UNIQUE (modell, faehigkeit)`.
- **RLS:** reference bucket; `SELECT` to `cse_app`, write by `cse_migrator` or a `super_admin`
  route that audits.
- **Rule:** `aufrufbar := eu_verarbeitung AND zero_retention AND freigegeben`. Defaults are all
  `false`, so a model added by a careless migration is not callable.
- **SPEC:** D-04, AGT-*, LEG-09.

### 3.7 `job_plan` — reference — and the heartbeat that makes a missing run visible

`pg_cron` → `pg_net` is asynchronous and fire-and-forget, and `job_lauf` is written by the
*receiving* endpoint. If the POST never lands — a rotated `CRON_SECRET_<job>`, a cold-start timeout,
a deploy that removed the route — no `job_lauf` row exists, so there is no failed run to alert on and
the absence is silent. That silently disables `hashkette-pruefen`, the nightly invoice hash-chain
verification which is the strongest single GoBD control (FIN-06, LEG-01), and `bewerber-purge`, which
is a DSGVO deletion duty (REC-07, LEG-11).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | PK, `default gen_random_uuid()` — K-16 |
| `job` | text | no | `UNIQUE`; matches the `/api/cron/[job]` segment (`05-API-KARTE.md` §C.4) and joins `job_lauf.job` |
| `cron` | text | no | the schedule as registered in `pg_cron`, UTC |
| `erwartet_alle_min` | integer | no | the heartbeat window — a duration with its unit in the name (K-16) |
| `kritisch` | boolean | no | a missed run pages immediately rather than raising a task |
| `aktiv` | boolean | no | default `true` |
| `erstellt_am` · `geaendert_am` | timestamptz | no / yes | K-16 |

- **Indexes:** PK on `id`; `jp_job_uk UNIQUE (job)` — the readable key is a `UNIQUE` business key,
  not the primary key (K-16, §3.2).
- **Watchdog:** `/api/cron/job-heartbeat` compares `now()` against
  `max(job_lauf.beendet_am) WHERE ergebnis = 'erfolg'` per active job and raises an alert per overdue
  entry. The count is published on the **authenticated** `/api/verwaltung/integrationen`, not on the
  unauthenticated liveness endpoint (§23.1), and the heartbeat's own liveness is proven by a
  dead-man's switch: each successful run pings the external uptime monitor, and the monitor alerts
  when the ping stops. That is a push, so it survives the case an unauthenticated pull was meant to
  cover — the platform's own alerting being the thing that broke — without granting a session-less
  caller a table read (K-01, K-08). Until an uptime service is chosen (O-118) the ping target is
  `nicht verbunden` and the monitor is absent; nothing simulates it.
- **Auth:** every `/api/cron/*` request is authenticated with the **per-job** bearer
  `CRON_SECRET_<job>` compared in constant time (`05-API-KARTE.md` §B.5); a rejected call is recorded
  as a `job_lauf` row with `ergebnis = 'abgelehnt'` so a rotation mistake is visible instead of silent.
- **SPEC:** SPEC §14, SPEC §21, FIN-06, REC-07.

**`job_lauf` is not this document's table, and its shape is fixed by K-21.** It is declared **once**,
by `02-datenmodell/01-KERN.md`, as `id · job text · gestartet_am · beendet_am · ergebnis enum ·
kennzahlen jsonb · fehlertext`, with the index `(job, gestartet_am DESC)` the watchdog query above
needs. Four documents wrote it four different ways — `job_schluessel` / `job`, `begonnen_am` /
`gestartet_am`, `befund` / `kennzahlen`, `status` / `ergebnis` — and this section uses the canonical
spelling: `job`, `gestartet_am`, `beendet_am`, `ergebnis`.

**It carries no `mandant_id` at all** (K-21). It is a platform operations log, not tenant data, so
K-16(d) keeps `audit_log` as the only tenant-adjacent table in the platform with a nullable tenant
key — a nullable one here would create a second, and `mandant_id = app.aktiver_mandant()` can never
match a NULL, so the row would be simultaneously duplicable and invisible (§3.1). **The per-tenant
outcome of one run lives in `job_lauf_mandant`** (`job_lauf_id`, `mandant_id`, `ergebnis`,
`kennzahlen`), also declared by `02-datenmodell/01-KERN.md`. `job_plan` joins `job_lauf` on `job` and
never on a tenant; a per-tenant job — the `postfach` sweep, `bewerber-purge`, the monthly
`stundenkonto` close — writes one `job_lauf` row for the run and one `job_lauf_mandant` row per
mandant it touched.

### 3.8 `restore_protokoll` — system

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | K-16 |
| `erstellt_am` | timestamptz | no | default `now()` — K-16; the row is created when the drill is opened |
| `gestartet_am` · `beendet_am` | timestamptz | no / yes | duration is the difference of two UTC instants (invariant 2) — no stored `dauer_min` |
| `stand_der_sicherung` | timestamptz | no | which backup was restored |
| `sicherung_sha256` | text | no | verified on restore |
| `ergebnisse` | jsonb | no | one entry per acceptance check of §24 |
| `durchgefuehrt_von` | uuid | no | FK → `benutzer(id)` |
| `schluessel_verwendet_von` | uuid | no | FK → `benutzer(id)` — the key custodian who supplied the private half (§24) |
| `bestaetigt_am` · `bestaetigt_von` | timestamptz · uuid | yes | the sign-off |

- **RLS:** system bucket; read through `app.restore_protokoll_lesen(...)`, which requires
  `system.betrieb_lesen` and is on the register of §6.2. Append-only; `BEFORE UPDATE OR DELETE`
  raises except for the sign-off columns.
- **SPEC:** SEC-A10, LEG-01.

### 3.9 `mandant_mail_absender` — tenant

The sender identity §19.1 requires: each GmbH sends from its own verified domain, with its own DKIM,
SPF and DMARC, and a message for mandant X can never go out under mandant Y's sender. That is a
tenant fact, so it is a tenant table with the full K-03/K-04 treatment rather than a sentence in
prose or an environment variable — env cannot differ per mandant, and TEN-08 requires a fifth
business area to be a database row (§29).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | K-16 |
| `mandant_id` | uuid | **no** | K-16, invariant 3 |
| `absender_domain` | text | no | the verified domain, e.g. `cse-dienstleistungen.de` |
| `absender_adresse` | text | no | the envelope and header From, `CHECK` that it ends in `@` ‖ `absender_domain` |
| `anzeigename` | text | no | what a recipient sees |
| `antwort_an` | text | yes | Reply-To when it differs |
| `zweck` | mail_absender_zweck | no | `standard` \| `rechnung` \| `bewerbung` \| `mahnung` — one identity may serve several purposes; exactly one row per (mandant, purpose) |
| `verifiziert_am` | timestamptz | yes | when the provider confirmed domain ownership; `NULL` = unverified and unusable |
| `dkim_status` · `spf_status` · `dmarc_status` | dns_status | no | default `'unbekannt'`; written by the provider healthcheck, never by hand |
| `credential_ref` | text | yes | Supabase Vault key name of the provider's per-domain credential (SEC-A5) — **never the secret itself** |
| `erstellt_am` · `geaendert_am` · `erstellt_von` · `geaendert_von` | — | | K-16 |

- **Indexes:** `mma_zweck_uk UNIQUE (mandant_id, zweck)`; `mma_domain_uk UNIQUE (mandant_id,
  absender_domain)`; `UNIQUE (mandant_id, id)` (K-16).
- **RLS:** `ENABLE` **and** `FORCE ROW LEVEL SECURITY`; the two K-03 policies, module `system`,
  rights `system.einstellung_lesen` / `system.einstellung_verwalten`; K-04 `p_intern_ceiling`; and a
  **`t_job`** policy for the provider healthcheck that maintains `dkim_status` / `spf_status` /
  `dmarc_status` (`03-AUTH-BERECHTIGUNGEN.md` §8.5) — those three columns are never written by hand,
  and under FORCE RLS a job with a `GRANT` and no policy writes nothing.
- **Constraints:** `CHECK (verifiziert_am IS NOT NULL OR credential_ref IS NULL)` — an unverified
  domain holds no credential; `MailerPort.sende` refuses a mandant whose row is absent or
  unverified with `NOT_CONFIGURED`, and **never falls back to another mandant's sender**.
- **Deletion:** not a finance, time-tracking or audit table, so a row may be removed — but only when
  no `rechnung_versand` references it; the sender identity of a dispatched invoice is part of what
  the K-12 snapshot preserves, and the versand row keeps its own copy of the address.
- **SPEC:** NOT-01, NOT-02, FIN-15, TEN-08, SEC-A5, DESIGN §11.

### 3.10 `bewerbung_eingang` — the staging table an inbound application needs before it has a tenant

See §19.2. It lives in schema `bewerbung_intern`, **not exposed by PostgREST**, the same containment
K-06 uses for `zeit_intern.arbeitszeit_fenster`, because a pre-tenant row cannot be protected by a
K-03 policy.

**It is not a tenant table and has no tenant key.** `zugeordnet_mandant_id` records the outcome of a
human assignment (§19.2) and is never an RLS predicate, so it is not the nullable `mandant_id` that
K-16(d) reserves to `audit_log` alone — the nullable-tenant grep of §30 matches the column name
`mandant_id` exactly and therefore neither fires here nor is weakened to let it pass.

### 3.11 Tables owned by siblings, and what this section requires of them

| Table | Owner | Requirement from this section |
|---|---|---|
| `freigabe`, `freigabe_snapshot`, `freigabe_kette`, `freigabe_ansicht` | `02-datenmodell/06-RADAR-KI-INHALT.md` §4 | `mandant_id NOT NULL`, **`UNIQUE (mandant_id, id)`** (K-16 — `integration_aufruf.freigabe_id` is a composite FK and Postgres refuses one whose parent lacks the matching unique), RLS, immutable `vorschau_payload` + `payload_hash`, single-use consumption on the columns that exist (§4) |
| `agent_schritt`, `agent_aufgabe` | same, §3.9 | **`UNIQUE (mandant_id, id)`** for the composite FK from `integration_aufruf.agent_schritt_id`; the call cost stays in `*_mikrocent` there (K-16(b)) and is not copied into this layer |
| `agent_budget`, `agent_reservierung`, `agent_kosten`, `agent_preisliste` | same, §3.5–3.7 | the AGT-05 cap is DB state, never an env var; amounts in `*_mikrocent` (K-16(b)), converted to cents once, half-up, at the budget boundary |
| `social_channel`, `jobboard_kanal`, `postfach_kanal`, `stelle_veroeffentlichung`, `kanal_statistik` | same, §5.6 / §6.5 | `verbindungs_status` defaults to `nicht_verbunden`; `credential_ref` is a Vault key name; add `token_gueltig_bis` monitoring (§20) |
| `ausschreibung`, `ausschreibung_rohdaten`, `radar_ingest_lauf`, `vergabeplattform`, `mandant_plattform_registrierung` | same, §2 | head row + verbatim raw rows (§15); platform **registrations are per legal entity** and tenant-scoped |
| `rechnung`, `rechnung_dokument`, `rechnung_versand`, `nummernkreis` | `02-datenmodell/05-FINANZEN.md` §9.5–9.6 | delivery attempts are child rows (K-12); the validator result is **reported** on `rechnung_dokument.validierung_status` / `validierung_bericht` / `validierung_am`, never claimed (§10). The rendered artefact table is `rechnung_dokument` — this document previously called it `rechnung_xml`, a table no document declares. `rechnung_versand` already carries what §12.1 needs: `kanal` (the CRM `uebertragungsweg` enum, not a second vocabulary), `externe_id` for the portal's Vorgang id, and `fehlertext` for a rejection |
| `datev_export`, `konto_mapping`, `datev_profil` | `02-datenmodell/05-FINANZEN.md` | `UNIQUE (mandant_id, von, bis, lauf_nr)` plus a partial unique on the authoritative run, so a legitimate re-export is possible (§9) |
| `kontoauszug`, `bankbuchung`, `zahlungsvorschlag` | `02-datenmodell/05-FINANZEN.md` | the entry key of §13 — `UNIQUE (kontoauszug_id, lfd_nr)`, never `Ntry/NtryRef` |
| `kunde_bauleistender_status`, `freistellungsbescheinigung` | `02-datenmodell/02-CRM-OPERATIONS.md` §4.1 | §13b and §48 EStG are decided from **dated evidence at the service date**, never from a VIES lookup (§12.4) |
| `kunde` | `02-datenmodell/02-CRM-OPERATIONS.md` §2 | the delivery route is the **existing** `kunde.uebertragungsweg` (`peppol · zre · ozg_re · email · kundenportal · post`) together with `leitweg_id`, `kaeufer_referenz`, `elektronische_adresse`, `rechnungsformat`, `ist_oeffentlicher_auftraggeber` and `xrechnung_pflicht` — this layer mints **no** parallel route enum (§12.1). Required of that document: a buyer with `xrechnung_pflicht` and no `uebertragungsweg` **blocks** FIN-11 dispatch instead of defaulting; and if any buyer turns out to need a Landesportal, the value is added to `uebertragungsweg` there (O-22), never to a second enum here |
| `dokument`, `dokument_version`, `dokument_aufbewahrung` | `02-datenmodell/02-CRM-OPERATIONS.md` §4.7 | one private-bucket contract, one retention catalogue; DOC-05 versions are `dokument_version` rows with their own object key (§6) |
| `wetter_station`, `wetter_beobachtung`, `bautagebuch.wetter_snapshot` | `02-datenmodell/03-GEWERKE.md` §7.16–7.17 | the DWD port writes observations; the diary keeps the snapshot (§16) |
| `feiertag` | `02-datenmodell/03-GEWERKE.md` §7 (global reference) | needs the proposal states of §17 |
| `job_lauf` | `02-datenmodell/01-KERN.md` (**K-21**) | declared **once**, there: `id · job text · gestartet_am · beendet_am · ergebnis enum · kennzahlen jsonb · fehlertext`, index `(job, gestartet_am DESC)`, **no `mandant_id`**. `ergebnis` must include `abgelehnt` (§3.7 auth); `job_plan` joins on `job`. This document redeclares nothing and uses those spellings verbatim |
| `job_lauf_mandant` | `02-datenmodell/01-KERN.md` (**K-21**) | the per-tenant outcome of one run — `job_lauf_id`, `mandant_id`, `ergebnis`, `kennzahlen`. It exists so `job_lauf` needs no nullable tenant key, which K-16(d) reserves to `audit_log` alone (§3.7) |
| `mandant_einstellung` | `02-datenmodell/01-KERN.md` (**K-21**) | `id, mandant_id, schluessel, wert jsonb`, `UNIQUE (mandant_id, schluessel)`. It carries the O-06 monitoring switches, which are **settings keys and not `mandant` columns** (§26) |
| `nachweis_art`, `sicherheitsvorfall` | `02-datenmodell/01-KERN.md` (**K-21**) | referenced only: `nachweis_art` is the certificate-type catalogue behind DOC/SEC surfaces, `sicherheitsvorfall` records the SEC-A9 events an adapter or the agent kernel may raise. This layer declares neither |
| `loeschprotokoll` | `02-datenmodell/01-KERN.md` (**K-21**) | referenced by §19.2 and by `05-API-KARTE.md` §C.5, declared nowhere today — 01-KERN declares it: one append-only row per deleted subject and category, `mandant_id NOT NULL` where the subject had a tenant, no hard delete (invariant 8). A deletion with no tenant to record goes to `audit_log` at `ebene = 'plattform'` instead (K-16(d)) |
| `steuersatz_gruppe` | `02-datenmodell/05-FINANZEN.md` (**K-21**) | **there is no `steuersatz` table**; every reference is `*.steuersatz_gruppe_id`. The tax lines of the K-12 invoice payload this layer serialises to XRechnung and ZUGFeRD (§10, §11) come from it |
| `rechnung_beziehung` | `02-datenmodell/05-FINANZEN.md` (**K-21**) | K-12's name and columns win over `storno_verweis`; a Storno correcting a delivered e-invoice is a new invoice plus a `rechnung_beziehung` row, never an edit (§12.1) |
| `audit_log` | `02-datenmodell/01-KERN.md` | every gate decision, every mandant switch, every `entgelt_lesen`, every ArbZG aggregate read, and every call on the definer register of §6.2. The platform-level ones — an `integration_status_global` read, a `bewerbung_eingang` listing — are written with `ebene = 'plattform'` and `mandant_id NULL` under **K-16(d)**, which is the one nullable tenant key in the platform and needs the `CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))` to stay a stated fact rather than a missing value |

---

## 4. The outbound gate — invariant 7, AGT-03, APR-07, CRM-08 / LEG-08

Every send — mail, SMS, social post, job advert, e-invoice delivery — passes one gate, and the gate
is a **type**, not a convention.

```ts
declare const marke: unique symbol;

/** Constructed only by src/server/agent/policy.ts.
 *  Every field is a column of `freigabe` / `freigabe_snapshot` as
 *  02-datenmodell/06-RADAR-KI-INHALT.md §4.2 and §4.7 define them — this type invents none. */
export interface Freigabe {
  readonly [marke]: 'Freigabe';
  id: string;                 // freigabe.id
  mandant_id: MandantId;      // the entity the approval was given in — invariant 3
  vorgang_typ: string;        // freigabe.vorgang_typ
  payload_hash: string;       // freigabe.payload_hash — sha256 of exactly what was approved (APR-07)
  erteilt_von: string;        // freigabe_snapshot.entschieden_von, or 'richtlinie:<id>' for a system message
  erteilt_am: string;         // freigabe_snapshot.entschieden_am
  frist: string | null;       // freigabe.frist — the deadline, and NULL when there is none
}

export type Entscheidung =
  | { art: 'erlaubt';                freigabe: Freigabe }
  | { art: 'freigabe_erforderlich';  freigabe_id: string; grund_schluessel: string }
  | { art: 'blockiert';              grund_schluessel: string; regel: string };

export function pruefe(v: Vorgang): Promise<Entscheidung>;
```

**The token carries its mandant, and the adapter asserts it.** Without `mandant_id` the branded type
is satisfied by any approval from any entity: an approval given for a REALTIME offer would release an
SSE Security email, breaking invariants 3, 7 and 10 at once. Every send adapter begins with

```ts
if (freigabe.mandant_id !== ctx.mandantId) return err('MANDANT_MISMATCH', id);
```

and the same equality is re-checked in SQL when the row is consumed, because the service check is the
first line and the database is the second (K-03).

**The `freigabe` table already exists** — `02-datenmodell/06-RADAR-KI-INHALT.md` §4.2, in the shape
K-13 fixes — with `mandant_id`, RLS, `vorschau_payload jsonb` (the payload itself, preserved, not
merely hashed), `payload_hash`, `richtlinie_id`, the execution columns and the chained, immutable
`freigabe_snapshot` whose `kette_nr` is assigned under `SELECT … FOR UPDATE` on `freigabe_kette`.
This document therefore does **not** define a second approval table; it states what the integration
layer requires of that one.

**And it consumes the columns that table has, not columns it wishes it had.** An earlier draft wrote
the single-use update against `verbraucht_am`, `verbraucht_durch` and `gueltig_bis`; none of the
three exists in §4.2, so the statement would have failed at migration time — or, worse, invited
someone to add three columns that duplicate `ausfuehrung_status`, `ausgefuehrt_am` and `frist` and
then disagree with them. The execution state machine is already there and already immutable in the
directions that matter: `ausfuehrung_status ∈ (offen, laeuft, ausgefuehrt, fehlgeschlagen,
zurueckgenommen)`, and `offen → laeuft` under a conditional `UPDATE` **is** the K-09 single-use
claim. The APR-05 delayed release arrives as `status = 'automatisch_freigegeben'`, which is why the
predicate accepts it beside `'genehmigt'` — dropping it would silently discard every approval that
elapsed rather than being clicked.

| Rule | Enforcement |
|---|---|
| Branded token | a send adapter that does not receive a `Freigabe` **does not compile** — and no send method may declare it optional (see below) |
| Tenant binding | `freigabe.mandant_id = app.aktiver_mandant()`, checked in TypeScript and again in SQL |
| Runtime re-check | the row exists, is approved, is not yet executed, is within its deadline, and its `payload_hash` matches the payload about to be sent — otherwise `POLICY_BLOCKED` |
| **Single use is a conditional write** (K-09) | `update freigabe set ausfuehrung_status = 'laeuft', ausgefuehrt_am = now() where id = $id and mandant_id = app.aktiver_mandant() and status in ('genehmigt','automatisch_freigegeben') and ausfuehrung_status = 'offen' and (frist is null or now() <= frist) returning vorgang_typ, payload_hash;` — **zero rows returned is the refusal**. The send and the `integration_aufruf` row are written in the same transaction, only if a row came back, and the same transaction closes the row with `ausfuehrung_status = 'ausgefuehrt'` or `'fehlgeschlagen'` |
| Retry | reuses the transport `Idempotency-Key`, never a second approval |
| Rules are data | `agent_richtlinie`, editable in the UI without code (AGT-03) |
| Legal basis | outbound to a contact whose `rechtsgrundlage` is `keine` is **blocked with no UI override** (CRM-08, LEG-08, D-01) |
| Value | any offer is a proposal at any value; > €20 000 explicitly never automatic (SPEC §17 autonomy matrix) |
| Review duration | APR-08 is measured server-side from `freigabe_ansicht`, never from a client timestamp (K-13) |
| Audit | every decision, approved or blocked, in `audit_log` with `akteur_art ∈ {mensch, agent, system}` (SEC-A9) |

### 4.1 What the snapshot must cover, per channel

An approval binds a payload. If it binds too little, the approved thing and the sent thing differ.

| Channel | `payload_hash` covers |
|---|---|
| `MailerPort.sende` | mandant, **every recipient address** (to/cc/bcc), sender identity, subject, body, and the **sha256 of every attachment** — an approval that does not bind the recipients permits an approved invoice PDF to be released to a different address |
| `SmsPort.sende` | recipient number, purpose, rendered template id and parameters |
| `SocialChannelPort.veroeffentliche` | text, hashtags, media ids **and** the target channel list (SOC-08) |
| `JobBoardPort.veroeffentliche` / `aktualisiere` / `zurueckziehen` | board, `stelle` version, full advert text |
| `EInvoiceDeliveryPort.sende` | `rechnung_id`, Leitweg-ID, route, sha256 of the XML |

### 4.2 No optional gate, anywhere

The guarantee is "a send adapter that does not receive a `Freigabe` does not compile". An optional
field compiles without one, which downgrades the rule to a convention — the exact failure the branded
token exists to prevent. Two signatures in the earlier draft did this and are corrected:

```ts
// Alerting is split, because an internal alert is not a send.
export interface AlertPort {
  alarmiereIntern(a: { schluessel: string; schwere: Schwere; text_schluessel: string }): Promise<IntegrationResult<void>>;
  alarmiereExtern(a: { schluessel: string; schwere: Schwere; text_schluessel: string;
                       freigabe: Freigabe }): Promise<IntegrationResult<void>>;
}

// Updating or withdrawing a live advert is an externally visible act under a company brand.
export interface JobBoardPort extends IntegrationPort {
  veroeffentliche(a: { mandantId: MandantId; stelle: Stelle; freigabe: Freigabe }): Promise<IntegrationResult<Veroeffentlichung>>;
  aktualisiere (a: { mandantId: MandantId; externId: string; stelle: Stelle; freigabe: Freigabe }): Promise<IntegrationResult<Veroeffentlichung>>;
  zurueckziehen(a: { mandantId: MandantId; externId: string; freigabe: Freigabe }): Promise<IntegrationResult<void>>;
  status(a: { mandantId: MandantId; externId: string }): Promise<IntegrationResult<VeroeffentlichungStatus>>;
}
```

**CI gate:** a test walks the exported types of `src/server/integrations/**` and fails when any
method whose name is in the send set (`sende`, `veroeffentliche`, `aktualisiere`, `zurueckziehen`,
`uebertrage`, `alarmiereExtern`) declares `freigabe` as optional or omits it.

### 4.3 System messages — pre-approved by a seeded rule, never ungated

A login code cannot wait for a human, and a gate that requires one for it is not a safeguard but an
outage: no worker can log in at all (EMP-01, AUT-07). The gate therefore distinguishes a
`systemnachricht` — **deterministic template, no free text, no AI-generated content, addressed to a
principal already in the system, triggered by that principal's own action or by a system event the
platform itself detected** — from everything else.

**A `systemnachricht` is pre-approved, not ungated, and the distinction is the whole mechanism.**
`freigabe` stays a required, non-optional argument of every send method (§4.2, and the CI gate that
enforces it does not change); what changes is who mints it. `src/server/agent/policy.ts` mints the
`Freigabe` from a **seeded, visible, versioned, audited `agent_richtlinie`** and stamps
`erteilt_von = 'richtlinie:<id>'` — the field the branded type already carries (§4) precisely so a
rule-granted approval is distinguishable from a human-clicked one in `audit_log` and in the approval
history. The human approval happened when a human configured the rule. The gate is still traversed,
the payload hash is still bound (§4.1), the single-use conditional write of K-09 still applies, and
`integration_aufruf` is still written. Nothing is exempt from the gate; one category simply does not
wait at it.

**The pre-approved set is closed, and it is the same list `05-API-KARTE.md` R-09 already names**, so
that an implementer following either document ships the same platform:

| Pre-approved (`systemnachricht`) | Why it cannot wait |
|---|---|
| EMP-01 login code (SMS) · TIM-07 check-in link | the recipient asked for it seconds ago; a queued approval is a failed login (AUT-07) |
| password recovery | same, and AUT-07's lockout counters assume the code arrives |
| notification digests NOT-01 / NOT-02 | scheduled, per-recipient, contains only what that recipient may already read |
| lead-owner alert (REQ-05, REQ-06) | an SLA escalation whose whole value is latency |
| watchdog and operations alerts (§23.2) | an alert that needs a human to release it cannot report that the humans' own tooling is down |
| acknowledgement of an application (REC-03) | a fixed template with no assessment in it, sent to the applicant who just wrote |

**Everything else stays `freigabe_erforderlich`, and the boundary is stated so it cannot drift:**
anything AI-drafted, anything externally visible under a company brand (social, job boards), anything
to a customer or a public buyer (offer, invoice, dunning, e-invoice delivery), and anything whose
recipient did not initiate it. Outbound to a contact whose `rechtsgrundlage` is `keine` remains
blocked outright with no override (CRM-08, LEG-08, D-01) — a `systemnachricht` category never
launders that rule, because every one of the six rows above is addressed to a principal with a
recorded relationship.

An earlier draft shipped this carve-out **disabled** pending the question below, reasoning that an
unanswered question must not ship as a live exception to an invariant. That was the wrong direction
of fail-closed and it is corrected here: disabling it does not make the platform safer, it makes
EMP-01, the check-in link, password recovery and the NOT-01 digest unsendable, so the login screen
asks for a phone number and nothing ever arrives — a silent, total failure of the worker portal
discovered in Phase 5. The safe default is the **narrow, enumerated, audited** set above; O-125 asks
whether the client wants any row **removed** from it, not whether it may exist.

`// TODO(client, O-125): Systemnachrichten (Anmelde-Code, Check-in-Link, Passwort-Wiederherstellung, Benachrichtigungs-Digest, Lead-Eskalation, Betriebsalarm, Eingangsbestätigung einer Bewerbung) werden über eine sichtbare, versionierte Richtlinie vorab freigegeben — jede einzelne bleibt protokolliert. Soll eine dieser Kategorien stattdessen einzeln freigegeben werden? (invariant 7, AGT-03, AUT-07)`

---

## 5. Register — status today

**Verbunden** = live credentials configured and verified · **Verbindbar** = public or local, nothing
to obtain · **Nicht verbunden** = credentials or a client decision missing, NotConnectedAdapter
active · **Blockiert** = a named open question blocks it. The repository contains no environment
configuration and no provisioned project, so **nothing is `Verbunden` today**.

`Blockiert` is a **rendering** of `nicht_verbunden` with `blockiert_durch` set — it is deliberately
not a sixth `IntegrationStatus.kind`, so the TypeScript union and the UI vocabulary stay in step.

| Integration | Port | Status today | Blocked by | SPEC |
|---|---|---|---|---|
| Supabase Postgres / Auth / Storage | `platform/` — no port, no not-connected state | **not yet provisioned; the application does not boot without it** | O-11 | TEN-03, AUT-*, DOC-03 |
| Supabase cron (`pg_cron` + `pg_net`) | `SchedulerPort` | Nicht verbunden (no project) | O-11 | SPEC §14, §21 |
| Vercel | hosting — no port | not yet provisioned | O-11 | PUB-10, D-04 |
| OpenAI | `LlmPort` `EmbeddingPort` `VisionPort` | Nicht verbunden | O-121 (EU per model) | AGT-*, ACC-05 |
| DATEV EXTF file export | `AccountingExportPort` | **Blockiert** | **O-05** | ACC-02, ACC-03 |
| DATEV online transfer | `AccountingTransferPort` | Nicht verbunden — never simulated | O-05 + credentials | ACC-02 |
| XRechnung field validator (our code) | — | Verbindbar (pure code) | — | FIN-04, FIN-05, FIN-11 |
| KoSIT validator (optional runtime sidecar) | `EInvoiceValidatorPort` | Verbindbar in **CI**; runtime sidecar Nicht verbunden — it serves only the asynchronous post-finalisation report of §10 step 3, and no production path depends on it (§31) | — | FIN-11 |
| ZUGFeRD / PDF/A-3 composer | `ZugferdComposerPort` | Verbindbar (local) | — | FIN-12 |
| XRechnung delivery (OZG-RE / ZRE / Peppol) | `EInvoiceDeliveryPort` | **Nicht verbunden** | **O-22** | FIN-11 |
| Banking CAMT.053 | `BankStatementPort` | Verbindbar (file import) | O-120 (delivery route) | ACC-04 |
| LV / GAEB import | `LvImportPort` | Nicht verbunden | **O-97** | REQ-04, BAU-01, AGT-02 |
| oeffentlichevergabe.de OCDS | `TenderSourcePort` | Verbindbar (public) | — | RAD-01, RAD-03 |
| TED Search API v3 | `TenderSourcePort` | Verbindbar (public) | — | RAD-02, RAD-03 |
| DWD Open Data | `WeatherPort` | Verbindbar (public) | — | BAU-08 |
| Berlin public holidays | `HolidayPort` | Verbindbar (offline computation + cross-check) | — | CLN-02, CLN-03 |
| SMS | `SmsPort` | Nicht verbunden | **O-82** | EMP-01, TIM-07, AUT-07 |
| Transactional mail | `MailerPort` | Nicht verbunden | **O-116** | NOT-01, NOT-02, FIN-15 |
| Application mailbox | `MailboxPort` | Nicht verbunden | **O-28** | REC-03, REC-07 |
| Customer inbound mail | `MailboxPort` (`zweck = 'kunde'`) | Nicht verbunden | **O-131** | CRM-03, NOT-01 |
| CSE profile channel (own website) | `SocialChannelPort` | **Verbindbar (internal)** | — | SOC-05, PRO-04 |
| Instagram · Facebook · LinkedIn · TikTok · YouTube | `SocialChannelPort` | Nicht verbunden (all five) | **O-10** + legal review | SOC-06, SOC-07 |
| Job boards | `JobBoardPort` | Nicht verbunden | **O-10** | REC-09, D-02 |
| n8n | inbound webhook + service token | Nicht verbunden | **O-123** | SPEC §21 |
| Error tracking | `ErrorReporterPort` | Verbindbar — the stdout adapter is real | O-118 (external) | SPEC §21 |
| Uptime probe of `/api/health` | external | Nicht verbunden | O-118 | SPEC §21 |
| Backups + restore drill | `BackupPort` | Nicht verbunden | **O-119** | SEC-A10, LEG-01 |
| Geocoding | `GeocodingPort` | Nicht verbunden | **O-122** | OPS-01, BAU-08 |
| VIES USt-IdNr. check | `VatIdPort` | Verbindbar (public, EU) | — | §14 UStG plausibility, intra-Community only |
| Payroll handover | `PayrollExportPort` | Nicht verbunden | **O-27** | ACC-12 |
| Bewacherregister | none — manual by design | not an integration | — | SEC-03, SEC-04 |

---

## 6. Supabase — the substrate — D-04, TEN-03, DOC-03, AUT-*

One project per environment (`prod`, `staging`, `dev`), **each EU (Frankfurt)**, each with its own
credentials; staging never holds production credentials or production personal data. Postgres and
Auth are the substrate and have **no NotConnectedAdapter**: a platform without its database is not
degraded, it is down, and the register above says "not yet provisioned; the application does not
boot" rather than "nicht verbunden". Storage does have a degraded path only in the sense that a
failed upload must never look like a stored document — the object write fails and **no `dokument`
row is created**.

| | |
|---|---|
| **`AuthPort`** | `signInWithPassword` · `startPhoneOtp` · `verifyPhoneOtp` · `enrollMfa` · `verifyMfa` · `requireMfa(rolle)` · `getSession(request)` · `setActiveMandant` · `signOut(alleGeraete?)` · `sendRecoveryLink` |
| **`StoragePort`** | `erstelleUploadUrl` · `bestaetige` · `erstelleSignedUrl` · `lies` · `kopiere` · `liste` · `loesche(pfad, grund)` |
| **`SchedulerPort`** | `plane(job, cron)` · `starte(job, korrelationId)` · `laeufe(job)` |
| **Credentials** | `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_DB_URL_APP` (as `cse_app`) · `SUPABASE_DB_URL_JOB` (as `cse_job`) · `SUPABASE_DB_URL_DIRECT` (migrations, as `cse_migrator`) · `SUPABASE_SERVICE_ROLE_KEY` (§6.1) |
| **EU / DPA** | project created in EU Central (Frankfurt); DPA offered by the vendor — **status: pending, nothing on file** |
| **Failure** | DB unreachable → maintenance page, **no queued writes**; statement timeout 10 s → rolled back, writes never retried; storage write failure → `UPSTREAM_UNAVAILABLE` and no document row; signed-URL failure → "Dokument derzeit nicht abrufbar", never a public path |

### 6.1 The service-role key is not a data path — K-01

The earlier draft confined "service-role access" to `src/server/jobs/**`. That is still too wide: the
service role bypasses RLS, and **K-01 states that no application role holds `BYPASSRLS`**. The
corrected rule:

- All table access — requests **and** cron jobs — goes through the six named roles of K-01.
  `cse_app` for requests, `cse_job` for scheduled work with per-job grants enumerated in the job
  definition, `cse_anon` and `cse_checkin` for the **five** functions on K-08's closed register
  (`sitzung_aufloesen`, `versuch_protokollieren`, `checkin_verbrauchen`, `offline_ereignis_annehmen`,
  `ical_feed_lesen`) and for nothing else.
- `SUPABASE_SERVICE_ROLE_KEY` is used **only** by `src/server/platform/` for Storage
  administration and the Auth admin API, and never for SQL against a tenant table.
- **CI gate:** a grep fails the build when `SUPABASE_SERVICE_ROLE_KEY` is referenced outside
  `src/server/platform/**`, and a migration test asserts that no role in `pg_roles` used by the
  application has `rolbypassrls`.
- `ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant table (K-01), so a migration-owned
  connection does not silently see everything.

### 6.2 Tenancy, the four scopes, and the closed register of sanctioned crossings

`withTenant(mandantId, fn)` sets the transaction-local GUCs of K-02 (`set_config(..., true)`) and runs
as `cse_app`, so every K-03 policy applies. **K-18 gives `app.scope` four values**, and this layer
uses all four:

| Helper | `app.scope` | `app.mandant_id` | Row visibility | Writes |
|---|---|---|---|---|
| `withTenant(mandantId, fn)` | `mandant` | the one mandant | K-03 `t_mandant` + `hat_recht` | yes |
| `withAnstellung(anstellungId, fn)` | `mandant` | resolved **from the employment** | as above, under the K-04 `mitarbeiter` ceiling | the worker's own on-site acts (EMP-07, EMP-10) |
| `withSystemTenant(mandantId, 'job:<name>')` | `mandant` | the one mandant | as above, as `cse_job` | per-job grants only |
| `withGroupScope()` | `gruppe` | **NULL** | `= any(sichtbare_mandanten())` + `gruppe.<modul>.lesen` | **never** (invariant 10) |
| `withPersonScope(ctx, fn)` | `person` | **NULL** | `= any(sichtbare_mandanten())` + the row belongs to `app.aktuelle_person()` | **never** in this scope — EMP-07 and EMP-10 writes re-enter `mandant` scope through `withAnstellung` |
| `withKundeScope(ctx, fn)` | `kunde` | **NULL** | `= any(sichtbare_mandanten())` + `kunde_id = any (app.aktuelle_kunden())` | **never** in this scope — any write O-74 authorises re-enters `mandant` scope (`withKundenVorgang`) |

`app.mandant_ids` is derived server-side in every multi-tenant scope — from `benutzer_mandant`, from
`anstellung`, or from the customer's own `auftrag` / `angebot` / `rechnung` rows — and never from the
request (K-02, K-18). Fail-closed: an unset GUC coalesces to no mandant, no rights, read-only (K-02).
Cross-tenant reads return **404, not 403** (AUT-06, K-02). Every mandant switch is audited (TEN-09).

**The two accessors this layer depends on resolve in all four scopes — K-20.** An accessor that
reads `app.aktiver_mandant()` is NULL in the three multi-tenant scopes by construction, so any
predicate on it is false and the surface reads zero rows: the K-18 failure, one layer down and
without an error to notice. `03-AUTH-BERECHTIGUNGEN.md` §8.4 holds the full accessor table and
`tests/invariants/accessor-scopes.test.ts` enumerates it; the two values this document's own
functions and policies are written against are:

| Accessor | `mandant` | `gruppe` | `person` | `kunde` |
|---|---|---|---|---|
| `app.portal()` | the active membership's `rolle.portal` | **bound at entry — `intern`** | **bound at entry — `mitarbeiter`** | **bound at entry — `kunde`** |
| `app.aktuelle_kunden()` | the login's binding in the active mandant | `{}` | `{}` | **the whole `kunde_zugang` binding set** |

`app.portal()` is **bound when the scope is entered and never recomputed from `aktiver_mandant`**
(K-04, K-20). Recomputing it there falls through to the fail-closed `'mitarbeiter'`, which fires
every K-04 employee ceiling inside the group view — a `leitung` reads nothing in `/portal/gruppe` —
and ceilings every customer as though they were staff. It matters here concretely:
`app.integration_status_global()` and `app.integration_aufruf_system_lesen(...)` below both require
`app.portal() = 'intern'`, and the group-scope operations overview would otherwise be blank for the
management it exists for.

`app.aktuelle_kunden()` resolves from the session's `kunde_zugang` binding, **never through
`app.aktiver_mandant()`**, and it is an **array**: one company served by `reinigung` and by
`security` is two `kunde` rows (CRM-06). Every customer-facing predicate this layer references
therefore reads `kunde_id = any (app.aktuelle_kunden())`; the scalar `app.aktueller_kunde()` is
documented NULL in `kunde` scope and no policy reachable from there may name it (K-20).

**Every read that leaves the active tenant is on the register below, and nothing else is.** An
earlier draft said "there are exactly two places", which its own definer functions had already
outgrown — a count is not a control. The register is closed: a `SECURITY DEFINER` function in this
layer that is not listed here is a defect, every entry is owned by `cse_definer`, carries
`SET search_path = pg_catalog, public` (K-01), checks its precondition **inside** the function
rather than trusting the caller, and writes `audit_log`. It does not touch K-08, which governs the
**pre-session** path and stays exactly five functions long.

| Function | Runs as | Caller | Precondition, checked inside | `audit_log` action |
|---|---|---|---|---|
| `app.arbzg_belastung(p_person, p_von, p_bis)` | `cse_definer` | `services/arbzg/` only | `app.person_sichtbar(p_person)` **and** `dienstplan.arbzg_pruefen` in the active mandant | `arbzg.aggregat_gelesen` |
| `app.arbzg_befund_schreiben(...)` | `cse_definer` | `services/arbzg/` only | the caller was entitled to the person in the active mandant | `arbzg.befund_geschrieben` |
| `app.integration_status_global()` | `cse_definer` | `services/integrationen/` | `app.portal() = 'intern'` **and** `system.einstellung_lesen` in any mandant of the caller | `integration.status_global_gelesen` |
| `app.integration_aufruf_system_lesen(...)` | `cse_definer` | `services/integrationen/` | as above, plus `system.protokoll_lesen` | `integration.systemprotokoll_gelesen` |
| `app.restore_protokoll_lesen(...)` | `cse_definer` | `services/betrieb/` | `system.betrieb_lesen` in any mandant of the caller | `betrieb.restore_protokoll_gelesen` |
| `app.bewerbung_eingang_liste()` | `cse_definer` | `services/recruiting/` | `recruiting.bewerbung_lesen` in at least one mandant | `recruiting.eingang_gelesen` |
| `app.bewerbung_zuordnen(eingang_id, mandant_id)` | `cse_definer` | `services/recruiting/` | `recruiting.bewerbung_bewerten` **in that mandant** | `recruiting.eingang_zugeordnet` |

**Every right key in this table, and everywhere else in this document, is a row of the one catalogue
`03-AUTH-BERECHTIGUNGEN.md` owns (K-19).** An earlier draft wrote `recruiting.schreiben` for the two
staging functions; that key has no catalogue row — the catalogue's recruiting keys are
`recruiting.stelle_schreiben`, `recruiting.stelle_veroeffentlichen`, `recruiting.bewerbung_lesen`,
`recruiting.bewerbung_bewerten`, `recruiting.entscheiden` and `recruiting.daten_loeschen` — and
`app.hat_recht()` returns **false** for a key it does not know. The listing would therefore have
returned zero rows for everyone, permanently and without an error, and the assignment would have been
refused for everyone: an inbound application would arrive, be staged, and never be reachable again.
The same rule binds the four `system.*` keys of §3 — `system.einstellung_lesen`,
`system.einstellung_verwalten`, `system.protokoll_lesen`, `system.betrieb_lesen` — and
`dienstplan.arbzg_pruefen`, whose module is **`dienstplan`** and whose action is `pruefen`, both of
which K-19 requires the catalogue to carry. All seven keys this document uses are catalogue rows in
`03-AUTH-BERECHTIGUNGEN.md` §12; CI extracts every right-key literal in the repository and fails on
one that is not, and on a catalogue key no code uses (§30).

The first two are K-06 verbatim and are the only ones that cross **tenant** data; the next three read
platform-level operational state that has no tenant to belong to; the last two touch
`bewerbung_intern.bewerbung_eingang`, which holds applicant personal data **before** any tenant owns
it (§19.2) — the crossing there is from "no tenant" into one, performed by a named human, never
automatically. Each is exercised by an isolation test in the shape K-06 fixes: the caller gets the
answer and gets no field identifying anything they were not already entitled to.

The two that carry the most weight, restated because they carry the reasons:

1. **The ArbZG cross-entity window — K-06.** TIM-14, LEG-03 and D-09 consequences 1 and 2 require
   summing one person's hours across entities, which K-03 otherwise makes impossible; left
   unresolved, the detector reports "no conflict" for a 6 h + 5 h day. The sanctioned path is
   `app.arbzg_belastung(p_person, p_von, p_bis)`, `SECURITY DEFINER` owned by `cse_definer` with
   `SET search_path = pg_catalog, public`, reading `zeit_intern.arbeitszeit_fenster` — a schema not
   exposed by PostgREST — and returning **durations and interval boundaries only**: never
   `mandant_id`, never the entity name, never `objekt`, `kunde`, `personalnummer` or
   `stundensatz_intern`. Preconditions are checked inside: `app.person_sichtbar(p_person)` and
   `dienstplan.arbzg_pruefen` in the active mandant. Every call writes `audit_log` with
   `aktion = 'arbzg.aggregat_gelesen'`. Findings are written only by `app.arbzg_befund_schreiben(...)`,
   because a breach spanning two entities must be recorded in both and a request scoped to mandant A
   cannot write a row in mandant B. Only caller: `src/server/services/arbzg/`.
2. **The five pre-session functions — K-08, a closed register.** `app.sitzung_aufloesen(token_hash)`
   (`cse_anon`), `app.versuch_protokollieren(...)` (`cse_anon`, AUT-07),
   `app.checkin_verbrauchen(p_token_hash text, p_geraete_zeit timestamptz, p_ip inet,
   p_user_agent text, p_geo jsonb default null)` (`cse_checkin`, TIM-07/TIM-08),
   `app.offline_ereignis_annehmen(token_hash, ereignisse, ip)` (`cse_checkin`, TIM-09 — check-in data
   arriving late over the same token, so the same trust boundary and the same K-09 conditional write)
   and `app.ical_feed_lesen(feed_token_hash)` (`cse_anon`, CAL-03 — read-only, one user's own
   entries, no write path). A **route-manifest test asserts that no other code path reaches the
   database outside `withTenant` / `withGroupScope` / `withPersonScope` / `withKundeScope` /
   `withAnstellung` / `withSystemTenant`**, and it fails the build on a sixth pre-session function
   that is not added to K-08 in the same PR.

   **The check-in signature is the owner's five-argument form, and the register row must say so.**
   K-08's table previously wrote `app.checkin_verbrauchen(token_hash, geraet_zeit, ip)`, and four
   documents including an earlier version of this one copied it; but
   `02-datenmodell/04-PLANUNG-ZEIT.md` §9 owns the body and needs `p_user_agent` and `p_geo` — the
   `checkin_token.ip_adresse` / `user_agent` columns of K-09 and the LEG-10 geolocation capture have
   nowhere else to come from. **PostgreSQL overloads on the argument list and a `GRANT EXECUTE` is
   per exact signature**, so `grant execute on function app.checkin_verbrauchen(text, timestamptz,
   inet) to cse_checkin` would grant a function that does not exist: the check-in endpoint fails
   closed, every worker's shift start silently records nothing, and the §17 MiLoG record is missing
   rather than wrong. **Met:** K-08's register row and all four documents that quote it now carry the
   five-argument form with the owner's `p_geraete_zeit` spelling.

**EMP-01 needs no crossing of its own.** The phone-number credential lives in Supabase Auth, not in an
application table read before a session exists: the worker requests an OTP, our own middleware
applies the AUT-07 rate limit and lockout through `app.versuch_protokollieren`, Auth delivers the
code through the SMS hook (§18), and only after the exchange does `app.sitzung_aufloesen` resolve
`benutzer_id`, `person_id` and memberships. The combined cross-employment view of EMP-14 / EMP-15 is
likewise not a new path — but it is **not group scope either**, and an earlier draft had it wrong.
`/portal/mein/**` **reads** run in `withPersonScope` and `/portal/kunde/**` reads in
`withKundeScope`; every **write** re-enters `mandant` scope through `withAnstellung` with the single
resolved tenant, as fixed in `03-AUTH-BERECHTIGUNGEN.md` §7, under the K-04 `mitarbeiter` ceiling
that restricts every anstellung-hung and person-hung table to the caller's own rows (EMP-13).
**Routing either portal through `withGroupScope` reads zero rows**, silently: K-03's group policy
requires `gruppe.<modul>.lesen`, which no cleaner and no customer will ever hold, and widening that
right to repair the symptom would hand every worker a group-level read of all four entities (K-18).

### 6.3 Time, auth, realtime

- **Time.** Postgres is the clock of record (invariant 5, TIM-08). A health probe compares Postgres
  `now()` against the runtime clock and alerts above ±2 s, because drift silently corrupts
  `zeitabweichung_sek`. Calendar boundaries — day, month, billing period — are **Berlin wall-clock**
  converted to instants (K-11), never UTC midnight; every reference test carries a CET **and** a CEST
  case.
- **2FA sits on the write path of the permission-administration tables** — `rolle_berechtigung` and
  `benutzer_mandant` INSERT/UPDATE/DELETE — never on `SELECT` of a table that membership resolution
  depends on (K-15). AUT-02 requires 2FA for `super_admin` and `admin` only; a restrictive `aal2`
  policy on `benutzer_mandant` would blank the platform for every worker and customer.
  **The second factor is TOTP** via `AuthPort.enrollMfa` / `verifyMfa`, so admin 2FA is **not**
  blocked by the missing SMS provider and Phase 1 does not wait on it.
- **Derived memberships are additive** (K-14): `benutzer_mandant.aus_anstellung` marks the rows the
  employment trigger owns, so a `leitung` who is also employed does not lose her role.
- **Realtime is not used** for DSH-05. "Currently working" polls a server route every 30 s. Realtime
  would push tenant rows to the browser with RLS as the only boundary, contradicting invariant 3.
  For the same reason the browser-side Supabase client is used for **auth flows only** and reads no
  tenant table; `connect-src` allows the Supabase origin, and a CI test asserts no `from('<table>')`
  call exists in a client component.

### 6.4 Storage — DOC-03, DOC-05, DOC-06, SEC-A6

Buckets are the ones the data model already fixes, and **no public bucket exists in the project**:
`dokumente` and `archiv` (`02-datenmodell/02-CRM-OPERATIONS.md` §4.7,
`CHECK (bucket IN ('dokumente','archiv'))`) plus `einsatz-medien` for check-in, Aufmaß and Wachbuch
photos (`02-datenmodell/04-PLANUNG-ZEIT.md` §medien). The earlier draft's `bewerbungen`, `exporte`
and `oeffentlich_web` buckets are dropped: applicant files are `dokument` rows with a retention rule,
and there is no swept scratch bucket at all. **`marke`** (V-100, D-628) holds logo, avatar and
cover of each company — material that appears on the website and still lives in a PRIVATE bucket:
`/api/marke/<mandant>/<art>/<version>` serves it only for a published identity or a session in
that company, keyed by content (`<mandant>/<art>/<sha256>.<ext>`, enforced by `mi_bildpfad_eigen`).

- **Object key:** `mandant/<mandant_id>/<dokument_id>/<version_nr>/<dateiname>`. The version segment
  is what makes DOC-05 real — a new version is a new `dokument_version` row with its own object, and
  the category is deliberately **not** in the path because it is mutable.
- **Signed URLs only, TTL 900 s** (DOC-03) — a **code constant**, not an env var, with a test
  asserting the 15-minute expiry.
- **Upload is two-step:** signed URL → PUT → the server verifies the **real MIME type by magic
  bytes** (never the header), enforces the size limit and strips EXIF **before** the object is
  confirmed (DOC-06, TIM-10). Unconfirmed objects are swept after 24 h. Inbound attachments from the
  mailbox path are quarantined until verification succeeds.
  `// TODO(client, O-127): Sollen eingehende Anhänge (Bewerbungen, Eingangsrechnungen, Kundenmails) zusätzlich auf Schadsoftware geprüft werden, und mit welchem EU-gehosteten Dienst? (DOC-06)`
- **Retention is a catalogue, not a literal.** Every deletion or archiving decision resolves through
  `app.aufbewahrung_intervall(mandant_id, <kategorie>)` / `dokument_aufbewahrung` — two arguments,
  because the resolver runs in tenantless job contexts (`02-datenmodell/02-CRM-OPERATIONS.md` §4.7).
  Finance, time-tracking and
  audit documents are **reported, never deleted** (invariant 8, ACC-06, LEG-01); `StoragePort.loesche`
  returns `POLICY_BLOCKED` for an object referenced by a finalised invoice, a booking line or an
  audit artifact.
- **A DSGVO erasure request that touches archived accounting data is answered, not silently
  refused.** The stated basis is Art. 17(3)(b) DSGVO in conjunction with §147 AO: the data stays for
  the statutory period, processing is restricted to that purpose, and the requester receives that
  answer in writing. This belongs in the LEG-09 deletion concept, which this document feeds.
- Documents referenced by a finalised invoice or a booking line are copied into the `archiv` bucket at
  finalisation with their sha256 (ACC-03, ACC-06).

### 6.5 Cron topology — SPEC §14, §21

`pg_cron` → `pg_net` POST → `/api/cron/<job>` on Vercel with `Authorization: Bearer CRON_SECRET_<job>`,
compared in constant time (`05-API-KARTE.md` §B.5, §C.4). **Edge Functions contain no business
logic** — a Deno duplicate of a money or time rule is exactly the silent failure the invariants exist
to prevent; they are schedulers and byte-movers only. Every run writes one `job_lauf` row — the
platform-level record with no `mandant_id` (K-21) — and a job that iterates tenants writes one
`job_lauf_mandant` row per mandant it touched, so a partial failure names the entity it failed in
instead of collapsing four outcomes into one status. Overlap is
prevented by `pg_advisory_xact_lock`; every job is safe to run twice; a missing `pg_net` extension is
asserted by a migration, and a missing **run** is caught by the `job_plan` heartbeat of §3.7.

Cron is UTC. Jobs with a Berlin wall-clock meaning — the 18:00 unstaffed alert, the 06:30 weather
attachment, the monthly `stundenkonto` close — run hourly and compute their local trigger inside, so
DST cannot shift them (invariant 2, K-11).

### 6.6 The PostgREST exposed-schema list — stated here, because this layer owns the config

Two sections above rely on a schema being **unreachable over the REST API** — `zeit_intern` for the
K-06 ArbZG window and `bewerbung_intern` for the pre-tenant application staging table (§3.10) — and
`02-datenmodell/04-PLANUNG-ZEIT.md` §0 asserts the property while naming this document as the owner
of the setting. An assertion nobody states is not a control, so the list is here:

| Setting | Value | Why |
|---|---|---|
| PostgREST `db-schemas` | **`public, app`** — and nothing else | `public` carries the tenant tables, every one of them under FORCE RLS and the K-03 policy pair; `app` carries the accessors and the K-08 register, each `SECURITY DEFINER` with its own precondition |
| Never exposed | `kern`, `zeit_intern`, `bewerbung_intern` | `zeit_intern.arbeitszeit_fenster` is readable **only** through `app.arbzg_belastung`, which strips every identifying field (K-06); `bewerbung_intern.bewerbung_eingang` holds applicant data that has no tenant yet and therefore no K-03 policy that could protect it (§3.10) |

Exposing either containment schema would hand any authenticated caller the raw rows the two definer
functions exist to filter — the ArbZG window would leak the foreign mandant, the object and the
customer that K-06 removes, and the staging table would be world-readable to every logged-in user of
every entity. **CI asserts the exact list** (§30), because the setting is a dashboard value that a
later project restore can silently widen.

`bewerbung_intern` is created by **this layer's first migration**, alongside the nine tables of §3.
`02-datenmodell/01-KERN.md` names the schemas the first migration creates and
`03-AUTH-BERECHTIGUNGEN.md` §17.3 scans a single constant `ANWENDUNGSSCHEMATA`; both must list it, or
the schema is created by no migration and classified by no test (§31).

---

## 7. Vercel — D-04

| | |
|---|---|
| **Credentials** | none in code; `VERCEL_REGION` / `VERCEL_ENV` are provided by the platform and asserted |
| **EU / DPA** | function region **`fra1`** pinned in `vercel.json`. DPA offered; **status: pending**. Runtime logs may transit non-EU infrastructure depending on plan — **verify against the current subprocessor list before go-live** |
| **Failure** | wrong region → deploy-time assertion fails and a staging test fails; function limits → long work moves to a `/api/cron/*` job endpoint, never inline in finalisation |
| **Status today** | not yet provisioned |

- **The Edge runtime is forbidden** for any route touching personal data (`runtime = 'edge'` banned by
  lint and a CI grep): it executes at the viewer's nearest global PoP, which moves processing outside
  the EU.
- **Middleware runs in the Edge runtime globally**, so it may only redirect and set headers. Tenant
  resolution and authorisation stay in server components and route handlers (invariant 3, AUT-04),
  and the `[mandant]` path segment is routing only — validated against the session, never trusted,
  404 on mismatch (K-02, K-07).
- Portal responses carry `Cache-Control: private, no-store`; no tenant data reaches the CDN or the
  data cache. Public pages use ISR. Image optimisation is for public imagery only (PUB-10); private
  documents go through signed URLs.
- Preview deployments never receive production credentials (SEC-A3).
- CSP, HSTS and X-Frame-Options in `next.config.ts` (SEC-A7); `connect-src` allows the Supabase origin
  only; `font-src 'self'` because Inter and Caveat are self-hosted via `next/font` — no font-CDN
  request, and therefore no visitor IP transmitted to a third country (PUB-13).

---

## 8. OpenAI — D-04, AGT-02, AGT-04, AGT-05, AGT-06, ACC-05

| | |
|---|---|
| **Methods** | `LlmPort.complete({ faehigkeit, system, nachrichten, werkzeuge?, max_tokens, aufgabe_id })` · `EmbeddingPort.embed({ texte })` · `VisionPort.extrahiere({ bild, schema })` — each returning `{ modell, token_ein, token_aus, kosten_mikrocent }` — 10⁻⁶ € per K-16(b), booked to `agent_kosten` and never converted per call |
| **Credentials** | `OPENAI_API_KEY` · `OPENAI_BASE_URL` (EU endpoint) · `OPENAI_PROJECT_ID` · `OPENAI_ORG_ID` · `OPENAI_DATA_RESIDENCY=eu` — server-side only (SEC-A5) |
| **EU / DPA** | EU processing **and** zero retention, evidenced **per model** in `modell_register`. DPA offered; **status: pending**. The adapter refuses to go live unless `OPENAI_DATA_RESIDENCY=eu` |
| **Failure** | 429 → one backoff retry then `RATE_LIMITED`, the task stays `wartet`; timeout 60 s → step failed, visible in the Agent Center; schema mismatch → `INVALID_RESPONSE`, nothing written; cap reached → `BUDGET_EXCEEDED` + notification; key revoked → `AUTH_FAILED`, status `gestoert` |
| **Status today** | Nicht verbunden |

- Callers request a **capability**, never a model: `chat_intern` · `entwurf_text` ·
  `extraktion_dokument` · `extraktion_beleg` · `klassifikation` · `embedding` · `vision`.
- **Residency gate.** `modell_register` (§3.6) is the only place a model becomes callable:
  `aufrufbar := eu_verarbeitung AND zero_retention AND freigegeben`, all defaulting to `false`.
- **When EU processing is unavailable for a capability, the capability is switched off.** The call
  returns `RESIDENCY_BLOCKED`, the UI says „KI-Funktion nicht verfügbar — kein Modell mit
  EU-Verarbeitung freigegeben", and the work continues manually. No silent fall back to a non-EU
  region, no silent downgrade to another model, no queueing. Concretely: no `embedding` → no
  `pgvector` index, `suche_bestand` returns `NOT_CONNECTED` and the CEO Assistant says it cannot
  answer (AGT-06, AGT-07); no `vision` → ACC-05 OCR proposals unavailable and incoming invoices are
  captured manually; no `entwurf_text` → REC-02 and reply drafting unavailable.
- **Budget.** `agent_budget` per mandant **and** per agent per Berlin calendar month, evaluated by
  `app.agent_budget_pruefen(p_mandant, p_agent, p_betrag_mikrocent)` which locks the mandant row then the
  agent row and returns a verdict rather than raising
  (`02-datenmodell/06-RADAR-KI-INHALT.md` §3.6). A pre-flight estimate is reserved
  (`agent_reservierung`) before the call and settled after it. At the cap the adapter refuses with a
  notification — **never a silent downgrade to a cheaper model** (AGT-05). The cap is a DB row, not an
  environment variable, so a fifth business area gets a budget without a deployment (TEN-08).
  The comparison is exact integer arithmetic in the K-16(b) unit —
  `verbrauch_mikrocent + reserviert_mikrocent + neu_mikrocent > budget_cent * 10000` — with the cap
  widened rather than the spend narrowed, because a widening cannot round a spender under the limit.
- **No arithmetic, and no model-authored input to arithmetic** (invariant 6, K-10). Every money,
  quantity or formula argument of an agent tool is either a **handle** — an entity id the service
  dereferences to stored rows — or a **token** from a prior result in the same run's number register;
  never a numeric literal, never an expression string. `berechne_preis` derives `leistung_ids`,
  quantities and the Zuschlagsprofil from the contract and the catalogue; choosing the surcharge
  profile is choosing the margin, which is setting a price, so `zuschlag_profil_id` is never a model
  argument. Every extracted number is re-validated in cents
  (`netto + Σ ust_je_satz = brutto`); a mismatch flags the field instead of accepting it (ACC-05), and
  every extracted value carries its source and a confidence flag in `freigabe_feld` (APR-03).
- Data minimisation via `redigiere()` before the call. Documents are passed **by content, never as a
  signed URL**, so nothing outside the platform can fetch them later. Nothing sends: the model may
  propose an email; only the gate plus a human releases it (AGT-02 `sende_email`, invariant 7).

`// TODO(client, O-121): Wenn für eine benötigte KI-Fähigkeit kein Modell mit EU-Verarbeitung und Zero-Retention angeboten wird — soll die Fähigkeit abgeschaltet bleiben, oder darf ein alternativer EU-gehosteter Modellanbieter in den festgelegten Stack aufgenommen werden? (D-04)`

---

## 9. DATEV — ACC-02, ACC-03 (architecture-first, blocked on O-05)

Two ports, because they have different fates: the **file export** can be built now and is blocked only
by missing master data; the **online transfer** has no credentials and is not implemented at all.

| | |
|---|---|
| **`AccountingExportPort`** | `pruefeProfil(mandantId)` · `erzeugeBuchungsstapel({ mandantId, von, bis, stapel })` → file in the `archiv` bucket + `{ zeilen, sha256, summe_soll_cent, summe_haben_cent }` (bigint) · `erzeugeBelegpaket({ exportId })` · `protokolliere(exportId)` |
| **`AccountingTransferPort`** | `uebertrage({ mandantId, exportId, freigabe })` · `status({ mandantId, vorgangId })` — **both resolve to the NotConnectedAdapter; there is no mock, no sandbox and no `übertragen` state** |
| **Credentials** | none in env. Beraternummer, Mandantennummer, Kontenrahmen, Sachkontenlänge, Steuerschlüssel and fiscal-year start are **per-mandant DB rows** (`datev_profil`, `konto_mapping`): auditable business configuration that differs per entity and must not require a redeploy |
| **EU / DPA** | the export is a **local file**; no data leaves the system. The tax advisor is an independent professional recipient — the contractual basis sits with the client, **status unknown** |
| **Failure** | missing master data → `NOT_CONFIGURED` naming each field; a character not representable in Windows-1252 → `ENCODING_UNMAPPABLE` naming record, field and character and the **export fails** rather than writing `?`; non-integer amount → aborts (type system + assertion); period already exported → `DUPLICATE` with the prior run, re-export requires an explicit reason and a new `lauf_nr`; online transfer requested → `NOT_CONNECTED` |
| **Status today** | **Blockiert (O-05)** |

**Format conventions, to be confirmed against the client's real sample.** Windows-1252 encoding (via
`iconv-lite` — Node has no native cp1252 encoder), comma decimal separator, semicolon field separator,
CRLF line endings, quoted text fields, amounts written unsigned with a separate Soll/Haben indicator,
and a header carrying version, Berater-/Mandantennummer, Sachkontenlänge and the fiscal-year range.
These are **not** stated as fixed: ACC-02 names the encoding and the decimal separator and nothing
else, so the exact header layout and version are taken from the client's sample and the writer is
tested as a golden-file diff against it. Amounts come from
`formatDatevBetrag(cents: bigint): string`, a tested pure function — never `toFixed`, never `Intl`,
never a float (invariant 1). The writer itself is **pure code in
`src/server/services/buchhaltung/datev-extf.ts`**, not an integration
(`01-ORDNERSTRUKTUR.md` §11.2); only the transmission is an integration.

Until O-05 is answered: `pruefeProfil()` returns `NOT_CONFIGURED`, the DATEV screen shows
„Nicht verbunden — DATEV-Stammdaten fehlen (O-05)" with the export disabled, and the golden-file test
exists as an explicitly **pending** test („Golden file from tax advisor missing — O-05") so it is
visible in every CI run. No plausible default is chosen for Kontenrahmen, Sachkontenlänge or any
Steuerschlüssel. A completed export stores its file in the `archiv` bucket with its sha256 and can
never be deleted (ACC-06, invariant 8).

**Whether a completed export closes the period is a client decision, not ours.** The earlier draft
stated that an export "locks the period against new bookings for that range". SPEC does not say that;
late bookings into an already-exported period are routine in German practice and normally go into the
next open period, so silently refusing them could block a legitimate entry — and silently allowing
them could hand the tax advisor two versions of one month. The behaviour is therefore a
per-mandant setting with **no default chosen**, sitting beside the fiscal-year start in
`datev_profil`, and the export list shows which runs are authoritative
(`UNIQUE (mandant_id, von, bis, lauf_nr)` plus a partial unique on the authoritative run per period).

`// TODO(client, O-05): DATEV-Stammdaten je Gesellschaft — Beraternummer, Mandantennummer, SKR03 oder SKR04, Sachkontenlänge, Steuerschlüssel-Tabelle, Beginn des Wirtschaftsjahres.`
`// TODO(client, O-05): Bitte eine echte Beispiel-EXTF-Datei des Steuerberaters bereitstellen, gegen die der Writer als Golden File getestet wird.`
`// TODO(client, O-129): Soll ein abgeschlossener DATEV-Export die Periode gegen neue Buchungen sperren, oder gehen Nachbuchungen in die nächste offene Periode? (ACC-02)`
`// TODO(client, O-124): Wie sollen Belege beim Steuerberater ankommen — über DATEV Unternehmen online / Belegtransfer, oder als ZIP-Paket neben der EXTF-Datei? (ACC-03)`

---

## 10. XRechnung — where validation may gate, and where it may not — FIN-11

The XRechnung XML is **our code**: a pure serializer fed by tested functions. The integration is the
**validator**, and the earlier draft made a full KoSIT run a hard precondition of finalisation
(„Any failure blocks finalization", „unavailable at runtime → finalization is blocked"). That cannot
stand, for two reasons that compound: the KoSIT validator is a **Java** tool and Vercel functions are
Node, so the same "there is no JVM" problem the draft acknowledged for veraPDF applies to it; and
FIN-11 asks for KoSIT validation **in CI**. Elevating it to a runtime gate would hand a third
component the power to stop a German legal entity from issuing invoices at all. The sibling documents
already resolved this — `01-ORDNERSTRUKTUR.md` §11.2 ("KoSIT XRechnung validation is a **CI
concern** … there is no production code path that depends on a validator being reachable") and
`04-SEITENKARTE.md` §5.14.3 (three honest states, never a fourth that looks like a pass) — and this
document follows them.

| | |
|---|---|
| **`EInvoiceValidatorPort`** | `validiere({ xml, profil: 'xrechnung-ubl' \| 'xrechnung-cii' })` → `{ gueltig, meldungen[], validator_version, konfig_version }` |
| **Credentials** | none. `KOSIT_VALIDATOR_VERSION` and `KOSIT_CONFIG_VERSION` pin the image and the ruleset, so a pass is reproducible |
| **EU / DPA** | **no processor.** An invoice carries customer data, bank details and amounts; a hosted validation service would be an unnecessary recipient with no benefit. Validation is offline |
| **Failure** | unavailable **in CI** → the build **fails**, never "skipped, assumed valid"; unavailable **at runtime** → the invoice records `validierung_status = 'nicht_geprueft'` and the screen says „Prüfer nicht verbunden", with the XML still downloadable. Finalisation is **not** blocked |
| **Status today** | Verbindbar in CI; runtime sidecar Nicht verbunden |

**The ordering against invariant 4.** The number is assigned only at finalisation and finalisation is
one-way, so a check that can fail *after* finalisation must never be the one that decides whether the
document is legal.

1. **Pre-flight, before finalisation — our own deterministic code, and it does gate.** The §14 UStG
   field validator (FIN-04), `Leistungszeitraum` (FIN-05), the Leitweg-ID for a customer flagged
   `ist_oeffentlicher_auftraggeber`, the EN 16931 business rules the serializer implements, and
   **XSD plus Schematron validation of the provisional XML in Node**. Any failure blocks
   finalisation. This path has no external dependency and cannot be unavailable.
2. **Finalisation** — number from `SELECT … FOR UPDATE` on the counter row, `hash = SHA256(payload +
   previous_hash)`, the row immutable, and the canonical payload **snapshotting the identity** of
   both parties, the tax lines, `abrechnungsart`, `bauabzugsteuer_cent`, `kleinbetrag` and
   `leistungszeitraum` (K-12, FIN-03, FIN-06). The PDF and the XRechnung are rendered **from the
   snapshot**, never from live master data.
3. **Post-finalisation — KoSIT, asynchronously.** The real XML is validated when a validator is
   available (always in CI, optionally by a runtime sidecar) and the report is stored on
   `rechnung_dokument` with `validierung_status ∈ {nicht_geprueft, gueltig, ungueltig}` plus
   `validierung_bericht` and `validierung_am` (`02-datenmodell/05-FINANZEN.md` §9.5). A failure is an
   incident, alerts immediately, and is corrected by **Storno**, never by editing.

The Leitweg-ID travels in the buyer-reference field; the pre-flight blocks finalisation when the
customer is a public buyer and none is present — without XRechnung the group cannot invoice GIZ, DRV
Bund or Berlin districts at all (FIN-11).

---

## 11. ZUGFeRD 2.x / PDF/A-3 — FIN-12

| | |
|---|---|
| **`ZugferdComposerPort`** | `komponiere({ pdf, xml, profil: 'EN16931' \| 'XRECHNUNG' })` → `{ pdf_a3, sha256 }` · `pruefePdfA({ pdf })` → `{ konform, stufe, meldungen[] }` |
| **Credentials** | none (local) |
| **EU / DPA** | local composition, no recipient |
| **Failure** | composition failure **never blocks finalisation** — the invoice is already valid as PDF + XML; a task „ZUGFeRD-Erzeugung fehlgeschlagen" is raised and both artifacts stay available. A veraPDF failure in CI fails the build |
| **Status today** | Verbindbar |

The PDF is the DESIGN §11 invoice (white page, black text, per-entity logo, register court, HRB,
managing director) with the invoice XML embedded as an attachment carrying the ZUGFeRD relationship,
attachment name and XMP metadata for the chosen profile. **CI gates: veraPDF for PDF/A-3 conformance
and KoSIT for the embedded XML** — a ZUGFeRD file that is not PDF/A-3 is not ZUGFeRD.

**The worker substrate, named.** The locked stack is Supabase cron plus Vercel functions; there is no
container job runner in it, and Edge Functions are barred from business logic. Composition therefore
runs in a **Node pipeline inside `/api/cron/e-rechnung-komposition`** (embedded fonts, ICC profile,
XMP), queued off `rechnung_dokument`, never inline in a request, so a function time limit cannot be hit
mid-finalisation. If a Node-only pipeline cannot reach PDF/A-3 conformance under the veraPDF gate,
the fallback is an EU-hosted container runner — which is a **hosting** decision and belongs to O-11,
not a new invented component. veraPDF and KoSIT themselves run only in CI (§30).

Public buyers receive XRechnung (FIN-11); commercial customers receive ZUGFeRD (FIN-12);
Kleinbetragsrechnung follows FIN-13.

---

## 12. Getting the invoice to the buyer, and the taxes that decide its content

### 12.1 `EInvoiceDeliveryPort` — FIN-11

Producing a valid XRechnung with no route to the buyer leaves FIN-11 unmet while looking complete.
German public buyers do not accept an invoice from an arbitrary SMTP sender: they receive it through
**ZRE**, **OZG-RE**, a Land portal, or a **Peppol** access point, and the Leitweg-ID exists precisely
to address it there.

| | |
|---|---|
| **Methods** | `sende({ mandantId, rechnungId, leitweg_id, xml, route, freigabe })` → `{ vorgang_id, angenommen_am }` · `status({ mandantId, vorgangId })` |
| **Routes** | `kunde.uebertragungsweg` — `peppol` · `zre` · `ozg_re` · `email` (`kundenportal` and `post` are not e-invoice delivery and never reach this port). The route is a property of the **customer**, because the buyer decides it |
| **Credentials** | per route, once accounts exist — **none today** |
| **EU / DPA** | German public infrastructure or an EU Peppol access point; an access-point operator is a processor and needs a DPA |
| **Failure** | not connected → the XML is produced, stored and downloadable, `rechnung_versand` records `nicht_verbunden`, and the invoice is **never** marked as sent; rejected by the portal → the rejection text is stored on `rechnung_versand` and a task is raised; **no auto-retry** |
| **Status today** | **Nicht verbunden** |

Delivery attempts are **child rows** (`rechnung_versand`), never columns on the invoice, because a
finalised invoice is immutable (K-12).

**The route column has an owner, and it is not this document.** An earlier draft introduced
`kunde.erechnung_route` in prose, with an enum no document declared — a column belonging to nobody.
It is unnecessary: `02-datenmodell/02-CRM-OPERATIONS.md` §2 already declares
`create type uebertragungsweg as enum ('peppol','zre','ozg_re','email','kundenportal','post')` and
hangs it on `kunde` beside `leitweg_id`, `kaeufer_referenz`, `elektronische_adresse`,
`rechnungsformat` and `xrechnung_pflicht`, and its open question is already **O-22**. This layer
therefore reads that column and mints nothing. It is nullable, and a buyer with `xrechnung_pflicht`
and no route **blocks the FIN-11 dispatch** and raises a task, rather than defaulting to a channel
that would silently deliver the invoice nowhere. A Landesportal, if any buyer requires one, is a new
value **there** (O-22) — a parallel enum here would let the two vocabularies drift and would make
`rechnung_versand.kanal` ambiguous.

`// TODO(client, O-22): Über welchen Kanal empfängt jeder öffentliche Auftraggeber seine XRechnung — ZRE, OZG-RE, ein Landesportal, ein Peppol-Zugangspunkt oder ein E-Rechnungs-Postfach — und wer hält die jeweiligen Zugänge? (FIN-11)`

### 12.2 §13b UStG is decided from dated evidence, not from a VIES lookup — FIN-09, LEG-06

The earlier draft made a VIES USt-IdNr. confirmation the gate for §13b and filed VIES under FIN-09.
That is the wrong legal instrument, and getting it wrong produces wrong-VAT invoices for three
construction-adjacent entities. FIN-09 is **domestic** construction-to-construction reverse charge
under §13b Abs. 2 Nr. 4 in conjunction with Abs. 5 UStG; the evidence that the recipient is himself a
Bauleistender is the customer's **Freistellungsbescheinigung USt 1 TG**, not a VIES confirmation.
VIES concerns intra-Community supplies, an entirely different case. Building the §13b decision on VIES
would either apply reverse charge without the required evidence or block a correct §13b invoice
because a German customer has no USt-IdNr. on file.

The determination therefore reads `kunde_bauleistender_status` — `ist_bauleistender`, `gilt_ab`,
`gilt_bis`, `grundlage`, `leistungsart`, `beleg_dokument_id`, with an `EXCLUDE` constraint on
`(kunde_id, daterange)` — **at the service date**, in the tested function
`services/finanzen/steuer/reverse-charge.ts`, exactly as `02-datenmodell/05-FINANZEN.md` §2.3 and
`05-API-KARTE.md` §D.6 already fix it. This is structurally identical to the §48b handling of §12.3
and correctly separate from it.

`// TODO(client, O-104): Setzt eine §13b-Rechnung eine zum Leistungsdatum gültige Freistellungsbescheinigung USt 1 TG des Kunden voraus, und wie wird verfahren, wenn sie mitten in einem laufenden Vertrag ausläuft? (FIN-09, LEG-06)`

### 12.3 §48b EStG Freistellungsbescheinigung — FIN-10

No API is assumed. The certificate is stored with its validity range as `DATE` bounds, FIN-10
evaluates validity **at the service date** in a tested function, and verification against the BZSt is a
recorded manual step with `geprueft_am` / `geprueft_von`. Absent a valid certificate, 15 % is withheld —
computed in cents by a service, never by a model (invariant 6).

`// TODO(client, O-130): Liegt für jede Gesellschaft eine gültige Freistellungsbescheinigung nach §48b EStG vor, mit welcher Laufzeit, und wer erneuert sie? (FIN-10)`

### 12.4 `VatIdPort` — VIES, correctly scoped

| | |
|---|---|
| **Methods** | `pruefe({ mandantId, ustid })` → `{ gueltig, name?, anschrift?, geprueft_am, abfrage_id }` |
| **Purpose** | the §14 UStG plausibility of a USt-IdNr. printed on an invoice, and **intra-Community** cases only — never §13b |
| **EU / DPA** | EU Commission service. **No processor and therefore no DPA** — but a sole trader's USt-IdNr. *is* personal data under Art. 4(1) DSGVO, so the query and its result belong in the Art. 30 processing register (LEG-09) |
| **Failure** | unavailable → the result is recorded as `nicht_pruefbar` with the timestamp; **finalisation is never blocked** by it |
| **Status today** | Verbindbar |

The result is stored with its timestamp as evidence, because "valid on the day we invoiced" is the
question an audit asks.

---

## 13. Banking — CAMT.053 import — ACC-04

File-based by design. **No bank API is assumed** — no EBICS, no FinTS, no scraping of an
online-banking session.

| | |
|---|---|
| **`BankStatementPort`** | `importiere({ mandantId, datei, dateiname, hochgeladen_von })` → `{ kontoauszug_id, buchungen, von, bis, sha256 }` · `vorschlaege({ mandantId, kontoauszugId })` → `Zuordnungsvorschlag[]` |
| **Credentials** | none for upload; an optional SFTP retrieval is configuration of the same port, not a new one |
| **EU / DPA** | parsing is local. The bank is an independent controller; **no DPA applies** |
| **Failure** | unsupported `camt.053` namespace version → `SCHEMA_UNSUPPORTED` naming it, never parsed "best effort"; malformed XML → rejected with the parse position; the same file again → `DUPLICATE` with the original import id; unknown IBAN → imported but unassigned and flagged; two invoices with the same amount → **no proposal is auto-selected**, both are shown |
| **Status today** | Verbindbar (import); delivery route open (O-120) |

One file is one transaction: a statement imports completely or not at all. The original XML is stored
in the `archiv` bucket **before** parsing (ACC-06).

**The entry key, corrected.** The earlier draft asserted uniqueness on `(konto, auszug_nr, entry_ref)`.
`Ntry/NtryRef` is **optional** in camt.053 and many German banks omit it, so a `NOT NULL` unique on it
either rejects valid statements or collapses distinct entries into one. The model is instead:

| Table | Key | Notes |
|---|---|---|
| `kontoauszug` | `UNIQUE (mandant_id, datei_sha256)` | file-level idempotency; `von`/`bis` as `DATE` |
| `bankbuchung` | `UNIQUE (kontoauszug_id, lfd_nr)` | position within the statement — always present |
| | `inhalt_hash` index | sha256 over `(iban, betrag_cent, buchungsdatum, valutadatum, verwendungszweck, endtoend_id)` for cross-file duplicate detection, reported to a human, never auto-suppressed |

Columns: `betrag_cent bigint` (integer cents, invariant 1), `waehrung`, `buchungsdatum date`,
`valutadatum date` — calendar dates, not instants — `iban`, `verwendungszweck`, `endtoend_id`,
`entry_ref` (nullable), `soll_haben`. Amounts are parsed by a tested
`parseDecimalToCents(s: string): bigint` — never `parseFloat`; a non-EUR currency is flagged, never
converted.

Matching (amount + invoice number in the remittance information + IBAN, with the structured reference
where present) is a **pure service** producing `zahlungsvorschlag` rows with a stated reason and a
confidence flag. **Nothing books itself:** a proposal becomes a `zahlung` only on human confirmation
(SPEC §17 autonomy matrix: booking to accounting requires approval), and partial payments and
overpayments are never auto-split.

**OPS-04 (Raumbuch import) shares this discipline** even though it is not an integration: the same
`parseDecimalToCents` for money, `numeric(12,3)` for areas (K-16 — quantities are not cents), a
preview before commit, and an import that is one transaction with a stored original file.

`// TODO(client, O-120): Wie gelangen CAMT.053-Dateien in die Plattform — manueller Upload durch die Buchhaltung oder ein SFTP-Abruf der Bank? Welche Banken und welche IBAN je Gesellschaft? (ACC-04)`

---

## 14. Leistungsverzeichnis import — `LvImportPort` — REQ-04, BAU-01, AGT-02

REQ-04 accepts an LV upload with an offer request, BAU-01 needs hierarchical OZ numbering, and
AGT-02 defines the tool `extrahiere_lv`. In German construction an LV arrives as **GAEB** (DA XML
3.x, or the older D81/D83/X83 exchange phases), as Excel, or as a PDF — and the three have nothing in
common. Without a port and a stated format the Acquisition Agent would be handed a PDF and asked to
invent positions, which invariant 6 forbids.

| | |
|---|---|
| **Methods** | `lies({ mandantId, datei, dateiname })` → `{ format, positionen: LvPositionRoh[], warnungen[] }` · `unterstuetzteFormate()` |
| **Payload** | `LvPositionRoh { oz, ebene, kurztext, langtext, menge numeric(12,3), einheit, ist_eventualposition, quelle_zeile }` — **quantities are `numeric(12,3)`, never cents** (K-16); no price is read into a money field without a tested conversion |
| **Credentials** | none — a local parser per format |
| **EU / DPA** | local parsing, no recipient |
| **Failure** | unknown GAEB exchange phase or edition → `SCHEMA_UNSUPPORTED` naming what was found, never a partial parse; PDF → **not parsed**: the file is stored and a human enters or confirms the positions, because a PDF LV has no reliable structure and a wrong Menge is a wrong bid |
| **Status today** | **Nicht verbunden** — no format confirmed |

`// TODO(client, O-97): In welchem Format erhalten Sie Leistungsverzeichnisse — GAEB (welche Ausgabe: 90, 2000, DA XML 3.x; welche Austauschphase: 81, 83, 84), Excel oder PDF? Bitte je eine echte Beispieldatei. (REQ-04, BAU-01)`

---

## 15. Tender sources — oeffentlichevergabe.de (RAD-01) and TED v3 (RAD-02)

Both are public, need no authentication, and feed the **same** port, so a third source is an adapter
and not a new pipeline.

| | |
|---|---|
| **`TenderSourcePort`** | `hole({ seit, cursor?, profil })` → `{ saetze: AusschreibungRohsatz[], naechster_cursor?, abgerufen_am }`, where `AusschreibungRohsatz = { quelle, quell_id, nutzlast_roh, nutzlast_hash, inhaltstyp, abgerufen_am }` |
| **Credentials** | none. `OEV_API_BASE`, `TED_API_BASE`; `TED_API_KEY` only if higher rate limits are wanted |
| **EU / DPA** | a German public body and an EU institution. **No DPA is required because there is no processor** — not because the data is impersonal: the contact details of a procuring officer *are* personal data under Art. 4(1) DSGVO, and they belong in the Art. 30 register (LEG-09) with a retention rule like any other contact |
| **Failure** | unreachable → 3 backoff retries, then `UPSTREAM_UNAVAILABLE`, **cursor unadvanced**, status `gestoert`, and the radar shows „Letzter erfolgreicher Abruf: <Zeitpunkt>" so an empty day is never mistaken for a quiet market; rate limited → resume next run; upstream schema change → `INVALID_RESPONSE`, the raw payload still stored with `normalisierung_fehlgeschlagen = true` so nothing is lost; identical payload already stored → `DUPLICATE`, counted, not an error |
| **Status today** | Verbindbar (both) |

| | oeffentlichevergabe.de (OCDS) | TED Search API v3 |
|---|---|---|
| Scope | national, **including below threshold** — where most of this client's work sits | EU, above threshold |
| Auth | none | none |
| `quell_id` | OCDS `ocid` plus release identifier | TED publication number / notice id |
| Filtering | CPV and NUTS applied after ingestion | expert query by CPV, NUTS (`DE3`, `DE300`), date |

**Idempotency and amendment, without contradicting each other.** The earlier draft said both
"`quell_id` unique per `quell_system`" and "a changed payload creates a new version row", which one
table cannot satisfy: the second insert would fail and the amended notice — often an amended
submission deadline, the single most expensive thing to miss in this domain — would be lost. The
model the data-model document already fixes is used verbatim
(`02-datenmodell/06-RADAR-KI-INHALT.md` §2.12):

- `ausschreibung` — the head row holding the current normalised state, `UNIQUE (quelle, quell_id)`.
- `ausschreibung_rohdaten` — one **verbatim** row per fetch, `nutzlast_roh text` (not `jsonb`: `jsonb`
  reorders keys and drops duplicates and is then no longer a verbatim copy), `nutzlast_hash`, and
  `UNIQUE (quelle, quell_id, nutzlast_hash)` so an unchanged re-fetch writes nothing and a changed
  payload is a new row. Append-only; no `UPDATE` or `DELETE` policy.
- Indexes for the paths this creates: `(quelle, abgerufen_am DESC)` for the ingest cursor and
  `(frist_datum)` for the RAD-06 countdown.

Further rules:

- Normalisation is a pure service tested against fixtures; **scoring is deterministic with a
  human-readable reason, no LLM** (RAD-05).
- `ausschreibung` is group-level reference data; every tenant-visible derivative (`bewertung` per
  `radar_profil`) carries `mandant_id` with RLS (TEN-03, K-03).
- The CPV codes in SPEC §6 are seeded as **placeholders flagged for review**, never as verified truth
  (K-17).
- **Deadlines are never invented** — invariant 6 binds code as well as the model. A source giving a
  date without a time is stored as `frist_datum DATE` with `frist_zeit_unbekannt = true`, and the
  RAD-06 countdown says „Uhrzeit laut Bekanntmachung prüfen" instead of assuming 23:59. With a time
  and offset it is `TIMESTAMPTZ` in UTC, displayed Europe/Berlin.
- RAD-09 is **not** an integration: procurement platforms expose no membership or submission API
  (D-07). Registrations are held **per legal entity**, so `mandant_plattform_registrierung` is
  tenant-scoped with RLS while the platform catalogue `vergabeplattform` is reference data; a notice
  requiring an unregistered platform is flagged.

`// TODO(client, O-07): Auf welchen Vergabeplattformen ist welche Gesellschaft registriert, mit welchem Konto und welcher Ansprechperson? (RAD-09)`

---

## 16. Weather — DWD Open Data — BAU-08

| | |
|---|---|
| **`WeatherPort`** | `beobachtung({ lat, lon, tag })` → `Wetterbeobachtung { station_id, station_name, entfernung_km, tag (DATE, Berlin calendar day per K-11), temperatur_min_c, temperatur_max_c, niederschlag_mm, wind_max_ms, dwd_qualitaetsniveau, quelle: 'dwd', quelle_url, abgerufen_am }` · `stationsindex()` |
| **Credentials** | none (`DWD_OPENDATA_BASE` only) |
| **EU / DPA** | German federal service, open data, **no personal data → no DPA**. Attribution is required: every diary entry showing weather prints „Quelle: Deutscher Wetterdienst" |
| **Failure** | no station data for that day → the field is `null` and renders **„keine Daten"**; never 0 °C, never interpolated. Source unreachable → the diary entry saves without weather and a task is created to attach it. **No coordinates on the `objekt`** → a *distinct* reason: „Keine Koordinaten am Objekt hinterlegt" (§25.2), never „DWD hatte keine Daten" |
| **Status today** | Verbindbar |

The observation day is part of the payload as a `DATE`, because BAU-08's evidentiary value depends on
the day observed, not on `abgerufen_am`, and the diary day is a Berlin calendar day (K-11). The
nearest station **with data** is chosen from a cached station index and `entfernung_km` is stored —
"nearest station 40 km away" is materially different evidence from "3 km away". Observations land in
`wetter_beobachtung` (`UNIQUE (station_id, zeitpunkt)`, append-only,
`02-datenmodell/03-GEWERKE.md` §7.17); the value is **snapshotted into `bautagebuch.wetter_snapshot`**,
not fetched at render time, because a construction diary is evidence and must show what was recorded
then. A site manager may correct it with a recorded reason; the original DWD snapshot is retained
beside it (invariant 8).

---

## 17. Public holidays — Berlin — CLN-03

| | |
|---|---|
| **`HolidayPort`** | `hole({ bundesland: 'DE-BE', jahr })` → `{ feiertage: Feiertag[], quelle, quelle_version, abgerufen_am }`; `Feiertag = { datum DATE, bezeichnung, gesetzlich, einmalig, quelle }` |
| **Credentials** | none (`FEIERTAGE_QUELLE` selects the adapter) |
| **EU / DPA** | no personal data → **no DPA** |
| **Failure** | sync unreachable → the existing table stays authoritative and a warning appears if the coming year is unpopulated by 1 November; the shift generator **refuses to generate into a year with an empty holiday table** and names it, rather than scheduling crews on Christmas Day |
| **Status today** | Verbindbar |

**This must be a maintained dataset, never a hardcoded list.** Berlin's set is not stable:
Internationaler Frauentag (8 March) was added in 2019, Berlin has legislated **one-off** holidays
(8 May 2020, and again for 2025), and the Easter-dependent dates move every year. A literal array in
the codebase would silently schedule crews on a public holiday and produce wrong hours.

- The primary source is the **offline computation** already specified in
  `01-ORDNERSTRUKTUR.md` §8.5 / `02-datenmodell/03-GEWERKE.md` §7 —
  `src/lib/datum/feiertage-berlin.ts`, movable feasts derived from Easter, Frauentag included,
  Fronleichnam and Reformationstag excluded — which needs no network at all. The port exists to
  **cross-check** it against a second maintained source and to catch a legislated change; naming that
  second source and its licence is an implementation ADR, not a client question.
- **Source of truth is our own `feiertag` table**, keyed `(bundesland, datum, status)`. Scheduling
  reads only this table, never the network.
- **Proposals need their own state**, or a proposed row cannot coexist with the confirmed one:
  `status ∈ (vorschlag, bestaetigt, verworfen)` is part of the key, and the `feiertage-sync` job writes
  `vorschlag` rows that a human confirms (APR-02 style diff), because the change affects scheduling
  and hours.
- One-off holidays are manually enterable (`einmalig = true`), because Berlin can legislate one
  faster than any dataset updates.
- A holiday change never rewrites `einsatz` rows in a locked `stundenkonto` month (EMP-04) or an
  invoiced period; it produces a task listing the affected assignments.

---

## 18. SMS — worker login codes and check-in links — EMP-01, TIM-07, AUT-07

| | |
|---|---|
| **`SmsPort`** | `sende({ mandantId?, an (E.164), zweck: 'login_code' \| 'checkin_link' \| 'dringende_planung', vorlage_id, parameter, freigabe, korrelation_id })` → `{ nachricht_id, angenommen_am }` · `zustellstatus({ nachrichtId })` |
| **Credentials** | `SMS_PROVIDER` · `SMS_API_KEY` · `SMS_SENDER_ID` — **none configured; no provider selected** |
| **EU / DPA** | EU processing and a signed Art. 28 DPA are **mandatory before selection**: a mobile number plus a shift context is personal data about an employee. **Status: no provider, therefore no DPA** |
| **Failure** | not connected → EMP-01 login unavailable, and the login screen says so **before** asking for a phone number; provider error → the code is invalidated and the user may request a new one; delivery unknown → treated as undelivered |
| **Status today** | Nicht verbunden — `nichtVerbunden('sms', 'integration.sms.nicht_verbunden', 'O-82')` |

The provider must offer: EU processing · Art. 28 DPA · no retention of message content beyond
delivery (the message carries a credential) · delivery receipts, so a failed login can be told apart
from an undelivered code · German sender-ID handling · throughput for a shift start, when many codes
go out within minutes.

Our own rules regardless of provider (AUT-07): the code is stored **hashed** (Argon2id, or an HMAC
with a server key), never in plaintext and never in a log · single use · short TTL · maximum attempts
· lockout per number and per IP through `app.versuch_protokollieren` (K-08) · constant-time
comparison · no user enumeration · codes invalidated on success · **no development backdoor in any
deployed environment** (a fixed code exists only behind `NODE_ENV !== 'production'`, with a test
asserting the production build cannot reach that branch, and `config/env.ts` refusing to enable it).
The send is a `systemnachricht` triggered by the recipient's own login attempt: it **still traverses
the gate and is still logged**, with the `Freigabe` minted by `policy.ts` from the seeded
`agent_richtlinie` (`erteilt_von = 'richtlinie:<id>'`, §4.3). It is pre-approved, never ungated —
and it is not queued for a human, because a login code that waits for an approver is a failed login
(AUT-07).

**Blocking consequence, stated so it is not discovered in Phase 5: until an SMS provider exists,
EMP-01 cannot ship.** Three things are *not* blocked, and saying so prevents a false alarm:
**admin 2FA is TOTP** (§6.3), so AUT-02 and Phase 1 proceed; the tokenised check-in link (TIM-07)
works without any login by design, so time recording never depends on an SMS provider — only its
*delivery by SMS* is blocked, and handing out the link or a QR code at the object is unaffected; and
the check-in write itself is the conditional single-use update of K-09, independent of any provider.

`// TODO(client, O-82): Welcher SMS-Anbieter versendet die Anmelde-Codes für das Mitarbeiterportal (EMP-01) und die Check-in-Links (TIM-07)? Erforderlich: EU-Verarbeitung, AV-Vertrag nach Art. 28 DSGVO, Absenderkennung, Zustellnachweise. Wer ist Vertragspartner und Kostenträger, und welches monatliche Kostenlimit gilt?`

---

## 19. E-Mail

### 19.1 `MailerPort` — transactional send — NOT-01, NOT-02, FIN-15

| | |
|---|---|
| **Methods** | `sende({ mandantId, an, cc?, betreff, text, html?, anhaenge?, vorlage_id, freigabe, korrelation_id })` · `zustellstatus({ mandantId, nachrichtId })` · `verarbeiteWebhook(rohdaten, signatur)` → bounce / complaint / delivered |
| **Credentials** | `MAIL_PROVIDER` · `MAIL_API_KEY` · `MAIL_WEBHOOK_SECRET` · a verified sender domain **per entity** — none configured |
| **EU / DPA** | EU processing and an Art. 28 DPA required; **no provider chosen, therefore no DPA** |
| **Failure** | not connected → in-app notifications keep working and nothing is marked „versendet"; provider 5xx → 2 retries under the same idempotency key, then the notification stays queued and visible; hard bounce → the contact is marked undeliverable and further sending stops |
| **Status today** | Nicht verbunden (O-116) |

Sender identity is **per mandant** — the tenant table `mandant_mail_absender` of **§3.9**, with
`mandant_id NOT NULL`, `FORCE ROW LEVEL SECURITY`, the two K-03 policies and the K-04 ceiling: each
GmbH sends from its own verified domain with its own DKIM/SPF/DMARC, an unverified domain holds no
credential and cannot send at all, and a test asserts that a message for mandant X cannot go out
with mandant Y's sender — the envelope and the PDF identity (DESIGN §11,
K-12 identity snapshot) must agree. Attachments are fetched server-side from private buckets and
attached; **never a link, never a signed URL pasted into an email** (DOC-03). Traffic: notifications
(NOT-01, NOT-02), lead SLA escalation (REQ-05, REQ-06), offer and invoice dispatch, dunning (FIN-15),
monthly hour statements (EMP-06), application acknowledgements (REC-03), approval requests.

`// TODO(client, O-116): Welcher E-Mail-Dienst versendet transaktionale Nachrichten, und welche Absenderadresse und Domain gelten je Gesellschaft (CSE Dienstleistungen, SSE Security, REALTIME Service, CSE Operations)? EU-Verarbeitung und AV-Vertrag erforderlich.`

### 19.2 `MailboxPort` — the monitored application mailbox — REC-03, REC-07

| | |
|---|---|
| **Methods** | `holeNeue({ postfachKanalId, seit, max })` · `markiereVerarbeitet({ postfachKanalId, nachrichtId })` · `loesche({ postfachKanalId, nachrichtId, grund })` |
| **Credentials** | `MAILBOX_*` (IMAP over TLS) **or** `MAILBOX_WEBHOOK_SECRET` (provider inbound parse) — none configured; the secret itself lives in the Vault and the table holds only `postfach_kanal.credential_ref` |
| **EU / DPA** | EU-hosted mailbox and a DPA required; **status: open (O-28)** |
| **Failure** | unreachable → `gestoert`, and the recruiting screen shows „Postfach nicht erreichbar — letzter Abruf <Zeitpunkt>", **never an empty inbox implying no applications** (the `postfach_stumm` watchdog raises when `letzter_abruf_am` ages out); duplicate `message_id` → skipped; attachment failing MIME verification → the application is created, the attachment quarantined and flagged |
| **Status today** | Nicht verbunden (O-28); the career-form path (REC-03) is independent and keeps working |

**An inbound application has no tenant until someone gives it one.** `bewerbung` is a tenant table,
and invariant 10 forbids inserting one without exactly one active mandant — but a speculative
application („Ich suche Arbeit") references no `stelle`, so nothing in the message says whether it
belongs to CSE Dienstleistungen, SSE Security or REALTIME. Guessing would be an invented business
rule. Two mechanisms, in order:

1. **Derivation, where it is honest.** `postfach_kanal` is tenant-scoped and keyed
   `(mandant_id, adresse)` (`02-datenmodell/06-RADAR-KI-INHALT.md` §6.5), so a message that arrived at
   *that entity's* monitored address belongs to that entity. `holeNeue` therefore takes a
   `postfachKanalId`, and the job iterates channels inside `withSystemTenant(mandant_id, 'job:postfach')`.
2. **Staging, where it is not.** A catch-all address, a forwarded message, or an address that maps to
   no channel lands in `bewerbung_intern.bewerbung_eingang` — a **non-tenant** staging table in a
   schema not exposed by PostgREST (the K-06 containment pattern):

```
bewerbung_eingang
  id uuid pk · message_id text unique · empfaenger_adresse text · absender text
  eingegangen_am timestamptz · roh_objekt_pfad text · anhang_status text
  zugeordnet_mandant_id uuid null · zugeordnet_von uuid null · zugeordnet_am timestamptz null
  verworfen_am timestamptz null · verworfen_grund text null
```

   It is read through `app.bewerbung_eingang_liste()` (`SECURITY DEFINER`, owned by `cse_definer`,
   `SET search_path = pg_catalog, public`, requires `recruiting.bewerbung_lesen` in at least one
   mandant and writes `audit_log`), and a human assigns it with
   `app.bewerbung_zuordnen(eingang_id, mandant_id)`, which asserts the caller holds
   `recruiting.bewerbung_bewerten` **in that mandant** — the write right on `bewerbung` in the one
   catalogue (`03-AUTH-BERECHTIGUNGEN.md` §12.2, K-19) — before the tenant `bewerbung` row is
   created. No automated assignment exists.

One message → one `bewerbung`; attachments become `dokument` rows in the private bucket with real MIME
verification, size limits and EXIF stripping (DOC-06). CV parsing (REC-04) is a separate step
producing a **proposal** a human confirms — no automated decision about a person (REC-08, LEG-12,
DSGVO Art. 22).

**The purge closes the loop, and it is wider than the draft said.** REC-07 deletion is a lie if the
original mail sits in IMAP forever, so `/api/cron/bewerber-purge` deletes: the `bewerbung` and
`kandidat` rows through `purge_bewerberdaten(stichtag)`, the documents and their objects, **the
message in the mailbox** (which requires delete permission on that mailbox), **the staging row in
`bewerbung_eingang` and its stored object**, **the `wissens_chunk` embeddings derived from the
application** (AGT-06 indexes correspondence), and **the `agent_schritt` records of the CV parsing**,
which contain the CV text. Each deletion is recorded in `loeschprotokoll`.

**`loeschprotokoll` needs an owner.** It is referenced here and by `05-API-KARTE.md` §C.5 and is
declared by no data-model document, so §31 places that obligation on `02-datenmodell/01-KERN.md`,
beside `audit_log` and `job_lauf`: one append-only row per deleted subject and category, with
`mandant_id NOT NULL` where the subject had a tenant. A staging row that was never assigned to a
mandant has no tenant to record, so **its** deletion is written to `audit_log` at
`ebene = 'plattform'` (K-16(d)) rather than forcing a tenant onto the row or making a second
`mandant_id` nullable.

`// TODO(client, O-28, O-117): Welche E-Mail-Adresse ist das überwachte Bewerbungspostfach je Gesellschaft, wer administriert es, wer triagiert eine Bewerbung, die an keine der vier Adressen gerichtet ist, und darf die Plattform Nachrichten nach der Übernahme daraus löschen? Ohne Löschrecht ist die DSGVO-Löschung nach REC-07 unvollständig.`

### 19.3 Inbound customer mail — CRM-03, NOT-01

CRM-03 requires the full communication history and NOT-01 requires a notification on „customer
response". The application mailbox does not cover that, and silence would leave a hole someone fills
later with an unreviewed IMAP loop. The same `MailboxPort` serves it with `postfach_kanal.zweck =
'kunde'`, per entity, with the same connection honesty and the same triage rule (a message that
matches no `kunde`, `lead` or `auftrag` reference is staged for a human, never auto-linked). Until a
mailbox is configured, **customer replies are recorded manually** in `lead_aktivitaet` /
`nachricht` — which is stated here so that it is a decision and not an omission.

`// TODO(client, O-131): Soll eingehende Kundenkommunikation automatisch in die Historie übernommen werden (eigenes Postfach je Gesellschaft), oder werden Antworten weiterhin manuell erfasst? (CRM-03, NOT-01)`

---

## 20. Social channels — SOC-05 … SOC-08

One interface, six adapters, one of which is ours.

| | |
|---|---|
| **`SocialChannelPort`** | `pruefe({ beitrag })` (channel constraints, **before** approval) · `veroeffentliche({ mandantId, beitrag, freigabe })` → `{ extern_id, url, veroeffentlicht_am }` · `zurueckziehen({ mandantId, externId, freigabe })` · `authStart({ mandantId })` · `authAbschluss({ code, state })` · `kennzahlen({ mandantId, externId })` — **disabled by default, see below** |
| **EU / DPA** | these platforms are **not processors under our instruction** for published content — they are independent controllers, and page-insight features have been held to create **joint controllership**. An Art. 28 DPA is the wrong instrument; a joint-controller arrangement plus legal review is required before any channel goes live |
| **Failure** | not connected → the channel tile shows `Nicht verbunden`, the composer disables that target, and a scheduled post to it stays `wartet` with `uebersprungen_nicht_verbunden` on the target row and is **never** marked `veroeffentlicht`; expired token → `gestoert`, „Zugang abgelaufen — neu verbinden", posts are not silently dropped; publish error → **no auto-retry**, it surfaces in the approval inbox |

| Channel | API | Credentials | Practical hurdle | Status |
|---|---|---|---|---|
| **CSE profile (own website)** | internal: `social_post` → area profile (SOC-05, PRO-04) | none | none | **Verbindbar** |
| Instagram | Instagram Graph API via a Meta app | `META_APP_ID` / `META_APP_SECRET`, professional account linked to a Page, long-lived Page token | app review for publishing; ~60-day token refresh | Nicht verbunden (O-10) |
| Facebook | Pages API | as above, Page access token | app review, Page role | Nicht verbunden (O-10) |
| LinkedIn | organization posts API | `LINKEDIN_CLIENT_ID` / `_SECRET`, org-admin OAuth | community-management access approval | Nicht verbunden (O-10) |
| TikTok | Content Posting API | `TIKTOK_CLIENT_KEY` / `_SECRET`, OAuth | app audit, direct-post permission | Nicht verbunden (O-10) |
| YouTube | Data API v3 `videos.insert` | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, channel-owner consent | daily quota units | Nicht verbunden (O-10) |

- **Tokens are never in env and never in a table.** Only app-level client ids and secrets are env
  values; the per-mandant OAuth token lives in the Supabase Vault and `social_channel` holds
  `credential_ref` plus `token_gueltig_bis` — the shape `02-datenmodell/06-RADAR-KI-INHALT.md` §5.6
  fixes (SEC-A5).
- **Token expiry is monitored, or SOC-06 dies at the worst moment.** Meta's page tokens last roughly
  60 days. A daily job compares `token_gueltig_bis` against `now()` and raises an escalating notice at
  14 / 7 / 1 days, plus an alert in the §23 list; an expired token sets `verbindungs_status =
  'gestoert'` with the reason. A token that cannot be refreshed is a human task, never a silent stop.
- `veroeffentliche` requires a `Freigabe` whose `payload_hash` covers text, hashtags, media ids and
  the **target channel list** — editing after approval invalidates it (SOC-08, APR-07, §4.1).
- `pruefe()` validates caption length, media aspect, video length and hashtag count **before** a human
  approves, so an approval is not wasted on a post the channel will reject.
- Content draws on real projects and released references (`freigegeben_vom_kunden = true`, PRO-05,
  SOC-04). Publishing photos of identifiable employees requires a **written release**; the release
  reference is stored on the media record and the composer refuses a media item without one.
- **`kennzahlen()` ships disabled.** Page insights are the very feature that creates the joint
  controllership named above, and SPEC §21 / PUB-13 keep analytics server-side over our own events
  (`kanal_statistik`, REP-03). The method exists so the boundary is visible in code; it stays behind a
  per-channel switch that cannot be turned on before the legal review of O-10, and
  `kanal_statistik` distinguishes `NULL` ("not retrievable") from `0` ("zero") rather than filling
  gaps.

`// TODO(client, O-10): Welche Social-Media-Konten existieren (Instagram, Facebook, LinkedIn, TikTok, YouTube), je Marke oder je Gruppe, wer ist Inhaber und Administrator, und wer erteilt den API-Zugriff? (SOC-06)`
`// TODO(client, O-13): Liegen schriftliche Einwilligungen der abgebildeten Beschäftigten für die Veröffentlichung von Fotos vor, und wer verwahrt sie? (SOC-04, PRO-05)`

---

## 21. Job boards — REC-09

| | |
|---|---|
| **`JobBoardPort`** | as §4.2 — every publishing method takes a `Freigabe` |
| **Credentials** | per board, once real employer accounts exist — **none today**; `jobboard_kanal.api_verfuegbar` records whether the provider has an official API at all |
| **EU / DPA** | per board; boards are independent controllers for a published advert. **Unknown** |
| **Failure** | not connected → the career page (our own channel) keeps working and adverts stay internal; publish error → **no auto-retry** (duplicate adverts cost money) |
| **Status today** | Nicht verbunden (O-10) |

Only boards with a **real API and real credentials** are implemented (REC-09); no board is built
speculatively, and `CHECK (verbindungs_status <> 'verbunden' OR (api_verfuegbar AND credential_ref IS
NOT NULL))` makes "connected" unreachable without both. **No scraping in either direction** (D-02):
no reading of Indeed/StepStone listings, no automated candidate extraction — recruiting is inbound
(REC-03). The honest fallback is `FeedAdapter`: a signed, token-protected, rate-limited XML/JSON feed
of `stelle` rows at a stable URL that any board which *pulls* adverts can subscribe to. It genuinely
exists; it is not a simulation. Applications always return through REC-03.

`// TODO(client, O-10): Bei welchen Stellenbörsen bestehen Arbeitgeberkonten, und bietet eine davon eine offizielle API oder einen Feed-Import an? Ohne echte Zugangsdaten bleibt die Schnittstelle „nicht verbunden". (REC-09)`

---

## 22. n8n — external glue only — SPEC §21

| Rule | Enforcement |
|---|---|
| **No database credentials for n8n** | it never receives a Postgres URL, a `cse_*` role or a service-role key; it talks to our HTTP API only |
| **No business logic, no arithmetic** | it may not compute an amount, a duration, a deadline or a number circle |
| Authorisation | it authenticates as the machine principal `n8n_service` with a scoped role and an allowed `mandant_id`; every call is authorised like a human request (AUT-04) and audited with `akteur_art = 'system'` (SEC-A9) |
| Inbound (n8n → us) | HMAC-SHA256 over the raw body with `N8N_WEBHOOK_SECRET`, timestamp header, ±5 min replay window, `Idempotency-Key` required on writes and recorded in `idempotenz_schluessel` |
| Outbound (us → n8n) | signed, fire-and-forget, never in a request path; a failure never fails a user action |
| Outbound content | still passes our policy gate first — n8n cannot route around invariant 7 |
| Hosting | self-hosted in the EU or an EU-region cloud instance, with a DPA if third-party hosted |
| **Failure isolation proven in CI** | the full e2e suite runs with n8n disabled and must stay green; if a test fails without n8n, business logic has leaked into a workflow |
| Status today | Nicht verbunden — no instance, no secret (O-123) |

`// TODO(client, O-123): Wird n8n selbst gehostet (wo, durch wen) oder als EU-Cloud-Instanz betrieben, liegt ein AV-Vertrag vor, und welche externen Werkzeuge sollen überhaupt angebunden werden?`

---

## 23. Monitoring, health, alerting — SPEC §21

The **default adapters are real**: structured JSON logging to stdout is genuine observability on
Vercel and Supabase, so "not connected" here loses detail, never truth.

| | |
|---|---|
| **Methods** | `ErrorReporterPort.erfasseFehler({ fehler, kontext })` · `erfasseMeldung({ text_schluessel, stufe, kontext })` · `MetricsPort.zaehle` / `messe` · `AlertPort.alarmiereIntern` / `alarmiereExtern` (§4.2) |
| **Credentials** | `ERROR_REPORTER_DSN` / `ERROR_REPORTER_ENV` — none configured; the stdout adapter is active |
| **EU / DPA** | an external reporter must offer an EU region and a DPA; **none chosen (O-118)**. PII scrubbing is mandatory either way: ids and codes only |
| **Failure** | reporter unreachable → the error is still logged locally; fire-and-forget never blocks a request; a failing external monitor must not be able to hide a failing job, which is why failed-job alerting derives from **our own** `job_lauf` and `job_plan` tables (§3.7) |
| **Status today** | Verbindbar (stdout); external provider Nicht verbunden (O-118) |

### 23.1 `/api/health` is split, because one endpoint cannot be both public and detailed

An unauthenticated endpoint that enumerates providers, last error codes and the migration version is
free reconnaissance for an attacker. Two surfaces:

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/health` | none | `{ status, build_id, region, db_erreichbar }`. This is what an external uptime probe checks, alongside the public homepage |
| `GET /api/verwaltung/integrationen` | session, `system.einstellung_lesen` | per-integration status, `blockiert_durch`, last success, last error code, clock drift versus Postgres, `migration_ok`, overdue jobs as a count **and** by name (`05-API-KARTE.md` §C.1, `GET /api/health`) |

Neither returns business data counts, and neither returns a secret.

**Why liveness no longer publishes `migration_ok` and `jobs_ueberfaellig`.** Both are table reads —
the migration table, and `job_plan ⋈ job_lauf` — and an unauthenticated request has no session, so it
would need a database path outside `withTenant` / `withGroupScope`. K-08's register is closed at five
functions and K-01 gives `cse_anon` **no table grants at all**; adding a sixth function here would
have to amend a binding convention from a domain document, which is exactly backwards. So the two
counts move to the authenticated surface, where they were always more useful (overdue jobs are
actionable only by name), and the liveness endpoint keeps what it can prove without reading anything:
`db_erreichbar` is a `SELECT 1` on the `cse_anon` pool, which touches no table, needs no grant and is
therefore not a data path in K-08's sense.

**The case the public counts were meant to cover is covered by a push, not a pull.** "The platform's
own alerting is the thing that broke" is answered by the dead-man's switch of §3.7: the
`job-heartbeat` run pings the external uptime monitor on success, and the monitor alerts when the
ping stops. A pull would have required handing a session-less caller a table read; a push requires
nothing of the database at all. Until an uptime service exists (O-118) the switch has no receiver,
`/api/verwaltung/integrationen` shows the overdue jobs, and **nothing pretends the watchdog is
armed.**

### 23.2 Alerts that must exist

Invoice hash-chain break (FIN-06, nightly, immediate) · `freigabe_snapshot` chain break (K-13) ·
tomorrow's shift unstaffed (daily 18:00 Berlin) · certificate expiring 60/30/7 days (SEC-02) ·
overdue scheduled job (§3.7) · integration `gestoert` · social token expiring 14/7/1 days (§20) ·
mailbox silent (§19.2) · AI budget cap reached (AGT-05) · clock drift above ±2 s · backup failed ·
restore drill overdue. Alerts appear **in-app always**; email only through the gate; an alert is never
the only record of the fact it reports.

`// TODO(client, O-118): Welche Dienste für Fehler-Tracking, Uptime-Überwachung und Log-Weiterleitung sind freigegeben (EU-Region und AV-Vertrag), oder sollen selbst gehostete Alternativen betrieben werden?`

---

## 24. Backups and the tested restore — SEC-A10, LEG-01

Three layers, because a backup inside the same provider account does not survive the loss of that
account.

| Layer | What | Where | Frequency | Retention |
|---|---|---|---|---|
| 1 | Point-in-time recovery | inside the Supabase project, EU | continuous | per plan |
| 2 | Daily snapshot | inside the project, EU | daily | per plan |
| 3 | **Independent encrypted dump** (database **and** storage objects) | a separate EU object store, different account | daily | **PLACEHOLDER — not chosen (O-119)** |

| | |
|---|---|
| **`BackupPort`** | `sichereDatenbank({ stand })` · `sichereSpeicher({ buckets, stand })` · `listeSicherungen()` · `pruefeWiederherstellung({ sicherung, ziel: 'scratch' })` |
| **Credentials** | `BACKUP_TARGET_URL` · `BACKUP_ACCESS_KEY` · `BACKUP_SECRET_KEY` · `BACKUP_RECIPIENT_PUBLIC_KEY` — none configured |
| **EU / DPA** | EU object storage with a DPA required; **none chosen (O-119)** |
| **Failure** | backup job fails → alert the same day; missing monthly restore entry → alert, because an untested backup is not a backup; the job **refuses to write plaintext** if no recipient public key is configured |
| **Status today** | Nicht verbunden (O-119); layers 1–2 exist as soon as the Supabase project does |

- **Storage objects are backed up too.** A database dump does not contain the files in Supabase
  Storage; invoice PDFs, signed Leistungsnachweise, Aufmaß and Wachbuch photos are **evidence**, and
  losing them while keeping their rows is worse than useless.
- **Key custody, stated so the drill is possible.** The earlier draft required both that the private
  key be "escrowed offline with the client, never in an environment variable" and that a monthly
  restore drill run — which cannot both be true, because the drill must decrypt. The custody model
  is therefore explicit: the platform encrypts to a **public** key and can never read its own
  backups back; **the drill is a human-attended procedure** in which a named key custodian supplies
  the private half into an ephemeral scratch environment, and the environment is destroyed
  afterwards. `restore_protokoll.schluessel_verwendet_von` records who supplied it and
  `bestaetigt_von` who signed the result off. If the client prefers an unattended drill, that
  requires a **second** escrowed key pair whose private half is held by a named operator for drills
  only — which is a client decision, not ours.
- sha256 per artifact, verified on restore.
- **Monthly tested restore** into a scratch project, recorded in `restore_protokoll` (§3.8).
  Acceptance checks: (1) row counts per critical table within tolerance; (2) **the invoice hash chain
  verifies end to end** (FIN-06) — the strongest single proof the finance data is intact; (3) a
  tenant-isolation spot check (SEC-A3); (4) a signed Leistungsnachweis PDF opens from restored
  storage; (5) the latest DATEV export matches its recorded sha256.
- Backups are not the GoBD archive: the `archiv` bucket is (10 years, deletion blocked). Applicant
  purge (REC-07) is immediate in live data and reaches backups only through rotation — which is why
  the rotation window is a **client decision and not a number this document invents**: retention of
  financial and employment data is a legal matter (GoBD ten years for the archive, §17 MiLoG two
  years for hour records, DSGVO minimisation for applicant data), and it is decided together with the
  LEG-09 deletion concept.

`// TODO(client, O-119): Wo liegen die unabhängigen verschlüsselten Sicherungen von Datenbank und Dateispeicher (EU-Anbieter, Konto, Region), welche Aufbewahrung gilt (täglich/monatlich/jährlich), wer verwahrt den privaten Schlüssel, wer stellt ihn für den monatlichen Wiederherstellungstest bereit, und wer bestätigt das Ergebnis? (SEC-A10, LEG-09)`

---

## 25. Handovers, exports and migrations

### 25.1 Handovers to professional recipients — ACC-09, ACC-10, ACC-11, ACC-12, DOC-08

Four artifacts leave the platform for a human professional, exactly like the DATEV export, and each
needs a producer, a bucket and a retention rule rather than an ad-hoc download.

| Artifact | Port / producer | Storage | Rule |
|---|---|---|---|
| **Z3 export** (§147 Abs. 6 AO) — ACC-09 | `services/buchhaltung/z3-export.ts`, pure code | `archiv` bucket, deletion blocked | the description file and the data must match; the export is recorded as a `datev_export` sibling row with its sha256 |
| **Verfahrensdokumentation** — ACC-10 | generated, not written by hand | `archiv` | **generated from live configuration**: the `integration_katalog` + `integration_konfiguration` register of §3, the DPA table of §28, the number circles, the retention catalogue and the role matrix. A hand-written document drifts from the system within a quarter |
| **Year-end package** — ACC-11 | assembles the finalised invoices, bookings, exports and their hashes | `archiv` | one bundle per Wirtschaftsjahr per mandant, immutable |
| **Audit bundle** — DOC-08 | one-click bundle for an audit or inspection | `archiv` | scoped to what the requester may see; every generation audited |
| **Payroll export** — ACC-12 | `PayrollExportPort`, **not connected** | `dokumente`, retention per catalogue | **per `anstellung`, per mandant, never aggregated per person** — D-09: hours and rates belong to one entity, and a per-person file would carry security wage data into a cleaning payroll run. The ArbZG aggregate of K-06 is the only per-person view, and it carries no rates |

None of these lands in a swept scratch bucket; there is no such bucket (§6.4). Their retention is the
`dokument_aufbewahrung` catalogue, not a nightly cron.

`// TODO(client, O-27): Welches Lohnsystem empfängt den Zeitdatenexport nach ACC-12, in welchem Format, und je Gesellschaft getrennt?`

### 25.2 The two ports that exist so that a *non*-integration is visible in code

**`GeocodingPort`** (address → coordinates, OPS-01) — `nicht_verbunden`. Coordinates are entered
manually and every consumer works without them. A provider must be EU-hosted or self-hosted, because
a customer address is personal data. **The dependency is stated because it is silent otherwise:**
`WeatherPort.beobachtung` takes lat/lon from `objekt`, so a construction site with no coordinates gets
no weather, and BAU-08 must report *that* reason („Keine Koordinaten am Objekt hinterlegt") rather
than „DWD hatte keine Daten" (§16).

**`VatIdPort`** — §12.4.

`// TODO(client, O-122): Soll die Adresse eines Objekts automatisch in Koordinaten aufgelöst werden, und mit welchem EU-gehosteten oder selbst betriebenen Dienst (Kundenadressen sind personenbezogene Daten)? (OPS-01, BAU-08)`

### 25.3 Migration from the existing tools — ROADMAP Phase 10

ROADMAP Phase 10 names Aplano (scheduling and time), Lexware (accounting) and Excel by name, and
none of them has an importer, a format or an open question yet. This matters more than a normal
import: historical time records are **§17 MiLoG evidence** (two-year retention, LEG-02) and
historical invoices are **GoBD data** (ten years, LEG-01), so how they arrive and where they land is a
compliance question, not a convenience.

| Source | Port | Rule |
|---|---|---|
| Aplano | `MigrationImportPort` adapter, file-based | shifts and time entries import as historical rows flagged `quelle = 'migration'` with the original export file stored in `archiv`; they are **never** re-derived, never re-costed, and a migrated `zeiteintrag` carries no server-clock claim it cannot support (invariant 5) |
| Lexware | same port | finalised invoices import as **evidence**, not as new invoices: they never enter a `nummernkreis`, never join the hash chain, and are marked `extern_abgeschlossen` so FIN-16 shows the break in provenance honestly |
| Excel | same port | preview before commit, the OPS-04 discipline (§13) |

`// TODO(client, O-128): In welchem Format lassen sich Aplano, Lexware und die bestehenden Excel-Dateien exportieren, welcher Zeitraum soll übernommen werden, und müssen die historischen Daten revisionssicher im GoBD-Archiv landen oder genügt die Aufbewahrung im Altsystem? (ROADMAP Phase 10, LEG-01, LEG-02)`

---

## 26. Deliberately not integrated — manual by design

Naming these prevents someone building a fake version later.

| Surface | Why not | What we do instead | SPEC |
|---|---|---|---|
| Procurement platform submission | no submission API; accounts tied to natural persons, some need an electronic signature | the agent assembles the complete `vergabemappe` and names every gap; a human uploads; `mandant_plattform_registrierung` tracks registrations per entity | RAD-09, D-07 |
| Bewacherregister | no automated company query assumed | `bewacher_eintrag` per `person_id` with Bewacher-ID, status, evidence and `geprueft_am` / `geprueft_von`; the §34a hard block reads our own data and depends on no external call | SEC-03, SEC-04 |
| §48b Freistellungsbescheinigung (BZSt) | no API assumed | §12.3 | FIN-10, LEG-06 |
| Payroll calculation | out of scope (D-06) | ACC-12 export, §25.1 | ACC-12 |
| Job-board scraping | ToS violation + DSGVO exposure | inbound applications only | REC-03, D-02 |
| Cold outreach lists | §7 UWG | outbound only to contacts with a recorded `rechtsgrundlage` | CRM-08, LEG-08, D-01 |
| Map embeds / tile providers | a third-party embed reintroduces trackers and a cookie banner | address and coordinates as text plus a static self-hosted image; a link opens the user's own map app | PUB-13, OPS-01 |
| Web-font CDN | transmits visitor IPs to a third country | Inter and Caveat self-hosted via `next/font`, `font-src 'self'` | PUB-13, SEC-A7 |
| Machine translation for EMP-12 | a mistranslated Dienstanweisung is a liability | de/en/ar/tr catalogues in the repo; AI may draft, a human approves before it ships | EMP-12 |
| Client-side analytics | PUB-13 — no third-party trackers, hence no cookie banner | server-side counting of our own events (`kanal_statistik`, REP-03) | PUB-13, REP-03 |
| iCal (CAL-03) | not an integration — we serve it | read-only feed per user at an unguessable, revocable, rate-limited token URL, no write path; the read is `app.ical_feed_lesen(feed_token_hash)` as `cse_anon`, the fifth and last entry on K-08's closed register, and it opens no session helper | CAL-03 |
| Geolocation at check-in | a browser API, not a service | one point at start and end, never continuous; ships only once O-06 (Betriebsrat) is answered. The switch is a **`mandant_einstellung` key** — `zeit.geolokalisierung` and its siblings, read through `app.einstellung(...)` and gated by the `z_geo_gate` trigger of `02-datenmodell/04-PLANUNG-ZEIT.md` §1.15 — **not** a `mandant.geo_erfassung_aktiv` / `mandant.ueberwachung_aktiv` column (K-21) | LEG-10, O-06 |

---

## 27. The status surface in the UI — SOC-07 generalised, D-10

„Not connected" must appear **where the action lives**, not only on an admin page: the publish
button, the DATEV screen, the worker login screen, the recruiting inbox, the invoice delivery panel.
The settings overview `/portal/[mandant]/einstellungen/integrationen` (`04-SEITENKARTE.md` §5.24)
lists all of them with the blocking question id beside each.

Five status words are rendered, and **none of them exists in the DESIGN §5 status-pill vocabulary
today**: `Verbunden`, `Bereit`/`Verbindbar`, `Nicht verbunden`, `Gestört`, `Blockiert`. Per **D-10**
the design system is a document and not a habit, so all five are added to `docs/DESIGN.md` §5
**first** and used afterwards — no ad-hoc colour, no one-off pill.

| Word | Semantic colour | Meaning |
|---|---|---|
| `Verbunden` | success | live credentials, verified |
| `Verbindbar` | success | public or local; nothing to obtain |
| `Nicht verbunden` | muted on `--surface-3` | no credentials or no decision; the NotConnectedAdapter is active |
| `Gestört` | danger | breaker open or repeated failures; the reason is shown |
| `Blockiert` | warning | a **rendering** of `nicht_verbunden` with `blockiert_durch` set — not a sixth status kind |

The reason text is an i18n key (§2), so a worker-facing surface renders it in de / en / ar / tr
(EMP-12).

---

## 28. DPA and data-residency register — D-04, LEG-09

**No DPA is on file.** Nothing in this repository evidences a signed agreement with any processor, so
every row is `offen` (required, not signed) or `unbekannt` (not established).
**Rolle:** `AV` = Auftragsverarbeiter (Art. 28) · `eigenv.` = independent controller ·
`gemeinsam` = joint controller. This table is the source ACC-10's Verfahrensdokumentation is generated
from (§25.1), and it is also the Art. 30 processing register LEG-09 requires.

| # | Empfänger | Zweck | Rolle | Region | AV-Vertrag | Personenbezogene Daten | Ref |
|---|---|---|---|---|---|---|---|
| 1 | Supabase | Datenhaltung, Anmeldung, Dateien, Cron | AV | EU Frankfurt (**muss** so angelegt werden) | **offen** | Beschäftigtenstammdaten, Zeiterfassung, Abwesenheiten (gesundheitsnah), Bewerberdaten, Kundenkontakte, Finanzdaten, Fotos, IP | D-04 |
| 2 | Vercel | Hosting, Serverfunktionen, Bildoptimierung | AV | Funktionen `fra1`; Edge-Netz global — Logs prüfen | **offen** | IP, Session, alle im Request verarbeiteten Daten | D-04 |
| 3 | OpenAI | Entwürfe, Klassifikation, Belegextraktion, Embeddings | AV | EU-Verarbeitung + Zero-Retention **je Modell nachzuweisen** | **offen** | Inhalte übergebener Dokumente und Texte (nach Redaktion) | AGT-* |
| 4 | SMS-Anbieter | Anmelde-Codes, Check-in-Links | AV | EU erforderlich | **offen — kein Anbieter (O-82)** | Mobilfunknummer, Anmeldezeitpunkt | EMP-01 |
| 5 | E-Mail-Versand | Benachrichtigungen, Angebote, Rechnungen, Mahnungen | AV | EU erforderlich | **offen — kein Anbieter (O-116)** | Name, E-Mail, Inhalte inkl. Rechnungsanhängen | NOT-01 |
| 6 | Bewerbungspostfach | Eingang Bewerbungen | AV | EU erforderlich | **offen (O-28)** | Bewerberdaten: Name, Kontakt, Lebenslauf, Zeugnisse, Foto | REC-03 |
| 7 | Kundenpostfach (falls angebunden) | Eingang Kundenkommunikation | AV | EU erforderlich | **offen (O-131)** | Kundenkontaktdaten, Nachrichteninhalte | CRM-03 |
| 8 | E-Rechnungs-Zustellung (Peppol-Zugangspunkt) | Übermittlung XRechnung | AV (Zugangspunkt) / eigenv. (öffentlicher Auftraggeber) | EU erforderlich | **offen (O-22)** | Rechnungsdaten, Ansprechpartner | FIN-11 |
| 9 | Fehler-Tracking / Log-Weiterleitung | Betriebsüberwachung | AV | EU erforderlich | **offen (O-118)** | technische Kennungen; PII durch Scrubbing ausgeschlossen | §21 |
| 10 | Uptime-Überwachung | Erreichbarkeit | AV | EU bevorzugt | **offen (O-118)** | keine (nur `/api/health`) | §21 |
| 11 | Backup-Objektspeicher | verschlüsselte Sicherungen | AV | EU erforderlich | **offen (O-119)** | vollständiger Datenbestand, verschlüsselt | SEC-A10 |
| 12 | n8n-Hosting | externe Verknüpfungen | AV | EU (self-hosted oder EU-Cloud) | **offen (O-123)** | je Workflow, minimiert | §21 |
| 13 | Geocoding-Dienst | Adresse → Koordinaten | AV | EU erforderlich | **offen (O-122)** | Kundenadressen | OPS-01 |
| 14 | GitHub (Repo, Actions) | Quellcode, CI | AV | Region prüfen; **keine Produktionsdaten in CI** | **unbekannt** | keine (Fixtures sind synthetisch) | SEC-A8 |
| 15 | Meta (Instagram, Facebook) | Veröffentlichung | eigenv. / bei Seiten-Insights **gemeinsam** | Drittland | **entfällt — AV ist das falsche Instrument; Joint-Controller-Vereinbarung + Rechtsprüfung** | veröffentlichte Inhalte, ggf. abgebildete Beschäftigte | SOC-06 |
| 16 | LinkedIn | Veröffentlichung | eigenv. / ggf. gemeinsam | Drittland | **entfällt — wie 15** | wie 15 | SOC-06 |
| 17 | TikTok | Veröffentlichung | eigenv. | Drittland | **entfällt — wie 15** | wie 15 | SOC-06 |
| 18 | YouTube (Google) | Veröffentlichung | eigenv. | Drittland | **entfällt — wie 15** | wie 15 | SOC-06 |
| 19 | Stellenbörsen | Stellenanzeigen | eigenv. | je Anbieter | **unbekannt (O-10)** | keine Bewerberdaten über die Börse | REC-09 |
| 20 | Deutscher Wetterdienst | Wetter im Bautagebuch | — | DE | **entfällt — kein Auftragsverarbeiter** | keine | BAU-08 |
| 21 | oeffentlichevergabe.de | Bekanntmachungen | — | DE | **entfällt — kein Auftragsverarbeiter** | berufliche Kontaktdaten der Vergabestelle **sind personenbezogen** und stehen im Verarbeitungsverzeichnis | RAD-01 |
| 22 | TED (EU) | Bekanntmachungen | — | EU | **entfällt — wie 21** | wie 21 | RAD-02 |
| 23 | EU VIES | USt-IdNr.-Prüfung (innergemeinschaftlich) | — | EU | **entfällt — kein Auftragsverarbeiter** | USt-IdNr.; bei Einzelunternehmern **personenbezogen** | §12.4 |
| 24 | Feiertags-Datenquelle (Gegenprüfung) | gesetzliche Feiertage Berlin | — | EU/lokal | **entfällt** | keine | CLN-03 |
| 25 | KoSIT-Validator, veraPDF, EXTF-Writer, CAMT-Parser, GAEB-Parser | Prüfung und Erzeugung von Dateien | **lokal — kein Empfänger** | im eigenen System | **entfällt** | Daten verlassen das System nicht | FIN-11, FIN-12 |
| 26 | Steuerberater (DATEV-Übergabe) | Buchführung | eigenv. (Berufsträger) | DE | **unbekannt — vertragliche Grundlage beim Mandanten** | Buchungs- und Belegdaten | ACC-02 |
| 27 | Lohnbüro / Lohnsystem | Zeitdaten je Anstellung | eigenv. oder AV, je nach Konstellation | DE | **unbekannt (O-27)** | Beschäftigtendaten, Stunden je Anstellung | ACC-12 |
| 28 | Bank (CAMT.053) | Kontoumsätze | eigenv. | DE/EU | **entfällt** | Zahlungsdaten, IBAN, Verwendungszweck | ACC-04 |

**Two points to put in front of the client with this table.**

1. **D-04's tension is unresolved.** Earlier documentation promised *„Server, Daten und Programmcode
   liegen bei Ihnen"* on a German server. A managed, US-headquartered cloud with EU regions is lawful
   with DPAs and transfer safeguards — but it is not that promise. **O-11 must be answered before the
   Supabase project is created**, because moving later means migrating live employee and finance data.
2. **Rows 15–18 are not processor relationships.** Publishing to a social platform is a transfer to an
   independent controller with a joint-controller dimension — a legal decision, not one a codebase can
   settle, and another reason every social channel stays `Nicht verbunden` until O-10 and a legal
   review are done.

**A note on why "no DPA" is correct for rows 20–25 — and why the earlier reasoning was not.** The
draft justified those rows with "tender data is not personal data (contact details of a procuring body
are professional data)". That conclusion is right and the reason is wrong: professional contact data
**is** personal data under Art. 4(1) DSGVO. No DPA is needed because there is **no processor** — we
are the controller reading a public register — not because the data is impersonal. Stated the old
way, the Vergabestelle contacts and a sole trader's USt-IdNr. would fall out of the Art. 30 register
LEG-09 requires. They are in it.

---

## 29. Environment-variable inventory — SEC-A5

**No key ever appears in frontend code.** The only variables that may carry the `NEXT_PUBLIC_` prefix
are the Supabase project URL and the anon key. Enforcement: `process.env` is banned by lint in client
components; CI fails on any `NEXT_PUBLIC_*` matching `KEY|SECRET|TOKEN|PASSWORD|DSN` outside a
two-entry allowlist; a secret scanner runs on every PR; `.env.example` is committed with every
variable, empty values and a one-line German comment; production values exist only in the production
environment and previews never receive them. **A missing variable yields a NotConnectedAdapter, never
a partially configured live client.**

`cse.fenster_schluessel` steht bewusst **nicht** in der Umgebung, sondern als
Datenbankeinstellung (`alter database … set cse.fenster_schluessel = '<base64>'`): er wird
ausschliesslich innerhalb von `SECURITY DEFINER`-Funktionen gelesen, die der Anwendungsprozess
nie zu Gesicht bekommt. Ein Wert, den die Anwendung nicht braucht, gehoert ihr auch nicht in die
Umgebung. In einer Tabelle steht er ebenfalls nicht — ein Datenbankabzug erlaubte sonst, die
`fenster_gruppe`-Werte auf Zuordnungen zurueckzurechnen. Die Testdatenbank setzt einen
offensichtlichen Testwert (`scripts/test-db.sh`); ein echter Schluessel im Repository waere keiner.

Per-integration credentials that belong to a **mandant** are not env values at all: they live in the
Supabase Vault, referenced by `credential_ref` (§3.3, §20). Env carries only application-level
identifiers and platform secrets.

| Variable(s) | Used by | Secret | Boot-required | If missing | Owner | Rotation |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server request context; browser for auth flows only | no (RLS-guarded) | yes | boot fails | Plattformbetrieb | on project change |
| `SUPABASE_DB_URL_APP` | request path, role `cse_app` | **yes** | yes | boot fails | Plattformbetrieb | 90 days |
| `SUPABASE_DB_URL_JOB` | `/api/cron/*`, role `cse_job` | **yes** | yes | all scheduled jobs fail closed | Plattformbetrieb | 90 days |
| `SUPABASE_DB_URL_DIRECT` | migrations, role `cse_migrator` | **yes** | CI only | migration fails | Plattformbetrieb | 90 days |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/server/platform/**` only — Storage/Auth admin, never SQL (§6.1) | **yes** | yes | storage admin unavailable | Plattformbetrieb | 90 days |
| `SUPABASE_PROJECT_REF` | health endpoint, ops scripts | no | no | health shows unknown | Plattformbetrieb | — |
| `APP_BASE_URL` | links in mail, check-in tokens, iCal | no | yes | boot fails | Plattformbetrieb | — |
| `CRON_SECRET_<job>` | `pg_cron` → `/api/cron/<job>`, one per job | **yes** | yes | that job fails closed and is reported as `abgelehnt` | Plattformbetrieb | 90 days |
| `CHECKIN_TOKEN_SECRET` | TIM-07 token signing | **yes** | **yes — boot fails** | boot fails (a signing key that is optional makes forged tokens a configuration accident) | Plattformbetrieb | 180 days |
| `ICAL_FEED_SECRET` | CAL-03 feed tokens | **yes** | no | iCal feed disabled | Plattformbetrieb | 180 days |
| **Datenbankeinstellung** `cse.fenster_schluessel` (nicht env) | K-06 — der HMAC hinter `fenster_gruppe` in `app.arbzg_belastung` | **yes** | **yes, vor dem ersten ArbZG-Lauf** | `app.arbzg_belastung` wirft „unrecognized configuration parameter" und die Pruefung faellt **laut** aus. Das ist die gewollte Richtung: eine ArbZG-Pruefung, die ohne Schluessel still ein leeres Ergebnis lieferte, bestuende immer | Plattformbetrieb | 180 days |
| `INTEGRATION_FORCE_NOT_CONNECTED` | registry override (staging, e2e) | no | no | empty | Entwicklung | — |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_PROJECT_ID`, `OPENAI_ORG_ID` | AI ports | **key: yes** | no | AI `nicht verbunden` | Geschäftsführung / IT | 180 days |
| `OPENAI_DATA_RESIDENCY` | must equal `eu` | no | no | **adapter refuses to go live** | Geschäftsführung | — |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` | `SmsPort` | **yes** | no | EMP-01 login unavailable (O-82) | offen | 180 days |
| `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_WEBHOOK_SECRET` | `MailerPort` | **yes** | no | in-app notifications only (O-116) | offen | 180 days |
| `MAILBOX_HOST/_PORT/_USER/_PASSWORD` or `MAILBOX_WEBHOOK_SECRET` | `MailboxPort` | **yes** | no | mailbox intake off (O-28) | offen | 180 days |
| `OEV_API_BASE`, `TED_API_BASE`, `TED_API_KEY` | tender ingest | key: **yes** | no | that source's ingest off | Plattformbetrieb | — |
| `DWD_OPENDATA_BASE` | `WeatherPort` | no | no | BAU-08 weather off | Plattformbetrieb | — |
| `FEIERTAGE_QUELLE` | holiday cross-check adapter | no | no | cross-check off; the computed table stays authoritative | Plattformbetrieb | — |
| `META_APP_ID/_SECRET`, `LINKEDIN_CLIENT_ID/_SECRET`, `TIKTOK_CLIENT_KEY/_SECRET`, `GOOGLE_OAUTH_CLIENT_ID/_SECRET` | social channels (app level only; tokens in the Vault) | **yes** | no | channels `nicht verbunden` (O-10) | Marketing / IT | per platform policy |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `N8N_SERVICE_TOKEN` | n8n glue | **yes** | no | glue off, core unaffected | offen | 90 days |
| `ERROR_REPORTER_DSN`, `ERROR_REPORTER_ENV` | `ErrorReporterPort` | **yes** | no | stdout adapter (real) | offen | 180 days |
| `UPTIME_PING_URL` | the `job-heartbeat` dead-man's switch (§3.7, §23.1) | no | no | no ping is sent and the UI says the watchdog is **not connected** — never a silent no-op | offen (O-118) | on provider change |
| `BACKUP_TARGET_URL`, `BACKUP_ACCESS_KEY`, `BACKUP_SECRET_KEY` | `BackupPort` | **yes** | no | independent backups off — alert | offen | 90 days |
| `BACKUP_RECIPIENT_PUBLIC_KEY` | encryption recipient (public key only) | no | no | job refuses to write plaintext | Schlüsselverwahrer (O-119) | on key rotation |
| `GEOCODING_PROVIDER`, `GEOCODING_API_KEY` | `GeocodingPort` | **yes** | no | manual coordinates (O-122) | offen | 180 days |
| `VIES_BASE_URL` | `VatIdPort` | no | no | verification unavailable, never blocking | Plattformbetrieb | — |
| `KOSIT_VALIDATOR_VERSION`, `KOSIT_CONFIG_VERSION`, `VERAPDF_VERSION` | CI only | no | CI: yes | CI fails | Entwicklung | on ruleset update |
| `VERCEL_REGION`, `VERCEL_ENV` | platform-provided, asserted `fra1` in prod | no | — | deploy assertion fails | Plattformbetrieb | — |

Owners marked `offen` become concrete when the corresponding question is answered; the rotation
intervals are the operational defaults this document proposes and are confirmed with the security
concept — they are not legal values, so they need no client decision, but they do need an owner.

**Deliberately *not* environment variables:** DATEV Beraternummer and Mandantennummer, Kontenrahmen,
Sachkontenlänge, Steuerschlüssel, fiscal-year start, mail sender identity per entity, social account
ids and tokens, radar CPV profiles, the AI budget cap, and the signed-URL TTL. These are per-mandant
business configuration (DB rows), Vault entries, or code constants; in env they would be unversioned,
invisible to the audit trail and impossible to differ per mandant — and TEN-08 requires a fifth
business area to be a database row, not a deployment change.

---

## 30. CI gates owned by this section

| Gate | Fails when |
|---|---|
| Boundary lint | `src/app/**`, `src/lib/**` or an Edge Function imports `src/server/integrations/**`, or a service imports an adapter other than through an injected port |
| Service-role grep | `SUPABASE_SERVICE_ROLE_KEY` is referenced outside `src/server/platform/**` |
| `BYPASSRLS` assertion | any role the application connects as has `rolbypassrls`, or a tenant table lacks `FORCE ROW LEVEL SECURITY` (K-01) |
| RLS coverage | a table added by this layer has `mandant_id` and no K-03 policy pair, or hangs off `anstellung_id`/`person_id` and has no K-04 ceiling, or is written by a `cse_job` run and carries no `t_job` policy (`src/server/db/rls.ts`, which needs a `job` bucket for that last case) |
| Nullable-tenant grep | a table in this layer declares `mandant_id` as nullable. The grep matches the column name exactly, so `bewerbung_eingang.zugeordnet_mandant_id` (§3.10, an assignment record, never an RLS predicate) is untouched, and `audit_log` — K-16(d)'s single exemption — is not this layer's table |
| Public-key grep | a `NEXT_PUBLIC_*` matches `KEY\|SECRET\|TOKEN\|PASSWORD\|DSN` outside the two-entry allowlist |
| Edge-runtime grep | `runtime = 'edge'` on a route touching personal data |
| Browser-client grep | a client component calls `from('<table>')` on a Supabase client |
| **Gate-completeness test** | an exported adapter method in the send set declares `freigabe` as optional or omits it (§4.2) |
| **Read-scope write test** | a send/publish/export/import port method succeeds under `withGroupScope`, `withPersonScope` or `withKundeScope` (invariant 10, K-18) |
| **K-16 common columns** | a table declared in §3 lacks `id uuid primary key default gen_random_uuid()` or `erstellt_am timestamptz not null default now()`, or renames either (§3.2, §3.4, §3.5, §3.7) |
| **Micro-cent containment (K-16(b))** | a `*_mikrocent` column exists outside `agent_schritt`, `agent_kosten`, `agent_reservierung`, `agent_budget` and `agent_preisliste`, or any table of this layer declares a sub-cent money column of its own (§2, §3.5) |
| **Definer register** | a `SECURITY DEFINER` function reachable from this layer is not on the register of §6.2, or lacks `SET search_path = pg_catalog, public`, or does not write `audit_log` (K-01, K-06) |
| **Right-key catalogue (K-19)** | a right-key literal in this layer — a policy, a definer precondition, a route gate, a service check — has no row in the catalogue `03-AUTH-BERECHTIGUNGEN.md` owns. `app.hat_recht()` is false for an unknown key, so an unregistered key is a permanent zero-row surface with no error; the same run fails on a catalogue key no code uses |
| **Accessor scopes (K-20)** | an `app.*` accessor this layer calls has no defined value, or no documented NULL, in one of the four scopes; or a policy reachable from `kunde` scope names the scalar `app.aktueller_kunde()` instead of `= any (app.aktuelle_kunden())`; or `app.portal()` is recomputed from `aktiver_mandant` rather than bound at scope entry (§6.2) |
| **Table ownership (K-21)** | this layer declares a table K-21 assigns to another document (`job_lauf`, `job_lauf_mandant`, `mandant_einstellung`, `nachweis_art`, `sicherheitsvorfall`, `loeschprotokoll`, `steuersatz_gruppe`, `rechnung_beziehung`, `agent_artefakt`), or references one with a column name the owner does not declare (§3.11) |
| **PostgREST exposure (§6.6)** | the exposed-schema setting is anything but `public, app`, or `kern` / `zeit_intern` / `bewerbung_intern` appears in it |
| **Check-constraint sanity** | a migration in this layer declares a `CHECK` containing a subquery — Postgres refuses it, and the failure otherwise surfaces only on first apply (§3.3) |
| **Mandant-binding test** | a `Freigabe` from mandant A is accepted by an adapter running in mandant B |
| **Single-use test** | N concurrent consumptions of one `freigabe` produce exactly one send (K-09) |
| Secret scanning · dependency audit · OWASP ZAP baseline | a credential is committed · a known vulnerability at moderate or above · a new medium+ ZAP finding (SEC-A8) |
| **KoSIT validation (FIN-11)** | a fixture invoice is not valid XRechnung, or the validator is unavailable — never "skipped, assumed valid" |
| **veraPDF (FIN-12)** | a ZUGFeRD fixture is not PDF/A-3 conformant |
| DATEV golden file (ACC-02) | present as an explicitly **pending** test until O-05 delivers a real sample, visible in every run |
| NotConnected contract tests | a NotConnectedAdapter returns anything but a `NOT_CONNECTED` failure, returns `[]` for a read, or mutates state |
| `INTEGRATION_FORCE_NOT_CONNECTED=*` e2e | the platform 500s, or a "not connected" state renders as empty data |
| n8n-disabled e2e | any business flow fails without n8n |
| Tenant isolation (SEC-A3) | a user of area A receives anything but 404 for an entity of area B, including integration-fed rows and `integration_aufruf` |
| ArbZG isolation (K-06) | `app.arbzg_belastung` returns any field identifying a foreign mandant, object, customer or rate |
| Pre-session register (K-08) | a route reaches the database outside `withTenant` / `withGroupScope` / `withPersonScope` / `withKundeScope` / `withAnstellung` / `withSystemTenant`, or calls a session-less function that is not one of K-08's five |
| `pnpm lint:todo` | a `TODO(client, O-nn)` or a `*.platzhalter.ts` carries no `O-nn`, or carries one with no matching entry in `DECISIONS.md` § Open, or an integration folder with a real `<vendor>.ts` has no sub-processor entry (`01-ORDNERSTRUKTUR.md` §11.4). Every `TODO(client)` in this document names its number (§32), so the gate is enabled the day §32 is merged into DECISIONS.md, not blocked on it |
| i18n key coverage | an `IntegrationError.meldung_schluessel` used by a worker-facing surface has no `de/en/ar/tr` entry (EMP-12) |

**Accessibility (PUB-09, LEG-07, BFSG) is not gated here.** WCAG 2.1 AA is a legal requirement and a
Phase 2 acceptance criterion, and it is owned by the public-website and page-map documents; it is
named here only so that it is not lost in the gap between two sections.

---

## 31. Obligations this document places on its siblings

| Document | Obligation |
|---|---|
| `01-ORDNERSTRUKTUR.md` §11.2 | `nicht-verbunden.ts` **returns** a typed `NOT_CONNECTED` result; `NotConnectedError` is thrown only by `index.ts` when a live adapter's config fails to parse (§1.1) |
| `01-ORDNERSTRUKTUR.md` §11 | add `kernel/`, `e-rechnung/` (validator, composer, delivery), `lv/`, `feiertage/`, `geo/`, `steuer/`, `backup/` and `n8n/` to the integration tree, and rename `email/` → `mail/` with the `versand/` and `postfach/` sub-adapters (§1). Every port in the §5 register has a declared not-connected state, so each needs the four-file folder §11.2 mandates |
| `01-ORDNERSTRUKTUR.md` §7 (schema files) | the nine tables of §3 — `integration_katalog`, `integration_konfiguration`, `integration_status_global`, `integration_aufruf`, `integration_aufruf_system`, `modell_register`, `job_plan`, `restore_protokoll`, `mandant_mail_absender` — plus `bewerbung_intern.bewerbung_eingang` (§3.10) have no home in that document's eight-file Drizzle schema list. Add `src/server/db/schema/integration.ts` (and the `bewerbung-intern.ts` companion for the staging schema), or the tables are declared here and generated nowhere. §16's `src/server/db/rls.ts` also needs a **`job` bucket**: three tables of §3 are written by a `cse_job` run and therefore carry a `t_job` policy, and "K-03 permits no `cse_job` policy" must be withdrawn — under FORCE RLS a table `GRANT` is not a policy |
| `01-ORDNERSTRUKTUR.md` §11.2 (KoSIT) | reconcile the two renderings of one component: the **CI** validator stays a test-only concern in `tests/compliance/` with no adapter and no `nicht-verbunden` state, exactly as that document says; the **optional runtime sidecar** is an integration with a not-connected state, used only for the asynchronous post-finalisation report of §10 step 3. Both statements are true of different things, and the register row of §5 now says which (§5, §10) |
| `00-KONVENTIONEN.md` K-08 | **Met.** The register row for `app.checkin_verbrauchen` carries the owner's **five-argument** signature `(p_token_hash text, p_geraete_zeit timestamptz, p_ip inet, p_user_agent text, p_geo jsonb default null)`, as do `02-datenmodell/04-PLANUNG-ZEIT.md` §9 and the three other documents that quote it. Postgres overloads on the argument list and a `GRANT EXECUTE` is per exact signature, so a grant written against the three-argument row reaches no function and the check-in endpoint fails closed (§6.2). The register stays five functions long; only this row's arity changes |
| `02-datenmodell/01-KERN.md` | **declare `job_lauf` once, per K-21**: `id · job text · gestartet_am · beendet_am · ergebnis enum (including `abgelehnt`) · kennzahlen jsonb · fehlertext`, index `(job, gestartet_am DESC)` for the §3.7 heartbeat query, and **no `mandant_id`** — per-tenant results go to **`job_lauf_mandant`** (`job_lauf_id`, `mandant_id`, `ergebnis`, `kennzahlen`), which this layer's cron topology writes (§6.5). K-16(d) keeps `audit_log` as the platform's only tenant-adjacent table with a nullable tenant key. Also declare `mandant_einstellung` (`UNIQUE (mandant_id, schluessel)`) — it carries the O-06 monitoring switches (§26) — and **`loeschprotokoll`**, which §19.2 and `05-API-KARTE.md` §C.5 both use and no data-model document defines. Add schema `bewerbung_intern` to the list of schemas the first migration creates (§3.10, §6.6) |
| `02-datenmodell/02-CRM-OPERATIONS.md` §2 | the e-invoice delivery route stays the **existing** `kunde.uebertragungsweg` enum; this layer mints no `erechnung_route` (§12.1). Two additions are required of that document: a buyer with `xrechnung_pflicht` and no `uebertragungsweg` **blocks** FIN-11 dispatch and raises a task rather than defaulting to a channel, and a Landesportal — if O-22 shows any buyer needs one — becomes a value of `uebertragungsweg` there rather than a second enum here |
| `02-datenmodell/05-FINANZEN.md` | `datev_export` keyed `UNIQUE (mandant_id, von, bis, lauf_nr)` plus a partial unique on the authoritative run; `bankbuchung` keyed `UNIQUE (kontoauszug_id, lfd_nr)` with a content hash, never on `entry_ref`; `rechnung_versand` carries the delivery route as the CRM-declared `uebertragungsweg`, plus the vorgang id and the rejection text |
| `02-datenmodell/06-RADAR-KI-INHALT.md` | `social_channel` keeps `token_gueltig_bis` and gains the expiry watchdog of §20; `postfach_kanal` gains `zweck = 'kunde'`; the `bewerber-purge` job covers `bewerbung_eingang`, `wissens_chunk` and `agent_schritt` (§19.2); `freigabe`, `agent_schritt` and `agent_aufgabe` declare `UNIQUE (mandant_id, id)` so the composite FKs of §3.5 can point at them (K-16); the single-use consumption of §4 uses `status` + `ausfuehrung_status` + `frist` — **no `verbraucht_am`, `verbraucht_durch` or `gueltig_bis` column is to be introduced**, because they would duplicate a state machine §4.2 already has |
| `02-datenmodell/03-GEWERKE.md` | `feiertag` gains `status ∈ (vorschlag, bestaetigt, verworfen)` in its key (§17) |
| `03-AUTH-BERECHTIGUNGEN.md` | as the owner of the one catalogue (**K-19**), it carries the rows this layer's keys resolve against: `system.einstellung_lesen` / `system.einstellung_verwalten` / `system.protokoll_lesen` / `system.betrieb_lesen` cover the tables of §3, including `mandant_mail_absender` (§3.9), and the two staging functions of §19.2 use `recruiting.bewerbung_lesen` and `recruiting.bewerbung_bewerten` — this document mints no key of its own and has withdrawn `recruiting.schreiben`. `withPersonScope` / `withKundeScope` are the read contexts of `/portal/mein/**` and `/portal/kunde/**` and `withGroupScope` is **not** (K-18, §6.2), while every portal write re-enters `mandant` scope through `withAnstellung`. It also owns the HTTP **error-code table**: one status/code pair for a not-connected adapter must survive — either `409 kanal_nicht_verbunden` (which `05-API-KARTE.md` T-30 asserts) or `503 NICHT_VERBUNDEN`, not both, because today a client sees a different status depending on which document the handler was written from. The port-level mechanism is unaffected: adapters **return** `IntegrationResult`, they do not throw (§1.1, §2) |
| `04-SEITENKARTE.md` | the five status words of §27 are added to `docs/DESIGN.md` §5 before they are rendered (D-10) |
| `05-API-KARTE.md` | add `GET /api/health` returning `{ status, build_id, region, db_erreichbar }` only — no `migration_ok`, no `jobs_ueberfaellig`, since an unauthenticated caller may read no table (K-01, K-08, §23.1) — and `POST /api/cron/job-heartbeat`, whose success pings the external uptime monitor as a dead-man's switch; `GET /api/verwaltung/integrationen` gains `migration_ok`, `blockiert_durch` per integration and the overdue jobs by name; add the cron route `/api/cron/e-rechnung-komposition` (§11) to the route map and the cron table; rename `src/server/integrationen/` to `src/server/integrations/` and `integrationen/ki/` to `integrations/openai/` — infrastructure identifiers stay English (CLAUDE.md), and the ESLint `no-restricted-imports` zone of `01-ORDNERSTRUKTUR.md` §16 is written against the English path and would silently not match the German one. R-09's "automatic" system messages are the **pre-approved `systemnachricht` categories** of §4.3, minted by `policy.ts` from a seeded `agent_richtlinie` with `erteilt_von = 'richtlinie:<id>'` — never an ungated send path, and `freigabe` stays a required argument. Its `rechnung_versand` tuple takes the owner's column names from `02-datenmodell/05-FINANZEN.md` §9.6 (`empfaenger_text`, `gesendet_am`, `fehlertext`, `externe_id`), which this document already uses (§3.11) |
| `docs/DESIGN.md` | §5 status-pill vocabulary extended by the five words of §27 |
| `docs/DECISIONS.md` | the questions of §32, and a note under **D-08** that agent cost and budget accounting is `*_mikrocent bigint` (10⁻⁶ €) under **K-16(b)**, converted to cents once, half-up, at the budget boundary — the earlier `kosten_cent` + `kosten_rest` carry pair is withdrawn, and no operational table outside `agent_schritt` / `agent_budget` and their carry columns holds a sub-cent figure (§2, §3.5) |

---

## 32. Open questions this document raises — for `DECISIONS.md` § Open

**The numbering is resolved here, not deferred to a merge.** `docs/DECISIONS.md` holds O-01 and
O-04 … O-13; `08-PR-PLAN.md` claims O-14 … O-29; sibling Phase 0 documents have claimed up to O-115
(`03-AUTH-BERECHTIGUNGEN.md` O-74 … O-92, `05-API-KARTE.md` O-94 … O-104,
`06-AGENTEN-FREIGABEN.md` O-105 … O-115). The contest over O-30 … O-73 between the six domain
documents is **settled**: `docs/DECISIONS.md` now carries one register, built by resolving every
occurrence to the question it names, and it is the only place a number is assigned. Every question
this document raises accordingly either **cites the number that already asks it** or sits in this
document's block, **O-116 … O-131**, each with a stable slug so the question survives any later
renumbering.

An earlier draft numbered these locally („Frage 14") and left the mapping to that merge. That is
what made the `pnpm lint:todo` gate of §30 unshippable: it fails when a `TODO(client)` has no
matching `DECISIONS.md` entry, and a local number never matches one — so the gate could only ever
have run disabled, which is the same as not having it. **Every `// TODO(client, O-nn)` in the text
above now names a number in one of the two tables below.**

### 32.1 Already asked elsewhere — cited, never minted a second time

| Nummer | Frage | Wo sie in diesem Dokument trägt |
|---|---|---|
| O-05 | DATEV-Stammdaten je Gesellschaft **plus eine echte Beispiel-EXTF-Datei** | §9 — `AccountingExportPort` bleibt blockiert |
| O-06 | Betriebsrat — §87 BetrVG für Geolokalisierung beim Check-in und die APR-08-Messung | §26 |
| O-07 | Auf welchen Vergabeplattformen ist welche Gesellschaft registriert? | §15, `mandant_plattform_registrierung` |
| O-10 | Welche Social- und Stellenbörsen-Konten existieren, wer ist Inhaber, wer erteilt API-Zugriff? | §20, §21 — alle Kanäle `Nicht verbunden` |
| O-11 | Managed EU-Cloud oder selbst gehosteter deutscher Server — **vor** Anlage des Supabase-Projekts | §5, §6, §11 |
| O-13 | Echte Fotografie **mit Freigaben** — hier: schriftliche Einwilligungen der abgebildeten Beschäftigten und wer sie verwahrt | §20 (SOC-04, PRO-05) |
| O-22 | Leitweg-IDs je öffentlichem Auftraggeber und der verlangte Übertragungsweg (OZG-RE / ZRE / Landesportal / Peppol / E-Mail) | §12.1, `kunde.uebertragungsweg` |
| O-25 | Aufbewahrungsfristen je Dokumentkategorie | §6.4, `dokument_aufbewahrung` |
| O-27 | Lohnexport-Zielsystem und Format, je Gesellschaft getrennt | §25.1, `PayrollExportPort` |
| O-28 | Welches Bewerbungspostfach wird überwacht, und wem gehört es? | §19.2, `MailboxPort` |
| O-82 | Welcher EU-gehostete SMS-Anbieter versendet OTP und Check-in-Link (AV-Vertrag), und welches monatliche Kostenlimit gilt? | §18 — EMP-01 bleibt blockiert |
| O-97 | In welchem Austauschformat kommen Leistungsverzeichnisse (GAEB-Ausgabe und Austauschphase, Excel, PDF)? | §14, `LvImportPort` |
| O-104 | §13b Abs. 2: Kategorien und die USt-1-TG-Bescheinigungen im Bestand | §12.2 — hier zusätzlich: gilt sie zum Leistungsdatum, und was gilt beim Ablauf mitten im Vertrag? |

### 32.2 New — allocated **O-116 … O-131**, with slugs

| Nummer | Slug | Frage | Blockiert |
|---|---|---|---|
| O-116 | `int-mail-versanddienst` | Welcher EU-gehostete E-Mail-Dienst versendet transaktionale Nachrichten, und welche verifizierte Absenderdomain und -adresse gelten je Gesellschaft (CSE Dienstleistungen, SSE Security, REALTIME Service, CSE Operations)? AV-Vertrag erforderlich | `MailerPort`, `mandant_mail_absender` (§3.9), NOT-01, NOT-02, FIN-15 |
| O-117 | `int-postfach-loeschrecht` | Wer triagiert eine Bewerbung, die an keine der vier Adressen gerichtet ist, und darf die Plattform Nachrichten nach der Übernahme aus dem Postfach löschen? Ohne Löschrecht ist die Löschung nach REC-07 unvollständig | §19.2, `bewerbung_eingang`, `bewerber-purge`; erweitert O-28 |
| O-118 | `int-betriebsueberwachung` | Welche Dienste für Fehler-Tracking, Uptime-Überwachung und Log-Weiterleitung sind freigegeben (EU-Region, AV-Vertrag), oder sollen selbst gehostete Alternativen betrieben werden? | §23, `ErrorReporterPort`, der Totmannschalter des `job-heartbeat` (§3.7) |
| O-119 | `int-sicherungsziel` | Wo liegen die unabhängigen verschlüsselten Sicherungen (EU-Anbieter, Konto, Region), welche Aufbewahrung gilt, wer verwahrt den privaten Schlüssel, wer stellt ihn für den monatlichen Test bereit, und wer bestätigt das Ergebnis? | §24, `BackupPort`, SEC-A10, LEG-01 |
| O-120 | `int-camt-bezugsweg` | Wie gelangen CAMT.053-Dateien in die Plattform — Upload durch die Buchhaltung oder SFTP-Abruf —, welche Banken und welche IBAN je Gesellschaft? | §13, `BankStatementPort`, ACC-04 |
| O-121 | `int-ki-eu-ersatz` | Wenn für eine benötigte KI-Fähigkeit kein Modell mit EU-Verarbeitung und Zero-Retention angeboten wird: Fähigkeit abgeschaltet lassen oder einen alternativen EU-gehosteten Anbieter in den Stack aufnehmen? | §8, `modell_register`, D-04, AGT-* |
| O-122 | `int-geokodierung` | Soll die Adresse eines Objekts automatisch in Koordinaten aufgelöst werden, und mit welchem EU-gehosteten oder selbst betriebenen Dienst? | §25.2, `GeocodingPort`, OPS-01, BAU-08 |
| O-123 | `int-n8n-betrieb` | Wird n8n selbst gehostet (wo, durch wen) oder als EU-Cloud-Instanz betrieben, liegt ein AV-Vertrag vor, und welche externen Werkzeuge sollen angebunden werden? | §22, SPEC §21 |
| O-124 | `int-belegtransfer` | Wie sollen Belege beim Steuerberater ankommen — über DATEV Unternehmen online / Belegtransfer oder als ZIP-Paket neben der EXTF-Datei? | §9, ACC-03 |
| O-125 | `int-systemnachricht-vorabfreigabe` | Systemnachrichten (Anmelde-Code, Check-in-Link, Passwort-Wiederherstellung, Benachrichtigungs-Digest, Lead-Eskalation, Betriebsalarm, Eingangsbestätigung) werden über eine sichtbare, versionierte Richtlinie vorab freigegeben und einzeln protokolliert. Soll eine dieser Kategorien stattdessen einzeln freigegeben werden? | §4.3 — die enumerierte Liste ist **aktiv**, weil EMP-01, TIM-07 und AUT-07 sonst nicht funktionieren; die Frage betrifft das **Entfernen** einzelner Kategorien, invariant 7, AGT-03, AUT-07 |
| O-126 | `int-aufrufprotokoll-aufbewahrung` | Wie lange dürfen die Aufrufprotokolle der Integrationen (`integration_aufruf`) aufbewahrt werden, bevor sie automatisch gelöscht werden? | §3.5, LEG-09; Schwesterfrage zur KI-Nutzlast in `02-datenmodell/06-RADAR-KI-INHALT.md`, Dokumentkategorien in O-25 |
| O-127 | `int-anhang-schadsoftware` | Sollen eingehende Anhänge (Bewerbungen, Eingangsrechnungen, Kundenmails) auf Schadsoftware geprüft werden, und mit welchem EU-gehosteten Dienst? | §6.4, DOC-06, REC-03, ACC-05 |
| O-128 | `int-altsystem-export` | In welchem Format lassen sich Aplano, Lexware und die bestehenden Excel-Dateien exportieren, welcher Zeitraum wird übernommen, und müssen die historischen Daten revisionssicher im GoBD-Archiv landen? | §25.3, ROADMAP Phase 10, LEG-01, LEG-02 |
| O-129 | `int-datev-periodensperre` | Sperrt ein abgeschlossener DATEV-Export die Periode gegen neue Buchungen, oder gehen Nachbuchungen in die nächste offene Periode? | §9, `datev_profil`, ACC-02 |
| O-130 | `int-48b-bescheinigung` | Liegt für jede Gesellschaft eine gültige Freistellungsbescheinigung nach §48b EStG vor, mit welcher Laufzeit, und wer erneuert sie? | §12.3, FIN-10, LEG-06 |
| O-131 | `int-kundenpostfach` | Soll eingehende Kundenkommunikation automatisch in die Historie übernommen werden (eigenes Postfach je Gesellschaft), oder bleibt die Erfassung manuell? | §19.3, CRM-03, NOT-01 |

Until each is answered the affected integration stays behind its port with a NotConnectedAdapter, the
UI shows `Nicht verbunden` with the blocking question beside it, and **no plausible value is chosen on
the client's behalf** (K-17).
