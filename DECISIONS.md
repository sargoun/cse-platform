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

## Open — ask, do not guess

| # | Question | Blocks |
|---|---|---|
| O-01 | Is **CSE Operations** a GmbH or a department? | invoice circle, Phase 1 |
| O-04 | The exact five billing types | Phase 6 |
| O-05 | DATEV: Beraternummer, Mandantennummer per entity, SKR03/04, Sachkontenlänge, Steuerschlüssel, fiscal year start — **plus a real sample EXTF export** | Phase 7 |
| O-06 | Is there a **Betriebsrat**? | geolocation capture, LEG-10 |
| O-07 | Which procurement platforms is the group registered on? | RAD-09 |
| O-08 | Separate domains per area, or one group domain? | Phase 2 |
| O-09 | Data volumes: objects, rooms, contracts, employees | migration planning |
| O-10 | Which social and job-board accounts exist, and who owns them? | Phase 9 |
| O-11 | Hosting promise: managed EU cloud, or self-hosted German server? | D-04 |
| O-12 | **Exact CSE red** from the official logo; SVG logos for all four brands | DESIGN §1 |
| O-13 | **Real photography** — crews, sites, completed projects, with releases | DESIGN §4, launch blocker |

O-03 has been answered — see **D-09**. The `person` / `anstellung` split is
confirmed and must be in the schema from the first migration.
