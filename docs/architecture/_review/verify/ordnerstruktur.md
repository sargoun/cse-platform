# Verification findings — ordnerstruktur

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (13)

### R1. withSystemTenant is specified to run as `cse_job` (§4.3 helper table: "| `withSystemTenant(mandantId, grund, fn)` | `mandant` | explicit | — | `off` | `cse_job` | `TenantDb` | jobs, `scripts/`, `api/formular`, `api/bewerbung` |"), but §4.5 states the K-03 shape verbatim — "Every tenant table gets exactly two policies, and no others", both `for all to cse_app` / `for select to cse_app`. With ENABLE + FORCE RLS on every tenant table (§4.1) and no policy naming cse_job anywhere in the document (grep: cse_job appears only in the role table, the env var, the helper row and the JobDefinition grants), every read and every write made through withSystemTenant matches no policy and is refused. Table GRANTs do not substitute for a policy. That silently kills every job in §10, every importer in scripts/, the REQ-01 lead POST (api/formular) and the REC-03 application POST (api/bewerbung) — and it kills them the way this document warns about elsewhere: the SQL exists and looks correct.

**Where:** §4.3 (helper table row for withSystemTenant, and the bullet "containment comes from cse_job's enumerated grants") vs §4.5

**Fix:** Either run withSystemTenant as `cse_app` with a synthetic system SessionContext (containment then comes from the K-03 policies plus the system principal's `hat_recht` grants, which is what §4.3's own prose already argues), or amend K-01/K-03 first to define a third policy for `cse_job` and say on which tables it exists. Do not leave §4.3 and §4.5 as written.

### R2. Membership resolution deadlocks against its own policy. §5.1 classifies `benutzer_mandant` in bucket 1 — "Carries mandant_id, FORCE RLS and the two K-03 policies" — whose tenant policy is `mandant_id = app.aktiver_mandant()` and whose group policy requires `app.ist_gruppenansicht()`. But §12.1 says "`sichtbareMandanten` is derived from `benutzer_mandant`, never from the request", and that derivation happens in auth/session.ts *before* any scope is set: no active mandant, no group scope, therefore zero rows. withGroupScope then throws KeineSichtbarenMandantenError (§4.3) for every user, and switchMandant's step 2 ("assert a benutzer_mandant row exists") can never see a row either. K-08 sanctions only three pre-session functions and membership resolution is not one of them.

**Where:** §5.1 (bucket 1 list) vs §12.1 and §12.2 step 2

**Fix:** State how memberships are read before a scope exists — either extend `app.sitzung_aufloesen` (K-08) to return the membership set as part of session resolution, or give `benutzer_mandant` a self-scoped policy (`benutzer_id = app.aktueller_benutzer()`) and say so explicitly, amending K-03's "exactly two policies" for this one table in 00-KONVENTIONEN.md first.

### R3. §5.1 asserts blanket bucket-1 membership for "Everything in … `zeit.ts` …" and that every such table gets "the two K-03 policies", and §15 has mandant-id-and-rls.test.ts assert exactly that. But `arbeitszeit_verstoss` is in zeit.ts (§4.9) and K-06 — restated in §4.8 — requires that it have "**no INSERT policy for `cse_app`**". A K-03 `for all to cse_app` policy grants INSERT. The generated invariant test therefore goes red on a K-06-compliant database, and the cheapest way to make it green is to add the INSERT path K-06 forbids — the identical failure mode B4 was raised to prevent.

**Where:** §5.1 vs §4.8 / K-06

**Fix:** Carve `arbeitszeit_verstoss` out explicitly in §5.1 (a named bucket-1 variant: tenant table, `mandant_id` + FORCE RLS, K-03 group policy plus a SELECT/no-INSERT tenant policy, writes only via app.arbzg_befund_schreiben) and have rls.ts carry that flag so the invariant test asserts the absence of an INSERT policy rather than its presence.

### R4. The §5.2 person-scope policy contradicts itself. Its USING clause deliberately admits group scope — `or (app.ist_gruppenansicht() and a.mandant_id = any (app.sichtbare_mandanten()))` — but the conjunct that follows is `app.hat_recht('personal.lesen', (select a2.mandant_id from anstellung a2 where … and a2.mandant_id = app.aktiver_mandant()))`. In group scope `app.aktiver_mandant()` is NULL (§4.4), so the subselect yields NULL and the whole predicate is false: no nachweis is ever readable from portal/gruppe, portal/mein or portal/kunde, all three of which read this bucket. Separately, that scalar subquery is unguarded — a person with two anstellung rows in the same mandant (re-employment after austritt) makes it raise "more than one row returned by a subquery" at read time.

**Where:** §5.2, the `create policy p_person_sichtbar on nachweis` block

**Fix:** Write the right-hand argument of hat_recht per branch (aktiver_mandant() in tenant scope, `a.mandant_id` of the matched membership row in group scope, e.g. by folding hat_recht into the EXISTS over `a`), and make the membership lookup set-based rather than a scalar subquery.

### R5. The K-04 `kunde` ceiling has no subject in the session. §4.6 says "The same shape keyed on `kunde_id` covers `portal() = 'kunde'`" and §5's rls.ts declares a `ceiling_kunde` bucket, but neither the GUC table (§4.2) nor the accessor list (§4.4) defines anything that identifies the current customer — there is no `app.kunde_id` and no `app.aktueller_kunde()`. The ceiling as specified cannot be written. This compounds with §4.4's declared default: "`app.portal()` returns text -- 'kunde' when unset — the narrowest ceiling", which makes the mitarbeiter ceiling's `app.portal() <> 'mitarbeiter'` disjunct true by default and hands the whole enforcement burden to the ceiling that has no subject.

**Where:** §4.6 ("keyed on kunde_id") vs §4.2 and §4.4

**Fix:** Add `app.kunde_id` to the §4.2 GUC table and `app.aktueller_kunde()` to §4.4 (set by customer-session.ts / withKundenVorgang), and state which portal value is genuinely most restrictive once both ceilings exist — or make the unset default a value that matches no ceiling disjunct at all.

### R6. The write path has the same hole §7 just closed on the read path. The §23 zone table row reads: "| `src/app/**` | `@/server/db/**`, `@/server/services/**` — reads go through `@/server/queries/**`, writes through `_actions.ts` → services | L1 |". `_actions.ts` lives inside a route segment under src/app/** (§3.4), so the Forbidden column forbids exactly the import the Reason column mandates. As written, no Server Action can legally call a service, and the first one will be written by widening the zone — the failure B2 identified.

**Where:** (not stated)

**Fix:** Add the carve-out explicitly: `@/server/services/**` is importable from `src/app/**/_actions.ts` only (and nowhere else under src/app/**), matching the ESLint override by filename pattern.

### R7. §9.3 requires "`retrieve.ts` takes a `TenantDb`; it has no other way to reach the database", while §23 forbids `src/server/agent/{tools,rag}/**` from importing `@/server/db/**`. `TenantDb` is exported from `src/server/db/types.ts` (§4 tree), so the file cannot name its own parameter type without breaking the zone.

**Where:** §23 zone `src/server/agent/{tools,rag}/**` vs §9.3

**Fix:** State that the zone is value-imports only (`allowTypeImports: true`), or re-export the branded handle types from a permitted module, and say which.

### R8. §26 obliges audit_log to carry `akteur_id`, and §4.2 states the audit trigger writes the row "inside the database" from session settings — but no `app.akteur_id` GUC is defined in §4.2's table. Only `app.benutzer_id`, `app.akteur_typ` and `app.ip` are transported. For agent- and system-initiated writes there is no benutzer row, which is the exact scenario §4.2 says akteur_typ exists to disambiguate; the actor's identity is then unrecoverable, and audit_log is a no-hard-delete domain. Relatedly, nothing in the document sets `akteur_typ = 'agent'` — §9's orchestrator.ts is described only as "plan → tool loop → result".

**Where:** §4.2 GUC table vs §26 audit_log obligation

**Fix:** Add `app.akteur_id` to the §4.2 GUC table alongside akteur_typ/ip, and state in §9 that agent/orchestrator.ts constructs its SessionContext with akteurTyp = 'agent' and the agent run id as akteur_id.

### R9. §5.3 classifies a table `feiertag` in bucket 3 ("`mandant`, `rolle`, `berechtigung`, `rolle_berechtigung`, `belagsart` where it is a shared catalogue, `feiertag`"), but no schema file in §4.9 defines it — CLN-03 holidays are handled by `gewerke/reinigung/feiertage.ts` (computed, §8.5) and the fixture `db/seed/fixtures/feiertage-berlin.ts`. A table classified but never defined will either be invented in Phase 1 or silently dropped, and §8.5's computed-holidays rule makes it ambiguous which is intended.

**Where:** §5.3 vs §4.9

**Fix:** Either add `feiertag` to a schema file in §4.9 with the feature ID that forced it, or delete it from §5.3 and state that Berlin holidays are computed, not stored.

### R10. Two indexes in §6.1 reference columns the documents that own those tables do not declare. `zeit_intern.arbeitszeit_fenster (person_id, beginn_utc)` — K-06 fixes that table's shape as `zuordnung_quelle_id, quelle, aktiv, beginn_utc, ende_utc`, with no person_id; and `einsatz_zuordnung (anstellung_id, beginn_zeitpunkt)` presumes the assignment link table carries the shift's start, which elsewhere lives on `einsatz`.

**Where:** §6.1 index table, rows 3 and 2

**Fix:** Either state that the K-06 window denormalises `person_id` (and amend K-06 to declare it, since it is the column app.arbzg_belastung filters on), or index via the join; and confirm in §6.1 whether `beginn_zeitpunkt` is on einsatz or einsatz_zuordnung, since 02-DATENMODELL.md is bound by this table.

### R11. Three operational thresholds that SPEC does not state are written as fact with no `TODO(client)` and no DECISIONS entry: `rechnung-ueberfaellig.ts  daily  overdue > 14 days → propose dunning` (SPEC FIN-15 says only "Dunning with escalation levels, fees, interest"), `nachtrag-nicht-eingereicht.ts  daily  announced, not submitted after 14 days` (BAU-04 states only that angemeldet_am is separate from eingereicht_am), and `nachweis-ablauf.ts  daily  certificate expiring 60/30/7 days` (SEC-02 says only "tracked per person with expiry"). §8.6 correctly placeholders the Mahnstufen, fees and interest basis but not the trigger that starts the dunning run — the one that decides when a customer letter becomes due.

**Where:** §10, jobs/watchdogs (rechnung-ueberfaellig.ts, nachtrag-nicht-eingereicht.ts, nachweis-ablauf.ts)

**Fix:** Move the dunning trigger delay into `services/finanz/mahnung/stufen.platzhalter.ts` (it is part of the same contractual question already tracked in §25.3), and mark the BAU-04 window and the 60/30/7 cadence as configured defaults with a TODO(client) or as explicitly non-legal operational settings owned by the client.

### R12. TEN-10's "switcher dropdown with live counters per area" has no named query, no stated scope and no test anywhere in the document; §7's query list has no entry for it and §13 lists only the component. This was one of the four multi-mandant read scopes B3 enumerated, and the author's fix note claims it was named.

**Where:** §7 and §3.7 (portal/layout.tsx switcher comment)

**Fix:** Add `queries/mandant.switcherZaehler(ctx)` to §7, state that it runs under withGroupScope over ctx.sichtbareMandanten (which is the benutzer_mandant set) and which `gruppe.<modul>.lesen` right it requires, and cite it in §27's TEN row.

### R13. §4.2 extends K-02's GUC table with two entries (`app.akteur_typ`, `app.ip`). The extension is well-argued, fenced (audit-only, no policy may reference them) and tested, and it is what B16 required — but 00-KONVENTIONEN.md is declared authoritative and its table still shows eight GUCs, while §26 binds three sibling documents to the ten-row version. Two Phase 0 documents now publish different versions of the same binding table.

**Where:** §4.2 GUC table vs K-02

**Fix:** Amend K-02 in 00-KONVENTIONEN.md to carry the two audit-only GUCs with the no-policy-may-reference-them rule, so the convention and this document agree; nothing in §4.2 needs to change.

## CONVENTION VIOLATIONS (6)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-03 / K-01 — §4.3 routes withSystemTenant through the role `cse_job` ("| `withSystemTenant(mandantId, grund, fn)` | `mandant` | explicit | — | `off` | `cse_job` | `TenantDb` | jobs, `scripts/`, `api/formular`, `api/bewerbung` |") while §4.5 reproduces K-03's rule that a tenant table has "exactly two policies, and no others", both addressed `to cse_app`. Under FORCE RLS a role with no policy sees and writes nothing, so the helper the document calls "a constructor, not a bypass" is in fact a dead end.

- K-06 — §5.1 ("Everything in `crm-ops.ts`, `gewerke.ts`, `zeit.ts` … Carries `mandant_id`, FORCE RLS and the two K-03 policies") sweeps in `arbeitszeit_verstoss`, which K-06 and the document's own §4.8 require to have "no INSERT policy for `cse_app`". The generated invariant test asserts the opposite of the convention.

- K-03 — §5.3 says writes on `benutzer_mandant` are "gated on `aal2` (K-15)", which requires a policy on the write path, while §5.1 puts `benutzer_mandant` in bucket 1 where K-03 permits exactly two policies. The same table is also described under two buckets (listed in §5.1, its write rules stated in §5.3), which the rls.ts build check does not catch: it fails a table in *no* bucket, not one in two.

- K-02 / K-04 — §4.4 defaults `app.portal()` to `'kunde'` and calls it "the narrowest ceiling", but K-04's mitarbeiter ceiling is written as `app.portal() <> 'mitarbeiter' or …`, so that default satisfies it, and the kunde ceiling K-04 pairs with it has no session subject anywhere in §4.2 or §4.4 (no `app.kunde_id`, no `app.aktueller_kunde()`). Fail-closed is asserted but not achieved for this GUC.

- K-02 — §4.2 publishes a ten-row GUC table where K-02 publishes eight. The addition is justified, audit-only and policy-fenced (and §26 binds three sibling documents to it), but until K-02 is amended the binding convention and its subordinate document disagree, and this document is by its own §0 the defective one.

- K-17 (borderline, financial trigger) — §10's `rechnung-ueberfaellig.ts  daily  overdue > 14 days → propose dunning` fixes when a Mahnung run starts. FIN-15 states only "Dunning with escalation levels, fees, interest"; the levels, fees and §288 interest basis are correctly placeholdered in §8.6 and §25.3, but the trigger delay is not, and it is the parameter that decides when a letter leaves the building.

## VERIFIER VERDICT

All seventeen blocking items genuinely landed in the file — I verified each against the text, not against the claim, and none is merely asserted: the six K-01 roles and FORCE RLS with an app-role isolation harness (§4.1, §15.1), the src/server/queries read facade with the withdrawn "features may call services" sentence (§7, §13, §23), the multi-mandant read scopes resolved inside K-03/K-04 rather than by a new merged policy (§3.11), the three-bucket classification in a checked-in rls.ts that the tests read (§5), K-05 column grants replacing the reviewer's masking view (§4.7), K-06's placement with its narrow return shape (§4.8), src/middleware.ts with a headers/lockout spec (§2, §22), number-and-hash under one lock in one transaction (§8.2), the code-constant policy floor with the €25,000 test against a permissive richtlinie row (§9.2), tenant-scoped RAG with a tenant-leading ANN index (§9.3), switchMandant's authorization order with 404-not-403 (§12.2), /portal with the fourth reserved slug and data-driven module visibility (§3.1), USING plus WITH CHECK (§4.5), security_invoker views and the relkind test (§6.4), nullable geldCent plus menge() at K-16's fixed (12,3) (§4.10), the audit GUCs with a no-policy-may-reference-them test (§4.2), and one punch implementation in the database (§3.12, §25.2). Three of the author's departures from the reviewer's prescribed fix — K-03's two-policy shape over a merged predicate, K-05's column grants over person_gruppe_v, K-06's return shape over one carrying mandant_id/mandant_name — are correct and were made for the right reason: the convention wins. The document is close to implementable, but not yet fit to implement against, because it now contains one defect of the same class it was rewritten to remove: withSystemTenant is specified to run as `cse_job` while §4.5 restates that tenant policies exist only for `cse_app`, so every job, every importer, the REQ-01 lead POST and the REC-03 application POST are refused by a database whose SQL looks correct — and, next to it, membership resolution reads benutzer_mandant through a policy that requires a mandant the session does not yet have. Fix those two, the arbeitszeit_verstoss and person-scope policy contradictions, and the src/app/** → services zone carve-out, and Phase 1 can be built against this file.
