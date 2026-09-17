-- ===========================================================================
-- 0210 — `bau_abnahme_art`: die vier Wege, auf denen eine Abnahme zustande
--        kommt (§ 12 VOB/B, 03-GEWERKE §7.2)
-- ===========================================================================
--
-- **Eine eigene Datei fuer eine Aufzaehlung, und das hat einen Grund.**
-- Postgres erlaubt `alter type … add value` nicht in derselben Transaktion,
-- in der der neue Wert BENUTZT wird. Solange der Typ hier allein steht, ist
-- der naechste Wert, den § 12 VOB/B noch braucht, eine Zeile in einer neuen
-- Datei — und nicht der Zwang, die Tabelle daneben aufzuteilen. Wer den Typ
-- zusammen mit `abnahme` anlegte, waere beim ersten Nachtrag an genau dieser
-- Postgres-Regel haengengeblieben.
--
-- **Die vier Werte sind nicht erfunden, sie stehen im Gesetz** — und sie sind
-- nicht dasselbe:
--
--  - `foermlich`   — § 12 Abs. 4 VOB/B: die verlangte, protokollierte
--                    Abnahme. Der Regelfall im Bauvertrag, und der einzige,
--                    bei dem der Vorbehalt der Vertragsstrafe (§ 11 Abs. 4)
--                    ueberhaupt erklaert werden KANN.
--  - `fiktiv`      — § 12 Abs. 5 VOB/B: sie tritt durch Fristablauf ein,
--                    ohne dass jemand etwas tut. Genau deshalb muss sie eine
--                    ART sein und kein Sonderfall: ein Protokoll, das sie als
--                    „foermlich" fuehrte, behauptete eine Handlung, die nie
--                    stattgefunden hat.
--  - `konkludent`  — durch schluessiges Verhalten (Ingebrauchnahme,
--                    vollstaendige Zahlung). Datum und Anlass sind dann eine
--                    WERTUNG, und die Zeile haelt fest, wessen.
--  - `teilabnahme` — § 12 Abs. 2 VOB/B: nur ein abgegrenzter Teil der
--                    Leistung. Sie schlaegt den Projektstatus NICHT um, und
--                    sie laesst die Gewaehrleistungsfrist fuer den Rest
--                    unberuehrt — deshalb ist sie hier eine Art und nicht ein
--                    Haekchen daneben.
--
-- Die Abnahme ist der Punkt, an dem Gefahr, Gewaehrleistungsfrist und
-- Faelligkeit umschlagen. Welcher dieser vier Wege eingeschlagen wurde, ist
-- damit keine Kategorie zur Auswertung, sondern die Tatsache, auf die sich
-- jede Frist danach stuetzt.

create type bau_abnahme_art as enum (
  'foermlich',
  'fiktiv',
  'konkludent',
  'teilabnahme'
);

comment on type bau_abnahme_art is
  '§ 12 VOB/B (03-GEWERKE §7.2). `foermlich` Abs. 4, `fiktiv` Abs. 5, '
  '`konkludent` durch schluessiges Verhalten, `teilabnahme` Abs. 2. Die Art '
  'entscheidet, ob der Projektstatus umschlaegt und ob ein Vorbehalt der '
  'Vertragsstrafe (§ 11 Abs. 4) ueberhaupt erklaert werden konnte.';
