# Verification findings — planung-zeit

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (18)

### R1. `app.arbzg_befund_schreiben` gates the job path on `current_user <> 'cse_job'`, but inside a SECURITY DEFINER function owned by `cse_definer` (K-01) `current_user` is always `cse_definer`. The elsif branch therefore always raises 42501, so the nightly detector — the whole point of §6.4 and review B14 — can never write a finding. It fails at exactly the moment TIM-14's cross-entity breach is detected, and only in production cron, never in a session-backed test.

**Where:** §6.6, `elsif current_user <> 'cse_job' then raise exception 'nicht berechtigt' using errcode = '42501';`

**Fix:** Use `session_user <> 'cse_job'` (SESSION_USER is unaffected by SECURITY DEFINER), or better, take the job identity from an explicit `p_system boolean` argument granted only via EXECUTE, and add a test asserting a cse_job invocation with `app.mandant_id` unset writes both mirror rows.

### R2. The `medien` definer policy references a column that does not exist. §1.6 names the Auditblock column `erstellt_von_art akteur_art not null default 'mensch'`; `akteur_art` is the enum type name, not a column. The policy will not create, so the migration fails.

**Where:** §1.1, `create policy me_definer_insert on medien as permissive for insert to cse_definer with check (akteur_art = 'mensch' and erstellt_von_person_id is not null);`

**Fix:** `with check (erstellt_von_art = 'mensch' and erstellt_von_person_id is not null)`.

### R3. Retention is deadlocked by its own default. §1.13 ships `loeschsperre boolean not null default true` on every table, while §13 and test §18.30 forbid the job from writing `aufbewahrung_bis` on a row under Löschsperre. With the default true, `aufbewahrung_bis` is never written for any row, no deadline is ever computed, and LEG-01/LEG-02 have no data. It also contradicts §13's own sentence that the finance domain 'sets `loeschsperre = true`' on billing — which presupposes it was false.

**Where:** §1.13 (`loeschsperre boolean not null default true  -- fail-closed`) against §13 ('job:aufbewahrung writes aufbewahrung_bis') and §18.30

**Fix:** Separate the two ideas: keep deletion fail-closed by making the purge predicate require `aufbewahrung_bis is not null and not loeschsperre` (already stated), and default `loeschsperre` to `false` so the retention job can compute a deadline; or keep the default and reword §13/§18.30 so the job may set `aufbewahrung_bis` under a Löschsperre and only the purge is blocked. State which, and test it.

### R4. `zeit_intern.arbeitszeit_fenster.zuordnung_quelle_id` is NOT NULL and §6.2 fills it with `zeiteintrag.id` for unplanned work ('projects an ist window with `zuordnung_quelle_id = zeiteintrag.id` — its own identity'), but §19 promises a Phase 5 foreign key from that column to `einsatz_zuordnung`. That FK cannot be created: every unplanned-work row holds a zeiteintrag id.

**Where:** §5.12 column table, §6.2 paragraph after `zeit.fenster_setzen`, §19 row 1

**Fix:** Drop the promised FK and say so (the column is a deduplication key, not a reference), or add `zuordnung_quelle_art fenster_quelle` and make the FK conditional — but the simpler fix is to state in §19 that this column deliberately receives no FK and is validated by `job:arbzg_fenster_abgleich` instead.

### R5. `zeiteintrag.gesperrt_am` has no writer. Nothing in the trigger inventory (§14.1) or the job inventory (§14.3) sets it, and 01-KERN's `gesperrt_am` lives on `stundenkonto`, not on `zeiteintrag`. Two things depend on it: `zk_sperre_ausgleich` (the entire B7 substitute — it never fires, so a correction to a locked month can be recorded with no compensating booking), and the ACC-12 payroll-export predicate `freigegeben_am is not null and gesperrt_am is not null`, which selects zero rows.

**Where:** §5.6 (`gesperrt_am ... set when the entry's stundenkonto month locks`), §5.7 `zk_sperre_ausgleich`, §7.3 consumer table, §12.2

**Fix:** Either name the mechanism — a trigger on `stundenkonto` status → 'gesperrt' that stamps `gesperrt_am` on every zeiteintrag of that anstellung/month (Berlin boundaries, K-11), listed in §14.1 — or drop the column and have `zk_sperre_ausgleich` resolve the lock live against `stundenkonto.status` through a definer helper. Test §18.19 must exercise whichever is chosen.

### R6. The offline promotion path cannot execute as specified. `offline_ereignis` has no UPDATE policy for `cse_app` (§5.9 grants 'standard for read' only), so `app.offline_uebernehmen` must be SECURITY DEFINER to set `status='uebernommen'`; but running as `cse_definer` its `zeiteintrag` INSERT is refused by `z_definer_insert`, whose WITH CHECK demands `erfassungsart_beginn = 'checkin_token' and quelle_beginn = 'server_uhr'` — while §9.4 requires exactly `quelle_* = 'planer_entscheidung'`, `erfassungsart_* = 'nacherfassung'`.

**Where:** §1.1 `z_definer_insert` against §5.9 RLS and §9.4 item 5

**Fix:** Add a second narrow definer policy, e.g. `z_definer_nacherfassung ... for insert to cse_definer with check (erfassungsart_beginn = 'nacherfassung' and quelle_beginn = 'planer_entscheidung' and nacherfasst)`, and state in §9.4 that `app.offline_uebernehmen` is SECURITY DEFINER owned by cse_definer with EXECUTE granted to cse_app only.

### R7. Two CHECKs compose into an impossible-to-satisfy-honestly rule for the commonest correction. A planner closing a forgotten check-out sets `quelle_ende = 'planer_entscheidung'`, which by `check (quelle_ende <> 'planer_entscheidung' or nacherfasst)` forces `nacherfasst = true`, which by `check (not nacherfasst or behauptet_beginn is not null)` forces a `behauptet_beginn` the worker never claimed (they stamped in by token). The planner must invent a claim to record a real correction.

**Where:** §5.6, `quelle_beginn · quelle_ende` row and the `nacherfasst` row

**Fix:** Make the claim constraint per event: `check (not nacherfasst or behauptet_beginn is not null or behauptet_ende is not null)`, or tie each side to its own source: `check (quelle_beginn <> 'planer_entscheidung' or behauptet_beginn is not null or erfassungsart_beginn = 'planer_manuell')`.

### R8. `app.checkin_verbrauchen` consumes the token before it knows a `benutzer` row exists. The token is marked redeemed by the compare-and-set, then the entry is inserted via `insert ... select ... from public.benutzer b where b.person_id = t.person_id`; if that yields no row the INSERT writes nothing, `v_eintrag` stays NULL, and the function returns having burnt a single-use token with no §17 MiLoG record and no error. §1.6's assurance that 'every activated worker access has a benutzer row' does not cover a worker who was sent a link before activation.

**Where:** §9.1, the `if t.zweck = 'checkin'` branch

**Fix:** Resolve the benutzer into a variable first and `raise exception` (rolling back the token consumption) when it is missing, or insert with a `not found` guard after the statement; add a test for 'assignment whose person has no benutzer row → token not consumed, explicit error'.

### R9. The document declares its own qualification-gate trigger on `einsatz_zuordnung` while 03-GEWERKE §9.3 already declares one on the same table (`create constraint trigger einsatz_zuordnung_qualifikation ... after insert or update of anstellung_id, einsatz_id on einsatz_zuordnung` executing `gewerke.erzwinge_einsatz_qualifikation()`). Two gates with different names, timings (BEFORE vs AFTER constraint trigger) and snapshot-writing semantics will both be created. §11.1 also says the gate is called 'with the shift's `beginn_zeitpunkt` as the reference date', but the binding signature is `app.einsatz_qualifikation_erfuellt(p_anstellung uuid, p_einsatz uuid)` — no date parameter; the function derives the Stichtag itself.

**Where:** §5.4 trigger list (`ez_qualifikation_gate`), §11.1 ('This document supplies the two proof columns and the trigger')

**Fix:** Own one of them. Since this document owns `einsatz_zuordnung`, either adopt 03-GEWERKE's trigger by name and drop `ez_qualifikation_gate`, or state in §2.3 that 03-GEWERKE §9.3's constraint trigger is superseded by `ez_qualifikation_gate` and why BEFORE is required (an AFTER trigger cannot assign `new.qualifikation_snapshot`). Correct the reference-date sentence.

### R10. §14.4 is declared to be the exhaustive composite-FK inventory that a schema test walks ('§14.4 lists every composite FK in this domain'), but the `zeiteintrag` row omits `einsatz_id`, `checkin_token_id`, `checkout_token_id`, `offline_ereignis_id`, `ersetzt_zeiteintrag_id` and `ersetzt_durch_zeiteintrag_id`, all of which §5.6 declares as composite FKs. A test built from this table would pass a schema that is missing them.

**Where:** §1.6 ('§14.4 lists every composite FK in this domain') against §14.4 zeiteintrag row and §5.6

**Fix:** Complete the row, and add the `offline_ereignis` and `medien` child FKs; state explicitly that `checkin_token.eingeloest_zeiteintrag_id` / `zeiteintrag.checkin_token_id` form a cycle resolved by the nullable side.

### R11. Two parent uniques this document's composite FKs depend on exist in neither owning document and are absent from §2.3's actionable list of sibling requirements — they appear only as bold cells in the §2.1 consumption table. 01-KERN §6.14 declares `UNIQUE (mandant_id, personalnummer)` and `UNIQUE (mandant_id, id)` on `anstellung` but no `UNIQUE (id, person_id)`; 02-CRM §'Parent uniques required' lists `UNIQUE (mandant_id, id)` on `auftrag_leistung` but no `UNIQUE (mandant_id, auftrag_id, id)`. Without them the `(anstellung_id, person_id)` FKs on einsatz_zuordnung/zeiteintrag/checkin_token and the grandparent FK on einsatz cannot be created.

**Where:** §2.1 rows for `anstellung` and `auftrag_leistung`; §2.3 items 1–7 (both omitted); §14.4

**Fix:** Move both into §2.3 as numbered requirements on `01-KERN.md` §6.14 and `02-CRM-OPERATIONS.md`, phrased as the other items are, so the sibling documents have something to act on.

### R12. §1.3's own summary contradicts §2.3. §1.3 ends 'this document requires the six keys above to exist there' after enumerating ten distinct non-group right keys plus three group keys; §2.3 item 5 requires 'the eleven right keys of §1.3'. The permission-matrix seed in 01-KERN §14.3 cannot be written against a count that is wrong in both places.

**Where:** §1.3 final sentence; §2.3 item 5

**Fix:** List the keys explicitly in §2.3 item 5 rather than by count (dienstplan.lesen, dienstplan.schreiben, dienstplan.konflikt_quittieren, dienstplan.arbzg_lesen, dienstplan.arbzg_pruefen, zeit.lesen, zeit.schreiben, zeit.korrigieren, zeit.checkin_verwalten, zeit.nacherfassung_pruefen, gruppe.dienstplan.lesen, gruppe.zeit.lesen, gruppe.dienstplan.arbzg_lesen).

### R13. §6.4 declares `create function zeit.arbzg_belastung_job(...)` and then justifies it with 'it lives in `zeit_intern`'s function namespace and is executable by `cse_job` only'. Schema `zeit` and schema `zeit_intern` are different namespaces, and only the second is stated to be outside the PostgREST exposed list (§5.12). If `zeit` is exposed, the function's protection rests solely on the EXECUTE grant.

**Where:** §6.4, DDL vs the paragraph beginning 'Four properties make it acceptable'

**Fix:** Create it as `zeit_intern.arbzg_belastung_job` to match the stated reasoning, and add the schema exposure list to §2.3 as an explicit deployment requirement.

### R14. The EMP-06 monthly Stundennachweis is not stabilised against corrections. §7.3's consumer table gives it the predicate `freigegeben_am is not null` only, so re-rendering March's PDF after a May correction (which mints a new zeiteintrag version with `ersetzt_am is null` and March instants) produces a different document than the one the worker was issued — for the same locked month the §12.2 mechanism is designed to keep stable.

**Where:** §7.3 consumer table, row 'Monthly PDF (EMP-06)'

**Fix:** Either add `and gesperrt_am is not null` for a locked month, or state that EMP-06 renders from an immutable artefact (a stored PDF plus its hash) once the month locks, and that later corrections appear only in the correction trail.

### R15. The §6.3 audit payload cannot support the accountability test it is measured by. `get diagnostics v_fremd = row_count` counts every returned row, and the payload is `jsonb_build_object('von', p_von, 'bis', p_bis, 'zeilen', v_fremd)` — nothing records whether a foreign-tenant window was returned, while §6.8 case 5 requires 'a call that returns a foreign window leaves one that says so' (SEC-A9, LEG-09).

**Where:** §6.3, the `get diagnostics` / `perform app.protokolliere` lines vs §6.8 case 5

**Fix:** Accumulate the rows into a local variable (or run the count as a separate aggregate over the same predicate with `f.mandant_id <> v_mandant`) and add `'fremde_zeilen'` to the payload; rename `v_fremd` so it stops implying a count it does not hold.

### R16. `planungs_konflikt.fingerprint` is `sha256(mandant_id ‖ person_id ‖ art ‖ berlin_tag)` with `pk_fingerprint_uk unique (mandant_id, fingerprint) where hinfaellig_am is null`, so at most one conflict of a given art per person per Berlin day. Two different shifts on one day that each lose a qualification, or two distinct overlaps, collapse into one row and one `einsatz_id` — the planner sees one badge and one shift, and silently loses the other. §6.7 argues the day-granularity fingerprint only for `arbeitszeit_verstoss`, where it is right; it is carried over to `planungs_konflikt` without the same argument.

**Where:** §5.10, `fingerprint` row and `pk_fingerprint_uk`

**Fix:** For `ueberschneidung` and `qualifikation_entfallen` include the anchoring row in the fingerprint (`einsatz_zuordnung_id` / `einsatz_id`); keep the day-granularity form for `arbzg` and `aufzeichnungsfrist` only, and say why the two differ.

### R17. §5.2's column table never states that `feiertage_ueberspringen` is NOT NULL — the string '**no default**' sits in the Null column and the Default column holds '—'. Only §8.5 says 'NOT NULL with no default'. The DDL as tabulated is ambiguous, and this is the one column the review's INVENTED-RULES finding turned on.

**Where:** §5.2, `feiertage_ueberspringen` row

**Fix:** Put `no` in the Null column and 'kein Default (§8.5)' in the Default column.

### R18. O-numbering collides across the architecture set. §17.1 mints O-30 … O-42, but 03-AUTH-BERECHTIGUNGEN.md already uses O-30 ('second factor at finalisation?') and 04-SEITENKARTE.md already uses O-38 and O-42 for different questions; §17.3's 'already tracked' O-18/O-25/O-27 also mean different things in those documents, and none of O-18/O-25/O-27/O-30+ appear in docs/DECISIONS.md's Open table (which stops at O-13). K-17 requires the question to be recorded in DECISIONS.md under Open, and `pnpm lint:todo` is specified to fail when a TODO(client) has no matching row there.

**Where:** §17.1 table and §17.3

**Fix:** Reserve a per-document block (as 07-INTEGRATIONEN.md line 1765 notes the collision), or defer numbering entirely and key each TODO(client) to a stable slug until a single owner allocates O-numbers into DECISIONS.md.

## CONVENTION VIOLATIONS (3)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-01 / K-08 — §5.9 states 'Ingestion is `app.offline_ereignis_annehmen()` under `cse_checkin` (§9.4)' and §9.4 repeats 'replays them to `app.offline_ereignis_annehmen(...)` under `cse_checkin`'. K-01 gives `cse_checkin` '`EXECUTE` on `app.checkin_verbrauchen` **only**', and K-08 says 'Three functions, and only these three, may execute outside `withTenant`' — sitzung_aufloesen, versuch_protokollieren, checkin_verbrauchen. The offline replay endpoint is a fourth session-less database entry point with a grant K-01 does not permit, and §2.3 item 1 widens the 01-KERN definer *read registry* without widening K-08's function list. Fix: either add `app.offline_ereignis_annehmen` and a role for it to 00-KONVENTIONEN K-01/K-08 through an explicit §2.3 requirement, or fold offline replay into `app.checkin_verbrauchen`.

- K-04 — §1.4 enumerates the tables carrying the restrictive ceiling as 'einsatz_zuordnung, zeiteintrag, zeiteintrag_korrektur, checkin_token, offline_ereignis, medien, arbeitszeit_verstoss, planungs_konflikt' and then writes '`einsatz` and `planungsserie` carry no `anstellung_id`; their `mitarbeiter` ceiling is the existence of an own assignment (§5.3)'. But K-04's list is explicitly 'Enumerated, not exemplified' and it names `einsatz`. §5.3's RLS block shows only the permissive policy with the self-read disjunct and no restrictive counterpart — so the einsatz self-read is unbounded, which §16 item 2 of this same document calls a blocking defect. Fix: declare `create policy p_ma_ceiling on einsatz as restrictive for all to cse_app using (app.portal() <> 'mitarbeiter' or exists (select 1 from einsatz_zuordnung z where z.einsatz_id = einsatz.id and z.person_id = app.aktuelle_person() and z.entfernt_am is null))` and keep einsatz in rls.ts's ceiling registry.

- K-16 — §5.9 declares `mandant_id | uuid | **yes**` and labels it a '**Documented exception to K-16**'. K-16 states 'Tenant tables add `mandant_id uuid not null references mandant(id)`', and this document's own preamble says 'where this document and a convention disagree, the convention wins and this document is wrong'. The design is right (review B13 requires it) but a domain document cannot grant itself an exception to a binding convention. Fix: raise it as a §2.3 requirement to amend K-16 with a named carve-out for pre-resolution landing zones, then cite the amended K-16 rather than declaring a local exception.

## VERIFIER VERDICT

The rewrite is substantive and honest: all sixteen blocking findings genuinely landed in the file — I verified each against the written text rather than the claim, and fifteen are fixed with the mechanism, the reason and a named test, while B7's rejection is well-argued and correct (I confirmed 01-KERN §6.25 really does implement `bewegung_sperre_pruefen` + `korrektur_fuer_stundenkonto_id`, so the reviewer's `wirkungs_monat` would indeed have been a second mechanism for one rule, and re-dating a §17 MiLoG record is the one thing that record must not do). The hard invariants hold throughout: no money column anywhere (§1.5, enforced as a blocking defect in §16), every instant `timestamptz` with Berlin boundaries via K-11's verbatim DST table, every tenant table with `mandant_id` + FORCE RLS + a `hat_recht` conjunct, costed rows on `anstellung_id` with `person_id` denormalised under a composite FK that makes drift impossible (D-09), the AI confined to handles (§14.5), and legal values either SPEC-stated or behind a labelled interface with a matching TODO(client). It is not yet fit to implement against as written, for a small number of concrete reasons, most of which are one-line corrections: `app.arbzg_befund_schreiben` tests `current_user` inside a SECURITY DEFINER body, so the nightly cross-entity detector — the flagship TIM-14 path — can never write a finding; `me_definer_insert` names a column that does not exist, so the migration fails; `loeschsperre default true` combined with §13/§18.30 means no retention deadline is ever computed; `zeiteintrag.gesperrt_am` has no writer, so the whole B7 substitute never fires; the offline promotion path is blocked by its own definer policy; and `einsatz` is missing the K-04 ceiling that K-04 enumerates by name. Fix those six plus the K-01/K-08 grant for the offline endpoint, and the document becomes a schema contract a Phase 1 implementer can follow without guessing.
