# Phase 0 — architecture

The thirteen documents below are the whole of Phase 0. They describe what will be built
and how it fits together. **No application code exists yet, and that is deliberate:**
Phase 0 stops here and waits for the client's review, because several of its answers
change the schema of the first migration.

If you read one thing, read `00-KONVENTIONEN.md`. If you read two, read `08-PR-PLAN.md`
after it.

---

## The set

| # | Document | Lines | What it settles |
|---|---|---|---|
| 00 | [`00-KONVENTIONEN.md`](00-KONVENTIONEN.md) | 748 | **K-01 … K-21 — binding, and they win over every other document.** Roles and FORCE RLS, session state, the tenant policy, portal ceilings, the one ArbZG crossing, the `/portal` prefix, the sessionless-function register, money and time forms, the canonical invoice payload, table ownership and canonical names |
| 01 | [`01-ORDNERSTRUKTUR.md`](01-ORDNERSTRUKTUR.md) | 3 511 | Every directory and file, what may import what, and where the import boundaries are enforced rather than agreed |
| 02a | [`02-datenmodell/01-KERN.md`](02-datenmodell/01-KERN.md) | 4 437 | Tenants, people, employments, roles and rights, sessions, audit, settings, jobs. **`person` and `anstellung` are separate from the first migration (D-09)** |
| 02b | [`02-datenmodell/02-CRM-OPERATIONS.md`](02-datenmodell/02-CRM-OPERATIONS.md) | 2 486 | Leads, customers, offers, calculation, orders, objects, rooms, documents |
| 02c | [`02-datenmodell/03-GEWERKE.md`](02-datenmodell/03-GEWERKE.md) | 2 551 | The three trades: cleaning rounds and quality, guarding and the Wachbuch, construction with Aufmaß, Nachträge and the Bautagebuch |
| 02d | [`02-datenmodell/04-PLANUNG-ZEIT.md`](02-datenmodell/04-PLANUNG-ZEIT.md) | 2 170 | Scheduling, assignments, tokenised check-in, time entries, the hours account, and the ArbZG findings |
| 02e | [`02-datenmodell/05-FINANZEN.md`](02-datenmodell/05-FINANZEN.md) | 3 739 | Invoices and their hash chain, VAT, §13b and §48, dunning, incoming invoices, payments, bookkeeping and the DATEV export |
| 02f | [`02-datenmodell/06-RADAR-KI-INHALT.md`](02-datenmodell/06-RADAR-KI-INHALT.md) | 4 023 | The tender radar, the agent tables and their cost ledger, approvals and their snapshots, website content, and recruiting |
| 03 | [`03-AUTH-BERECHTIGUNGEN.md`](03-AUTH-BERECHTIGUNGEN.md) | 3 128 | **The one permission catalogue** — modules, actions, every right key — plus the principal taxonomy, the four scopes, session helpers and the isolation suite |
| 04 | [`04-SEITENKARTE.md`](04-SEITENKARTE.md) | 2 866 | Every page, its right, its scope and its phase — public, auth, the four portals and the group view |
| 05 | [`05-API-KARTE.md`](05-API-KARTE.md) | 2 123 | Every route handler, the wire forms for money, quantities and time, the service contracts, and the test matrix |
| 06 | [`06-AGENTEN-FREIGABEN.md`](06-AGENTEN-FREIGABEN.md) | 3 263 | The four agents, the nine tools, the policy gate, and the approval chain — **nothing leaves the system without a human decision** |
| 07 | [`07-INTEGRATIONEN.md`](07-INTEGRATIONEN.md) | 2 215 | Every external system as a port, each with its "not connected" state. No integration simulates success |
| 08 | [`08-PR-PLAN.md`](08-PR-PLAN.md) | 971 | **96 PRs in dependency order**, each with its scope and its acceptance criteria. PR 1 is money and time tests with no table, no route and no React |
| 09 | [`09-ABDECKUNG.md`](09-ABDECKUNG.md) | 427 | The traceability matrix: all 232 SPEC feature IDs → documents → PR |
| — | [`HANDOVER.md`](HANDOVER.md) | 288 | The resume point, the decisions that cost the most to find, and the standing conditions before any code |
| — | [`_review/`](_review/) | — | The raw evidence: twelve adversarial critiques, twelve verification reports, the cross-document check, and the derivation of the O-number register. **Keep until Phase 0 is signed off** |

Outside this directory: [`../SPEC.md`](../SPEC.md) is what to build,
[`../DESIGN.md`](../DESIGN.md) how it must look, [`../ROADMAP.md`](../ROADMAP.md) in what
order, and [`../DECISIONS.md`](../DECISIONS.md) what was decided and what is still open.

---

## Reading order for a reviewer

**If you have an hour** — enough to judge whether the architecture is sound:

1. `00-KONVENTIONEN.md` in full. It is the shortest document and the binding one; the
   other twelve are applications of it.
2. `08-PR-PLAN.md` PR 0 … PR 10. That is the order the platform actually gets built in,
   and the acceptance criteria show what "done" means here.
3. `09-ABDECKUNG.md`'s summary table, to see that nothing in SPEC was quietly dropped.
4. `HANDOVER.md` §"Do not lose these decisions" — the five that cost the most to find.

**If you are reviewing a domain**, read in this order and stop where your interest ends:

| You care about | Read |
|---|---|
| Tenancy, people, employments, rights | `00` → `02a` → `03` |
| Money, invoices, VAT, bookkeeping | `00` → `02b` → `02e` → `05` §C.14/§D.6 |
| Scheduling, time, ArbZG, MiLoG | `00` (K-06, K-11) → `02d` → `05` §C.10/§D.4/§E |
| The trades themselves | `02b` → `02c` |
| The AI and what it may do | `00` (K-10) → `06` → `02f` §3–§4 |
| What a user sees | `04` → `05` |
| External systems | `07` |

**If you are about to write code**, read `01-ORDNERSTRUKTUR.md` and
`08-PR-PLAN.md` and nothing else until PR 1 is green.

---

## Four things to know before reading anything

**Identifiers are German where the law is German.** `mandant`, `anstellung`, `objekt`,
`einsatz`, `zeiteintrag`, `rechnung`, `aufmass`, `nachtrag`, `dienstplan`, `wachbuch`,
`ausschreibung` — these carry meaning under VOB, GoBD, UStG and GewO that a translation
loses. Infrastructure stays English: `createInvoice`, `withTenant`, `hashChain`.

**Where a document and `00-KONVENTIONEN.md` disagree, the convention wins** — except
where a convention explicitly defers to a domain owner, which it does in two places and
says so at both.

**Each table is declared exactly once (K-21).** If two documents describe one table, one
of them is a back-reference. That rule was added after a table was found declared twice
with two different column sets under one name.

**Nothing undecided has been guessed.** Where the specification is genuinely open — the
five billing types, the DATEV mapping, tariff rates, the works-council question — the
architecture ships an interface, a visibly marked placeholder, a `// TODO(client)` with
its number, and a row in `../DECISIONS.md`. There are **202** such rows. That is not
indecision; a plausible value invented for a legal or financial rule is the expensive
kind of mistake, because nothing about it looks wrong later.

---

## How these documents were built

Draft → adversarial review → rewrite → independent verification → cross-document check →
harmonisation. Roughly eighty agent passes. The evidence is in `_review/`:

- **233 blocking findings** raised by the reviewers, each confirmed fixed by a verifier
  that read the file rather than the author's claim. Six author rejections were judged
  sound.
- **156 second-order defects** and 36 convention departures found by the verifiers.
- **89 cross-document contradictions** and 85 dangling references found by the
  cross-check, resolved onto the document that owns each fact.

The pattern worth naming, because it recurs: almost every serious defect found here was
a **silent** one. A permission key nobody registered, an accessor that returns NULL in
the scope that needs it, a working-time check that cannot see the other entity's hours.
None of them raises an error. All of them produce a plausible, empty, wrong screen.
