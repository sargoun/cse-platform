-- 0173 — die Vorgangsart „Antwort an eine Bewerberin" (REC-03, §12).
--
-- **Allein in dieser Datei, und das ist kein Stilmittel.** Postgres lässt
-- einen neu hinzugefügten Enum-Wert in DERSELBEN Transaktion nicht benutzen
-- („unsafe use of new value of enum type"). Der Migrator fährt jede Datei in
-- einer Transaktion; stünde die Policy, die diesen Wert nennt, hier daneben,
-- bräche die Migration — und zwar erst auf einer frischen Datenbank, nicht auf
-- der, auf der sie geschrieben wurde.

alter type agent_vorgang_typ add value if not exists 'bewerbung_antwort_entwurf';
