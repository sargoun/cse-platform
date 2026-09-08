# Verification findings — radar-ki-inhalt

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (11)

### R1. Restrictive policies are ANDed with every other restrictive policy. With shape 1 on every table and shape 2/3/4 added 'on top', a worker session (portal = 'mitarbeiter') evaluates `false AND (…)` on every table in the system, and a customer session likewise. The worker and customer portals return zero rows — this is exactly the failure mode B1 identified, reintroduced one section later. It contradicts §12.7, §5.2, isolation assertion 7 ('rows from both A and B') and assertions 16/17, and it contradicts the peer document 03-GEWERKE.md §1.8, where the three ceilings are alternatives ('the build fails when a table in this domain carries none of the three'), not layers.

**Where:** §8.5, 'Restrictive ceilings — deny by default', shape 1: `create policy p_intern_ceiling on <tabelle> as restrictive for all to cse_app using (app.portal() = 'intern');` introduced as 'the default, applied to every table'

**Fix:** State that each table carries exactly ONE portal ceiling: `p_intern_ceiling` for internal-only tables, `p_ma_ceiling`/`p_ma_einsatz` for worker-reachable ones, `p_kunde_ceiling` for customer-reachable ones — or, if a deny-by-default single policy is wanted, make it one policy per table whose USING is `app.portal() = 'intern' or <that table's opt-in disjunct>`. Add a meta-test asserting no table carries two restrictive portal policies.

### R2. A restrictive policy can only narrow; it never grants. For the einsatz-derived tables the document supplies only shape 3 (restrictive) and no permissive path: the Class-T policy still requires `app.hat_recht('objekt.lesen', …)`, which the `mitarbeiter` role does not hold (§12.7: 'zeit.abwesenheit_melden and nothing else by default'), and §7.5's self-branch disjunct is keyed on `person_id = app.aktuelle_person()`, a column none of objekt, auftrag, dienstanweisung, wachbuch_eintrag, lv_position, bautagebuch or dokument carries. As written a guard can read no Dienstanweisung, no Wachbuch entry and no object at all, and can write no Wachbuch entry — SEC-05/SEC-06/CLN-04/BAU-02 have no worker path.

**Where:** §12 legend ('`S` — reached without a right, through the self-access branch of §7.5') applied in §12.3 to `objekt.lesen`, `auftrag.lesen`, `dienstanweisung.lesen`, `wachbuch.lesen`, `wachbuch.schreiben`, `schluessel.*`, `bau.lesen`, `bau.aufmass_erfassen`, `nachweis.*`, `dokument.lesen/schreiben`, `kalender.lesen`, `aufgabe.*`, `nachricht.*`, and §12.3's note 'MA: objects of own assignments, via the ceiling of §8.5 shape 3'

**Fix:** For each of the eight tables state the permissive mechanism explicitly — either grant the module read right to `mitarbeiter` in the seed matrix (narrowed by the shape-3 ceiling), or add a named permissive disjunct to the Class-T USING clause keyed on the einsatz-derived subquery, per table, with the key column named. The `S` glyph must then say which of the two it means.

### R3. K-08 says 'Three functions, and only these three, may execute outside withTenant', and K-01 grants `cse_checkin` 'EXECUTE on app.checkin_verbrauchen only'. `app.offline_ereignis_annehmen` is a fourth session-less function on that role. It also contradicts this document's own §6.3 ('The three pre-session functions of K-08 are the only code that reaches Postgres outside them, and tests/invariants/route-manifest.test.ts asserts it') — the stated route-manifest test would fail on the TIM-09 path the same document designs.

**Where:** §8.2 role table ('`cse_checkin` … `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` only'), §5.4 step 1 and §5.5 ('app.checkin_verbrauchen and app.offline_ereignis_annehmen are the only write paths in the platform with no session behind them')

**Fix:** Either fold the offline replay into `app.checkin_verbrauchen` (an `art` argument), or amend K-08/K-01 first and then cite the amended convention; in both cases reconcile §6.3's 'three' with §8.2's grant list before any test is written against it.

### R4. DELETE consults only USING, never WITH CHECK. With `using (true)` an `aal1` principal holding `system.rolle_verwalten` can DELETE `benutzer_mandant` and `rolle_berechtigung` rows — i.e. revoke memberships and rights — without a second factor, although the row above promises the gate covers DELETE (K-15: 'the write path of the permission-administration tables — rolle_berechtigung, benutzer_mandant INSERT/UPDATE/DELETE').

**Where:** §3.2 layer 6 and its SQL: 'one restrictive policy, on the write path only, on rolle_berechtigung and on benutzer_mandant INSERT/UPDATE/DELETE' vs `create policy rb_aal2 … as restrictive for all to cse_app using (true) with check (app.aal() = 'aal2')`

**Fix:** Split it: keep `as restrictive for insert/update … with check (app.aal() = 'aal2')` and add `as restrictive for delete to cse_app using (app.aal() = 'aal2')`. (01-KERN.md §6.7 states 'Kein DELETE' for rolle_berechtigung — say the same here for benutzer_mandant, or add the delete-side policy.)

### R5. Those four tables have no `anstellung_id` column, so the policy as written is not creatable on them. The peer document keys them correctly (01-KERN.md: `person_ma_ceiling … using (app.portal() <> 'mitarbeiter' or id = app.aktuelle_person())`, `anstellung_ma_ceiling … or person_id = app.aktuelle_person()`), so this document, which says its names are the contract, would be copied into a migration that fails.

**Where:** §8.5 shape 2, presented as 'K-04 verbatim': `using (app.portal() <> 'mitarbeiter' or anstellung_id in (select id from anstellung where person_id = app.aktuelle_person()))`, then applied to a list that includes `anstellung`, `person`, `nachweis` and `bewacher_eintrag`

**Fix:** Split the enumeration into the two key columns as 01-KERN.md §1.4 does — `anstellung_id in (select id from anstellung where person_id = app.aktuelle_person())` for the employment-hung tables, `person_id = app.aktuelle_person()` (and `id = …` for `person`) for the person-hung ones — and say which table takes which.

### R6. `benutzer`, `benutzer_mandant`, `rolle_berechtigung`, `mandant_kennzahl`, `audit_kette` and `audit_feld_klassifikation` are named throughout (§8.2 definer registry, §7.1, §18 indexes) but are placed in no class and given no permissive policy. Under FORCE RLS with no permissive policy, `cse_app` reads zero rows from `benutzer` and `benutzer_mandant`, so the user list of §12.1 (`system.benutzer_lesen`) and the permission editor (`system.rolle_lesen`) have no read path — and B1's required 'explicit permissive select policy for benutzer_mandant' is absent. The document also fails its own §17.3 meta-test on the first migration.

**Where:** §8.5 policy classes (T, P, G, A, S) read against §17.3 ('every table in public and in zeit_intern … must appear in the declared class map in src/server/db/rls.ts. An unclassified table fails the build') and §3.2's restrictive write policies on `rolle_berechtigung` and `benutzer_mandant`

**Fix:** Add the missing rows to a class (Class G or a stated Class S extension) with their permissive SELECT predicates, mirroring 01-KERN.md §6.6–§6.8, or state explicitly that §8.5's class map is a summary and that 01-KERN.md owns these six — and then reconcile §17.3's wording.

### R7. Because the benutzer PK is the auth.users FK, every service principal — the four agents of D-03, each job identity, the public renderer — still requires an auth.users row, which is precisely what the paragraph above argues against. The document never says how such a row is created (a Drizzle migration cannot insert into auth.users), nor that it carries no password, phone or MFA factor at the auth level, so the review's seed objection is restated rather than answered.

**Where:** §1.1 ('a fabricated auth.users row for every cron identity would be a credential in the auth store that can, in principle, be issued a token') against §1.5 ('`id` uuid PK | **is** the FK to auth.users.id')

**Fix:** State the creation path for a service principal (Supabase admin API in the seed script, with `ist_dienstkonto = true` set in the same transaction and no credential of any kind), and rewrite the §1.1 sentence so the objection it raises is the one the flag actually answers — that such a row can never be issued a session.

### R8. There is no assertion for the einsatz-derived ceiling, which the review's B19 required by name. Assertions 6 and 17 cover zeiteintrag and route access, not object scope, so the newly designed `Z`→ceiling mechanism ships unproven — the same 'ships green' condition B19 complained about.

**Where:** §17.2 assertion list (27 assertions) against §8.5 shape 3 and §12.3

**Fix:** Add: `ma_p2` reads exactly the `objekt`, `dienstanweisung` and `wachbuch_eintrag` rows of their own Einsätze and gets 404 on every other row of the same mandant.

### R9. If the table lives in schema `kern` (as 01-KERN.md §3.3 has it), the meta-test that scans `public` and `zeit_intern` does not see it, and the class-map assertion that B9 was fixed with silently excludes the fastest-growing security table. If it lives in `public`, the §10 prefix is wrong. Either way the contract is ambiguous in a document whose names are binding.

**Where:** §10 rate-limit table row: '`kern.anmeldeversuch`' — the only place a schema prefix is used, against §8.5 Class S ('anmeldeversuch'), §18 ('anmeldeversuch_ip_idx') and §17.3 ('every table in public and in zeit_intern')

**Fix:** Use one name throughout, and extend the §17.3 scan to `kern` (and any other application schema) so the 'every table appears in the class map' assertion means what it says.

### R10. K-17 names 'retention periods beyond those the SPEC states' as a value that must appear as a labelled placeholder. SPEC states no retention for auth telemetry. The value is softened elsewhere (§11.2 'Proposal, to be confirmed'; O-32 'confirm 30 days'), but at §10 it is asserted as a decided rule, which is where an implementer will read it.

**Where:** §10: '`anmeldeversuch` is DSGVO-scoped telemetry with a **30-day** retention and a scheduled prune'

**Fix:** Mark the §10 occurrence as PLACEHOLDER read from `einstellung` (like the session lifetimes of §4.3) and point it at O-32.

### R11. Those files do not exist; the siblings are `04-SEITENKARTE.md`, `05-API-KARTE.md` and `06-AGENTEN-FREIGABEN.md`. §21 correctly notes that 01-ORDNERSTRUKTUR.md uses yet another pair of names for this document, so the numbering drift is already known — three dangling cross-references in the ownership table are the part that will send an implementer to a missing file.

**Where:** §0 'This document does not own' table: '`05-SEITENKARTE.md`', '`06-API-KARTE.md`', '`07-AGENTEN-ARCHITEKTUR.md`'

**Fix:** Correct the three filenames to the files present in docs/architecture/.

## CONVENTION VIOLATIONS (5)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-08 / K-01 — §8.2: '`cse_checkin` | the tokenised check-in endpoint | `EXECUTE` on `app.checkin_verbrauchen` and `app.offline_ereignis_annehmen` only'. K-08: 'Three functions, and only these three, may execute outside withTenant'; K-01: '`cse_checkin` … `EXECUTE` on `app.checkin_verbrauchen` only.' A fourth session-less function is added, and it contradicts this document's own §6.3.

- K-04 — §8.5: 'create policy p_intern_ceiling on <tabelle> as restrictive for all to cse_app using (app.portal() = 'intern');' described as 'the default, applied to every table', with the K-04 worker ceiling added as a second restrictive policy. K-04 provides one ceiling per table ('carries a restrictive ceiling in addition to K-03'); two ANDed restrictive portal policies make every worker and customer session read zero rows.

- K-04 — §8.5 shape 2 is labelled 'K-04 verbatim' and then applied to `anstellung`, `person`, `nachweis`, `bewacher_eintrag`, none of which carries the `anstellung_id` column the shape references. K-04's enumeration mixes anstellung-hung and person-hung tables; the document must split the predicate, as 01-KERN.md §1.4 does.

- K-15 — §3.2: 'one restrictive policy, on the write path only, on rolle_berechtigung and on benutzer_mandant INSERT/UPDATE/DELETE' is implemented as `for all … using (true) with check (app.aal() = 'aal2')`, which does not gate DELETE. K-15 requires the gate on 'benutzer_mandant INSERT/UPDATE/DELETE'.

- K-17 — §10: 'a **30-day** retention and a scheduled prune' is stated as a decided retention period. K-17: 'retention periods beyond those the SPEC states' must be a labelled placeholder plus TODO(client); the TODO exists at §11.2/O-32 but the §10 statement is not marked.

## VERIFIER VERDICT

All twenty BLOCKING items genuinely landed: I could quote, for each one, the sentence or SQL block in the written file that resolves it, and in the four cases where the author deviated from the reviewer's proposed remedy (B2 no BYPASSRLS, B12 flag instead of nullable FK, B14 resolution instead of a scalar, B17 rename) the deviation is the conventions' answer rather than an evasion. Money is bigint cents throughout (`monatslimit_cent`, €20,000 → `2000000`, `stundensatz_intern_cent`), every instant is timestamptz, the only `date` columns are calendar values compared against `app.berlin_heute()` per K-11, D-09's split is respected in both directions (`mobil_e164`/`sprache`/`nachweis` on `person`; the composite `(mandant_id, anstellung_id)` FKs with the matching `anstellung_mandant_uk` on costed rows), no external system is simulated (`NotConnectedError`, 'nicht verbunden', DATEV interface-only until O-05), and the invented rules the review flagged are now O-14…O-32. It is nonetheless not yet fit to implement against, for two reasons that are the same class of error B1 was about: §8.5 layers a blanket restrictive `app.portal() = 'intern'` ceiling on *every* table under the ANDed worker/customer ceilings, which blanks the worker and customer portals outright and contradicts the peer 03-GEWERKE.md §1.8; and the new `S` glyph in §12.3 tells an implementer that a worker reaches `objekt`, `wachbuch_eintrag`, `dienstanweisung`, `dokument` and six more 'without a right, through the ceiling', when a restrictive ceiling grants nothing and no permissive path is defined for those tables. Fix those two, add the DELETE half of the aal2 gate, key the ceiling shape per table, classify `benutzer` / `benutzer_mandant` / `rolle_berechtigung`, and resolve the fourth session-less function against K-08, and this document is implementable.
