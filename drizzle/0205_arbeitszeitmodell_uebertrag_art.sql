-- ===========================================================================
-- 0205 — arbeitszeitmodell.uebertrag_art wird eine GESCHLOSSENE Menge
--        (EMP-04, TIM-06, O-18, CLAUDE.md „Never invent a business rule")
--
-- `uebertrag_art` entscheidet, was am Monatsende mit einem Stundensaldo
-- geschieht: mitnehmen, kappen, verfallen lassen. Das ist eine Lohnfrage, und
-- sie ist offen (O-18). 0201 legte die Spalte als `text not null default
-- 'offen'` an — ohne Schranke. Die Seite bot dazu ein FREITEXTFELD, und ein
-- Tippfehler („verfalen") liess sich speichern; die Tabelle zeigte ihn danach
-- als hinterlegte Uebertragsregel an, statt als das, was er war.
--
-- Das ist das Gegenteil dessen, was ein benannter Platzhalter leisten soll.
-- Solange O-18 offen ist, gibt es genau EINEN Wert, und die Datenbank sagt
-- das auch. Erweitert wird die Liste, wenn die Frage beantwortet ist: ein
-- Wert hier, ein Wert in `UEBERTRAG_ARTEN`
-- (`server/services/zeit/arbeitszeitmodell.ts`), ein Zweig in der
-- Sollzeitrechnung, ein Test.
--
-- **Kein Datenumbau noetig.** Die Spalte traegt heute ausschliesslich
-- 'offen'; die Constraint wird deshalb sofort gueltig hinzugefuegt und nicht
-- als `not valid` nachgezogen.
-- ===========================================================================

alter table arbeitszeitmodell
  add constraint azm_uebertrag_art check (uebertrag_art in ('offen'));

comment on column arbeitszeitmodell.uebertrag_art is
  'O-18: was am Monatsende mit einem Saldo geschieht. Geschlossene Menge — '
  'derzeit nur „offen" (es wird nichts uebertragen und nichts verfallen '
  'gelassen). Spiegel von UEBERTRAG_ARTEN in services/zeit/arbeitszeitmodell.ts.';
