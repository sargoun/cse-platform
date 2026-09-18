-- ===========================================================================
-- 0192 — anstellung_kondition: die datierte Wahrheit hinter dem Spiegel
--        (01-KERN §6.14/§6.15, 05-API-KARTE §C.8, K-05, K-16, EMP-04, EMP-05,
--         LEG-02, ACC-12, Invariante 1)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.15.
--
-- **Warum eine einzelne Spalte fuer einen Stundensatz falsch ist.** Eine
-- Lohnerhoehung bewertet stillschweigend JEDE vergangene Kalkulation und jede
-- vergangene Sollstundenableitung neu: das Stundenkonto des Vormonats aendert
-- sich, ohne dass jemand es angefasst hat, und der Zeitnachweis nach
-- § 17 MiLoG stimmt danach mit keinem Papier mehr ueberein. Deshalb:
-- `anstellung_kondition` ist die datierte Wahrheit, die Spalten auf
-- `anstellung` sind ein **trigger-gepflegter Spiegel der heute gueltigen
-- Kondition** mit genau EINEM Schreiber, und **jede datierte Berechnung liest
-- die Kondition, nie den Spiegel**.
--
-- **Zwei Namensabweichungen, offen benannt.** 01-KERN §6.15 nennt die Spalten
-- `gueltig_ab`/`gueltig_bis` und `stundensatz_intern`; 05-API-KARTE (Zeile
-- 671, `POST …/konditionen`) nennt sie `gilt_ab` und
-- `stundensatz_intern_cent`. Umgesetzt sind die zweiten: `gilt_ab`/`gilt_bis`,
-- weil die Schnittstelle so heisst und die Domaene `einstellungen` darauf
-- aufbaut, und `stundensatz_intern_cent`, weil die EINHEIT in den Namen
-- gehoert (Invariante 1 — ein `bigint` namens `stundensatz_intern` ist die
-- Sorte Spalte, in die jemand 17.50 schreibt). Die Abweichung steht hier und
-- in DECISIONS.md, damit sie eine Entscheidung bleibt und keine Drift wird.
--
-- **Kein `DELETE`** (§6.15, Invariante 8): eine Kondition wird nicht
-- bearbeitet, sie wird von der naechsten datierten Zeile abgeloest.
-- ===========================================================================

create table anstellung_kondition (
  id             uuid not null default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),
  anstellung_id  uuid not null,

  /**
   * KEIN Default. Der Beginn einer Kondition ist eine Vertragstatsache und
   * nicht „heute" — ein `default app.berlin_heute()` machte aus einer
   * rueckwirkenden Tariferhoehung lautlos eine ab heute geltende.
   */
  gilt_ab        date not null,
  /** NULL = offen. Genau eine offene Kondition je Beschaeftigung (EXCLUDE). */
  gilt_bis       date,

  /**
   * PLATZHALTER-Vokabular (§4, O-18). Freier Text, weil die
   * Beschaeftigungs- und SV-Kategorien nicht entschieden sind und eine
   * erfundene Auswahlliste sie faelschlich entscheiden wuerde.
   * // TODO(client, O-18): Welche Beschaeftigungs- und SV-Kategorien fuehrt die Gruppe als Arbeitszeitmodell, und muessen sie den Codes des Lohnsystems entsprechen?
   */
  arbeitszeitmodell text not null default 'unbekannt',
  /** K-16: Mengen sind `numeric(12,3)`. Grundlage der Sollstunden (EMP-04). */
  wochenstunden      numeric(12,3),
  /** Grundlage der Urlaubstagsberechnung (EMP-05, O-18). */
  arbeitstage_woche  numeric(12,3),

  /**
   * **Ganze Cent** (Invariante 1). Nie `numeric`, nie float: ein interner
   * Kostensatz geht in Lohnkosten und Projektmarge ein, und eine
   * Gleitkommasumme vieler Stunden liegt am Jahresende daneben, ohne dass
   * jemand die Stelle findet. Spaltenentzug nach K-05.
   */
  stundensatz_intern_cent bigint,
  /**
   * Spaltenentzug nach K-05. Freier Text: welche Tarifgruppen gelten, ist
   * eine Tarif- und Vertragsfrage.
   * // TODO(client, O-610): Welcher Branchentarif gilt je Gesellschaft (Gebaeudereinigung RTV, Sicherheitsgewerbe Berlin, Bau), welche Tarifgruppen fuehrt er, und wird die Gruppe in der Plattform gefuehrt oder nur im Lohnsystem?
   */
  tarifgruppe    text,
  /** ACC-01, ACC-12. */
  kostenstelle   text,
  /** `Tariferhöhung`, `Vertragsänderung`, `Korrektur` — erscheint im Audit. */
  grund          text,

  erstellt_am    timestamptz not null default now(),
  erstellt_von   uuid references benutzer(id),

  constraint anstellung_kondition_pk primary key (id),
  constraint anstellung_kondition_mandant_uk unique (mandant_id, id),
  /**
   * Zusammengesetzt (K-16): eine Kondition zu einer Beschaeftigung einer
   * ANDEREN Gesellschaft ist strukturell ausgeschlossen, nicht nur durch RLS.
   */
  constraint ak_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint ak_zeitraum check (gilt_bis is null or gilt_bis >= gilt_ab),
  constraint ak_satz_nicht_negativ check (
    stundensatz_intern_cent is null or stundensatz_intern_cent >= 0),
  constraint ak_stunden_plausibel check (
    wochenstunden is null or (wochenstunden >= 0 and wochenstunden <= 168)),
  constraint ak_arbeitstage_plausibel check (
    arbeitstage_woche is null or (arbeitstage_woche >= 0 and arbeitstage_woche <= 7)),

  /**
   * **Lueckenlos ist nicht erzwingbar, ueberschneidungsfrei schon** (§6.15).
   *
   * Ein unbezahlter Ruhezeitraum ist eine legitime LUECKE — sie zu verbieten
   * hiesse, Elternzeit unmoeglich zu machen. Zwei gleichzeitig gueltige
   * Stundensaetze sind dagegen keine Lage, die ein Mensch gemeint haben kann:
   * jede datierte Berechnung muesste raten, und sie wuerde je Abfrage anders
   * raten. Braucht `btree_gist` (0000).
   */
  constraint ak_kein_ueberlapp exclude using gist (
    anstellung_id with =,
    daterange(gilt_ab, gilt_bis, '[]') with &&)
);

/** Der Aufloesungspfad „welche Kondition galt am Stichtag" (§6.15). */
create index kondition_anstellung_idx on anstellung_kondition (anstellung_id, gilt_ab desc);

comment on table anstellung_kondition is
  '§6.15: die datierte Kondition einer Beschaeftigung. Die Spalten auf '
  '`anstellung` sind ihr Spiegel; jede datierte Berechnung liest DIESE Tabelle. '
  'Append-only bis auf gilt_bis, kein DELETE (Invariante 8).';
comment on column anstellung_kondition.stundensatz_intern_cent is
  'Ganze Cent (Invariante 1). Interner KOSTENsatz, kein Lohn — die Plattform '
  'rechnet keine Loehne (D-06). Spaltenentzug K-05: lesbar nur ueber app.entgelt_lesen.';
comment on column anstellung_kondition.gilt_ab is
  '01-KERN §6.15 nennt diese Spalte `gueltig_ab`, 05-API-KARTE §C.8 `gilt_ab`. '
  'Umgesetzt ist die Schnittstellenschreibweise — siehe Kopf der Migration.';

-- ---------------------------------------------------------------------------
-- 2. RLS (§6.15: K-03-Standardpolicy, Modul `personal`, plus K-04 und K-18)
-- ---------------------------------------------------------------------------

alter table anstellung_kondition enable row level security;
alter table anstellung_kondition force  row level security;

create policy t_mandant on anstellung_kondition for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('personal.lesen', app.aktiver_mandant())));

/**
 * Schreiben verlangt `personal.entgelt_schreiben` und nicht
 * `personal.schreiben` (05-API-KARTE §C.8).
 *
 * Eine Kondition traegt den Stundensatz. Wer Vertragseckdaten pflegen darf —
 * Personalnummer, Eintritt —, darf damit noch keinen Kostensatz setzen; das
 * ist genau die Trennung, die K-05 mit dem Spaltenentzug meint, und sie waere
 * wertlos, wenn die Zeile daneben mit dem schwaecheren Recht entstuende.
 */
create policy t_mandant_schreiben on anstellung_kondition for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('personal.entgelt_schreiben', app.aktiver_mandant())));

/** Nur `gilt_bis` ist aenderbar (Spaltengrant unten) — eine Periode wird geschlossen. */
create policy t_mandant_schliessen on anstellung_kondition for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('personal.entgelt_schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('personal.entgelt_schreiben', app.aktiver_mandant())));

create policy t_gruppe on anstellung_kondition for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.personal.lesen')));

/**
 * K-18/EMP-15: der Mensch sieht seine eigene Konditionshistorie — OHNE
 * `stundensatz_intern_cent` und `tarifgruppe`, die ihm der Spaltengrant in
 * jedem Scope entzieht.
 */
create policy t_person on anstellung_kondition for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                                where a.person_id = app.aktuelle_person()));

/** K-04: das Mitarbeiterportal sieht nur die eigenen Zeilen, das Kundenportal keine. */
create policy p_ma_decke on anstellung_kondition as restrictive for all to cse_app
  using      (app.portal() <> 'mitarbeiter'
              or anstellung_id in (select a.id from anstellung a
                                    where a.person_id = app.aktuelle_person()))
  with check (app.portal() <> 'mitarbeiter'
              or anstellung_id in (select a.id from anstellung a
                                    where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on anstellung_kondition as restrictive for all to cse_app
  using      (app.portal() <> 'kunde')
  with check (app.portal() <> 'kunde');

/** Der Entgeltleser und der Spiegel-Trigger laufen als `cse_definer` (K-01). */
create policy d_kondition on anstellung_kondition for select to cse_definer using (true);
create policy d_kondition_schreiben on anstellung_kondition for insert to cse_definer
  with check (true);
create policy d_kondition_schliessen on anstellung_kondition for update to cse_definer
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Die Spaltenrechte (§11, K-05)
-- ---------------------------------------------------------------------------

/**
 * Dieselben zwei Spalten wie auf `anstellung` sind `cse_app` nicht lesbar —
 * und das ist der Punkt: es darf KEINEN zweiten Lesepfad zum Stundensatz
 * geben. Ein `grant select` auf dieser Tabelle waere genau er.
 *
 * INSERT gilt fuer ALLE Spalten: eine Kondition wird als Ganzes eingetragen
 * (§11 wortwoertlich). Schreibbar und unlesbar ist ein gueltiger Zustand.
 */
grant select (id, anstellung_id, mandant_id, gilt_ab, gilt_bis, arbeitszeitmodell,
              wochenstunden, arbeitstage_woche, kostenstelle, grund,
              erstellt_am, erstellt_von)
      on anstellung_kondition to cse_app;
grant insert on anstellung_kondition to cse_app;
grant update (gilt_bis) on anstellung_kondition to cse_app;
grant select, insert, update on anstellung_kondition to cse_definer;

-- ---------------------------------------------------------------------------
-- 4. kern.anstellung_kondition_spiegeln — der EINE Schreiber des Spiegels
-- ---------------------------------------------------------------------------

/**
 * Der Spiegel traegt die HEUTE gueltige Kondition — und nur die.
 *
 * **Eine zukuenftige Kondition aendert den Spiegel nicht.** Sie zu spiegeln
 * hiesse, eine ab naechstem Monat geltende Erhoehung schon heute in jede
 * Kalkulation zu tragen. Und eine rueckwirkende Kondition aendert ihn nur,
 * wenn sie bis heute reicht: das Stundenkonto des Vormonats bleibt, wie es
 * abgerechnet wurde (§6.14, der Test dazu steht in tests/isolation).
 *
 * `SECURITY DEFINER`, weil `cse_app` auf den Spiegelspalten kein UPDATE hat
 * (0191) — das ist die Zusage „genau ein Schreiber", und ohne Definer waere
 * dieser eine Schreiber der einzige, der nicht schreiben darf.
 */
create function kern.anstellung_kondition_spiegeln() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_heute date := app.berlin_heute(); v_kondition record;
begin
  /*
   * Gelesen wird nicht `new`, sondern „welche Zeile gilt heute". Beim
   * Schliessen einer Periode (`gilt_bis` gesetzt) ist `new` moeglicherweise
   * gar nicht mehr die gueltige — dann muss der Spiegel auf die naechste
   * fallen und nicht auf dem alten Wert stehen bleiben.
   */
  select k.* into v_kondition
    from public.anstellung_kondition k
   where k.anstellung_id = new.anstellung_id
     and k.gilt_ab <= v_heute
     and (k.gilt_bis is null or k.gilt_bis >= v_heute)
   order by k.gilt_ab desc
   limit 1;

  /*
   * **Keine heute gueltige Kondition heisst: der Spiegel wird GELEERT.**
   *
   * Hier stand `return null` — und damit blieb der Spiegel auf den alten
   * Werten stehen, sobald die einzige Kondition mit einem `gilt_bis` in der
   * Vergangenheit geschlossen wurde. Genau das ist der unbezahlte
   * Ruhezeitraum, den der Kopf dieser Migration als legitime LUECKE
   * beschreibt: die Beschaeftigung laeuft, aber keine Kondition gilt. Die
   * Vertrags- und die Entgeltseite zeigten danach Wochenstunden und
   * Arbeitstage, die niemand mehr vereinbart hat — sichtbar falsch und nicht
   * als „nicht hinterlegt" erkennbar. Fuer die GELDzahl ist es folgenlos
   * (`app.entgelt_lesen` liest die Kondition, nicht den Spiegel); fuer die
   * Anzeige daneben ist es ein stehengebliebener Wert, und ein
   * stehengebliebener Wert ist der, dem jemand glaubt.
   *
   * `arbeitszeitmodell` traegt `not null default 'unbekannt'` und wird
   * deshalb auf den Vorgabewert und nicht auf NULL gesetzt — „unbekannt" ist
   * hier die Wahrheit.
   */
  if v_kondition.id is null then
    update public.anstellung a
       set arbeitszeitmodell  = 'unbekannt',
           wochenstunden      = null,
           arbeitstage_woche  = null,
           stundensatz_intern = null,
           tarifgruppe        = null,
           kostenstelle       = null,
           geaendert_am       = now()
     where a.id = new.anstellung_id
       and (a.wochenstunden is not null or a.arbeitstage_woche is not null
         or a.stundensatz_intern is not null or a.tarifgruppe is not null
         or a.kostenstelle is not null or a.arbeitszeitmodell <> 'unbekannt');
    return null;
  end if;

  update public.anstellung a
     set arbeitszeitmodell  = v_kondition.arbeitszeitmodell,
         wochenstunden      = v_kondition.wochenstunden,
         arbeitstage_woche  = v_kondition.arbeitstage_woche,
         stundensatz_intern = v_kondition.stundensatz_intern_cent,
         tarifgruppe        = v_kondition.tarifgruppe,
         kostenstelle       = v_kondition.kostenstelle,
         geaendert_am       = now()
   where a.id = new.anstellung_id;
  return null;
end $$;

alter function kern.anstellung_kondition_spiegeln() owner to cse_definer;

create trigger trg_anstellung_kondition_spiegeln
  after insert or update on anstellung_kondition
  for each row execute function kern.anstellung_kondition_spiegeln();

comment on function kern.anstellung_kondition_spiegeln() is
  '§6.14: der EINZIGE Schreiber der Spiegelspalten auf anstellung. Spiegelt die '
  'am Berliner Heute gueltige Kondition — nie eine zukuenftige.';

/**
 * Der Datumswechsel (§6.14: „Ein naechtlicher Job leitet den Spiegel neu ab").
 *
 * Ohne ihn zeigt der Spiegel am Tag des Inkrafttretens noch den alten Satz:
 * der Trigger feuert beim SCHREIBEN, und am 1. des Monats schreibt niemand.
 * Die Anbindung an den Planer gehoert nicht in diese Migration; die Mechanik
 * steht hier, und `app.entgelt_lesen` (0193) liest ohnehin die Kondition und
 * nicht den Spiegel — ein veralteter Spiegel kostet damit keine Zahl, sondern
 * nur die Anzeige eines Nebenfelds.
 */
create function app.anstellung_kondition_spiegel_nachziehen() returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_heute date := app.berlin_heute(); v_anzahl integer := 0;
begin
  /*
   * `gueltig` liefert je Beschaeftigung die heute geltende Kondition — und
   * fuer eine Beschaeftigung, deren Konditionen alle geschlossen sind, GAR
   * KEINE Zeile. Das `update ... from gueltig` traf sie deshalb nie, und ihr
   * Spiegel blieb auf den Werten der letzten Kondition stehen (dieselbe
   * Luecke wie im Trigger oben). `leer` ist der zweite Zweig: sie hat
   * Konditionen, aber keine gueltige, also gehoert der Spiegel geleert.
   *
   * Beschaeftigungen OHNE jede Kondition bleiben ausdruecklich unberuehrt —
   * das ist der Bestand vor 0192, dessen `stundensatz_intern` von Hand
   * gepflegt wurde; ihn zu leeren hiesse, Daten zu loeschen, die dieser Job
   * nicht geschrieben hat.
   */
  with gueltig as (
    select distinct on (k.anstellung_id)
           k.anstellung_id, k.arbeitszeitmodell, k.wochenstunden, k.arbeitstage_woche,
           k.stundensatz_intern_cent, k.tarifgruppe, k.kostenstelle
      from public.anstellung_kondition k
     where k.gilt_ab <= v_heute
       and (k.gilt_bis is null or k.gilt_bis >= v_heute)
     order by k.anstellung_id, k.gilt_ab desc),
  leer as (
    update public.anstellung a
       set arbeitszeitmodell  = 'unbekannt',
           wochenstunden      = null,
           arbeitstage_woche  = null,
           stundensatz_intern = null,
           tarifgruppe        = null,
           kostenstelle       = null,
           geaendert_am       = now()
     where exists (select 1 from public.anstellung_kondition k
                    where k.anstellung_id = a.id)
       and not exists (select 1 from gueltig g where g.anstellung_id = a.id)
       and (a.wochenstunden is not null or a.arbeitstage_woche is not null
         or a.stundensatz_intern is not null or a.tarifgruppe is not null
         or a.kostenstelle is not null or a.arbeitszeitmodell <> 'unbekannt')
     returning a.id),
  gesetzt as (
    update public.anstellung a
       set arbeitszeitmodell  = g.arbeitszeitmodell,
           wochenstunden      = g.wochenstunden,
           arbeitstage_woche  = g.arbeitstage_woche,
           stundensatz_intern = g.stundensatz_intern_cent,
           tarifgruppe        = g.tarifgruppe,
           kostenstelle       = g.kostenstelle,
           geaendert_am       = now()
      from gueltig g
     where a.id = g.anstellung_id
       and (a.arbeitszeitmodell  is distinct from g.arbeitszeitmodell
         or a.wochenstunden      is distinct from g.wochenstunden
         or a.arbeitstage_woche  is distinct from g.arbeitstage_woche
         or a.stundensatz_intern is distinct from g.stundensatz_intern_cent
         or a.tarifgruppe        is distinct from g.tarifgruppe
         or a.kostenstelle       is distinct from g.kostenstelle)
     returning a.id)
  select (select count(*) from gesetzt) + (select count(*) from leer)
    into v_anzahl;
  return v_anzahl;
end $$;

alter function app.anstellung_kondition_spiegel_nachziehen() owner to cse_definer;
revoke execute on function app.anstellung_kondition_spiegel_nachziehen() from public;
grant execute on function app.anstellung_kondition_spiegel_nachziehen() to cse_job;

comment on function app.anstellung_kondition_spiegel_nachziehen() is
  '§6.14: leitet den Spiegel nach dem Datumswechsel neu ab und gibt die Anzahl '
  'geaenderter Zeilen zurueck. Nur cse_job.';

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0192)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- anstellung_kondition (append): §6.15, LEG-02, ACC-12. Die datierte Kondition ist die Grundlage jeder Sollstunden- und Lohnkostenrechnung; eine geloeschte Zeile bewertet stillschweigend jeden abgerechneten Monat neu, in dem sie galt. Abgeloest wird sie von der naechsten datierten Zeile, geschlossen ueber `gilt_bis` — nie durch DELETE.
create trigger trg_anstellung_kondition_kein_hard_delete
  before delete on anstellung_kondition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_anstellung_kondition_kein_truncate
  before truncate on anstellung_kondition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on anstellung_kondition from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_anstellung_kondition_audit
  after insert or update or delete on anstellung_kondition
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
