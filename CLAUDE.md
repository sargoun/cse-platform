# CSE Platform

One digital platform for a Berlin group of four business areas:

| Key | Entity | Trade |
|---|---|---|
| `reinigung` | CSE Dienstleistungen GmbH | Gebäudereinigung |
| `security` | SSE Security (Select-Security Event GmbH) | Sicherheits- und Objektschutzdienste |
| `bau` | REALTIME Service GmbH | Hochbau, Ausbau, Rückbau |
| `operations` | CSE Operations | Digital operations, AI, group management |

Public website + company profiles + role-based portals + operations + finance +
tender radar + AI agents. One platform, separate legal entities, one group view.

- **What to build:** `docs/SPEC.md`
- **How it must look:** `docs/DESIGN.md` — authoritative; never invent a colour,
  size or spacing value
- **In what order:** `docs/ROADMAP.md` — follow it, phase by phase
- **What was decided and why:** `docs/DECISIONS.md` — read before assuming anything

---

## Stack — locked

| Layer | Choice | Constraint |
|---|---|---|
| Framework | Next.js 15 App Router, TypeScript strict | — |
| DB | Supabase Postgres | **EU region (Frankfurt)** |
| Auth | Supabase Auth | 2FA for admin roles |
| Storage | Supabase Storage | private buckets, signed URLs only |
| ORM | Drizzle | migrations in repo, not dashboard-only |
| UI | Tailwind + shadcn/ui | — |
| AI | OpenAI API | **EU processing + zero-retention where offered** |
| Jobs | Supabase cron + Edge Functions; n8n only for external glue | — |
| Deploy | Vercel | **EU region for functions** |
| Tests | Vitest + Playwright | — |

Data residency is not optional: this platform holds employee time records,
health-adjacent absence data and financial records for three German legal
entities. Every service must be pinned to an EU region and covered by a DPA.
Record each one in `docs/DECISIONS.md`.

## Commands

```bash
pnpm dev
pnpm db:generate && pnpm db:migrate
pnpm db:seed            # realistic Berlin demo data, all four areas
pnpm test               # unit
pnpm test:e2e           # playwright
pnpm lint && pnpm typecheck
```

## Structure

```
src/
  app/
    (public)/                     website, company profiles, offer request
    (auth)/                       login, 2FA
    (portal)/[mandant]/           tenant-scoped app — always under a mandant
    (portal)/gruppe/              group view — READ ONLY
    api/
  server/
    db/schema/                    one file per domain
    services/                     business logic — pure, tested, no HTTP
    agent/                        tools, orchestrator, policy gate
    jobs/
  lib/
docs/  SPEC.md  ROADMAP.md  DECISIONS.md
```

Route handlers stay thin: authorize → call a service → return. No calculation
in a component, ever.

---

## Invariants — never violate

Breaching these produces **silent, expensive, late-discovered** failures.
Any change touching them requires a test.

1. **Money is integer cents (`bigint`).** Never float. VAT computed per
   tax-rate group, never from a gross total.

2. **All timestamps `TIMESTAMPTZ`, stored UTC, displayed `Europe/Berlin`.**
   Shifts cross midnight and DST. Duration = difference of UTC instants.

3. **Every tenant table carries `mandant_id` with RLS enabled.** The active
   tenant lives in the server session — never a URL param, never client state.
   RLS is the second line of defence, never the only one and never absent.

4. **Invoices: `entwurf` → `festgeschrieben` is one-way.**
   Drafts have **no number**; the number is assigned at finalization only, via
   `SELECT … FOR UPDATE` on a counter row — which is why gaps are impossible.
   Finalized invoices are immutable; correct by reversing entry (Storno).
   Each stores `hash = SHA256(payload + previous_hash)`.

5. **Server clock is the source of truth for time entries.** Device time is
   stored separately with `zeitabweichung_sek`. Never trust a client timestamp.

6. **The AI never computes money, quantities or deadlines.** It reads,
   extracts, classifies and drafts. Every number goes through a tested function
   in `server/services/`. If you are prompting a model for an amount, stop and
   write a function.

7. **Nothing leaves the system without human approval.** Email, offers,
   applications, posts — all pass `server/agent/policy.ts`.

8. **No hard deletes** in finance, time tracking, or audit domains.

9. **A person is not an employee row.** `person` = the human;
   `anstellung` = one employment per entity. Costed things hang off
   `anstellung_id`; facts about the human (certificates, login) hang off
   `person_id`. **ArbZG limits aggregate per person across entities.** See D-09.

10. **Group view is read-only.** No create or update path executes without
   exactly one active mandant.

---

## Domain language

Domain identifiers stay **German** — these terms carry legal meaning (VOB,
GoBD, UStG, GewO) and translating them loses precision:
`mandant · person · anstellung · objekt · raum · einsatz · zeiteintrag · rechnung · aufmass ·
nachtrag · dienstplan · leistungsnachweis · wachbuch · ausschreibung`

Infrastructure stays **English**: `createInvoice`, `withTenant`, `hashChain`.

UI copy: **German**. Worker-facing screens additionally translatable
(de / en / ar / tr) — see SPEC §10.

---

## Working rules

**Never invent a business rule.** Where the spec is genuinely open — the exact
five billing types, DATEV account mapping, tariff rates — do this:

1. Implement behind an interface so the unknown is swappable
2. Use a clearly-labelled placeholder
3. `// TODO(client): <the exact question>`
4. Record it in `docs/DECISIONS.md` under "Open"

Never silently pick a plausible value for a legal or financial rule.

**No fake integrations.** If DATEV, Instagram, LinkedIn or a job board has no
credentials configured, build the interface, mark it clearly in the UI as
"not connected", and keep everything else working. Never simulate a successful
external call.

**Test before UI for money and time.** These four must exist and pass before
any scheduling UI is built:
- shift 22:00–06:00
- DST spring-forward night
- DST fall-back night
- ten shifts starting at the same instant on one object

**Do not break what works.** Adding a feature never removes an existing one.

**Design values come from `docs/DESIGN.md` only.** No ad-hoc hex codes, no
one-off padding, no new component invented in a page file. If something is
missing, add it to DESIGN.md first, then use it.

**Definition of done:** tests pass · `typecheck` clean · seed data exercises it ·
`DECISIONS.md` updated with anything assumed.

---

## Out of scope — do not build

These were removed deliberately. Reasons in `docs/DECISIONS.md`.

- **Cold outreach to scraped contacts.** German §7 UWG prohibits unsolicited
  electronic advertising without prior express consent — including B2B.
  Outbound messaging exists only to contacts with a recorded legal basis.
- **Scraping Indeed / StepStone or similar.** Terms-of-service violation and
  GDPR exposure. Recruiting works on inbound applications.
- **Payroll calculation, Jahresabschluss, E-Bilanz, tax filing submission.**
  The platform prepares and exports; a payroll system and a tax advisor do the
  rest.
- **Automated submission to procurement platforms.** No API exists; submission
  is manual by design.
