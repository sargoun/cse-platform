# Decisions

Two sections: **Decided** (with reasoning — do not silently reverse) and
**Open** (must be answered by the client — never guessed).

Claude Code: append here whenever you assume something.

---

## Decided

### D-01 · Removed: cold outreach to scraped contacts

The client spec listed an AI Sales Agent that finds companies and sends them
personalised messages. **Removed.**

German **§7 UWG** treats unsolicited electronic advertising without prior
express consent as an unreasonable nuisance — and unlike some jurisdictions,
this applies to **B2B** as well. Exposure: cease-and-desist letters
(Abmahnung), costs, injunctions. Building contact lists by scraping adds a
DSGVO problem on top.

**Replaced by** a lead engine with the same business outcome and no legal risk:
inbound website forms, the tender radar, referrals, and manual CRM entry.
Outbound messaging still exists, but only to contacts carrying a recorded
`rechtsgrundlage` (CRM-08): consent, existing customer, or an enquiry they sent.

If the client wants outbound to cold contacts, that is a decision for their
lawyer, not for this codebase.

### D-02 · Removed: scraping job boards

Automated extraction from Indeed, StepStone and similar violates their terms of
service and creates DSGVO exposure over candidate data. Recruiting works on
**inbound** applications. Posting to a board happens only through a real API
with real credentials.

### D-03 · Eight agents consolidated to four

CEO Assistant · Acquisition · Back-office · Finance. The client's Operations,
Analytics, Social and Support agents were the same machinery under different
labels. Four agents with clear tool sets are easier to reason about, permission
and audit than eight overlapping ones.

### D-04 · Stack accepted, EU regions mandatory

Supabase, Vercel and OpenAI accepted as specified. Every service pinned to an
**EU region** with a signed DPA, because the platform holds employee time
records, absence data and financial records for German legal entities.

Note the tension worth raising with the client: earlier documentation promised
*"Server, Daten und Programmcode liegen bei Ihnen"* on a German server. A
managed US-headquartered cloud is a different arrangement — legal with EU
regions and DPAs, but not the same promise. **Confirm which one they want.**

### D-05 · Compliance is not a phase

GoBD, MiLoG, ArbZG, §34a, §14 UStG and BFSG are built into the phases that
touch them, not deferred. An invoice module without §14 UStG validation cannot
issue a legal invoice; a scheduling module without §34a enforcement can produce
an unlawful assignment.

### D-06 · Not built: payroll, annual accounts, tax filing

Three sector wage agreements plus SOKA-Bau make payroll a specialist system.
Jahresabschluss and E-Bilanz belong to the tax advisor. The platform prepares,
exports and hands over.

### D-07 · Procurement submission stays manual

German procurement platforms deliberately expose no submission API; accounts
are tied to natural persons and some require electronic signature. The agent
prepares the complete bid folder; a human uploads it.

This is not a limitation to apologise for. Procurement law is formalistic —
a missing document or wrong form means exclusion without review. The agent's
value is guaranteeing completeness before a human presses send.

### D-09 · `person` is split from employment — CONFIRMED BY CLIENT

**The client has confirmed that the same individual works for more than one of
the four entities.** A guard covering cleaning shifts is normal here.

Therefore an employee is not one row. The model is:

```
person                     the human — identity, contact, language
  id, vorname, nachname, geburtsdatum, telefon, sprache

anstellung             M   one employment per entity
  person_id, mandant_id, personalnummer, eintritt, austritt,
  arbeitszeitmodell, wochenstunden, stundensatz_intern
```

**Foreign keys — get these right the first time:**

| Attaches to `anstellung_id` | Attaches to `person_id` |
|---|---|
| `einsatz` | `nachweis` (certificates) |
| `zeiteintrag` | `bewacher_eintrag` |
| `stundenkonto` | `mitarbeiter_zugang` (login) |
| `urlaubskonto` | |
| `abwesenheit` | |

Rule: **anything costed or invoiced hangs off the employment** (it belongs to
one entity and one rate). **Anything true of the human hangs off the person.**

A §34a certificate belongs to the human, not to a job. Storing it per
employment produces one valid and one expired copy of the same certificate —
and a scheduler that passes its own check while assigning an unqualified guard.

**Consequences that must be implemented, not just noted:**

1. **ArbZG limits aggregate across all employments of one person.**
   6h cleaning + 5h security = 11h — a breach. Checking each employment
   separately hides it. The conflict detector queries by `person_id`.
2. **Rest-period check (11h) spans entities**, including a shift that ends in
   one entity and starts in another the next morning.
3. `stundenkonto` stays **per employment** — different rates and agreements —
   while the employee portal shows a combined view.
4. One login per person; the portal shows shifts from all employments, each
   labelled with its entity.
5. Time never crosses invoice circles: every entry hangs off exactly one
   employment, which belongs to exactly one mandant.
6. RLS: `person` rows are visible to any mandant the person has an employment
   with. `anstellung` and everything below it stay strictly tenant-scoped.
   **A manager in cleaning must not see security wage rates.**

### D-10 · Design system is a document, not a habit

`docs/DESIGN.md` is authoritative: colours, type scale, spacing, components,
motion, the switcher, responsive and accessibility rules. Derived from the
client's mockups.

Two decisions worth stating, because they were not in the mockups:

**Identity hues per area.** The mockups use CSE red across all four brands.
That works for marketing and fails inside the portal: a user working in three
entities cannot tell at a glance which one they are in — and that is exactly
how an invoice lands in the wrong GmbH. So red remains the group action colour,
and each area gets an identity hue used only for the switcher ring, the top
bar, the area badge and chart series. Never for buttons.

**Photography must be real.** The mockups use AI-generated people. Shipping
those as "our team" on a site selling physical trust fails the moment anyone
looks closely. Placeholders are marked as such in code and must be replaced
before launch. The group has genuine references worth photographing.

### D-11 · SSE Security confirmed as a separate brand

The client's mockups show **SSE Security**, not "CSE Security" — matching
*Select-Security Event GmbH* from the original documentation. It has its own
logo and identity. O-02 is answered: separate entity, own tax number, own
invoice circle.

### D-08 · Money, time and tenancy invariants

See `CLAUDE.md`. Integer cents; `TIMESTAMPTZ` in UTC; RLS everywhere;
draft → finalized one-way with numbers assigned at finalization; server clock
authoritative; the AI never computes a number.

---

## Decided in Phase 0 (architecture) — `docs/architecture/`

The nine documents of Phase 0 record their reasoning in full; the entries below are
the decisions a later change would otherwise reverse by accident, each one costly
to rediscover. `docs/architecture/00-KONVENTIONEN.md` is the binding form of all of
them and wins over any domain document.

### D-12 · The ArbZG check crosses entity boundaries through exactly one door (K-06)

Invariant 9 and D-09 require working-time limits to aggregate **per human, across
entities**. Strict tenant RLS makes that impossible, and it fails *silently*: the
check returns "no conflict" and a 6 h + 5 h day is scheduled as lawful.

One sanctioned crossing exists and no other: `app.arbzg_belastung(...)`, a
`SECURITY DEFINER` function over `zeit_intern.arbeitszeit_fenster` — a schema
PostgREST does not expose — which returns **durations and interval boundaries and
nothing else**. Never the other entity's name, `objekt`, `kunde` or wage rate. Every
call is audit-logged, and an isolation test asserts that nothing identifying leaks.
The window row is keyed on `person_id`; resolving person → `anstellung` →
`einsatz_zuordnung` inside the function instead cannot reach an actual-time window
projected from a `zeiteintrag`, so it under-counts worked time — the same silent
failure one layer down.

### D-13 · Wage confidentiality is a column grant, not a masking view (K-05)

D-09 rule 6 says a manager in cleaning must not see security wage rates. The first
draft used a view that did `select a.*` and then added a masked copy of the rate
beside it. Both repairs fail: `security_invoker` needs privileges that were just
revoked, and without it the view runs as an owner that ignores the tenant predicate.

So `anstellung.stundensatz_intern` is **revoked at column level** from the
application role and read through a `SECURITY DEFINER` accessor that re-checks the
right. The same construction protects `agent_schritt.eingabe`/`ausgabe`,
`agent_artefakt.inhalt` and `freigabe_snapshot.pruefdauer_sek`.

### D-14 · Four read scopes, and every accessor resolves in all four (K-18, K-20)

The employee portal and the customer portal span tenants **as a subject**, not as a
manager. Routing them through group scope means the group policy demands a
`gruppe.*` right they never hold, and both portals read zero rows; widening that
right hands every cleaner a group-level read.

The scopes are `mandant · gruppe · person · kunde`. Group scope is read-only
(invariant 10) and is entered only with an `intern` membership plus a
`gruppe.<modul>.lesen` right. Every `app.*` accessor states its value in all four
scopes; one that is undefined — or defined but not usable — in a scope may not be
named by any policy reachable from it.

### D-15 · The portal lives under `/portal` (K-07)

Without the prefix, `/reinigung` is simultaneously a public marketing page and a
tenant dashboard, and one of the two silently wins: either every tenant switch lands
a manager on a marketing page, or the four short marketing URLs 404. There is no
configuration in which both work. The prefix also shrinks the reserved-slug problem
to five values — `gruppe`, `mein`, `kunde`, `konto`, `api` — held as **one list**, with
a CI test that walks the App Router tree and fails on a new static segment that is
not in the constraint.

### D-16 · The AI supplies no number, and no input that determines one (K-10)

Invariant 6 says the AI never computes money, quantities or deadlines. Phase 0
tightens it: a model may not supply an **argument that decides a number** either.
Choosing the surcharge profile is choosing the margin, which is setting a price; a
free date string decides a billing period. Tool arguments are handles and register
tokens, never amounts, rates or formulas, and every figure comes from a tested
function in `src/server/services/`.

### D-17 · An unregistered right key is permanent, silent denial (K-19)

`app.hat_recht()` returns **false** for a key it does not know — no exception, no log
line, only a screen that is always empty. So the permission catalogue is closed and
owned by one document, and CI checks it in three directions: no code may name a key
absent from the catalogue, no catalogue key may go unused, and **no catalogue key may
be unwritable** — its module must be one of the 47 and its action one of the 42. The
third check exists because 25 keys once used actions the enum did not have; the first
two compare code against the catalogue and back, so a key wrong in both places passes
both.

### D-18 · The DST reference cases, with the values verified

The transition **night begins the evening before** the transition day. A drafted plan
named `2026-03-29` and `2026-10-25` and asserted 420 and 540 minutes against shifts
that are ordinarily 480. Correct:

| Case | Interval (Berlin) | Duration |
|---|---|---|
| Ordinary night | `22:00 → 06:00` | **480 min** |
| Spring forward | `2026-03-28 22:00 → 03-29 06:00` | **420 min** |
| Fall back | `2026-10-24 22:00 → 10-25 06:00` | **540 min** |
| Control: a shift starting 22:00 **on** a transition day | | **480 min** |

The control is asserted so an off-by-one fixture cannot pass. These are the first
tests of the first code PR, before any table and any UI.

---

## Decided in Phase 1 (implementation)

### D-19 · A solid danger surface uses `--danger-strong`, and every text token passes AA

The axe run over the whole design system found two failures, and both lived in
`docs/DESIGN.md` rather than in the code implementing it:

| Pair | Was | Required |
|---|---|---|
| White on `--danger` `#EF4444` (danger button) | 3.76:1 | 4.5:1 |
| `--text-subtle` `#71717A` on `--surface` | 3.93:1 | 4.5:1 |

Both were corrected in DESIGN.md **first**, then mirrored into the code, because
CLAUDE.md makes DESIGN.md the source and not the record of what was built.

1. **`--danger-strong: #DC2626` is a new token, not a replacement.** `--danger`
   must stay light: it is read *as text* on `--danger-soft` and on the dark
   surfaces. The danger *button* is the inverse case — white on a solid fill.
   One token cannot satisfy both, so a solid danger surface takes
   `--danger-strong` (4.83:1 under white) and everything else keeps `--danger`.

2. **`--text-subtle` moved `#71717A` → `#8B8B95`** (5.63:1 on `--surface`,
   5.93 on `--ink`, 4.86 on `--surface-3`). The old value carried the reasoning
   that it is "for `xs` meta only". That does not survive WCAG: 11px and 13px
   meta is still text, and AA grants no small-text exemption — only a *large*-text
   one at 18.66px bold or 24px. The three-level hierarchy survives the change;
   `--text-subtle` is now confined to meta, timestamps and placeholders by
   **role**, not by being hard to read.

BFSG applies to this platform, so a token that cannot meet AA is a defect and
not a deliberate step. `tests/design/tokens.test.ts` now asserts all three text
tokens pass on all three surfaces, and asserts the hierarchy still descends.

### D-20 · `/dev/**` is a 404 in production, not merely a `robots.txt` line

`/dev/kitchensink` renders every component, token and placeholder the platform is
built from. `robots.txt` asks crawlers not to index it; it does not stop anyone
typing the URL, and the page is unauthenticated by design so it can be
axe-tested. The gate is therefore in the page: `src/lib/dev-flaechen.ts` decides
at build time, and the route calls `notFound()` when the answer is no.

- `pnpm dev` → on, so the design system stays reviewable while working
- a production build → **off**, unless `CSE_DEV_FLAECHEN=1` is set deliberately
- the Playwright suite sets that flag, because it must test the real production
  build rather than a development render with its overlays

Verified against a production build with no flag: `/dev/kitchensink` answers 404
while `/healthz` answers 200. Both the flag logic and the `robots.txt` rule are
tested — the two are belt and braces, not alternatives.

### D-21 · Invariant 8 covers `TRUNCATE`, not only `DELETE`

The `BEFORE DELETE` trigger of K-16 is a **row** trigger. `TRUNCATE` empties a
table without producing rows, fires no row trigger, and is therefore a hard
delete of everything that walks straight past the protection written to stop
one. Every delete-locked table carries a second, statement-level
`BEFORE TRUNCATE` trigger on the same function.

Two consequences worth stating rather than discovering:

- A `BEFORE DELETE` trigger has nothing to fire on in an **empty** table, so
  `DELETE FROM audit_log` there succeeds having deleted nothing. That is not a
  hole, but it does mean the acceptance test has to write a row first — a test
  against an empty table would have passed with no trigger at all.
- The test harness can no longer reset by emptying tables. It uses
  `session_replication_role = replica`, which is superuser-only (no application
  role can reach it) and explicit. It must be set with `SET LOCAL` inside one
  transaction: on a pooled connection a plain `SET` and its `RESET` can land on
  two different connections and leave one in replica mode for the rest of the
  run, at which point triggers silently stop firing on whichever queries happen
  to pick it. That is how this was found — as a missing audit row and a
  `geaendert_am` the caller was allowed to keep.

### D-22 · The audit payload is restricted by column grant, exactly as the wage rate is

`0004` granted `SELECT` on `audit_log` table-wide. Until PR 4 that leaked
nothing, because no trigger wrote a payload. From PR 4 on, `vorher`/`nachher`
carry the changed values themselves — including `stundensatz_intern`, the one
column K-05 spends an explicit column-list grant on `anstellung` to withhold.
A table-wide grant on `audit_log` hands the same number back one statement
later, and every K-05 test still passes while it does.

`05-API-KARTE.md` §B settles the direction: **sensitive values are restricted,
not omitted** — omitting them makes a wage-rate change unreconstructable, which
is the opposite of what SEC-A9 and a wage dispute need. So the values are
written and the *read* is gated:

- `cse_app` holds an explicit column-list `SELECT` on `audit_log` that omits
  `vorher` and `nachher`. `geaendert_felder` stays granted: *that* a rate
  changed is not the secret.
- `app.audit_nutzlast_lesen(bigint)` returns the payload behind
  `system.audit_sensitiv_lesen`, re-checking the tenant because a definer is
  not subject to the policy.
- The same Postgres fact as K-05 applies and is why this is a grant and not a
  revoke: a table-wide `GRANT SELECT` followed by `REVOKE SELECT (spalte)`
  changes nothing at all.

### D-23 · `app.hat_recht` exists now and answers `false` to everything

The rights catalogue lands with PR 6, but two accessors need the gate before
then. `app.hat_recht(text)` is created in `0005` returning `false` for every
key. That is not a stub standing in for the real answer — it **is** the answer
D-17 requires: an unregistered right key is permanent, silent denial. A version
returning `true` while the catalogue is missing would leave every accessor
behind it open, and the day the catalogue arrived would be the day the platform
quietly narrowed. Failing closed makes the missing catalogue visible as an
empty screen instead.

---

## Carried over from the Phase 0 review — not client questions

Three items the review surfaced that are ours to do, recorded here so they are not
lost between phases:

1. **`docs/DESIGN.md` needs two additions before any Dienstplan screen renders.**
   Both are ours, not the client's, and CLAUDE.md's order is DESIGN.md first, then use:
   - an **absence colour palette**. `01-KERN.md` §6.22 `CHECK`s
     `abwesenheitsart.farbe_token` to the five semantic tokens of DESIGN §1
     (`success · warning · danger · info · neutral`), which cannot distinguish leave from
     sickness from training; the `// TODO(design)` marker sits at `01-KERN.md` §6.22, not
     in DESIGN.md itself.
   - the **status-pill labels** of `04-PLANUNG-ZEIT.md` §3.6. DESIGN §5 fixes five pill
     classes and their German labels; most of the Dienstplan's values have no label there,
     and that section is both the mapping and the change request.
2. **`app.mandant_kennzahlen()`** is defined in `01-KERN.md` §6.3 as counts-only over
   `app.switcher_mandanten()`, and is silent on whether the counts respect the caller's
   per-module rights — a `leitung` with no `finanzen` module would still see a finance
   counter in the switcher. Settle it before the switcher ships (TEN-10).

The third item recorded here in an earlier pass — that `02-CRM-OPERATIONS.md` must add
`dokument.sichtbar_fuer_mitarbeiter` — was **wrong and is withdrawn**. The column is
declared at `02-CRM-OPERATIONS.md` §4.7 (`boolean not null default false`) and is already
the subject predicate of that document's `t_person` policy and of the form-C worker
ceiling of `03-AUTH-BERECHTIGUNGEN.md` §8.5. It was carried forward from the review notes
without being checked against the file.

---

## Open — ask, do not guess

**This table is the register. A number is assigned here and nowhere else.**

`docs/architecture/**` carries every one of these as a `// TODO(client)` at its point
of use with its `O-nn` inline, so `pnpm lint:todo` can match a marker to a row. A
marker with no row, or a row no marker uses, fails the build.

The register was rebuilt by extracting every `O-nn` occurrence from the thirteen
architecture documents and resolving each to the **question** it names rather than to
the number. That is what found the collisions: six documents had each minted a local
`O-30 … O-4x` block beside the coordinated chain, so `O-33` alone carried six
different questions and the client would have answered a number whose answer landed
on the wrong feature. Fourteen questions turned out to be duplicates and were folded
into the number that already asks them. `docs/architecture/_review/o-nummern.md`
records the derivation. `O-02` and `O-03` are answered — see **D-11** and **D-09**.

### The client's own questions

| # | Question | Blocks |
|---|---|---|
| O-01 | Is **CSE Operations** a GmbH or a department? | invoice circle, Phase 1 |
| O-04 | The exact five billing types, and their rules — rounding, minimum unit, night and Sunday surcharges, call-off versus monthly flat | Phase 6 |
| O-05 | DATEV: Beraternummer, Mandantennummer per entity, SKR03/04, Sachkontenlänge, Steuerschlüssel, fiscal year start — **plus a real sample EXTF export** | Phase 7 |
| O-06 | Is there a **Betriebsrat**? §87 Abs. 1 Nr. 6 BetrVG governs geolocation, check-in audit trails, the APR-08 review-duration measurement and login metadata | geolocation capture, LEG-10 |
| O-07 | Which procurement platforms is the group registered on, under which identifier? | RAD-09 |
| O-08 | Separate domains per area, or one group domain? | Phase 2 |
| O-09 | Data volumes: objects, rooms, contracts, employees | migration planning |
| O-10 | Which social and job-board accounts exist, and who owns them? | Phase 9 |
| O-11 | Hosting promise: managed EU cloud, or self-hosted German server? | D-04 |
| O-12 | **Exact CSE red** from the official logo; SVG logos for all four brands | DESIGN §1 |
| O-13 | **Real photography** — crews, sites, completed projects, with releases | DESIGN §4, launch blocker |

### Raised by the PR plan · `08-PR-PLAN.md`

| # | Question | PRs |
|---|---|---|
| O-14 | Lead SLA: response deadline per area and channel, and the escalation target when it passes | 17, 82 |
| O-15 | Lead-scoring criteria and weights; tender-scoring weights and the RAD-08 notification threshold | 21, 70, 71 |
| O-16 | Gemeinkosten-, Wagnis- and Gewinnzuschlag per area; hourly charge-out rates per trade | 25 |
| O-17 | Leistungswerte per Belagsart — source, and who approves them | 23, 25 |
| O-18 | Arbeitszeitmodelle and their SV categories, Sollstunden basis, leave entitlement, overtime cap and expiry; the ArbZG 10-hour exception and its balancing period | 1, 32, 37, 38, 39, 67 |
| O-19 | Dunning: days overdue that start a run, number of levels and intervals, fee per level, interest basis (§288 BGB), and when Verzug begins | 55 |
| O-20 | Abschlagszahlungen: which VOB/B §16 terms apply; Sicherheits-/Gewährleistungseinbehalt percentage, release date, and replacement by a Bürgschaft | 50 |
| O-21 | §48 EStG: which Bagatellgrenze, at which date (Leistungsdatum or payment), and which customers count as Leistungsempfänger | 51 |
| O-22 | Leitweg-IDs per public client and the required transmission route (OZG-RE / ZRE / Landesportal / Peppol / e-mail) | 52 |
| O-23 | The §2 VOB/B basis list; VOB/C deduction and Übermessung rules per trade — automatic or manual | 43, 44 |
| O-24 | Handelsregister data, USt-IdNr. and bank details per entity | 26, 47 |
| O-25 | Retention period and legal basis per document category, beyond the GoBD ten years; and how long applicant documents are kept after a rejection | 9, 85 |
| O-26 | Monthly AI budget per entity and per agent | 74 |
| O-27 | Payroll export target system and format, per entity | 67 |
| O-28 | Which application mailbox is monitored, and who owns it | 85 |
| O-29 | Reklamation and Qualitätsprüfung: trigger, scale, pass threshold, and consequence | 40 |

### Raised by the architecture · one block per document

**`01-ORDNERSTRUKTUR.md`**

| # | Question | Where it bites |
|---|---|---|
| O-30 | Nachträge: how many days may an announced Nachtrag stay unsubmitted before the watchdog escalates, and to whom? | BAU-04 watchdog |
| O-31 | Certificates: at what intervals before a §34a / Sachkunde expiry does the warning escalate, and to whom at each step? | SEC-02, SEC-04 |
| O-32 | Sector minimum wage: which MiLoG / sector rates apply per area, and from which date? | LEG-02, TIM-13 |
| O-134 | `nummernkreis`: one circle per legal entity, or per entity **and** document type? Does the number run on or restart on 1 January, and what is the exact mask? | FIN-03, TEN-02, LEG-01 — **no invoice may be finalised anywhere until this is answered** |
| O-135 | Which processor extracts data from incoming invoices (OCR), in which region, under which DPA? | ACC-05, LEG-09, D-04 |

**`02-datenmodell/01-KERN.md`**

| # | Question | Where it bites |
|---|---|---|
| O-136 | Which sector wage agreement applies per entity (Gebäudereinigung RTV, Sicherheitsgewerbe Berlin, Bau), and is it tracked in the platform at all? | `anstellung.tarifvertrag` |
| O-137 | May one person hold two concurrent employments with the **same** entity — a main contract plus a marginal one? | `anstellung` uniqueness |
| O-138 | Are sick days during approved leave credited back to the Urlaubskonto automatically (§9 BUrlG), or only on presentation of the AU certificate? | `abwesenheit`, `urlaubskonto` |
| O-139 | Paid/unpaid status per absence type, the proof-required-from-day-N rule, and the payroll wage-type mapping for every `abwesenheitsart` and `bewegung_art` | ACC-12 export |
| O-140 | Is the §34a Unterrichtung/Sachkunde unbefristet, and what triggers a re-check — only the reliability-check interval? | the SEC-02 watchdog has nothing to warn on until this is answered |
| O-141 | Does the entity that first recorded a person keep read access once the person works exclusively for another entity, or does the anchor lapse? | `app.person_sichtbar()` |
| O-142 | Which further request types does the group run — unpaid leave, time off in lieu, shift handover, master-data change? | `antragsart` |
| O-143 | Is there a provisional state between open and locked on the Stundenkonto, and may a Zeit-Einwand be partially upheld? | both placeholder enum values |
| O-144 | Confirm the categories used for certificate reporting | `qualifikation_kategorie` |

**`02-datenmodell/02-CRM-OPERATIONS.md`**

| # | Question |
|---|---|
| O-53 | May one order carry positions billed in different ways at the same time? |
| O-54 | How is the service period derived per billing type — calendar month, per Leistungsnachweis, per Aufmaß? |
| O-55 | Which cleaning classes are used (DIN 77400, own scheme, per customer), and do they drive frequency, price or quality? |
| O-56 | How is a Turnus converted into a frequency factor? |
| O-57 | Is subcontracted work a cost type of its own beside the five of OPS-07? |
| O-58 | Must a Kalkulation exist before every offer is sent, or may catalogue and small orders go out without one? |
| O-59 | Time values and list prices per service — confirm or supply |
| O-60 | Do intra-Community supplies (§4 Nr. 1b UStG) or the §19 UStG small-business rule occur in any entity? |
| O-61 | Which fields does the offer-request form need for CSE Operations to be able to quote at all? |
| O-62 | Value lists for `gebaeudetyp`, `frequenz` and `gewerk` |
| O-63 | Is the privacy notice confirmed as a notice (Art. 6(1)(b)/(f)) or as consent? |
| O-64 | Does the lead score trigger any automatic decision (Art. 22 DSGVO)? |
| O-65 | Which communication counts as contractually necessary rather than advertising (§7 UWG)? |
| O-66 | Standard payment term per entity, and does it also apply to public clients? |
| O-67 | Is the §48b certificate held per customer, per order or per subcontractor — who records it, who checks it? |
| O-68 | Which warranty period is agreed — VOB/B §13 or BGB §634a — and from which event does it run? Does it vary per order? |
| O-69 | Controlled vocabulary for `gebaeudetyp`, or does it stay free text? |
| O-70 | A building served for two customers of the same entity: one `objekt` or two? |
| O-71 | Erasure concept (Art. 17): which personal data is anonymised, on which trigger? |
| O-72 | Are there projects without an order — internal or acquisition projects? |
| O-73 | Confirm the working vocabularies: `lead_status`, `lead_prioritaet`, `angebot_status`, `angebotsposition_typ`, `auftrag_art` and the rest |

**`02-datenmodell/03-GEWERKE.md`**

| # | Question |
|---|---|
| O-145 | A Turnus missed on a public holiday: brought forward, made up, or dropped? |
| O-146 | Is a missed Turnus credited against a monthly flat, and at what amount? |
| O-147 | Are Leistungsnachweise numbered gaplessly and sequentially, and from which step is the number assigned? |
| O-148 | Which Postenarten and which Schlüsselarten are kept? |
| O-149 | Which qualification is required for guard duties with no fixed post — events, floaters, short-notice cover? |
| O-150 | May a started night shift be finished when the §34a certificate expires at midnight? |
| O-151 | Which Wachbuch entries may the following shift see for the handover, and for what period? |
| O-152 | Does any client contract require presence proof per patrol, and in what form (NFC, QR, barcode)? |
| O-153 | Must a new version of a Dienstanweisung be re-acknowledged by everyone, or only on a material change — and who decides that? |
| O-154 | Do BGB construction contracts occur, or VOB/B only — and how does the site manager tell which regime applies? |
| O-155 | Which LV position types occur, and how does each enter the order total? |
| O-156 | Under what conditions is a one-sided Aufmaß billed (§14 Abs. 2 VOB/B)? |
| O-157 | Is a Bautagebuch kept per site or per construction section? |
| O-158 | From what threshold does weather count as work-impeding, per trade? |
| O-159 | Which trades are recorded in the Bautagebuch (STLB-Bau Leistungsbereiche)? |
| O-160 | Which table records material consumption, so FIN-07 gets its fourth source? |
| O-161 | Does recovering a key close the liability case once the lock change has been ordered? |

**`02-datenmodell/04-PLANUNG-ZEIT.md`**

| # | Slug | Question |
|---|---|---|
| O-39 | `zeit-freigabeschritt` | Is there a professional release of recorded time before the Stundenkonto and billing at all, and who grants it? **Until answered, `zeit.abrechnung_freigeben` is not seeded and the screen does not ship.** |
| O-93 | `zeit-checkin-kanal` | How does the check-in link reach the worker — SMS, e-mail, a QR code posted at the object, or a portal link — and who bears the SMS cost? |
| O-162 | `zeit-milog-aufbewahrungsbeginn` | When does the two-year retention of §17 Abs. 1 MiLoG start — the day worked, the day the record was created, or a month/year end? |
| O-163 | `zeit-dst-verguetung` | How are the two transition nights paid — by time actually worked (7 h / 9 h) or by planned shift length? |
| O-164 | `zeit-checkout-toleranz` | How long after the shift ends does the check-out link stay valid, and what happens when someone works substantially longer than planned? |
| O-165 | `zeit-nacherfassungsfrist` | Which internal deadline applies to late entry, below the statutory seven days (§17 Abs. 1 MiLoG), and who is notified when it passes? |
| O-166 | `zeit-konflikt-blockiert` | Which conflicts prevent saving and which only warn — overlap, ArbZG, qualification? |
| O-167 | `zeit-feiertage-bundesland` | Are shift posts and event duties staffed normally on public holidays, and does the group work at objects outside Berlin — in which Länder? Which source supplies the holiday list? |
| O-168 | `zeit-pausenerfassung` | Are breaks stamped (start/end) or entered as a per-shift total? |
| O-169 | `zeit-ohne-auftragsbezug` | Is there time without an order behind it — internal work, training, standby, travel — and how is it costed? |
| O-170 | `zeit-schichtfunktionen` | Which functions exist on a shift (Objektleiter, Vorarbeiter, Springer), and which states does an assignment need? |
| O-171 | `zeit-sonntagsarbeit` | Should the platform evidence Sunday and holiday work under §§9–13 ArbZG — the exemption per area and the substitute rest day? |
| O-172 | `zeit-betriebsrat-erweiterung` | **Extends O-06:** does §87 Abs. 1 Nr. 6 BetrVG cover device deviation, device fingerprint, no-show evaluation and correction statistics as well as geolocation? |
| O-173 | `zeit-korrekturgruende` | Which correction reasons should the evaluation distinguish? |

**`02-datenmodell/05-FINANZEN.md`**

| # | Question |
|---|---|
| O-174 | Confirm the mapping of your units of measure to the UN/ECE Rec 20 codes (BT-130) — `Stk` (H87 or C62), `pauschal` (LS), `Einsatz` |
| O-175 | Should §33 UStDV small-amount invoices be issued at all? Many commercial customers reject them |
| O-176 | §48 Abs. 2 EStG: which Bagatellgrenze per entity, how is the annual sum per supplier forecast, and who releases the withholding? |
| O-177 | Is Skonto granted, at what rate and term, and from what difference does an underpayment count as a Skonto deduction? |
| O-178 | Is a partial Storno admissible, or is every correction a full Storno with re-issue? |
| O-179 | May one time entry be split across two invoices (a month boundary inside a night shift), or does the shift's start period govern? |
| O-180 | Is material taken from stock and on-charged, or bought per order only? |
| O-181 | Who may release a collection handover or a Mahnbescheid, and from which level or amount? |
| O-182 | May a customer credit be set off against a liability to the same company as a supplier (§387 BGB), and who authorises it? |
| O-183 | Is a four-eyes release required for incoming invoices, from what amount, and who deputises? |
| O-184 | Does the construction entity self-bill subcontractors by Gutschrift (§14 Abs. 2 UStG) — generally or per contract? |
| O-185 | Are there expenses that may be booked without a receipt (Eigenbeleg), and up to what amount? |
| O-186 | Is an electronic register with TSE (§146a AO) used, or an open cash box with a Kassenbuch? |
| O-187 | Who files the §48a EStG Bauabzugsteuer return — accounting or the tax adviser — and should the platform only prepare, or also keep the deadline calendar? |
| O-188 | Who signs the Verfahrensdokumentation per entity, and at what interval is it reviewed? |
| O-189 | Will any of the three entities ever invoice, or receive invoices, in a currency other than EUR? |
| O-190 | Is the counter-signed Leistungsnachweis (CLN-04) kept as evidence behind a cleaning invoice line, in addition to the time entries? |

**`02-datenmodell/06-RADAR-KI-INHALT.md`**

| # | Question |
|---|---|
| O-191 | Does a negative keyword or an excluding CPV drop the notice, or only cost it points? From what residual deadline is a notice not workable? |
| O-192 | By which features do a national and a TED notice count as the same procurement, and from what match may they be merged automatically? |
| O-193 | Are lots evaluated and bid individually, or always the whole notice? |
| O-194 | Catalogue of the documents required, per platform and procedure type |
| O-195 | From what share of the monthly budget should a warning fire; in which currency is the agent budget kept; and which source supplies the rate when the provider bills in USD? |
| O-196 | How many tool steps may an agent take per task before it stops and hands the case to a human? |
| O-197 | Below what confidence does an extracted field count as uncertain and force individual review? |
| O-198 | How long may an agent run's model inputs and outputs be kept, outside the GoBD-relevant finance area, before redaction? |
| O-199 | Which applicant details are collected — address, date of birth, nationality, driving licence — and which are necessary for the advertised work (Art. 5 DSGVO)? |
| O-200 | Binding status stages of the application process, employment types, and the status stages of a vacancy |
| O-201 | How are job requirements weighted against each other, on what scale? |
| O-202 | Which notifications go out by e-mail as well, by default? |
| O-203 | From what amount and what effect does a case count as *hoch*? The three risk levels depend on it |

**`03-AUTH-BERECHTIGUNGEN.md`**

| # | Slug | Question |
|---|---|---|
| O-74 | `auth-kunde-schreibrechte` | May a customer write in the portal at all — accept an offer with legal effect (OPS-09), report a Reklamation, send a message, upload a document? **Every customer write route is withheld until answered.** |
| O-75 | `auth-entgelt-leitung` | May a Leitung read the internal hourly cost rates of their own area, or is that reserved to Geschäftsführung and Buchhaltung? |
| O-76 | `auth-leitung-freigaben` | Which approvals and administrative acts may a Leitung or an Admin hold — releasing an incoming invoice, approving a booking, closing a period? |
| O-77 | `auth-storno-berechtigung` | Who may issue a Storno? Invariant 4 fixes the mechanism and says nothing about the authority |
| O-78 | `auth-wachbuch-kundensicht` | May a Wachbuch or Bautagebuch entry ever be shown to a customer? |
| O-79 | `auth-sitzungsdauer` | Session lifetimes per portal — idle and absolute — and the device-loss revocation process for worker phones |
| O-80 | `auth-sperrschwellen` | AUT-07: attempts per identity and per IP, the window, the lockout duration, automatic expiry or manual unlock, and whether the user is told |
| O-81 | `auth-missbrauchsschutz` | Anti-abuse on the public login and OTP endpoints without a third-party CAPTCHA (PUB-13) |
| O-82 | `auth-sms-anbieter` | Which EU-hosted SMS gateway delivers the OTP and the check-in link (DPA, D-04), and what monthly spend cap triggers a hard stop? |
| O-83 | `auth-2fa-wiederherstellung` | 2FA recovery: how many super_admin accounts, who holds each second factor, and what is the break-glass procedure? |
| O-84 | `auth-2fa-uebergangsfrist` | Grace period for 2FA enrolment on existing admin accounts, and what happens on expiry |
| O-85 | `auth-rollen-delegation` | Are roles beyond the five required, and may an Admin appoint another Admin, a Leitung a deputy? |
| O-86 | `auth-mobilnummer-vieraugen` | Should a second approver be required to re-bind a worker's mobile number? |
| O-87 | `auth-austritt-login` | On `austritt`, is the worker login disabled at once or kept for N days so the person can download their Stundennachweise (EMP-06)? |
| O-88 | `auth-doppelrolle-login` | Confirm the dual-role login path for someone who is both a manager and employed |
| O-89 | `auth-nachweis-gegenzeichnung` | Does the customer portal need a counter-signature flow for the Leistungsnachweis (CLN-04)? |
| O-90 | `auth-zweitfaktor-festschreibung` | Should finalisation, Storno or DATEV export require a second factor at the moment of the act? |
| O-91 | `auth-entwurf-kundensicht` | Do customers see finalised invoices only, or may a draft ever be visible? |
| O-92 | `auth-aufbewahrung-telemetrie` | Retention **and legal basis per data class**: auth events, the `audit_log` deletion concept, `anmeldeversuch` (30 days proposed), `sicherheitsvorfall`, and the `job_lauf` operations log |

**`04-SEITENKARTE.md`**

| # | Question |
|---|---|
| O-33 | Does CSE Operations sell to external customers at all? |
| O-34 | Legal review of the outbound matrix: which message classes may be sent on `anfrage`, on `bestandskunde` and on `einwilligung`; the exact §7 Abs. 3 Nr. 4 UWG opt-out wording |
| O-35 | Which mailbox receives security reports, and who monitors it? |
| O-36 | Which EU-hosted transactional e-mail sender delivers invitations, resets, offers, dunning and NOT-02 mail, under which DPA? |
| O-37 | Which wage basis applies per area and per activity — Gebäudereiniger tariff groups, Bau-Mindestlohn, the security agreement — and from which dates? |
| O-38 | One group career page with an area filter, or one per area? |
| O-40 | The Bewacherregister: exact Bewacher-ID format and check digit, the fields it requires, its status vocabulary, its notification events, and the binding list of §34a activity types |
| O-41 | In which format do Leistungsverzeichnisse arrive — GAEB DA XML (X83/X84), GAEB D8x, Excel, PDF? |
| O-42 | May an ArbZG conflict card name the other entity, given §87 BetrVG and data minimisation? |
| O-43 | When two entities employ one person, does one own certificate maintenance and the worker login, or may every employing entity edit them? |
| O-44 | Dunning presentation: how many levels, at what day offsets, with what fee and interest basis (§288 BGB)? |
| O-45 | Does the tax audit expect Z1 or Z2 access as well as Z3? |
| O-46 | Retention period and legal basis per data class where SPEC states none: planning data, shift media, check-in tokens, offline claims, discarded import rows, unused form submissions |
| O-47 | Which FX source and date apply to a foreign-currency tender value? |
| O-48 | Which FX source and date convert the provider's USD model billing into the EUR budget of AGT-05? |
| O-49 | Confirm that CSE Operations owns the group-level public pages |
| O-50 | Does a collective agreement impose break or rest rules stricter than the ArbZG for any trade, and from when? |
| O-51 | Must the EMP-06 monthly statement be issued in the employee's language, or is German the required form for a §17 MiLoG record? |
| O-52 | Does a company buying from two entities get one login with an entity filter, or one login per entity? |
| O-132 | `seiten-geo-anbieter` — which EU-hosted map tile and geocoding provider, under which DPA? |

**`05-API-KARTE.md`**

| # | Question |
|---|---|
| O-94 | Is a newsletter wanted at all? It needs a documented double opt-in and `rechtsgrundlage = 'einwilligung'` — no endpoint exists until then |
| O-95 | Were `bestandskunde` addresses obtained in a sale, and what counts as a "similar own service" (§7 Abs. 3 UWG)? |
| O-96 | May a customer accept an offer, counter-sign a Leistungsnachweis or open a complaint in the portal? |
| O-97 | Which LV exchange format do your clients send — GAEB DA XML 3.2, GAEB D83/D84, or Excel? |
| O-98 | Confirm the cleaning, security and construction CPV code lists against the official CPV list |
| O-99 | Unit-price precision below one cent — cleaning is routinely quoted in fractions of a cent per m² |
| O-100 | Which night-hours window and which surcharge apply per business area? |
| O-101 | For a 22:00–06:00 shift, are the hours attributed to the day the shift starts or split across both calendar days? |
| O-102 | Does any area apply the §5 Abs. 2 reduction of the rest period to 10 hours? |
| O-103 | §6 ArbZG night work with its own balancing period, and §9/§11 Sunday and holiday work |
| O-104 | Which §13b Abs. 2 categories does the group supply and receive, and how is a customer's status as a nachhaltig bauleistungserbringender Unternehmer evidenced (USt 1 TG)? |

**`06-AGENTEN-FREIGABEN.md`**

| # | Question |
|---|---|
| O-105 | Should an appointment confirmation to a customer be drafted automatically for approval, or only the internal calendar entry with no message? |
| O-106 | Which role or right must approve an offer above €20,000 — Geschäftsführung, Bereichsleitung, or both under four eyes? |
| O-107 | Which suitability and personnel certificates do the procurement bodies demand, and which certificate types does the group keep internally? |
| O-108 | How long should the objection window (APR-05) and the undo window (APR-06) be, per case type? |
| O-109 | Up to what absolute and relative deviation from the comparison document does a position count as routine and may be approved in a batch? |
| O-110 | May photographs of work sites — downscaled, faces obscured — be sent to an EU image endpoint, or does `motiv_plausibel` stay off permanently? |
| O-111 | From what median review duration, what approval rate and over how many decisions does a pattern count as rubber-stamping; from what open queue per role and what daily volume of new approvals should a warning fire; and who is told? |
| O-112 | How many working days of internal lead time does a Vergabemappe need before the official deadline? |
| O-113 | How is an Art. 15 / Art. 17 DSGVO request applied to agent protocols, knowledge chunks and approval snapshots when GoBD / §147 AO require retention? |
| O-114 | Does the tariff or surcharge group belong to the *identity* of an invoice line, or is it an attribute of the same line? |
| O-115 | Which sender mailboxes and which signature apply per entity for outgoing agent drafts? |
| O-133 | How many photographs, and of what, are mandatory per evidence type — Leistungsnachweis (CLN-04), Wachbuch entry (SEC-07), Bautagebuch (BAU-07), receipt (ACC-05), reference (PRO-05) — and from when does evidence count as incomplete? |
| O-204 | **Which of AGT-02's nine tools writes the REC-05 `shortlist` artefact?** No document of the set settles it. The ranking itself is deterministic code (`kandidat_bewertung.verfahren` is `CHECK`ed to `'deterministisch'`), so whatever writes the artefact renders a computed result and supplies no number of its own (K-10) — but the writer has no home in the tool surface today |

**`07-INTEGRATIONEN.md`**

| # | Slug | Question |
|---|---|---|
| O-116 | `int-mail-versanddienst` | Which EU-hosted e-mail service sends transactional messages, and which verified sender domain and address apply per entity? |
| O-117 | `int-postfach-loeschrecht` | Who triages an application sent to none of the four addresses, and may the platform delete messages from the mailbox after intake? |
| O-118 | `int-betriebsueberwachung` | Which error-tracking, uptime-monitoring and log-forwarding services are approved (EU region, DPA), or should self-hosted alternatives be run? |
| O-119 | `int-sicherungsziel` | Where do the independent encrypted backups live, what retention applies, who holds the private key, and who supplies it for the monthly restore test? |
| O-120 | `int-camt-bezugsweg` | How do CAMT.053 files reach the platform — upload or SFTP — which banks, and which IBAN per entity? |
| O-121 | `int-ki-eu-ersatz` | When no model with EU processing and zero retention is offered for a needed capability: leave it switched off, or add an alternative EU-hosted provider to the stack? |
| O-122 | `int-geokodierung` | Should an object's address be resolved to coordinates automatically, and with which EU-hosted or self-run service? |
| O-123 | `int-n8n-betrieb` | Is n8n self-hosted (where, by whom) or run as an EU cloud instance, is there a DPA, and which external tools should be connected? |
| O-124 | `int-belegtransfer` | How should receipts reach the tax adviser — DATEV Unternehmen online / Belegtransfer, or a ZIP beside the EXTF file? |
| O-125 | `int-systemnachricht-vorabfreigabe` | System messages go out over a mechanism separate from the agent path — confirm the wording and the pre-approval |
| O-126 | `int-aufrufprotokoll-aufbewahrung` | How long may the integrations' call logs be kept before automatic deletion? |
| O-127 | `int-anhang-schadsoftware` | Should incoming attachments be scanned for malware, and with which EU-hosted service? |
| O-128 | `int-altsystem-export` | In which format can Aplano, Lexware and the existing Excel files be exported, which period is migrated, and must the historical data be archived GoBD-compliant? |
| O-129 | `int-datev-periodensperre` | Does a completed DATEV export lock the period against new bookings, or do late entries go into the next open period? |
| O-130 | `int-48b-bescheinigung` | Does each entity hold a valid §48b EStG exemption certificate, for what term, and who renews it? |
| O-131 | `int-kundenpostfach` | Should incoming customer correspondence be taken into the history automatically, from a mailbox per entity, or does capture stay manual? |

---

O-02 has been answered — see **D-11**. O-03 has been answered — see **D-09**; the
`person` / `anstellung` split is confirmed and must be in the schema from the first
migration.
