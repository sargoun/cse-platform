-- 0256 — der Kunde darf seinen eigenen Beleg herunterladen
-- (FIN-11, FIN-12, DOC-03, K-12, AUT-06, 04-SEITENKARTE §8).
--
-- ===========================================================================
-- Der Befund stand als Kommentar im Code und wartete auf diesen PR
-- ===========================================================================
--
-- `src/app/api/finanzen/rechnungen/[id]/zugferd.pdf/route.ts` sagt es woertlich:
--
--   „Und heute kommt hier NUR das interne Portal durch, auch wenn der Katalog
--    `finanzen.herunterladen` ebenso dem Kunden gibt. Der Grund liegt eine
--    Ebene tiefer: `rechnung_snapshot` traegt seit 0077 eine RESTRIKTIVE
--    Policy `p_intern_ceiling` mit `app.portal() = 'intern'`. Eine
--    Kundensitzung kaeme also durch `authorize` und faende danach null Zeilen
--    — Antwort 404. Das ist kein Fehler dieser Route und wird hier auch nicht
--    heimlich umgangen: das Kundenportal braucht eine eigene, eng gefasste
--    Policy auf den Snapshot seiner EIGENEN festgeschriebenen Belege, und die
--    gehoert in denselben PR wie die Seite, die sie benutzt."
--
-- Das ist dieser PR, und das ist diese Datei.
--
-- ===========================================================================
-- Warum es ohne den Snapshot nicht geht
-- ===========================================================================
--
-- PDF, ZUGFeRD und XRechnung entstehen nach K-12 AUSSCHLIESSLICH aus
-- `rechnung_snapshot.nutzlast_bytes` — nie aus den heutigen Stammdaten. Das
-- ist der Grund, warum derselbe Beleg bei jedem Abruf byte-gleich ist und
-- sein SHA-256 als Nachweis taugt. Ein Kundenportal, das den Snapshot nicht
-- lesen darf, kann deshalb nicht „irgendwie anders" ein PDF bauen: es kann
-- gar keines bauen. `ublZurRechnung` und `zugferdZurRechnung` werfen
-- `KeinSnapshotFehler`, wenn `nutzlast_bytes` NULL ist — und ein `left join`
-- auf eine unsichtbare Tabelle liefert genau das.
--
-- ===========================================================================
-- Die Decke wird ERSETZT, nicht ergaenzt
-- ===========================================================================
--
-- Eine zweite erlaubende Policy neben `p_intern_ceiling` waere wirkungslos:
-- RESTRIKTIVE Policies verknuepfen mit UND. `app.portal() = 'intern'` bliebe
-- also Bedingung, und der Kunde saehe weiter nichts — still, ohne
-- Fehlermeldung, mit einer neuen Policy daneben, die aussieht, als taete sie
-- etwas. Die Decke muss deshalb selbst einen Kundenzweig bekommen; dieselbe
-- Form tragen `rechnung.p_rechnung_decke`, `offener_posten.p_op_decke` und
-- `zahlung_zuordnung.p_zz_decke` seit `0075`/`0121`.
--
-- **`rechnung_hash` bleibt unberuehrt.** Die Kette ist die interne
-- Beweisfuehrung (Invariante 4): wer sie liest, prueft die
-- Lueckenlosigkeit — der Kunde bekommt seinen Beleg, nicht das Pruefwerkzeug.
-- Dasselbe gilt fuer `rechnungsausgangsbuch` und `rechnungsposition_quelle`.
--
-- ===========================================================================
-- Eng gefasst heisst: drei Bedingungen, jede aus einem eigenen Grund
-- ===========================================================================
--
--  1. `status = 'festgeschrieben'` — ein Entwurf hat keine Nummer
--     (Invariante 4). Der Snapshot entsteht ohnehin nur zur Festschreibung
--     (`d_snapshot_schreiben` prueft es beim Einfuegen), aber die Bedingung
--     steht hier zum zweiten Mal: eine Zusage, die nur beim Schreiben
--     geprueft wird, ist beim Lesen keine.
--  2. `kunde_id = any (app.aktuelle_kunden())` — der Beleg eines anderen
--     Kunden derselben Gesellschaft. Das ist die Grenze, die K-04 zieht.
--  3. Der Umweg ueber `rechnung` und nicht ueber eine eigene `kunde_id` auf
--     dem Snapshot: die Zugehoerigkeit steht am Beleg, und eine Kopie davon
--     im Snapshot waere eine zweite Wahrheit, die auseinanderlaufen kann.
--
-- Das `exists` laeuft unter der RLS von `rechnung`, und die traegt selbst
-- `t_kunde` plus `p_rechnung_decke` mit denselben zwei Bedingungen — die
-- Verengung steht damit doppelt, aus zwei unabhaengigen Richtungen.

-- ---------------------------------------------------------------------------
-- 1. Die Decke
-- ---------------------------------------------------------------------------

drop policy p_intern_ceiling on rechnung_snapshot;

create policy p_portal_decke on rechnung_snapshot as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and exists (select 1 from rechnung r
                          where r.mandant_id = rechnung_snapshot.mandant_id
                            and r.id = rechnung_snapshot.rechnung_id
                            and r.status = 'festgeschrieben'
                            and r.kunde_id = any (app.aktuelle_kunden()))))
  /**
   * **Der Schreibzweig bleibt `intern`, und das ist keine Symmetrie, die man
   * nachziehen wuerde.** `cse_app` hat auf dieser Tabelle ohnehin kein
   * `insert` (0077 widerruft es ausdruecklich: „Lesen ja, schreiben nein —
   * haette sie eine INSERT-Policy, koennte jeder mit `finanzen.schreiben` ein
   * Kettenglied faelschen"). Die Zeile steht als zweite Linie: wer den Grant
   * eines Tages ergaenzt, soll nicht zugleich das Kundenportal zur
   * Schreibstelle machen.
   *
   * Das Mitarbeiterportal faellt durch beide Zweige und sieht weiter nichts —
   * so war es vorher, und dafuer gibt es keinen Grund, der sich geaendert
   * haette.
   */
  with check (app.portal() = 'intern');

comment on table rechnung_snapshot is
  'K-12. Der Beleg, wie er festgeschrieben wurde — die einzige Quelle fuer PDF, '
  'ZUGFeRD und XRechnung. Lesbar intern (mit `finanzen.lesen`), in der '
  'Gruppenansicht (`gruppe.finanzen.lesen`) und im Kundenportal fuer die EIGENEN '
  'festgeschriebenen Belege (0256). Nie schreibbar aus `cse_app`.';

-- ---------------------------------------------------------------------------
-- 2. Der Lesepfad des Kunden
-- ---------------------------------------------------------------------------

/**
 * Die Decke laesst zu, diese Policy erlaubt — und ohne sie saehe der Kunde
 * weiter nichts: `j_rechnung_snapshot_lesen`, `t_mandant_lesen` und
 * `t_gruppe` haengen alle an `app.aktiver_mandant()` beziehungsweise an der
 * Gruppenansicht, und im Kunden-Scope ist der aktive Mandant nach K-20 NULL.
 *
 * Kein Rechtebezug in der Bedingung: `finanzen.herunterladen` prueft die
 * Route (`authorize`, AUT-04), und `finanzen.lesen` die Seite. Hier zu
 * pruefen, ob der Kunde ein Recht haelt, waere die dritte Fassung derselben
 * Frage — die Policy beantwortet die andere: gehoert dieser Beleg ihm.
 */
create policy t_kunde on rechnung_snapshot for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from rechnung r
                      where r.mandant_id = rechnung_snapshot.mandant_id
                        and r.id = rechnung_snapshot.rechnung_id
                        and r.status = 'festgeschrieben'
                        and r.kunde_id = any (app.aktuelle_kunden())));
