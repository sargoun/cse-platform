# Phase 0 — handover / resume point

Written when a session ran out of budget mid-pass. Everything below is on
branch `claude/phase-0-setup-planning-2jufm5`.

**Phase 0 is delivered and reviewable now.** What remains is finishing work on
consistency between documents, not missing deliverables. No application code has
been written — that was deliberate and still waits on the client's review.

---

## What exists

| Deliverable (client's list) | File | State |
|---|---|---|
| 1 · Folder structure | `01-ORDNERSTRUKTUR.md` | done, harmonised |
| 2 · Full DB schema | `02-datenmodell/01…06` | done, harmonised |
| 3 · Auth + permission model | `03-AUTH-BERECHTIGUNGEN.md` | done, **harmonisation not applied** |
| 4 · Page map | `04-SEITENKARTE.md` | done, **harmonisation not applied** |
| 4 · API map | `05-API-KARTE.md` | done, **harmonisation not applied** |
| 5 · Agents + approval gate | `06-AGENTEN-FREIGABEN.md` | done, **harmonisation not applied** |
| 6 · PR plan (96 PRs) | `08-PR-PLAN.md` | done, **harmonisation not applied** |
| — · Integrations (ROADMAP asks for it) | `07-INTEGRATIONEN.md` | done, **harmonisation not applied** |
| — · Binding conventions K-01…K-21 | `00-KONVENTIONEN.md` | done |

`_review/` holds the raw review artefacts: the twelve adversarial critiques
(`critiques/`), the twelve verification reports (`verify/`), the collated
verification (`verification.md`) and the cross-document contradictions
(`cross.md`). Keep them until Phase 0 is signed off — they are the evidence for
why the documents say what they say, and the to-do list for finishing.

Traceability: **232 / 232 SPEC feature IDs** appear in at least one architecture
document and are assigned to a PR.

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
  cross-check. Harmonisation of these is the pass that did not finish.

---

## Resume here

### 1. Finish the harmonisation pass — the only real gap

Six documents still need the cross-document fixes applied:
`03-AUTH-BERECHTIGUNGEN.md`, `04-SEITENKARTE.md`, `05-API-KARTE.md`,
`06-AGENTEN-FREIGABEN.md`, `07-INTEGRATIONEN.md`, `08-PR-PLAN.md`.

Their to-do list is `_review/cross.md`, which names, for every contradiction,
the documents involved, **which one is right**, and the fix. Apply only the
items where the document in hand is the one that must change. The binding
answers are already in `00-KONVENTIONEN.md` as K-19 (one permission catalogue),
K-20 (accessors resolve in every scope) and K-21 (table ownership and canonical
names).

The largest single job is **03-AUTH-BERECHTIGUNGEN.md**: under K-19 it owns the
permission catalogue, so every right key any other document uses must have a row
there, and its `berechtigung_aktion` vocabulary must contain all seven actions
K-19 lists — `lesen, schreiben, loeschen, pruefen, freigeben, exportieren,
verwalten`.

Then re-run the three consistency checks (permission keys and scopes; table and
column names; money, time and agent contracts).

### 2. Rebuild the O-number register — do this by hand, do not trust the claims

Documents independently claimed `O-30`…`O-131` and **there are collisions**: the
same number used for different questions in different documents. Roughly 114
distinct open questions exist.

The safe procedure is mechanical, not editorial:

```bash
grep -rhoE 'O-[0-9]+[^\n]{0,200}' docs/architecture --include='*.md' | sort -u
```

Group by number, find where one number carries two different questions,
renumber into one register, then write the register into `docs/DECISIONS.md`
under **Open** and fix every reference. `O-01` and `O-04`…`O-13` are the
client's originals and **must keep their numbers**; `O-14`…`O-29` come from
`08-PR-PLAN.md` and are internally consistent.

### 3. Write the two remaining index documents

- `README.md` — an index of the set, with a one-line purpose per document and
  the reading order for a reviewer.
- `09-ABDECKUNG.md` — the SPEC traceability matrix. The generator already exists
  and works; it expands `DOC-01…DOC-06` range notation, which a naive grep does
  not:

```
/tmp/claude-0/-home-user-cse-platform/.../scratchpad/trace.py
```

If that scratchpad is gone, it is twenty lines: extract the 232 IDs from
`SPEC.md`, expand range notation, grep each ID across the documents, emit a
table of ID → documents → PR.

### 4. Update `docs/DECISIONS.md`

Add the Phase 0 decisions and the consolidated Open register from step 2.
Candidates for **Decided**, all of them load-bearing and already justified in
`00-KONVENTIONEN.md`: the K-06 ArbZG cross-entity function, K-05 column grants
for wage confidentiality, K-18's four read scopes, K-07's `/portal` prefix, and
K-10 (the AI supplies no number and no input that determines one).

Also carry over three non-client items the review surfaced:

- `docs/DESIGN.md` needs an absence colour palette before the Dienstplan renders
  anything beyond the semantic tokens — it currently carries a `TODO(design)`.
- `02-CRM-OPERATIONS.md` must add
  `dokument.sichtbar_fuer_mitarbeiter boolean not null default false`; worker
  document visibility has nothing to key on today.
- `app.mandant_kennzahlen()` is defined in `01-KERN.md` §6.3 as counts-only over
  `app.switcher_mandanten()`, but is silent on whether the counts respect the
  caller's per-module rights. Settle it before the switcher ships (TEN-10).

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
