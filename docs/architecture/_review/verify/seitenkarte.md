# Verification findings — seitenkarte

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (13)

### R1. Wage column named `stundensatz_intern_cent`, which is not the column. K-05 grants `-- stundensatz_intern, tarifgruppe omitted` and 02-datenmodell/01-KERN.md §6.14 goes out of its way to fix the spelling: "Note the spelling: **`stundensatz_intern`**, as in D-09 and K-05." A REVOKE/GRANT written from this map would name a column that does not exist and the grant would silently not protect the real one.

**Where:** 04-SEITENKARTE.md l.1796 (§6) and l.1934 (§8)

**Fix:** Rename both occurrences to `stundensatz_intern` (the column is already bigint cents; the `_cent` suffix is not part of its name).

### R2. The Werbewiderspruch route re-conflates the advertising objection with the general Art. 21 objection, and names a table that does not exist. §2.4: "it sets `kontakt.rechtsgrundlage = keine`, after which `crm.kommunikation_senden` refuses **every** outbound message to that contact". 02-CRM-OPERATIONS.md §5 explicitly corrects exactly this: "**`werbewiderspruch_am` does not touch `rechtsgrundlage`** — see §5, where the draft's conflation of the two is corrected"; `werbewiderspruch_am` "blocks `zweck = 'werbung'` only", while `widerspruch_am` forces `rechtsgrundlage = 'keine'`. As written, a customer clicking the advertising opt-out in a newsletter would also stop their invoices, dunning letters and shift notices. There is also no `kontakt` table — the tables are `ansprechpartner` and `kunde`.

**Where:** 04-SEITENKARTE.md l.457-462 (§2.4), repeated in the §17 obligation to `02-datenmodell/02-CRM-OPERATIONS.md` ("the objection must set `rechtsgrundlage = keine` in one transaction")

**Fix:** `/werbewiderspruch/[token]` sets `ansprechpartner.werbewiderspruch_am` (and `kunde.werbewiderspruch_am` where the objection is at company level), which blocks `zweck = 'werbung'` only; a full Art. 21 objection is the separate `widerspruch_am` path that the trigger `kern.erzwinge_widerspruch()` turns into `rechtsgrundlage = 'keine'`. Correct the §17 obligation line to match.

### R3. The customer portal reads zero rows as specified. §8 runs every customer route in `KDN` = `withGroupScope` (`app.scope = 'gruppe'`, `app.mandant_id` NULL) while gating them on ordinary tenant module rights (`auftrag.lesen`, `finanzen.lesen`, `nachweis.lesen`, `dokument.lesen`, …). Under K-03 the only SELECT policy that can match in group scope is `t_gruppe`, which requires `app.hat_recht('gruppe.<modul>.lesen', mandant_id)` — and 03-AUTH-BERECHTIGUNGEN.md §12 grants `gruppe.*.lesen` to super_admin/admin/leitung only, never to `kunde`. The K-04 customer ceiling is restrictive and can only narrow, and 02-CRM-OPERATIONS.md §1.4 deliberately deleted the permissive `sel_kundenportal` policy. This is the same "empty, not denied" failure as B3, fixed for `/portal/gruppe` and left standing for `/portal/kunde`. §17 flags only the other half of it (the `app.aktueller_kunde()` accessor).

**Where:** 04-SEITENKARTE.md §8 l.1900-1930 (scope paragraph and Right column of every row); §1.3 `KDN` row l.94

**Fix:** State which permissive predicate lets a customer read in group scope — either a customer read key set (`gruppe.<modul>.kunde_lesen` or equivalent) bound to the `kunde` role, or a `kunde_zugang`-keyed disjunct inside the existing `t_gruppe` policy the way §7.5's `person_id = app.aktuelle_person()` disjunct works for workers — and add it to §17's obligation (b) alongside the set-valued `app.eigene_kunden()` accessor.

### R4. The `abrechnung` module is gated by four routes but is absent from §1.7's module-availability table, which the same section declares authoritative ("A route under `/portal/[mandant]/<modul>/…` returns `notFound()` when `<modul>` is not enabled"). `abrechnung` is a real module in 03-AUTH §12 (l.1062: `vertrag_abrechnung`, `kunde_bauleistender_status`, `freistellungsbescheinigung`) and in 02-CRM §2. Its enablement per mandant is therefore undefined, and the Phase 6 seed cannot be written from this document.

**Where:** 04-SEITENKARTE.md §1.7 module table l.227-243; routes at l.787, l.834 (`/auftraege/[id]/abrechnung`), l.1249 (`/eingangsrechnungen/[id]/steuer`), l.1620 (`/einstellungen/abrechnungsarten`)

**Fix:** Add an `abrechnung` row to the §1.7 table (✓/✓/✓ for the three operating areas, blocked on O-01/O-33 for `operations` like `finanzen`).

### R5. The route that renders the K-06 panel does not require the K-06 right. §5.10's row for `/portal/[mandant]/dienstplan/einsatz/[id]` — "assignment detail: qualification check, ArbZG panel, conflicts" — is gated on `dienstplan.lesen` alone, while §5.10.1 says the panel calls `app.arbzg_belastung`, which K-06 preconditions on "holding `dienstplan.arbzg_pruefen` in the active mandant" and which refuses (audited) otherwise. A planner with `dienstplan.lesen` only gets a panel whose function call is refused — and an empty ArbZG panel reads as "no conflict", which is the exact silent failure K-06 exists to prevent.

**Where:** 04-SEITENKARTE.md l.1066 (§5.10 route table)

**Fix:** Change the Right cell to `dienstplan.lesen` + `dienstplan.arbzg_pruefen`, or state that without `arbzg_pruefen` the panel renders an explicit "ArbZG-Prüfung nicht berechtigt" state and never an empty result.

### R6. `app.offline_ereignis_annehmen` is executed "under `cse_checkin`", which K-01 does not permit — that role "[holds] `EXECUTE` on `app.checkin_verbrauchen` only" — and K-08 says "Three functions, and only these three, may execute outside `withTenant`", listing `sitzung_aufloesen`, `versuch_protokollieren` and `checkin_verbrauchen`. The same deviation exists in 03-AUTH §5.4, 04-PLANUNG-ZEIT §9.4 and 05-API-KARTE, so it is repository-wide, but this map cites K-08 three times while contradicting it and does not raise it in §17.

**Where:** 04-SEITENKARTE.md l.703 (§4.3)

**Fix:** Either fold the offline replay into `app.checkin_verbrauchen` (or a mode of it), or add a §17 obligation on `00-KONVENTIONEN.md` to amend K-01's `cse_checkin` grant and K-08's list to four functions — a convention conflict must be resolved in the convention, not left implicit in four domain documents.

### R7. The reserved-slug CI test cannot enforce what §1.6's own table says it enforces, and one static sibling is unlisted. The test "collects every static first segment under `src/app/portal/`", yet the table's `/karriere/[stelle]` row says the reservation is "`CHECK` on `stelle.slug` + **the same CI test**", and the `/leistungen/[slug]`, `/news/[slug]`, `/projekte/[slug]` row says "the CI test still asserts it" — none of those trees is under `src/app/portal/`. Separately, `/karriere/danke` (l.325) is a second static sibling of `[stelle]` that the reservation column does not name, so a Stelle with slug `danke` becomes unreachable — the very failure §1.6 exists to close.

**Where:** 04-SEITENKARTE.md §1.6 l.193-208, route l.325

**Fix:** State the test's scope as every level at which a dynamic segment has static siblings (`src/app/portal/`, `/karriere/`, `/unternehmen/`, `/angebot/`, `/leistungen/`, `/news/`, `/projekte/`), and add `danke` to the `stelle.slug` reservation next to `initiativbewerbung`.

### R8. The `USR` scope is undefined for the sessions that actually reach it. §1.3 defines `USR` as "`withTenant` on the account tables of the principal itself", but `withTenant` requires exactly one active mandant (`app.mandant_id` NOT NULL, K-02), while §1.2 says `/portal/konto` "inherits the shell of the portal the session is in" — including group scope (§6: "no area is active") and the worker portal, both of which run with `app.mandant_id` NULL. `benutzer`, `benutzer_sitzung` and `benutzer_feed_token` carry no `mandant_id` at all, so the tenant helper is both unavailable and unnecessary there, yet K-08's route-manifest test demands some declared helper.

**Where:** 04-SEITENKARTE.md l.96 (§1.3 `USR` row), l.60 (§1.2 `portal/konto` row)

**Fix:** Name the helper that wraps a `USR` read when there is no active mandant (a `withKonto`/`withGroupScope` variant), and add it to the route-manifest test's allowed set, or state that `/portal/konto` always resolves the session's default membership first.

### R9. A `// TODO(client)` with no O-number and no entry in §16, contrary to the document's own rule ("Every entry exists in the document as a labelled placeholder … and must be mirrored in `docs/DECISIONS.md` under **Open**", K-17). The check-in delivery-channel question at §4.4 is unnumbered ("relates to O-22") and appears in neither §16.1 nor §16.2, while 02-datenmodell/04-PLANUNG-ZEIT.md numbers the same question **O-32** — which collides with 03-AUTH-BERECHTIGUNGEN.md's O-32 (auth-event retention) that §5.24 cites, and with §16's own claim that "Numbering continues from O-32". The map caught the equivalent O-13 collision and should catch this one.

**Where:** 04-SEITENKARTE.md §4.4 TODO block (l.756-761), §16 preamble, §5.24

**Fix:** Give the delivery-channel question a number (or fold it into O-22), list it in §16, and add a §17 line telling 04-PLANUNG-ZEIT that its O-32 collides with 03-AUTH's O-32 — the same treatment already given to O-13/O-52.

### R10. The switcher-counter function's contract does not match its definition. §11.3 says `app.mandant_kennzahlen()` returns "(mandant_id, kennzahl, wert)", while 02-datenmodell/01-KERN.md §6.x defines `app.mandant_kennzahlen() returns table (mandant_id uuid, schluessel text, wert integer, berechnet_am timestamptz)` restricted to `app.switcher_mandanten()`. The map additionally asserts the results are "filtered by the viewer's own read rights", which the definition does not state (it is a job-written counter table).

**Where:** 04-SEITENKARTE.md l.2111-2120 (§11.3)

**Fix:** Use `schluessel` (or rename the column in 01-KERN) and add a §17 obligation on 01-KERN to state the right-filtering, since the map now depends on it for the customer/worker leak argument.

### R11. The O-33 placeholder is not implementable as written: the §1.7 table marks nine module cells `?` for `operations` (`crm`, `crm_entgelt`, `formular`, `angebot`, `kalkulation`, `auftrag`, `katalog`, `radar`, `vergabe`), the TODO names five (`crm`, `angebot`, `auftrag`, `radar`, `formular`) and then says "Until answered **the four modules** are seeded off". Three different counts for one seed. Separately, `qualitaet` is decided as off for `operations` in the same table, although a Reklamation presupposes an external customer — the same question O-33 asks.

**Where:** 04-SEITENKARTE.md §1.7 table l.230-241 and TODO l.263-266

**Fix:** Make the module list in the TODO identical to the `?` cells in the table, and either add `qualitaet` to the `?` set or say why it is decidable while `crm` is not.

### R12. `/portal/kunde/rechnungen` decides "finalised invoices only", which 03-AUTH-BERECHTIGUNGEN.md §20 raises as open **O-31** ("Do customers see finalised invoices only, or may a draft ever be visible to them?"). The decision is the right one and is consistent with FIN-02/K-12 and with the `angebot` customer ceiling (`versendet_am IS NOT NULL`), but it is taken in a table without citing O-31 and O-31 is absent from §16.2.

**Where:** 04-SEITENKARTE.md §8 route table (`/portal/kunde/rechnungen`)

**Fix:** Cite O-31 on the row and add it to §16.2 with the note that the map answers it conservatively (no draft is ever customer-visible), so the answer is recorded rather than assumed.

### R13. Dangling cross-reference: the `FEED` row points at "§9.4" for the iCal contract; §9 contains only §9.1.

**Where:** 04-SEITENKARTE.md l.97 (§1.3)

**Fix:** Change to §9.1.

## CONVENTION VIOLATIONS (5)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

- K-01 / K-08 — §4.3 l.703: "`POST /api/check-in/[token]` replays queued events into `app.offline_ereignis_annehmen` under `cse_checkin`". K-01 gives `cse_checkin` "`EXECUTE` on `app.checkin_verbrauchen` only" and K-08 admits exactly three pre-session functions, of which this is not one. (Inherited from 03-AUTH §5.4, 04-PLANUNG-ZEIT §9.4 and 05-API-KARTE — but the convention wins, and this map does not raise it in §17.)

- K-03 — §8 gates `/portal/kunde/**` on tenant rights (`auftrag.lesen`, `finanzen.lesen`, `nachweis.lesen`, `dokument.lesen`) while running the routes in `withGroupScope`. K-03's group policy is `using (app.ist_gruppenansicht() and mandant_id = any (app.sichtbare_mandanten()) and app.hat_recht('gruppe.<modul>.lesen', mandant_id))`, and the `kunde` role holds no `gruppe.*` key (03-AUTH §12 l.1731), so every customer SELECT matches no permissive policy.

- K-05 — §6 l.1796 and §8 l.1934 name the withheld column `stundensatz_intern_cent`. K-05's grant statement withholds `stundensatz_intern` ("-- stundensatz_intern, tarifgruppe omitted"), and 01-KERN §6.14 fixes that spelling explicitly.

- K-06 — §5.10 l.1066 gates `/portal/[mandant]/dienstplan/einsatz/[id]`, the route that renders the ArbZG panel, on `dienstplan.lesen` alone, although K-06 preconditions `app.arbzg_belastung` on "holding `dienstplan.arbzg_pruefen` in the active mandant" and §5.10.1 of the same document repeats that precondition.

- K-17 (traceability half) — §4.4's `// TODO(client)` on the check-in delivery channel carries no O-number and appears in neither §16.1 nor §16.2, although §16 states every placeholder "must be mirrored in `docs/DECISIONS.md` under **Open**". The same question is numbered O-32 in 04-PLANUNG-ZEIT, colliding with 03-AUTH's O-32 that §5.24 cites.

## VERIFIER VERDICT

All seventeen BLOCKING findings genuinely landed in the file — I checked each against the written text rather than the claim, and none is asserted-only: the portal is under `/portal` with the four short entity URLs deleted (§1.1), reserved slugs carry a CHECK plus a tree-walking CI test (§1.6), `GRP`/`withGroupScope` is defined with K-02 GUCs and invariant 10 enforced four times (§1.3, §6), the switcher counters have a named right-filtered source that exists in 01-KERN (§11.3), the ArbZG panel renders K-06's projection and nothing else (§5.10.1), wage confidentiality is K-05 column GRANTs plus `app.entgelt_lesen` (§6), `PER→M1` is a six-step 404-not-403 resolution order (§1.3.1), the iCal feed is its own FEED token with a field allowlist (§9.1), customers live in `/portal/kunde` without a switcher (§8), the offer and career paths are dynamic (§2.1, §2.3), `/wechseln` no longer exists (§1.5), the check-in token is one row per leg with the K-09 conditional write (§4.2), the customer and subcontractor tax routes exist with correctly typed date windows (§5.3), agent cost is bigint cents plus an exact carry (§5.19), Raumbuch is an Operations capability (§1.7), person facts have one editor (§5.12.1), and the worker principal is one `benutzer` row with one account family (§3, §7, §9). All three rejections are correct — K-05 forbids the prescribed masking view, K-16 forbids `kosten_mikrocent`, and K-06 forbids returning `mandant_id` from the ArbZG projection — and each is argued from the convention rather than from preference. What remains is not a re-run of the review: the two findings I would hold a PR on are the customer portal reading zero rows (§8 gates group-scope routes on tenant module rights that K-03's group policy cannot satisfy for a `kunde` role — the same silent-empty failure that B3 fixed for `/portal/gruppe`) and the two identifier errors that an implementer would copy verbatim (`stundensatz_intern_cent`, and `kontakt.rechtsgrundlage = keine`, which also re-conflates the advertising objection with Art. 21 against 02-CRM's explicit correction and would silence transactional mail). Behind those sit a missing `abrechnung` module row, an ArbZG route that omits the right its own panel requires, an offline replay path that contradicts K-01/K-08, and a handful of navigation and traceability slips. Fix the customer-portal read path, the two identifier errors and the missing module row, and this document is fit to be implemented against — it is otherwise unusually disciplined: money is bigint cents throughout, instants are timestamptz while day-valued facts are `date`, every calendar boundary is Berlin wall-clock, D-09's attachment split is correct in both directions, every design value traces to DESIGN.md, no external call is simulated, and every legal or financial value it states (15-minute signed URLs, two-year MiLoG, ten-year AO, five-day radar countdown, the €20,000 threshold) is one SPEC states, with the rest behind twenty labelled O-numbers.
