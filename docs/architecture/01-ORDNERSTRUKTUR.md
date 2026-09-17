# Folder Structure and Module Conventions

This document is the physical contract for the repository: where every file lives, what may
import what, which door the database is reached through, how things are named, and which of
those rules a machine checks. It is exhaustive by intent — an implementation PR that puts a
file somewhere not described here is wrong, and the fix is to amend this document first. It
is subordinate to `docs/architecture/00-KONVENTIONEN.md`: every rule below that touches
tenancy, session state, RLS, money, time, approvals or invented values is an application of a
numbered convention (`K-01` … `K-21`) and cites it inline. Where this document and a
convention appear to disagree, the convention wins and this document is defective.

Three of those conventions were added after the first draft of this document and each of them
corrects something here: **K-19** makes `03-AUTH-BERECHTIGUNGEN.md` the sole owner of the right
catalogue, so every right key written below is spelled as that catalogue spells it; **K-20**
requires every `app.*` accessor to have a stated value in all four K-18 scopes (§4.4); and
**K-21** fixes table ownership and canonical spellings, so this document *references* tables and
never redeclares them (§4.9).

**One place where this document knowingly exceeds a convention**, and it is fenced rather
than silent: §4.2 transports three audit-only GUCs that K-02's table does not yet list. They
carry no authorisation weight, no policy may reference them, a test asserts that, and §26
carries the K-02 amendment as a cross-document obligation on `00-KONVENTIONEN.md`. Until that
amendment lands, this is a divergence with a name and an owner, not a discovered one.

---

## 0. Standing, scope, and what this document does not decide

**Binding inputs, in order of precedence:** `00-KONVENTIONEN.md` → `CLAUDE.md` (the ten
invariants) → `docs/SPEC.md` → `docs/DECISIONS.md` → `docs/DESIGN.md` → `docs/ROADMAP.md`.

**This document decides:** physical placement, import direction, the enforcement point for
each invariant, naming, barrels, test placement, CI gates, and the file in which every open
question physically sits.

**This document does not decide:**

| Question | Owner |
|---|---|
| Column definitions, types, constraints, indexes as DDL | `02-datenmodell/01-KERN.md` … `06-RADAR-KI-INHALT.md` |
| Session lifecycle, 2FA enrolment, lockout thresholds, token formats | `03-AUTH-BERECHTIGUNGEN.md` |
| The role × modul × mandant permission matrix and its seed | `03-AUTH-BERECHTIGUNGEN.md` |
| Per-page content, states, empty states, copy | `04-SEITENKARTE.md` |
| Request/response shapes and status codes per endpoint | `05-API-KARTE.md` |
| Agent prompts, tool schemas, orchestration loop, approval flows | `06-AGENTEN-FREIGABEN.md` |
| Per-integration contracts and failure semantics | `07-INTEGRATIONEN.md` |
| PR sequence and the open questions it surfaces (O-14 … O-29) | `08-PR-PLAN.md` |

The sibling filenames above are the ones that exist on disk. Earlier drafts of this document
cited `02-DATENMODELL.md`, `03-AUTH-MODELL.md`, `04-BERECHTIGUNGSMODELL.md`,
`05-SEITENKARTE.md`, `06-API-KARTE.md`, `07-AGENTEN-ARCHITEKTUR.md` and
`08-INTEGRATIONS-ARCHITEKTUR.md` — **none of which is a real path, and none of them is used
anywhere in this document any more**, §26 included. In particular `03-AUTH-MODELL.md` and
`04-BERECHTIGUNGSMODELL.md` are both `03-AUTH-BERECHTIGUNGEN.md`, which owns the session
lifecycle *and* the permission catalogue. A cross-document obligation pointing at a file nobody
can open is not an obligation.

Where this document names a table, a function signature or a policy, it does so to fix its
**location and its contract boundary**. The sibling document owns the detail. Names used here
are binding on the sibling document — see §26.

---

## 1. The six laws

Everything below is an application of these. Each is machine-checked; a law with no check is
a preference, and preferences do not survive a deadline.

| # | Law | Enforced by |
|---|---|---|
| L1 | **Route handlers and Server Actions stay thin.** authorize → validate (Zod, SEC-A4) → call one service or one query → return. No branching on business state, no arithmetic, no SQL. | ESLint import zones (§23); `src/server/http/{handler,action}.ts` wrappers |
| L2 | **No calculation in a component, ever.** Components receive finished values. A component may format; it may never compute. | ESLint: `src/components/**` and `src/lib/format/**` cannot import `@/server/**` |
| L3 | **Every database access goes through exactly one of the seven session helpers** (§4.3) or one of the **five** functions of the **K-08** closed register. The raw Drizzle handle is importable by four modules; services accept a branded handle, never `db`. | Branded TypeScript types + ESLint `no-restricted-imports` + the K-08 route-manifest test |
| L4 | **Design values come only from `docs/DESIGN.md`**, via `src/styles/globals.css` and `tailwind.config.ts`. No hex literal, no `px`, no radius, no duration anywhere else. | `pnpm lint:design` token scan in CI |
| L5 | **Services are pure and testable.** No `next/*`, no `react`, no `fetch` against our own API, no `new Date()`, no `process.env`. Time, randomness and ports are injected. | ESLint `no-restricted-imports` / `no-restricted-syntax`; `vitest.setup.ts` fails a service that calls `new Date()` |
| L6 | **Nothing legal, financial or tariff-bound is invented** (**K-17**). An unstated value is a labelled placeholder behind an interface, plus `// TODO(client) O-nn: <exact question>` — **the O-number is part of the marker** — plus the matching row in `DECISIONS.md` § Open. | `pnpm lint:todo` inventories every `TODO(client)` and every `*.platzhalter.ts` and fails when one exists without a `DECISIONS.md` entry |

---

## 2. The repository at a glance

A single Next.js application, a single `package.json`, no monorepo. The separation that
matters here is between four legal entities inside one database (K-02, K-03), not between npm
packages.

```
cse-platform/
├─ CLAUDE.md
├─ README.md
├─ .env.example
├─ .nvmrc
├─ .gitignore
├─ next.config.ts
├─ tsconfig.json
├─ tailwind.config.ts
├─ postcss.config.mjs
├─ components.json                 # shadcn/ui generator config
├─ drizzle.config.ts
├─ vitest.config.ts
├─ vitest.setup.ts
├─ playwright.config.ts
├─ eslint.config.mjs
├─ prettier.config.mjs
├─ lighthouserc.json
├─ package.json
│
├─ .github/
│  ├─ workflows/
│  │  ├─ ci.yml                    # typecheck · lint · lint:design · lint:todo · unit · build
│  │  ├─ db.yml                    # migration drift · RLS + FORCE coverage · invariant suite
│  │  ├─ isolation.yml             # SEC-A3 — required check, blocks merge
│  │  ├─ e2e.yml                   # Playwright against local Supabase
│  │  ├─ compliance.yml            # KoSIT XRechnung · DATEV EXTF golden files
│  │  ├─ a11y.yml                  # axe + Lighthouse CI on public routes
│  │  └─ security.yml              # pnpm audit · OWASP ZAP baseline · secret scan
│  ├─ CODEOWNERS
│  └─ pull_request_template.md     # requires SPEC feature IDs and K-ids touched
│
├─ docs/
│  ├─ SPEC.md · DESIGN.md · ROADMAP.md · DECISIONS.md
│  ├─ ARCHITECTURE.md              # index of the Phase 0 deliverables
│  ├─ architecture/
│  │  ├─ 00-KONVENTIONEN.md        # BINDING — K-01..K-21
│  │  ├─ 01-ORDNERSTRUKTUR.md      # ← this document
│  │  ├─ 02-datenmodell/           # 01-KERN · 02-CRM-OPERATIONS · 03-GEWERKE ·
│  │  │                            #   04-PLANUNG-ZEIT · 05-FINANZEN · 06-RADAR-KI-INHALT
│  │  ├─ 03-AUTH-BERECHTIGUNGEN.md
│  │  ├─ 04-SEITENKARTE.md
│  │  ├─ 05-API-KARTE.md
│  │  ├─ 06-AGENTEN-FREIGABEN.md
│  │  ├─ 07-INTEGRATIONEN.md
│  │  └─ 08-PR-PLAN.md
│  └─ runbooks/
│     ├─ restore-test.md           # SEC-A10 monthly tested restore
│     ├─ incident.md
│     ├─ datenmigration.md         # PUB-08 + ROADMAP Phase 10 (Aplano, Lexware, Excel)
│     └─ dsgvo-auskunft.md         # LEG-09 — the manual half of a mostly automated process
│
├─ scripts/                        # one-off, human-invoked, never imported by the app
│  ├─ import/
│  │  ├─ website-inhalte.ts        # PUB-08 — cse-dienstleistungen.de → seite/referenz
│  │  ├─ aplano-dienstplan.ts      # ROADMAP Phase 10
│  │  ├─ lexware-stammdaten.ts     # ROADMAP Phase 10
│  │  └─ excel-raumbuch.ts         # OPS-04 bulk path, shares the parser with the UI import
│  ├─ rls-check.ts                 # prints every table missing RLS/FORCE/policy (K-01, K-03)
│  └─ todo-inventar.ts             # backs `pnpm lint:todo` (L6, K-17)
│
├─ supabase/
│  ├─ config.toml                  # local dev only — see §16
│  ├─ functions/
│  │  └─ cron-dispatch/index.ts    # the ONLY Edge Function; see §16 and §25.2
│  └─ .gitignore
│
├─ public/
│  ├─ brand/                       # SVG logos per entity — placeholders until O-12
│  │  ├─ cse-dienstleistungen.svg · sse-security.svg
│  │  ├─ realtime-service.svg · cse-operations.svg · cse-gruppe.svg
│  ├─ images/platzhalter/          # every file here is a launch blocker (O-13, D-10)
│  ├─ favicon.ico
│  └─ site.webmanifest
│
├─ tests/
│  ├─ e2e/ · isolation/ · invariants/ · compliance/ · a11y/ · helpers/ · fixtures/
│
└─ src/
   ├─ middleware.ts                # MUST be here, not at the repo root — see §22
   ├─ app/
   ├─ components/
   ├─ server/
   ├─ lib/
   ├─ i18n/
   └─ styles/
```

Two placements in that tree are corrections of a common and silent failure:

**`src/middleware.ts`, never `./middleware.ts`.** With a `src/` directory, Next.js resolves
middleware at `src/middleware.ts` only. A root-level file compiles, lints, type-checks and
does nothing — which would silently disable the CSP and HSTS headers (SEC-A7), the rate limit
and lockout hook on `(auth)` and `api/formular` (AUT-07), the Supabase session refresh, and
locale negotiation for worker routes (EMP-12). `tests/e2e/security/headers.spec.ts` asserts
that a response to `/login` carries CSP and HSTS and that an attempt **one past the configured
AUT-07 threshold** is rejected, so the file cannot quietly stop being loaded. The threshold
itself is not stated here and not invented here: SPEC AUT-07 says only "rate limiting and
lockout on auth endpoints", the attempts-per-identifier, attempts-per-IP, window and lockout
duration are `03-AUTH-BERECHTIGUNGEN.md` §10's `// TODO(client)` (**O-80**), and the test reads the
configured value rather than hard-coding a number this document has no source for.

**`scripts/` exists and is outside the app.** PUB-08 (migrate content from
cse-dienstleistungen.de) and ROADMAP Phase 10 (Aplano, Lexware, Excel) both require import
code. Import scripts run under `withSystemTenant` (§4.3) with an explicit reason string, never
against the raw handle, and they are excluded from the Next.js build by `tsconfig`'s
`exclude`. `scripts/**` may import `@/server/**`; nothing under `src/` may import
`scripts/**`.

---

## 3. `src/app` — the route tree

### 3.1 URL namespace (K-07)

The portal lives under `/portal`; public marketing keeps the root. This is **K-07 verbatim**
and it is not a preference: without the prefix, `/reinigung` is simultaneously a public
company profile and a tenant dashboard, Next.js route groups do not appear in the URL, and one
of the two silently wins — either every mandant switch lands a manager on a marketing page or
the four short marketing URLs 404. There is no configuration in which both work.

```
/                          public
/unternehmen               public — the group (PUB-01)
/unternehmen/[bereich]     public company profile — canonical (PRO-01..PRO-05)
/portal/[mandant]/…        tenant portal — the staff application
/portal/gruppe/…           group view, read-only (TEN-05)
/portal/mein/…             employee portal (EMP-01..EMP-15)
/portal/kunde/…            customer portal (DSH-03, CRM-06, DOC-04, FIN-*)
/portal/konto/…            the signed-in user's own account — page content owned by 04-SEITENKARTE
/check-in/[token]          tokenised, session-less (TIM-07, TIM-08, TIM-09)
/api/…                     non-UI callers only
```

**Reserved portal segments.** The column is **`mandant.slug`** (K-21 — not `schluessel`), and it
carries a `CHECK` excluding **one list**: `gruppe`, `mein`, `kunde`, `konto`, `api`. `gruppe` and
`mein` are the group view and the employee portal; `kunde` is the customer portal, the fourth static
segment under `/portal`; `konto` is the fifth, the signed-in user's own account pages
(`04-SEITENKARTE.md`); and `api` is reserved because `/portal/api` would shadow a fetch path. K-21
publishes exactly this list and K-07 points at it rather than repeating it, so the constraint, the
test below and every sibling document read from one place. K-07 already mandates
the mechanism that keeps it honest:
`tests/invariants/reservierte-slugs.test.ts` walks the App Router tree, collects every static
first segment under `src/app/portal/`, and fails when one is missing from the constraint. That
test is what makes TEN-08 ("a fifth area requires a DB row, no code change") true rather than
aspirational — a hand-maintained list with no test does not deliver it.

**Module visibility is data, not a folder guard.** A route under
`/portal/[mandant]/<modul>/…` returns `notFound()` when `<modul>` is not enabled for the active
mandant. Enablement is a `mandant_modul` row seeded per area (TEN-01, TEN-08, AUT-03), read
once in `portal/[mandant]/layout.tsx`, never hard-coded against a `gewerk` literal. Otherwise
every entity exposes every trade module's route space, and a fifth area would need a code
change — which TEN-08 forbids.

### 3.2 Route groups and their scope

| Directory | Session | Scope helper (§4.3) | `app.portal` (K-02) | Purpose |
|---|---|---|---|---|
| `(public)/` | none | none | — | Website, profiles, offer requests, career (PUB-*, PRO-*, REQ-*) |
| `(auth)/` | none | none | — | Login, 2FA, reset, worker phone login (AUT-02, AUT-07, EMP-01) |
| `portal/[mandant]/` | yes | `withTenant` | `intern` | Staff application — every create/update path lives here (TEN-04, invariant 10) |
| `portal/gruppe/` | yes | `withGroupScope` (`scope = gruppe`) | `intern` | Group aggregation, **read-only** (TEN-05, TEN-10) |
| `portal/mein/` | yes (person) | `withPersonScope` read (`scope = person`) · `withAnstellung` write | `mitarbeiter` | Worker portal across all of one person's employments (EMP-14, EMP-15) |
| `portal/kunde/` | yes (customer) | `withKundeScope` read (`scope = kunde`) · `withKundenVorgang` write | `kunde` | Customer portal across the customer's orders in all entities (CRM-06, DSH-03) |
| `check-in/[token]/` | **none** — token only | none; K-08 / K-09 functions | — | Tokenised shift check-in, no app, no login (TIM-07) |
| `api/` | varies | varies | varies | Non-UI callers only: webhooks, cron, downloads, token endpoints, feeds |

`portal/` is a **literal segment**, not a route group, because K-07 requires it in the URL.
`(public)` and `(auth)` stay route groups: they share a layout and contribute no path segment.

### 3.3 The `[mandant]` segment is routing only (K-02)

The active mandant lives in the **server session** and nowhere else (invariant 3, TEN-04,
AUT-04). The URL segment exists so a deep link, a bookmark and a tab title identify the entity.
Its only permitted use:

1. `portal/[mandant]/layout.tsx` resolves the session's active mandant from the session store.
2. It compares `params.mandant` with `session.mandant.slug`.
3. On mismatch it returns `notFound()` → **404, never 403** (AUT-06, K-02). A 403 confirms
   that another entity's URL space exists.
4. It never *sets* anything. Switching happens only through `switchMandant` (§12.2).

**One deliberate softening, and its limit.** A user who *is* a member of the target mandant
(`benutzer_mandant` row present, K-14) gets an interstitial instead of a bare 404:
„Dieser Bereich gehört zu REALTIME Service GmbH. Wechseln?" with a button that calls
`switchMandant`. This confirms nothing the user does not already know — they hold the
membership — and it removes the dead end a multi-entity Leitung otherwise hits on her own
bookmark. For every non-member the response is an indistinguishable 404, so AUT-06 and K-02
hold unchanged. `tests/isolation/http/deep-link.spec.ts` asserts both halves.

No service, query or job anywhere accepts a mandant identifier that originated in `params`,
`searchParams`, a request body, a header or a client-written cookie.

### 3.4 Files that may exist inside a route segment

```
<segment>/
  page.tsx           Server Component. Calls src/server/queries/*. Never fetches our own API.
  layout.tsx         Shell, guards, breadcrumbs.
  loading.tsx        Skeletons from src/components/ui/skeleton.tsx.
  error.tsx          'use client' — REQUIRED. Segment error boundary. German copy.
  not-found.tsx      Where a bespoke 404 is warranted.
  _actions.ts        "use server". authorize → Zod → service → revalidatePath.
  _components/       Components used ONLY by this segment.
  _schemas.ts        Zod schemas for this segment's actions (SEC-A4).
```

Nothing else. There is no `_lib/`, no `_utils.ts`, no `helpers.ts` inside a route segment —
those names are where calculation escapes into the UI layer (L2). Shared logic goes to
`src/server/services`, shared reads to `src/server/queries`, shared presentation to
`src/components`.

Two mechanics worth stating correctly, because the usual folklore is wrong:

- An **underscore-prefixed folder** (`_components/`) is a private folder in the App Router and
  is excluded from routing. A **file** named `_actions.ts` is not a route because only
  `page`, `route`, `layout`, `template`, `default`, `error`, `loading` and `not-found` files
  are routable — the underscore is a convention there, not the mechanism.
- **`error.tsx` must carry `'use client'`.** An error boundary is a Client Component by
  definition; omitting the directive fails the build rather than degrading, and it is the most
  common App Router mistake.

### 3.5 `(public)` — website and profiles

```
src/app/
├─ layout.tsx                       # <html lang="de"> · Inter + Caveat · globals.css
├─ error.tsx ('use client') · global-error.tsx ('use client') · not-found.tsx
├─ robots.ts · sitemap.ts           # PUB-12
├─ llms.txt/route.ts                # PUB-12 — generated from the DB, not a static file
│
├─ (public)/
│  ├─ layout.tsx                    # PublicHeader + PublicFooter (DESIGN §5)
│  ├─ page.tsx                      # Home: hero, four brand cards, avatar row (PUB-02, PUB-03, PUB-14)
│  ├─ unternehmen/
│  │  ├─ page.tsx                   # the group (PUB-01); profile index and switch (PRO-03)
│  │  └─ [bereich]/
│  │     ├─ page.tsx                # profile: logo, cover, description (PRO-01)
│  │     ├─ leistungen/page.tsx     # PRO-02
│  │     ├─ projekte/page.tsx       # PRO-02, references where freigegeben_vom_kunden (PRO-05)
│  │     ├─ posts/page.tsx          # PRO-04 — published from the Social Media Center (SOC-05)
│  │     ├─ news/page.tsx
│  │     └─ kontakt/page.tsx        # PRO-02 company info, NAP (PUB-12)
│  ├─ leistungen/page.tsx           # PUB-01
│  ├─ projekte/{page.tsx,[slug]/page.tsx}          # PUB-01, PRO-05
│  ├─ ueber-uns/page.tsx
│  ├─ news/{page.tsx,[slug]/page.tsx}
│  ├─ kontakt/page.tsx
│  ├─ angebot-anfragen/
│  │  ├─ page.tsx                   # area chooser
│  │  ├─ [bereich]/
│  │  │  ├─ page.tsx                # REQ-01..REQ-04, fields per area
│  │  │  ├─ _schemas.ts             # one Zod schema per area form (SEC-A4)
│  │  │  └─ _actions.ts             # creates lead with SLA + owner (REQ-05, REQ-07)
│  │  └─ danke/page.tsx
│  ├─ karriere/
│  │  ├─ page.tsx                   # open roles (REC-02, REC-03)
│  │  └─ [stelle]/
│  │     ├─ page.tsx                # inbound application form (REC-03)
│  │     ├─ _schemas.ts             # REC-03 · file rules per DOC-06
│  │     └─ _actions.ts             # creates bewerbung + kandidat (REC-03, REC-04, LEG-11)
│  └─ rechtliches/
│     ├─ impressum/page.tsx
│     ├─ datenschutz/page.tsx       # LEG-09 — processing register extract, sub-processors
│     └─ barrierefreiheit/page.tsx  # BFSG accessibility statement (LEG-07, PUB-09)
```

Notes. Content is loaded from `seite`, `referenz`, `social_post` and `formular_definition`,
never hard-coded (PUB-07). Every image goes through `next/image` with a mandatory `alt`
(PUB-10, DESIGN §4) — **and only `public/` marketing imagery does**: private-bucket objects are
never handed to `next/image`, because the optimiser caches bytes under `/_next/image?url=…`
that outlive the 15-minute signature and are not access-controlled (DOC-03, SEC-A6). Documents
stream through `api/dokument/[id]/signed-url` instead. JSON-LD comes from
`src/components/seo/json-ld.tsx` with `LocalBusiness`, `Service` and `FAQPage` per area
(PUB-11). Layout is mobile-first at the DESIGN §8 breakpoints (PUB-06). No third-party script
tags exist anywhere under `(public)`, which is why no cookie banner is needed (PUB-13); adding
one is an architectural change, not a page-level change.

`(public)` writes are sessionless and therefore run under `withSystemTenant` (§4.3) with a
resolution reason — `formular:<bereich>` for REQ-01 and `bewerbung:<stelle_id>` for REC-03 —
never against the raw handle, and always behind the `middleware.ts` rate limit (AUT-07).

### 3.6 `(auth)`

```
├─ (auth)/
│  ├─ layout.tsx
│  ├─ login/
│  │  ├─ page.tsx                   # AUT-02
│  │  ├─ _schemas.ts
│  │  └─ _actions.ts                # rate-limited (AUT-07) via app.versuch_protokollieren (K-08), audited (AUT-08)
│  ├─ login/zwei-faktor/page.tsx    # mandatory for super_admin + admin only (AUT-02, K-15)
│  ├─ passwort-vergessen/page.tsx · passwort-neu/page.tsx
│  ├─ mitarbeiter/
│  │  ├─ page.tsx                   # phone number entry (EMP-01)
│  │  └─ code/page.tsx              # SMS code, no password (EMP-01) — see §11.3 on the SMS fallback
│  └─ abmelden/route.ts
```

**Where the 2FA gate is not.** Per **K-15**, `aal2` is required on the *write path of the
permission-administration tables* — `rolle_berechtigung` and `benutzer_mandant`
INSERT/UPDATE/DELETE — and never on SELECT of a table that membership resolution depends on.
AUT-02 requires 2FA for `super_admin` and `admin` only; every `leitung`, `mitarbeiter` and
`kunde` runs at `aal1`. A restrictive `aal2` policy on `benutzer_mandant` would return zero
rows for them, `app.sichtbare_mandanten()` would return `{}`, and the whole platform would go
blank for every non-admin including the check-in worker. `src/server/auth/guards.ts` exports
`requireAal2()`; `tests/invariants/aal2-gate.test.ts` asserts that exactly the four
permission-administration action files call it and that no SELECT policy in
`src/server/db/rls/*.sql` mentions `app.aal()`.

### 3.7 `portal/[mandant]` — the staff application

```
├─ portal/
│  ├─ layout.tsx                    # session guard · 3px hue bar (TEN-07) · sidebar · switcher (TEN-06, TEN-10)
│  │
│  ├─ [mandant]/
│  │  ├─ layout.tsx                 # slug === session.mandant.slug else notFound() (AUT-06, K-02)
│  │  │                             # + mandant_modul gate (TEN-08) + identity hue as CSS var (DESIGN §6)
│  │  ├─ page.tsx                   # role-scoped dashboard (DSH-01, DSH-03), area filter (DSH-02),
│  │  │                             # every KPI carries a target route (DSH-04), live "arbeitet gerade" (DSH-05)
│  │  │
│  │  ├─ crm/
│  │  │  ├─ kunden/{page.tsx,[id]/page.tsx}                    # CRM-01, CRM-06
│  │  │  ├─ kontakte/{page.tsx,[id]/page.tsx}                  # CRM-01, CRM-08
│  │  │  ├─ leads/{page.tsx,[id]/page.tsx}                     # CRM-02, CRM-05, CRM-07
│  │  │  └─ wiedervorlagen/page.tsx                            # CRM-03, CRM-04
│  │  │
│  │  ├─ objekte/
│  │  │  ├─ page.tsx                                           # OPS-01
│  │  │  └─ [id]/
│  │  │     ├─ page.tsx
│  │  │     ├─ raumbuch/{page.tsx,import/page.tsx}             # OPS-02, OPS-04
│  │  │     └─ dienstanweisung/page.tsx                        # SEC-06
│  │  ├─ belagsarten/page.tsx                                  # OPS-03
│  │  ├─ leistungskatalog/page.tsx                             # OPS-06
│  │  │
│  │  ├─ angebote/
│  │  │  ├─ {page.tsx,neu/page.tsx}                            # OPS-08
│  │  │  └─ [id]/{page.tsx,kalkulation/page.tsx}               # OPS-07, OPS-09
│  │  ├─ auftraege/
│  │  │  ├─ {page.tsx,neu/page.tsx}                            # OPS-05, OPS-10 wizard
│  │  │  └─ [id]/{page.tsx,leistungen/page.tsx,dokumente/page.tsx,aufgaben/page.tsx}   # OPS-11
│  │  │
│  │  ├─ dienstplan/
│  │  │  ├─ woche/page.tsx                                     # TIM-01, TIM-04
│  │  │  ├─ monat/page.tsx                                     # TIM-01
│  │  │  ├─ serien/page.tsx                                    # TIM-02, TIM-03
│  │  │  └─ konflikte/page.tsx                                 # TIM-05, TIM-06, TIM-14 (K-06)
│  │  ├─ zeiten/
│  │  │  ├─ page.tsx                                           # TIM-12, TIM-13
│  │  │  ├─ [id]/page.tsx                                      # TIM-08 device vs server time
│  │  │  ├─ korrekturen/page.tsx                               # TIM-11 immutable trail
│  │  │  └─ einwaende/page.tsx                                 # EMP-07
│  │  │
│  │  ├─ reinigung/
│  │  │  ├─ reviere/{page.tsx,[id]/page.tsx}                   # CLN-01
│  │  │  ├─ turnus/page.tsx                                    # CLN-02, CLN-03
│  │  │  ├─ sonderleistungen/page.tsx                          # CLN-05 Glas · Sonder · Warenräumung
│  │  │  ├─ leistungsnachweise/{page.tsx,[id]/page.tsx}        # CLN-04
│  │  │  └─ reklamationen/{page.tsx,[id]/page.tsx}             # SPEC §22 reklamation, qualitaetspruefung
│  │  ├─ security/
│  │  │  ├─ posten/{page.tsx,[id]/page.tsx}                    # SEC-01
│  │  │  ├─ veranstaltungen/{page.tsx,[id]/page.tsx}           # SEC-08 event security, short-notice staffing
│  │  │  ├─ wachbuch/{page.tsx,[id]/page.tsx}                  # SEC-05
│  │  │  ├─ dienstanweisungen/{page.tsx,[id]/page.tsx}         # SEC-06
│  │  │  ├─ schluessel/{page.tsx,quittungen/page.tsx}          # SEC-07
│  │  │  └─ bewacherregister/page.tsx                          # SEC-03 — "nicht verbunden", manual entry
│  │  ├─ bau/
│  │  │  └─ projekte/
│  │  │     ├─ page.tsx
│  │  │     └─ [id]/
│  │  │        ├─ page.tsx
│  │  │        ├─ lv/page.tsx                                  # BAU-01
│  │  │        ├─ aufmass/{page.tsx,neu/page.tsx}              # BAU-02, BAU-03
│  │  │        ├─ nachtraege/{page.tsx,[nid]/page.tsx}         # BAU-04, BAU-05
│  │  │        ├─ behinderungen/page.tsx                       # BAU-06
│  │  │        └─ bautagebuch/{page.tsx,[tag]/page.tsx}        # BAU-07, BAU-08
│  │  │
│  │  ├─ personal/
│  │  │  ├─ personen/{page.tsx,[id]/page.tsx}                  # D-09 — the human
│  │  │  ├─ anstellungen/{page.tsx,[id]/page.tsx}              # D-09 — one per entity; wage via K-05 only
│  │  │  ├─ nachweise/page.tsx                                 # SEC-02, EMP-08 — person-scoped table (§5)
│  │  │  ├─ abwesenheiten/page.tsx                             # EMP-10
│  │  │  ├─ stundenkonten/page.tsx                             # EMP-04, EMP-15
│  │  │  └─ antraege/page.tsx                                  # EMP-10
│  │  │
│  │  ├─ finanzen/
│  │  │  ├─ rechnungen/{page.tsx,neu/page.tsx,[id]/page.tsx}   # FIN-01..FIN-13
│  │  │  ├─ ausgangsbuch/page.tsx                              # FIN-16
│  │  │  ├─ eingangsrechnungen/{page.tsx,[id]/page.tsx}        # FIN-14, ACC-05
│  │  │  ├─ zahlungen/page.tsx                                 # FIN-14, ACC-04
│  │  │  ├─ mahnungen/page.tsx                                 # FIN-15
│  │  │  ├─ ausgaben/page.tsx                                  # FIN-14
│  │  │  ├─ pruefungen/page.tsx                                # FIN-18 completed order, no time recorded
│  │  │  └─ nummernkreise/page.tsx                             # TEN-02, FIN-03
│  │  ├─ buchhaltung/
│  │  │  ├─ buchungen/page.tsx · konten/page.tsx               # ACC-01
│  │  │  ├─ datev/page.tsx                                     # ACC-02, ACC-03 — "nicht verbunden" (O-05)
│  │  │  ├─ bank/page.tsx                                      # ACC-04 CAMT.053
│  │  │  ├─ offene-posten/page.tsx                             # ACC-07
│  │  │  ├─ monatszahlen/page.tsx                              # ACC-08
│  │  │  ├─ jahrespaket/page.tsx                               # ACC-11 — the one-click target
│  │  │  ├─ archiv/page.tsx                                    # ACC-06, DOC-07
│  │  │  └─ verfahrensdokumentation/page.tsx                   # ACC-10
│  │  │
│  │  ├─ radar/
│  │  │  ├─ ausschreibungen/{page.tsx,[id]/page.tsx}           # RAD-01..RAD-08
│  │  │  ├─ profile/page.tsx                                   # RAD-04
│  │  │  └─ plattformen/page.tsx                               # RAD-09
│  │  │
│  │  ├─ agenten/
│  │  │  ├─ page.tsx                                           # AGT-01 Agent Center
│  │  │  ├─ [agent]/{page.tsx,aufgaben/page.tsx,protokoll/page.tsx}  # AGT-04
│  │  │  ├─ richtlinien/page.tsx                               # AGT-03 — can only tighten (§9.2)
│  │  │  └─ budget/page.tsx                                    # AGT-05
│  │  ├─ freigaben/
│  │  │  ├─ page.tsx                                           # APR-01 inbox by deadline + risk; APR-04 batch
│  │  │  ├─ [id]/page.tsx                                      # APR-02 diff · APR-03 sources · APR-07 snapshot
│  │  │  │                                                     # APR-05 objection window · APR-06 undo
│  │  │  └─ pruefdauer/page.tsx                                # APR-08 rubber-stamping signal (K-13)
│  │  │
│  │  ├─ dokumente/{page.tsx,[id]/page.tsx,buendel/page.tsx}   # DOC-01..DOC-08
│  │  ├─ kalender/page.tsx                                     # CAL-01, CAL-02
│  │  ├─ aufgaben/page.tsx                                     # OPS-11, NOT-03
│  │  ├─ nachrichten/page.tsx                                  # EMP-11, NOT-03
│  │  ├─ social/
│  │  │  ├─ posts/{page.tsx,neu/page.tsx,[id]/page.tsx}        # SOC-01..SOC-05, SOC-08
│  │  │  └─ kanaele/page.tsx                                   # SOC-06, SOC-07 "nicht verbunden"
│  │  ├─ recruiting/
│  │  │  ├─ bedarf/page.tsx                                    # REC-01
│  │  │  ├─ stellen/{page.tsx,[id]/page.tsx}                   # REC-02, REC-09
│  │  │  ├─ bewerbungen/{page.tsx,[id]/page.tsx}               # REC-03..REC-05, REC-08, LEG-12
│  │  │  ├─ gespraeche/page.tsx                                # REC-06 question prep + calendar scheduling
│  │  │  └─ kandidaten/page.tsx                                # REC-04, REC-07
│  │  ├─ berichte/
│  │  │  ├─ umsatz/page.tsx · auftraege/page.tsx               # REP-01, REP-02
│  │  │  ├─ attribution/page.tsx · mitarbeiter/page.tsx        # REP-03, REP-04
│  │  │  └─ projekte/page.tsx · pipeline/page.tsx              # REP-05, REP-06
│  │  └─ einstellungen/
│  │     ├─ mandant/page.tsx                                   # TEN-01, TEN-07, TEN-08
│  │     ├─ benutzer/page.tsx                                  # AUT-01 — writes require aal2 (K-15)
│  │     ├─ rollen/page.tsx · berechtigungen/page.tsx          # AUT-03 — writes require aal2 (K-15)
│  │     ├─ integrationen/page.tsx                             # connection status, never simulated
│  │     ├─ benachrichtigungen/page.tsx                        # NOT-02 · iCal token rotation (CAL-03)
│  │     ├─ datenschutz/page.tsx                               # LEG-09 Auskunft/Löschung workflow
│  │     └─ protokoll/page.tsx                                 # SEC-A9 audit log viewer
```

### 3.8 `portal/gruppe` — read-only group view (TEN-05)

```
│  ├─ gruppe/
│  │  ├─ layout.tsx                 # NUR LESEN pill (TEN-05, TEN-10, DESIGN §6) · neutral hue bar
│  │  ├─ page.tsx                   # KPIs across all four areas (DSH-01, DSH-02, DSH-04)
│  │  ├─ finanzen/page.tsx          # REP-01, FIN-17 — aggregated, no drill-to-edit
│  │  ├─ auslastung/page.tsx        # REP-04
│  │  ├─ projekte/page.tsx          # REP-05
│  │  ├─ pipeline/page.tsx          # REP-06
│  │  └─ personen/page.tsx          # cross-entity person view (D-09) — identity only (K-05)
```

**Invariant 10 is enforced four times, in decreasing trust:**

1. **Postgres.** Per **K-03** and **K-18**, the group, person and kunde policies are
   `for select` only and none has a write counterpart anywhere. A write under
   `app.scope = 'gruppe'` — or `'person'`, or `'kunde'` — matches no policy at all and is
   refused by the database. `tests/invariants/policy-anzahl.test.ts` (§15) asserts the absence
   rather than trusting it.
2. **The transaction.** `withGroupScope` opens `set transaction read only` and sets
   `app.readonly = 'on'`, which the K-03 `with check` clause also tests. `withPersonScope` and
   `withKundeScope` do the same.
3. **The type.** All three yield `ScopedReadDb`, whose type does not expose `insert`,
   `update` or `delete`.
4. **The file tree.** `tests/invariants/gruppe-ohne-actions.test.ts` asserts that the glob
   `src/app/portal/gruppe/**/_actions.ts` matches nothing.

The group view's hue bar has no active mandant, so DESIGN §6 rule 4 is satisfied with a
neutral `--border-strong` bar plus the `NUR LESEN` pill — the shared `portal/layout.tsx` must
never be handed a null mandant and invent a colour.

**Who may enter, and with what.** Group entry requires `gruppe.<modul>.lesen` in the target
mandant (K-03), and `ctx.sichtbareMandanten` is derived server-side from `benutzer_mandant`
(K-14) — never from the request. Wage columns are unreachable from here because they are not
granted to `cse_app` at all (K-05), not because a page declines to render them.

### 3.9 `portal/mein` — the employee portal (EMP-01..EMP-15)

```
│  ├─ mein/
│  │  ├─ layout.tsx                 # person session; de/en/ar/tr switch + dir="rtl" (EMP-12)
│  │  ├─ page.tsx                   # today, next shift (EMP-02)
│  │  ├─ schichten/page.tsx         # ALL employments, each labelled with its entity (EMP-14)
│  │  ├─ zeiten/page.tsx            # today · week · month total (EMP-03)
│  │  ├─ stundenkonto/page.tsx      # per employment, combined view (EMP-04, EMP-15)
│  │  ├─ urlaub/page.tsx            # EMP-05
│  │  ├─ monatsnachweis/page.tsx    # EMP-06 — PDF via api/nachweis/monat/[anstellungId]/[monat]
│  │  ├─ einwand/[zeiteintragId]/page.tsx   # EMP-07 — raises an objection, never an edit
│  │  ├─ nachweise/page.tsx         # EMP-08 own certificates + expiry
│  │  ├─ dienstanweisungen/page.tsx # EMP-09, SEC-06 acknowledgement from the phone
│  │  ├─ antraege/page.tsx          # EMP-10 sickness, leave, shift swap
│  │  ├─ dokumente/page.tsx         # EMP-11
│  │  └─ nachrichten/page.tsx       # EMP-11
```

### 3.10 `portal/kunde` — the customer portal (AUT-01 `kunde`, DSH-03)

```
│  └─ kunde/
│     ├─ layout.tsx                 # customer session (src/server/auth/customer-session.ts)
│     ├─ page.tsx                   # scoped dashboard (DSH-03, DSH-04)
│     ├─ projekte/page.tsx          # CRM-06, OPS-05
│     ├─ auftraege/page.tsx         # CRM-06, OPS-11
│     ├─ angebote/{page.tsx,[id]/page.tsx}     # OPS-08, OPS-09 acceptance
│     ├─ rechnungen/{page.tsx,[id]/page.tsx}   # FIN-11, FIN-12 downloads only
│     ├─ leistungsnachweise/[id]/page.tsx      # CLN-04 signature on canvas
│     ├─ dokumente/page.tsx         # DOC-03, DOC-04
│     └─ nachrichten/page.tsx       # NOT-03
```

### 3.11 Why `mein` and `kunde` are not under `[mandant]`, and how invariant 10 survives

EMP-14 requires one login per **person** and a schedule spanning all of that person's
employments; CRM-06 requires a customer history across all four areas. Neither read scope is
"one mandant", so forcing them under `[mandant]` would either lie about the scope or require a
mandant switch to see one's own Tuesday shift.

**Neither runs under group scope, and that is K-18.** An earlier draft routed both through
`withGroupScope` because there were only two scopes to choose from. That is a category error
with a concrete consequence: K-03's group policy requires `gruppe.<modul>.lesen`, a management
right an employee or a customer will never hold, so **both portals would read exactly zero
rows** — and the cheapest way to make that green is to grant `gruppe.zeit.lesen` to
`mitarbeiter`, which hands every cleaner a group-level read across three GmbHs. The two
portals do span tenants, but they span them **as a subject, not as a manager**.

So reads run under `withPersonScope` (`app.scope = 'person'`) and `withKundeScope`
(`app.scope = 'kunde'`), each with its own SELECT-only policy keyed on the subject (§4.5,
K-18):

```sql
using (app.scope() = 'person'
       and mandant_id = any (app.sichtbare_mandanten())
       and <the row belongs to app.aktuelle_person()>)
```

`app.sichtbare_mandanten()` is derived server-side in both — from the person's `anstellung`
rows, or from the customer's own `auftrag` / `angebot` / `rechnung` rows via `kunde_zugang` —
never from the request (K-02). On top of that policy, **K-04's restrictive ceiling** still
applies: the ceiling says *at most your own rows*, the K-18 policy says *these rows, in these
tenants*, and both must pass. The customer half is keyed on `app.aktuelle_kunden()` (§4.4).

Writes never run in that scope. Every write in these two subtrees **resolves exactly one
mandant from the record being written, server-side**: a `zeit_einwand` is raised against a
`zeiteintrag`, which hangs off an `anstellung_id`, which belongs to exactly one mandant (D-09
consequence 5). The helpers are `withAnstellung(ctx, anstellungId, fn)` and
`withKundenVorgang(ctx, vorgangId, fn)` (§4.3); both resolve the mandant, open a normal single-
mandant transaction, and write `audit_log` with the resolution path. A write with an ambiguous
or absent mandant throws before it reaches SQL. K-18 says the same thing from the other side:
the write columns in both portals are narrow by design — EMP-07 is explicit that an employee
raises a `zeit_einwand` and **never** edits a `zeiteintrag`, and a customer writes only its own
messages, uploads and an OPS-09 acceptance.

### 3.12 `check-in/[token]` — session-less (TIM-07, TIM-08, TIM-09, K-08, K-09)

```
└─ check-in/
   └─ [token]/
      ├─ layout.tsx                 # locale from the token's person (EMP-12) · dir="rtl" for ar
      ├─ page.tsx                   # TIM-07 · one screen, one button, no scroll (DESIGN §8)
      ├─ _schemas.ts                # device time, offline-queue payload (TIM-09)
      └─ _actions.ts                # calls app.checkin_verbrauchen — computes nothing
```

This screen is the most worker-facing surface in the product, so the language switch and the
RTL direction live in its own layout, not only in `portal/mein/layout.tsx` (EMP-12).

**There is exactly one punch implementation, and it is in the database.** Per **K-08**, the
check-in path has no session, therefore no GUCs, therefore every K-03 policy evaluates false
for it; it does no table access of its own. `app.checkin_verbrauchen(token_hash, geraet_zeit,
ip)` runs as `cse_checkin`, derives `mandant_id` and `anstellung_id` from the `einsatz`,
stamps the authoritative instant from the database clock, stores the device time and the
derived `zeitabweichung_sek` separately (invariant 5, TIM-08), and inserts the `zeiteintrag`
itself. Per **K-09** the token is consumed by a conditional update, and zero rows returned
*is* the 409.

The offline queue (TIM-09) is the **same trust boundary arriving late**, and K-08's register
now says so: `api/check-in/[token]/route.ts` calls
`app.offline_ereignis_annehmen(token_hash, ereignisse, ip)` as `cse_checkin` — same token,
same subject, same conditional-write discipline (K-09), each replayed event flagged late with
its claimed instant kept beside the server instant. Splitting the replay onto a different
mechanism would mean two trust boundaries for one fact. **There is no
`supabase/functions/checkin-punch`.** A
Deno Edge Function cannot import `src/server/services`, so "same service call, no duplicated
logic" is unachievable; worse, it is a second machine with a second clock, which makes
`zeitabweichung_sek` depend on which endpoint the phone happened to reach. One writer, one
clock, one implementation.

### 3.13 `api/` — non-UI callers only

Server Actions handle every mutation that originates in our own React tree. A route handler
exists only where the caller is not our React tree: a webhook, a cron dispatcher, a tokenised
device, a file download, a calendar client, an external system.

```
└─ api/
   ├─ health/route.ts
   ├─ cron/[job]/route.ts           # shared-secret verified; dispatches src/server/jobs/_registry.ts
   ├─ webhooks/
   │  ├─ supabase-auth/route.ts     # AUT-08
   │  └─ n8n/route.ts               # external glue inbound only — never business logic
   ├─ check-in/[token]/route.ts     # TIM-07 single-use (K-09); TIM-09 offline replay via
   │                                #   app.offline_ereignis_annehmen as cse_checkin (K-08)
   ├─ formular/[bereich]/route.ts   # REQ-01 public form POST, rate-limited (AUT-07)
   ├─ bewerbung/route.ts            # REC-03 web intake POST, rate-limited, DOC-06 upload rules
   ├─ upload/route.ts               # DOC-06 real MIME sniff, size limit, EXIF strip (TIM-10)
   ├─ dokument/
   │  ├─ [id]/signed-url/route.ts   # DOC-03, SEC-A6 — 15-minute expiry, never a public path
   │  └─ buendel/[id]/route.ts      # DOC-08 one-click bundle stream (ZIP), audit-logged
   ├─ ical/[token]/route.ts         # CAL-03 read-only feed via app.ical_feed_lesen as cse_anon (K-08)
   ├─ freigaben/[id]/route.ts       # K-13 — the GET that writes freigabe_ansicht (APR-08)
   ├─ rechnung/[id]/
   │  ├─ pdf/route.ts               # FIN-12 ZUGFeRD 2.x PDF/A-3, rendered from the K-12 snapshot
   │  └─ xrechnung/route.ts         # FIN-11 UBL EN 16931 with Leitweg-ID, from the same snapshot
   ├─ nachweis/
   │  ├─ monat/[anstellungId]/[monat]/route.ts     # EMP-06 Monatsnachweis PDF
   │  └─ leistung/[id]/route.ts                    # CLN-04 Leistungsnachweis PDF with signature snapshot
   ├─ bau/
   │  ├─ behinderung/[id]/route.ts  # BAU-06 Behinderungsanzeige PDF + documented send date
   │  └─ bautagebuch/[projektId]/[tag]/route.ts    # BAU-07 daily log PDF
   ├─ export/
   │  ├─ datev/route.ts             # ACC-02 EXTF, Windows-1252
   │  ├─ z3/route.ts                # ACC-09 §147 Abs. 6 AO
   │  ├─ jahrespaket/route.ts       # ACC-11 year-end package
   │  ├─ lohn/route.ts              # ACC-12
   │  ├─ dsgvo/[personId]/route.ts  # LEG-09 data-subject export, aal2 + audit-logged
   │  └─ csv/route.ts               # REP-07
   └─ agent/stream/route.ts         # AGT-07 CEO Assistant streaming answers
```

Every handler uses the same wrapper from `src/server/http/handler.ts`, which enforces the L1
shape and maps errors: `NotFoundError` → 404, cross-tenant → **404** (AUT-06, K-02),
`ZodError` → 422, `PolicyDeniedError` → 403, `NotConnectedError` → 503 with the German
„Nicht verbunden" reason, `TokenVerbrauchtError` → 409 (K-09), everything else → 500 with a
correlation id and no detail in the body.

**Three download routes exist because a template without a route is a feature nobody can
reach.** EMP-06, CLN-04, BAU-06 and BAU-07 each render from `src/server/pdf/templates/`; the
invoice PDF and XRechnung render **from the K-12 identity snapshot**, never from live master
data, so re-issuing a copy years later produces the same bytes the hash covers.

`api/freigaben/[id]` is the one **read with a mandated side effect** (K-13): it writes
`freigabe_ansicht(freigabe_id, benutzer_id, geoeffnet_am_server)`, and the decision action
computes `pruefdauer_sek` from that row and is refused when no view row exists. `geoeffnet_am`
never appears in a request body — a rubber-stamping detector that trusts a client timestamp is
defeated by the exact actor it targets. The approval page and this route call the same
function, `queries/freigabe.freigabeOeffnen` (§7).

`api/ical/[token]` is a bearer-token feed of one person's whereabouts, and it has **no
session** — a calendar client sends a URL and nothing else. It is therefore on the K-08
register: `app.ical_feed_lesen(feed_token_hash)`, `SECURITY DEFINER`, executable by `cse_anon`,
read-only by construction, returning one user's own `kalender_eintrag` rows and nothing else.
The token is per user, rotatable and revocable from `einstellungen/benachrichtigungen`, and its
issuance and rotation are written to `audit_log` (CAL-03, SEC-A9). Without the register entry
this route would either need a session it cannot have or a table grant to `cse_anon`, which
K-01 forbids outright.

---

## 4. `src/server/db` — the only door to Postgres

```
src/server/db/
├─ client.ts                     # the raw Drizzle handle — import-restricted to four modules
├─ tenant.ts                     # withTenant · withGroupScope · withPersonScope ·
│                                #   withKundeScope · withAnstellung · withKundenVorgang ·
│                                #   withSystemTenant                              K-18
├─ types.ts                      # TenantDb · ScopedReadDb — branded handle types
├─ rls.ts                        # THE table classification (§5) — read by the build and the tests
├─ tabellen-klassen.ts           # the agent-facing table classes (R-17): which tables a tool may
│                                #   read, which are draft targets, which are never reachable —
│                                #   the three assertion shapes of 06-AGENTEN §2.3 key on this
├─ schema/
│  ├─ _shared.ts                 # column helpers: mandantId(), gemeinsam(), geldCent(), zeitpunkt(), menge()
│  ├─ enums.ts                   # every pgEnum, one place
│  ├─ kern.ts · personal.ts · crm-ops.ts · gewerke.ts · zeit.ts · finanz.ts ·
│  │                             #   radar-ki-inhalt.ts · integration.ts
│  ├─ zeit-intern.ts             # pgSchema('zeit_intern') — K-06, NOT exposed by PostgREST
│  ├─ relations.ts               # cross-file Drizzle relations only
│  └─ index.ts                   # ALLOWED BARREL #1 — Drizzle needs one schema object
├─ migrations/                   # committed; generated by drizzle-kit; never edited after merge
│  ├─ 0000_*.sql … · meta/
├─ rls/                          # authored by hand, folded into migrations by `pnpm db:rls`
│  ├─ _helpers.sql               # the K-02/K-03 accessors — fail-closed, see §4.4
│  ├─ _rollen.sql                # the six roles of K-01, their grants, FORCE RLS assertions
│  ├─ kern.sql · personal.sql · crm-ops.sql · gewerke.sql · zeit.sql · finanz.sql ·
│  │                             #   radar-ki-inhalt.sql · integration.sql
│  ├─ person-scope.sql           # the person-scoped bucket (§5.2) + the K-18 person policy
│  ├─ kunde-scope.sql            # the K-18 kunde policy, keyed on app.aktuelle_kunden()
│  ├─ job-scope.sql              # the t_job policies `to cse_job`, generated from rls.ts.job (§4.5)
│  ├─ arbzg-verstoss.sql         # the K-06 select-only variant on arbeitszeit_verstoss (§5.1)
│  └─ portal-ceiling.sql         # the K-04 restrictive ceilings, generated from rls.ts
├─ funktionen/                   # SECURITY DEFINER functions, owned by cse_definer (K-01)
│  ├─ sitzung.sql                # app.sitzung_aufloesen (returns the membership set, §12.1),
│  │                             #   app.versuch_protokollieren                        K-08
│  ├─ checkin.sql                # app.checkin_verbrauchen, app.offline_ereignis_annehmen
│  │                             #                                                     K-08, K-09
│  ├─ ical.sql                   # app.ical_feed_lesen                                 K-08, CAL-03
│  ├─ arbzg.sql                  # app.arbzg_belastung, app.arbzg_befund_schreiben      K-06
│  ├─ entgelt.sql                # app.entgelt_lesen                                    K-05
│  ├─ kunde.sql                  # app.aktueller_kunde, app.aktuelle_kunden             K-04, K-18
│  └─ audit.sql                  # app.audit_schreiben (mirror rows, e.g. TEN-09)
├─ triggers/                     # DB-level enforcement of the invariants
│  ├─ immutable-rechnung.sql     # FIN-02, K-12 — unconditional; no column allowlist
│  ├─ hash-chain.sql             # FIN-06 — chain head under the K-12/FIN-03 row lock
│  ├─ freigabe-kette.sql         # K-13 — freigabe_snapshot.kette_nr under FOR UPDATE
│  ├─ no-hard-delete.sql         # invariant 8, K-16 — per-table, enumerated in rls.ts
│  ├─ audit-log.sql              # SEC-A9 vorher/nachher payloads + akteur_art + ip
│  ├─ stundenkonto-lock.sql      # EMP-04 locked month is immutable
│  └─ arbeitszeit-fenster.sql    # K-06 — maintains zeit_intern.arbeitszeit_fenster
└─ seed/
   ├─ index.ts
   ├─ 01-mandanten.ts            # TEN-01 four areas · mandant_modul · identity hue · TODO(client) O-01
   ├─ 02-rollen-benutzer.ts      # AUT-01 five roles, AUT-03 permission matrix
   ├─ 03-personen-anstellungen.ts  # includes one person employed by reinigung AND security (D-09)
   ├─ 04-kunden-objekte-raeume.ts  # Berlin addresses, real Raumbuch shape (OPS-01, OPS-02)
   ├─ 05-kataloge.ts             # belagsart performance values, leistungskatalog (OPS-03, OPS-06)
   ├─ 06-angebote-auftraege.ts   # CRM-05 chain lead → angebot → auftrag
   ├─ 07-dienstplan-zeiten.ts    # 22:00–06:00 · both DST nights · month-end · ten concurrent shifts
   │                             #   · one 6h reinigung + 5h security day for the K-06 test
   ├─ 08-finanzen.ts             # drafts without numbers + a finalized hash chain
   ├─ 09-radar.ts                # ausschreibung + radar_profil per area · empty vergabeplattform (O-07)
   ├─ 10-agent.ts                # agent_richtlinie, agent_budget
   ├─ 11-inhalt.ts               # seite, referenz, social_post
   ├─ 12-recruiting.ts           # stelle, bewerbung, kandidat
   ├─ 13-freigaben.ts            # freigabe + freigabe_snapshot chain head per mandant (K-13)
   └─ fixtures/
      ├─ berlin-adressen.ts · namen.ts
      └─ feiertage-berlin.ts     # CLN-03 — a thin adapter over src/lib/datum/feiertage-berlin.ts;
                                 #   it persists, it never computes (§8.5)
```

### 4.1 Database roles (K-01)

Six named Postgres roles. The application never connects as `postgres`, and **no application
role holds `BYPASSRLS`.** `src/server/db/rls/_rollen.sql` is the only place they are created
and granted.

| Role | Used by | Holds |
|---|---|---|
| `cse_migrator` | migrations in CI | DDL. Never used at runtime. |
| `cse_definer` | owner of every `SECURITY DEFINER` helper in `db/funktionen/` | The only role exempt from FORCE RLS, and only on the tables named in K-06 and K-08. Cannot log in. |
| `cse_app` | every authenticated request | DML through RLS. No table grants beyond the column grants of K-05. |
| `cse_anon` | pre-session requests | `EXECUTE` on exactly its three rows of the K-08 register — `app.sitzung_aufloesen`, `app.versuch_protokollieren`, `app.ical_feed_lesen`. No table grants at all. |
| `cse_checkin` | `/check-in/[token]`, `api/check-in/[token]` and its offline replay | `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` only (K-08). |
| `cse_job` | the connection role for cron, Edge dispatch and `scripts/` | `NOINHERIT`, plus `GRANT cse_app TO cse_job`. It holds no tenant-table grants of its own; `withSystemTenant` issues `SET LOCAL ROLE cse_app` before it sets a single GUC (§4.3). Its own enumerated grants (`JobDefinition.grants`, §10) cover only what runs outside a tenant transaction. |

**`ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant table.** Without `FORCE`, RLS does
not apply to the table owner, and a migration-owned connection silently sees everything — every
policy in `db/rls/*.sql` would be dead code in production while an isolation test written
against the owner role still passed. Every `SECURITY DEFINER` function is owned by
`cse_definer` and carries `SET search_path = pg_catalog, public`; an unqualified `search_path`
on a definer function is a privilege-escalation vector.

**`cse_job` connects; `cse_app` executes.** This is the one role rule that an earlier draft got
backwards, and the failure mode is the one this whole section exists to prevent. K-03 gives a
tenant table **exactly two policies, both `to cse_app`**, and every tenant table carries
`ENABLE` **and** `FORCE` RLS. A role that appears in no policy therefore matches no policy, and
under RLS that is not an error — it is zero rows on every `SELECT` and a silent refusal on every
`INSERT`. Had `withSystemTenant` run *as* `cse_job`, every job in §10, every importer in
`scripts/`, the REQ-01 lead POST and the REC-03 application POST would have been refused by a
database whose SQL reads perfectly. Table `GRANT`s do not substitute for a policy.

So `cse_job` is `NOINHERIT` and a member of `cse_app`, and `withSystemTenant` begins its
transaction with `set local role cse_app`. Every K-03 policy then applies to a job exactly as it
applies to a request; there is no third policy, no `BYPASSRLS`, and nothing to amend in K-01 or
K-03. **Containment comes from the system principal's own rights**, not from the connection: the
system principal is a service `benutzer` row with real `benutzer_mandant` memberships and a role
whose `hat_recht` grants are seeded in `db/seed/02-rollen-benutzer.ts` and reviewed like any
other role. A job that has no right to write `rechnung` cannot write one.

`.env.example` therefore carries **two** connection strings and no others: `DATABASE_URL_APP`
(role `cse_app`) and `DATABASE_URL_JOB` (role `cse_job`, which becomes `cse_app` inside every
tenant transaction). The migration URL exists only in CI. `src/server/config/env.ts` rejects a
`DATABASE_URL_APP` whose user is `postgres` at boot, and
`tests/isolation/db/job-rolle.test.ts` asserts that a `cse_job` connection **without** the
`SET LOCAL ROLE` reads zero rows from a tenant table — so the mechanism cannot quietly stop
being applied.

### 4.2 Session state (K-02)

Set with `set_config(..., true)` — transaction-local, so a pooled connection cannot leak an
entity's identity into the next request — inside the helpers of §4.3, never from a URL
parameter (invariant 3, TEN-04, AUT-04).

| GUC | Meaning |
|---|---|
| `app.benutzer_id` | the authenticated `benutzer` |
| `app.person_id` | the `person` behind that login, or NULL |
| `app.mandant_id` | **exactly one** mandant, or NULL in **every** multi-tenant scope (K-02, K-18) |
| `app.mandant_ids` | the mandanten the user may read — `gruppe`, `person` **and** `kunde` scope; always derived server-side |
| `app.scope` | `mandant` \| `gruppe` \| `person` \| `kunde` — the four of **K-18** |
| `app.portal` | `intern` \| `mitarbeiter` \| `kunde` |
| `app.readonly` | `on` \| `off` — **defaults to `on`** |
| `app.aal` | `aal1` \| `aal2` — assurance level of the session |
| `app.akteur_typ` | `mensch` \| `agent` \| `system` — **audit only** (SEC-A9) |
| `app.akteur_id` | the acting principal when it is not a `benutzer`: the agent run id, the job run id — **audit only** (SEC-A9) |
| `app.ip` | request IP — **audit only** (SEC-A9) |

The last three extend K-02's eight for one reason: SEC-A9 requires the audit log to record who
acted, of what kind, and from where; `db/triggers/audit-log.sql` writes the audit row **inside
the database**, and a value that is never transported into the session cannot be recorded there.
Agent- and job-initiated writes have no `benutzer` row of their own, which is the exact case
`akteur_typ` exists to disambiguate — and without `akteur_id` beside it the actor's identity is
merely *typed*, not *named*: "an agent did this" with no way back to which run. `audit_log` is a
no-hard-delete domain (invariant 8), so none of it is repairable retroactively.
`agent/orchestrator.ts` constructs its `SessionContext` with `akteurTyp = 'agent'` and the agent
run id as `akteurId`; `jobs/_runner.ts` uses `'system'` and the `job_lauf` id.

**None of the three carries authorisation weight: no policy in `db/rls/*.sql` may reference
them.** `tests/invariants/rls-guc-nutzung.test.ts` asserts that, which is what keeps a
transported, unverified value out of an access decision.

**This is a stated divergence from K-02, not a discovered one.** K-02 publishes eight GUCs;
this table publishes eleven, and §26 binds `00-KONVENTIONEN.md` to carry the three audit-only
rows with the no-policy-may-reference-them rule. Until that amendment lands, the convention wins
on every row it does list and this document is the defective one on the three it does not — §0
says so, and saying it here as well is cheaper than a reader discovering it.

**Fail-closed.** Every accessor in `_helpers.sql` coalesces a missing GUC to the most
restrictive value: no mandant, no rights, read-only. An unset session produces zero rows, never
all rows. The helper asserts `CHECK ((scope = 'mandant') = (mandant_id IS NOT NULL))` rather
than assuming it — in the three multi-tenant scopes `app.mandant_id` is NULL and
`app.mandant_ids` carries the set.

### 4.3 `db/tenant.ts` — seven helpers, and no eighth

Every database access in the application runs inside exactly one of these (L3). The **five**
functions of the K-08 closed register are the only code that reaches Postgres outside them, and
`tests/invariants/route-manifest.test.ts` asserts it — the test walks every route, action, job
and script and fails on a database call that is neither inside a helper nor one of the five
registered functions. A sixth register entry fails the build in the PR that introduces it,
which is what makes "closed register" mean something.

The count moved from five to seven because **K-18** split the two read scopes into four. It is
not a proliferation: `withPersonScope` and `withKundeScope` are the two scopes that were
previously — and wrongly — borrowing `withGroupScope`'s policy (§3.11).

| Helper | `app.scope` | `app.mandant_id` | `app.mandant_ids` | `app.portal` (K-20) | `app.readonly` | Role | Handle | Used by |
|---|---|---|---|---|---|---|---|---|
| `withTenant(ctx, fn)` | `mandant` | exactly one | — | from the **active membership's** role | `off` | `cse_app` | `TenantDb` | `portal/[mandant]/**`, its actions, most of `api/` |
| `withGroupScope(ctx, fn)` | `gruppe` | NULL | the readable set | **`intern`**, bound here | `on` | `cse_app` | `ScopedReadDb` | `portal/gruppe/**` only |
| `withPersonScope(ctx, fn)` | `person` | NULL | derived from the person's `anstellung` rows | **`mitarbeiter`**, bound here | `on` | `cse_app` | `ScopedReadDb` | every read in `portal/mein/**` |
| `withKundeScope(ctx, fn)` | `kunde` | NULL | derived from `kunde_zugang` and the customer's own `auftrag`/`angebot`/`rechnung` rows | **`kunde`**, bound here | `on` | `cse_app` | `ScopedReadDb` | every read in `portal/kunde/**` |
| `withAnstellung(ctx, anstellungId, fn)` | `mandant` | resolved from `anstellung` | — | from the resolved membership | `off` | `cse_app` | `TenantDb` | every write in `portal/mein/**` |
| `withKundenVorgang(ctx, vorgangId, fn)` | `mandant` | resolved from the record | — | `kunde` | `off` | `cse_app` | `TenantDb` | every write in `portal/kunde/**` |
| `withSystemTenant(mandantId, grund, fn)` | `mandant` | explicit | — | from the system principal's membership | `off` | `cse_job` → `SET LOCAL ROLE cse_app` | `TenantDb` | jobs, `scripts/`, `api/formular`, `api/bewerbung` |

**The `app.portal` column is the K-20 half of this table**, and it is the reason the helper sets
the GUC rather than leaving `_helpers.sql` to work it out: in the three multi-tenant rows
`app.mandant_id` is NULL, so a portal derived from `aktiver_mandant` has nothing to derive from
and falls through to the fail-closed `mitarbeiter` — blanking `portal/gruppe` for a Leitung and
ceilinging every customer as staff (§4.4, §4.6).

```ts
// src/server/db/tenant.ts
import 'server-only';

/** Branded. A service that wants a TenantDb cannot be handed the raw `db`. */
export type TenantDb =
  NodePgDatabase<typeof schema> & { readonly __tenant: unique symbol };

/** Read-only, possibly many mandanten. No insert/update/delete on the type at all. */
export type ScopedReadDb =
  Pick<NodePgDatabase<typeof schema>, 'select' | 'execute'> & { readonly __gruppe: unique symbol };

export async function withTenant<T>(
  ctx: SessionContext,                       // from src/server/auth/session.ts — never from params
  fn: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  if (!ctx.mandantId) throw new NoActiveMandantError();          // invariant 10
  return dbApp.transaction(async (tx) => {
    await setzeSitzung(tx, {
      scope: 'mandant', mandantId: ctx.mandantId, mandantIds: null,
      benutzerId: ctx.benutzerId, personId: ctx.personId,
      portal: ctx.portal, readonly: 'off', aal: ctx.aal,
      akteurTyp: ctx.akteurTyp, ip: ctx.ip,
    });
    return fn(tx as TenantDb);
  });
}

export async function withGroupScope<T>(
  ctx: SessionContext,
  fn: (tx: ScopedReadDb) => Promise<T>,
): Promise<T> {
  if (ctx.sichtbareMandanten.length === 0) throw new KeineSichtbarenMandantenError();
  return dbApp.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);             // invariant 10, layer 2
    await setzeSitzung(tx, {
      scope: 'gruppe', mandantId: null, mandantIds: ctx.sichtbareMandanten,
      benutzerId: ctx.benutzerId, personId: ctx.personId,
      portal: 'intern', readonly: 'on', aal: ctx.aal,     // K-20: bound here, not derived
      akteurTyp: ctx.akteurTyp, ip: ctx.ip,
    });
    return fn(tx as unknown as ScopedReadDb);
  });
}

/** K-18. Read-only, spans the person's employments, subject = app.aktuelle_person(). */
export async function withPersonScope<T>(
  ctx: SessionContext, fn: (tx: ScopedReadDb) => Promise<T>,
): Promise<T>;   // scope: 'person', mandantId: null, mandantIds: ctx.sichtbareMandanten,
                 // portal: 'mitarbeiter'   ← K-20, bound here

/** K-18. Read-only, spans the customer's Vorgänge, subject = app.aktuelle_kunden(). */
export async function withKundeScope<T>(
  ctx: SessionContext, fn: (tx: ScopedReadDb) => Promise<T>,
): Promise<T>;   // scope: 'kunde',  mandantId: null, mandantIds: ctx.sichtbareMandanten,
                 // portal: 'kunde'         ← K-20, bound here

/** Resolves the mandant from the record, never from the caller. EMP-07, EMP-09, EMP-10. */
export async function withAnstellung<T>(
  ctx: SessionContext, anstellungId: string, fn: (tx: TenantDb) => Promise<T>,
): Promise<T>;

/** Same shape for the customer side. CRM-06, OPS-09, CLN-04. */
export async function withKundenVorgang<T>(
  ctx: SessionContext, vorgangId: string, fn: (tx: TenantDb) => Promise<T>,
): Promise<T>;

/** Sessionless writes. `grund` is mandatory, is written to audit_log, and is a literal —
 *  never a value derived from a request body. Connects as cse_job and immediately
 *  `SET LOCAL ROLE cse_app`, so the K-03 policies apply (§4.1). */
export async function withSystemTenant<T>(
  mandantId: string, grund: SystemGrund, fn: (tx: TenantDb) => Promise<T>,
): Promise<T>;
```

Four consequences worth stating outright:

- **An empty readable set throws before the transaction opens.**
  `set_config('app.mandant_ids', '', true)` yields an empty array and a policy that matches
  nothing with no distinguishable message; `KeineSichtbarenMandantenError` renders as a
  German empty state instead of an unexplained blank page. `withPersonScope` and
  `withKundeScope` throw the same error for the same reason — an employee between employments
  and a customer with no live order are both real states, and both must read as an empty state
  rather than as a broken page.
- **`withSystemTenant` is a constructor, not a bypass.** It builds a synthetic system
  `SessionContext` (`akteur_typ = 'system'`, `benutzer_id` = the system principal,
  `akteur_id` = the `job_lauf` id) and goes through the same `setzeSitzung` after
  `set local role cse_app`. It satisfies K-08's manifest test because it *is* the tenant path;
  containment comes from the **system principal's `hat_recht` grants** evaluated by the same
  K-03 policies as any request (§4.1) — not from the connection role, and not from the portal
  GUC. `jobs/_runner.ts` therefore no longer imports `db/client.ts`.
- **The system principal's memberships are the job's mandant list.** `_runner.ts` iterates
  `systemCtx.sichtbareMandanten` — the service `benutzer`'s own `benutzer_mandant` rows,
  resolved once by `auth/session.ts` — and opens one `withSystemTenant` per entity. No job
  needs a read *before* it has a scope, so no eighth helper and no register entry appear to
  serve one.
- **`db/client.ts` is importable by exactly four modules:** `db/tenant.ts`,
  `db/seed/index.ts`, the migration runner, and `tests/helpers/db.ts`. Enforced by ESLint
  (§23).

### 4.4 `db/rls/_helpers.sql` — the accessors every policy is written against

```sql
-- all STABLE, all fail-closed, all owned by cse_definer (K-01, K-02)
app.aktueller_benutzer()   returns uuid     -- NULL when unset
app.aktuelle_person()      returns uuid     -- NULL when unset
app.scope()                returns text     -- 'mandant' | 'gruppe' | 'person' | 'kunde'   K-18
                                            --   NULL when unset — every scope test is then false
app.aktiver_mandant()      returns uuid     -- NULL unless scope = 'mandant'
app.sichtbare_mandanten()  returns uuid[]   -- '{}' unless scope ∈ {gruppe, person, kunde}
app.ist_gruppenansicht()   returns boolean  -- scope = 'gruppe' only; false when unset
app.ist_readonly()         returns boolean  -- TRUE when unset  ← the default that matters
app.portal()               returns text     -- reads app.portal, BOUND when the scope is entered;
                                            --   'mitarbeiter' when unset. NEVER recomputed from
                                            --   app.aktiver_mandant()                       K-20
app.aal()                  returns text     -- 'aal1' when unset
app.hat_recht(p_recht text, p_mandant uuid) returns boolean   -- false when unset
app.person_sichtbar(p_person uuid) returns boolean            -- false when unset
app.aktueller_kunde()      returns uuid     -- SECURITY DEFINER; the caller's kunde_zugang binding
                                            --   in the ACTIVE mandant. Resolved from kunde_zugang
                                            --   for app.aktueller_benutzer(), NEVER through
                                            --   app.aktiver_mandant()                       K-20
app.aktuelle_kunden()      returns uuid[]   -- SECURITY DEFINER; every kunde_zugang binding the
                                            --   caller holds, across app.sichtbare_mandanten().
                                            --   Defined in ALL FOUR scopes            K-18, K-20
```

**Every accessor has a stated value in all four scopes (K-20).** An accessor that reads
`app.aktiver_mandant()` returns NULL in the three multi-tenant scopes — `app.mandant_id` is NULL
there by construction (§4.2) — so any predicate built on it is false and the page reads zero rows.
That is the same silent failure K-18 exists to remove, reappearing one layer down, and it is why
the table below is exhaustive rather than exemplary. `tests/invariants/accessor-scopes.test.ts`
enumerates the accessors and asserts each returns a defined value, or a documented NULL, under
all four scopes.

| Accessor | `mandant` | `gruppe` | `person` | `kunde` |
|---|---|---|---|---|
| `app.aktueller_benutzer()` | the benutzer | the benutzer | the benutzer | the benutzer |
| `app.aktuelle_person()` | the person, or NULL | the person, or NULL | **the subject** | NULL (documented) |
| `app.scope()` | `mandant` | `gruppe` | `person` | `kunde` |
| `app.aktiver_mandant()` | the one mandant | **NULL** (documented) | **NULL** | **NULL** |
| `app.sichtbare_mandanten()` | `{}` (documented — use `aktiver_mandant()`) | the readable set | the person's employments | the customer's mandanten |
| `app.ist_gruppenansicht()` | false | true | false | false |
| `app.ist_readonly()` | `off` | `on` | `on` | `on` |
| `app.portal()` | the active membership's role → `intern` \| `mitarbeiter` | **`intern`**, bound at scope entry | **`mitarbeiter`**, by construction | **`kunde`**, by construction |
| `app.aal()` | the session's | the session's | `aal1` | `aal1` |
| `app.hat_recht(r, m)` | `m = aktiver_mandant()` | any `m ∈ sichtbare_mandanten()` | any `m ∈ …` — but no K-18 policy calls it | any `m ∈ …` — same |
| `app.aktueller_kunde()` | the binding in that mandant | NULL (documented) | NULL (documented) | `(app.aktuelle_kunden())[1]` |
| `app.aktuelle_kunden()` | the binding in that mandant, as a one-element array | `{}` | `{}` | **the whole subject of the request** |

`app.hat_recht()` **takes a mandant argument** (K-03). A global permission predicate carries a
right granted in one entity into every other entity the user can reach — precisely the leak RLS
exists to stop. Every right key it is ever passed is spelled as `03-AUTH-BERECHTIGUNGEN.md`'s
catalogue spells it (**K-19**): the function returns **false** for a key it does not know, so a
misspelled or unregistered key is a silent, permanent zero-row failure and not an error.

**The customer's identity is resolved, never transported, and it does not go through the active
mandant.** There is no `app.kunde_id` GUC: `app.aktueller_kunde()` and `app.aktuelle_kunden()`
are `SECURITY DEFINER` functions that read the session's `kunde_zugang` bindings for
`app.aktueller_benutzer()`. That matters twice over. K-04's customer ceiling is keyed on this
subject, and a ceiling whose subject arrives in a `set_config` call is a ceiling a compromised
request can move. And per **K-20** the resolution is **never** written as "the `kunde` row in
`app.aktiver_mandant()`" — in `kunde` scope that is NULL, every `t_kunde` policy and every
`p_kunde_ceiling` written against it is false, and the whole customer portal reads zero rows,
which is exactly what an empty portal is supposed to look like. A customer buying from
`reinigung` and from `bau` has two `kunde` rows in two mandanten, which is why the plural form is
the primary one: **`app.aktuelle_kunden()` is what policies use**, and the scalar survives only
as the `mandant`-scope convenience `(app.aktuelle_kunden())[1]`. With no `kunde_zugang` row both
return nothing, `kunde_id = any('{}')` is false, the restrictive ceiling is unsatisfied and the
session reads zero rows.

**`app.portal` is bound when the scope is entered, and defined in all four scopes (K-20).** In
`mandant` scope it is derived from the role of the **active membership** (K-04). In the three
multi-tenant scopes there is no active membership, so `db/tenant.ts` binds it at scope entry —
`intern` for `withGroupScope`, `mitarbeiter` for `withPersonScope`, `kunde` for `withKundeScope`
— and `_helpers.sql` reads the GUC rather than recomputing anything. Recomputing it from
`app.aktiver_mandant()` is the defect K-20 names: with a NULL mandant the derivation falls
through to the fail-closed `'mitarbeiter'`, which fires **every** K-04 employee ceiling inside
the group view — a `leitung` in `portal/gruppe` then reads nothing — and ceilings every customer
as though they were staff. `tests/invariants/accessor-scopes.test.ts` asserts the four values.

**`app.portal()` defaults to `mitarbeiter`, not `kunde`.** That default applies to an *unset*
session only — a request with no scope at all. An earlier draft called `'kunde'`
"the narrowest ceiling", which is not what the two ceilings do. K-04 writes both as
`app.portal() <> '<portal>' or <subject predicate>`, so an unset GUC set to `'kunde'` satisfies
the *worker* ceiling's first disjunct and switches fifteen tables' worth of enforcement off.
`'mitarbeiter'` is the genuinely narrower default: it fails the worker ceiling's first disjunct,
and the second disjunct is false because `app.aktuelle_person()` is NULL, so the ceiling denies.
Two things must be said plainly alongside it. The ceilings are **restrictive** policies — they
subtract, they never grant — so they are not what makes an unset session safe; **K-03 is**, and
an unset session has no mandant, no `mandant_ids` and no rights, so every permissive policy is
already false. And the customer ceiling's own subject is NULL without a session, so it denies
too. This default hardens a second line; it is not the first one.

### 4.5 The standard policy shape (K-03)

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

Both halves matter. A `USING`-only policy filters reads and leaves `INSERT` and the post-image
of `UPDATE` unconstrained — a service bug or a Zod-validated body carrying a `mandant_id` could
write a row into another entity, and an isolation suite that only checks "user of A selecting
B's row gets zero rows" would pass. `mandant_id` is therefore **never accepted from an input
schema**: it is written by `_shared.mandantId()` defaults or set by the service from the
session context. `tests/isolation/db/write-check.test.ts` asserts that an INSERT and an UPDATE
carrying a foreign `mandant_id` both raise.

A policy that omits the `hat_recht` conjunct is a defect. Tenant membership alone must never
grant read access to a module — otherwise a `kunde` login reads the staff directory and every
colleague's MiLoG hour records.

**The two subject-scoped policies of K-18.** A tenant table that the employee portal or the
customer portal reads carries, in addition, a SELECT-only policy keyed on **the subject** — not
on a group right, which is the whole point of K-18 (§3.11):

```sql
-- 3. person scope: SELECT ONLY, and only the caller's own rows
create policy t_person on <tabelle>
  for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and <the row belongs to app.aktuelle_person()>);

-- 4. kunde scope: SELECT ONLY, and only the caller's own customer rows
create policy t_kunde on <tabelle>
  for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));
```

`src/server/db/rls.ts` records which tables carry which of the two, because most do not carry
either: `rechnung` is read by both portals, `nummernkreis` by neither. The customer disjunct is
always the **array** form `kunde_id = any (app.aktuelle_kunden())`; the scalar
`app.aktueller_kunde()` appears in no `t_kunde` policy and in no `p_kunde_ceiling`, because in
`kunde` scope it is a one-element read of the same binding and in every other scope it is a trap
(§4.4, **K-20**).

**A fifth permissive class: `t_job`, and only where `rls.ts` says so.** Under FORCE RLS a table
`GRANT` is not a policy, so the parts of a job that genuinely run **as `cse_job`** — outside a
tenant transaction, before any scope exists — match no policy and read zero rows. Inside
`withSystemTenant` that case does not arise, because the helper issues `SET LOCAL ROLE cse_app`
and the two K-03 policies apply unchanged (§4.1); this class exists for the run-log and
integration bookkeeping a job writes **around** its tenant transactions, and for the tables
`02-datenmodell/02-CRM-OPERATIONS.md` and `06-RADAR-KI-INHALT.md` enumerate for their §8.1 jobs:

```sql
-- 5. job scope: only where rls.ts declares it, and never `to cse_app`
create policy t_job on <tabelle>
  for all to cse_job
  using      (true)
  with check (true);   -- containment is the job's own enumerated grants (§10), not this policy
```

The name is **`t_job`**, not `j_job` — one name across every document, so the generated SQL and
the policy-count test agree. It is declared in `rls.ts.job` and generated into
`db/rls/job-scope.sql`; a table carrying `t_job` without a `rls.ts.job` entry fails the build,
and no `t_job` policy is ever written on a table that `withSystemTenant` already reaches as
`cse_app`.

**"Exactly two policies" counts permissive policies for `cse_app`.** K-03's rule and K-04's
ceilings are not in conflict and never were: a `restrictive` policy in Postgres is `AND`-ed onto
the permissive set and can only ever subtract rows, which is why K-04 and K-15 both add one
without amending K-03. So the invariant this document generates and tests is precise: **at most
four permissive policies `to cse_app` per tenant table** — `t_mandant`, `t_gruppe`, and where
`rls.ts` declares them `t_person` and `t_kunde` — **plus at most one `t_job` policy `to cse_job`
where `rls.ts.job` declares it, plus whatever restrictive ceilings `rls.ts` declares**, and no
permissive policy anywhere for `INSERT`, `UPDATE` or `DELETE` **to `cse_app`** outside
`t_mandant`. That last clause is what makes invariant 10 a database guarantee: a write under
group, person or kunde scope matches no policy at all. `t_job` cannot weaken it, because
`cse_job` is not the role any portal request ever runs as.

### 4.6 Portal ceilings (K-04)

`app.portal()` derives from **the role of the active membership**, not from the existence of a
membership: a `mitarbeiter` membership resolves to `portal = 'mitarbeiter'` however many other
memberships exist; `intern` requires the active membership's role ∈ {`super_admin`, `admin`,
`leitung`}. That derivation applies in `mandant` scope, where an active membership exists. In
the three multi-tenant scopes of K-18 there is none, so `app.portal` is **bound when the scope is
entered** (`intern` · `mitarbeiter` · `kunde`, §4.3, §4.4) and never recomputed from
`aktiver_mandant` — **K-20**, because recomputing it there falls through to the fail-closed
`mitarbeiter` and fires every ceiling below inside the group view. EMP-13 is structural, not a
UI decision:

```sql
create policy p_ma_ceiling on <tabelle> as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select id from anstellung
                              where person_id = app.aktuelle_person()));
```

The ceiling list is **enumerated in `src/server/db/rls.ts`, not exemplified** — `anstellung`,
`person`, `stundenkonto`, `urlaubskonto`, `abwesenheit`, `zeit_einwand`, `antrag`, `einsatz`,
`einsatz_zuordnung`, `zeiteintrag`, `zeiteintrag_korrektur`, `medien`, `da_kenntnisnahme`,
`nachweis`, `bewacher_eintrag` — and the build fails when an anstellung-hung or person-hung
table has no ceiling. `db/rls/portal-ceiling.sql` is generated from `rls.ts`, so the list has
exactly one source.

The customer half has the same shape and, crucially, **a subject that exists**:

```sql
create policy p_kunde_ceiling on <tabelle> as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or kunde_id = any (app.aktuelle_kunden()));
```

`app.aktuelle_kunden()` is defined in §4.4 and resolved inside the database from `kunde_zugang`
(§4.9, `kern.ts`). Writing the ceiling against a GUC that no helper sets — which an earlier
draft did, by naming `kunde_id` and defining nothing — produces a policy that cannot be authored
at all, and the shortest path from there is to drop the ceiling and rely on the page.

### 4.7 Wage confidentiality (K-05) — column privileges, not masking views

D-09 §6 — *a cleaning manager must not see security wage rates* — is enforced with
**column-level `GRANT`**, which composes correctly with RLS:

```sql
revoke select on anstellung from cse_app;
grant  select (id, person_id, mandant_id, personalnummer, eintritt, austritt,
               status, arbeitszeitmodell, wochenstunden, erstellt_am, geaendert_am)
       on anstellung to cse_app;   -- stundensatz_intern, tarifgruppe omitted
```

**The column is `stundensatz_intern`, without a `_cent` suffix.** K-05 and
`02-datenmodell/01-KERN.md` §6.14 fix that spelling and the same column exists on
`anstellung_kondition`; the `_cent` suffix appears only on the **HTTP wire field**
`stundensatz_intern_cent` (`05-API-KARTE.md` R-12). §21's money-column rule therefore has this
one named exception, stated at the column rather than discovered at the migration.

Masking views are forbidden for this purpose. `select a.*, case … end as rate_masked` hands out
the raw column and adds a masked copy beside it; and the two ways to make a view work are both
wrong — with `security_invoker = true` the caller needs base-table privileges that were just
revoked, so the table is unreadable, and without it the view runs as its owner and, if that
owner can bypass RLS, returns every tenant's rows with the tenant predicate silently ignored.

The rate is reachable only through `app.entgelt_lesen(p_anstellung uuid)` — `SECURITY DEFINER`,
re-checks `personal.entgelt_lesen` **and** `mandant_id = app.aktiver_mandant()`, and writes
`audit_log`. `tests/isolation/db/entgelt.test.ts` asserts that a `reinigung` Leitung cannot
reach a `security` `stundensatz_intern` by any route — direct select, group scope, the
person view, a report, or a `select *`.

### 4.8 The ArbZG cross-entity window (K-06) — the one sanctioned crossing

TIM-14, LEG-03 and D-09 consequences 1 and 2 require aggregating one person's hours **across
entities**, which K-03 makes impossible by design. Left unresolved the check silently returns
"no conflict" and a 6h + 5h day is scheduled as lawful — the exact failure D-09 was written to
prevent, with no error to notice. K-06 sanctions exactly one crossing, and it is narrow,
audited and tested. This document fixes only its **placement**:

| Artefact | Location |
|---|---|
| `zeit_intern.arbeitszeit_fenster` (one row per assignment, **`person_id`** — the query key — `zuordnung_quelle_id`, `quelle`, `aktiv`, `beginn_utc`, `ende_utc`, plus `mandant_id` and `anstellung_id`, stored and never returned) | `src/server/db/schema/zeit-intern.ts` — a `pgSchema`, **not exposed by PostgREST** |
| The trigger that maintains it, including the plan/ist supersede rule | `src/server/db/triggers/arbeitszeit-fenster.sql` |
| `app.arbzg_belastung(p_person, p_von, p_bis)` → `(fenster_gruppe text, beginn_utc, ende_utc, minuten integer, fremd boolean)` | `src/server/db/funktionen/arbzg.sql` |
| `app.arbzg_befund_schreiben(...)` — the only writer of `arbeitszeit_verstoss`, which has **no INSERT policy for `cse_app`** | same file |
| The only caller | `src/server/services/arbzg/` — nothing else in the tree may call either function |
| Isolation test | `tests/isolation/db/arbzg.test.ts` |

The return shape is **durations and interval boundaries and nothing else** — never
`mandant_id`, never the entity's name, never `objekt`, `kunde`, `personalnummer` or
`stundensatz_intern`. The caller learns *that* the person is otherwise committed, never
*where* or *for whom*. Widening that shape requires amending K-06 first.

### 4.9 `db/schema` — files, tables, and the SPEC IDs they serve

One file per domain, following the entity grouping of SPEC §22 so a reader can move between
the two documents without translation. **This table places tables in files; it declares
nothing.** Per **K-21** every table is declared exactly once, by the document that owns its
domain, and this document references those declarations using the owner's exact names.

| File | Tables | Primary SPEC IDs |
|---|---|---|
| `kern.ts` | `mandant`, `mandant_modul`, `mandant_einstellung`, `benutzer`, `benutzer_sitzung`, `kunde_zugang`, `rolle`, `berechtigung`, `rolle_berechtigung`, `benutzer_mandant` (incl. `aus_anstellung`, K-14), `audit_log`, `sicherheitsvorfall`, `loeschprotokoll`, `dokument`, `dokument_version`, `dokument_buendel`, `kalender_eintrag`, `ical_token`, `aufgabe`, `benachrichtigung`, `benachrichtigung_praeferenz`, `nachricht`, `job_lauf`, `job_lauf_mandant` | TEN-01..TEN-10, AUT-01..AUT-08, DOC-01..DOC-08, CAL-01..CAL-03, NOT-01..NOT-03, SEC-A9, LEG-09, REC-07, SPEC §21 |
| `personal.ts` | `person`, `anstellung`, `anstellung_kondition`, `qualifikation`, `nachweis`, `nachweis_art`, `bewacher_eintrag`, `mitarbeiter_zugang`, `abwesenheit`, `stundenkonto`, `urlaubskonto`, `zeit_einwand`, `antrag` | D-09, EMP-03..EMP-05, EMP-07, EMP-08, EMP-10, EMP-13, EMP-15, SEC-02, SEC-03 |
| `crm-ops.ts` | `kunde`, `ansprechpartner`, `lead`, `lead_quelle`, `formular_eingang`, `angebot`, `angebotsposition`, `kalkulation`, `leistungskatalog`, `auftrag`, `auftrag_leistung`, `objekt`, `raum`, `belagsart` | CRM-01..CRM-08, OPS-01..OPS-11, REQ-01..REQ-07, REP-03 |
| `gewerke.ts` | `revier`, `revier_raum`, `turnus`, `sonderleistung`, `leistungsnachweis`, `reklamation`, `qualitaetspruefung`, `posten`, `veranstaltung`, `dienstanweisung`, `da_kenntnisnahme`, `wachbuch_eintrag`, `schluessel`, `schluessel_quittung`, `projekt`, `lv_position`, `aufmass`, `nachtrag`, `behinderung`, `bautagebuch` | CLN-01..CLN-05, SEC-01, SEC-05..SEC-08, BAU-01..BAU-08 |
| `zeit.ts` | `planungsserie`, `einsatz`, `einsatz_zuordnung`, `planungs_konflikt`, `zeiteintrag`, `zeiteintrag_korrektur`, `checkin_token`, `offline_ereignis`, `medien`, `arbeitszeit_verstoss`, `feiertag` (global, tenant-free) | TIM-01..TIM-14, CLN-03, LEG-02, LEG-03 |
| `zeit-intern.ts` | `zeit_intern.arbeitszeit_fenster` — **K-06 only** | TIM-14, LEG-03, D-09 |
| `finanz.ts` | `rechnung`, `rechnungsposition`, `rechnung_versand`, `rechnung_beziehung`, `steuersatz_gruppe` (global), `nummernkreis`, `zahlung`, `mahnung`, `eingangsrechnung`, `beleg`, `ausgabe`, `buchungssatz`, `konto_mapping`, `datev_export` | FIN-01..FIN-18, ACC-01..ACC-12, TEN-02, LEG-01, LEG-05, LEG-06 |
| `radar-ki-inhalt.ts` | `ausschreibung`, `radar_profil`, `bewertung`, `vergabemappe`, `vergabeplattform`, `agent_aufgabe`, `agent_schritt`, `agent_artefakt`, `agent_kosten`, `agent_reservierung`, `agent_preisliste`, `agent_richtlinie`, `agent_budget`, `wissens_chunk`, `freigabe`, `freigabe_kette`, `freigabe_snapshot`, `freigabe_ansicht`, `seite`, `referenz`, `social_post`, `social_channel`, `kanal_statistik`, `formular_definition`, `stelle`, `bewerbung`, `kandidat`, `gespraech` | RAD-01..RAD-09, AGT-01..AGT-07, APR-01..APR-08, SOC-01..SOC-08, REC-01..REC-09, PRO-01..PRO-05, PUB-07 |
| `integration.ts` | `integration_katalog`, `integration_konfiguration`, `integration_status_global`, `integration_aufruf`, `integration_aufruf_system`, `modell_register`, `job_plan`, `restore_protokoll`, `mandant_mail_absender` | SPEC §21, ACC-02, ACC-04, FIN-11, SEC-A10, LEG-09 |

`rechnung_versand` and `rechnung_beziehung` exist because **K-12** forbids anything that changes
after finalisation from living on the invoice row: `versendet_am` and the Storno
back-reference move to child tables so the immutability trigger can stay unconditional. A
column allowlist in that trigger would leave invariant 4 with no database-level guarantee at
all. **K-21 settles the name and the shape**: the back-reference table is
`rechnung_beziehung (id, mandant_id, von_rechnung_id, zu_rechnung_id, art, erstellt_am)` — K-12's
name and columns win over `storno_verweis` — and `02-datenmodell/05-FINANZEN.md` declares it.
There is likewise **no `steuersatz` table**: the VAT catalogue is `steuersatz_gruppe` and every
FK in the platform is `*.steuersatz_gruppe_id`.

**`integration.ts` is a ninth schema file** because `07-INTEGRATIONEN.md` owns nine tables and
none of the other eight files covers that domain: a table whose Drizzle file nobody names is a
table that reaches production through the dashboard, which §16 forbids. It is a *placement*
entry — the columns, constraints and RLS of all nine are declared by `07-INTEGRATIONEN.md`.

**`job_lauf` carries no `mandant_id` (K-21).** It is a platform operations log, not tenant data,
so K-16(d) keeps `audit_log` as the only tenant-adjacent table with a nullable one. Its canonical
shape is `id, job text, gestartet_am, beendet_am, ergebnis enum, kennzahlen jsonb, fehlertext`,
its index is `(job, gestartet_am DESC)`, and the **per-tenant** outcome of one run lives in
`job_lauf_mandant (job_lauf_id, mandant_id, ergebnis, kennzahlen)`. That split is what lets
`_runner.ts` isolate one entity's failure (§10) without inventing a tenant for the run itself.
Both are declared by `02-datenmodell/01-KERN.md`; earlier drafts of four documents wrote four
different column sets for `job_lauf`, which is precisely what K-21 exists to stop.

Five further tables this document references and does not declare, with their K-21 owners:
`mandant_einstellung (id, mandant_id, schluessel, wert jsonb)` with `UNIQUE (mandant_id, schluessel)`
— the home of the O-06 monitoring switches and of the O-30 / O-31 operational windows (§10), and
**not** columns on `mandant`; `nachweis_art`, the certificate-type catalogue behind SEC-02 and the
agent's `pruefe_nachweise`; `sicherheitsvorfall` (SEC-A9); `loeschprotokoll`, the DSGVO deletion
record (LEG-09, REC-07) written by `services/kern/dsgvo.ts` (§6.3) — all four owned by
`02-datenmodell/01-KERN.md` — and `agent_artefakt`, the output every draft-class agent tool
writes, owned by `02-datenmodell/06-RADAR-KI-INHALT.md`.

**`personal.ts` is a seventh schema file, not a sixth.** An earlier version of this table put
`person`, `anstellung`, `nachweis`, `qualifikation`, `bewacher_eintrag` and
`mitarbeiter_zugang` in `kern.ts` and the five personnel-account tables (`abwesenheit`,
`stundenkonto`, `urlaubskonto`, `zeit_einwand`, `antrag`) in `zeit.ts`, and
`02-datenmodell/01-KERN.md` §0 and `04-PLANUNG-ZEIT.md` §0 both departed from it deliberately
and said so. They are right and this document was wrong: those eleven tables are exactly the
ones that hang off `anstellung_id` or `person_id` and therefore exactly the ones K-04's ceiling
registry enumerates (§4.6). Splitting them across `kern.ts` and `zeit.ts` means the
`portal-ceiling.test.ts` list and the schema files it is generated from have no common shape,
and the D-09 person/anstellung boundary — the one this platform is most likely to get wrong —
is spread over three files instead of one. `reklamation` and `qualitaetspruefung` move to
`gewerke.ts` for the same reason: their subject is trade quality, not scheduling.

Tables not named in SPEC §22 but required by a numbered feature — `rolle_berechtigung`,
`mandant_modul` (TEN-08), `benutzer_sitzung` (AUT-08, SEC-A9), `kunde_zugang` (AUT-01 `kunde`,
DSH-03, and the subject of K-04's customer ceiling), `dokument_version` (DOC-05),
`dokument_buendel` (DOC-08), `benachrichtigung_praeferenz` (NOT-02), `buchungssatz` (ACC-01),
`einsatz_zuordnung` (TIM-04), `planungs_konflikt` (TIM-05), `offline_ereignis` (TIM-09),
`zeiteintrag_korrektur` (TIM-11), `arbeitszeit_verstoss` (TIM-14), `feiertag` (CLN-03),
`freigabe*` (APR-01..APR-08, K-13), `ical_token` (CAL-03), `lead_quelle` / `formular_eingang`
(REQ-07, REP-03), `job_lauf` / `job_lauf_mandant` (SPEC §21), `mandant_einstellung` (TEN-08 and
the O-06 / O-30 / O-31 switches), `nachweis_art` (SEC-02), `sicherheitsvorfall` (SEC-A9),
`loeschprotokoll` (LEG-09, REC-07), `sonderleistung` (CLN-05), `veranstaltung` (SEC-08),
`gespraech` (REC-06) — carry a comment in their file naming the feature ID that forced them, and
are listed in `DECISIONS.md` when the schema PR lands.

**`audit_log` is the one tenant-adjacent table with a nullable `mandant_id`, per K-16(d).** A
failed login, a lockout and the *source* side of a mandant switch all precede or transcend
tenancy, and forcing a tenant onto them would mean inventing one. It therefore carries
`ebene enum('plattform','mandant')` with
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`, so a NULL is a stated platform-level
fact and not a missing value, and its RLS reads platform rows only for `super_admin`. It is
classified in `rls.ts` under its own bucket for exactly that reason (§5.1) — the generic
bucket-1 assertion "`mandant_id` is `not null`" would fail on it, and the cheapest way to make
that green is to backfill a tenant onto a failed login.

**`wissens_chunk` is the one table with a composite primary key, per K-16(a).** It is
`PARTITION BY LIST (mandant_id)`, Postgres requires the partition key in the primary key, so its
PK is `(mandant_id, id)` and every FK pointing at it is composite (§9.3, §6.1). No other table
in this document deviates from `id uuid primary key`.

`kanal_statistik` is in SPEC §22 with no feature of its own. It stays, with a single sanctioned
consumer: per-channel publication outcomes for SOC-05/SOC-07 and channel attribution in REP-03.
No other consumer may be added without a feature ID.

### 4.10 `_shared.ts` — where invariants 1, 2 and 3 exist as code (K-16)

One place, so a new table gets them for free and a table that skips them is visible in review.

```ts
// src/server/db/schema/_shared.ts
import { bigint, date, integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Invariant 3 / K-16. Tenant tables only — see §5 for the buckets. */
export const mandantId = () =>
  uuid('mandant_id').notNull().references(() => mandant.id);

/** Invariant 1: money is integer cents. Column names always end in `_cent`. */
export const geldCent        = (name: `${string}_cent`) => bigint(name, { mode: 'bigint' });
export const geldCentNotNull = (name: `${string}_cent`) => geldCent(name).notNull();

/** K-16(b): sub-cent AI cost accounting ONLY. Permitted on the five agent-ledger tables of
 *  §9.4 — agent_schritt, agent_kosten, agent_reservierung, agent_budget, agent_preisliste —
 *  and nowhere else. Converted to cents once, at the budget boundary, half-up. */
export const mikrocent = (name: `${string}_mikrocent`) => bigint(name, { mode: 'bigint' });

/** K-16: quantities are NOT money and must not be cents. m², m²/h, LV-Mengen, Aufmaß results. */
export const menge = (name: string) => numeric(name, { precision: 12, scale: 3 });

/** K-16(c): a COMPUTED TARGET duration may be fractional — revier.sollzeit_minuten from
 *  Σ m² ÷ Leistungswert. A MEASURED duration never is; it is evidence. See below. */
export const zielminuten = (name: `soll${string}_minuten` | `${string}_sollminuten`) =>
  numeric(name, { precision: 8, scale: 2 });

/** K-16: a MEASURED duration — worked time, a MiLoG record, a rest period, a device offset. */
export const istminuten  = (name: `${string}_minuten`) => integer(name);
export const istsekunden = (name: `${string}_sek`)     => integer(name);

/** Invariant 2: instants are TIMESTAMPTZ, stored UTC, rendered Europe/Berlin. */
export const zeitpunkt        = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const zeitpunktNotNull = (name: string) => zeitpunkt(name).notNull();

/** Genuine calendar dates only: geburtsdatum, eintritt, austritt, leistungsdatum. */
export const kalenderdatum = (name: string) => date(name, { mode: 'string' });

/** K-16 common columns. German, because they are part of the record, not of the machinery. */
export const gemeinsam = () => ({
  erstelltAm:  zeitpunktNotNull('erstellt_am').defaultNow(),
  erstelltVon: uuid('erstellt_von').references(() => benutzer.id),
});
export const gemeinsamMutabel = () => ({
  ...gemeinsam(),
  geaendertAm:  zeitpunkt('geaendert_am'),
  geaendertVon: uuid('geaendert_von').references(() => benutzer.id),
});
```

Six things this shape settles, each of which was wrong in an earlier draft:

**Money may be nullable; the helper must allow it.** `ausschreibung.geschaetzter_wert_cent`
(OCDS frequently omits it, RAD-01), `radar_profil` value bounds (RAD-04), an unknown
`stundensatz_intern`, a `mahngebuehr_cent` before a level is reached — all are legitimately
NULL. A not-null-only helper pushes those columns to a raw `bigint()` call, out of the one place
invariant 1 is expressed as code. So `geldCent` is nullable and `geldCentNotNull` is the
explicit variant.

**Quantities get their own type, and the ban is scoped by column role, not by type name.**
`real`, `doublePrecision` and `float` are banned everywhere under `schema/**`, unconditionally.
`numeric` is banned only on columns whose name ends in `_cent`. Physical quantities —
`raum.flaeche_qm` (OPS-02), `belagsart.leistungswert_qm_pro_stunde` and its room-level twin
`revier_raum.leistungswert_qm_pro_stunde` (OPS-03), `lv_position.menge`
(BAU-01), `aufmass.ergebnis` (BAU-02, the `30,87 m²` an auditor must reconcile against the
Rechenansatz) — use `menge()`. Banning every exact and inexact numeric type leaves the
implementer float-by-another-name or an undocumented integer scale, and a type-name ban catches
neither. `tests/invariants/money-is-bigint.test.ts` asserts the pairing: every `_cent` column is
`bigint`, no column anywhere is `float4`/`float8`, and every `numeric` column is declared
through `menge()`.

**`bigint(..., { mode: 'bigint' })` is deliberate.** `mode: 'number'` hands back a JS `number`
and reintroduces float semantics at the ORM boundary — the exact failure invariant 1 exists to
prevent, surfacing two years later in a tax audit.

**`zeitpunktNotNull` exists because the columns that matter most are the ones that must not be
null:** `einsatz.beginn_zeitpunkt` / `ende_zeitpunkt` (TIM-01), `zeiteintrag.beginn_zeitpunkt`
(TIM-08), `rechnung.festgeschrieben_am` at finalisation (FIN-02). Nullability is stated per
column in `02-datenmodell/**`; the helper makes the choice explicit rather than accidental.

**Sub-cent money exists in exactly one domain, and it never leaves it (K-16(b)).** Model token
pricing is genuinely sub-cent, and rounding every step to a cent destroys the budget arithmetic
AGT-05 depends on — a thousand steps at 0,4 cent each round to zero and the cap never fires. So
`*_mikrocent bigint` (10⁻⁶ €) is permitted on the **five agent-ledger tables** enumerated in
§9.4 **and nowhere else**. Conversion to cents happens **once**, at the budget boundary, and
`agent/budget.ts` states the rounding rule (**half-up**) at the conversion site rather than
in a commit message. Nothing invoiced, booked or exported is ever micro-cents: a figure that
reaches `rechnung`, `buchungssatz` or a DATEV export is `bigint` cents, full stop.
`tests/invariants/money-is-bigint.test.ts` asserts the fence in both directions — every
`_mikrocent` column is `bigint` **and** belongs to one of those five tables, and no
`_mikrocent` column exists in `finanz.ts`.

**Target durations may be fractional; measured durations may not (K-16(c)).** The distinction is
target vs. actual and each column states which it is. `revier.sollzeit_minuten` is
`numeric(8,2)`, computed as `Σ m² ÷ Leistungswert`, because rounding each room to a whole minute
accumulates a visible error across a Revier of eighty rooms and the number is a plan, not a
record. `zeiteintrag` durations, the §17 MiLoG record (TIM-13), rest periods (LEG-03) and
`zeitabweichung_sek` (TIM-08) are `integer` and never fractional, because they are **evidence**:
a fractional minute in a MiLoG record is a number nobody measured. `istminuten()` and
`zielminuten()` exist so the choice is made at the column and visible in review.

**Composite tenant FKs (K-16).** Where a child is kept inside its parent's tenant with a
composite foreign key `(mandant_id, parent_id) → parent(mandant_id, id)`, the parent **must**
declare the matching `UNIQUE (mandant_id, id)`. `tests/invariants/komposit-fk.test.ts` walks
every composite FK and fails when the referenced unique index is absent. `wissens_chunk` is the
one table whose primary key is itself composite (K-16(a), §4.9): it is
`PARTITION BY LIST (mandant_id)`, Postgres requires the partition key in the primary key, and
the test treats `PRIMARY KEY (mandant_id, id)` as satisfying the parent obligation.

---

## 5. Table classification — the list the tests read

`tests/invariants/mandant-id-and-rls.test.ts` asserts, **per bucket**, that a table carries the
`mandant_id` nullability, the `ENABLE` **and** `FORCE ROW LEVEL SECURITY` and the exact policy
set its bucket requires; `tests/isolation/matrix.ts` generates its cases from the schema barrel.
Neither can work without knowing which bucket a table is in — and a blanket assertion is not a
safe default here: applied to `arbeitszeit_verstoss` it asserts the opposite of K-06, and
applied to `audit_log` it asserts the opposite of K-16(d). The cheapest way to turn a red
required check green is to add `mandant_id` to `nachweis`, which produces exactly the failure
D-09 spells out:
one valid and one expired copy of the same §34a certificate, and a scheduler that passes its
own check while assigning an unqualified guard (SEC-04, LEG-04).

So the classification is a checked-in list, `src/server/db/rls.ts`, and it is the single source
for the invariant test, the isolation matrix, the generated ceilings (K-04) and the
no-hard-delete trigger list (K-16). A new table that is in no bucket fails the build.

```ts
// src/server/db/rls.ts
export const tabellen = {
  mandant_scoped: [ /* … */ ] as const,   // mandant_id + FORCE RLS + both K-03 policies
  mandant_scoped_lesend: [ /* … */ ] as const,  // K-06: mandant_id + FORCE RLS, but the tenant
                                                //   policy is `for select`. NO cse_app write
                                                //   path exists. Currently: arbeitszeit_verstoss
  plattform_scoped: [ /* … */ ] as const, // K-16(d): nullable mandant_id + `ebene`. Only audit_log
  person_scoped:  [ /* … */ ] as const,   // NO mandant_id — visibility via anstellung
  global:         [ /* … */ ] as const,   // no tenant dimension at all
  scope_person:   [ /* … */ ] as const,   // K-18 t_person policy — the employee portal reads it
  scope_kunde:    [ /* … */ ] as const,   // K-18 t_kunde policy — the customer portal reads it
  job:            [ /* … */ ] as const,   // §4.5 t_job policy `to cse_job` — ONLY for what a job
                                          //   touches outside a withSystemTenant transaction
  ceiling_anstellung: [ /* … */ ] as const,  // K-04 restrictive ceiling, anstellung_id
  ceiling_person:     [ /* … */ ] as const,  // K-04 restrictive ceiling, person_id
  ceiling_kunde:      [ /* … */ ] as const,  // K-04 restrictive ceiling, app.aktuelle_kunden()
  kein_hard_delete:   [ /* … */ ] as const,  // invariant 8 — BEFORE DELETE trigger raises
} as const;
```

A table sits in exactly one of the first five buckets and in any number of the last seven, and
`rls.ts` is where that is checked: the build fails a table in **no** primary bucket, a table in
**two**, and a table in a ceiling list whose primary bucket has no such column. The two-bucket
check is not hypothetical — an earlier draft listed `benutzer_mandant` in bucket 1 and described
its write rules again under bucket 3, and a build check that only catches "no bucket" would have
let both stand.

**The `job` bucket exists because a `GRANT` is not a policy.** An earlier version of this
document had no job bucket, on the reasoning that `withSystemTenant` runs `SET LOCAL ROLE
cse_app` (§4.1) and therefore needs none — which is true *inside* the tenant transaction and
false outside it. `02-datenmodell/02-CRM-OPERATIONS.md` and `06-RADAR-KI-INHALT.md` both
enumerate tables their §8.1 jobs reach as `cse_job`, and under FORCE RLS those reads return zero
rows with no error. The bucket is deliberately narrow: a table belongs in it only when a job
touches it **before or after** any scope exists — the run log, the integration bookkeeping of
`integration.ts`, the staging tables an ingest writes — and `tests/invariants/policy-anzahl.test.ts`
fails a `t_job` policy on a table that `withSystemTenant` already reaches.

### 5.1 Bucket 1 — tenant-scoped

Everything in `crm-ops.ts`, `gewerke.ts`, `finanz.ts`, the tenant part of `personal.ts`
(`anstellung`, `abwesenheit`, `stundenkonto`, `urlaubskonto`, `zeit_einwand`, `antrag`), the
tenant part of `zeit.ts` and the tenant part of `radar-ki-inhalt.ts`, plus `mandant_modul`,
`mandant_einstellung`, `benutzer_mandant`, `kunde_zugang`, `benutzer_sitzung`, `dokument`,
`aufgabe`, `nachricht`, `kalender_eintrag`, `benachrichtigung`, `sicherheitsvorfall`,
`loeschprotokoll`, `job_lauf_mandant`, and the tenant part of `integration.ts`
(`integration_konfiguration`, `integration_aufruf`, `mandant_mail_absender`). Carries
`mandant_id not null`, FORCE RLS and the two K-03 policies, plus whatever K-18, K-04 and `t_job`
policies `rls.ts` declares for it. (TEN-03, AUT-05, SEC-A2)

**Three carve-outs, each in its own bucket, because a blanket assertion would be false.**

**`arbeitszeit_verstoss` → `mandant_scoped_lesend`.** K-06 requires it to have **no INSERT policy
for `cse_app`**: a breach spanning two entities must be recorded in both, and a request scoped to
mandant A cannot write a row in mandant B. A K-03 `for all to cse_app` policy grants INSERT, so
sweeping this table into bucket 1 makes `mandant-id-and-rls.test.ts` assert the exact opposite of
the convention — and the cheapest way to turn that red check green is to add the INSERT path K-06
forbids. Its tenant policy is `for select` only, its group policy is the ordinary K-03 one, and
every write goes through `app.arbzg_befund_schreiben` (§4.8). `db/rls/arbzg-verstoss.sql` holds
it, and the invariant test asserts the **absence** of an INSERT, UPDATE or DELETE policy for
`cse_app` on every table in this bucket.

**`audit_log` → `plattform_scoped`.** Per K-16(d) its `mandant_id` is nullable, with
`ebene enum('plattform','mandant')` and
`CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))`. It is the only tenant-adjacent table
in the platform with a nullable `mandant_id`, and it is nullable because a failed login and the
source side of a mandant switch have no tenant to record. Its policies are the K-03 pair on
`ebene = 'mandant'` rows plus a `super_admin`-only read of `ebene = 'plattform'`. FORCE RLS and
`kein_hard_delete` apply unchanged.

**`benutzer_mandant` is in bucket 1 and only bucket 1.** Its `aal2` write gate (K-15) is a
**restrictive** policy on INSERT/UPDATE/DELETE, which is additive to K-03's two and is declared
in `rls.ts` beside the ceilings (§4.5) — it does not make the table a second, global thing, and
§5.3 no longer lists it.

### 5.2 Bucket 2 — person-scoped (D-09, invariant 9)

`person`, `nachweis`, `qualifikation`, `bewacher_eintrag`, `mitarbeiter_zugang`. These carry
**no `mandant_id`**: a §34a certificate belongs to the human, not to a job. Their policy is
membership-derived, and it lives in `db/rls/person-scope.sql`:

```sql
-- 1. tenant scope: the entity that employs the person may read her certificates
create policy p_person_mandant on nachweis
  for select to cse_app
  using (exists (select 1 from anstellung a
                  where a.person_id = nachweis.person_id
                    and a.mandant_id = app.aktiver_mandant()
                    and app.hat_recht('personal.lesen', a.mandant_id)));

-- 2. group scope (K-03): management, across the readable set
create policy p_person_gruppe on nachweis
  for select to cse_app
  using (app.ist_gruppenansicht()
         and exists (select 1 from anstellung a
                      where a.person_id = nachweis.person_id
                        and a.mandant_id = any (app.sichtbare_mandanten())
                        and app.hat_recht('gruppe.personal.lesen', a.mandant_id)));

-- 3. person scope (K-18): the employee's own certificates, EMP-08
create policy p_person_selbst on nachweis
  for select to cse_app
  using (app.scope() = 'person'
         and nachweis.person_id = app.aktuelle_person()
         and exists (select 1 from anstellung a
                      where a.person_id = nachweis.person_id
                        and a.mandant_id = any (app.sichtbare_mandanten())));

-- 4. writes: only the mandant that recorded the row
create policy p_person_schreiben on nachweis
  for all to cse_app
  using      (erfasst_mandant_id = app.aktiver_mandant()
              and app.hat_recht('personal.schreiben', erfasst_mandant_id))
  with check (erfasst_mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('personal.schreiben', erfasst_mandant_id));
```

**Three things this shape fixes, and one it inherits.** The `hat_recht` argument is now written
**per branch** — `app.aktiver_mandant()` in tenant scope, the matched membership row's
`a.mandant_id` in group scope. An earlier draft folded all branches into one policy and then
passed `hat_recht` a scalar subquery keyed on `a2.mandant_id = app.aktiver_mandant()`; in group
scope `aktiver_mandant()` is NULL (§4.4), the subquery yields NULL, the whole predicate is
false, and **no certificate would have been readable from `portal/gruppe`, `portal/mein` or
`portal/kunde` at all** — an RLS bug that reads as an empty list, which is exactly what an empty
list is supposed to look like. Second, the membership lookup is `EXISTS`, not a scalar subquery:
a person re-employed after `austritt` has two `anstellung` rows in the same mandant, and a
scalar subquery raises *more than one row returned by a subquery* at read time. Third, K-18's
`mandant_id = any (app.sichtbare_mandanten())` conjunct is satisfied here **through
`anstellung`**, because bucket 2 has no `mandant_id` column of its own — that is the whole point
of the bucket (invariant 9: a §34a certificate belongs to the human, not to a job).

What it inherits is K-04's `ceiling_person` restrictive policy, which applies on top of all four
and limits a `mitarbeiter` session to `person_id = app.aktuelle_person()` regardless. The
ceiling says *at most your own rows*; policy 3 says *these rows, in these tenants*; both must
pass (K-18).

Writes are restricted to the mandant that recorded the row (`erfasst_mandant_id`, a reference
column, not a tenancy column), so a second entity can read a certificate it depends on without
being able to edit it. `personal/nachweise/page.tsx` sits under `[mandant]` and reads this
bucket — that is correct, and is why the bucket needs a stated policy rather than silence.

### 5.3 Bucket 3 — global

`mandant`, `rolle`, `berechtigung`, `rolle_berechtigung`, `feiertag`, `nachweis_art`,
`steuersatz_gruppe`, `job_lauf`, and the platform-level part of `integration.ts` (`integration_katalog`,
`integration_status_global`, `integration_aufruf_system`, `modell_register`, `job_plan`,
`restore_protokoll`). No tenant dimension; `SELECT` granted to `cse_app`, writes restricted to
`super_admin` and, for `rolle_berechtigung`, gated on `aal2` by a restrictive write policy
(K-15). `berechtigung` and `rolle_berechtigung` are the physical home of the **K-19** catalogue:
`berechtigung` holds every right key in the platform, `03-AUTH-BERECHTIGUNGEN.md` owns its module
and action vocabularies, and `db/seed/02-rollen-benutzer.ts` seeds it. A key that is bound but
not catalogued binds nothing at all, because `app.hat_recht()` returns false for a key it does
not know — which is why CI extracts every right-key literal from `db/rls/*.sql`, the route
manifest and the services and fails on any key absent from the catalogue, and on any catalogue
key no code uses.

**`job_lauf` is global, not tenant-scoped (K-21).** It carries no `mandant_id` at all — it is a
platform operations log — so it is in bucket 3 and **not** in `plattform_scoped`, which K-16(d)
reserves for the one table with a *nullable* `mandant_id`. Its per-tenant results are rows of
`job_lauf_mandant` in bucket 1 (§4.9). Only `job_lauf` carries a `t_job` policy, and that is the
bucket's whole justification: `_runner.ts` opens the run row **before** it has a scope and closes
it **after** the last entity is finished, both times as `cse_job`. `job_lauf_mandant` is written
inside the per-entity `withSystemTenant` transaction, as `cse_app`, under the ordinary K-03 pair
like any other tenant row.

Two entries an earlier draft got wrong. **`benutzer_mandant` is not here** — it carries
`mandant_id` and lives in bucket 1 (§5.1); its `aal2` write gate is a restrictive policy, not a
change of bucket. And **`belagsart` is not here either**: it was listed as global "where it is a
shared catalogue", and a hedge is precisely what the `rls.ts` build check cannot resolve — a
table is in one bucket or the build fails. It is **tenant-scoped** (bucket 1, in `crm-ops.ts`),
because OPS-03 Leistungswerte are commercial parameters that feed OPS-07 pricing and three
separate GmbHs must be able to hold different ones. The seed writes the same starting set into
each mandant; the values themselves are not ours to choose (**O-17**, `// TODO(client)` in
`db/seed/05-kataloge.ts`), and the catalogue ships empty rather than defaulted.

**`feiertag` is real and it stays.** It is a global, tenant-free reference table —
`unique (bundesland, datum)`, `datum date`, `bundesland char(2)`, `bezeichnung`,
`gesetzlich boolean` — specified in `02-datenmodell/04-PLANUNG-ZEIT.md` §5.1 and consumed by
CLN-03. It is not in tension with §8.5's "holidays are computed, not remembered": the rows are
**generated by `src/lib/datum/feiertage-berlin.ts`** (Gauss/Butcher plus the Berlin fixed list)
and seeded through `db/seed/fixtures/feiertage-berlin.ts`, which imports that module and types
nothing from memory. The table exists so `turnus-generator.ts` can join it in SQL instead of
re-deriving Easter inside a nightly job, and so a public holiday that was skipped is auditable
years later. **One path, named:** `02-datenmodell/04-PLANUNG-ZEIT.md` (which owns `feiertag`),
`02-datenmodell/03-GEWERKE.md` and `07-INTEGRATIONEN.md` all name `src/lib/datum/feiertage-berlin.ts`
as the computation, and this document — which owns placement — adopts it (§8.5), because the
calculation is a pure calendar function with no database and no trade of its own, and a copy
under `services/gewerke/reinigung/` would be a second Easter algorithm nobody diffs.

### 5.4 Outside every bucket — the K-06 internal schema

`zeit_intern.arbeitszeit_fenster` is in **no** `rls.ts` bucket, and that is the classification:
`rls.ts` enumerates what `cse_app` can reach, and this table is exactly the thing `cse_app`
cannot reach. The build check that fails a table in no bucket carries this one name as its
single exclusion, stated in `rls.ts` beside it rather than as a silent gap.

No `cse_app` grant of any kind; reachable only through
`app.arbzg_belastung`. It is excluded from the isolation matrix by name and covered instead by
`tests/isolation/db/arbzg.test.ts`, which asserts both halves: the breach is detected, and zero
fields identifying the other entity's shift come back.

---

## 6. Indexes, deletion, and the boundary with DSGVO erasure

### 6.1 Indexes are part of the schema, not an afterthought

Every RLS predicate silently prepends `mandant_id = …` to every query, which makes `mandant_id`
the mandatory leading column of almost every index. The minimum set is stated here because each
one exists for a named feature; `02-datenmodell/**` owns the rest.

| Index | Serves |
|---|---|
| `einsatz (mandant_id, beginn_zeitpunkt)` | TIM-01, TIM-04 week and month view |
| `ez_person_zeit_idx on einsatz_zuordnung (person_id, beginn_zeitpunkt)` | TIM-05 overlap detection on the assignment's own window |
| `ez_mandant_anstellung_idx on einsatz_zuordnung (mandant_id, anstellung_id, beginn_zeitpunkt)` | TIM-04 per-employee plan inside one entity |
| `fenster_person_idx on zeit_intern.arbeitszeit_fenster (person_id, beginn_utc) WHERE aktiv` — partial | TIM-14, K-06 cross-entity aggregation — the index `app.arbzg_belastung` actually filters on |
| `zeit_intern.arbeitszeit_fenster (quelle_id)` | K-06 supersede rule: the `ist` row deactivates its `plan` row |
| `job_lauf (job, gestartet_am DESC)` | SPEC §21 — the heartbeat's `max(beendet_am) WHERE ergebnis = 'erfolg'` per job |
| `zeiteintrag (anstellung_id, beginn_zeitpunkt)` | EMP-03, TIM-13, LEG-02 |
| `zeiteintrag (mandant_id) WHERE ende_zeitpunkt IS NULL` — partial | DSH-05 „arbeitet gerade", live |
| `nachweis (person_id, gueltig_bis)` | SEC-02, SEC-04 expiry checks and the 60/30/7 watchdog |
| UNIQUE `ausschreibung (quelle, quell_id)` | RAD-03 idempotent re-ingestion |
| UNIQUE `rechnung (nummernkreis_id, nummer) WHERE nummer IS NOT NULL` — partial | **FIN-03, LEG-01.** This is the constraint that makes gaplessness provable: drafts have no number and therefore cannot collide |
| UNIQUE `freigabe_snapshot (mandant_id, kette_nr)` | K-13 serialised approval chain |
| `wissens_chunk (mandant_id, embedding)` — ANN index with the tenant column leading | AGT-06, so the tenant filter is not applied after the top-k cut (§9.3) |
| `lead (mandant_id, sla_faellig_am) WHERE erste_antwort_am IS NULL` — partial | REQ-06 hourly SLA watchdog |
| UNIQUE `benutzer_mandant (benutzer_id, mandant_id)` | K-14, TEN-06 |

**Two of these rows are corrections of what this document said before, and both corrections come
from the table's owner.**

**`einsatz_zuordnung` carries its own `beginn_zeitpunkt` / `ende_zeitpunkt`.** An earlier version
of this section asserted the opposite — that an assignment merely links an `anstellung` to an
`einsatz` and the instants belong to the shift — and prescribed the index
`(anstellung_id, einsatz_id)` on that basis. `02-datenmodell/04-PLANUNG-ZEIT.md` §5.4, which owns
the table, declares both columns `NOT NULL`: the assignment's own window, defaulted from the
shift by trigger, because **a guard may cover 22:00–02:00 of a 22:00–06:00 post**. Without them
a partial assignment cannot be expressed at all and TIM-05 compares the wrong intervals. The two
indexes above are the owner's, by name.

**`zeit_intern.arbeitszeit_fenster` carries `person_id`, and that is the column the aggregation
filters on.** An earlier version of this section asserted that K-06's five-column sketch —
`zuordnung_quelle_id`, `quelle`, `aktiv`, `beginn_utc`, `ende_utc` — was exhaustive and that
`app.arbzg_belastung(p_person, …)` had to resolve person → `anstellung` → `einsatz_zuordnung` →
window inside the definer function. That join path is not merely slower, it is **wrong**: §6.2 of
the owning document projects an `ist` window whose `quelle_id` is a `zeiteintrag.id` with no
`einsatz_zuordnung` behind it at all, so an anstellung → zuordnung join silently under-counts
actual worked time — the exact K-06 failure mode, a check that returns "no conflict" for a day
that has one. `02-datenmodell/04-PLANUNG-ZEIT.md` §5.12 therefore declares `person_id` (FK to
`person.id`, "the query key") alongside `mandant_id`, `anstellung_id`, `quelle_id` and
`pause_minuten`, and its §6.3 body filters `where f.person_id = p_person`. **K-06's column sketch
now names `person_id`** — the convention was amended, so the convention, the owner's DDL and this
section state one column set, and the temporary disagreement in the owner's favour (the one
direction §0 does not normally permit) is closed. K-06 also records what the other two columns are
for: `mandant_id` and `anstellung_id` are stored for provenance and retention and are **never**
returned by the function.
Nothing else about K-06 moves: the window is still one row per assignment with the supersede
rule, still in a schema PostgREST does not expose, still reachable only through
`app.arbzg_belastung`, which still returns durations and boundaries and nothing else.

`wissens_chunk` is `PARTITION BY LIST (mandant_id)` with `PRIMARY KEY (mandant_id, id)`
(K-16(a)), so its ANN index is created per partition; the tenant column leads by construction
rather than by convention (§9.3).

### 6.2 No hard deletes (invariant 8, K-16)

Deletion protection is stated **per table**, not assumed globally. `rls.ts.kein_hard_delete`
enumerates them — every table in `finanz.ts`, every table in `zeit.ts`, `audit_log`,
`freigabe*`, `wachbuch_eintrag`, `schluessel_quittung`, `da_kenntnisnahme`, `dokument` in the
finance and accounting categories — and `db/triggers/no-hard-delete.sql` is generated from that
list: a `BEFORE DELETE` trigger that raises. Those tables carry `archiviert_am` or
`storniert_am` instead; `_shared.ts` provides no generic `geloescht_am`, because a soft-delete
column on a table that must never be deleted is an invitation.

### 6.3 Where erasure and retention meet

Two obligations point in opposite directions and the boundary must be written down, not
discovered:

| Domain | Rule | Mechanism |
|---|---|---|
| Finance, accounting, GoBD archive | 10-year retention, deletion impossible (ACC-06, LEG-01) | `kein_hard_delete` + `gobd-archiv.ts` |
| Time records | §17 MiLoG two-year retention (TIM-13, LEG-02); ArbZG evidence beyond it | `kein_hard_delete`; personal data is **anonymised**, never removed |
| Applicant data | Purged per DSGVO (REC-07, LEG-11) | `jobs/generators/bewerber-purge.ts` really deletes |
| Documents | Retention per category; financial documents cannot be deleted (DOC-07) | `storage/retention.ts` per category |
| Data-subject erasure | Art. 17 DSGVO, restricted where a statutory retention duty exists | `services/kern/dsgvo.ts` — anonymises the person, keeps the costed record |

`services/kern/dsgvo.ts` therefore has two distinct operations and both are audited:
`personAnonymisieren` (replaces identifying fields on `person` and its person-scoped rows,
leaves `anstellung`, `zeiteintrag` and `rechnung` structurally intact) and `bewerberLoeschen`
(a real delete, only in the recruiting domain). Both write **`loeschprotokoll`**, the append-only
deletion record `02-datenmodell/01-KERN.md` owns (K-21): one row per subject and category,
because after a real delete the only remaining evidence that the obligation was met is the
record that it was. The retention periods themselves are **not invented** — see §25.3.

### 6.4 Views and materialized views

REP-01..REP-07, DSH-01, ACC-07, ACC-08 and `services/gruppe/aggregat.ts` are exactly the
aggregation workloads that get built on a view, and a view is where RLS quietly stops applying:
a Postgres view executes with its **owner's** permissions unless it is created
`WITH (security_invoker = true)`, and a **materialized view ignores RLS entirely** — its
contents are computed once by its owner and readable by anyone holding `SELECT`. One BWA
matview (ACC-08) or one revenue rollup (REP-01) built the obvious way exposes three entities'
figures to every role, and `tests/isolation/matrix.ts` would not see it, because it enumerates
tables.

Three rules, and a test that enforces them:

1. **Every view is created `WITH (security_invoker = true)`.** No exceptions.
2. **Materialized views are forbidden for tenant data.** Where one is genuinely needed for
   performance, it carries `mandant_id`, is never granted to `cse_app` directly, and is read
   through a `security_invoker` view whose predicate repeats the K-03 tenant clause.
3. **A view is never the mechanism for column-level confidentiality** — that is K-05's column
   grants (§4.7), for the reasons K-05 states.

`tests/invariants/views-security-invoker.test.ts` enumerates `pg_class.relkind IN ('v','m')`,
not only `'r'`, and fails on a view without `security_invoker` or a matview over a tenant table.

---

## 7. `src/server/queries` — the read facade

There has to be a legal door for reads, or the ESLint zones and the tenancy model contradict
each other: `src/app/**/page.tsx` may not import `@/server/db/**` (L1), `src/components/**` may
not import `@/server/**` at all (L2), and services take a `TenantDb` they cannot obtain
themselves. Without a facade the first Server Component that needs data is written by widening
a lint rule — which is how `withTenant` stops being the only door.

```
src/server/queries/
├─ types.ts                    # DTO conventions: finished values, cents as string, no Date objects
├─ dashboard.ts                # DSH-01..DSH-05 — every KPI returns { wert, label, ziel: Route }
├─ mandant.ts                  # TEN-06, TEN-10 — switcherZaehler, see below
├─ crm.ts · ops.ts · dienstplan.ts · zeit.ts · finanzen.ts · buchhaltung.ts
├─ radar.ts · freigabe.ts · dokumente.ts · social.ts · recruiting.ts · berichte.ts
├─ mein.ts                     # EMP-02..EMP-11, EMP-14, EMP-15 — withPersonScope, portal=mitarbeiter
├─ kunde.ts                    # CRM-06, DSH-03 — withKundeScope, portal=kunde
└─ gruppe.ts                   # TEN-05, FIN-17, REP-01..REP-06 — withGroupScope, portal=intern
```

**The contract.** A query function takes a `SessionContext` (never a `TenantDb`), opens the
appropriate helper itself, calls services or reads through Drizzle, and returns a **finished
DTO**: money already formatted as cents plus a display string, instants already rendered in
`Europe/Berlin`, durations already in minutes. It performs no business calculation of its own —
anything derived comes from a service (L2, invariant 6).

```ts
// src/server/queries/finanzen.ts
import 'server-only';

export async function rechnungenListe(
  ctx: SessionContext, filter: RechnungFilter,
): Promise<RechnungZeileDto[]> {
  return withTenant(ctx, (tx) => rechnungService.listeFuerUebersicht(tx, filter));
}
```

**Import rules (§23):** `src/app/**` and `src/components/features/**` may import
`@/server/queries/**` and nothing else from `@/server`. `@/server/db/**` and
`@/server/services/**` stay forbidden there. The sentence "features may call services" is
withdrawn: a feature component calls a query, or receives props.

**DSH-04 is a type, not a habit.** Every KPI DTO carries `ziel: Route` — a typed route to the
records behind the figure — so "no dead numbers" is enforced by `typedRoutes` at compile time
rather than by review. **DSH-05** is `queries/dashboard.arbeitetGerade`, backed by the partial
index in §6.1.

**TEN-10's switcher counters are a query with a scope and a right, not a component detail.**
"Switcher dropdown with live counters per area" is a **cross-mandant read** — four numbers from
four entities in one dropdown — and a cross-mandant read that nobody names is a cross-mandant
read somebody implements by looping `withTenant` and switching the session, or by widening a
policy. So it is named: `queries/mandant.switcherZaehler(ctx)` runs under `withGroupScope` over
`ctx.sichtbareMandanten`, returns one row per mandant with the counts the dropdown shows, and
requires **`gruppe.bericht.lesen`** in each mandant it reports (K-03) — a user who holds it in
two of four areas sees counters for two and the plain names of the other two, rather than a zero
that reads as "nothing to do". The key is `gruppe.bericht.lesen`, not `gruppe.dashboard.lesen`,
which an earlier version of this section wrote: **there is no module `dashboard`** in
`03-AUTH-BERECHTIGUNGEN.md` §7.4's closed module vocabulary, the dashboard read lives in module
`bericht`, and per **K-19** `app.hat_recht()` returns false for a key the catalogue does not
know — so the earlier spelling would have produced a switcher with four blank counters and no
error anywhere. `mandant-switcher.tsx` (§13) renders the DTO and computes
nothing. `tests/isolation/db/switcher-zaehler.test.ts` asserts that a user with membership in A
only never receives a count for B, and `e2e/portal/switcher.spec.ts` covers the partial-rights
case.

`queries/freigabe.freigabeOeffnen(ctx, id)` is the single exception to "a read does not write":
per **K-13** it writes the `freigabe_ansicht` row that APR-08 measures against. Both
`portal/[mandant]/freigaben/[id]/page.tsx` and `api/freigaben/[id]/route.ts` call it, so there
is one implementation and one server-side clock.

---

## 8. `src/server/services` — pure business logic, no HTTP

Every module here is a plain TypeScript module. It imports Drizzle schema, other services and
`src/server/lib`. It does not import `next/*`, `react`, `fetch` against our own API,
`@/server/integrations/**` (except through an injected port) or `@/server/config/env.ts`. It
receives its `TenantDb`, its `Clock` and its context as arguments. That is what makes the time
and money tests possible at all (L5).

```
src/server/services/
├─ kern/
│  ├─ mandant.ts              listMandanten · getMandant · createMandant · moduleFor   TEN-01, TEN-08
│  ├─ berechtigung.ts         resolvePermissions · can                                 AUT-03, AUT-04
│  ├─ audit.ts                recordAuditEntry · recordSwitch (two mirror rows)        TEN-09, AUT-08, SEC-A9
│  ├─ benutzer.ts             inviteBenutzer · assignRolle (aal2, K-15)                AUT-01
│  ├─ person.ts               createPerson · findPersonByTelefon                       D-09
│  ├─ anstellung.ts           createAnstellung · listAnstellungenForPerson             D-09, EMP-14, K-14
│  ├─ entgelt.ts              readEntgelt → app.entgelt_lesen ONLY                     D-09.6, K-05
│  ├─ nachweis.ts             recordNachweis · isValidAt · expiringWithin               SEC-02, EMP-08
│  ├─ dokument.ts             storeDokument · listByKategorie · bundleForAudit          DOC-01..DOC-08
│  ├─ dsgvo.ts                auskunftExport · personAnonymisieren · bewerberLoeschen ·
│  │                          verarbeitungsverzeichnis                                  LEG-09, LEG-11
│  ├─ benachrichtigung.ts     notify · preferencesFor                                   NOT-01..NOT-03
│  ├─ kalender.ts             listEintraege · icalFeedFor · rotateIcalToken             CAL-01..CAL-03
│  ├─ aufgabe.ts              createAufgabe · complete                                  OPS-11
│  └─ nachricht.ts            send · listThread                                         EMP-11
│
├─ crm/
│  ├─ kunde.ts                createKunde · historyAcrossMandanten                      CRM-01, CRM-06
│  ├─ ansprechpartner.ts      createAnsprechpartner                                     CRM-01
│  ├─ rechtsgrundlage.ts      assertOutboundAllowed                                     CRM-08, LEG-08, D-01
│  ├─ lead.ts                 createLead · assignOwner · advanceStatus                  CRM-02, CRM-05, CRM-07, REQ-05
│  ├─ lead-score/
│  │  ├─ types.ts             interface LeadScoreModell                                 CRM-02
│  │  └─ gewichte.platzhalter.ts   — TODO(client) O-15: scoring weights                 CRM-02
│  ├─ lead-sla/
│  │  ├─ types.ts             interface SlaTabelle · deadlineFor · isOverdue · escalate REQ-06
│  │  └─ fristen.platzhalter.ts    — TODO(client) O-14: SLA duration per area/channel   REQ-05, REQ-06
│  └─ kommunikation.ts        appendNote · appendHistory                                CRM-03, CRM-04
│
├─ ops/
│  ├─ objekt.ts               createObjekt · geocodeFields                              OPS-01
│  ├─ raumbuch.ts             upsertRaum · totalFlaeche                                 OPS-02
│  ├─ raumbuch-import.ts      parseImport · previewImport · commitImport                OPS-04
│  ├─ belagsart.ts            leistungswertFor                                          OPS-03
│  ├─ leistungskatalog.ts     listLeistungen · zeitwertFor                              OPS-06
│  ├─ kalkulation/
│  │  ├─ standardzeit.ts      calculateStandardzeit — Σ m² ÷ Leistungswert × Faktor     OPS-02, OPS-03, OPS-07
│  │  ├─ types.ts             interface Zuschlagsprofil { gemeinkosten, risiko, gewinn } OPS-07
│  │  ├─ zuschlaege.platzhalter.ts  — TODO(client) O-16: overhead, risk, profit         OPS-07
│  │  └─ kosten.ts            calculateKosten(profil, …) — takes the profile, never picks it
│  ├─ angebot.ts              createAngebot · priceAngebot · acceptAngebot              OPS-08, OPS-09
│  └─ auftrag.ts              createAuftrag · fromAngebot · createFromWizard            OPS-05, OPS-09, OPS-10
│
├─ gewerke/
│  ├─ reinigung/
│  │  ├─ revier.ts            createRevier · assignRaeume · sollMinuten — the computed
│  │  │                       target `revier.sollzeit_minuten` is numeric(8,2), K-16(c) CLN-01
│  │  ├─ turnus.ts            expandRRule · nextOccurrences — skips `feiertag` rows,
│  │  │                       which `src/lib/datum/feiertage-berlin.ts` computes (§8.5) CLN-02, CLN-03
│  │  ├─ sonderleistung.ts    Glas · Sonder · Warenräumung as distinct services         CLN-05
│  │  ├─ leistungsnachweis.ts createNachweis · signWithSnapshot                         CLN-04
│  │  └─ reklamation.ts       createReklamation · qualitaetspruefung                    SPEC §22
│  ├─ security/
│  │  ├─ posten.ts            createPosten · requiredQualifikationen                    SEC-01
│  │  ├─ veranstaltung.ts     createVeranstaltung · kurzfristigBesetzen                 SEC-08
│  │  ├─ sachkunde.ts         assertQualifiedAt — hard block at the shift date          SEC-02, SEC-04, LEG-04
│  │  ├─ bewacherregister.ts  recordBewacherId · registrationStatus                     SEC-03
│  │  ├─ wachbuch.ts          appendEintrag                                             SEC-05
│  │  ├─ dienstanweisung.ts   publishVersion · acknowledge                              SEC-06, EMP-09
│  │  └─ schluessel.ts        handOver · returnKey · quittung                           SEC-07
│  └─ bau/
│     ├─ lv.ts                importLv · ozTree                                         BAU-01
│     ├─ rechenansatz.ts      parseRechenansatz · evaluate — formula text preserved     BAU-02
│     ├─ aufmass.ts           createAufmass · countersign                               BAU-02, BAU-03
│     ├─ nachtrag.ts          announce · submit · warnWorkOutsideLv                     BAU-04, BAU-05
│     ├─ behinderung.ts       createBehinderungsanzeige                                 BAU-06
│     └─ bautagebuch.ts       createTagebucheintrag · attachWeather                     BAU-07, BAU-08
│
├─ zeit/                      ← split into lesen/ and schreiben/ so the agent import boundary
│  │                            of 06-AGENTEN §1.2 is expressible as a path (R-11, §23)
│  ├─ dauer.ts                dauerZwischen · splitteNachMonat — the only duration code,
│  │                          pure, no database handle                                  TIM-08, TIM-13, K-11
│  ├─ milog/
│  │  ├─ nachweis.ts          buildRecord · retentionUntil — pure over supplied rows     TIM-13, LEG-02
│  │  ├─ types.ts             interface MindestlohnTabelle                              LEG-02
│  │  └─ saetze.platzhalter.ts   — TODO(client) O-32: sector minimum wage per area and date
│  ├─ stundenkonto/
│  │  ├─ konto.ts             accrue · lockMonth · carryForward — computes; the persisting
│  │  │                       entry point is schreiben/stundenkonto.ts                   EMP-04, EMP-15
│  │  ├─ types.ts             interface ArbeitszeitkontoRegeln                          EMP-04
│  │  └─ regeln.platzhalter.ts   — TODO(client) O-18: target basis, cap, negative balance, expiry
│  ├─ urlaub/
│  │  ├─ konto.ts             balanceFor · usedDays — computes; persists via schreiben/urlaub.ts
│  │  ├─ types.ts             interface UrlaubsanspruchRegeln                            EMP-05
│  │  └─ anspruch.platzhalter.ts — TODO(client) O-18: entitlement, pro-rata, carry-over expiry
│  ├─ lesen/                  every read. The ONLY zeit subtree src/server/agent/** may import
│  │  ├─ dienstplan.ts        weekView · monthView · parallelColumns                    TIM-01, TIM-04
│  │  ├─ konflikt.ts          detectOverlap · detectMissingQualifikation                TIM-05
│  │  └─ zeitkonto.ts         monatsuebersicht · saldo — the read side of EMP-04, EMP-15
│  └─ schreiben/              every write. Importable by NO file under src/server/agent/**
│     ├─ planungsserie.ts     createSerie · overrideOccurrence                          TIM-02
│     ├─ einsatz.ts           createEinsatz · assignPerson · unassign                   TIM-01
│     ├─ checkin-token.ts     issueToken — redemption is app.checkin_verbrauchen (K-09) TIM-07
│     ├─ zeiteintrag.ts       punchOutCorrection · correctWithTrail                     TIM-08, TIM-09, TIM-11
│     ├─ geo.ts               capturePointIfAllowed — gated by the mandant_einstellung
│     │                       key of 04-PLANUNG-ZEIT §1.15, default off (O-06)          LEG-10
│     ├─ medien.ts            attachMedia — EXIF stripped upstream                      TIM-10
│     ├─ stundenkonto.ts      persists what stundenkonto/konto.ts computes              EMP-04, EMP-15
│     ├─ urlaub.ts            persists what urlaub/konto.ts computes                    EMP-05
│     ├─ abwesenheit.ts       report · approve                                          EMP-10
│     ├─ zeit-einwand.ts      raiseEinwand · resolveEinwand — never an edit             EMP-07
│     └─ antrag.ts            requestLeave · requestSwap                                EMP-10
│
├─ frist/                     ← deadline arithmetic in one place: Berlin calendar days,
│  │                            business days and statutory windows, injected Clock      R-12
│  ├─ frist.ts                fristEnde · verbleibendeTage · istUeberfaellig
│  └─ kalendertage.ts         Berlin working days, joins `feiertag` (§8.5)
│
├─ arbzg/                     ← K-06: the ONLY caller of app.arbzg_belastung
│  ├─ belastung.ts            ladeBelastung(person, von, bis) → durations only          TIM-14, LEG-03, D-09
│  ├─ regeln.ts               >8h (§3 ArbZG 10h exception) · <11h rest · break rules     TIM-06, LEG-03
│  │                          — the statutory limits are code; the AUSGLEICHSZEITRAUM the
│  │                            10h exception depends on is not stated: TODO(client) O-18
│  ├─ befund.ts               schreibeBefund → app.arbzg_befund_schreiben               TIM-14
│  └─ pruefung.ts             pruefeZuordnung — called before every assignment           TIM-05, TIM-14
│
├─ finanz/
│  ├─ geld.ts                 Cent type · addCent · applyFactor · sumCent                invariant 1
│  ├─ steuer/
│  │  ├─ satz.ts              vatByTaxGroup — per tax-rate group, never from a gross     FIN-09, LEG-06
│  │  ├─ rundung.ts           rounding mode as an injected named parameter               FIN-09
│  │  ├─ reverse-charge.ts    reverseChargeApplies(kunde, leistung, nachweis)            FIN-09, LEG-06
│  │  └─ nachweis.platzhalter.ts — TODO(client) O-104: §13b evidence (USt-1-TG) and its store
│  ├─ nummernkreis.ts         assignNumberAndChainHead — SELECT … FOR UPDATE            FIN-03, TEN-02, FIN-06
│  ├─ hash-chain.ts           hashChain · verifyChain                                    FIN-06, LEG-01
│  ├─ ustg14.ts               validateForFinalization                                    FIN-04, FIN-05, LEG-05
│  ├─ snapshot.ts             buildKanonischePayload — the K-12 identity snapshot        FIN-06, FIN-11, FIN-12
│  ├─ rechnung.ts             createEntwurf · finalize · storno                          FIN-02, FIN-07, K-12
│  ├─ abrechnungsart/
│  │  ├─ types.ts             interface Abrechnungsart                                   FIN-01
│  │  ├─ registry.ts          — TODO(client) O-04, five labelled proposals               FIN-01
│  │  └─ stundenbasis.platzhalter.ts · monatspauschale.platzhalter.ts ·
│  │     festpreis-los.platzhalter.ts · einheitspreis-aufmass.platzhalter.ts ·
│  │     einzelabruf.platzhalter.ts
│  ├─ abschlag/
│  │  ├─ deduktion.ts         deductPriorAbschlaege · blockIfUnreconciled                FIN-08
│  │  ├─ types.ts             interface AbschlagsBedingungen (per project)               FIN-08
│  │  └─ bedingungen.platzhalter.ts — TODO(client) O-20: VOB/B §16 terms, Sicherheitseinbehalt
│  ├─ estg48/
│  │  ├─ abzug.ts             withholdingFor · certificateValidAtServiceDate             FIN-10, LEG-06
│  │  └─ grenzen.platzhalter.ts — TODO(client) O-21: Bagatellgrenzen, Leistungsempfänger scope
│  ├─ kleinbetrag.ts          appliesToRechnung(betragCent, gueltigAb) — dated parameter FIN-13
│  ├─ xrechnung.ts            buildUbl · leitwegId — from the snapshot                   FIN-11
│  ├─ zugferd.ts              embedInPdfA3 — from the snapshot                           FIN-12
│  ├─ ausgangsbuch.ts         listByNummernkreis                                         FIN-16
│  ├─ zahlung.ts              recordZahlung · matchToRechnung                            FIN-14, ACC-04
│  ├─ mahnung/
│  │  ├─ lauf.ts              nextStufe · buildMahnung · istFaellig(clock, rechnung)     FIN-15
│  │  ├─ types.ts             interface MahnStufen { verzugstageBisStufe1, stufen,
│  │  │                                              gebuehrCent, zinsBasis }            FIN-15
│  │  └─ stufen.platzhalter.ts — TODO(client) O-19: levels, intervals, the delay before
│  │                            level 1, fees, §288 BGB interest basis
│  ├─ eingangsrechnung.ts     createFromProposal — approval required                     FIN-14, ACC-05
│  ├─ ausgabe.ts              recordAusgabe                                              FIN-14
│  └─ pruefung.ts             warnAuftragOhneZeiten                                      FIN-18
│
├─ buchhaltung/
│  ├─ kontenrahmen/
│  │  ├─ types.ts             interface KontenrahmenProfil                               ACC-01
│  │  └─ skr03.platzhalter.ts · skr04.platzhalter.ts   — TODO(client) O-05
│  ├─ buchungssatz.ts         deriveFromRechnung                                         ACC-01
│  ├─ datev-extf.ts           buildExtf (Windows-1252, comma decimal)                    ACC-02
│  ├─ belegverknuepfung.ts    linkDocumentToBookingLine                                  ACC-03
│  ├─ camt053.ts              parseCamt · matchByAmountNumberIban                        ACC-04
│  ├─ offene-posten.ts        debitors · creditors                                       ACC-07
│  ├─ monatszahlen.ts         bwaFor                                                     ACC-08
│  ├─ z3-export.ts            buildZ3                                                    ACC-09
│  ├─ verfahrensdokumentation.ts generateFromLiveConfig                                  ACC-10
│  ├─ jahrespaket.ts          buildYearEndPackage                                        ACC-11
│  ├─ lohn-export.ts          exportZeitenForPayroll                                     ACC-12
│  └─ gobd-archiv.ts          archive · assertNotDeletable                               ACC-06, LEG-01
│
├─ radar/
│  ├─ ausschreibung.ts        upsertByQuellId · setStatus                                RAD-03, RAD-07
│  ├─ radar-profil.ts         profileFor · cpvMatches                                    RAD-04
│  ├─ bewertung/
│  │  ├─ score.ts             scoreDeterministic · reasonText — no LLM                   RAD-05
│  │  ├─ types.ts             interface BewertungsModell { gewichte, schwelle }          RAD-05, RAD-08
│  │  ├─ gewichte.platzhalter.ts — TODO(client) O-15: weights and the RAD-08 threshold
│  │  └─ cpv.platzhalter.ts      — TODO(client) O-98: CPV codes verified against the official list
│  ├─ frist.ts                daysRemaining · isCritical                                 RAD-06
│  ├─ vergabeplattform.ts     registrationStatusFor · flagUnregistered                   RAD-09, O-07
│  └─ vergabemappe.ts         assembleFolder · listGaps                                  D-07
│
├─ inhalt/
│  ├─ seite.ts · referenz.ts · social-post.ts · formular.ts                              PUB-07, PRO-01..PRO-05, SOC-01..SOC-05
│  └─ kanal-statistik.ts      publication outcomes only                                  SOC-05, SOC-07, REP-03
│
├─ recruiting/
│  ├─ bedarf.ts · stelle.ts · bewerbung.ts · kandidat.ts                                 REC-01..REC-04
│  ├─ matching.ts             ranked shortlist with stated reasons — a suggestion        REC-05, REC-08, LEG-12
│  ├─ gespraech.ts            questionPrep · scheduleViaKalender                         REC-06, CAL-01
│  └─ purge/
│     ├─ purge.ts             purgeExpiredApplications                                   REC-07, LEG-11
│     └─ fristen.platzhalter.ts — TODO(client) O-25: applicant retention period (AGG §15(4))
│
├─ storage/
│  └─ retention/
│     ├─ regeln.ts            retentionFor(kategorie, datum)                             DOC-07, ACC-06, LEG-01
│     └─ fristen.platzhalter.ts — TODO(client) O-25: retention per document category
│
├─ berichte/
│  ├─ umsatz.ts · auftraege.ts · attribution.ts · mitarbeiter.ts
│  ├─ projekte.ts · pipeline.ts · export-csv.ts · export-pdf.ts                          REP-01..REP-07
│
└─ gruppe/
   └─ aggregat.ts             groupKpis · groupFinanzen (ScopedReadDb only)              TEN-05, FIN-17
```

### 8.1 Money has exactly one arithmetic site

`services/finanz/geld.ts` is the only module in the repository permitted to do arithmetic on
money. `src/lib/format/geld.ts` renders `1.234,56 €` and cannot import from `src/server`.
Everything between the two is a service. VAT is computed per tax-rate group (invariant 1),
never from a gross total, which is why `steuer/satz.ts` takes tax groups and not an invoice
total.

### 8.2 Finalisation is one transaction, one lock, one chain (FIN-03, FIN-06, K-12)

The invoice number and the hash-chain head are **one mechanism, not two**. Two concurrent
finalisations serialise correctly on the counter row for the *number*, but if the previous hash
is read anywhere else, both can read the same `letzter_hash` before either commits: the chain
forks, `hash-chain-verify` reports a break every busy night, and the real tamper signal is lost
in the noise. Finalisation is one-way (invariant 4), so it has to be right the first time.

```ts
// src/server/services/finanz/rechnung.ts  (contract, not implementation)
export async function finalize(tx: TenantDb, clock: Clock, id: RechnungId): Promise<Rechnung> {
  //  1. ustg14.validateForFinalization  → blocks on any missing §14 field   FIN-04, FIN-05
  //  2. abschlag.blockIfUnreconciled                                        FIN-08
  //  3. SELECT … FOR UPDATE on nummernkreis  → nummer AND letzter_hash      FIN-03, FIN-06
  //  4. snapshot.buildKanonischePayload → identity snapshot                 K-12
  //  5. hash = sha256(payload || letzter_hash)
  //  6. UPDATE rechnung SET nummer, status='festgeschrieben', hash, festgeschrieben_am
  //  7. UPDATE nummernkreis SET letzter_wert, letzter_hash   — same lock, same transaction
}
```

`nummernkreis` therefore carries **both** the counter and `letzter_hash`.
`src/server/services/finanz/rechnung.concurrency.test.ts` is on the may-never-be-skipped list
(§15.3): ten parallel finalisations produce ten consecutive numbers and one unbroken chain.

**The snapshot is the document (K-12).** `snapshot.ts` copies `leistender` (name, address,
Steuernummer/USt-IdNr., HRB, court), `empfaenger` (name, address, USt-IdNr., Leitweg-ID), each
tax line (`satz`, `netto_cent`, `steuer_cent`, `hinweistext`), `abrechnungsart`,
`bauabzugsteuer_cent`, `kleinbetrag` and `leistungszeitraum` **as values**. With only `kunde_id`
and `mandant_id` as references, editing the customer master record later changes what the
invoice, the XRechnung and the PDF say while chain verification still reports `intakt: true`.
`xrechnung.ts`, `zugferd.ts` and `pdf/templates/rechnung.tsx` all read the snapshot.

`db/triggers/immutable-rechnung.sql` is unconditional and has no column allowlist;
`tests/invariants/rechnung-immutability.test.ts` asserts that
`UPDATE rechnung SET versendet_am = … WHERE status = 'festgeschrieben'` raises — which is why
`versendet_am` lives in `rechnung_versand` and the Storno back-reference in
`rechnung_beziehung`.

### 8.3 Time has exactly one duration implementation, and its boundaries are Berlin (K-11)

`services/zeit/dauer.ts` is the only place a duration is computed. Instants are stored UTC
(invariant 2), but a day, a month and a billing period are **Berlin** boundaries converted to
instants — never UTC midnight:

```
splitteNachMonat('2026-01-31T21:00Z', '2026-02-01T05:00Z') → [{2026,1,120}, {2026,2,360}]
```

21:00Z is 22:00 Berlin (CET) and the Berlin month boundary is at 23:00Z; splitting at UTC
midnight misattributes 60 minutes, and in CEST 120. That error propagates into §17 MiLoG
records (TIM-13, LEG-02), Stundenkonto month locking (EMP-04) and the invoice period split
(FIN-07). Every reference test carries **a CET case and a CEST case**, so a UTC implementation
cannot pass by accident.

`splitteNachMonat` keeps the German spelling K-11 gives it. Where 00-KONVENTIONEN names a
function verbatim, that spelling wins over the general naming rule in §21.

### 8.4 `services/arbzg/` is a top-level service, not a file under `zeit/`

K-06 names `src/server/services/arbzg/` as the **only** caller of the cross-entity functions,
so it gets its own folder and its own CODEOWNERS entry. It takes a `person_id`, never an
`anstellung_id` (D-09 consequence 1). It never selects `einsatz` across tenants — that is not a
policy question, because a row-level policy is a row grant and cannot return "only start, end
and a duration". Assignment code calls `arbzg/pruefung.ts`; nothing else in the tree may import
`arbzg/belastung.ts`.

### 8.5 Berlin public holidays are computed, not remembered (CLN-03)

**One module, and it is `src/lib/datum/feiertage-berlin.ts`.** It derives the movable feasts
from Easter (Gauss/Butcher) and combines them with an explicit Berlin-specific fixed list
carrying a source citation in the file header, exporting `berlinFeiertage(jahr, bundesland)` and
`istFeiertag(datum, bundesland)`. Berlin includes Internationaler Frauentag (8 March, since
2019) and excludes Fronleichnam and Reformationstag — a hand-typed list gets exactly this wrong,
and a wrong holiday silently schedules a cleaning round that must not happen or drops one that
must. `src/lib/datum/feiertage-berlin.test.ts` asserts three known years against the published
Berlin calendar.

**Why `src/lib/datum/` and not `services/gewerke/reinigung/`.** An earlier version of this
document put the generator under the cleaning trade and the seed fixture beside it, while
`02-datenmodell/04-PLANUNG-ZEIT.md` (the owner of `feiertag`), `02-datenmodell/03-GEWERKE.md`
and `07-INTEGRATIONEN.md` all named `src/lib/datum/feiertage-berlin.ts`. Two paths for one
Easter algorithm is one algorithm too many, and the calculation is not a cleaning rule: it is a
pure calendar function with no database handle, no clock and no trade, consumed by CLN-03's
holiday skip, by the RRULE expansion in `gewerke/reinigung/turnus.ts`, by the DST expansion in
`turnus-generator.ts` and by the seed. `src/lib/**` is exactly the zone that may not import
`@/server/**` (§23), which is what makes it importable from a service, a job **and** the seed
without an arrow running backwards. So this document adopts the other three documents' path.

**Computed, then stored.** The derived days are written into the global, tenant-free `feiertag`
table (`unique (bundesland, datum)`, §5.3) through `db/seed/fixtures/feiertage-berlin.ts`, which
is a thin adapter over the `lib/datum` module — it computes nothing of its own — so
`turnus-generator.ts` can join them in SQL instead of re-deriving Easter inside a nightly job,
and so a round that was skipped in 2027 is still explainable in 2033. "Computed, not remembered"
governs where the values come from, not whether they are persisted — a hand-typed table is the
failure; a generated one is a cache with a test behind it. The Bundesland is a parameter
defaulting to `'BE'`: CLN-03 says Berlin, and `02-datenmodell/04-PLANUNG-ZEIT.md` anticipates
Brandenburg work by putting `bundesland` on `objekt`.

### 8.6 Placeholders are the deliverable where the rule is not ours to write (L6, K-17)

Nine of the modules above are split into `types.ts` + `*.platzhalter.ts` for one reason: the
value is a legal, tariff or contractual rule the SPEC does not state, and a plausible default
would leave the platform quietly asserting it — on letterhead, in a Schlussrechnung, or in a
wage dispute. The interface is the deliverable; the placeholder file is a labelled proposal.

| Placeholder | What is not ours to choose | Surfaces in |
|---|---|---|
| `finanz/mahnung/stufen.platzhalter.ts` | **how many days overdue starts a dunning run**, number of levels and the interval between them, Mahngebühr per level, §288 BGB interest basis and the €40 Verzugspauschale | a letter that goes to a customer (FIN-15) |
| `crm/lead-sla/fristen.platzhalter.ts` | the SLA duration per area and channel | an hourly escalation watchdog (REQ-05, REQ-06) |
| `zeit/urlaub/anspruch.platzhalter.ts` | BUrlG minimum vs contract vs sector agreement, pro-rata, carry-over expiry | the employee's leave balance (EMP-05) |
| `zeit/stundenkonto/regeln.platzhalter.ts` | target-hours basis, overtime cap, negative balance, expiry | a locked month (EMP-04, EMP-15) |
| `ops/kalkulation/zuschlaege.platzhalter.ts` | Gemeinkostenzuschlag, risk margin, profit markup | every price the agent's `berechne_preis` returns (OPS-07) |
| `radar/bewertung/gewichte.platzhalter.ts`, `cpv.platzhalter.ts`, `crm/lead-score/gewichte.platzhalter.ts` | scoring weights, the RAD-08 threshold, CPV codes | what the group bids on (RAD-05, RAD-08, CRM-02) |
| `storage/retention/fristen.platzhalter.ts`, `recruiting/purge/fristen.platzhalter.ts` | retention per category; applicant retention anchored on the AGG §15(4) window | deleting evidence too early, or a DSGVO finding too late (DOC-07, REC-07, LEG-11) |
| `finanz/estg48/grenzen.platzhalter.ts` | §48 EStG Bagatellgrenzen and who counts as Leistungsempfänger | withholding money that should have been paid, or liability for the unwithheld amount (FIN-10) |
| `finanz/steuer/nachweis.platzhalter.ts` | how §13b status is evidenced (USt-1-TG) and where it is recorded | a reverse-charge invoice inferred from a trade code (FIN-09, LEG-06) |
| `zeit/milog/saetze.platzhalter.ts` | sector minimum wage per area and date | the MiLoG record is produced; the wage check stays inert until supplied (LEG-02) |
| `finanz/abschlag/bedingungen.platzhalter.ts` | VOB/B §16 terms, Sicherheits-/Gewährleistungseinbehalt and its release date | a Schlussrechnung carrying an invented commercial term (FIN-08) |
| `finanz/abrechnungsart/*.platzhalter.ts` | the exact five billing types (O-04) | every invoice (FIN-01) |
| `buchhaltung/kontenrahmen/skr0*.platzhalter.ts` | account mapping and Steuerschlüssel (O-05) | every DATEV export (ACC-01, ACC-02) |

Two nearby rules are **not** placeholders and must not be treated as such:
`finanz/kleinbetrag.ts` implements a threshold FIN-13 does state (€250, §33 UStDV) — but as a
**dated, configurable parameter** with €250 as the seeded default, because the threshold has
moved before (€150 → €250 in 2017) and a rename is a code change. `finanz/steuer/rundung.ts`
takes the rounding mode as a named injected parameter rather than a hard-coded `Math.round`.

---

## 9. `src/server/agent` — four agents, gated tools, no numbers

```
src/server/agent/
├─ orchestrator.ts            plan → tool loop → result; enforces budget + policy at every step.
│                             Constructs the run's SessionContext with akteurTyp = 'agent' and
│                             akteurId = the agent_aufgabe run id (§4.2, SEC-A9)
├─ policy.ts                  the gate: agent_richtlinie, evaluated AFTER policy-invariants  AGT-03
├─ policy-invariants.ts       the non-overridable rules, as code — see §9.2      invariant 7, SPEC §17
├─ budget.ts                  monthly cap → hard stop with notification, never degradation   AGT-05
│                             the ONE micro-cent → cent conversion, half-up, K-16(b) — see §9.4
├─ approval.ts                createApprovalRequest · snapshot · batch · delayedRelease ·
│                             undo · pruefdauer (server-side, K-13)              APR-01..APR-08
├─ autonomy.ts                the SPEC §17 autonomy matrix as data — floor set by policy-invariants
├─ register.ts                the run's number register — see §9.1               K-10
├─ handles.ts                 the handle registry: one entry per declared handle type, each
│                             naming the table it dereferences to. A handle type not here
│                             cannot be minted or resolved — K-10's other half              AGT-02
├─ plan.ts                    derives `vorgang_typ` from the run's goal; the input to the
│                             policy floor's `codeFloor(aktion, vorgang_typ, art)`           AGT-03
├─ umschlag.ts                the model envelope: system, tools, retrieved context, and the
│                             provenance stamp every step carries                            AGT-04
├─ redaktion.ts               redaction of personal data before a payload is logged or sent  LEG-09
├─ wiedergabe.ts              deterministic replay of a recorded run against a fixed clock   AGT-04
├─ logging.ts                 per step: tool, input, output, model, tokens,
│                             `kosten_mikrocent` (K-16(b)), duration                          AGT-04
├─ modell/
│  └─ client.ts               the only caller of integrations/openai/ — injected as a port    D-04
├─ types.ts
├─ agents/
│  ├─ ceo-assistant.ts        queries the live DB; says so when the schema cannot answer      AGT-07
│  ├─ acquisition.ts          radar, Vergabeunterlagen, price sheets, bid folder; sends nothing
│  ├─ backoffice.ts           drafts replies, monthly invoice proposals, dunning proposals, job ads
│  └─ finance.ts              extracts from receipts; proposes bookings; books nothing        ACC-05
├─ tools/
│  ├─ index.ts                ALLOWED BARREL #2 — the registry the orchestrator resolves by name
│  ├─ types.ts                Tool<Input, Output>, Zod on both sides, handles only (K-10)
│  ├─ lies-dokument.ts · extrahiere-lv.ts · suche-bestand.ts
│  ├─ berechne-preis.ts · pruefe-nachweise.ts · pruefe-bilder.ts
│  └─ entwirf-text.ts · sende-email.ts (policy-gated) · erstelle-vorgang.ts                   AGT-02
├─ rag/
│  ├─ chunk.ts · embed.ts · retrieve.ts    pgvector, tenant-scoped — see §9.3                 AGT-06
│  ├─ ausschluss.ts           the exclusion list: which categories never enter the index      LEG-09
│  └─ kanarienvogel.ts        the canary chunk per mandant; a hit is a `sicherheitsvorfall`
│                             row and an aborted run, never a silent one              SEC-A3, SEC-A9
└─ prompts/
   └─ ceo-assistant.ts · acquisition.ts · backoffice.ts · finance.ts   typed builders, no string soup
```

### 9.1 The AI supplies no number, and no input that determines one (K-10)

Invariant 6 is defeated at the entry point if a tool accepts model-authored figures: a model
that writes `netto_cent: '250000'` gets an invented amount back stamped "computed by a tested
service", with a green confidence chip in the approval UI. Proving the *arithmetic* ran in code
proves nothing about where the *inputs* came from.

Every money, quantity or formula argument is either **a handle** — an entity id the service
dereferences to stored rows — or **a token** from a prior result in the same run's number
register (`agent/register.ts`). Never a numeric literal, never an expression string.
`berechne_preis` derives `leistung_ids`, quantities and the Zuschlagsprofil from the contract
and the catalogue; `aufmass` takes an `AufmassHandle` and reads the stored `rechenansatz`;
cleaning standard time derives room ids from `revier`/`turnus`.

**Choosing the surcharge profile is choosing the margin, which is setting a price.** SPEC §17
says the Back-office agent never sets prices, so `zuschlag_profil_id` is never a model
argument. `berechne-preis.ts` is roughly twenty lines: validate the handle with Zod, call
`services/ops/kalkulation/`, return the result with its source references.
`tests/invariants/agent-keine-zahlen.test.ts` asserts that no branch of any tool accepts a
numeric literal or an expression string originating in a tool argument.

### 9.2 The policy gate has a floor that the UI cannot lower

AGT-03 requires `agent_richtlinie` to be editable from the UI without code. ROADMAP Phase 8
requires that **"a €25,000 offer cannot be sent automatically under any configuration."** Both
are satisfied only if the editable data can *tighten* and never *relax*:

```ts
// src/server/agent/policy-invariants.ts — code, not data. No richtlinie row can relax these.
export const UNVERHANDELBAR = [
  { regel: 'angebot.niemals_automatisch',   quelle: 'SPEC §17' },  // any offer, any value
  { regel: 'angebot.ueber_20000_nie_auto',  quelle: 'SPEC §17' },
  { regel: 'rabatt.niemals',                quelle: 'SPEC §17' },
  { regel: 'externer_versand.freigabe',     quelle: 'invariant 7' },
  { regel: 'buchung.freigabe',              quelle: 'invariant 7' },
  { regel: 'veroeffentlichung.freigabe',    quelle: 'SOC-08' },
] as const;
```

`policy.ts` evaluates `agent_richtlinie` first and `policy-invariants.ts` last; the outcome is
the **stricter** of the two. `agenten/richtlinien/page.tsx` renders the invariants as read-only
rows with their source, so an operator can see the floor rather than discovering it.
`src/server/agent/policy.test.ts` is on the may-never-be-skipped list and asserts the €25,000
case **against an `agent_richtlinie` row that explicitly permits automatic sending**.

Nothing leaves the system without human approval (invariant 7): every outbound path —
`sende-email.ts`, social publishing (SOC-08), job-board posting (REC-09), Behinderungsanzeige
dispatch (BAU-06) — is downstream of `policy.ts`, and `approval.ts` chains only
`freigabe_snapshot`, whose `kette_nr` is assigned under `SELECT … FOR UPDATE` on a per-mandant
`freigabe_kette` head row (**K-13**) — the same construction as FIN-03, and for the same
reason: without a serialised total order two concurrent approvers fork the chain and the
nightly verification reports a break every busy day.

### 9.3 RAG is tenant-scoped, and the index proves it (AGT-06, SEC-A3)

AGT-06 indexes contracts, objects, offers and correspondence — the most commercially sensitive
text in three separate GmbHs — into one pgvector table. A similarity search carries no tenant
predicate unless one is written, and the isolation matrix derives its cases from table rows,
not from embeddings, so nothing would notice.

- `wissens_chunk` is a tenant table: `mandant_id`, FORCE RLS, both K-03 policies, listed in
  `db/rls/radar-ki-inhalt.sql`. It is **`PARTITION BY LIST (mandant_id)` with
  `PRIMARY KEY (mandant_id, id)`** — the one composite primary key in the platform, and it is
  K-16(a)'s named case: Postgres requires the partition key in the primary key, so this is
  forced rather than chosen. Every FK pointing at it is composite and the parent declares the
  matching `UNIQUE` (§4.10).
- `retrieve.ts` takes a `TenantDb`; it has no other way to reach the database. It may
  **type**-import that handle from `@/server/db/types.ts` — see the zone note below.
- The ANN index leads with the tenant column — `wissens_chunk (mandant_id, embedding)`, one
  index per partition — so the filter is applied *before* the top-k cut, not after it.
- `jobs/index/wissensindex.ts` reindexes **per mandant**, one `withSystemTenant` transaction
  per entity.
- `tests/isolation/db/rag.test.ts` asserts that a retrieval as a user of A returns no chunk
  of B, including for a query whose nearest neighbours are all in B.

The ESLint zone therefore covers `src/server/agent/{tools,rag}/**`, not only `tools/**`: a tool
or a retriever that needs data calls a service or receives a handle. If a reviewer sees a number
being produced inside `agent/`, that is the defect, regardless of how correct the number looks.

**That zone is value-imports only** (`allowTypeImports: true`, §23). `TenantDb` and
`ScopedReadDb` are exported from `@/server/db/types.ts`, so a file forbidden from importing
`@/server/db/**` at all could not name the type of its own parameter — the rule would forbid
exactly the shape it exists to require, and the first retriever would be written by widening the
zone. A `import type { TenantDb } from '@/server/db/types'` erases at compile time and reaches
no runtime value; `import { db }` from the same tree still fails.

### 9.4 Agent cost is the one place sub-cent money is allowed (K-16(b), AGT-05)

Model token pricing is genuinely sub-cent. Rounding each step to a cent destroys the arithmetic
the monthly cap depends on: a thousand steps at 0,4 cent each round to zero, the counter never
moves, and the hard stop AGT-05 promises never fires. So micro-cents are `bigint` (10⁻⁶ €),
declared through `_shared.mikrocent()` (§4.10), and they exist on **exactly these five tables and
nowhere else in the schema** — the list is `02-datenmodell/06-RADAR-KI-INHALT.md`'s, which owns
every one of them:

| Table | Micro-cent columns |
|---|---|
| `agent_schritt` | `kosten_mikrocent` |
| `agent_kosten` | `kosten_mikrocent` |
| `agent_reservierung` | `betrag_mikrocent` |
| `agent_budget` | `verbrauch_mikrocent`, `reserviert_mikrocent` |
| `agent_preisliste` | `preis_eingabe_je_mio_token_mikrocent`, `preis_ausgabe_je_mio_token_mikrocent`, `preis_gedanken_je_mio_token_mikrocent` |

An earlier version of this section named two tables and wrote the budget's carry columns as
`verbraucht_mikrocent` / `uebertrag_mikrocent`. Neither name exists: the owner declares
`verbrauch_mikrocent` and `reserviert_mikrocent`, and `reserviert_mikrocent` is load-bearing —
AGT-05's reservation protocol compares
`verbrauch_mikrocent + reserviert_mikrocent + neu_mikrocent > budget_cent * 10000` before a step
runs, and an `uebertrag` column cannot serve that. The cap column is **`budget_cent`**, not
`monatslimit_cent`, and **there is no stored `verbrauch_cent`**: the cents figure the Agent
Center shows is *computed* at the boundary below (**K-21**). Had the narrower list survived, the
`_shared.mikrocent()` build check would have rejected `agent_kosten`, `agent_reservierung` and
`agent_preisliste` outright.

`budget.ts` performs the conversion to cents **once**, at the budget boundary, **half-up**, and
the rounding rule is stated at the conversion site in the code — not inferred from a helper
name. Everything downstream of that boundary — the figure the Agent Center shows, anything that
could ever reach `rechnung`, `buchungssatz` or a DATEV export — is `bigint` cents.
`tests/invariants/money-is-bigint.test.ts` fails on a `_mikrocent` column outside those five
tables, and `agent/budget.test.ts` asserts that a thousand 0,4-cent steps trip a €0,01-granular
cap at the right step rather than never.

---

## 10. `src/server/jobs` — watchdogs, generators, ingest

Plain scheduled jobs. **No LLM in any watchdog** (SPEC §14). Each exports a `JobDefinition`
with a name, a schedule, a mandant scope, the **rights its system principal needs** — permission
strings in `<modul>.<aktion>` form, checked by the same `hat_recht` conjunct as any request
(K-03) — plus the narrow `cse_job` grants for the parts that run outside a tenant transaction
(K-01, §4.1), and a handler taking an injected `Clock`, so every job is unit-testable without
waiting for a Tuesday. Stating rights rather than table grants is what makes the job's blast
radius reviewable: `grants: ['GRANT INSERT ON rechnung']` says nothing about *which* rechnung.

```
src/server/jobs/
├─ _registry.ts               ALLOWED BARREL #3 — name → definition; api/cron/[job] dispatches here
├─ _runner.ts                 iterates systemCtx.sichtbareMandanten (§4.3), one withSystemTenant
│                             per mandant, failure isolation; writes one job_lauf row per run and
│                             one job_lauf_mandant row per entity, akteurTyp='system' (K-21)
├─ types.ts                   JobDefinition { name, schedule, scope, rechte, grants, handler }
├─ watchdogs/
│  ├─ ausschreibung-frist.ts          daily      deadline < 5 days, untouched → notify owner   RAD-06
│  ├─ ausschreibung-score.ts          on ingest  score ≥ threshold → notify (threshold: O-open) RAD-08
│  ├─ lead-sla.ts                     hourly     lead past SLA, no reply → escalate            REQ-06
│  ├─ einsatz-ohne-zeiteintrag.ts     hourly     shift ended, no zeiteintrag → notify planner  TIM-12
│  ├─ morgen-unbesetzt.ts             daily 18:00  tomorrow's shift unstaffed → urgent alert
│  ├─ nachweis-ablauf.ts              daily      certificate expiring → escalating notice
│  │                                             cadence from einstellung, TODO(client) O-31   SEC-02
│  ├─ rechnung-ueberfaellig.ts        daily      overdue by mahnung/stufen.platzhalter's
│  │                                             verzugstageBisStufe1 → propose dunning (O-19) FIN-15
│  ├─ nachtrag-nicht-eingereicht.ts   daily      announced, not submitted after the configured
│  │                                             window, TODO(client) O-30                     BAU-04
│  ├─ hash-chain-verify.ts            nightly    chain broken → page immediately               FIN-06, LEG-01
│  ├─ freigabe-kette-verify.ts        nightly    approval chain broken → page immediately      K-13
│  └─ job-ausfall.ts                  hourly     a job that did not run or failed → page       SPEC §21
├─ generators/
│  ├─ dienstplan-generator.ts         nightly    fills eight weeks ahead                       TIM-03
│  ├─ turnus-generator.ts             nightly    RRULE expansion, Berlin holidays excluded     CLN-02, CLN-03
│  ├─ monatsrechnung-vorschlag.ts     monthly    proposal only — never finalizes               FIN-01, APR-02
│  ├─ stundenkonto-monatslauf.ts      monthly    locks the month; corrections go to the next   EMP-04
│  ├─ bewerber-purge.ts               daily      DSGVO retention purge (real delete)           REC-07, LEG-11
│  └─ dokument-retention.ts           daily      retention per category; finance never deleted DOC-07, LEG-01
├─ ingest/
│  ├─ radar-oeffentlichevergabe.ts    daily      OCDS, idempotent by quell_id, raw retained    RAD-01, RAD-03
│  ├─ radar-ted.ts                    daily      TED Search API v3                             RAD-02
│  ├─ dwd-wetter.ts                   daily      attaches weather to Bautagebuch               BAU-08
│  └─ mailbox-bewerbungen.ts          hourly     monitored application mailbox                 REC-03
└─ index/
   └─ wissensindex.ts                 nightly    pgvector reindex, per mandant                 AGT-06
```

**A watchdog threshold is a business rule wearing a cron schedule (L6, K-17).** Three of the
rows above once carried a number this document had no source for, and each of the three decides
when something leaves the building or when somebody is told they are about to be unqualified:

| Threshold | What SPEC actually says | Where it now lives |
|---|---|---|
| when an overdue invoice starts a dunning run | FIN-15 says only "Dunning with escalation levels, fees, interest" | `services/finanz/mahnung/stufen.platzhalter.ts` as `verzugstageBisStufe1` — the same contractual question as the levels and the fees (**O-19**, §25.3) |
| how long an announced Nachtrag may sit unsubmitted | BAU-04 says only that `angemeldet_am` is separate from `eingereicht_am` | a `mandant_einstellung` key with a labelled default and `// TODO(client)` (**O-30**) |
| the certificate-expiry warning cadence | SEC-02 says only "tracked per person with expiry" | a `mandant_einstellung` key with a labelled default and `// TODO(client)` (**O-31**) |

The distinction being drawn is not "legal versus not". It is that a job which composes a letter
to a customer, or which decides that a §34a warning is early enough to act on, is exercising the
client's commercial and operational judgement, and a number invented here is that judgement made
silently. The two `mandant_einstellung`-backed windows are explicitly **operational defaults the client
owns** rather than legal values — they ship configurable, visible in `einstellungen/mandant`,
and `lint:todo` keeps their questions alive until answered.

**Monitoring has a home (SPEC §21).** `_runner.ts` writes **one `job_lauf` row per run** — `job`,
`gestartet_am`, `beendet_am`, `ergebnis`, `kennzahlen`, `fehlertext` — and **one
`job_lauf_mandant` row per entity** the run touched, carrying that entity's `ergebnis` and
`kennzahlen`. That is K-21's split and it is not bookkeeping pedantry: `job_lauf` has no
`mandant_id` because a run is a platform fact that begins before any tenant transaction opens,
and forcing one onto it would either invent a tenant or make it the second table with a nullable
`mandant_id`, which K-16(d) reserves for `audit_log` alone. Failure isolation reads out of
`job_lauf_mandant`: three entities succeeded, one failed, and the run as a whole is
`teilweise`. `einstellungen/protokoll` renders both and `watchdogs/job-ausfall.ts` reads
`max(beendet_am) WHERE ergebnis = 'erfolg'` per `job` off the index in §6.1. A failed nightly
`hash-chain-verify` that nobody is paged
about is indistinguishable from a passing one, so alerting is an integration
(`integrations/monitoring/`, §11) and not a `console.error`.

---

## 11. `src/server/integrations` and `src/server/platform`

### 11.1 Two folders, because "not connected" is meaningless for infrastructure

`integrations/` holds **external systems that can be absent**. `platform/` holds the managed
infrastructure the application cannot run without. Supabase Storage is not an integration with
a not-connected state; if it is absent, nothing works.

```
src/server/platform/
├─ storage/
│  ├─ buckets.ts              private only — no public bucket exists                DOC-03
│  ├─ signed-url.ts           SEC-A6, 15-minute expiry                              DOC-03
│  ├─ mime.ts                 DOC-06 magic-byte sniff, never trust Content-Type
│  └─ exif.ts                 DOC-06, TIM-10
└─ auth/                      Supabase Auth client wrapper (server-side only)       AUT-02
```

### 11.2 Every integration has the same four files

There is no fifth shape and no integration without a `nicht-verbunden.ts`.

```
<system>/
  types.ts            the port interface — the deliverable
  index.ts            factory: reads config, returns the real client or the not-connected one
  nicht-verbunden.ts  returns the typed not-connected IntegrationResult — see below
  <vendor>.ts         the real adapter, added when credentials exist
```

```
src/server/integrations/
├─ registry.ts               single source of connection status for the UI badge
├─ errors.ts                 NotConnectedError — thrown by index.ts only, never across a port
├─ openai/                   EU processing + zero retention where offered      D-04, invariant 6
├─ mail/
│  ├─ versand/               transactional send — always downstream of agent/policy.ts  NOT-01
│  └─ postfach/              the monitored application mailbox                 REC-03
├─ sms/                      worker login codes — see §11.3                    EMP-01
├─ monitoring/               uptime, error tracking, failed-job alerting       SPEC §21
├─ kernel/                   the shared adapter kernel: retry, timeout, `integration_aufruf`
│                            logging, the not-connected short-circuit          SPEC §21
├─ e-rechnung/               XRechnung / ZUGFeRD delivery and validation ports  FIN-11, FIN-12
├─ lv/                       GAEB / X31 Leistungsverzeichnis import            BAU-01
├─ feiertage/                an optional external holiday source; the computation
│                            stays in src/lib/datum/feiertage-berlin.ts (§8.5) CLN-03
├─ geo/                      geocoding for `objekt` addresses                  OPS-01
├─ steuer/                   USt-IdNr. (VIES) confirmation                     FIN-09, LEG-06
├─ backup/                   the SEC-A10 tested-restore driver                 SEC-A10
├─ n8n/                      external glue only — never a business rule        SPEC §14
├─ vergabe/
│  ├─ oeffentlichevergabe/   OCDS open data                                    RAD-01
│  └─ ted/                   TED Search API v3                                 RAD-02
├─ dwd/                      open weather data                                 BAU-08
├─ datev/                    transmission adapter — NOT CONNECTED (O-05)       ACC-02
├─ banking/                  CAMT.053 file import; no bank API assumed         ACC-04
├─ bewacherregister/         no public API — manual entry, status recorded     SEC-03
├─ payroll/                  time export handoff — NOT CONNECTED               ACC-12
├─ social/
│  ├─ types.ts               interface SocialChannel                           SOC-06
│  └─ instagram/ · facebook/ · linkedin/ · tiktok/ · youtube/  all NOT CONNECTED  SOC-07, O-10
└─ jobboards/
   └─ types.ts + one folder per board, all NOT CONNECTED                       REC-09, O-10
```

The folder list is `07-INTEGRATIONEN.md`'s §5 port register, one folder per port, because every
port there has a declared not-connected state and therefore needs the four files above. An
earlier version of this section carried nine of them and named the mail adapter `email/`; the
mailer and the mailbox are two ports with two failure modes (a send that cannot leave, an ingest
that cannot poll), so they are `mail/versand/` and `mail/postfach/`. The folder name stays
**English** — `src/server/integrations/`, not `integrationen/` — per CLAUDE.md's
infrastructure-stays-English rule, and the ESLint zones of §23 are written against that spelling
and would silently not match the German one.

**A not-connected port returns; it does not throw.** This is `07-INTEGRATIONEN.md` §1.1's
contract and this document adopts it verbatim: every port method returns a typed
`IntegrationResult` — `{ ok: true, … }` or `{ ok: false, grund: 'nicht_verbunden', … }` — and
**nothing throws across a port boundary**. An earlier version of this section said
`nicht-verbunden.ts` "throws NotConnectedError", which puts a control-flow exception on the
expected path of a configuration the platform ships in: every caller then needs a `try`, and the
first caller that forgets one turns a documented empty state into a 500. `NotConnectedError`
still exists in `errors.ts`, and `index.ts` is the only thing that throws it — when a *live*
adapter's configuration fails to parse, which is a deployment fault and not a state.

The UI reads `registry.ts` and renders the exact string **„Nicht verbunden"** with the reason.
A not-connected integration never throws a generic error into a user's face and never returns a
plausible fake success (SOC-07, and the DATEV rule in SPEC §12). The HTTP surface of that state —
which status code and which error key a route returns when a port reports `nicht_verbunden` — is
not this document's to fix: `03-AUTH-BERECHTIGUNGEN.md` owns the error-code table and
`05-API-KARTE.md` the per-route mapping, and the two must publish **one** pair rather than the
409 and the 503 they publish today. That is not a client question and therefore not a K-17
placeholder; §26 carries it as a cross-document obligation on those two documents instead.

Two things that are **not** integrations: the EXTF file writer is pure code in
`services/buchhaltung/datev-extf.ts`, testable against a golden file today — only the
*transmission* is not connected. KoSIT XRechnung validation is a **CI concern** and lives in
`tests/compliance/xrechnung/`, not in `integrations/`; there is no production code path that
depends on a validator being reachable.

### 11.3 The SMS fallback, stated rather than discovered (EMP-01)

If SMS is not connected, EMP-01 — phone number plus SMS code, no password — means **no worker
can log in at all**. That is a not-connected adapter blocking a whole portal rather than
degrading one feature, so the path is written down:

- **Production:** worker login is shown as unavailable with the „Nicht verbunden" reason, and
  the planner-issued check-in link (TIM-07) keeps working, because it is tokenised and needs no
  login. Time recording therefore never depends on an SMS provider.
- **Development and staging only:** the code is written to `audit_log` and displayed for seeded
  demo users. `config/env.ts` refuses to enable this in production. No provider is chosen here
  — see §25.3.

### 11.4 Every processor of personal data is recorded before its adapter merges

LEG-09 requires a processing register and DPAs; D-04 records Supabase, Vercel and OpenAI only.
`integrations/sms/` transmits employee phone numbers (EMP-01) and the OCR path behind ACC-05
transmits supplier invoices — both are new sub-processors.

**Rule:** a folder under `src/server/integrations/` that receives personal data requires a
`DECISIONS.md` entry naming the processor, its region and its DPA **before** its real adapter
is merged. `nicht-verbunden.ts` needs no entry; `<vendor>.ts` does.
`scripts/todo-inventar.ts` lists every integration folder with a `<vendor>.ts` and no
`DECISIONS.md` mention, and `ci.yml` fails on a mismatch.

---

## 12. The rest of `src/server`

```
src/server/
├─ auth/
│  ├─ session.ts              Supabase session → SessionContext { benutzerId, personId,
│  │                          mandantId, sichtbareMandanten, rolle, portal, aal, akteurTyp,
│  │                          akteurId, ip } — built from app.sitzung_aufloesen (§12.1)
│  ├─ authorize.ts            AUT-04, SEC-A1 — every route and action calls this
│  ├─ permissions.ts          AUT-03 role × mandant × modul, from `berechtigung`
│  ├─ guards.ts               requireMandant · requireRolle · requireGruppeLesend · requireAal2 (K-15)
│  ├─ switch-mandant.ts       TEN-06, TEN-09 — the ONLY writer of the active mandant, see §12.2
│  ├─ two-factor.ts           AUT-02, K-15
│  ├─ worker-session.ts       EMP-01 phone + SMS code, portal='mitarbeiter', scope='person' (K-18)
│  └─ customer-session.ts     AUT-01 `kunde`, portal='kunde', scope='kunde' (K-18); the subject
│                             is resolved by app.aktuelle_kunden() from kunde_zugang, never a GUC
├─ http/
│  ├─ handler.ts              the L1 wrapper for api/ routes
│  ├─ action.ts               the L1 wrapper for Server Actions
│  ├─ errors.ts               AppError hierarchy → status mapping (AUT-06)
│  ├─ rate-limit.ts           AUT-07 — backed by app.versuch_protokollieren (K-08)
│  └─ cron-auth.ts            shared-secret verification for api/cron/[job]
├─ pdf/
│  ├─ renderer.ts
│  ├─ theme.ts                DESIGN §11 print theme — white page, #111 text
│  └─ templates/
│     ├─ rechnung.tsx         per-entity logo, address, tax number, bank, HRB footer — from the K-12 snapshot
│     ├─ angebot.tsx          OPS-08
│     ├─ monatsnachweis.tsx   EMP-06
│     ├─ leistungsnachweis.tsx  CLN-04, incl. the signature snapshot
│     ├─ behinderungsanzeige.tsx  BAU-06
│     └─ bautagebuch.tsx      BAU-07
├─ config/
│  └─ env.ts                  Zod-validated, server-only, throws at boot on a missing key
└─ lib/
   ├─ clock.ts                Clock interface — injected; services never call new Date()
   ├─ ids.ts                  uuid v7 generation
   ├─ crypto.ts               sha256 primitive used by hashChain
   └─ logger.ts               correlation id, structured, no personal data in messages
```

**`env.ts` is in `config/`, not `lib/`.** L5 forbids services from reading `process.env`, and
services legitimately import `src/server/lib/*` — so an `env.ts` inside `lib/` makes the rule
unenforceable. `@/server/config/**` is on the forbidden list for `services/**` (§23), and
configuration reaches a service as an injected argument.

### 12.1 `SessionContext` is built once, server-side

`auth/session.ts` is the only producer. It resolves the authenticated `benutzer`, the `person`
behind the login, the active membership (K-14: additive, `aus_anstellung` distinguishes derived
from granted), the derived `portal` per K-04, the assurance level, the actor type, the actor id
and the IP. `sichtbareMandanten` is derived from `benutzer_mandant`, never from the request.
Nothing else constructs one; `tests/invariants/session-context.test.ts` asserts a single
construction site.

**How it reads `benutzer_mandant` before a scope exists — the chicken-and-egg, resolved.**
`benutzer_mandant` is a bucket-1 tenant table (§5.1): its tenant policy needs
`app.aktiver_mandant()` and its group policy needs `app.ist_gruppenansicht()`. At the moment
`session.ts` runs, neither is set — there is no active mandant *because* the memberships have
not been read yet. A plain `SELECT` there returns zero rows, `withGroupScope` then throws
`KeineSichtbarenMandantenError` for **every** user, and the platform is blank for everyone. This
is not a hypothetical: it is what the first draft of this section specified.

The resolution is the K-08 register entry that already exists for exactly this moment.
**`app.sitzung_aufloesen(token_hash)` returns the whole session identity in one call** — the
`benutzer`, the `person` behind the login, the active membership with its role, and the readable
mandant set with the derived `portal` — as `SECURITY DEFINER` owned by `cse_definer`, which is
why K-01 exempts that role from FORCE RLS on the tables K-08's functions touch. No new register
entry is created (the register is closed, K-08); no self-scoped policy is bolted onto
`benutzer_mandant`, which would have meant amending K-03's two-policy rule for one table. The
function is the pre-session data path, and membership resolution is the definitive pre-session
read.

Two consequences. `session.ts` issues **no bare `SELECT` against `benutzer_mandant`** — the
route-manifest test (§15) treats one as a failure. And `SessionContext.sichtbareMandanten` is
populated in *every* scope including `mandant`, because it is application state used for routing
and switching; the **GUC** `app.mandant_ids` is set only in the three multi-tenant scopes (§4.2),
which is what keeps the tenant policy honest.

### 12.2 `switchMandant` — the one function that sets the tenant (TEN-06, TEN-09)

The `[mandant]` URL segment is powerless (§3.3), which puts the entire tenancy model on this
one door. A Server Action is a public HTTP endpoint, so the order is fixed and tested:

```ts
// src/server/auth/switch-mandant.ts
export async function switchMandant(zielSlug: string): Promise<never> {
  // 1. resolve slug → mandant (404 if unknown — never 403, AUT-06)
  // 2. assert ziel.id ∈ ctx.sichtbareMandanten                        ← the authorization
  //    that set was resolved by app.sitzung_aufloesen (§12.1) and is re-derived, never
  //    read back through a policy keyed on the mandant we are leaving;
  //    absent → notFound(); a non-member must not learn the entity exists
  // 3. derive portal from the TARGET membership's role (K-04)
  // 4. write the session (server-side store only)
  // 5. audit.recordSwitch — TWO mirror rows via app.audit_schreiben: one keyed to the old
  //    mandant_id, one to the new, both with aktion = 'sitzung.mandant_gewechselt' and the
  //    pair carried inside vorher / nachher (TEN-09) — audit_log declares no
  //    mandant_id_alt / mandant_id_neu columns; 01-KERN §6.11 owns that column list
  // 6. redirect('/portal/<slug>')
}
```

Step 2 reads the *session's* membership set rather than the database's, and that is deliberate.
At the moment of a switch the session is scoped to the mandant being left, so a `SELECT` on
`benutzer_mandant` under the K-03 tenant policy can only ever see rows for that mandant — the
target row is invisible by construction, and the assertion would fail for every legitimate
switch. The set was resolved once, server-side, by `app.sitzung_aufloesen` (§12.1); step 2 tests
against it and step 4 re-resolves it for the new session.

Step 5 exists because a switch by definition spans two entities: a single row keyed on one
`mandant_id` is invisible to the other entity's audit view, and TEN-09 promises *every* switch
is recorded. `tests/isolation/http/switch.spec.ts` asserts that a user of A calling
`switchMandant` for B receives 404, that the session is unchanged, and that both audit rows
exist for a legitimate switch.

### 12.3 `benutzer_mandant` is additive (K-14)

A `leitung` of CSE Dienstleistungen is normally also *employed* by CSE Dienstleistungen. The
trigger that maintains memberships from `anstellung` inserts only when absent and removes only
rows it owns — `benutzer_mandant.aus_anstellung boolean not null default false`. Ending an
employment never strips a manually granted role. `tests/invariants/mitgliedschaft-additiv.test.ts`
asserts that a person with `leitung` in A plus an `anstellung` in A keeps `leitung` after the
trigger runs **and** after `austritt`.

---

## 13. `src/components`

```
src/components/
├─ ui/                       # DESIGN §5 primitives ONLY. Nothing domain-aware lives here.
│  ├─ button.tsx             #   DESIGN §5 buttons — one primary per view
│  ├─ card.tsx · kpi-stat.tsx
│  ├─ status-pill.tsx        #   fixed vocabulary — not a free-text prop (DESIGN §5)
│  ├─ filter-pill.tsx
│  ├─ table.tsx              #   tabular-nums, right-aligned numbers, stacked cards < 768px
│  ├─ form-field.tsx         #   label always above, aria-describedby error (DESIGN §5, PUB-09)
│  ├─ input.tsx · textarea.tsx · select.tsx · checkbox.tsx · radio.tsx · label.tsx
│  ├─ dialog.tsx · sheet.tsx · dropdown-menu.tsx · tooltip.tsx · tabs.tsx · toast.tsx
│  ├─ avatar.tsx · badge.tsx · skeleton.tsx · pagination.tsx · empty-state.tsx
│  ├─ money.tsx              #   renders Cent as 1.234,56 € — formats, never computes
│  └─ date-time.tsx          #   renders a UTC instant in Europe/Berlin
├─ public/
│  ├─ script-accent.tsx      # DESIGN §2 — Caveat, ~-6°, at most once per page. See below.
│  ├─ brand-card.tsx         # PUB-03, DESIGN §4 composition
│  └─ brand-avatar-row.tsx   # PUB-14
├─ layout/
│  ├─ app-shell.tsx · portal-sidebar.tsx · bottom-tab-bar.tsx
│  ├─ hue-bar.tsx            # TEN-07 · 3px identity bar, neutral in group view (§3.8)
│  ├─ public-header.tsx · public-footer.tsx · page-header.tsx
├─ mandant/
│  ├─ mandant-switcher.tsx   # DESIGN §6 · TEN-06, TEN-10 · ⌘K · rendered only when > 1 area
│  ├─ mandant-avatar.tsx     # 32px circle, 2px identity ring
│  ├─ area-badge.tsx         # hue + NAME — colour is never the only signal (DESIGN §9)
│  └─ nur-lesen-pill.tsx     # TEN-05, TEN-10
├─ seo/
│  ├─ json-ld.tsx            # PUB-11
│  └─ placeholder-image.tsx  # D-10 · visibly marked outside production (O-13)
├─ charts/
│  ├─ chart-theme.ts         # identity hues first, then the extended sequence (§24)
│  └─ bar.tsx · line.tsx · donut.tsx
└─ features/                 # domain components — async Server Components allowed
   ├─ dashboard/ · crm/ · raumbuch/ · angebot/ · dienstplan/ · zeit/ · checkin/
   ├─ reinigung/ · security/ · bau/ · finanz/ · buchhaltung/ · radar/ · agent/
   └─ freigabe/ · dokument/ · social/ · recruiting/ · bericht/ · mitarbeiter/ · kunde/
```

The split is not stylistic. `ui/` is the vocabulary of DESIGN.md: a component there knows about
tokens and accessibility and nothing about the business. `features/` knows the domain, renders
`ui/` pieces, and obtains data from `@/server/queries/**` (§7) or from props — never from
`@/server/services/**` or `@/server/db/**`.

**Neither directory computes.** A `Rechnung` component receives
`{ nettoCent, steuerCent, bruttoCent }` already calculated by `services/finanz/rechnung.ts`; it
does not add them up, not even "just the total". A shift card receives `dauerMinuten`; it does
not subtract two dates. This is L2, and it is why the DST tests are meaningful: there is exactly
one implementation of duration in the codebase (§8.3) and it is tested.

**`script-accent.tsx` lives under `public/`, not `ui/`.** DESIGN §2 says the script face never
appears in the portal; a component sitting in the directory the portal imports from, guarded by
a comment, is not a mechanism. The component additionally throws in development when it renders
under a `/portal` route, and `tests/a11y/portal.spec.ts` asserts the Caveat family is absent
from every portal page.

A component is added to `ui/` only after DESIGN.md describes it. If a page needs something
DESIGN.md does not define, the PR edits DESIGN.md first. That order is not negotiable (D-10) —
see §24 for the tokens currently outstanding.

---

## 14. `src/lib`, `src/i18n`, `src/styles`

```
src/lib/
├─ cn.ts                     # tailwind-merge + clsx
├─ format/
│  ├─ geld.ts                # Cent → "1.234,56 €" with a non-breaking space (DESIGN §5)
│  ├─ datum.ts               # UTC instant → Europe/Berlin display; date-only kept apart from instant
│  ├─ dauer.ts               # minutes → "8:00 h"
│  ├─ nummer.ts              # German decimal separator, tabular figures
│  └─ adresse.ts
├─ datum/                    # pure calendar facts — no DB handle, no clock, no formatting
│  ├─ feiertage-berlin.ts    # berlinFeiertage · istFeiertag — Gauss/Butcher + the Berlin
│  │                         #   fixed list; the ONE holiday algorithm (§8.5)          CLN-03
│  └─ feiertage-berlin.test.ts
├─ status.ts                 # domain enum → DESIGN §5 status-pill vocabulary — see below
├─ schemas/                  # Zod schemas shared by a form component and its Server Action (SEC-A4)
│  └─ kern.ts · crm.ts · ops.ts · zeit.ts · finanz.ts · radar.ts · inhalt.ts
├─ routes.ts                 # typed route builders — the `ziel` of every KPI (DSH-04)
├─ errors.ts                 # client-safe error shapes; German messages
├─ result.ts
├─ constants.ts              # non-design constants only (page sizes, token TTLs)
└─ logger.ts

src/i18n/
├─ config.ts                 # de (default) · en · ar · tr — EMP-12
├─ request.ts
├─ direction.ts              # ar → dir="rtl"
└─ messages/{de,en,tr,ar}.json

src/styles/
├─ globals.css               # DESIGN §1–§3, §7 as CSS custom properties — THE source of every value
├─ print.css                 # DESIGN §11 — white page, #111 text, A4, 20mm, 10pt
└─ fonts.ts                  # next/font: Inter + Caveat, self-hosted, subset
```

`src/lib/format/*` is the boundary between a computed value and a rendered one. It may not
import `@/server/**`, it never rounds money, and it never turns a string into a number.
`src/lib/datum/*` is the other half of that zone and the reason the zone is stated as
"no `@/server/**` imports" rather than "presentation only": a pure calendar fact — which days are
public holidays in Berlin in 2027 — is needed by a service, by a nightly job **and** by the seed,
and the only file that all three may import is one that imports none of them (§8.5).

**`src/lib/status.ts` exists because the two vocabularies do not match.** Enum values are
transliterated German snake_case (`in_bearbeitung`, `festgeschrieben`); the DESIGN §5 pill
vocabulary carries umlauts and spaces („In Prüfung", „Überfällig"). One mapping table, in
formatting territory, keyed exhaustively by enum so a new state fails the type-check:

```ts
export const statusAnzeige: Record<RechnungStatus, { label: string; ton: PillTon }> = {
  entwurf:          { label: 'Entwurf',          ton: 'info' },
  festgeschrieben:  { label: 'Festgeschrieben',  ton: 'success' },
  storniert:        { label: 'Storniert',        ton: 'muted' },
};
```

Portal UI copy is German. Only the worker-facing screens listed in SPEC §10 — `portal/mein/**`
and `check-in/[token]/**` — are additionally translated to en / ar / tr (EMP-12), with `dir`
handled in `i18n/direction.ts` and applied by both layouts.

---

## 15. Tests

Unit tests sit **next to the code they test**, as `*.test.ts`. Anything that needs a database, a
browser or a whole route lives under `tests/`.

```
src/server/services/zeit/dauer.test.ts             # the five mandatory time tests (§15.2)
src/server/services/finanz/geld.test.ts
src/server/services/finanz/nummernkreis.test.ts
src/server/services/finanz/rechnung.concurrency.test.ts
src/server/services/finanz/hash-chain.test.ts
src/server/services/arbzg/pruefung.test.ts
src/server/services/gewerke/bau/rechenansatz.test.ts
src/server/agent/policy.test.ts
… one .test.ts beside every service module

tests/
├─ helpers/
│  ├─ db.ts                    # ephemeral schema per test file; connects as cse_app by default
│  ├─ as-user.ts               # builds a SessionContext for a role × mandant × portal
│  ├─ fixed-clock.ts           # the injected Clock — no test ever waits
│  └─ factories/               # makePerson, makeAnstellung, makeEinsatz, makeRechnung …
├─ invariants/                 # schema-level, run in CI on every PR (db.yml)
│  ├─ money-is-bigint.test.ts        # every _cent is bigint; no float anywhere    invariant 1
│  ├─ timestamps-are-tz.test.ts      # every instant column is timestamptz         invariant 2
│  ├─ mandant-id-and-rls.test.ts     # bucket 1: mandant_id, ENABLE **and FORCE**,
│  │                                 #   both K-03 policies — run as cse_app       invariant 3, SEC-A2
│  │                                 #   bucket mandant_scoped_lesend: asserts the ABSENCE of an
│  │                                 #   INSERT/UPDATE/DELETE policy for cse_app    K-06, §5.1
│  │                                 #   bucket plattform_scoped: nullable mandant_id + the
│  │                                 #   ebene CHECK                                K-16(d)
│  ├─ policy-anzahl.test.ts          # ≤ 4 permissive policies `to cse_app` per tenant table, no
│  │                                 #   permissive cse_app write policy outside t_mandant, and
│  │                                 #   t_job only where rls.ts.job says so   K-03, K-18, §4.5
│  ├─ accessor-scopes.test.ts        # K-20 — every app.* accessor returns a defined value, or a
│  │                                 #   documented NULL, in all four scopes             §4.4
│  ├─ rechte-katalog.test.ts         # K-19 — every right-key literal in db/rls/*.sql, the route
│  │                                 #   manifest and the services has a `berechtigung` row, and
│  │                                 #   every catalogue row is used by some code path
│  ├─ views-security-invoker.test.ts # every view is security_invoker; no matview on tenant data
│  ├─ komposit-fk.test.ts            # K-16 composite FK ⇒ parent UNIQUE (mandant_id, id);
│  │                                 #   wissens_chunk's PK (mandant_id, id) satisfies it  K-16(a)
│  ├─ portal-ceiling.test.ts         # K-04 — every anstellung/person-hung table has its ceiling,
│  │                                 #   and every ceiling_kunde table resolves a subject
│  ├─ rls-guc-nutzung.test.ts        # no policy references app.akteur_typ, app.akteur_id or app.ip
│  ├─ aal2-gate.test.ts              # K-15 — the gate is on the admin write path, not on SELECT
│  ├─ route-manifest.test.ts         # K-08 — no DB access outside the seven helpers, and no
│  │                                 #   sixth entry in the K-08 register
│  ├─ reservierte-slugs.test.ts      # K-07 — static /portal segments ⊆ the slug CHECK
│  ├─ gruppe-ohne-actions.test.ts    # invariant 10 — no _actions.ts under portal/gruppe
│  ├─ rechnung-immutability.test.ts  # K-12 — UPDATE on festgeschrieben raises, no allowlist
│  ├─ no-hard-delete.test.ts         # invariant 8 — every table in rls.ts.kein_hard_delete
│  ├─ mitgliedschaft-additiv.test.ts # K-14
│  ├─ agent-keine-zahlen.test.ts     # K-10 — no numeric literal reaches a tool argument
│  ├─ session-context.test.ts        # one construction site
│  └─ person-anstellung-fks.test.ts  # the D-09 FK table, asserted column by column
├─ isolation/                  # SEC-A3 — the highest-priority suite in the repo
│  ├─ matrix.ts                # generates cases from src/server/db/rls.ts × every role
│  ├─ db/rls.test.ts           # user of A selecting B's row gets zero rows
│  ├─ db/write-check.test.ts   # INSERT/UPDATE with a foreign mandant_id raises  (K-03 WITH CHECK)
│  ├─ db/entgelt.test.ts       # K-05 — reinigung Leitung cannot reach a security wage by any route
│  ├─ db/arbzg.test.ts         # K-06 — breach detected, zero identifying fields returned
│  ├─ db/rag.test.ts           # AGT-06 — retrieval as A returns no chunk of B
│  ├─ db/job-rolle.test.ts     # K-01 — a cse_job connection without SET LOCAL ROLE reads zero rows
│  ├─ db/person-scope.test.ts  # K-18 — a mitarbeiter session reads its own rows in its own
│  │                           #   employments and nothing else; and reads NON-zero rows, which
│  │                           #   is what the group-scope routing silently got wrong
│  ├─ db/kunde-scope.test.ts   # K-18 — a customer of A in reinigung reads its bau orders too,
│  │                           #   and no row of any other customer
│  ├─ db/switcher-zaehler.test.ts  # TEN-10 — no counter for a mandant the user is not in
│  ├─ http/routes.spec.ts      # every portal route of B → 404 for a user of A
│  ├─ http/api.spec.ts         # every api/ endpoint of B → 404
│  ├─ http/deep-link.spec.ts   # pasted [mandant] slug of B → 404; member → switch interstitial
│  ├─ http/switch.spec.ts      # switchMandant to a non-member mandant → 404, session unchanged
│  └─ gruppe-readonly.spec.ts  # no write path reachable from portal/gruppe   invariant 10
├─ e2e/
│  ├─ public/{home,profil,angebot-anfragen,karriere}.spec.ts
│  ├─ auth/{login-2fa,mitarbeiter-sms,lockout}.spec.ts
│  ├─ security/headers.spec.ts # CSP + HSTS present; 11th login attempt blocked  SEC-A7, AUT-07
│  ├─ portal/{switcher,dashboard,raumbuch-import,angebot,dienstplan,freigaben}.spec.ts
│  ├─ mitarbeiter/{checkin,stunden,einwand}.spec.ts
│  ├─ kunde/{rechnungen,dokumente}.spec.ts
│  └─ finanz/{entwurf-zu-festgeschrieben,storno,abschlag}.spec.ts
├─ compliance/
│  ├─ xrechnung/{samples/,kosit.test.ts}         # FIN-11
│  ├─ datev/{golden/,extf.test.ts}               # ACC-02 — golden file from the tax advisor (O-05)
│  └─ gobd/hash-chain-tamper.test.ts             # FIN-06, LEG-01
└─ a11y/
   ├─ public.spec.ts           # axe on every public route            PUB-09, LEG-07
   └─ portal.spec.ts           # keyboard-only traversal, focus rings, no script face
```

### 15.1 The isolation suite generates itself

`tests/isolation/matrix.ts` derives its cases from `src/server/db/rls.ts` (§5) rather than from
a hand-written list, and it **connects as `cse_app`**, never as the owner — an isolation test
run as the table owner passes against a database with no FORCE and proves nothing. A new tenant
table added without RLS makes the suite fail on the PR that adds it, instead of being discovered
later by a customer of another entity. `isolation.yml` is a required check (SEC-A3).

### 15.2 The time tests that gate the scheduling UI

SPEC §9 names **five**, and all five live in `src/server/services/zeit/dauer.test.ts`. They must
pass before any file appears under `src/app/portal/[mandant]/dienstplan/`:

| Case | Expected |
|---|---|
| 22:00–06:00 | 8 h |
| DST spring-forward night | 7 h |
| DST fall-back night | 9 h |
| ten shifts starting at the same instant on one object | ten parallel columns, none hidden (TIM-04) |
| a shift crossing month-end | split by actual minutes per month — **with a CET case and a CEST case** (K-11) |

### 15.3 Suites that may never be skipped, quarantined or marked `.todo`

`tests/invariants/`, `tests/isolation/`, and these named cases:

| Test | Proves |
|---|---|
| `services/zeit/dauer.test.ts` | the five cases above (SPEC §9, K-11) |
| `services/arbzg/pruefung.test.ts` | 6h reinigung + 5h security on one day is one 11h breach — the single most important consequence of D-09 (TIM-14, LEG-03) |
| `isolation/db/arbzg.test.ts` | and that the planner learns nothing else about the other entity (K-06, EMP-13) |
| `services/finanz/rechnung.concurrency.test.ts` | ten parallel finalisations → ten consecutive numbers, one unbroken chain (FIN-03, FIN-06) |
| `services/finanz/nummernkreis.test.ts` | deleting 1000 drafts leaves zero gaps (FIN-03, LEG-01) |
| `invariants/rechnung-immutability.test.ts` | invariant 4 holds at the database layer (K-12) |
| `services/zeit/schreiben/zeiteintrag.test.ts` | the server instant wins and `zeitabweichung_sek` is stored separately (invariant 5, TIM-08) |
| `tests/e2e/mitarbeiter/checkin.spec.ts` + a concurrency case | N simultaneous requests on one token yield exactly one `zeiteintrag` (K-09) |
| `agent/policy.test.ts` | a €25,000 offer cannot be sent automatically **even with a permissive `agent_richtlinie` row** (invariant 7, ROADMAP Phase 8) |
| `gewerke/security/sachkunde.test.ts` | assigning a guard whose §34a certificate is expired at the shift date fails in the service layer (SEC-04, LEG-04) |
| `gewerke/bau/rechenansatz.test.ts` | `"3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"` → `30,87 m²`, formula text preserved (BAU-02) |

---

## 16. `supabase/`

| Path | Contents | Pins |
|---|---|---|
| `supabase/config.toml` | **Local development only**: ports, auth settings (MFA enabled), buckets declared **private**, `db.major_version`. It mirrors the Frankfurt project's settings; the region itself is set in the project/IaC and recorded in DECISIONS (D-04, O-11) | D-04 (EU region), SEC-A6 (private buckets), AUT-02 (MFA) |
| `supabase/functions/cron-dispatch` | The only Edge Function: invoked by `pg_cron`, calls `api/cron/[job]` with the shared secret. It contains no business logic and stamps no time — schedules stay in the database where they are auditable | invariant 5 (server clock), `07-INTEGRATIONEN.md` §22, `05-API-KARTE.md` §C.4 |

> **D-582 — Drizzle was removed; this section describes the migrator that exists.**
> `drizzle-orm` was never imported by a single file and `src/server/db/schema/` holds no
> `pgTable`, so both packages and `drizzle.config.ts` are gone. The folder `drizzle/`, the
> four-digit numbering and the journal table `__drizzle_migrations` keep their names: the
> migrator, `scripts/test-db.sh`, CI and the Verfahrensdokumentation (ACC-10) all name that
> path, and renaming them would be a change without content. **Passages elsewhere in this
> document that describe a Drizzle model layer (`client.ts`, `schema/*.ts` table constants,
> relations) describe a design that was never built** — read them as history until they are
> rewritten.

**There is no `supabase/migrations` symlink.** Two runners over one directory is a corruption
waiting to happen: the repository migrator tracks state in `__drizzle_migrations`, the Supabase
CLI in its own `schema_migrations` table with a `<timestamp>_name.sql` naming convention it
will not recognise in `0007_nummernkreis.sql`.

**One applier: `pnpm db:migrate` in every environment, including local.** It is
`src/server/db/migrate.ts`: it applies every `drizzle/*.sql` in filename order, under the
migrator role, checks the server's prerequisites first and records each applied file in
`__drizzle_migrations`. `supabase start` provides Postgres, Auth, Storage and cron for local
development; it never applies schema. RLS, roles, functions and triggers are authored in
`src/server/db/rls/`, `funktionen/` and `triggers/` and folded into the numbered migration
sequence by hand-written SQL in that same sequence — so policies version, review and roll back
exactly like tables, and the dashboard is never a source of schema.

---

## 17. `.github/workflows`

| Workflow | Steps | Gate |
|---|---|---|
| `ci.yml` | `pnpm typecheck` · `pnpm lint` · `pnpm lint:design` · `pnpm lint:todo` · `pnpm test` · `pnpm build` | required |
| `db.yml` | migration order and numbering (`migrationsnummern.test.ts`, D-582) · `pnpm test:invariants` · RLS **and FORCE** coverage via `scripts/rls-check.ts` · the **K-19 right-key extraction** (`rechte-katalog.test.ts`): every right key any policy, route gate, service or seed writes has a `berechtigung` row, and every catalogue row is used — a misspelled key is otherwise a permanently empty screen with no error | required |
| `isolation.yml` | `pnpm test:isolation` against a seeded local Supabase, connected as `cse_app` | **required — SEC-A3** |
| `e2e.yml` | Playwright, chromium desktop + mobile viewport, `TZ=Europe/Berlin`; a **second run under a non-Berlin TZ** so a UTC assumption cannot pass silently (K-11) | required |
| `compliance.yml` | KoSIT validation of generated XRechnung samples (FIN-11) · DATEV EXTF golden-file diff (ACC-02) | **required immediately** — it passes trivially on an empty sample set, so the first sample cannot merge unvalidated |
| `a11y.yml` | axe on public routes · Lighthouse CI budgets | required (PUB-09, PUB-10, LEG-07) |
| `security.yml` | `pnpm audit --audit-level=moderate` (D-590) · OWASP ZAP baseline · secret scan | required (SEC-A8) |

A conditionally-required check is not a gate, which is why `compliance.yml` is required from
day one rather than "once samples exist".

`pnpm lint:design` is the L4 token scan: it fails on any hex colour, `px` value, `rgba(`,
`cubic-bezier(` or font stack found outside `src/styles/globals.css`, `tailwind.config.ts` and
`src/server/pdf/theme.ts`. `pnpm lint:todo` is the L6 scan: every `TODO(client)` carries an O-number, and every O-number and
every `*.platzhalter.ts` must have a matching entry in `DECISIONS.md` § Open, and every
`integrations/*/` with a real adapter must have a sub-processor entry (§11.4).

---

## 18. File-naming convention

| Kind | Convention | Example |
|---|---|---|
| Directories | kebab-case, ASCII only | `src/server/services/gewerke/security/` |
| Route segments | German, kebab-case, umlauts transliterated (`ae oe ue ss`) | `angebot-anfragen`, `ueber-uns`, `auftraege`, `schluessel` |
| React component files | kebab-case file, PascalCase export | `mandant-switcher.tsx` → `export function MandantSwitcher` |
| Service / query / job / tool files | kebab-case, named after the domain noun | `nummernkreis.ts`, `lead-sla/fristen.platzhalter.ts`, `berechne-preis.ts` |
| Schema files | kebab-case domain name | `radar-ki-inhalt.ts`, `zeit-intern.ts` |
| Migrations | hand-written SQL under `drizzle/`, four digits, never renamed, never edited after merge (D-582) | `0007_nummernkreis.sql` |
| Unit tests | source name + `.test.ts`, beside the source | `dauer.test.ts` |
| Playwright specs | `.spec.ts`, only under `tests/` | `tests/e2e/finanz/storno.spec.ts` |
| Private route files | leading underscore | `_actions.ts`, `_schemas.ts`, `_components/` |
| SQL files | kebab-case, verb-free noun | `db/rls/finanz.sql`, `db/triggers/hash-chain.sql` |
| Placeholder implementations | `.platzhalter.ts` suffix — greppable, and `lint:todo` enumerates them | `skr03.platzhalter.ts` |
| Environment variables | English SCREAMING_SNAKE_CASE | `DATABASE_URL_APP`, `OPENAI_API_KEY` |

`.test.ts` and `.spec.ts` are not interchangeable: Vitest owns `*.test.ts`, Playwright owns
`*.spec.ts`, and §22 pins both so they cannot collect each other's files.

Files are named after nouns, not layers: `rechnung.ts`, not `invoice-service.ts` and not
`rechnungService.ts`. The directory already says it is a service.

---

## 19. Barrel exports and `server-only`

Barrels are forbidden by default. They create import cycles, break tree-shaking, and —
specifically dangerous here — can pull a server-only module into a client bundle through one
innocent re-export.

**Exactly three barrels exist**, each because a library or a dispatcher requires one object:

| Path | Why |
|---|---|
| `src/server/db/schema/index.ts` | Drizzle takes one schema object; also the input to the invariant tests |
| `src/server/agent/tools/index.ts` | The orchestrator resolves tools by name from a registry |
| `src/server/jobs/_registry.ts` | `api/cron/[job]` resolves handlers by name |

Everywhere else, import the file:
`import { finalize } from '@/server/services/finanz/rechnung'`. `src/components/ui/index.ts`
does not exist. ESLint enforces this with `no-restricted-imports` patterns forbidding `*/index`
imports outside the allowlist, and `import/no-cycle` is an error.

`src/server/db/rls.ts` is **not** a barrel — it exports data (the table classification), not
re-exports — and it is imported by the schema-free test harness on purpose. The same is true of
`src/server/db/tabellen-klassen.ts`, which exports the agent-facing table classes (R-17) that
`06-AGENTEN-FREIGABEN.md` §2.3 asserts against. The two lists are deliberately separate: `rls.ts`
answers *which policies must exist*, `tabellen-klassen.ts` answers *what a tool may name at all*,
and folding them into one file would make a change to the agent surface look like a change to
the isolation matrix.

Every module under `src/server/` that must never reach the browser starts with
`import 'server-only';` — `db/client.ts`, `db/tenant.ts`, `queries/*`, `auth/*`,
`integrations/*`, `platform/*`, `agent/*`, `config/env.ts`. Client components that need a value
receive it as a prop from a Server Component (SEC-A5: no key, no secret, no service credential
ever reaches frontend code).

---

## 20. Import direction, at a glance

Every arrow points one way. A dependency that runs against an arrow is the defect, regardless
of how convenient it is.

```
  app/**  ─────────────┐
  components/features/ ┴──▶  server/queries/**  ──▶  server/services/**  ──▶  server/db/schema
                                    │                      │                        ▲
                                    ├──▶ server/db/tenant.ts ──────────────────────┘
                                    │        (the seven helpers — the only door)
  components/ui/  ──▶ lib/format/   │
                                    ├──▶ server/agent/**   ──▶ server/services/**
                                    ├──▶ server/jobs/**    ──▶ server/services/**
                                    └──▶ server/http/**

  server/services/**  ──▶  server/lib/**            (clock, ids, crypto)
  server/services/**  ──▶  ports (injected)  ──▶  server/integrations/**   ← never a direct import
  scripts/**          ──▶  server/**                (never the reverse)
```

Three arrows that do **not** exist, and each is a lint rule: `components/** → server/**`,
`services/** → integrations/**` (except through an injected port), and
`agent/{tools,rag}/** → db/**` as a value import. One arrow that **does** exist and is easy to
miss: `src/app/**/_actions.ts → server/services/**`. It is the only path from the route tree to
a service, it is scoped by filename rather than by folder, and without it stated the zone above
would forbid the very import the write path requires — which is how a lint rule gets widened by
the first person who needs it (§23).

---

## 21. German versus English identifiers

The rule is: **German where the term carries legal meaning; English for machinery.** Both
appear in the same line of code, which is correct and intentional — `finalizeRechnung` names an
English operation on a German legal object.

| Layer | Language | Example |
|---|---|---|
| Table names | German snake_case | `zeiteintrag`, `rechnungsposition`, `da_kenntnisnahme` |
| Domain columns | German snake_case | `leistungszeitraum_von`, `zeitabweichung_sek`, `freigegeben_vom_kunden`, `angemeldet_am` |
| Common columns (K-16) | **German** snake_case | `erstellt_am`, `erstellt_von`, `geaendert_am`, `geaendert_von`, `archiviert_am`, `storniert_am` |
| Tenancy / linking columns | German snake_case | `mandant_id`, `person_id`, `anstellung_id`, `objekt_id` |
| Money columns | German noun + `_cent` | `netto_cent`, `steuer_cent`, `brutto_cent`, `mahngebuehr_cent`. **One named exception:** the wage column is `anstellung.stundensatz_intern` (K-05, `01-KERN.md` §6.14); `stundensatz_intern_cent` is the HTTP field only |
| Quantity columns | German noun + unit | `flaeche_qm`, `leistungswert_qm_pro_stunde`, `menge` |
| Sub-cent AI cost (K-16(b), the five agent-ledger tables of §9.4 only) | German noun + `_mikrocent`, `bigint` | `kosten_mikrocent`, `verbrauch_mikrocent`, `reserviert_mikrocent` |
| Measured durations (K-16(c)) | German noun + unit, `integer` | `dauer_minuten`, `zeitabweichung_sek`, `ruhezeit_minuten` |
| Computed target durations (K-16(c)) | German noun beginning `soll`, `numeric(8,2)` | `sollzeit_minuten` |
| Instant columns | German, `_am` or `_zeitpunkt`, `timestamptz` | `festgeschrieben_am`, `eingereicht_am`, `beginn_zeitpunkt` |
| Calendar-date columns | German, `date` type | `geburtsdatum`, `eintritt`, `austritt`, `leistungsdatum` |
| Drizzle table constants | German camelCase matching the table | `export const zeiteintrag = pgTable('zeiteintrag', …)` |
| Drizzle column keys | camelCase; `casing: 'snake_case'` does the mapping | `erstelltAm` → `erstellt_am` |
| Postgres helper functions and GUCs | German, `app.` schema | `app.aktiver_mandant()`, `app.hat_recht()`, `app.mandant_id` |
| TypeScript types | PascalCase German noun | `Rechnung`, `RechnungEntwurf`, `Anstellung`, `AbrechnungsartStrategy` |
| Functions | English verb + German noun | `createRechnung`, `finalizeRechnung`, `assignRechnungsnummer`, `verifyHashChain`, `assertQualifiedAt` |
| Infrastructure | English | `withTenant`, `hashChain`, `TenantDb`, `NotConnectedError`, `Clock` |
| Route segments | German | `/portal/reinigung/finanzen/rechnungen/neu` |
| Enum values | German, matching the domain vocabulary | `entwurf` · `festgeschrieben` · `storniert`; `neu` · `geprueft` · `verworfen` · `in_bearbeitung` · `eingereicht` |
| UI copy | German (worker screens also en/ar/tr) | „Rechnung festschreiben" |
| Error classes / messages | English class, German user-facing message | `class NotFoundError` with `"Nicht gefunden"` |
| Test descriptions | German scenario, English harness | `it('Schicht 22:00–06:00 ergibt 8 Stunden', …)` |

Two exceptions, both narrow. **Where 00-KONVENTIONEN names an identifier verbatim, that
spelling wins** — `splitteNachMonat` (K-11), `app.arbzg_belastung` (K-06), all five register
functions of K-08 (`app.sitzung_aufloesen`, `app.versuch_protokollieren`,
`app.checkin_verbrauchen`, `app.offline_ereignis_annehmen`, `app.ical_feed_lesen`),
`app.entgelt_lesen` (K-05), `app.sichtbare_mandanten` and the four `app.scope` values of K-18
(`mandant` · `gruppe` · `person` · `kunde`), the column names K-16 fixes
(`revier.sollzeit_minuten`, `*_mikrocent`, `audit_log.ebene`), and **the canonical spellings K-21
fixes**: `mandant.slug` (not `schluessel`), `mandant.ist_rechtseinheit` (not `ist_rechtstraeger`),
`agent_budget.budget_cent` (not `monatslimit_cent`), `agent_budget.verbrauch_mikrocent` with the
cents figure computed rather than stored, `mandant_einstellung` keys instead of monitoring
columns on `mandant`, `steuersatz_gruppe` with no `steuersatz` table behind it, and
`rechnung_beziehung` rather than `storno_verweis`. The reserved `mandant.slug` values are one
list — `gruppe`, `mein`, `kunde`, `konto`, `api` (§3.1). And the common columns are
**German**, not `created_at` / `updated_at`: K-16 fixes them, they appear in every GoBD export
and every audit view a German auditor reads, and a repository that mixes both spellings for the
same concept will end up with both in the schema.

Do not translate a German domain term into English anywhere — `invoice`, `employee`,
`assignment`, `measurement` are all wrong here. `Rechnung`, `anstellung`, `einsatz` and
`aufmass` each carry a statutory meaning the English word does not, and the loss shows up first
in a conversation with an auditor.

---

## 22. Tooling configuration and what each file pins

| File | Pins |
|---|---|
| `tsconfig.json` | `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `verbatimModuleSyntax`, `isolatedModules`, `target: ES2022`, `moduleResolution: bundler`, `noEmit`, path alias `@/* → ./src/*`, `exclude: ['scripts']`. `any` is an ESLint error, not a compiler setting. `noUncheckedIndexedAccess` is the one that catches an unvalidated array access in a money calculation |
| `next.config.ts` | Vercel **EU function region** (D-04), `typedRoutes` (DSH-04 depends on it), `images.remotePatterns` limited to the marketing host, security headers **except CSP** — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy (SEC-A7), `experimental.serverActions.allowedOrigins`. **No `output: 'standalone'`:** it is unnecessary on Vercel and it silently presumes an answer to O-11 (managed EU cloud vs self-hosted German server); if O-11 lands on self-hosting, it is added then, deliberately |
| `src/middleware.ts` | Supabase session refresh · **CSP with a per-request nonce** · locale negotiation for `portal/mein` and `check-in` (EMP-12) · rate-limit hook for `(auth)` and `api/{formular,bewerbung}` (AUT-07). CSP lives here alone: Server Actions and streaming need a nonce only middleware can mint, and a static CSP is either too loose (`unsafe-inline`) or breaks the app |
| `tailwind.config.ts` | DESIGN §10 verbatim: `colors.ink/surface/line/brand/area`, `fontFamily.sans/script`, `borderRadius`, `transitionTimingFunction.brand`, breakpoints from DESIGN §8, `content` over `src/app` and `src/components` only. No colour is defined here that is not in DESIGN §1 |
| `postcss.config.mjs` | tailwindcss + autoprefixer |
| `components.json` | shadcn/ui generator: output `src/components/ui`, aliases, **base colour disabled** — generated components are edited to DESIGN.md tokens before merge, never used raw |
| `drizzle.config.ts` | `schema: './src/server/db/schema/*.ts'`, `out: './src/server/db/migrations'`, `dialect: 'postgresql'`, `casing: 'snake_case'` (camelCase keys map to snake_case columns — one convention, §21), `strict: true`, `verbose: true`, credentials from `src/server/config/env.ts`. Migrations are committed; the dashboard is never the source of schema |
| `vitest.config.ts` | **Three** projects: `services` (node) over `src/**/*.test.ts`, `components` (jsdom) over `src/components/**/*.test.tsx`, `db` (node) over `tests/**/*.test.ts` — the third exists because `db.yml` runs `tests/invariants` and `compliance.yml` runs `tests/compliance`, and neither is under `src/`. `setupFiles: ['./vitest.setup.ts']`; coverage thresholds highest on `services/finanz`, `services/zeit` and `services/arbzg` |
| `vitest.setup.ts` | Forces `process.env.TZ = 'UTC'` so a passing DST test is honest, installs the fixed `Clock`, and fails any test that calls `new Date()` inside a service |
| `playwright.config.ts` | `testDir: './tests'`, an explicit `testMatch` of `'**/*.spec.ts'` so it cannot collect Vitest's `*.test.ts` files, projects `chromium-desktop` and `mobile-safari` (iPhone viewport, DESIGN §8), `timezoneId: 'Europe/Berlin'`, `locale: 'de-DE'`, `baseURL` from env, `webServer` runs `pnpm build && pnpm start`, traces on first retry |
| `eslint.config.mjs` | Flat config: `next/core-web-vitals`, `@typescript-eslint` strict-type-checked, `eslint-plugin-tailwindcss` with `no-arbitrary-value`, `import/no-cycle`, plus the zones in §23 |
| `prettier.config.mjs` | `prettier-plugin-tailwindcss` for deterministic class order; 100 columns; single quotes |
| `lighthouserc.json` | Performance and accessibility budgets for the public routes (PUB-09, PUB-10) |
| `.env.example` | Every key `src/server/config/env.ts` validates, with a comment naming which integration falls back to `nicht-verbunden.ts` when it is absent. Two database URLs (`DATABASE_URL_APP`, `DATABASE_URL_JOB`), never a `postgres` superuser URL. No value, ever |
| `package.json` scripts | `dev` · `build` · `start` · `typecheck` · `lint` · `lint:design` · `lint:todo` · `test` · `test:invariants` · `test:isolation` · `test:compliance` · `test:e2e` · `db:generate` · `db:migrate` · `db:rls` · `db:seed` · `db:reset` |

---

## 23. The rules, as enforceable configuration

The laws of §1 are ESLint zones, not aspirations. `eslint.config.mjs` carries:

| Zone | Forbidden | Reason |
|---|---|---|
| `src/components/**` | `@/server/**` **except** `@/server/queries/**` in `components/features/**` | L2 — no server logic, no DB, no calculation in the view |
| `src/lib/**` | `@/server/**` | Formatting never computes |
| `src/app/**` | `@/server/db/**` everywhere; `@/server/services/**` everywhere **except** files matching `src/app/**/_actions.ts` | L1 — reads go through `@/server/queries/**`; the write path needs one legal door and this is it |
| `src/app/**/_actions.ts` | `@/server/db/**` (still), and `@/server/services/**` from any other file under `src/app/**` | L1 — the carve-out is by filename pattern, so a `page.tsx` cannot reach a service and an action cannot reach the database |
| `src/server/queries/**` | `next/*`, `react` | It is a data boundary, not a UI layer |
| `src/server/services/**` | `next/*`, `react`, `@/server/http/**`, `@/server/integrations/**`, `@/server/config/**`, `@/server/queries/**` | L5 — services stay pure, testable and unaware of transport |
| `src/server/services/**`, `src/server/jobs/**`, `src/server/agent/**` | `new Date()`, `Date.now()`, `Math.random()` (`no-restricted-syntax`) | Invariant 5 — the clock is injected so tests control it |
| `src/server/agent/{tools,rag}/**` | `@/server/db/**` as a **value** import (`allowTypeImports: true`) | Invariant 6, AGT-06 — a tool calls a service; a retriever receives a `TenantDb` and must be able to name that type (§9.3) |
| `src/server/agent/**` | `@/server/services/zeit/schreiben/**` | R-11 — an agent may read the plan and the worked hours; no agent path writes a `zeiteintrag`, a `dienstplan` or an `abwesenheit`. The rule is expressible only because §8 splits `services/zeit/` into `lesen/` and `schreiben/` |
| `src/server/db/client.ts` | importable only by `db/tenant.ts`, `db/seed/index.ts`, the migration runner, `tests/helpers/db.ts` | Invariant 3, L3 — the seven helpers are the only door |
| `src/server/db/schema/**` | `real`, `doublePrecision`, `float` anywhere; `numeric` on any `*_cent` or `*_mikrocent` column; raw `bigint()` / `integer()` / `numeric()` outside `_shared.ts`; `mikrocent()` outside `radar-ki-inhalt.ts`; `zielminuten()` on a column that is not a computed target | Invariant 1, K-16 incl. (b) and (c) |
| `src/app/portal/gruppe/**` | any `_actions.ts` file existing at all | Invariant 10, K-03 |
| `src/components/ui/**` | `script-accent`, `@/server/**` | DESIGN §2 — the script face never appears in the portal |
| everything except `globals.css`, `tailwind.config.ts`, `pdf/theme.ts` | hex colours, `rgba(`, raw `px`, font stacks, `cubic-bezier(` | L4 — DESIGN.md is the only source of design values |
| `src/**` | `scripts/**` | One-off importers are not application code |

Rules a linter cannot express are tests, and every one of them is named in §15.

---

## 24. Design tokens this architecture needs and DESIGN.md does not yet name

L4 bans a raw `px` value, a hex literal and an arbitrary Tailwind value everywhere except
`globals.css`, `tailwind.config.ts` and `pdf/theme.ts`. Several values the components of §13
require exist in DESIGN.md as **prose** but not as **tokens**, so the first component PR would
have to break L4 or invent a name. Per D-10 the DESIGN.md amendment lands first; this is the
list.

| Needed by | Value in DESIGN.md | Missing token |
|---|---|---|
| `hue-bar.tsx` (TEN-07), `mandant-avatar.tsx`, `table.tsx` | 3px top bar, 2px avatar ring, 1px hairline | `borderWidth: { hairline, ring, identity }` |
| `form-field.tsx`, `button.tsx` (DESIGN §8) | tap targets ≥ 44×44px | `size.tap` |
| `table.tsx` (DESIGN §5) | row height 56px | `size.row` |
| `portal-sidebar.tsx` (DESIGN §5) | 248px, collapsed 64px | `size.sidebar`, `size.sidebarCollapsed` |
| `mandant-switcher.tsx` (DESIGN §6) | dropdown 320px | `size.dropdown` |
| `public-header.tsx` (DESIGN §5) | 72px | `size.header` |
| layout containers (DESIGN §3) | content max 1280px, prose max 72ch | `maxWidth.content`, `maxWidth.prose` |
| `dialog.tsx`, `dropdown-menu.tsx` (DESIGN §3, §7) | `--shadow-pop`, `--ease`, `--fast/--base/--slow` | the same names in `tailwind.config.ts`, not only in CSS |
| `charts/*` (REP-01, REP-06, ACC-08) | "series colours = the four identity hues" | **an extended series sequence** — a BWA has more than four lines — **plus a non-colour encoding** (direct labels or dash patterns), because DESIGN §9 forbids colour as the only signal |
| `portal/[mandant]/layout.tsx` (TEN-07, TEN-08) | four fixed area hues | the hue must be **data**: `mandant.identitaets_hue` seeded with the four DESIGN §1 values and applied as a CSS custom property on the portal shell. Otherwise a fifth area needs a code change and a rebuilt Tailwind config, which TEN-08 forbids |
| `gruppe/layout.tsx` (TEN-05, DESIGN §6 rule 4) | — | the neutral group-view bar: `--border-strong` plus the `NUR LESEN` pill |
| `placeholder-image.tsx` (D-10, O-13) | "marked as placeholder in the code" | the visible treatment (label, overlay) so a placeholder is unmistakable outside production |

`public/brand/*.svg` has the same problem as the hues: five fixed files. The logo is a
`mandant` attribute pointing at a storage object; the five committed files are the seeded
defaults until O-12 delivers the real assets.

---

## 25. Where every open question and every deliberate deviation lives

### 25.1 Questions already tracked in `DECISIONS.md`

Every one has a file, a labelled placeholder and a `TODO(client)` carrying the exact question.
None of them blocks the surrounding feature.

| Question | File | Placeholder shape |
|---|---|---|
| O-01 CSE Operations: GmbH or department? | `db/seed/01-mandanten.ts`, `services/finanz/nummernkreis.ts` | `operations` seeded **without** an invoice circle; creating one requires the answer |
| O-04 The exact five billing types | `services/finanz/abrechnungsart/registry.ts` + five `*.platzhalter.ts` | Interface plus the five FIN-01 names, each flagged unconfirmed |
| O-05 DATEV parameters + sample EXTF | `services/buchhaltung/kontenrahmen/skr0*.platzhalter.ts`, `integrations/datev/nicht-verbunden.ts`, `tests/compliance/datev/golden/` | Empty mapping; export path exists, transmission not connected |
| O-06 Betriebsrat (§87 BetrVG) | `services/zeit/schreiben/geo.ts` | Capture gated by the `mandant_einstellung` key `zeit.geolokalisierung` (K-21 — **not** a `mandant` column), **default off**; check-in works without it |
| O-07 Registered procurement platforms | `db/seed/09-radar.ts`, `services/radar/vergabeplattform.ts` | Empty `vergabeplattform`; RAD-09 flags every notice „Registrierung unbekannt" |
| O-08 One domain or four | `next.config.ts`, `src/lib/domains.ts` | Single-domain path routing; a host map is the swap point |
| O-09 Data volumes | `scripts/import/*`, `docs/runbooks/datenmigration.md` | Importers are streaming and idempotent, so volume is a runtime question, not a rewrite |
| O-10 Social and job-board accounts | `integrations/social/*`, `integrations/jobboards/*` | All `nicht-verbunden.ts`; the UI shows the reason |
| O-11 Hosting promise | `next.config.ts` (no `output: 'standalone'`), `supabase/config.toml` | Nothing in the tree presumes an answer; §22 records the one setting that would |
| O-12 Exact CSE red, SVG logos | `src/styles/globals.css` `--red`, `public/brand/*.svg`, `mandant.logo_pfad` | Value from DESIGN §1 with a TODO; logos are marked placeholders |
| O-13 Real photography | `public/images/platzhalter/`, `components/seo/placeholder-image.tsx` | Visibly marked outside production; `lint:todo` lists every remaining placeholder |

### 25.2 Deliberate deviations recorded here, so they are not re-decided by accident

| Deviation | Reason |
|---|---|
| No `supabase/functions/checkin-punch` | A second punch endpoint is a second machine with a second clock; `zeitabweichung_sek` would depend on which endpoint the phone reached (invariant 5, TIM-08). One writer: `app.checkin_verbrauchen` (K-08, K-09) |
| No `supabase/migrations` symlink | Two migration runners over one directory with incompatible state tables and naming conventions. `pnpm db:migrate` is the only applier (§16) |
| The portal lives under `/portal` | K-07 — without the prefix, a mandant slug and a public profile occupy the same URL and one of them silently wins |
| A read facade (`src/server/queries/**`) exists | Without it, L1 and L2 forbid every legal path to a `TenantDb` from the rendering tree, and the first Server Component is written by widening a lint rule (§7) |
| `env.ts` is in `config/`, not `lib/` | Services legitimately import `server/lib/*`; an `env.ts` there makes L5 unenforceable |
| `script-accent.tsx` is in `components/public/` | DESIGN §2 says never in the portal; a comment in the directory the portal imports from is not a mechanism |
| KoSIT validation lives in `tests/compliance/` | It is a CI concern; no production path depends on a validator being reachable, so it has no `nicht-verbunden` state |
| A switch interstitial for members, a bare 404 for everyone else | AUT-06 and K-02 protect against *non-members* learning an entity exists; a member already knows. Without it, a multi-entity Leitung's own bookmark is a dead end |
| `withSystemTenant` connects as `cse_job` and immediately `SET LOCAL ROLE cse_app` | K-03 gives a tenant table two policies, both `to cse_app`, and FORCE RLS is on. A job running *as* `cse_job` matches no policy and is refused — silently, by a database whose SQL looks correct. Containment moves to the system principal's `hat_recht` grants, which is where it belongs (§4.1) |
| `app.sitzung_aufloesen` returns the membership set, not just the session | Membership resolution is the definitive pre-session read: `benutzer_mandant` is a tenant table and there is no scope yet. The alternative — a self-scoped policy on `benutzer_mandant` — would mean amending K-03's two-policy rule for one table (§12.1) |
| `app.portal()` defaults to `mitarbeiter`, not `kunde` — for an **unset** session only | K-04 writes ceilings as `portal() <> '<portal>' or …`, so a `'kunde'` default *satisfies* the worker ceiling and switches fifteen tables' enforcement off. And the ceilings are restrictive: they are the second line, never the fail-closed one (§4.4) |
| `app.portal` is **bound at scope entry** in the three multi-tenant scopes, never recomputed | K-20. Recomputing it from `aktiver_mandant` — NULL there — falls through to the fail-closed `mitarbeiter`, which fires every K-04 employee ceiling inside `portal/gruppe` and ceilings every customer as staff. A blank group view with no error is indistinguishable from a permission problem (§4.4, §4.6) |
| Policies key on `app.aktuelle_kunden()` (array), never on the scalar `app.aktueller_kunde()` | K-20. The scalar is `(app.aktuelle_kunden())[1]` (§4.4), so in `kunde` scope it returns **one of the customer's several bindings, arbitrarily** — a `t_kunde` policy written against it does not fail closed, it silently serves one entity's rows and hides the others (CRM-06). The failure is invisible in a one-entity fixture and appears only for a customer served by two areas (§4.4, §4.5) |
| There is no `app.kunde_id` GUC | The customer subject is resolved inside the database from `kunde_zugang`. A ceiling whose subject arrives in a `set_config` call is a ceiling a compromised request can move (§4.4) |
| `rls.ts` has a `job` bucket and `t_job` is a registered fifth permissive class | Under FORCE RLS a table `GRANT` is not a policy. Inside `withSystemTenant` the point is moot — the helper becomes `cse_app` — but the run log and the integration bookkeeping a job writes around its tenant transactions have no scope, and without a policy they are zero rows with no error (§4.5, §5) |
| The holiday algorithm lives in `src/lib/datum/`, not under `services/gewerke/reinigung/` | Three sibling documents already named that path, and `src/lib/**` is the only zone a service, a job and the seed may all import. Two Easter algorithms is one too many (§8.5) |
| `services/zeit/` is split into `lesen/` and `schreiben/` | 06-AGENTEN §1.2's "no write path under `services/zeit/`" is a lint rule only if the write path has a path. A flat folder makes it a review convention, which is what it was (§8, §23) |
| `personal.ts` is a seventh schema file | The eleven tables hanging off `anstellung_id` / `person_id` are exactly K-04's ceiling registry; splitting them across `kern.ts` and `zeit.ts` puts the D-09 boundary in three files (§4.9) |
| `arbeitszeit_verstoss` gets its own bucket rather than a bucket-1 exception comment | K-06 forbids an INSERT policy for `cse_app`; a blanket bucket-1 assertion tests the opposite of the convention, and the cheapest way to green it is to add the forbidden path (§5.1) |

### 25.3 New questions this document raises — to be added to `DECISIONS.md` § Open

The wording below is the wording to use, and **every row carries an O-number** — an unnumbered
question is one `lint:todo` cannot match to a `DECISIONS.md` row, which is the whole mechanism
of L6. O-01 and O-04 … O-13 are in `DECISIONS.md`; O-14 … O-29 were assigned by `08-PR-PLAN.md`.
This document owns **O-30, O-31, O-32, O-134 and O-135**; its five other questions turned out to be
questions a sibling already asks, and each now **cites that number instead of minting a second one**
— O-104 (§13b evidence), O-98 (CPV lists), O-82 (`auth-sms-anbieter`), O-118
(`int-betriebsueberwachung`) and O-80 (`auth-sperrschwellen`). **O-39 is not this document's**: an
earlier draft used it for the AUT-07 rate-limit threshold, but `02-datenmodell/04-PLANUNG-ZEIT.md`
§1.3 holds O-39 for `zeit-freigabeschritt` — whether a release step exists between worked time and
billing at all.
Two questions under one number is precisely the state `lint:todo` cannot resolve, since it
matches a `TODO(client) O-nn` marker to exactly one `DECISIONS.md` row, so the AUT-07 question
moves to **O-80** and O-39 stays with the document that raised it first.

| Question | Blocks | File carrying the `TODO(client)` |
|---|---|---|
| **O-30** — Nachträge: how many days may an announced Nachtrag (`angemeldet_am`) remain unsubmitted (`eingereicht_am`) before the watchdog escalates, and to whom? BAU-04 separates the two dates but names no window; the default ships configurable per mandant and is an operational setting the client owns, not a VOB deadline. | BAU-04, Phase 6 | `jobs/watchdogs/nachtrag-nicht-eingereicht.ts` + `einstellungen/mandant` |
| **O-31** — Certificates: at what intervals before expiry should a §34a / Sachkunde warning escalate, and to whom at each step? SEC-02 requires tracking with expiry and SEC-04 hard-blocks at the shift date; the *warning cadence* before that block is operational and unstated. | SEC-02, SEC-04, Phase 5 | `jobs/watchdogs/nachweis-ablauf.ts` + `einstellungen/mandant` |
| **O-17** — Belagsarten: which Leistungswerte, from which source, approved by whom? The catalogue ships **empty** per mandant; costing blocks rather than defaults. | OPS-03, OPS-07, Phase 4 | `db/seed/05-kataloge.ts`, `services/ops/belagsart.ts` |
| **O-80** — AUT-07: how many attempts per identifier and per IP, over what window, and how long is the lockout? SPEC states only "rate limiting and lockout"; the question is owned by `03-AUTH-BERECHTIGUNGEN.md` §10 and referenced here because `headers.spec.ts` asserts against it (§2). Renumbered from O-39, which `04-PLANUNG-ZEIT.md` holds for `zeit-freigabeschritt`. | AUT-07, Phase 1 | `03-AUTH-BERECHTIGUNGEN.md` §10, `src/server/config/env.ts` |
| **O-19** — Dunning: **how many days overdue starts a run**, how many Mahnstufen at what interval, what Mahngebühr per level, and which interest basis (§288 BGB: 9 points over Basiszinssatz for B2B, plus the €40 Verzugspauschale)? The trigger delay belongs here because it is the parameter that decides when a letter leaves the building. | FIN-15, Phase 6 | `services/finanz/mahnung/stufen.platzhalter.ts` |
| **O-14** — Lead SLA: what response deadline per business area and per channel, and who is the escalation target when it passes? | REQ-05, REQ-06, Phase 2 | `services/crm/lead-sla/fristen.platzhalter.ts` |
| **O-18** — Leave entitlement: BUrlG minimum, contractual or sector agreement — and the pro-rata rule for part-year employment and the carry-over expiry date? | EMP-05, Phase 5 | `services/zeit/urlaub/anspruch.platzhalter.ts` |
| **O-18** — Arbeitszeitkonto: which target-hours basis, what overtime cap, may a negative balance be carried, when does a balance expire — and which **ArbZG Ausgleichszeitraum** applies to the §3 ten-hour exception? The 8h limit, the 10h ceiling and the 11h rest are statute and are code; the compensation window is an employer choice the detector needs before it can clear a 10h day. | EMP-04, EMP-15, Phase 5 | `services/zeit/stundenkonto/regeln.platzhalter.ts` |
| **O-16** — Costing: what Gemeinkostenzuschlag, risk margin and profit markup per business area? | OPS-07, AGT-02, Phase 4 | `services/ops/kalkulation/zuschlaege.platzhalter.ts` |
| **O-15** — Tender scoring: which weights, and at what score does RAD-08 notify? | RAD-05, RAD-08, Phase 8 | `services/radar/bewertung/gewichte.platzhalter.ts` |
| **O-98** — CPV codes: please confirm the cleaning, security and construction code lists against the official CPV list before the radar goes live. | RAD-04, Phase 8 | `services/radar/bewertung/cpv.platzhalter.ts` |
| **O-15** — Lead scoring: which criteria and weights produce the lead score? | CRM-02, Phase 4 | `services/crm/lead-score/gewichte.platzhalter.ts` |
| **O-25** — Retention: what retention period per document category (personnel file, application documents, Wachbuch entries, Dienstanweisung acknowledgements, key receipts) beyond the GoBD ten years and the MiLoG two? | DOC-07, LEG-01, Phase 7 | `services/storage/retention/fristen.platzhalter.ts` |
| **O-25** — Applicant data: how long are application documents kept after a rejection (the AGG §15(4) two-month claim window is the usual anchor)? | REC-07, LEG-11, Phase 9 | `services/recruiting/purge/fristen.platzhalter.ts` |
| **O-21** — §48 EStG: which Bagatellgrenzen apply, at which date (Leistungsdatum per FIN-10 or Zahlungszeitpunkt per the statute), and which of the group's customers count as Leistungsempfänger obliged to withhold? | FIN-10, LEG-06, Phase 6 | `services/finanz/estg48/grenzen.platzhalter.ts` |
| **O-104** — §13b UStG: how is a customer's status as nachhaltig bauleistungserbringender Unternehmer evidenced (USt-1-TG certificate?), where is that evidence recorded, and does its absence block finalisation? | FIN-09, LEG-06, Phase 6 | `services/finanz/steuer/nachweis.platzhalter.ts` |
| **O-20** — Abschlagszahlungen: which VOB/B §16 terms apply, and what Sicherheits-/Gewährleistungseinbehalt percentage and release date per project? | FIN-08, Phase 6 | `services/finanz/abschlag/bedingungen.platzhalter.ts` |
| **O-134** — Number circles: one per legal entity, or one per entity **and** document type (Rechnung, Gutschrift, Storno)? **No invoice may be finalised in any environment until this is answered** — the structure cannot be changed after the first finalised invoice. | FIN-03, TEN-02, LEG-01, Phase 6 | `services/finanz/nummernkreis.ts` |
| **O-32** — Sector minimum wage: which MiLoG/sector rates apply per business area, and from which date? | LEG-02, TIM-13, Phase 5 | `services/zeit/milog/saetze.platzhalter.ts` |
| **O-82** — SMS: which provider sends worker login codes (EMP-01), in which region, under which DPA? Until answered, worker login is „nicht verbunden" in production and the check-in link is the only worker path. | EMP-01, LEG-09, Phase 5 | `integrations/sms/nicht-verbunden.ts` |
| **O-135** — OCR: which processor extracts data from incoming invoices (ACC-05), in which region, under which DPA? | ACC-05, LEG-09, Phase 7 | `integrations/openai/` or its replacement, plus a `DECISIONS.md` sub-processor entry |
| **O-118** — Monitoring: which uptime and error-tracking service, in which region, under which DPA? | SPEC §21, LEG-09, Phase 10 | `integrations/monitoring/nicht-verbunden.ts` |

The **nummernkreis** row carries an operational guard as well as a question:
`finalize` refuses to run unless a `nummernkreis` row exists for the document type being
finalised, so the default cannot be exercised silently while the question is open.

---

## 26. Cross-document obligations

Names fixed here are binding on the sibling Phase 0 documents. Where one of them needs a
different name or shape, this document is amended first.

| Obligation | Owner document |
|---|---|
| **K-02's GUC table gains `app.akteur_typ`, `app.akteur_id` and `app.ip` as audit-only rows**, with the rule that no policy may reference them (§4.2). Until it does, this document and the binding convention publish different versions of the same table, and by §0 this document is the defective one | `00-KONVENTIONEN.md` |
| The five-bucket table classification (§5) and its file `src/server/db/rls.ts` | `02-datenmodell/**` must classify every table it defines, including which K-18 policy and which K-04 ceiling it carries |
| `nummernkreis` carries `letzter_wert` **and** `letzter_hash` (§8.2) | `02-datenmodell/05-FINANZEN.md` |
| `rechnung_versand`, `rechnung_beziehung` exist and `rechnung` carries no `versendet_am` (K-12) | `02-datenmodell/05-FINANZEN.md` |
| `freigabe`, `freigabe_kette`, `freigabe_snapshot`, `freigabe_ansicht` (K-13) and `pruefdauer_sek` derived server-side | `02-datenmodell/06-RADAR-KI-INHALT.md`, `05-API-KARTE.md`, `06-AGENTEN-FREIGABEN.md` |
| `zeit_intern.arbeitszeit_fenster` in a schema not exposed by PostgREST (K-06) | `02-datenmodell/04-PLANUNG-ZEIT.md` |
| `benutzer_mandant.aus_anstellung` (K-14); `mandant_modul` (TEN-08); `mandant.identitaets_hue` and `mandant.logo_pfad` (§24) | `02-datenmodell/01-KERN.md` |
| `kunde_zugang` exists, is tenant-scoped, and is the sole source of `app.aktueller_kunde()` / `app.aktuelle_kunden()` (§4.4, §4.6) | `02-datenmodell/01-KERN.md`, `03-AUTH-BERECHTIGUNGEN.md` |
| `audit_log.mandant_id` is **nullable** with `ebene enum('plattform','mandant')` and `CHECK ((ebene = 'mandant') = (mandant_id IS NOT NULL))` — K-16(d), the only such table (§4.9, §5.1) | `02-datenmodell/01-KERN.md` |
| `wissens_chunk` is `PARTITION BY LIST (mandant_id)` with `PRIMARY KEY (mandant_id, id)` — K-16(a), the only composite PK (§4.9, §9.3) | `02-datenmodell/06-RADAR-KI-INHALT.md` |
| Micro-cents are `bigint` and exist on exactly the **five** agent-ledger tables of §9.4 — `agent_schritt`, `agent_kosten`, `agent_reservierung`, `agent_budget` (`verbrauch_mikrocent`, `reserviert_mikrocent`), `agent_preisliste` — converted once, half-up, at the budget boundary. The cap is `agent_budget.budget_cent`; there is no stored `verbrauch_cent` and no `uebertrag_mikrocent` (K-16(b), K-21) | `02-datenmodell/06-RADAR-KI-INHALT.md`, `06-AGENTEN-FREIGABEN.md` |
| `revier.sollzeit_minuten` is `numeric(8,2)` as a **computed target**; every measured duration is `integer` — K-16(c) (§4.10) | `02-datenmodell/03-GEWERKE.md`, `02-datenmodell/04-PLANUNG-ZEIT.md` |
| `einsatz` carries `beginn_zeitpunkt` / `ende_zeitpunkt`, **and so does `einsatz_zuordnung`** — the assignment's own window, defaulted from the shift by trigger, because a guard may cover 22:00–02:00 of a 22:00–06:00 post (§6.1) | `02-datenmodell/04-PLANUNG-ZEIT.md` |
| `feiertag` is a global, tenant-free reference table, computed by **`src/lib/datum/feiertage-berlin.ts`** and seeded through `db/seed/fixtures/feiertage-berlin.ts`, which persists and computes nothing (§5.3, §8.5). This document owns the placement and adopts the path the three consuming documents already use; `05-API-KARTE.md`'s `feiertage.service.ts` is the one spelling left to correct | `02-datenmodell/04-PLANUNG-ZEIT.md`, `02-datenmodell/03-GEWERKE.md`, `07-INTEGRATIONEN.md`, `05-API-KARTE.md` |
| The schema file map of §4.9, including `personal.ts` and the `reklamation` / `qualitaetspruefung` placement | `02-datenmodell/**` |
| Common columns are `erstellt_am` / `erstellt_von` / `geaendert_am` / `geaendert_von` (K-16, §21) — not `created_at` | `02-datenmodell/**` |
| `audit_log` records the actor and the origin of every write (SEC-A9) using **its owner's column names** — `akteur_art` (`mensch` \| `agent` \| `system`), `akteur_benutzer_id` / `akteur_agent_id` / `akteur_dienst`, `objekt_typ` / `objekt_id`, `erstellt_am`, `ip`. It declares **no** `mandant_id_alt` / `mandant_id_neu`: the TEN-09 switch pair travels in `vorher` / `nachher` under `aktion = 'sitzung.mandant_gewechselt'` (§12.2). The three matching session GUCs are for the audit trigger only and are referenced by no policy (§4.2) | `02-datenmodell/01-KERN.md`, `03-AUTH-BERECHTIGUNGEN.md` |
| The **seven** session helpers and their GUC matrix (§4.3); `app.scope` has the four K-18 values; `withSystemTenant` requires a reason and runs `SET LOCAL ROLE cse_app` | `03-AUTH-BERECHTIGUNGEN.md` |
| The **five**-entry K-08 register — `app.sitzung_aufloesen`, `app.versuch_protokollieren`, `app.checkin_verbrauchen`, `app.offline_ereignis_annehmen`, `app.ical_feed_lesen` — and `app.sitzung_aufloesen` returning the membership set (§12.1) | `03-AUTH-BERECHTIGUNGEN.md`, `05-API-KARTE.md` |
| `switchMandant` order of operations, the membership assertion against `ctx.sichtbareMandanten`, and the two mirror audit rows (§12.2) | `03-AUTH-BERECHTIGUNGEN.md` |
| Permission strings follow `<modul>.<aktion>` and `gruppe.<modul>.lesen` (K-03); the employee and customer portals hold **no** `gruppe.*` right (K-18, §3.11) | `03-AUTH-BERECHTIGUNGEN.md` |
| `queries/mandant.switcherZaehler(ctx)` runs under `withGroupScope` and requires **`gruppe.bericht.lesen`** per mandant (TEN-10, §7). There is no module `dashboard`; the earlier spelling `gruppe.dashboard.lesen` is withdrawn from this document (K-19) | `03-AUTH-BERECHTIGUNGEN.md`, `04-SEITENKARTE.md` |
| `/portal` URL namespace, the **five** reserved slugs of K-21 (`gruppe`, `mein`, `kunde`, `konto`, `api`) on the column **`mandant.slug`**, module gating by `mandant_modul` (§3.1) | `04-SEITENKARTE.md` |
| `GET /api/freigaben/[id]` writes the view row (K-13); the download routes of §3.13 exist; `api/ical/[token]` and the TIM-09 replay run on K-08 register functions | `05-API-KARTE.md` |
| Tools take handles or register tokens, never numbers (K-10); `policy-invariants.ts` outranks `agent_richtlinie` (§9.2); the orchestrator sets `akteurTyp = 'agent'` and `akteurId` = the run id (§9) | `06-AGENTEN-FREIGABEN.md` |
| The four-file integration shape, `platform/` vs `integrations/`, and the sub-processor rule (§11) | `07-INTEGRATIONEN.md` |
| **K-19 — one permission catalogue.** Every right key this document writes is spelled as that catalogue spells it, and the catalogue must contain a row for each: `personal.lesen`, `personal.schreiben`, `personal.entgelt_lesen`, `gruppe.personal.lesen`, `gruppe.bericht.lesen`, `dienstplan.arbzg_pruefen` (module `dienstplan`, per K-06's verbatim key). The action vocabulary must contain `lesen`, `schreiben`, `loeschen`, `pruefen`, `freigeben`, `exportieren` and `verwalten` — without `schreiben` no `WITH CHECK` in §4.5 can authorise anything. `db.yml` runs the extraction test either way (§17) | `03-AUTH-BERECHTIGUNGEN.md` |
| **K-21 — this document declares no table.** §4.9 places tables in Drizzle files and nothing more. `job_lauf` (no `mandant_id`), `job_lauf_mandant`, `mandant_einstellung`, `nachweis_art`, `sicherheitsvorfall` and `loeschprotokoll` are declared by `01-KERN.md`; `steuersatz_gruppe` and `rechnung_beziehung` by `05-FINANZEN.md`; `agent_artefakt` by `06-RADAR-KI-INHALT.md`. Each needs columns, types, indexes, RLS and its SPEC IDs in its owner, because six documents reference them today and none declares them | `02-datenmodell/01-KERN.md`, `02-datenmodell/05-FINANZEN.md`, `02-datenmodell/06-RADAR-KI-INHALT.md` |
| The `t_job` policy class and the `rls.ts.job` bucket (§4.5, §5). The name is **`t_job`**, not `j_job`; `03-AUTH-BERECHTIGUNGEN.md` §8.5 registers it as the fifth permissive class for Class T, and the two data-model documents that enumerate job-reachable tables use that one spelling | `03-AUTH-BERECHTIGUNGEN.md`, `02-datenmodell/02-CRM-OPERATIONS.md`, `02-datenmodell/06-RADAR-KI-INHALT.md` |
| **K-20 — every `app.*` accessor states its value in all four scopes** (§4.4). `app.aktueller_kunde()` / `app.aktuelle_kunden()` resolve from the session's `kunde_zugang` binding and never through `aktiver_mandant()`; `app.portal` is bound at scope entry and defined in all four. Every `t_kunde` policy and every `p_kunde_ceiling` uses the array form | `00-KONVENTIONEN.md`, `03-AUTH-BERECHTIGUNGEN.md`, `02-datenmodell/**` |
| A not-connected port **returns** a typed `IntegrationResult`; `NotConnectedError` is thrown only by `index.ts` on an unparseable live config (§11.2). The HTTP surface must be **one** pair — today `05-API-KARTE.md` maps it to 409 `kanal_nicht_verbunden` and `03-AUTH-BERECHTIGUNGEN.md` to 503 `NICHT_VERBUNDEN`; the error-code table owns the decision and the route map follows it | `07-INTEGRATIONEN.md`, `03-AUTH-BERECHTIGUNGEN.md`, `05-API-KARTE.md` |
| The integration folder is `src/server/integrations/` (English) with one folder per §5 port, including `kernel/`, `e-rechnung/`, `lv/`, `feiertage/`, `geo/`, `steuer/`, `backup/`, `n8n/` and `mail/{versand,postfach}/` (§11.2). `integrationen/` and `integrationen/ki/` appear nowhere | `07-INTEGRATIONEN.md`, `05-API-KARTE.md` |
| `integration.ts` is the ninth Drizzle schema file and holds the nine tables `07-INTEGRATIONEN.md` owns (§4.9) | `07-INTEGRATIONEN.md` |
| `src/server/agent/` contains `handles.ts`, `plan.ts`, `umschlag.ts`, `redaktion.ts`, `wiedergabe.ts`, `logging.ts` (**not** `protokoll.ts`), `modell/client.ts` and `rag/` **as a directory** with `chunk.ts · embed.ts · retrieve.ts · ausschluss.ts · kanarienvogel.ts`; `src/server/db/tabellen-klassen.ts` holds the R-17 table classes; `services/zeit/` is split into `lesen/` and `schreiben/`; `services/frist/` exists (§8, §9, §19) | `06-AGENTEN-FREIGABEN.md`, `05-API-KARTE.md` |
| The DESIGN.md token amendments of §24 land before the first component PR (D-10) | `docs/DESIGN.md` |
| **Met** — the open questions of §25.3 are rows of the one register under § Open. This document owns O-30, O-31, O-32, O-134 and O-135; O-14 … O-29 come from `08-PR-PLAN.md`, O-39 belongs to `02-datenmodell/04-PLANUNG-ZEIT.md`, O-01 / O-04 … O-13 are the client's, and the register names the owner of every other number. Every `TODO(client)` in the tree carries its number inline, and `lint:todo` fails on one that does not | `docs/DECISIONS.md` |

---

## 27. Coverage

Every SPEC group has a physical home. This table is the checklist a reviewer runs against a PR
that claims to implement a feature.

| SPEC group | Route | Service / query | Schema | Test |
|---|---|---|---|---|
| TEN-01..TEN-10 | `portal/**`, `einstellungen/mandant` | `kern/mandant.ts`, `auth/switch-mandant.ts`, `queries/mandant.switcherZaehler` (TEN-10) | `kern.ts` | `isolation/**`, `reservierte-slugs`, `switch.spec`, `switcher-zaehler`, `e2e/portal/switcher` |
| AUT-01..AUT-08, SEC-A1, SEC-A5 | `(auth)/**`, `einstellungen/{benutzer,rollen,berechtigungen}` | `auth/**` | `kern.ts` | `aal2-gate`, `lockout.spec`, `headers.spec` |
| PUB-01..PUB-14, PRO-01..PRO-05, REQ-01..REQ-07 | `(public)/**`, `api/formular` | `inhalt/**`, `crm/lead*` | `crm-ops.ts`, `radar-ki-inhalt.ts` | `e2e/public/**`, `a11y/public` |
| DSH-01..DSH-05 | `portal/[mandant]/page.tsx`, `portal/gruppe`, `portal/kunde` (K-18 `kunde` scope) | `queries/dashboard.ts`, `queries/kunde.ts` | — | `e2e/portal/dashboard`, `isolation/db/kunde-scope` |
| CRM-01..CRM-08 | `crm/**` | `crm/**` | `crm-ops.ts` | beside each service |
| RAD-01..RAD-09 | `radar/**` | `radar/**`, `jobs/ingest/**` | `radar-ki-inhalt.ts` | beside each service |
| OPS-01..OPS-11 | `objekte/**`, `angebote/**`, `auftraege/**` | `ops/**` | `crm-ops.ts` | `e2e/portal/raumbuch-import`, `angebot` |
| CLN-01..CLN-05 | `reinigung/**` | `gewerke/reinigung/**`, `lib/datum/feiertage-berlin.ts` (§8.5) | `gewerke.ts`, `zeit.ts` (`feiertag`) | `lib/datum/feiertage-berlin.test`, `leistungsnachweis.test` |
| SEC-01..SEC-08 | `security/**` | `gewerke/security/**` | `gewerke.ts` | `sachkunde.test` (hard block) |
| BAU-01..BAU-08 | `bau/**` | `gewerke/bau/**` | `gewerke.ts` | `rechenansatz.test` |
| TIM-01..TIM-14 | `dienstplan/**`, `zeiten/**`, `check-in/**` | `zeit/{lesen,schreiben}/**`, `arbzg/**`, `frist/**` | `zeit.ts`, `zeit-intern.ts` | `dauer.test` (five cases), `arbzg`, `checkin` |
| EMP-01..EMP-15 | `portal/mein/**` (K-18 `person` scope), `(auth)/mitarbeiter` | `zeit/**`, `kern/anstellung.ts`, `queries/mein.ts` | `personal.ts`, `zeit.ts`, `kern.ts` | `isolation/db/person-scope`, `portal-ceiling`, `e2e/mitarbeiter/**` |
| FIN-01..FIN-18 | `finanzen/**`, `api/rechnung/**` | `finanz/**` | `finanz.ts` | `rechnung.concurrency`, `nummernkreis`, `immutability` |
| ACC-01..ACC-12 | `buchhaltung/**`, `api/export/**` | `buchhaltung/**` | `finanz.ts` | `compliance/datev` |
| DOC-01..DOC-08 | `dokumente/**`, `api/dokument/**` | `kern/dokument.ts`, `platform/storage/**` | `kern.ts` | `no-hard-delete`, upload MIME tests |
| CAL-01..CAL-03, NOT-01..NOT-03 | `kalender`, `einstellungen/benachrichtigungen`, `api/ical` | `kern/{kalender,benachrichtigung}.ts` | `kern.ts` | beside each service |
| SOC-01..SOC-08 | `social/**` | `inhalt/**`, `agent/policy.ts` | `radar-ki-inhalt.ts` | `policy.test` |
| REC-01..REC-09 | `recruiting/**`, `(public)/karriere/**`, `api/bewerbung` | `recruiting/**` | `radar-ki-inhalt.ts` | `purge`, `matching` |
| AGT-01..AGT-07, APR-01..APR-08 | `agenten/**`, `freigaben/**`, `api/agent/stream`, `api/freigaben/[id]` | `agent/**` | `radar-ki-inhalt.ts` | `policy.test`, `agent-keine-zahlen`, `rag` |
| REP-01..REP-07 | `berichte/**`, `portal/gruppe/**`, `api/export/csv` | `berichte/**`, `gruppe/aggregat.ts` | — | `gruppe-readonly` |
| LEG-01..LEG-12 | `rechtliches/**`, `einstellungen/datenschutz`, `api/export/dsgvo` | `kern/dsgvo.ts`, `finanz/**`, `arbzg/**`, `crm/rechtsgrundlage.ts` | all | `gobd`, `arbzg`, `no-hard-delete` |
| SEC-A1..SEC-A10 | — | `auth/**`, `platform/storage/**` | — | `isolation.yml`, `security.yml`, `runbooks/restore-test.md` |
| SPEC §21 (monitoring, jobs, integration status) | `einstellungen/{protokoll,integrationen}`, `api/cron/[job]` | `jobs/**`, `integrations/{kernel,monitoring}/**` | `kern.ts` (`job_lauf`, `job_lauf_mandant`), `integration.ts` | `job-rolle`, `policy-anzahl` (the `t_job` bucket), `job-ausfall` |

Anything not in this table does not exist yet. Adding it starts with a PR against this
document.
