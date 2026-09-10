-- ---------------------------------------------------------------------------
-- 0027 — Der Platzhalter-Stand gehoert zur Kalkulation, nicht zum Katalog
-- ---------------------------------------------------------------------------
--
-- `kalkulation.ist_platzhalter` war EINE Raute fuer DREI Fragen: den Tarif
-- (O-16), den Frequenzfaktor (O-56) und den Leistungswert je Belagsart (O-17).
-- Die Bestaetigung kannte nur den Tarif, loeschte aber die ganze Raute — und
-- damit auch O-56, fuer das es keine Bestaetigung gibt und keine Antwort.
--
-- Und die Sicht `kalkulation_platzhalter` las den Leistungswert LIVE aus
-- `belagsart`. Wer O-17 fuer ein Angebot bestaetigte, schrieb in den geteilten
-- Katalog: jede ANDERE Kalkulation auf derselben Belagsart fiel im selben
-- Moment aus der Sicht — auch die, deren Preis auf dem Platzhalter gerechnet
-- worden war. Sie durfte danach hinaus, ohne dass jemand sie angesehen hatte.
--
-- Ein Schnappschuss beantwortet beides: was zur ZEIT DER RECHNUNG offen war,
-- steht in der Zeile, die damit gerechnet hat. Ein spaeterer Katalogeintrag
-- aendert daran nichts mehr — richtig so, denn er aendert auch den Preis
-- nicht, der laengst geschrieben ist.

-- --------------------------------------------------------------------------
-- 1. Die drei Fragen bekommen drei Spalten
-- --------------------------------------------------------------------------

-- O-56: der Frequenzfaktor. `kalkuliere` kennt ihn als Platzhalter, aber die
-- Bestaetigung hat kein Feld dafuer — es gibt keine Antwort, die einzutragen
-- waere. Er bleibt darum offen, bis O-56 beantwortet ist.
alter table kalkulation
  add column frequenz_ist_platzhalter boolean not null default false;

comment on column kalkulation.frequenz_ist_platzhalter is
  'O-56: Turnus → Frequenzfaktor ist geraten. Keine Bestaetigung raeumt das '
  'ab — erst die Antwort des Mandanten.';

-- `ist_platzhalter` heisst ab hier NUR noch: die Tarifzahlen (O-16) sind
-- unbestaetigt. Der Name bleibt, weil ihn Sicht, Ausloeser und Dienste
-- tragen; die Bedeutung wird hier festgehalten.
comment on column kalkulation.ist_platzhalter is
  'O-16: Stundenverrechnungssatz und Zuschlaege sind unbestaetigt. NUR der '
  'Tarif — O-56 steht in frequenz_ist_platzhalter, O-17 je Zeile in '
  'kalkulation_position.leistungswert_ist_platzhalter.';

-- O-17: der Leistungswert, mit dem DIESE Zeile gerechnet hat. Neben
-- `leistungswert_qm_pro_stunde`, das den Wert selbst schon festhielt: der
-- Wert stand im Schnappschuss, sein Zustand nicht.
alter table kalkulation_position
  add column leistungswert_ist_platzhalter boolean not null default false;

comment on column kalkulation_position.leistungswert_ist_platzhalter is
  'O-17: war der Leistungswert dieser Zeile zur Zeit der Rechnung ein '
  'Platzhalter? Schnappschuss — eine spaetere Katalogpflege aendert ihn nicht.';

-- --------------------------------------------------------------------------
-- 2. Bestand: was heute offen ist, bleibt offen
-- --------------------------------------------------------------------------
--
-- Die Richtung ist mit Absicht nur die vorsichtige. Eine bestehende Zeile auf
-- einer Platzhalter-Belagsart wird als Platzhalter markiert; keine wird
-- freigegeben. Wer zu wenig freigibt, verlangt einen Blick zu viel; wer zu
-- viel freigibt, verschickt einen ungeprueften Preis.
update kalkulation_position p
   set leistungswert_ist_platzhalter = true
  from belagsart b
 where b.id = p.belagsart_id
   and b.ist_platzhalter;

update kalkulation_position p
   set leistungswert_ist_platzhalter = true
  from leistungskatalog_position lp
 where lp.id = p.leistungskatalog_position_id
   and lp.ist_platzhalter;

-- O-56 ist fuer jede bestehende Kalkulation offen: der Faktor kam aus
-- `PLATZHALTER_FREQUENZ`, eine andere Quelle gab es nie.
update kalkulation set frequenz_ist_platzhalter = true;

-- --------------------------------------------------------------------------
-- 3. Die Sicht liest den Schnappschuss, nicht den Katalog
-- --------------------------------------------------------------------------

drop view if exists kalkulation_platzhalter;

create view kalkulation_platzhalter with (security_invoker = true) as
  select k.id as kalkulation_id, k.mandant_id, k.angebot_id, k.auftrag_id,
         (k.ist_platzhalter
          or k.stundenverrechnungssatz_cent is null
          or k.gemeinkosten_basis is null
          or k.gemeinkosten_bp is null
          or k.wagnis_gewinn_bp is null)                     as kopf_offen,
         k.frequenz_ist_platzhalter                          as frequenz_offen,
         exists (select 1 from kalkulation_position p
                  where p.kalkulation_id = k.id
                    and p.leistungswert_ist_platzhalter)      as grundlage_offen
    from kalkulation k
   where k.ist_platzhalter
      or k.stundenverrechnungssatz_cent is null
      or k.gemeinkosten_basis is null
      or k.gemeinkosten_bp is null
      or k.wagnis_gewinn_bp is null
      or k.frequenz_ist_platzhalter
      or exists (select 1 from kalkulation_position p
                  where p.kalkulation_id = k.id
                    and p.leistungswert_ist_platzhalter);

comment on view kalkulation_platzhalter is
  'Welche Kalkulation steht noch auf unbeantworteten Fragen — und auf welcher. '
  'Liest ausschliesslich Schnappschuesse: eine Katalogpflege raeumt hier '
  'nichts ab, weil sie den bereits gerechneten Preis auch nicht aendert.';

grant select on kalkulation_platzhalter to cse_app;
