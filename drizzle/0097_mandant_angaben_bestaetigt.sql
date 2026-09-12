-- 0097 — eine Firmenangabe weiss jetzt, ob sie bestaetigt ist.
--
-- **Der Befund.** Anschrift, Telefonnummer, Umsatzsteuer-Identifikationsnummer
-- und Handelsregisternummer der vier Gesellschaften stammen aus dem Seed und
-- sind ERFUNDEN: `Kurfürstendamm 21`, `+49 30 555 0100`, `DE100000000`,
-- `HRB 200000` — fortlaufend hochgezaehlt, ohne Frage an den Mandanten und
-- ohne Kennzeichnung. Solange sie nur Fixtur waren, war das folgenlos.
--
-- Seit dem Impressum sie als Angaben nach § 5 TMG ausweist, ist es das
-- Gegenteil von folgenlos: eine rechtlich bindende Seite nennt eine
-- Registernummer, die es nicht gibt. Das ist genau die Sorte „fake
-- functionality", die `CLAUDE.md` verbietet — nur schlimmer, weil sie
-- amtlich aussieht.
--
-- **Warum eine Spalte und nicht „einfach weglassen".** Weglassen geht nicht:
-- `mandant_ustg14_vollstaendig` verlangt Anschrift und Steuernummer von jeder
-- Gesellschaft mit eigenem Rechnungskreis (§ 14 UStG), und das ist richtig so.
-- Die Werte muessen also DA sein, damit das System arbeitet — sie duerfen nur
-- nicht als gesichert auftreten. Dieselbe Unterscheidung wie bei
-- `nummernkreis.ist_platzhalter`.
--
-- **Der Vorgabewert ist `false`.** Unbestaetigt, bis jemand bestaetigt. Der
-- umgekehrte Vorgabewert waere die bequemere Migration und die falsche
-- Aussage: er erklaerte jede bestehende Zeile fuer geprueft, obwohl keine es
-- ist.

alter table mandant
  add column angaben_bestaetigt_am timestamptz,
  add column angaben_bestaetigt_von uuid references benutzer (id);

comment on column mandant.angaben_bestaetigt_am is
  'Wann ein Mensch Anschrift, Register- und Steuernummern dieser Gesellschaft '
  'bestaetigt hat. NULL heisst: noch nicht bestaetigt — die Oberflaeche sagt '
  'es dann, statt die Angabe als gesichert auszugeben (O-352).';

-- Lesbar fuer die Anwendung wie die uebrigen Stammdaten; der Auftritt liest
-- sie ueber denselben Weg wie Firma und Anschrift.
grant select (angaben_bestaetigt_am, angaben_bestaetigt_von) on mandant to cse_app;
