-- ===========================================================================
-- 0206 — `system.audit_sensitiv_lesen` verlangt den ZWEITEN FAKTOR
--        (SEC-A9, AUT-02, 03-AUTH-BERECHTIGUNGEN Z. 2342, 05-API-KARTE
--         Z. 369/591, O-624)
--
-- **Was hier fehlte.** 03-AUTH-BERECHTIGUNGEN fuehrt dieses Recht
-- ausdruecklich mit `erfordert_2fa`: es oeffnet die `vorher`/`nachher`-
-- Nutzlast des Pruefprotokolls, also Loehne, Geburtsdaten und
-- gesundheitsnahe Abwesenheitsgruende — im Klartext und im Zweifel ueber ein
-- ganzes Jahr. Der generierte Katalogblock in 0008 setzt die Spalte nicht
-- (sie steht nicht in seiner Spaltenliste und faellt damit auf ihre Vorgabe
-- `false`), und so trug in der lebenden Datenbank KEIN einziges Recht die
-- Pflicht. Der Riegel war gebaut und nicht eingelegt: `app.hat_recht_fuer`
-- prueft `if v_recht.erfordert_2fa and p_aal <> 'aal2' then return false`
-- seit 0149.
--
-- **Warum an der Berechtigung und nicht in der Route.** Die Route ist nicht
-- der einzige Weg zu den Werten: `app.audit_nutzlast_buendel` (0204),
-- `app.audit_nutzlast_lesen` (0139) und jede kuenftige Abfrage gehen ueber
-- `app.hat_recht`. Eine Pruefung in einem Handler deckte einen Weg; die
-- Spalte deckt alle — und sie deckt sie an derselben Stelle, an der die RLS
-- ohnehin fragt.
--
-- **Die Folge ist kein Fehler, sondern ein REDIGIERTES Buendel.** Eine
-- `aal1`-Sitzung mit `system.audit_exportieren` bekommt weiterhin ihr
-- Beweismittel: Zeilen, Ketten, Manifest — nur ohne `nutzlast.csv`, und das
-- Manifest sagt warum (`services/audit/buendel.ts`, Kopfzeile
-- `x-cse-redigiert`). Wer die Werte braucht, zeigt den zweiten Faktor.
--
-- Damit ist O-624 beantwortet: nicht als Kundenfrage, sondern aus der
-- Spezifikation.
-- ===========================================================================

update berechtigung
   set erfordert_2fa = true
 where schluessel = 'system.audit_sensitiv_lesen';

comment on column berechtigung.erfordert_2fa is
  'AUT-02: das Recht wirkt nur in einer aal2-Sitzung. app.hat_recht_fuer gibt '
  'sonst false zurueck — kein Fehler, sondern ein fehlendes Recht. Gesetzt fuer '
  'system.audit_sensitiv_lesen (0206, SEC-A9).';
