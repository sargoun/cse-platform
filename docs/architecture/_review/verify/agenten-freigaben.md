# Verification findings — agenten-freigaben

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (10)

### R1. The person-scoped RLS predicate has an operator-precedence bug that lets the OR branch escape the tenant conjunct: `exists (select 1 from anstellung a where a.person_id = t.person_id and a.mandant_id = app.aktiver_mandant() and a.austritt is null or …)`. In SQL this parses as `(person_id = … and mandant_id = … and austritt is null) or (…)`, so whatever the elided branch is (presumably "austritt >= stichtag"), it is evaluated without the `mandant_id` restriction — the exact leak class §2.3 exists to prevent, in the one predicate that guards `person`, `nachweis`, `bewacher_eintrag`, `qualifikation` and `mitarbeiter_zugang`.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:265 (§2.3, Person-scoped row)

**Fix:** Parenthesise the employment-window test: `… and a.mandant_id = app.aktiver_mandant() and (a.austritt is null or a.austritt >= <stichtag>)`, and spell out the elided branch rather than leaving a `…` inside a predicate an implementer will copy.

### R2. The agent session table contradicts K-02 and §2.4 on group scope (see convention_violations). §6.2's `withSystemTenant` additionally hard-codes `set_config('app.scope','mandant')` and sets no `app.mandant_ids`, so the group-scope CEO Assistant run promised in §2.2, §2.4 and §3.1 has no session helper that can produce it.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:222–224 (§2.2) vs §2.4 and §6.2

**Fix:** Split the table into a mandant-scope column and a group-scope column: in group scope `app.mandant_id = NULL`, `app.mandant_ids = <readable set>`, `app.readonly = on`; and state explicitly that group-scope agent runs go through `withGroupScope`, not `withSystemTenant`.

### R3. `codeFloor` is declared as `codeFloor(aktion, vorgang_typ)` — "a total function with a single source table" — but the source table's rows are keyed on two different domains: some on `erstelle_vorgang.art` (`benachrichtigung_intern`, `aufgabe`, `lead_notiz`, `buchungsvorschlag`, `einsatz_vorschlag`, …) and some on `vorgang_typ` (`angebot_erstellen`). Three concrete consequences: (a) the arts `aufgabe` and `lead_notiz` correspond to no value of the fifteen-value `agent_vorgang_typ`, so `codeFloor(gated_write, vorgang_typ)` cannot return their `allow` floor; (b) an `aufgabe` write inside an `ersatz_vorschlagen` run derives `vorgang_typ = 'ersatz_vorschlagen'` per §6.5 and therefore gets `freigabe_erforderlich, einzeln, batch_verboten` from the vorgang_typ row while the art row says `allow` — the same ambiguity B9 was raised about; (c) `angebot_entwurf` appears in the `erstelle_vorgang.art` enum but in no art row at all. The stated totality test (`Aktionsklasse × agent_vorgang_typ`) cannot detect any of this because it never varies `art`.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:1236–1246 (§7.3) with §4.4 and §5.4 tool 9

**Fix:** Make the key explicit and uniform: `codeFloor(aktion, vorgang_typ, art)` over one table whose rows all carry both discriminators (art = `—` where it does not apply), state the precedence when both a vorgang_typ row and an art row match (strictest wins, per §4.3), and assert totality over `Aktionsklasse × agent_vorgang_typ × (art ∪ {null})`.

### R4. §13.1's pre-flight can return `pause_fehlt`, but `PolicyInput.arbzg_befund` is typed `'keine' | 'ueber_8h' | 'ueber_10h' | 'ruhezeit_unter_11h' | 'unbekannt' | null`. A `pause_fehlt` verdict is therefore not representable in the input to `decide()`: it is either dropped (the §13.2 "any other value" escalation never fires and the proposal is treated as clean) or coerced to `unbekannt` (denied under D12 with a misleading code).

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:1795 (§13.1) vs :1162 (§7.1 PolicyInput)

**Fix:** Add `'pause_fehlt'` to the `arbzg_befund` union in `PolicyInput` (and to the §13.2 verdict table's enumerated values), or drop it from the service return type — one of the two, and state which §4 ArbZG break rule it represents without inventing the minute figures (they belong in a TODO(client) if SPEC does not state them).

### R5. The K-13 chain does not cover the presentation the approval was given on, and half the snapshot's fields exist in no schema. §14.10 lists `diff`, `felder`, `ansicht_modell`, `policy_ergebnis`, `artefakt_hash`, `richtlinien_version`, `code_version`, `modell`, `prompt_version` as snapshot fields and argues "*Approved* means approved **on the basis of this presentation** — which is why the diff, the sources and the view model are part of the snapshot". But §14.2's own column list for `freigabe_snapshot` omits every one of them, §19 does not require them of the owning document, the owning document (02-datenmodell/06-RADAR-KI-INHALT.md §4.7) does not define them, and the stated hash `SHA256(nutzlast_hash ‖ art ‖ entschieden_von ‖ entschieden_am ‖ kette_nr ‖ vorher_hash)` protects none of them. So the diff, the field evidence and the policy trace are outside the tamper-evident chain — the "silently covering an undeclared subset" failure B3 named, in a smaller form, and APR-07's replayable presentation rests on columns that do not exist.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:1878–1897 (§14.2) vs :2245–2270 (§14.10) and §19 R-04

**Fix:** Either extend the hash to `SHA256(nutzlast_hash ‖ artefakt_hash ‖ diff_hash ‖ felder_hash ‖ ansicht_modell_hash ‖ policy_ergebnis_hash ‖ art ‖ entschieden_von ‖ entschieden_am ‖ kette_nr ‖ vorher_hash)`, or state plainly that the chain covers the payload only and that the presentation is protected by append-only storage alone. Either way add the missing columns to §14.2's list and to a §19 requirement on 02-datenmodell/06-RADAR-KI-INHALT.md §4.7 — both documents must state the same formula, since they currently agree on a formula that omits the fields §14.10 calls load-bearing.

### R6. `freigabe.artefakt_id` is referenced as an existing pointer ("`freigabe.artefakt_id` and `vergleichsartefakt_id` point at them") but appears in no column list: not in §14.2's `freigabe` enumeration, not in §19 R-04 (which requires `vergleichsartefakt_id`, `ausfuehrung_versuch`, `externe_ref`, `erforderliches_recht` but not `artefakt_id`), and not in the owning document, which does not mention `agent_artefakt` at all. It is load-bearing: `sende_email.koerper` is an `ArtefaktHandle` and the review screen renders the artefact.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:1530 (§9.4) vs §14.2 and §19 R-04

**Fix:** Add `artefakt_id` (composite FK `(mandant_id, artefakt_id)` → `agent_artefakt`) to §14.2's `freigabe` column list and to R-04, alongside `vergleichsartefakt_id`.

### R7. B14's swappable billing-strategy interface is claimed but not written. `calculateAbrechnung` appears only as one name in the §5.5 service list; nothing states that it dispatches per billing type behind an interface, and the `auftragsabrechnung` art carries no marker — its only comment is `// FIN-01, FIN-07 — §5.6`. The O-04 TODO(client) sits at §14.5, where it asks about the *comparable key*, not about the billing strategies. K-17 requires the labelled placeholder and the marker "at the site of each unknown" — an implementer reading `berechne_preis` will implement `calculateAbrechnung` as though the five types were known, which is precisely the process defect the review's last INVENTED-RULES bullet named.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:706–707 (§5.4 art `auftragsabrechnung`) and :857 (§5.5 rule 1)

**Fix:** At the art's site add `// TODO(client, O-04): Welche fünf Abrechnungsarten gelten genau (FIN-01)?` and one sentence in §5.5: `calculateAbrechnung(auftrag, periode)` dispatches to one `AbrechnungsStrategie` per billing type behind an interface, seeded with placeholder strategies carrying `ist_platzhalter = true`, exactly as `MahnstufenRegelwerk` is handled in §5.6.

### R8. `DatumToken` is used in four `berechne_preis` signatures and in `pruefe_nachweise.stichtag`, but is never declared in the §5.1 type block that declares every other handle type; it is only described in prose in §5.6 ("A `DatumToken` is a register token of `art: 'datum'`").

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md:§5.1 type block (lines 519–545) vs §5.4 lines 707, 734–740, 745

**Fix:** Add `export type DatumToken = string;  // a register token whose GebundenerWert.art is 'datum' — §5.6` to the §5.1 block, so the Zod boundary of §5.5's test has a declared type to check against.

### R9. Two operational thresholds are stated as concrete numbers while every comparable threshold in the document is a labelled placeholder: "≤ 10 items per person per day" and "a role's open queue above 15 items, or a daily creation rate above the target" (and the "rolling window of 20 decisions" in §14.14, whose two other parameters are correctly O-A8b). These are operational rather than legal or financial, so K-17 is not breached, but they will be copy-pasted as configuration defaults exactly as the removed budget-banner figure would have been.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md §14.1 (load-target table) and §14.14 (queue-load alerting)

**Fix:** Mark them as illustrative design targets, or make them `agent_richtlinie`/config values with `ist_platzhalter = true` and fold them into O-A8b's question.

### R10. Two rows of §4.2 are presented in a column headed "SPEC matrix row" that are not rows of SPEC §17's matrix: 'Dunning proposal' and 'Job advertisement'. SPEC's matrix has fourteen rows and contains neither; both are derived from FIN-15 and REC-02. Every other derived row in the table is explicitly labelled *(derived)*.

**Where:** docs/architecture/06-AGENTEN-FREIGABEN.md §4.2 (matrix table, rows `mahnung_vorschlagen` and `stellenanzeige_entwurf`)

**Fix:** Prefix both with *(derived)* as the recruiting, extraction and CEO-read rows already are, so a reader cannot infer a SPEC mandate the SPEC does not give.

## CONVENTION VIOLATIONS (3)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-02 — §2.2, lines 222–224: the agent session table says `app.mandant_id` = "exactly one mandant, from the trigger", `app.mandant_ids` = "unset — an agent run is never in group scope with write intent", while `app.scope` = "`mandant`, or `gruppe` for a read-only CEO Assistant run". K-02 requires `app.mandant_id` to be NULL in group scope and asserts `CHECK ((scope = 'mandant') = (mandant_id IS NOT NULL))`; with `mandant_ids` unset, `app.sichtbare_mandanten()` is empty and every K-03 group policy (`mandant_id = any (app.sichtbare_mandanten())`) returns zero rows. §2.4 states the correct behaviour, so the document contradicts both K-02 and itself.

- K-10 — §5.4 tool 3, line 682: `parameter: Record<string, string | number | BezugHandle>`. K-10 requires every money, quantity, formula (and, per §5.5 rule 2 in this document, every date) argument to be a handle or a register token; the §5.7 catalogue parameters this record carries are named `stichtag`, `von`, `bis`, `tage`, `tage_ueberfaellig`, `monat`, `projekt_ref`, `anstellung_ref`, `objekt`. As typed, the model may write a raw date string, a raw number and a raw row id, which also breaches §12 mechanism 3 ("Every id argument is a handle minted earlier in the run"). The document's own test — "failing on any `z.number()`, any unconstrained `z.string()` in a money, quantity or date position, and any field name matching /(…|datum|frist|stichtag)$/" — would fail on this very schema.

- K-16 (declared deviation, not a defect) — §10.1: `PRIMARY KEY (mandant_id, id)` on `wissens_chunk` is stated as "a stated exception to K-16's single-column primary key" because Postgres requires the partition key in the primary key. The deviation is unavoidable and is declared rather than hidden, and it simultaneously satisfies K-16's requirement that a composite-FK parent carry `UNIQUE (mandant_id, id)`. Recording it here so it is not later read as an omission.

## VERIFIER VERDICT

All twenty BLOCKING items are genuinely fixed in the file, not merely claimed — I verified each against the written text rather than the changelog, and in the four cases where the author deviated from the reviewer's prescribed remedy (B4's partial unique indexes plus CHECK instead of NULLS NOT DISTINCT, B7's mandatory service pre-flight instead of a tenth tool, B14/B16's in-place constructions instead of new tables) the deviation is stated, justified, stricter or equivalent, and consistent with the sibling data-model document, which I checked directly for `freigabe_kette`, `app.agent_budget_pruefen`, `app.wissen_partition_anlegen` and `freigabe_snapshot`. The document is sound on the hard invariants: money is `bigint` cents everywhere including agent cost accounting with a millionths carry, quantities are decimal strings never floats, instants are `timestamptz` with Berlin wall-clock boundaries converted per K-11, no costed entity hangs off `person_id` and no human fact off `anstellung_id`, the one cross-entity crossing is K-06's `app.arbzg_belastung` and nothing else, no external call is simulated anywhere (D10, §11.1, §15 all say "nicht verbunden"), and no concrete legal, financial or tariff value is stated without a TODO(client) — the €20,000 threshold traces to SPEC §17, the two-year MiLoG and ten-year GoBD periods to TIM-13/LEG-01/ACC-06, the 15-minute signed-URL expiry to DOC-03, and the previously-invented Nachweis enum, dunning ladder, tariff-bearing diff key and budget banner figure are all now placeholders behind interfaces. It is not yet fit to implement against without a short corrective pass: three defects would produce real failures rather than confusion — the person-scoped RLS predicate whose unparenthesised `or` lets the branch escape the `mandant_id` conjunct (line 265), the `codeFloor` table keyed simultaneously on `art` and `vorgang_typ` so the gate on `aufgabe`/`lead_notiz`/`angebot_entwurf` is genuinely undefined despite a totality test that cannot see it, and the K-02 contradiction on group-scope GUCs that would leave a group-scope agent run reading zero rows through a session helper that cannot produce that state. The `suche_bestand.parameter` record is the one surviving hole in the K-10 entry-point defence the whole document is built to hold. Fix those four plus the snapshot-column/hash-coverage gap and this is a document an implementer can build from without inventing anything.
