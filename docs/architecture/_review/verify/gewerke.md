# Verification findings — gewerke

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (14)

### R1. `select ... from app.qualifikationsanforderung(p_einsatz) a join public.qualifikation q on q.id = a.qualifikation_id where a.zwingend and q.rechtsgrundlage ilike '%34a%'` reads `qualifikation.rechtsgrundlage`, a column that exists nowhere: §2.1's contract for `qualifikation` requires `id, mandant_id, schluessel, bezeichnung, bezeichnung_i18n, blockiert_einsatz, warnung_tage, archiviert_am` and no `rechtsgrundlage`, and `01-KERN.md` does not define one. `rechtsgrundlage text` is a column of `einsatzanforderung` (§6.6). The function therefore fails with 42703 on every `einsatz_zuordnung` insert — no guard can be assigned at all — and once the column reference is corrected, keying a statutory obligation on `ilike '%34a%'` over free text means a typo ('34 a', 'Sachkundeprüfung') silently switches off the Bewacherregister check.

**Where:** §9.3, `app.einsatz_qualifikation_erfuellt`, the `v_bewachung` query

**Fix:** Read `a.rechtsgrundlage` from the requirement row, or better: add an explicit `bewacherregister_pflicht boolean not null default false` to `einsatzanforderung` and key `v_bewachung` on it, with the free-text `rechtsgrundlage` kept for display only. Add a test asserting that a §34a requirement entered with a differently spelled `rechtsgrundlage` still triggers the register check.

### R2. A constraint trigger is always AFTER, and an AFTER row trigger's assignments to NEW are discarded — `new.qualifikation_geprueft_am := now(); new.qualifikation_snapshot := v_ergebnis; return new;` writes nothing. The §9.4 CHECK then requires both columns to be non-null for any assignment with `abgesagt_am is null`, so exactly the paths §9.3 claims to protect ('backfills, scripts and console access that bypass the service') are rejected, while the service path passes only because §9.2's TypeScript writes the columns itself. The database-level proof the section advertises does not exist.

**Where:** §9.3, `create constraint trigger einsatz_zuordnung_qualifikation ... after insert or update`, with §9.4's CHECK

**Fix:** Split the two jobs: a BEFORE INSERT OR UPDATE trigger on `einsatz_zuordnung` calls `app.einsatz_qualifikation_erfuellt` and stamps `qualifikation_geprueft_am`/`qualifikation_snapshot`; the deferrable constraint trigger only re-reads and raises. Add a test that inserts an `einsatz_zuordnung` directly via SQL with no service involvement and asserts both proof columns are populated.

### R3. Both definer functions read tables that are not in the definer read registry: `app.qualifikationsanforderung` selects `public.einsatzanforderung` (owned by this domain, `enable`+`force row level security` per §5 preamble, policies `to cse_app` only) and §9.3 joins `public.qualifikation` (KERN). `cse_definer` matches no `to cse_app` policy and FORCE RLS removes the owner exemption, so the resolver returns **zero rows**, `v_fehlend` stays empty and the gate returns `'erfuellt': true` for every assignment. Unlike the B3 failure this one fails **open**: SEC-04/LEG-04 is silently not enforced and no test in §14 would catch it, because tests 9-12 all use callers who can also read the tables. §2.3 requests only `nachweis`, `bewacher_eintrag`, `einsatz`, `einsatz_zuordnung`; §1.10's sentence naming the definer's read needs omits both tables too. The same gap applies to `mandant_einstellung`, read by the definer `app.uebergabe_fenster()`.

**Where:** §9.2 `app.qualifikationsanforderung` and §9.3, against §2.3 item 1 and `01-KERN.md` §3.5

**Fix:** Add a narrow `create policy ea_definer on einsatzanforderung for select to cse_definer using (true)` in this document, extend §2.3/§17 item 1 to require `qualifikation` and `mandant_einstellung` in the `01-KERN.md` §3.5 registry, and add a test: a session holding no `security.lesen` assigns a person with a missing certificate and the insert must still be **refused**.

### R4. §1.7 states '`wachbuch.lesen` is **not** in the default `mitarbeiter` grant — a guard reaches their own entries through the ceiling, not through the module right'. Under K-03 the permissive `t_mandant` policy already requires `app.hat_recht('wachbuch.lesen', …)`, and a restrictive ceiling can only narrow, never grant. A guard therefore reads zero rows of `wachbuch_eintrag`, including the ones they wrote, which breaks SEC-05 and the handover design of §6.12; test 3 ('a `mitarbeiter` session reads its own `da_kenntnisnahme` and `wachbuch_eintrag` rows') asserts the opposite of §1.7 and would fail. The same reasoning applies to `nachweis`-style self-access, which KERN solved by putting the self branch in the permissive policy.

**Where:** §1.7 (right keys) vs §1.8, §6.12 and test 3

**Fix:** Grant `wachbuch.lesen` (and `wachbuch.schreiben`) to `mitarbeiter` and let `p_ma_ceiling` + `app.uebergabe_sichtbar()` do the narrowing — that is precisely K-04's division of labour — and delete the sentence in §1.7. State explicitly per role which of the eight module rights a `mitarbeiter` holds, since §1.7 currently denies only *write* rights.

### R5. The customer ceiling for `aufmass*` is specified as `denormalised kunde_id, and status <> 'entwurf'`, and `denormalisiere_kunde()` lists `aufmass_zeile` and `aufmass_foto` among its targets — but neither table's column list contains `kunde_id`, and §12 lists no such FK for them. The policy references a column that does not exist, so the migration fails. Separately, no child table carries the head-status copy that §5.7 ('the same `status`/`storniert_am` clause applied through a trigger-maintained copy of the head status') and §1.8 (`status <> 'entwurf'`) both key on — so as written a customer either cannot be granted the rows at all or sees draft positions, which §1.8 says must never happen.

**Where:** §7.7 and §7.8 column tables, against §1.8, §5.7 and §13.1 `denormalisiere_kunde()`

**Fix:** Add `kunde_id uuid not null` (composite FK, trigger-maintained) to `aufmass_zeile` and `aufmass_foto`, and add the explicit denormalised head-state column — e.g. `kopf_status`/`kopf_gesperrt_am` — to `leistungsnachweis_position`, `leistungsnachweis_signatur`, `aufmass_zeile`, `aufmass_foto`, `aufmass_signatur`, name it in `denormalisiere_kunde()` (or a sibling trigger), and add it to the §1.9 grant lists and §12.

### R6. The stated semantics are 'BEFORE INSERT: new.<spalte> := now(); BEFORE UPDATE: raises on any change' (`02-CRM-OPERATIONS.md` §0.9 says the same). But `leistungsnachweis.vorgelegt_am` is set at `entwurf → vorgelegt`, `leistungsnachweis.gesperrt_am` is set by `enforce_ln_signierbar()` on signature, `aufmass.gesperrt_am` 'set with the countersignature', `bautagebuch.abgeschlossen_am`/`gegengezeichnet_am` at day close and `dienstanweisung_version.veroeffentlicht_am` at publication — all NULL→value transitions performed by an UPDATE. Read literally, the guard makes every one of those status transitions impossible, i.e. no Leistungsnachweis can be submitted or signed and no Bautagebuch can be closed.

**Where:** §1.11 (a), and every column in its `kern.erzwinge_serverzeit()` row

**Fix:** State the semantics precisely in §1.11: on INSERT and on the NULL→value transition the trigger sets `now()` itself and discards any supplied value; it raises only on a change to an already non-null value. Add a test for each of the six columns: the transition succeeds with the server instant, a second change raises, and a client-supplied instant is ignored.

### R7. Three inconsistencies in the enumeration the build test is said to run on: §1.8 lists `postenart` under `p_intern_ceiling` while §6.1 says 'p_intern_ceiling on `schluesselart`, none on `postenart` (a guard sees their post's type)'; §1.8 lists `kontrollpunkt` under the unconditional `using (app.portal() = 'intern')` while §6.11 says that ceiling is 'lifted for `mitarbeiter` via `app.ist_eingesetzt_auf_objekt(objekt_id)`'; and `pruefverfahren` is absent from all three ceiling lists although §8.1 assigns it `p_intern_ceiling` — under §1.8's own rule ('the build fails when a table in this domain carries none of the three') the enumerated list is the authority and would fail the build.

**Where:** §1.8 ceiling table vs §6.1, §6.11 and §8.1

**Fix:** Make §1.8's table the single source: give `postenart` and `kontrollpunkt` their own row with the `or app.ist_eingesetzt_auf_objekt(objekt_id)` widening spelled out as a fourth ceiling variant, add `pruefverfahren`, and delete the contradicting sentences in §6.1 and §6.11.

### R8. `aufmass.aufgenommen_von_anstellung_id` makes it an anstellung-hung table, and K-04 requires the restrictive `mitarbeiter` ceiling on every such table; `aufmass` carries only `p_kunde_ceiling`. §1.7 withholds from `mitarbeiter` only the *write* rights of `bau`/`qualitaet`/`reinigung`, so a field employee holding `bau.lesen` reads every Aufmaß sheet of the mandant (the prices are column-restricted, the quantities and customers are not). The same applies to `aufmass_zeile`/`aufmass_foto`, which have no employee ceiling either.

**Where:** §1.8 ceiling table, `aufmass` (K-04)

**Fix:** Add `p_ma_ceiling` on `aufmass` keyed on `aufgenommen_von_anstellung_id`, and on the children via the head, or state in §1.7 that `bau.lesen` is not in the `mitarbeiter` grant at all — and add that role/right matrix as a requirement on `04-BERECHTIGUNGSMODELL.md`.

### R9. K-05 column grants are exhaustive by construction: what is not granted is unreadable. The `lv_position` grant omits `geprueft_von` and `geprueft_am` — the two columns §7.5's APR-03 review queue, the `lv_position_pruefung_idx` predicate and the 'warning pill' UI all depend on — and omits the whole §1.2 Auditblock (`erstellt_von_art`, `erstellt_von`, `erstellt_von_person_id`, `erstellt_von_agent_id`, `geaendert_von*`), so 'which extraction run wrote this line' is unanswerable for `cse_app`. The `leistungsnachweis_position` grant has the same Auditblock omission.

**Where:** §1.9 column grants for `lv_position` and `leistungsnachweis_position`

**Fix:** Extend both `grant select (...)` lists with the review columns and the Auditblock, and add a schema test asserting that every column of a column-restricted table is either granted to `cse_app` or named in the accompanying 'omitted' comment — so an omission is always deliberate.

### R10. NULLs are distinct in a default unique index, and `vorheriger_hash` is NULL for the first entry of an object's chain. Two rows can therefore both claim to be the anchor of the same `(mandant_id, objekt_id)` chain, which is the same fork the constraint exists to prevent, at the one point in the chain that has no predecessor hash to contradict it. Test 25 only exercises two concurrent inserts against an existing head.

**Where:** §6.12, `wachbuch_kette_uk unique (mandant_id, objekt_id, vorheriger_hash)`

**Fix:** Declare it `unique nulls not distinct (mandant_id, objekt_id, vorheriger_hash)` (PG15+) or add `create unique index wachbuch_anker_uk on wachbuch_eintrag (mandant_id, objekt_id) where vorheriger_hash is null`, and extend test 25 to two concurrent *first* entries for one object.

### R11. The status is declared to be derived 'from the last ledger row of any kind', but the mapping from the eight event kinds to the five `schluessel_status` values is never stated. `wiedergefunden`, `entsperrung` and `inventur` have no target status at all — after an `inventur` row the derivation has no defined answer, and after `wiedergefunden` it is unstated whether the key returns to `im_depot` or to `ausgegeben` (which is the difference between a liability claim being open or closed). Test 29 exercises only `verlustmeldung`.

**Where:** §6.13 `refresh_schluessel_status()` / §3.2 `schluessel_ereignis_art`

**Fix:** State the mapping explicitly in §6.13 as a table (event → resulting status, with `inventur` and any other purely evidential event defined as status-neutral, i.e. 'the last status-bearing row wins'), and extend test 29 to `wiedergefunden` after `verlustmeldung` and to an `inventur` row following an `ausgabe`.

### R12. §9.1 promises 'a Bewachungseinsatz with no resolvable requirement set is **reported as ungeprüft**, never silently passed', and §6.6 repeats it in German ('§9.2 meldet jeden solchen Einsatz als ungeprüft statt ihn stillschweigend durchzulassen'). Nothing implements it: §9.3 returns `'erfuellt': true` whenever the resolver yields no rows, no column records 'ungeprüft', and §13.2 lists no job that finds such shifts. Since the mandant-wide baseline deliberately ships **empty** until the client answers (§16 row e), the default state of the system is exactly the case the promise covers — every SEC-08 event assignment passes silently today.

**Where:** §9.1 and §6.6, the 'ungeprüft' fallback

**Fix:** Either add the report as a real artefact — `qualifikation_snapshot` records `anforderungen_gefunden: 0` and a daily `job:einsatz_ungeprueft` lists such assignments — or drop the sentence. Add a test: an assignment against an object with no requirement row lands in the report.

### R13. `extrahiere_lv` writes `menge_vertrag` and `einheitspreis_cent` — machine-extracted figures that FIN-08 later multiplies through `aufmass_zeile` into an invoice. The document adds the APR-03 provenance columns and says an unreviewed low-confidence row 'renders the DESIGN §5 warning pill and is excluded from batch approval (APR-04)', but nothing prevents a row with `geprueft_am is null` from being consumed by the billing path, and no CHECK, policy or service rule states that a price may not leave `entwurf` unconfirmed. Invariant 6's guarantee here is a UI convention, not a structural one.

**Where:** §7.5 `lv_position` (AGT-02 / APR-03), against invariant 6 and K-10

**Fix:** State the rule where it binds: a `lv_position` with `geprueft_am is null` may not be referenced by an `aufmass_zeile` that reaches a `gegengezeichnet`/`einseitig_festgestellt` sheet, or may not be dereferenced by the pricing service — enforced by trigger or by a named, tested service guard — and add it to §14 as a test.

### R14. Four smaller loose ends: `app.planungsbedarf` returns `setof planungsbedarf_zeile`, a composite type defined in no document and requested from none; `app.einstellung(schluessel)` (§1.16) is used by three placeholders but appears neither in §1.10's helper table nor in any contract row; `audit_log` (written by `app.protokolliere()` and by the §1.9 price helpers) and `job_lauf` (§13.2) are consumed but absent from §2.1; and §1.14 cites `dokument_aufbewahrung` as `02-CRM-OPERATIONS.md` §4.6, which is 'Aufträge und Abrechnung' — the catalogue is in §4.7.

**Where:** §1.10, §1.16, §2.1 and §1.14 (cross-references)

**Fix:** Define `planungsbedarf_zeile` in §1.10 (or require it of the Dienstplan document in §17 item 4), add `app.einstellung` to §1.10 with its guard, add `audit_log` and `job_lauf` rows to §2.1, and correct the §4.6 reference to §4.7.

## CONVENTION VIOLATIONS (3)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-16 — durations: 'Durations are `integer` minutes or seconds, named with the unit (`minuten`, `zeitabweichung_sek`).' The document declares `revier.sollzeit_minuten numeric(8,2)` (§5.1: '**`numeric(8,2)`, not `integer`**') and `revier_raum.sollzeit_minuten numeric(8,2)` (§5.2), justified in §1.1 by 'One type for the concept everywhere'. The reviewer's MINOR asked only for consistency between the two carriers; the convention fixes which type that must be, and the document resolved it in the direction K-16 forbids. (`turnus.dauer_minuten integer` and `posten.dauer_minuten integer` are correct; `bautagebuch_mannstunden.stunden numeric(8,2)` is a crew quantity and defensible either way.) Fix: `integer` minutes on both `sollzeit_minuten` columns, or add the exception to K-16 first and cite it — the document may not resolve it locally.

- K-04 — 'Every table hanging off `anstellung_id` or `person_id` carries a **restrictive** ceiling in addition to K-03' with the `portal() = 'mitarbeiter'` shape. §1.8's `p_ma_ceiling` list omits `aufmass`, which carries `aufgenommen_von_anstellung_id` (§7.6) and is given only `p_kunde_ceiling`; the build check as stated ('fails when a table in this domain carries none of the three') would not catch it, because it tests for *any* ceiling rather than for the ceiling K-04 names. Fix: add `p_ma_ceiling` on `aufmass` (and via the head on `aufmass_zeile`/`aufmass_foto`), and restate the build check as 'every anstellung- or person-hung table carries `p_ma_ceiling`'.

- K-03 (borderline, worth resolving explicitly) — the standard `with check` in §1.6 appends `and exists (select 1 from mandant m where m.id = mandant_id and m.archiviert_am is null)`, which K-03's normative shape does not contain and which is exactly the base-table subquery §1.8's own paragraph forbids two sections later. It happens to work (`mandant`'s KERN policy is `id in (select app.sichtbare_mandanten())`, so the active mandant resolves), and it is still only two policies, so it is not a breach — but the document should either drop the conjunct or route it through a `STABLE` definer accessor and say why the §1.8 rule does not apply to it.

## VERIFIER VERDICT

Fifteen of the sixteen blocking findings are genuinely resolved in the written file, not merely claimed — I could point at the changed DDL, the changed policy text and the matching regression test for each — and the one partial rejection (B3) is correct on the facts: `01-KERN.md` line 1826 really does make `nachweis` visible through `app.person_sichtbar`, so the reviewer's diagnosis was the wrong failure and the author's narrower one is right, while the required fix was applied in full anyway. The document is markedly better than the draft: K-03/K-04 are applied verbatim, the Wachbuch chain and the key ledger are now sound controls, the §14 VOB/B and §11 Abs. 4 VOB/B distinctions are recorded rather than falsified, retention has a column a Löschkonzept can drive, and every legal value I could check against SPEC (10-year GoBD, 2-year MiLoG, the 60/30/7 and 14-day watchdogs, the three trades, the §6 Abs. 2 VOB/B grounds) is either SPEC-stated or a labelled `// TODO(client)` — I found no invented legal, financial or tariff value, no money column that is not `bigint` cents, no instant that is not `timestamptz`, no tenant table without `mandant_id` and RLS, no costed entity on `person_id`, and no simulated external call. It is not yet fit to implement against as it stands, however, because §9 — the one section whose whole purpose is a hard block — carries three defects that survive the rewrite: it reads `qualifikation.rechtsgrundlage`, a column no document declares (42703 on every assignment); it stamps proof columns from an AFTER constraint trigger, where the assignment is discarded and §9.4's CHECK then rejects exactly the non-service paths the section claims to cover; and its definer functions read `einsatzanforderung` and `qualifikation` without a definer read policy, which under the document's own FORCE RLS returns zero requirements and makes SEC-04 fail **open**. Add the two missing `kunde_id` columns on `aufmass_zeile`/`aufmass_foto`, the head-status copies the customer ceilings key on, the `erzwinge_serverzeit()` NULL→value transition semantics, and the `wachbuch.lesen` grant that §1.7 currently withholds from the very role that writes the entries, and this becomes a document a schema can be built from directly.
