# Verification findings — api-karte

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (9)

### R1. The employee portal (§C.11) and the customer portal (§C.12) read under `app.scope = 'gruppe'`, where the only SELECT policy that can match is K-03's `t_gruppe`, which requires `app.hat_recht('gruppe.<modul>.lesen', mandant_id)` — a right the permission matrix grants to neither `mitarbeiter` nor `kunde`. Both portals therefore return zero rows. Widening the matrix instead would give an employee or customer a group-scope read of every table not in the K-04 ceiling registry (`objekt`, `kunde`, `auftrag`, `rechnung` …), leaving only the serialiser of line 695 as the defence — which invariant 3 forbids as a sole line. `MehrmandantKontext.grund` distinguishes the three cases in TypeScript, but it is not a GUC, so the database cannot tell an employee-portal read from a group-view read.

**Where:** 05-API-KARTE.md lines 166, 695, 716, 1028, 1045; §C.11 and §C.12 scope columns (`eigene_anstellungen`, `eigener_kunde`)

**Fix:** Either add a fourth `app.scope` value (`eigen` / `kunde`) to K-02's GUC list with its own SELECT-only policy shape and its own right keys, or drop group scope for these two portals and read them under `withAnstellung` / a `withKunde` helper with `app.mandant_id` set per request. Whichever is chosen must be reflected in K-02, K-03 and 03-AUTH §12.1 in the same pass, and covered by a test that a `mitarbeiter` with no `gruppe.*` right still sees their own shifts and a `kunde` still sees their own invoices.

### R2. `GET /api/gruppe/personen/[id]/einsatzzeiten` runs under `withGroupScope` (`app.mandant_id` NULL) but is served by `app.arbzg_belastung`, whose stated in-function precondition is `dienstplan.arbzg_pruefen` **in the active mandant**. The endpoint can never succeed.

**Where:** 05-API-KARTE.md line 1057 vs line 678 (and K-06)

**Fix:** Move the endpoint to mandant scope (an ArbZG oversight read is a planner action inside one entity), or add an explicit group-scope precondition to K-06 — `dienstplan.arbzg_pruefen` in at least one mandant of `app.mandant_ids` that employs the person — and state which. Do not leave both documents asserting an unreachable call.

### R3. Three §G indexes name columns that the binding sibling document renames, and a fourth names a column the document's own design replaced. `04-PLANUNG-ZEIT.md` §0.4 states: "The draft's `beginn_utc` on the tenant tables is corrected to `beginn_zeitpunkt`; renaming K-06's window columns to match would contradict a convention" — i.e. `beginn_utc`/`ende_utc` are correct *only* on `zeit_intern.arbeitszeit_fenster`. Separately, `zeiteintrag (mandant_id, auftrag_leistung_id) WHERE abgerechnet_am IS NULL` predicates on `abgerechnet_am`, a column nowhere defined here; §C.17 replaced the billed flag with `rechnungsposition_quelle.wirksam` precisely because a flag on the source row cannot express the draft/finalised/Storno lifecycle.

**Where:** 05-API-KARTE.md §G lines 1678, 1679, 1681, 1682 (`beginn_utc`/`ende_utc`) and line 1683 (`abgerechnet_am`)

**Fix:** Rename to `einsatz (mandant_id, beginn_zeitpunkt)`, `einsatz_zuordnung (anstellung_id, beginn_zeitpunkt)`, `zeiteintrag (mandant_id, anstellung_id, beginn_zeitpunkt)`, `zeiteintrag (mandant_id) WHERE ende_zeitpunkt IS NULL`; keep `zeit_intern.arbeitszeit_fenster (person_id, beginn_utc)` as is. Replace the last row with an index that serves the actual guard, e.g. `rechnungsposition_quelle (quelle_typ, zeiteintrag_id) WHERE wirksam` plus `zeiteintrag (mandant_id, auftrag_leistung_id)`.

### R4. §B.6 is titled "The five session helpers, and no sixth (K-08)" and §B.2 asserts a CI test that "asserts **no code path reaches the database outside the five session helpers**", but the same section then defines platform-level writes that "are not a tenant scope at all" and touch `mandant`, `benutzer`, `benutzer_mandant`, `rolle_berechtigung` through none of the five (§C.5 rows carry `Scope: plattform`), and §C.10 line 656 gives `GET /api/feiertage` a `Scope: –` while reading the `feiertag` table. As stated the manifest test would fail on the document's own routes, or it is weaker than its description.

**Where:** 05-API-KARTE.md lines 78, 161, 182; §C.5 lines 475, 478; §C.10 line 656

**Fix:** Name the platform path as a sixth helper (`withPlatformScope`, `super_admin` + `aal2`, `app.mandant_id` NULL, insertable set enumerated, audited against a dedicated `plattform_audit` table or a nullable-tenant audit table with its own policy), and state which tables a `Scope: –` route may read without any helper (reference data with no `mandant_id`, e.g. `feiertag`). Then restate the CI assertion in terms the routes actually satisfy.

### R5. `assertPersonSichtbar` carries a bootstrap clause with no expiry: `OR person.erfasst_von_mandant_id = ctx.mandantId  -- the bootstrap window, before the first employment`. Nothing closes the window. A person entered by `reinigung` who is subsequently employed only by `security` stays permanently visible to `reinigung`, which is wider than D-09 §6 ("`person` rows are visible to any mandant the person has an employment with") and wider than the RLS mirror it claims to have.

**Where:** 05-API-KARTE.md lines 571-575, and the same clause implied in the `person` policy at line 578

**Fix:** Bound it: `OR (person.erfasst_von_mandant_id = ctx.mandantId AND NOT EXISTS (SELECT 1 FROM anstellung WHERE person_id = person.id))` — visibility from creation lasts only until the first employment exists, after which employment is the sole predicate. Add it to the SEC-A3 case as its own assertion.

### R6. The ArbZG padding guard is weaker than the contract it enforces. The loader contract is `randbereich_minuten >= ruhezeit_minuten + max_schichtlaenge_minuten`, but `pruefeArbzg` "**throws** when it is smaller than `ruhezeit_minuten`". A caller that pads by exactly 660 minutes passes the guard and still cannot see a shift that *started* before the padded window but ended inside the rest interval — the precise failure B7 was written to stop, now merely narrowed rather than closed.

**Where:** 05-API-KARTE.md lines 688 and 691, and the docblock at line 1274

**Fix:** Make the throw condition identical to the loader contract: throw when `randbereich_minuten < ruhezeit_minuten + max_schichtlaenge_minuten`, and add `max_schichtlaenge_minuten` to `ArbzgKonfiguration` so the detector can evaluate the condition it states. Extend T-31 with a case padded to exactly `ruhezeit_minuten`.

### R7. B24's substantive fix landed but its test did not. §E has no case in which the two readings of "werktäglich" disagree, so nothing prevents an implementation from silently collapsing `'beide_lesarten'` back to one reading — T-08 (6 h + 5 h on one day) produces a breach under both readings and passes either way.

**Where:** 05-API-KARTE.md §E lines 1592-1642 (no counterpart to the rule stated at line 1284)

**Fix:** Add T-08b: a 22:00–06:00 shift plus a 3 h day shift; expect a breach present under `schichtbeginn` and absent under `kalendertag_berlin`, emitted with `schwere: 'warnung'`, `lesart: 'schichtbeginn'` and the reading named in `begruendung`; and assert that a blocking breach is produced only when both readings agree.

### R8. `app.portal` is a GUC (§B.4) whose value K-04 derives from "the role of the active membership", but the employee and customer portals run in group scope where there is no active membership — while K-04's restrictive ceiling (`app.portal() <> 'mitarbeiter' OR anstellung_id IN …`) is exactly the control that must hold there. The document asserts the ceiling applies (line 695) without saying how `app.portal()` resolves without an active mandant.

**Where:** 05-API-KARTE.md lines 140, 695, 716

**Fix:** State the derivation for the multi-mandant scopes explicitly — e.g. `app.portal` is set by the session helper from the *session's* portal選択 rather than from a membership, and in `withGroupScope` it is the most restrictive portal across `app.mandant_ids`. Add it to K-02's GUC semantics so the two documents cannot drift.

### R9. The canonical payload snapshots the tax rate as `steuersatz_bp: number` per line and per tax line, whereas K-12 specifies "je Steuerzeile { satz, netto_cent, steuer_cent, hinweistext }" — `satz` being the dated catalogue row the document itself introduces (`Steuersatz` with `id`, `schluessel`, `gueltig_von`, `gueltig_bis`). An auditor reading the snapshot sees the percentage applied but not which catalogue row it came from, so the rate-resolution decision is outside the hash even though the rate is inside it.

**Where:** 05-API-KARTE.md lines 1356-1357 vs K-12's payload sketch and §D.2 lines 1157-1161

**Fix:** Snapshot `satz: { schluessel, prozent_bp, gueltig_von }` (identity plus value) rather than `steuersatz_bp` alone, in both `positionen[]` and `steuerzeilen[]`, and extend T-18b to assert that editing `steuersatz` rows after finalisation changes neither `pruefeKette` nor the rendered documents.

## CONVENTION VIOLATIONS (7)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-03 (and K-04) — the employee and customer portals are specified to read under group scope, where K-03's only matching SELECT policy demands a right neither role holds. §B.6 line 166: `withGroupScope(ctx, fn)` | `gruppe` | NULL | … | used by "`/portal/gruppe/**`, `/portal/mein/**` reads, `/portal/kunde/**` reads". Under `app.scope='gruppe'`, `app.mandant_id` is NULL, so K-03's `t_mandant` policy (`mandant_id = app.aktiver_mandant()`) matches nothing and `t_gruppe` is the only SELECT policy left — and the document reproduces it verbatim at line 1045 including `and app.hat_recht('gruppe.<modul>.lesen', mandant_id)`. `03-AUTH-BERECHTIGUNGEN.md` §12.1 line 1731 grants `gruppe.*.lesen` as `—` to both MA (mitarbeiter) and KD (kunde). As written, every route in §C.11 and §C.12 returns zero rows.

- K-06 — a group-scope endpoint calls a function whose precondition group scope cannot satisfy. Line 1057: "`GET /api/gruppe/personen/[id]/einsatzzeiten` … served by `app.arbzg_belastung`", and line 678 states the in-function precondition "holds `dienstplan.arbzg_pruefen` **in the active mandant**". Under `withGroupScope` there is no active mandant (`app.mandant_id` NULL, §B.4 line 137), so the call can only fail closed. Either the endpoint moves to mandant scope or K-06's precondition needs a stated group-scope form.

- K-16 — "Money is `bigint` cents everywhere, including agent cost accounting", but line 957 introduces `agent_schritt.kosten_mikrocent bigint` and §I.7 line 1741 re-opens the convention ("If the convention is read strictly as forbidding the micro-cent column, AGT-05's hard stop becomes unreachable; this reading should be confirmed in DECISIONS.md"). The engineering argument is correct, but per the standing rule the convention wins until K-16 or DECISIONS.md is amended; this must not be implemented on the strength of a note in §I.

- K-16 — "Tenant tables add `mandant_id uuid not null references mandant(id)`", yet line 182 specifies platform writes "audited with `mandant_id = NULL`" on `audit_log`, whose column list at line 273 begins `audit_log(id, mandant_id, …)`. A NULL `mandant_id` is both non-conformant to K-16 and unmatched by either K-03 policy, so platform audit rows would be unwritable and unreadable by `cse_app` as specified.

- K-16 / invariant 3 — four tables are introduced with explicit column lists that omit `mandant_id`: line 840 `rechnung_versand(rechnung_id, kanal, empfaenger, freigabe_id, freigegeben_von, versendet_am, fehler)` and `rechnung_beziehung(von_rechnung_id, zu_rechnung_id, art)`; line 970 `freigabe_ansicht(freigabe_id, benutzer_id, geoeffnet_am_server, anfrage_id)`; line 427 the `offline_ereignis` row "carrying `behauptete_zeit`, `geraet_id`, `empfangen_am` … and `status`". K-13 sets the precedent the document itself follows for `freigabe_snapshot` (line 972: "carries `id`, `mandant_id`, `freigabe_id`, `erstellt_am` and RLS like any other tenant table"). The sibling data-model documents do declare these tables, so this is a documentation defect rather than a design one — but as written, three of the four sketches read as tenant tables without a tenant key.

- K-09 — the convention's SQL uses `verwendet_am` / `verwendet_ip`; lines 414-420 use `eingeloest_am` / `ip_adresse` / `user_agent` and match on `token_hash` rather than `id`. The semantics (single conditional write, zero rows *is* the 409) are preserved and improved, and `02-datenmodell/04-PLANUNG-ZEIT.md` §§274, 746, 1451 agrees with this document — so K-09's snippet is the outlier. Record the rename against K-09 rather than leaving two column vocabularies in Phase 0.

- K-01 (observation, not a breach) — line 169 routes public form intake and mailbox intake through `withSystemTenant` on `cse_job`, whose K-01 row reads "cron and Edge Functions | Per-job grants, enumerated in the job definition". An unauthenticated public POST is neither. `03-AUTH-BERECHTIGUNGEN.md` §905 says the same thing, and no other role in the six-role set can insert (K-01 gives `cse_anon` "no table grants at all"), so the choice is forced — but K-01's description of `cse_job` should be widened to name intake explicitly rather than leaving the widest-granted role reachable from an anonymous request by implication.

## VERIFIER VERDICT

Yes, with named corrections — this is a genuinely rewritten document, not a set of claims about one. All 25 blocking findings are traceable to specific, load-bearing text in the file rather than to a changelog: T-07/07b/07c carry the corrected Berlin split with a CEST companion whose arithmetic I checked independently; `rechnung_versand`/`rechnung_beziehung`, `freigabe_ansicht`, `rechnungsposition_quelle`, `kunde_bauleistender_status`, `offline_ereignis`, `kunde_zugang` and §C.8's personnel surface all exist with bodies, constraints and tests; `arbzg_zeitraeume` is gone entirely and every call site uses K-06's `app.arbzg_belastung` signature verbatim; `ergebnis_milli`, `geoeffnet_am`, `positionen_snapshot` and `unterschrift_png_base64` appear nowhere in a request body and each is backed by a `.strict()` rejection test. The one rejected remedy (B11) is rejected for the right reason — the reviewer's \"server clock at the claimed boundary\" would have laundered a device instant through the server, which invariant 5 forbids — and the replacement is independently corroborated by the binding sibling `02-datenmodell/04-PLANUNG-ZEIT.md` §§240-242, which resolves it identically. The document also volunteers useful self-criticism (§I's cross-document notes, the `kosten_mikrocent` disclosure) rather than papering over conflicts. Two defects must be fixed before anyone implements against it, and both are of the silent-and-late class the conventions exist to prevent: the employee and customer portals are specified to read under group scope where K-03's only matching policy demands `gruppe.*.lesen` rights that 03-AUTH grants to neither role, so §C.11 and §C.12 return zero rows as written; and `GET /api/gruppe/personen/[id]/einsatzzeiten` calls a function whose active-mandant precondition group scope cannot satisfy. Both are inherited from 03-AUTH rather than invented here, which means the fix belongs in K-02/K-03 and both documents in one pass. Beyond those, the §G index column names contradict `04-PLANUNG-ZEIT.md` §0.4's binding rename (`beginn_utc` → `beginn_zeitpunkt` on tenant tables) and one index predicates on an `abgerechnet_am` column the document's own double-billing design replaced — mechanical, but the kind of error that survives into a migration. The `kosten_mikrocent` deviation from K-16 is technically sound and honestly flagged, but it is a convention change and must be made in K-16 and DECISIONS.md, not asserted in a §I note.
