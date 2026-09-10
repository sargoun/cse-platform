-- ===========================================================================
-- 0062 — die reine Pausenkorrektur wird aufschreibbar
--        (0034 `z_anspruch_je_ereignis`; TIM-11, EMP-04, EMP-07)
--
-- **Der Befund.** Eine Korrektur, die NUR die Pause aendert, laesst sich heute
-- nicht aufschreiben. Der Weg dorthin ist kurz und jede einzelne Regel ist
-- richtig:
--
--   `korrigiereZeiteintrag` schreibt jede Ersatzfassung mit
--   `quelle_* = 'planer_entscheidung'`, weil ein benannter Mensch entschieden
--   hat. `z_quelle_*_belegt` (0034) verlangt dafuer `nacherfasst`. Und
--   `z_anspruch_je_ereignis` verlangt bei `nacherfasst` mindestens einen
--   BEHAUPTETEN Zeitpunkt — den eine Pausenkorrektur nicht hat: sie behauptet
--   keinen Beginn und kein Ende, sie behauptet eine Pause.
--
-- Das Ergebnis ist eine `check_violation` tief in einer Bedingung, bei genau
-- der Korrektur, die im Alltag am haeufigsten vorkommt („die halbe Stunde
-- Pause war eine ganze"). `einwand_art = 'pause_falsch'` (0052) und
-- `korrektur_art = 'pause_korrektur'` (0036) sind beide dafuer da; der Weg
-- zwischen ihnen endete bisher im Nichts.
--
-- **Warum das in DIESEN PR gehoert.** Das Stundenkonto bucht NETTOminuten.
-- Eine Pausenkorrektur ist damit die haeufigste Differenz, die als
-- Ausgleichsbuchung in den ersten offenen Monat laufen muss (EMP-04, §12.2) —
-- der Mechanismus, den 0060 baut. Ohne diese Reparatur gaebe es fuer einen
-- ganzen Zweig der Korrekturen keinen Weg auf das Konto.
--
-- **Die Reparatur, und warum sie nicht weniger sein kann.** Die Bedingung
-- bekommt einen dritten Zweig: eine Fassung, die eine ANDERE ABLOEST
-- (`ersetzt_zeiteintrag_id is not null`), traegt ihren Beleg nicht in einer
-- `behauptet_*`-Spalte, sondern in `zeiteintrag_korrektur` — mit Urheber,
-- Zeitpunkt, Grund, Vorher und Nachher, unveraenderlich, und ohne die die
-- Ersatzfassung gar nicht entstehen darf (§5.7, §15.6). Das ist der staerkere
-- Beleg, nicht der schwaechere.
--
-- Was die Bedingung weiterhin faengt, faengt sie unveraendert: die
-- ERSTFASSUNG einer Nacherfassung. Genau fuer sie wurde sie geschrieben — ein
-- Datensatz, der ohne Marke entsteht, muss sagen, WAS behauptet wurde. Solche
-- Zeilen tragen `ersetzt_zeiteintrag_id is null` (D-143: die Nacherfassung
-- nennt sich selbst als Ursprung und Ersatz in der KORREKTURZEILE, nicht am
-- Eintrag), also greift der neue Zweig dort nicht.
--
-- Die Alternative waere gewesen, `behauptet_pause_minuten` als vierten Zweig
-- zuzulassen. Sie scheitert an derselben Stelle: der Korrekturdienst schreibt
-- die Spalte nicht, und ihn zu aendern gehoert nicht in diese Migration.
-- ===========================================================================

alter table zeiteintrag drop constraint z_anspruch_je_ereignis;

alter table zeiteintrag add constraint z_anspruch_je_ereignis check (
  not nacherfasst
  or behauptet_beginn is not null
  or behauptet_ende   is not null
  or ersetzt_zeiteintrag_id is not null);

comment on constraint z_anspruch_je_ereignis on zeiteintrag is
  'Nacherfasst heisst: es gibt einen Beleg. Bei einer ERSTFASSUNG ist das die '
  'Behauptung (behauptet_beginn/-ende), bei einer ABLOESENDEN Fassung die '
  'zeiteintrag_korrektur — sonst waere eine reine Pausenkorrektur nicht '
  'aufschreibbar (0062).';
