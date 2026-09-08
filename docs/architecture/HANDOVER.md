# Phase 0 — handover and resume point

Everything below is on branch `claude/phase-0-setup-planning-2jufm5`.

**Phase 0 is complete.** Every deliverable is written, the documents are consistent with
each other, the open questions are one register, and the traceability matrix is closed at
232 / 232. No application code has been written — that was deliberate and still waits on
the client's review, because several of the open answers change the first migration.

This file was originally written when a session ran out of budget mid-pass, as a resume
point. It is kept as the record of what the finishing pass did; start at
[`README.md`](README.md) instead if you are reading the set for the first time.

---

## What exists

| Deliverable (client's list) | File | State |
|---|---|---|
| 1 · Folder structure | `01-ORDNERSTRUKTUR.md` | done, harmonised |
| 2 · Full DB schema | `02-datenmodell/01…06` | done, harmonised |
| 3 · Auth + permission model | `03-AUTH-BERECHTIGUNGEN.md` | done, harmonised |
| 4 · Page map | `04-SEITENKARTE.md` | done, harmonised |
| 4 · API map | `05-API-KARTE.md` | done, harmonised |
| 5 · Agents + approval gate | `06-AGENTEN-FREIGABEN.md` | done, harmonised |
| 6 · PR plan (96 PRs) | `08-PR-PLAN.md` | done, harmonised |
| — · Integrations (ROADMAP asks for it) | `07-INTEGRATIONEN.md` | done, harmonised |
| — · Binding conventions K-01…K-21 | `00-KONVENTIONEN.md` | done |

`_review/` holds the raw review artefacts: the twelve adversarial critiques
(`critiques/`), the twelve verification reports (`verify/`), the collated
verification (`verification.md`) and the cross-document contradictions
(`cross.md`), the derivation of the O-number register (`o-nummern.md`) and the
traceability generator (`trace.py`). Keep them until Phase 0 is signed off — they are the
evidence for why the documents say what they say.

Traceability: **232 / 232 SPEC feature IDs** appear in at least one architecture document
and are assigned to a PR. The matrix is `09-ABDECKUNG.md`; the index is `README.md`.

---

## How it was built

Draft → adversarial review → rewrite → independent verification → cross-document
check → harmonisation. Roughly 80 agent passes.

- **233 blocking findings** raised by the reviewers, all confirmed fixed in the
  written files by a verifier that read the file rather than the author's claim.
  Six author rejections were judged sound.
- **156 second-order defects** and 36 convention departures found by the
  verifiers, then reconciled.
- **89 cross-document contradictions** and 85 dangling references found by the
  cross-check, harmonised onto the document that owns each fact. The last 22 of them are
  resolved in commit `2e17b8a` — see §"Resume here" below.

The pattern worth naming, because it recurs: almost every serious defect found here was a
**silent** one. A permission key nobody registered, an accessor that returns NULL in the
scope that needs it, a working-time check that cannot see the other entity's hours. None
raises an error; all produce a plausible, empty, wrong screen.

---

## Resume here — all four items are DONE

All four outstanding work items are complete. Phase 0 is finished and waiting for the
client's review. What follows records what each one did, so a reader can check the work
rather than take it on trust.

### 1. ~~Finish the harmonisation pass~~ — DONE (commit `aac8758`)

All thirteen documents carry the cross-document fixes. `03-AUTH` owns a complete
permission catalogue with all seven K-19 actions; invented right keys were remapped onto
the closed module list rather than added to it; `t_kunde` predicates use
`app.aktuelle_kunden()` per K-20; and the K-21 names are canonical, with superseded
spellings kept only as explicit withdrawal notes so they cannot drift back.

### 1b. ~~The 22 remaining inconsistencies~~ — DONE (commit `2e17b8a`)

Each was reconciled onto the document that owns the fact. The load-bearing ones:

- **`agent_artefakt`** — ownership was settled, the column set was not, so one table name
  carried two shapes. The owner (`02-datenmodell/06-RADAR-KI-INHALT.md` §3.12) now holds
  the merged set: `artefakt_art` at seven values including `shortlist`, plus
  `artefakt_status`, `vorlage`, `sprache`, `verwendete_werte`, `quellen`,
  `konfidenz_min`, `unsicher`. `inhalt jsonb` beat `inhalt_ref` because LEG-09 redaction
  must null the content while the hash still verifies, which a bucket key cannot do.
  `06-AGENTEN-FREIGABEN.md` §9.4 is now a pure back-reference and R-01 is discharged.
- **`berechtigung_aktion`** — 25 catalogue keys used actions the 27-value enum did not
  have, so none of their rows could be inserted and `app.hat_recht()` would have answered
  false for each of them permanently and silently: no invoice download for a customer, no
  agent run started from the portal, no APR-05 objection, no APR-06 undo, no Aufmaß
  recorded on site. The enum is now 42 values, four keys were renamed onto values it
  already had, and **K-19's CI test gained a third assertion** — a catalogue key that
  cannot be written down — which is the one the other two cannot make, because a key
  wrong in both code and catalogue passes both of them.
- **`app.portal` in group scope** is now the constant `intern`, gated at entry. The
  most-restrictive fold it replaced returned `mitarbeiter` for the D-09 human who leads
  one entity and is employed by another, firing every K-04 ceiling inside the group view.
- **`app.aktueller_kunde()`** in `kunde` scope is *defined and arbitrary*, not NULL. The
  prohibition is therefore on the identifier, asserted by a grep, not on a return value:
  a policy naming it does not fail closed, it serves one of the customer's bindings and
  hides the rest.
- **`KanonischeRechnung`** gained the eight missing field groups and `Cent` types. Nulls
  are written explicitly and never omitted, so a shorter field list is different bytes and
  a different hash — the invoice would fail its own chain verification.
- K-06 gained `person_id`, K-08 the five-argument `checkin_verbrauchen`, K-12 the owner's
  payload spelling, K-16(b) three conversion sites over one table, and the §E ArbZG rows
  the live `arbzg_regel` values, with T-08 expecting **both** the 8 h and the 10 h finding
  at 660 minutes.

### 2. ~~Rebuild the O-number register~~ — DONE (commits `b5aed64`, `3aca39f`, `e475c08`)

Done mechanically, not from the documents' claims. Every occurrence was resolved to the
**question** it names. The finding: `O-33 … O-133` is one coordinated chain across six
documents that cite each other correctly, and all the collisions come from six domain
documents that each minted a local `O-30 … O-4x` block beside it. `O-33` alone carried
six different questions.

The chain was kept, the six local blocks remapped — 250 occurrences — and fourteen
duplicates folded into the number that already asks them. One number used twice inside a
single document was split. **`docs/DECISIONS.md` § Open is now the register: 202
questions, each with an owner.** `_review/o-nummern.md` records the derivation, and a
check confirms every number used in `docs/architecture` has a row and every row is used.

### 3. ~~The two index documents~~ — DONE (commit `eeedc48`)

`README.md` and `09-ABDECKUNG.md`. The matrix confirms **232 / 232** SPEC IDs covered and
assigned. The generator is `_review/trace.py`; its range expansion is load-bearing, not
defensive — without it seven IDs appear to have no PR at all.

### 4. ~~Update `docs/DECISIONS.md`~~ — DONE (commit `e475c08`)

Seven Phase 0 entries under **Decided** — D-12 … D-18, the ArbZG crossing, column grants,
the four scopes, the `/portal` prefix, K-10, K-19 and the verified DST cases — plus the
three non-client carry-overs (the DESIGN absence palette, `dokument.sichtbar_fuer_mitarbeiter`,
and whether `app.mandant_kennzahlen()` respects per-module rights).

---

## Do not lose these decisions

The five that cost the most to find, and that a fresh pass would probably get
wrong again:

1. **K-06 — the ArbZG cross-entity window.** Aggregating one person's hours
   across entities (TIM-14, D-09) is impossible under strict tenant RLS, and it
   fails *silently*: the check returns "no conflict" and a 6h + 5h day is
   scheduled as lawful. Exactly one sanctioned crossing exists — a
   `SECURITY DEFINER` function returning only durations and interval boundaries,
   never the other entity's name, `objekt`, `kunde` or wage rate — audit-logged
   per call, with an isolation test asserting nothing identifying leaks.

2. **K-05 — column grants, not masking views.** The first draft's view did
   `select a.*` *and then* added a masked copy of the wage rate beside it. Both
   repairs fail: `security_invoker` needs privileges just revoked, and without it
   the view runs as an owner that ignores the tenant predicate.

3. **K-18 + K-20 — four read scopes, and accessors that resolve in all of them.**
   The employee and customer portals span tenants as a *subject*, not as a
   manager. Routing them through group scope means K-03's group policy demands a
   `gruppe.*` right they never hold, and both portals read zero rows; widening
   that right hands every cleaner a group-level read. K-20 exists because the
   same bug reappeared one layer down in `app.aktueller_kunde()` and
   `app.portal()`.

4. **K-19 — an unregistered right key is permanent silence.** `hat_recht()`
   returns false for unknown keys, so a typo is an always-empty screen with no
   error. One draft's action vocabulary omitted `schreiben`, which would have
   made every write path in the platform unauthorisable.

5. **K-11 — the DST reference cases, verified.** The transition *night* begins
   the evening before the transition day. The drafted PR plan named
   `2026-03-29` and `2026-10-25` and asserted 420 and 540 minutes against
   shifts that are ordinarily 480. Correct: `2026-03-28 22:00 → 03-29 06:00`
   = **420**, `2026-10-24 22:00 → 10-25 06:00` = **540**, and a shift starting
   22:00 *on* a transition day = **480**, asserted as a control so an
   off-by-one fixture cannot pass.

---

## Before any code

The client's standing conditions, unchanged:

- The first code PR is **PR 1** in `08-PR-PLAN.md`: money, time and ArbZG tests
  with no table, no route and no React — the 22:00–06:00 shift, both DST nights,
  ten concurrent shifts, and one person breaching ArbZG across two entities.
- `person` and `anstellung` are separate **from the first migration** (D-09);
  that is PR 3.
- Anything undecided ships behind an interface with `// TODO(client)` and a
  `DECISIONS.md` row. No invented business rules.
- No fake integrations. Unconnected systems display "not connected".

**Phase 0 stops here and waits for the client's review before any code.**

---

## Outstanding cross-document inconsistencies — none

The 22 that stood here are resolved; commit `2e17b8a` names each one and what it was
reconciled onto. The list itself is preserved in the git history of this file rather than
kept here, because a list of closed items reads, on a later pass, like a list of open
ones.

**Phase 0 is complete and waits for the client's review.**
