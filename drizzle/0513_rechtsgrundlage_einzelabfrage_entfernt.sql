-- 0513 — die alte Einzelabfrage des Rechtsgrundlagen-Blocks entfaellt
--        (V-343, O-661, D-793, D-818).
--
-- app.rechtsgrundlage_lesen (0020) las den Rechtsgrundlagen-Block EINES
-- Kontakts und verlangte dafuer crm.lesen. Seit 0247 tragen den Block die
-- Leser app.kontakt_rechtsgrundlage_liste und _blatt mit dem ENGEREN Recht
-- crm.rechtsgrundlage_lesen (Voreinstellung O-661, D-793); die alte Funktion
-- hat keinen Aufrufer mehr, stand aber mit Ausfuehrungsrecht fuer cse_app in
-- der Datenbank — ein Weg, auf dem crm.lesen allein den Block oeffnete.
--
-- Entfernt statt umgestellt: eine zweite Tuer mit demselben Schloss waere
-- eine Tuer, die beim naechsten Umbau vergessen wird. Wer den Block liest,
-- liest ihn ueber 0247 und hinterlaesst dort seine Protokollzeile.
--
-- Nur Kommentare mit Doppelstrich.

drop function app.rechtsgrundlage_lesen(uuid);
