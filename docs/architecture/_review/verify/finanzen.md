# Verification findings — finanzen

These were found by an independent verifier reading the WRITTEN file.
All original BLOCKING items were confirmed fixed; what follows is new.

## REMAINING DEFECTS (13)

### R1. The finalisation writer is SECURITY DEFINER owned by `cse_definer`, but steps 4, 6 and 9 UPDATE `nummernkreis` and `rechnung` — two ordinary tenant tables whose only policies are `create policy t_mandant on <tabelle> for all to cse_app` and `t_gruppe … to cse_app` (§1.3), under `force row level security` (§1.1). A definer function runs as `cse_definer`, matches neither policy, and is not exempt: §1.1 itself says 'K-01 exempts `cse_definer` from FORCE RLS only on the tables named in K-06 and K-08' and requests the extension for `rechnung_snapshot` and `rechnung_hash` *only*, adding 'Nothing else in this domain writes as the definer.' §5.6 contradicts that sentence three times. As written, `UPDATE nummernkreis SET naechste_nummer = naechste_nummer + 1` affects zero rows and no invoice can ever be finalised — or, if an implementer 'fixes' it by making `cse_definer` the owner or granting BYPASSRLS, K-01 is breached silently.

**Where:** §1.1 ('Nothing else in this domain writes as the definer'), §5.6 steps 4/6/9, §2.3 item 1, §14 row 'narrow `for insert to cse_definer`'

**Fix:** Either (a) extend §2.3 item 1 and §14 to register two additional narrow `for update to cse_definer` policies — on `nummernkreis` (counter and `letzter_hash` only) and on `rechnung` (the step-6 column set only) — and correct the §1.1 sentence; or (b) keep the counter draw and the header UPDATE in the `cse_app` transaction (they are already protected by the FOR UPDATE lock and by `rechnung`'s WITH CHECK) and shrink the definer function to steps 7–8, which are the only writes that genuinely need elevated rights.

### R2. §4.9 point 4 of the deferred totals trigger reads '`zahlbetrag_cent` = `brutto_cent` − `abzug_brutto_cent`, and `einbehalt_bauabzugsteuer_cent` ≤ `zahlbetrag_cent`'. On a Storno both values are negative by the B9 sign-coherence rule, and −150 ≤ −1000 is false, so the trigger raises at COMMIT on exactly the row §15 test 11 requires to insert ('A Storno of a Schlussrechnung with a deducted Abschlag and a §48 withholding **inserts**, with negative `abzug_brutto_cent` and `einbehalt_bauabzugsteuer_cent`'). B9's fix is undone one section later.

**Where:** §4.9 point 4, against §4.1 sign CHECKs and §15 test 11

**Fix:** Restate the fourth condition in magnitude terms: `abs(einbehalt_bauabzugsteuer_cent) <= abs(zahlbetrag_cent)` together with the existing sign-coherence CHECK, or scope it to `rechnungsart <> 'storno'`.

### R3. The Storno's open item cannot be closed by the very mechanism B20 introduced. §7.3 defines `betrag_cent` as 'the document's `zahlbetrag_cent` at finalisation', which for a Storno is negative, with `offen_cent GENERATED ALWAYS AS (betrag_cent - bezahlt_cent)` and `CHECK (bezahlt_cent >= 0)`; `op_ausgleich.betrag_cent CHECK (> 0)` and `fin.op_fortschreiben()` 'stamps `ausgeglichen_am` when `offen_cent = 0`'. Reaching `offen_cent = 0` from `betrag_cent = -1000` requires `bezahlt_cent = -1000`, which the CHECK forbids. This also contradicts §3.1's claim for `offener_posten_art` that 'no cent column in this domain ever needs a sign'.

**Where:** §7.3 (`betrag_cent`, `CHECK (bezahlt_cent >= 0)`), §7.4, §3.1 `offener_posten_art`

**Fix:** State which it is: either a Storno opens a `debitor_guthaben` item with a **positive** `betrag_cent` (consistent with §3.1, and then §7.3's 'the document's `zahlbetrag_cent`' must say `abs(...)` plus the art mapping), or `bezahlt_cent` and `op_ausgleich.betrag_cent` become sign-coherent with `betrag_cent`. Whichever is chosen, add it to §15 test 11's assertion so the arithmetic is exercised.

### R4. §5.6 step 2 resolves the circle for '(mandant_id, 'ausgangsrechnung', null, jahr(app.berlin_heute()))', but §3.3 defines `nummernkreis.jahr` as `CHECK (jahr = 0 OR jahr BETWEEN 2000 AND 2100)` with '`0` = fortlaufend über Jahre'. Under `zuruecksetzung = 'nie'` — one of the two enum values, and the one O-04 may well confirm — the circle carries `jahr = 0`, the step-2 lookup against `nummernkreis_key (mandant_id, kreis_typ, kontext_id, jahr)` finds nothing, and finalisation fails for every invoice.

**Where:** §5.6 step 2 against §3.3 `jahr` and `nummernkreis_key`

**Fix:** State the resolution rule for both cases explicitly: look up `jahr = jahr(rechnungsdatum)` when the circle's `zuruecksetzung = 'jaehrlich'`, else `jahr = 0` — e.g. resolve on `(mandant_id, kreis_typ, kontext_id) WHERE geschlossen_am IS NULL` (which `nummernkreis_offen_key` already makes unique) and then assert the `jahr` matches the mask.

### R5. The group-scope ceiling silently corrupts the figure it is meant to protect. §1.4 point 3 asserts 'the group dashboard does not read base tables at all: FIN-17, ACC-08, DSH-01 and DSH-02 read the aggregate views of §10' — but §1.12 makes every §10 view `WITH (security_invoker = true)`, so `finanz_kennzahl_monat` reads `buchungssatz` **as the caller** and the restrictive `p_gruppe_kein_personenbezug` (registered in §14 for `buchungssatz`, keyed 'via `ausgabe_id`') removes every expense-derived booking row in group scope. The group `aufwand_cent`/`ergebnis_cent` are therefore understated with no error, and the ceiling over-blocks besides: most `ausgabe` rows carry no `anstellung_id` at all. §1.4's own test only checks the *revenue* figure reconciles, so the defect is untested.

**Where:** §1.4 point 3 and the `p_gruppe_kein_personenbezug` block, §1.12, §10 `finanz_kennzahl_monat`, §14 registry row, §15 test 22

**Fix:** Key the buchungssatz ceiling on person-bearing rows, not on `ausgabe_id` — e.g. `not app.ist_gruppenansicht() or ausgabe_id is null or exists (select 1 from ausgabe a where a.id = ausgabe_id and a.anstellung_id is null)` — and either accept that reimbursement bookings are excluded from the group BWA and say so, or aggregate them into a person-free bucket. Extend the §1.4 test to reconcile expense and result, not only revenue, and drop or qualify the 'does not read base tables at all' sentence.

### R6. A composite FK is demanded against a parent that has no `mandant_id`. §3.3 `konto_mapping` lists '`ausgabe_kategorie_id · kunde_id · lieferant_id · bankkonto_id · kasse_id · steuersatz_gruppe_id | uuid | yes | — | composite FKs, one per discriminator`', and §13's register repeats '`konto_mapping` | `(mandant_id, …)` for each of its six discriminator columns'. But §3.2 declares `steuersatz_gruppe` a **global, non-tenant** table, and §13's own closing paragraph names `*.steuersatz_gruppe_id` as one of 'the four deliberate single-column FKs'. `(mandant_id, steuersatz_gruppe_id)` cannot be created. (The count is also wrong: seven discriminator columns are listed, not six.)

**Where:** §3.3 konto_mapping column table, §13 register row `konto_mapping`, §13 closing paragraph

**Fix:** Exclude `steuersatz_gruppe_id` (and `leistungskatalog_position_id`'s count) from the composite list in §3.3 and §13, marking it a single-column FK into a global reference table, and correct 'six' to the actual number.

### R7. Two register rows in §13 name FK columns that the child tables do not declare. `rechnung_versand` is registered with '`(mandant_id, kunde_id, empfaenger_ansprechpartner_id)`', but §9.6's column list has no `kunde_id`. `export_zeile` is registered with '`(mandant_id, buchungssatz_id)`', but §9.3 gives `export_zeile` only `abschnitt`, `zeilen_nr`, `quelle_tabelle`, `quelle_id` (explicitly 'no FK') and `felder`. The §13 schema test that 'walks `information_schema` and fails on' a non-composite FK will fail on the register itself.

**Where:** §13 register rows `rechnung_versand` and `datev_buchungsstapel_zeile, export_zeile`, against §9.6 and §9.3

**Fix:** Add `kunde_id uuid not null` to `rechnung_versand` (it is needed anyway to pin the composite FK to `ansprechpartner`'s `UNIQUE (mandant_id, kunde_id, id)`), and split the register row so `(mandant_id, buchungssatz_id)` applies to `datev_buchungsstapel_zeile` only.

### R8. §16 is built on four columns that no table in the document defines. It requires '`verarbeitung_eingeschraenkt boolean not null default false` on `eingangsrechnung_extraktion`, `camt_umsatz` and `lieferant`' — none of §8.4, §7.9 or §8.1 declares it; it says `camt_umsatz` fields are 'retained until `aufbewahrung_bis`' and that `job:anonymisierung` 'requires `loeschsperre = false`' — §7.9 declares neither column (only `camt_import` has the retention block); and it says '`anonymisiert_am` on the master row' for `lieferant`, which §8.1 does not carry. §7.9 additionally freezes the row: 'only `zuordnung_status`, `vorschlag` and `zahlung_id` are mutable', so even if the column existed the restriction could not be set.

**Where:** §16 (three mechanisms and the table), against §7.9, §8.1, §8.4

**Fix:** Add `verarbeitung_eingeschraenkt`, `aufbewahrung_klasse`/`aufbewahrung_bis`/`loeschsperre` and `anonymisiert_am` to the three column tables, and widen `camt_umsatz`'s mutability allowlist to include the restriction and anonymisation columns.

### R9. `rechnungsposition` forces a unit and a quantity onto lines that by definition have neither. §4.3 declares `menge numeric(12,3) | no`, `einheit text | no` and `masseinheit_id uuid | no` (all NOT NULL), while §3.1 defines `positionsart` as `leistung · textzeile · zwischensumme` with 'a text line carries no amounts … a Zwischensumme is display-only and is excluded from every sum'. The neighbouring CHECKs (`CHECK (positionsart <> 'leistung' OR (… masseinheit_id IS NOT NULL))`, `CHECK (positionsart = 'leistung' OR (netto_cent IS NULL AND einzelpreis_cent IS NULL))`) are written as if all three were nullable.

**Where:** §4.3 rechnungsposition column table vs §3.1 `positionsart`

**Fix:** Make `menge`, `einheit` and `masseinheit_id` nullable and let the existing `positionsart <> 'leistung' OR …` CHECK carry the requirement, adding the mirror `CHECK (positionsart = 'leistung' OR (menge IS NULL AND masseinheit_id IS NULL))`.

### R10. The B5 fix collides with a deliberate CRM decision and the collision is unstated. `masseinheit_id` is NOT NULL against a closed catalogue keyed on 'a value of the shared `EINHEITEN` constant' (§3.2), while `02-CRM-OPERATIONS.md` §0.11 declares `einheit text NOT NULL` 'Deliberately not an enum: a VOB Leistungsverzeichnis import (BAU-01) legitimately brings units this list does not contain, and an import must not fail on a unit string.' An LV line carrying an off-list unit therefore imports fine into `auftrag_leistung` and then cannot be invoiced at all, and the only write path into `masseinheit` is §3.2's `r_pflege` policy — a super-admin at aal2 holding `referenz.verwalten`.

**Where:** §3.2 masseinheit, §4.3 `masseinheit_id`, against `02-CRM-OPERATIONS.md` §0.11

**Fix:** State the path in §3.2 or §2.3: an unmapped unit creates a `masseinheit` row with `ist_platzhalter = true` on first use (so the invoice can be drafted and rule 14 blocks only the XRechnung-bound finalisation), or the invoice draft service raises a named error pointing at the Mengeneinheiten screen. Either way add it to §17 row 2's question.

### R11. §1.6 says '**Two columns are exempt and stay `NOT NULL REFERENCES benutzer(id)`**' and then lists seven (`rechnung.festgeschrieben_von`, `rechnung_versand.freigegeben_von`, `mahnung.freigegeben_von`, `eingangsrechnung.freigegeben_von`, `buchungssatz.festgeschrieben_von`, `datev_export.erzeugt_von`, `periode.geschlossen_von`). Five of the seven are then declared nullable in their own tables (§4.1 `festgeschrieben_von | uuid | yes`, §7.5, §8.2, §9.1, §9.2) — necessarily so, since a draft has no approver. Only `rechnung_versand.freigegeben_von` and `datev_export.erzeugt_von` are actually NOT NULL, which is presumably where 'two' came from.

**Where:** §1.6 'Two columns are exempt', against §4.1, §7.5, §8.2, §9.1, §9.2

**Fix:** Rewrite as 'Seven columns never carry a `system` or `agent` actor; two of them (`rechnung_versand.freigegeben_von`, `datev_export.erzeugt_von`) are NOT NULL, the other five are NULL until the act happens and are forced by their table's status CHECK.'

### R12. `buchungssatz.periode_id | uuid | no` is NOT NULL with a composite FK 'resolved from `buchungsdatum`', but nothing in the document creates `periode` rows. §9.1 gives `periode` an Auditblock and RLS but no seeding or roll-forward rule, and §11's `monatszahlen` job only UPDATEs `periode` at closing. The first booking of a new month therefore fails on a missing parent, in the finalisation transaction, in production.

**Where:** §9.2 `periode_id`, §9.1, §11

**Fix:** State the creation path in §9.1 — a `fin.periode_sichern(mandant, datum)` called from the booking service (or a monthly job that opens the next N periods from `datev_konfiguration.wj_beginn_monat`/`wj_beginn_tag`) — and add it to §11.

### R13. Small internal inconsistencies that will each cost an implementer a round trip: (a) §14 says '`p_kunde_ceiling` | the six customer-visible tables of §1.4' while §1.4's table lists eight (`rechnung`, the six children, `offener_posten`) plus the degenerate pair; (b) §6's Kleinbetrag paragraph relaxes 'rules 2, 5 (recipient-specific parts)' but rule 5 is '`nummer` drawn from the circle and unique per mandant' and has no recipient part; (c) §8.1 declares `zahlungsziel_tage | smallint` while §1.7's own type table says 'Duration | `integer` with the unit in the name | `verzugstage`, `zahlungsziel_tage`'; (d) §1.7 requires `CHECK (x ~ '^[0-9a-f]{64}$')` on every hash column, and §3.3 states it for `nummernkreis.letzter_hash` but not for `genesis_hash`; (e) the §13 ER diagram draws `datev_konfiguration ||--o{ datev_export` although `datev_export` declares no `datev_konfiguration_id`.

**Where:** §14, §6 Kleinbetrag paragraph, §8.1, §3.3 nummernkreis, §13 mermaid block

**Fix:** Correct the count in §14, name the actually relaxed rules in §6 (2 and the per-group split of 8/9, per §33 UStDV), make `lieferant.zahlungsziel_tage` an `integer`, add the hex CHECK to `genesis_hash`, and either add the column or redraw the diagram edge as a dashed 'gates' relation.

## CONVENTION VIOLATIONS (0)

NOTE: 00-KONVENTIONEN.md has since been AMENDED. Re-read it before acting on these —
several are now permitted deviations (K-16 a-d), the K-08 register now has five entries,
and K-18 introduces person/kunde scope. Where the amended convention now allows what the
document does, no change is needed: say so.

## VERIFIER VERDICT

All 21 blocking findings genuinely landed in the file — this is not a document that claims fixes it did not make. Every one is traceable to concrete schema text (a named column, a quoted CHECK, an index definition, a trigger body, a registry row in §14 and a test in §15), the two the author says he "corrected the mechanism" on (B2, B16) are argued against the convention text rather than waved away, and the placeholder discipline is real: `bauabzugsteuer_freigrenze`, `kleinbetrag_grenze`, `masseinheit`, `nummernkreis.zuruecksetzung` and `zahlungsziel_tage` all block rather than default, with 30 TODO(client) rows indexed in §17 and no unsourced legal or financial constant left in the schema (the two statutory values that remain — the §48 Abs. 1 15 % rate and the §48a 10th-of-the-month deadline — carry their Fundstelle and sit behind `ist_platzhalter`). Money is `bigint` cents throughout with no `numeric` money column, instants are `timestamptz`, `current_date` is gone in favour of `app.berlin_heute()`, D-09 is respected (`ausgabe.anstellung_id` is the only anstellung hook and it is a costed thing, column-restricted per K-05), and nothing simulates DATEV, ELSTER or Peppol. It is not yet fit to implement against unchanged, though, for one blocking reason and a handful of arithmetic ones: §5.6's SECURITY DEFINER writer updates `nummernkreis` and `rechnung`, two tables whose only policies are `to cse_app` under FORCE RLS, with no registered exemption and a §1.1 sentence that explicitly denies such writes exist — as written, no invoice can be finalised, and the obvious "fix" an implementer would reach for breaches K-01. Alongside that, §4.9's fourth condition and `offener_posten`'s `CHECK (bezahlt_cent >= 0)` quietly undo B9 and B20 for the Storno case that §15 test 11 demands, §5.6 step 2 cannot resolve a `zuruecksetzung = 'nie'` circle (`jahr = 0`), the group ceiling on `buchungssatz` silently understates the very aggregate view §1.4 points the group dashboard at, and §16 rests on four columns no table declares. Fix those six and the document is a solid implementation contract; the remaining items are single-line corrections.
