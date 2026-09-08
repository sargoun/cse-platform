# Verification findings — auth-berechtigungen

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (15)

### R1. Both point at "§12" for the composite-FK inventory ("§12 lists every composite FK with the parent unique it consumes"; "it is a **composite** foreign key (§1.11, §12)"). The inventory is section 11; section 12 is the test table. §12's own row 1 correctly cites "§11".

**Where:** §1.11 (line 402) and §7.2 (line 2472)

**Fix:** Change both references to §11.

### R2. Declared as a single-column `FK → qualifikation.id`. 01-KERN §6.16 gives `qualifikation` a (nullable) `mandant_id`, so this is exactly the construction §1.11 declares absolute — "A single-column foreign key into a table that carries `mandant_id` is a review failure" — and it is the one row that would fail test 26's information_schema walk. A composite FK is not available either: qualifikation's uniques are the PK on `id` and `UNIQUE NULLS NOT DISTINCT (mandant_id, schluessel)`, and its `mandant_id` is nullable for platform-wide catalogue rows.

**Where:** §6.4 `stelle_anforderung.qualifikation_id` (line 2170)

**Fix:** State the exemption explicitly: `qualifikation` is a mixed platform/tenant catalogue whose `mandant_id` is nullable, so a composite FK is impossible; add it to the §11 closing exemption list with that reason, and add a trigger asserting `qualifikation.mandant_id IS NULL OR qualifikation.mandant_id = stelle_anforderung.mandant_id`. Otherwise test 26 fails on the first run.

### R3. "Single-column foreign keys exist **only** into the non-tenant reference tables of §1.5 … and into `benutzer`". The document also declares single-column FKs into `person` (`kandidat.person_id`), `mandant` (S5) and `qualifikation`. The first two are correct and unavoidable (neither carries `mandant_id`); the enumeration is simply incomplete, which makes the sentence false as written and the test it implies unbuildable.

**Where:** §11 closing paragraph

**Fix:** Add `person`, `mandant` and `qualifikation` (with the reason above) to the list.

### R4. The function raises `FREIGABE_KETTE_FEHLT` when no head row exists for the mandant, and nothing in the document creates that row. The domain adds an AFTER INSERT trigger on `mandant` for the `wissens_chunk` partition but not for the chain head, so TEN-08's "a fifth area requires a DB row, no code change" holds for the RAG index and breaks for approvals: every approval in the new mandant raises.

**Where:** §4.1 `freigabe_kette` / `app.freigabe_kette_naechste`

**Fix:** Extend the AFTER INSERT trigger on `mandant` (or add a second one) to insert the `freigabe_kette` row with `letzte_kette_nr = 0`, and add it to test 15's assertions.

### R5. "`pruefdauer_sek` additionally column-granted behind `freigabe.pruefdauer_lesen`". A column `GRANT` is to a role, and §1.6 of this same document argues the point correctly — "a column grant cannot distinguish the public principal from an internal one — both are `cse_app`". The same applies here: it cannot be conditioned on a right. §1.7 lists no reader function for it, unlike `agent_schritt.eingabe/ausgabe`, which is done correctly via `app.agent_nutzlast_lesen`.

**Where:** §4.7 freigabe_snapshot RLS (lines 1765–1766)

**Fix:** Either revoke the column from `cse_app` and expose it through a `cse_definer` reader that re-checks `freigabe.pruefdauer_lesen` and `mandant_id = app.aktiver_mandant()` and writes `audit_log` (the K-05 shape, added to §1.7), or move `pruefdauer_sek` to a child table with its own policy.

### R6. S3 includes `erstellt_durch_agent_id`. `stelle` is a registered public table, so the public allowlist would publish that a job advertisement was drafted by an agent — which is the fact `ki_entwurf` was moved to `stelle_intern` to keep internal. The two decisions cancel each other for that one column.

**Where:** §1.6 "Accountability columns … remain on the public tables" + S3 (§1.11)

**Fix:** Move `erstellt_durch_agent_id` (and `geloescht_von`) out of the public allowlist for `stelle`, `seite`, `referenz` and `social_post`, or state that S3 is column-revoked on registered public tables.

### R7. "the definer-read registry of `01-KERN.md` §3.5, which this domain extends by exactly four tables", but the registry column of the same table names five: `agent_budget`, `agent_reservierung`, `agent_richtlinie`, `agent_schritt`, `freigabe_kette`.

**Where:** §1.7 intro

**Fix:** Say five, or drop the count.

### R8. The CHECK covers vorname, nachname, email, telefon, plz, ort, parsed, lebenslauf_dokument_id — but §6.10's inventory also purges `land`, and `land` is a `char(2)` that survives the certificate. Small, but the CHECK is explicitly presented as the completeness certificate.

**Where:** §6.6 `kandidat` completeness CHECK

**Fix:** Add `AND land IS NULL` to the CHECK.

### R9. `UNIQUE (mandant_id, quelle_job, bezug_typ, bezug_id) WHERE quelle_job IS NOT NULL AND status IN ('offen','in_arbeit')` — `bezug_typ`/`bezug_id` are nullable and NULLs never collide, so a watchdog finding that has no subject row (e.g. `postfach_stumm`, `job-ausfall`) still creates a fresh task every run: the exact B17 failure for that subset. The identical NULL-collision argument is made correctly two sections earlier for `benachrichtigung_praeferenz` and for `agent_budget`'s `CHECK`.

**Where:** §7.7 `aufgabe_job_uk`

**Fix:** Either add `AND bezug_id IS NOT NULL` to the predicate plus a second unique for subject-less findings keyed on `(mandant_id, quelle_job)`, or use `UNIQUE NULLS NOT DISTINCT`.

### R10. The section header says "Enumerated, not exemplified" (K-04's wording) and the row then reads "every remaining table in this domain, **including** …", which is exemplification. Read literally it also sweeps in the registered public tables (`seite`, `seite_block`, `webauftritt`, `seite_redirect`, `stelle`, `social_post_medium`, `social_post_ziel`), and a restrictive `app.portal() = 'intern'` on those would return zero rows for the §1.6 public principal, i.e. a blank website. The per-table RLS notes resolve it the right way by not naming the ceiling, but the two statements conflict.

**Where:** §1.4 ceiling table, p_intern_ceiling row

**Fix:** Replace "every remaining table … including" with the literal list, and state that registered public tables carry no `p_intern_ceiling`.

### R11. The enum declares `warnung` and the function signature promises `rest_mikro bigint`, but `app.agent_budget_pruefen` never returns `warnung` and returns `null::bigint` for `rest_mikro` on every path. Harmless today, but a caller written against the signature will branch on values the function cannot produce.

**Where:** §3.6 / §9 `agent_budget_verdikt`

**Fix:** Either return the warning verdict and the real remainder (the loop already has `b`), or drop both from the type and the signature and leave warnings to `watchdog:agent_budget`.

### R12. The §11 inventory attributes `dokument_id` to `nachricht_empfaenger` and `bezug_anforderung_id` to `gespraech_bewertung`, neither of which declares those columns (§7.9, §6.9); and it omits `wissens_chunk.dokument_id`, which §3.11 declares as a composite FK. The table is the artefact test 1 is written against, so it must be exact.

**Where:** §11 rows for `nachricht_anhang, nachricht_empfaenger` and `gespraech_frage, gespraech_bewertung`; §3.11 `wissens_chunk.dokument_id`

**Fix:** Split the merged rows and add the `wissens_chunk → dokument` row.

### R13. The confidentiality gate depends on the right `wissen.vertraulich_lesen`, but the §1.3 matrix lists only `wissen.lesen` for the `wissen` module, and §15's requirement on the permission model says only "the rights of §1.3 exist as `berechtigung` rows". The right that makes B15's fix usable would therefore never be seeded.

**Where:** §3.11 `p_vertraulich` / §1.3 module matrix / §15

**Fix:** Add `wissen.vertraulich_lesen` to the §1.3 matrix and name it in the §15 row, with the same "never held by `kunde` or `mitarbeiter`" restriction.

### R14. "this domain contains the platform's second and last `DELETE` grant (the first two are the CRM staging purges)" — self-contradictory arithmetic.

**Where:** §1.8

**Fix:** "the platform's third and last", or drop the count.

### R15. Described as `BEFORE UPDATE` on `radar_profil` **and** `AFTER INSERT/UPDATE/DELETE` on `radar_profil_cpv`/`radar_profil_empfaenger`. The child trigger must update the parent, which fires the parent trigger, which increments again; a bulk CPV edit therefore bumps `version` once per child row and re-enters the trigger. Not wrong for correctness (`eingaben_hash` still changes) but the recursion and the multi-increment are unaddressed, and `version` is documented as "bumped on every change".

**Where:** §2.4 `trg_radar_profil_version`

**Fix:** State that the child trigger sets a transaction-local flag or writes `version = version + 1` on the parent only once per statement (a statement-level AFTER trigger), and that the parent's BEFORE UPDATE trigger skips when the flag is set.

## CONVENTION VIOLATIONS (4)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-08 — §7.6 adds a fourth function executable outside `withTenant`/`withGroupScope`: "`GET /api/ical/[token]` runs under **`cse_job`** … the route is listed in the K-08 route manifest as the single sanctioned session-less read path in this domain, alongside the check-in endpoint that K-08 itself names." K-08 reads "Three functions, and only these three, may execute outside `withTenant`" and its route-manifest test "asserts no other code path reaches the database outside `withTenant` or `withGroupScope`". The design is sound (it is how CAL-03 can work at all, and it is narrower than the alternatives), but per the standing rule the convention wins: `00-KONVENTIONEN.md` must be amended to name `app.feed_token_aufloesen` as a fourth sanctioned path before this document can rely on it. §15 places requirements on 01-KERN for the token table and the grant but places no requirement on 00-KONVENTIONEN for K-08 — only for K-16.

- K-16 — §3.11 `wissens_chunk`: "`PRIMARY KEY (mandant_id, id)` — a stated exception to K-16's single-column PK, because the table is `PARTITION BY LIST (mandant_id)` and Postgres requires the partition key in the PK". K-16 says "Every table: `id uuid primary key default gen_random_uuid()`" and admits no exception. The reason given is technically correct and unavoidable, but the exception belongs in the convention, not in a domain document that declares itself subordinate to it. Route it to 00-KONVENTIONEN alongside the K-16 note already in §15.

- K-16 — §1.12 keeps a sub-cent carry beside cents (`kosten_rest`, `verbrauch_rest`, `reserviert_rest`, `betrag_rest`, `CHECK (BETWEEN 0 AND 999999)`) where K-16 says "Money is `bigint` cents everywhere, including agent cost accounting." The document is honest about this — §15's last row asks 00-KONVENTIONEN to confirm and offers to be corrected — and the alternatives it rejects (numeric/float, or per-step rounding to zero) are both worse. But as written the convention has not been applied, it has been escalated; the escalation must be answered before the schema is generated, because the answer changes `agent_kosten`, `agent_budget`, `agent_schritt` and `agent_reservierung`.

- K-04 — §1.4 heads its ceiling table "Enumerated, not exemplified" (K-04's own words) and then writes the `p_intern_ceiling` row as "every remaining table in this domain, **including** `radar_*`, `ausschreibung_*` …". K-04 requires the enumeration and makes `src/server/db/rls.ts` fail the build on a missing entry; a build check cannot be written against "every remaining table … including", and read literally the row would put the restrictive `app.portal() = 'intern'` on the registered public tables and blank the public website.

## VERIFIER VERDICT

Yes — this is fit to be implemented against, and unusually so. All thirty BLOCKING findings are genuinely resolved in the written file, not merely asserted: each fix is visible in the table definition, the constraint list, the policy SQL or the enum block, and §12 attaches a named test to every one. Three of the fixes are better than the review's own prescription and say so with reasons rather than by assertion — B9 (the review's `hat_recht(modul, aktion)` signature is the global predicate K-03 forbids), B15 (two class-scoped ANN indexes, because excluding confidential chunks from every index would make the gating right resolve to a sequential vector scan), and B21 (K-01's `pg_catalog, public` beats the review's `public, pg_temp`). Money is `bigint` cents throughout, including the agent ledger; instants are `timestamptz` with `date`/`time` used only where a Berlin calendar boundary is meant and justified per column; every tenant table carries `mandant_id` via S5 with the two K-03 policies and a restrictive ceiling; D-09 holds (`team_mitglied` on `anstellung_id`, `kandidat.person_id` as a human fact, no costed entity on a person); every legal, tariff or financial value the SPEC does not state is a labelled PLACEHOLDER with a `TODO(client)` carried into §14; and nothing simulates an external call — `social_channel`, `jobboard_kanal` and `postfach_kanal` all default to `nicht_verbunden` and record `uebersprungen_nicht_verbunden` rather than a fabricated success. What remains are fifteen correction-grade defects, none of which reopens a blocking finding, but four of which will stop or silently weaken the first migration or first run and should be fixed before Phase 8 code is written: the `stelle_anforderung.qualifikation_id` single-column FK that fails the document's own test 26, the missing creation path for the per-mandant `freigabe_kette` head row (which breaks TEN-08 for approvals), the non-implementable column grant on `freigabe_snapshot.pruefdauer_sek`, and the §11/§12 cross-reference error in the section the first migration test is written against. Separately, the K-08 deviation in §7.6 (a fourth session-less database path) is defensible on the merits but is being sanctioned by a domain document rather than by `00-KONVENTIONEN.md`, and needs to be routed there.
