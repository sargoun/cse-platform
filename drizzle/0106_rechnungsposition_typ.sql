-- ===========================================================================
-- 0106 — Die Rechnungszeile bekommt ihre Abrechnungsart als TYP und ihren
--        Verweis auf die Konfiguration, aus der sie entstanden ist
--        (FIN-01, FIN-07-Vorarbeit, O-04)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §4.3
-- („rechnungsposition"). `0075` hat beide Spalten bereits angelegt und dabei
-- woertlich vermerkt, warum sie damals so aussahen, wie sie aussahen:
--
--   · `abrechnungsart` war `text`, weil der ENUM `02-CRM-OPERATIONS.md` §2
--     gehoert (K-21) und mit DIESEM PR kommt. Ihn in `0075` anzulegen haette
--     einen zweiten Eigentuemer fuer eine Liste geschaffen, die niemand
--     bestaetigt hat.
--   · `vertrag_abrechnung_id` trug keinen Fremdschluessel, weil es die
--     Elterntabelle nicht gab. Die STRUKTUR stand trotzdem schon dort: eine
--     spaetere Spalte auf `rechnungsposition` waere eine Migration mit
--     Datenwanderung auf einer Tabelle, die per Invariante 4 unveraenderlich
--     ist.
--
-- Beides wird hier eingeloest, und mehr nicht. Die Tabelle ist zu diesem
-- Zeitpunkt in keiner Umgebung mit Werten in `abrechnungsart` belegt (nur
-- Strategien schreiben sie, und die entstehen mit diesem PR), weshalb die
-- Typumstellung keine Datenwanderung ist und der `using`-Ausdruck ohne
-- Abbildungstabelle auskommt.
--
-- **Die Unveraenderlichkeit bleibt unberuehrt.** `0076` haengt
-- `fin.kind_unveraenderlich()` als ZEILENausloeser an `rechnungsposition`;
-- `ALTER TABLE` feuert keinen Zeilenausloeser, schreibt die Tabelle neu und
-- laesst jeden gespeicherten Wert stehen. Die kanonische Nutzlast fuehrt
-- `abrechnungsart` als Zeichenkette (§5.3) — ein ENUM kommt als dieselbe
-- Zeichenkette heraus, also aendert diese Migration keinen einzigen Digest.
--
-- NICHT hier: `rechnungsposition_quelle` (FIN-07, PR 49).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `abrechnungsart` wird der Typ, der sie immer sein sollte
-- ---------------------------------------------------------------------------

/**
 * `nullif(btrim(…), '')` und nicht der nackte Cast: eine leere Zeichenkette
 * ist kein ENUM-Wert und liesse die Migration mit
 * „invalid input value for enum" stehenbleiben — an einer Stelle, an der
 * niemand mehr sagen kann, welche Zeile gemeint war. Leer heisst hier
 * „nicht gesetzt", und das ist NULL.
 */
alter table rechnungsposition
  alter column abrechnungsart type abrechnungsart
  using nullif(btrim(abrechnungsart), '')::abrechnungsart;

comment on column rechnungsposition.abrechnungsart is
  'Die eingefrorene Kopie der Abrechnungsart (FIN-01). Der ENUM gehoert '
  '02-CRM-OPERATIONS.md §2 (K-21). PLATZHALTER-Vokabular bis O-04 beantwortet '
  'ist.';

-- ---------------------------------------------------------------------------
-- 2. Der Weg von der Zeile zu ihrer Abrechnungskonfiguration
-- ---------------------------------------------------------------------------

/**
 * Zusammengesetzt ueber `mandant_id` (K-16): eine Rechnungszeile der einen
 * Gesellschaft darf nicht auf die Abrechnungskonfiguration einer anderen
 * zeigen. Ohne das Paar waere genau das moeglich, und der Stundensatz einer
 * fremden Gesellschaft stuende auf einem festgeschriebenen Beleg.
 */
alter table rechnungsposition add constraint rp_vertrag_abrechnung_fk
  foreign key (mandant_id, vertrag_abrechnung_id)
  references vertrag_abrechnung (mandant_id, id);

/**
 * **Die staerkere Bedingung des Kapitels steht hier NICHT.**
 *
 * §4.3 nennt `CHECK (positionsart <> 'leistung' OR abrechnungsart IS NOT NULL)`
 * — jede Leistungszeile traegt eine Abrechnungsart. Uebernommen wuerde damit
 * auch jede VON HAND erfasste Zeile eines Belegs ohne Auftrag eine
 * Abrechnungsart verlangen: die einmalige Rechnung an einen Kunden, zu dem es
 * keinen `auftrag` und damit keine `vertrag_abrechnung` gibt. Welche der fuenf
 * Arten das waere, hat niemand entschieden — und O-04 ist offen. Eine
 * Pflichtangabe ohne entscheidbare Antwort erzeugt genau das, was K-17
 * verbietet: einen Vorgabewert, den der Dienst still setzt.
 *
 * Was hier steht, ist die Haelfte, die entscheidbar IST und die eigentliche
 * Gefahr abdeckt: eine Zeile, die eine Abrechnungskonfiguration NENNT, muss
 * auch sagen, welche Art daraus angewandt wurde. Sonst stuende auf dem Beleg
 * ein Verweis auf eine Konfiguration, deren Art sich seither geaendert haben
 * kann — und die eingefrorene Kopie waere leer, waehrend die lebende Zeile
 * etwas anderes sagt.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Mit der Antwort wird
 * diese Bedingung auf die Fassung des §4.3 verschaerft.
 */
alter table rechnungsposition add constraint rp_abrechnungsart_bei_konfiguration
  check (vertrag_abrechnung_id is null or abrechnungsart is not null);

-- „Was wurde aus dieser Konfiguration schon berechnet" — die Abfrage, die der
-- Abrechnungslauf vor jedem Vorschlag stellt (FIN-01, FIN-18).
create index rp_vertrag_abrechnung_idx on rechnungsposition (mandant_id, vertrag_abrechnung_id)
  where vertrag_abrechnung_id is not null;
