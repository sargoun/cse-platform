-- ===========================================================================
-- 0406 — Der Altbestand der Erinnerungen: nachgeholt wird nur, was noch vor
--        seiner Wiedervorlage liegt (V-153, CRM-04, D-647)
-- ===========================================================================
-- **Der Befund.** 0405 gab lead_aktivitaet das Gedaechtnis erinnert_am, fuellte
-- es fuer den Bestand aber nicht vor. Jede offene Wiedervorlage, deren
-- Erinnerung vor Einfuehrung des Laufs lag, war damit auf einmal faellig: der
-- erste Lauf nach dem Einspielen stellte sie alle zugleich zu — Erinnerungen
-- an Termine, die laengst vorbei sind, und per E-Mail, sobald ein Versender
-- verbunden ist.
--
-- **Die Regel.** Eine Erinnerung ist ein Hinweis VOR einem Termin. Liegt die
-- Faelligkeit der Wiedervorlage selbst schon in der Vergangenheit, hat die
-- Erinnerung ihren Zweck verloren: die Wiedervorlage steht ueberfaellig in der
-- Liste und auf der Uebersicht, und eine Meldung Tage danach waere nur Laerm.
-- Diese Zeilen werden als erledigt gestempelt, ohne Zustellung. Liegt die
-- Faelligkeit noch vor uns, bekommt die Erinnerung der erste Lauf — spaet,
-- aber vor dem Termin, und genau dafuer wurde sie eingetragen.
--
-- Erledigte Wiedervorlagen fasst diese Migration nicht an; sie nimmt der Lauf
-- ohnehin nie. Kein Ausloeser auf lead_aktivitaet reagiert auf ein update.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0405.
-- ===========================================================================

update lead_aktivitaet
   set erinnert_am = now()
 where erinnerung_am is not null
   and erinnerung_am <= now()
   and faellig_am is not null
   and faellig_am <= now()
   and erinnert_am is null
   and erledigt_am is null;

comment on column lead_aktivitaet.erinnert_am is
  'V-146, CRM-04. Wann die Erinnerung (erinnerung_am) zugestellt wurde. Gesetzt vom Lauf '
  'wiedervorlage_erinnerung, zurueckgesetzt beim Verschieben. NULL heisst: noch nicht erinnert. '
  'V-153, 0406: fuer den Altbestand vor dem Lauf auch dann gesetzt, wenn die Wiedervorlage '
  'bei Einfuehrung schon faellig war; diese Erinnerungen wurden nicht nachgeholt.';
