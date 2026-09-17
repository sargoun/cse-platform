-- 0220 — das Tor und die Policy sagen dasselbe (LEG-09, AUT-06).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `04-SEITENKARTE.md` §5.25 fuehrt fuenf Adressen unter `/datenschutz` und
-- bewacht sie mit DREI verschiedenen Rechten:
--
--   /datenschutz, /datenschutz/[id], …/auskunft   datenschutz.auskunft_erstellen
--   …/berichtigung                                datenschutz.berichtigung_bearbeiten
--   …/loeschung                                   datenschutz.loeschung_pruefen
--
-- Die Policies aus `0176` kennen nur das ERSTE. Wer im Katalog nur
-- `datenschutz.berichtigung_bearbeiten` gebunden bekommt (bindbar an `admin`),
-- kommt durch das Tor der Route — und liest null Zeilen.
--
-- **Und das ist der schlimmste der drei moeglichen Fehler.** Ein fehlendes
-- Recht muss 404 geben (AUT-06); hier gibt es 200 mit einer leeren Liste. Die
-- Bearbeiterin sieht „keine Berichtigungsanfrage" und glaubt es. Die Frist des
-- Art. 12 Abs. 3 laeuft weiter, und der Nachweis, dass niemand etwas gesehen
-- hat, ist genau die Zeile, die sie nicht sehen konnte.
--
-- **Erweitert wird die Policy, nicht das Tor.** Die Gegenrichtung waere,
-- `/berichtigung` und `/loeschung` zusaetzlich `datenschutz.auskunft_erstellen`
-- verlangen zu lassen. Das machte die drei Rechte zu einem und nahm dem
-- Katalog die Unterscheidung, die er absichtlich trifft: wer berichtigen darf,
-- muss nicht jede Auskunft erteilen duerfen. Die Tabelle ist EINE Arbeitsliste
-- fuer DREI Zustaendigkeiten — und wer eine davon hat, muss den Vorgang sehen.
--
-- Was sich NICHT aendert: `crm.lesen`, `system.einstellung_lesen` und jedes
-- andere Recht bleiben draussen. In dieser Tabelle steht, wer sich beschwert
-- hat und worueber; eine Objektleitung, die das liest, erfaehrt vom
-- Loeschverlangen ihrer eigenen Mitarbeiterin.

/**
 * Die drei Zustaendigkeiten in EINEM Praedikat.
 *
 * Sie steht als Funktion und nicht dreimal ausgeschrieben in zwei Policies:
 * ein viertes Datenschutzrecht (Art. 18, Art. 20 haben heute keines) waere
 * sonst eine Aenderung an zwei Policies, von der eine vergessen wird.
 *
 * `app.hat_recht` NIMMT den Mandanten (K-03) — ein globales Praedikat truege
 * ein in einer Gesellschaft erteiltes Recht in jede andere.
 */
create function app.darf_betroffenenanfrage() returns boolean
language sql stable security invoker set search_path = pg_catalog, public, app as $$
  select app.hat_recht('datenschutz.auskunft_erstellen', app.aktiver_mandant())
      or app.hat_recht('datenschutz.berichtigung_bearbeiten', app.aktiver_mandant())
      or app.hat_recht('datenschutz.loeschung_pruefen', app.aktiver_mandant());
$$;

comment on function app.darf_betroffenenanfrage() is
  'LEG-09. Wer eine der drei Zustaendigkeiten aus 04-SEITENKARTE §5.25 haelt, '
  'sieht den Vorgang. Das Tor der Route und die Policy sagen damit dasselbe — '
  'sonst gibt ein fehlendes Recht 200 mit leerer Liste statt 404 (AUT-06).';

grant execute on function app.darf_betroffenenanfrage() to cse_app;

drop policy t_betroffenenanfrage_lesen      on betroffenenanfrage;
drop policy t_betroffenenanfrage_bearbeiten on betroffenenanfrage;

create policy t_betroffenenanfrage_lesen on betroffenenanfrage for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.darf_betroffenenanfrage()));

create policy t_betroffenenanfrage_bearbeiten on betroffenenanfrage for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.darf_betroffenenanfrage()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.darf_betroffenenanfrage()));

-- ---------------------------------------------------------------------------
-- Die Zuordnung braucht Fremdschluessel — alle drei, nicht einer
-- ---------------------------------------------------------------------------
--
-- `0176` legt `person_id uuid references person(id)` an und daneben
-- `ansprechpartner_id uuid` und `bewerbung_id uuid` OHNE Referenz. Wer sie
-- setzt, kann eine Kennung aus einer FREMDEN Gesellschaft eintragen: die
-- Zuordnung sieht danach aus wie eine gepruefte, und die Auskunft, die darauf
-- aufbaut, gaebe die Daten eines anderen Menschen heraus.
--
-- `ansprechpartner` und `bewerbung` tragen die Uniques, die der zusammen-
-- gesetzte Schluessel braucht (`ansprechpartner_mandant_uk`, `bewerbung_id_uk`).
-- Fuer `ansprechpartner` wird deshalb auf (mandant_id, id) referenziert — das
-- ist die Pruefung, die eine einspaltige Referenz NICHT leisten kann.
--
-- `person` bleibt einspaltig: sie traegt ueberhaupt kein `mandant_id`
-- (D-09 — ein Mensch ist EINE Zeile, auch bei zwei Anstellungen). Die
-- Mandantenpruefung dafuer leistet der Dienst, indem er nur Personen zur
-- Auswahl stellt, die in dieser Gesellschaft eine Anstellung haben; die
-- Policy `t_person_lesen` bindet den Lesezugriff ohnehin an
-- `app.sichtbare_mandanten()`.
--
-- `bewerbung` traegt nur `bewerbung_id_uk UNIQUE (id)` — eine zusammen-
-- gesetzte Referenz ist dort nicht moeglich. Auch hier prueft der Dienst den
-- Mandanten, und `t_bewerbung_lesen` bindet ihn an den aktiven.

alter table betroffenenanfrage
  add constraint betroffenenanfrage_ansprechpartner_fk
  foreign key (mandant_id, ansprechpartner_id)
  references ansprechpartner (mandant_id, id);

alter table betroffenenanfrage
  add constraint betroffenenanfrage_bewerbung_fk
  foreign key (bewerbung_id) references bewerbung (id);

/**
 * Hoechstens EINE Zuordnung.
 *
 * Eine Anfrage, die gleichzeitig auf eine `person` UND einen
 * `ansprechpartner` zeigt, ist keine Zuordnung, sondern zwei Vermutungen. Die
 * Auskunft muesste dann raten, wessen Daten sie herausgibt — und die falsche
 * Wahl ist eine Datenpanne, nicht ein Anzeigefehler.
 *
 * Null Zuordnungen bleiben erlaubt: so kommt jede Anfrage an, und die
 * Zuordnung trifft ein Mensch hinterher (Art. 12 Abs. 6).
 */
alter table betroffenenanfrage
  add constraint betroffenenanfrage_hoechstens_eine_zuordnung check (
    (case when person_id          is null then 0 else 1 end
   + case when ansprechpartner_id is null then 0 else 1 end
   + case when bewerbung_id       is null then 0 else 1 end) <= 1);

create index betroffenenanfrage_person_idx
  on betroffenenanfrage (mandant_id, person_id) where person_id is not null;
create index betroffenenanfrage_ansprechpartner_idx
  on betroffenenanfrage (mandant_id, ansprechpartner_id) where ansprechpartner_id is not null;
