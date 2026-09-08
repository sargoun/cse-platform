# Verification findings — kern

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (16)

### R1. `cse_anon` is given table reads, which K-01 forbids outright ('`cse_anon` … EXECUTE on exactly the three functions in K-08. **No table grants at all.**'). §6.1 l.974-978: '`SELECT` für `cse_anon`: nur über die View `mandant_oeffentlich` … Die View ist `security_invoker = true`'. §6.2 l.1039: '`SELECT` für `cse_anon`: `oeffentlich_sichtbar`' — an RLS policy `to cse_anon` on `mandant_identitaet` is inert without a table GRANT. And a `security_invoker = true` view requires the caller to hold base-table SELECT, which `cse_anon` by K-01 does not and must not have. This is the exact B2 failure mode reproduced on the public path: as written the public company profile (PUB-01, PRO-01) does not load at all.

**Where:** §6.1 l.974-978 and §6.2 l.1039, against K-01 (00-KONVENTIONEN.md l.24)

**Fix:** Either serve the public profile through a fourth pre-session `SECURITY DEFINER` function owned by `cse_definer` (and record the K-08 deviation, since K-08 permits exactly three), or state that the public pages are rendered server-side inside a `withTenant`-equivalent wrapper running as `cse_app`/`cse_job` with no anon role involved. Do not leave `cse_anon` holding a table or view grant.

### R2. §11's grant block revokes table-wide SELECT on `person` and `anstellung_kondition` but never issues the matching `GRANT INSERT, UPDATE`. `anstellung` (l.2627) and `abwesenheit` (l.2654) both get `grant insert, update … to cse_app`; `person` (l.2637-2643) and `anstellung_kondition` (l.2630-2634) get only `revoke select` + `grant select (...)`. §6.13 defines `person_insert` and `person_update` policies and §6.15 says conditions are written by users — but a policy without a table privilege is inert, so no person and no condition can ever be created by `cse_app`.

**Where:** §11 l.2618-2655

**Fix:** Add `grant insert, update on person to cse_app;` and `grant insert on anstellung_kondition to cse_app; grant update (gueltig_bis) on anstellung_kondition to cse_app;` to the §11 block, and state in §11 that the build check verifies every table with an INSERT/UPDATE policy also holds the corresponding privilege.

### R3. `grant insert, update on anstellung to cse_app` (l.2627, 'all columns writable, policy-gated') contradicts §6.14's own rule that the mirror columns have 'genau einem Schreiber (`kern.anstellung_kondition_spiegeln`)' (l.1656-1657). A `leitung` holding `personal.schreiben` can `UPDATE anstellung SET stundensatz_intern = …` — a blind write to a column they may not read, silently overwritten by `job:kondition_spiegel` the next night, with the dated truth in `anstellung_kondition` untouched.

**Where:** §11 l.2627 vs §6.14 l.1650-1660

**Fix:** Narrow the grant: `grant update (personalnummer, eintritt, austritt, status, befristet_bis, probezeit_bis, vorgesetzter_anstellung_id, austritt_grund, archiviert_am) on anstellung to cse_app;` — omitting `stundensatz_intern`, `tarifgruppe`, `arbeitszeitmodell`, `wochenstunden`, `arbeitstage_woche`, `kostenstelle`, i.e. exactly the trigger-maintained mirror set. Add it to §11's matrix and to the `rls.ts` registry so a new mirror column cannot be granted by accident.

### R4. The supervisor disjunct in `person_select` is unreachable. The policy is `app.person_sichtbar(id) AND (self OR personal.lesen OR <supervisor exists>)` (l.1574-1584). `app.person_sichtbar` is deliberately `SECURITY INVOKER` (l.530-535) and its only non-self, non-super-admin branch is `exists (select 1 from public.anstellung a where a.person_id = p_person)` — filtered by `anstellung`'s own policy, which grants a row only on `person_id = app.aktuelle_person()` or `hat_recht('personal.lesen')` (l.1687-1689). A supervisor without `personal.lesen` therefore fails the outer `person_sichtbar` conjunct before the supervisor branch is ever evaluated; a supervisor with `personal.lesen` matches the second disjunct anyway. The branch that B3 asked for cannot fire.

**Where:** §6.13 l.1574-1584 with §3.2 l.530-535 and §6.14 l.1686-1689

**Fix:** Either add a supervisor branch to `app.person_sichtbar` itself (`or exists (select 1 from anstellung a join anstellung v on v.id = a.vorgesetzter_anstellung_id where a.person_id = p_person and v.person_id = app.aktuelle_person())`, which is visible to the supervisor because `v` is their own row), or delete the supervisor disjunct from `person_select` and state that team visibility runs through `personal.lesen` alone.

### R5. `app.person_sichtbar`'s body in §3.2 (l.530-535) omits the bootstrap-anchor disjunct that §6.13 (l.1543-1549) says lives 'innerhalb app.person_sichtbar (§3.2)'. A reader implementing §3.2 verbatim loses the `erfasst_von_mandant_id` bootstrap entirely, and a newly created person is visible to nobody until their first `anstellung` exists — which is the very problem §6.13 says the anchor solves.

**Where:** §3.2 l.530-535 vs §6.13 l.1536-1554

**Fix:** Fold the §6.13 fragment into the §3.2 function body so one complete definition exists, keeping the `and not exists (select 1 from anstellung …)` lapse condition and the `// TODO(client)` beside it.

### R6. §1.1's list of tables that are 'not tenant tables in the K-03 sense' (l.70-74) is presented as exhaustive and is what `src/server/db/rls.ts` enforces, but it omits `person`, `nachweis`, `bewacher_eintrag`, `benutzer_feed_token`, `qualifikation`, `abwesenheitsart`, `antragsart` and `bewachertaetigkeit` — none of which is scoped by `mandant_id = app.aktiver_mandant()`. `person` alone carries four permissive `to cse_app` policies (`person_select`, `person_gruppe`, `person_insert`, `person_update`, l.1574-1600), so the stated build check ('exactly two permissive policies to cse_app on every tenant table — no more, no fewer') fails on this document's own schema.

**Where:** §1.1 l.70-74 vs §6.13 l.1574-1606

**Fix:** Extend the §1.1 exception list to name all eight tables and say what shape each takes instead (employment-derived, person-derived, catalogue), or restate the build check as 'every table carrying a non-null `mandant_id` column'.

### R7. `kern.anmeldeversuch` carries a hard-coded 30-day retention with no `TODO(client)` — §3.3 l.732 ('eine **30-day** retention'), §12.3 l.2741 ('deletes `anmeldeversuch` rows older than 30 days'), §15 l.2925 ('deleted after 30 days by job | AUT-07, proportionality'). The SPEC states only 10 years (LEG-01/ACC-06) and 2 years (LEG-02/TIM-13); AUT-07 (SPEC l.104) says only 'Rate limiting and lockout on auth endpoints'. K-17 lists 'retention periods beyond those the SPEC states' as a value that must be a labelled placeholder. §16 item k covers the AUT-07 thresholds but not the retention, and §9.3's retention TODO covers `audit_log` classes only.

**Where:** §3.3 l.732, §12.3 l.2741, §15 l.2925, against K-17

**Fix:** Mark it: `retention **PLACEHOLDER** 30 Tage` plus `// TODO(client): wie lange dürfen fehlgeschlagene Anmeldeversuche (kennung_hash, IP) aufbewahrt werden — Vorschlag 30 Tage, Verhältnismäßigkeit nach DSGVO?` and add it as a row to §16 and to DECISIONS.md under Open.

### R8. `dienstplan.arbzg_pruefen` is assigned module `einsatz` in §7 (l.2402) and granted to super_admin/admin/leitung in §14.3 (l.2884), but §14.2 (l.2849-2851) says the Phase 1 `berechtigung` catalogue seeds only the modules `system`, `stammdaten`, `personal`, `zeit`, `gruppe`. The key is therefore never seeded, `app.hat_recht` treats it as an unknown key and returns false, and §8's precondition refuses every ArbZG call. It is also the only key in the document whose first segment (`dienstplan`) is not its `modul` (`einsatz`), and `dienstplan` is absent from §6.6's enumerated module list (l.1201).

**Where:** (not stated)

**Fix:** Either add `einsatz` to the Phase 1 seed module list in §14.2 and seed the single row, stating that the rest of the `einsatz` catalogue ships in Phase 5; or move the grant out of §14.3 into the Phase 5 migration and say so. Either way reconcile the key's first segment with `modul` or state explicitly in §6.6 that the two need not match and why K-06 fixes this key's spelling.

### R9. §17 test 4 (l.2991-2992) is vacuous as written: `app.hat_recht('rechnung.erstellen', …)` is false in group scope not because of the `aktion not in ('lesen','exportieren')` guard but because `finanzen` rights are not seeded in Phase 1 (§14.2 l.2849-2851), so the key is unknown and the resolver's `when not exists (select 1 from recht) then false` branch fires first. The test that B5 rests on would pass against a resolver with no group guard at all.

**Where:** §17 l.2991-2992

**Fix:** Assert against a key that exists in the Phase 1 catalogue and is not a read: e.g. `app.hat_recht('personal.aendern', <mandant>)` is false and `app.hat_recht('gruppe.personal.lesen', <mandant>)` is true with `app.scope = 'gruppe'`, and add a third assertion that the same `personal.aendern` call is true with `app.scope = 'mandant'` — otherwise the test cannot distinguish the guard from a missing grant.

### R10. `mitarbeiter_zugang_benutzer_key UNIQUE (benutzer_id) WHERE benutzer_id IS NOT NULL` (l.1964) is not partial on the liveness column, unlike its sibling `mitarbeiter_zugang_person_key … WHERE deaktiviert_am IS NULL` on the same table. Because `deaktiviert_am` is a soft delete and no hard delete exists, a worker whose access is deactivated and later re-invited inserts a new row (permitted by the person index) that then collides on `benutzer_id` — the exact B9 failure class, on a table B9's fix list did not enumerate. §1.8's table (l.259-266) does not list it and its 'deliberately unconditional' paragraph names only two other indexes.

**Where:** §6.21 l.1964 vs §1.8 l.251-272

**Fix:** Make it `UNIQUE (benutzer_id) WHERE benutzer_id IS NOT NULL AND deaktiviert_am IS NULL` and add the row to §1.8's table, or state in §1.8 why it is a third deliberate exception.

### R11. `app.zugang_aktivieren` binds the invitation with `p.mobil_e164 = u.phone` (l.375-378), but `person.mobil_e164` carries `CHECK (mobil_e164 ~ '^\+[1-9][0-9]{6,14}$')` (l.1521) while Supabase GoTrue normalises `auth.users.phone` to digits without the leading `+`. As written the equality never holds, every redemption returns zero rows, and §2's own rule 'Zero rows returned is the 409' turns every legitimate invitation into a 409. The same mismatch would make `job:zugang_nummer_abgleich` (l.2742) report divergence on 100% of rows.

**Where:** (not stated)

**Fix:** Compare on a normalised form on both sides, e.g. `and ltrim(p.mobil_e164,'+') = ltrim(u.phone,'+')`, state the normalisation rule once in §2 next to the E.164 CHECK, and have `job:zugang_nummer_abgleich` use the same expression. Verify the exact GoTrue storage format before fixing the direction.

### R12. §1.3 states the normative tenant policy shape (l.106-138) without the archived-mandant write conjunct that §3.2 (l.486-487) mandates as part of the B14 fix and that §6.14 actually shows (l.1693-1694). A reader emitting policies from §1.3 — which the text says is what `src/server/db/rls.ts` emits (l.140) — produces write policies that still accept an archived mandant.

**Where:** §1.3 l.106-138 vs §3.2 l.486-487

**Fix:** Add the conjunct to the §1.3 `with check` template and to the sentence naming what `rls.ts` emits, so the normative form and the fix are the same text.

### R13. `benutzer_feed_token`'s access path is self-contradictory and sits outside K-08. §6.10 (l.1385-1389) says the feed is served by 'einer eigenen, sitzungslosen Route … die **nicht** unter K-08 fällt, weil sie … keinen Datenbankzugriff außerhalb einer eigens dafür geöffneten `withTenant`-Transaktion vornimmt (der Token löst `benutzer_id` und daraus die Mandanten auf)'. Resolving the token to a `benutzer_id` *is* a database read before any principal exists, and the table's own policy is `benutzer_id = app.aktueller_benutzer()`, which is NULL at that moment — so the lookup returns zero rows and the feed can never resolve. K-08 permits exactly three pre-session functions and requires a route-manifest test asserting no other path reaches the database outside `withTenant`.

**Where:** §6.10 l.1385-1389, against K-08

**Fix:** Give the feed its own `SECURITY DEFINER` resolver (`app.feed_token_aufloesen(p_token_hash text) returns uuid`), state it as a K-08 deviation with the reason and record it in DECISIONS.md, or defer `benutzer_feed_token` to the Phase 9 document where CAL-03 is specified. Do not leave a session-less route claiming it does no pre-session database access.

### R14. K-16 requires `erstellt_am timestamptz not null default now()` on every table; three tables in this document have none: `mandant_kennzahl` (§6.3 l.1059-1065 — only `berechnet_am`), `audit_feld_klassifikation` (§6.12 l.1481-1488) and `bewachertaetigkeit` (§6.20 l.1920-1927). `bewachertaetigkeit` also has no `erstellt_von`/`geaendert_von` although §6.22 adds exactly those to `abwesenheitsart` on the argument that catalogue rows carrying payroll-relevant settings need accountability.

**Where:** §6.3, §6.12, §6.20

**Fix:** Add `erstellt_am` to all three and `erstellt_von`/`geaendert_von`/`geaendert_am` to `bewachertaetigkeit`, per K-16.

### R15. Schema qualification drifts for the three `kern` tables. §0 l.19 lists `audit_kette`, `audit_feld_klassifikation` and `anmeldeversuch` in `schema/kern.ts`; §9.1 l.2510-2524 writes `kern.audit_kette`; §9.2 l.2549 writes `kern.audit_feld_klassifikation`; §3.3 l.729 and §6.12 l.1490 write `kern.anmeldeversuch` — but §3.5's definer read registry (l.765-767) lists all three unqualified alongside `public` tables, §6.11 l.1402 writes `FK → audit_kette.id`, and §12.3 names `job:anmeldeversuch_purge`. Since §0 l.30-32 creates `kern` as a schema for 'trigger functions and registries' and every definer function is `SET search_path = pg_catalog, public`, an unqualified reference to `kern.audit_kette` from inside `app.protokolliere()` would not resolve.

**Where:** (not stated)

**Fix:** Pick one placement per table and qualify it consistently everywhere, including §3.5's registry and §6.11's FK note. If they live in `kern`, say whether `kern` is in the definer functions' `search_path` or whether every reference is schema-qualified (K-01 fixes the search_path to `pg_catalog, public`, so it must be the latter).

### R16. `person.mobil_e164`, `telefon`, `email`, `strasse`, `plz`, `ort` are classified in the §9.2 audit registry behind `personal.lesen` (l.2566) while §11 grants all six to `cse_app` for direct SELECT (l.2638-2640). The stated drift test ('every column carrying a K-05 column-privilege restriction also has a classification row', l.2575-2577) is one-directional and does not catch the reverse, so the registry and the grant matrix already disagree on six columns on the day they ship.

**Where:** §9.2 l.2566 vs §11 l.2638-2640

**Fix:** Either state explicitly that the registry may be a superset of the omitted-column list (and why — the audit payload is readable by `system.audit_lesen` holders who need not hold `personal.lesen`), or make the drift test bidirectional and reconcile the six rows.

## CONVENTION VIOLATIONS (0)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

## VERIFIER VERDICT

All nineteen blocking findings are genuinely fixed in the written file — not merely claimed. I checked each one against the text rather than the changelog: the masking views are gone and replaced by a complete, enumerated column-grant matrix in §11 with the K-05 reasoning restated; `hat_recht` takes a mandant argument and carries an explicit group-scope read-only guard; `ist_super_admin` now carries the lockout, deactivation, live-session and `aal2` gates and resolves the role from `geltungsbereich`; the ArbZG crossing is designed with K-06's contract verbatim, including the correct decision to write its preconditions as explicit predicates because an invoker helper would evaluate as the definer; the audit log has a real `SELECT … FOR UPDATE` hash chain and the document explicitly retracts the claim that `lfd_nr` proves anything; the `current_date` CHECK is gone and the ban is platform-wide with a CI grep; every uniqueness the review named is partial; the composite-FK inventory in §12.4 is complete and every parent unique it claims is actually declared. The two places where the author departed from the reviewer's prescription — K-06's signature over a per-day aggregate, and declining a `system.alles` permission row that would make the resolver recursive — are both correct, and the second is exactly the kind of re-litigation the conventions exist to settle. The document is fit to be implemented against, with one caveat that should be closed first: three of the residual defects are load-bearing rather than cosmetic. §11 revokes table-wide SELECT on `person` and `anstellung_kondition` without issuing the matching INSERT/UPDATE grants, so as written no person and no employment condition can be created at all; `cse_anon` is handed a view and a policy on two tables in direct breach of K-01's 'no table grants at all', which silently breaks the public profile; and the supervisor branch B3 asked for is unreachable because `app.person_sichtbar` gates on `anstellung` visibility that already requires `personal.lesen`. Those three plus the un-TODO'd 30-day retention (a K-17 defect) and the unseeded `dienstplan.arbzg_pruefen` module should be corrected before Phase 1 migrations are written; the rest are tightening.
