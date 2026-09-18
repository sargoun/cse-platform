-- ===========================================================================
-- 0191 — Die Beschaeftigung beenden: austritt_grund, der Einbahn-Uebergang
--        und die fehlende Haelfte von K-14
--        (01-KERN §6.14, K-05, K-14, 05-API-KARTE §C.8, Invariante 8)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.14 und §11;
-- `docs/architecture/00-KONVENTIONEN.md` K-14.
--
-- **Drei Luecken, die zusammengehoeren.**
--
-- (1) `austritt_grund` fehlte. 05-API-KARTE §C.8 fuehrt fuer
--     `POST /api/personal/anstellungen/[id]/beenden` den Rumpf
--     `{ austritt, grund }`, und §6.14 fuehrt die Spalte namentlich — auch in
--     der UPDATE-Grant-Liste von §11, dreimal. Den Grund stattdessen ins
--     `audit_log` zu schreiben, „weil die Spalte fehlt", waere die
--     stillschweigende Wahl gegen das Datenmodell.
--
-- (2) **K-14 war nur zur HAELFTE in der Datenbank.**
--     `kern.bm_aus_anstellung_schutz` sitzt auf `benutzer_mandant` und
--     verbietet, eine abgeleitete Mitgliedschaft von Hand zu entziehen — die
--     erzeugende und entziehende Seite (`kern.bm_aus_anstellung` auf
--     `anstellung`) gab es NICHT. Eine beendete Anstellung liess die
--     Mitgliedschaft mit `aus_anstellung = true` also stehen, und die
--     Schutzregel verhinderte, dass irgendwer sie noch entfernt: der Mensch
--     behielt seinen Portalzugang zu einer Gesellschaft, die ihn nicht mehr
--     beschaeftigt, und niemand konnte es beheben.
--
-- (3) Es gab keinen Einbahn-Uebergang auf `anstellung.status`. „beendet" liess
--     sich zurueckdrehen — und zwar lautlos, denn `status` ist `text` mit
--     CHECK. §6.14 nennt den Trigger `anstellung_status_uebergang`
--     ausdruecklich (statt eines CHECKs, weil nur unzulaessige UEBERGAENGE
--     werfen duerfen, nicht Zustaende).
--
-- Dazu die Spalten der datierten Kondition (§6.14: `tarifgruppe`,
-- `arbeitstage_woche`, `kostenstelle`) — sie gehoeren zum Spiegel, den 0192
-- pflegt, und muessen existieren, bevor der Spiegel-Trigger sie schreibt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die fehlenden Spalten (§6.14)
-- ---------------------------------------------------------------------------

alter table anstellung add column austritt_grund    text;
alter table anstellung add column tarifgruppe       text;
alter table anstellung add column arbeitstage_woche numeric(12,3);
alter table anstellung add column kostenstelle      text;

comment on column anstellung.austritt_grund is
  '05-API-KARTE §C.8: der Grund der Beendigung, in Worten. Keine Aufzaehlung — '
  'welche Beendigungsgruende die Gruppe fuehrt, ist nicht entschieden (O-612).';
comment on column anstellung.tarifgruppe is
  'Abgeleiteter Spiegel der heute gueltigen anstellung_kondition (§6.14). '
  'Spaltenentzug nach K-05: lesbar nur ueber app.entgelt_lesen.';
comment on column anstellung.arbeitstage_woche is
  'Abgeleiteter Spiegel (§6.14). Grundlage der Urlaubstagsberechnung (EMP-05, O-18).';
comment on column anstellung.kostenstelle is
  'Abgeleiteter Spiegel (§6.14). ACC-01, ACC-12.';

-- ---------------------------------------------------------------------------
-- 2. Die Spaltenrechte (§11) — der Spiegel bekommt GENAU EINEN Schreiber
-- ---------------------------------------------------------------------------

/**
 * **Der Spiegel ist fuer `cse_app` nicht schreibbar.**
 *
 * `anstellung` trug fuer `cse_app` einen TABELLENWEITEN UPDATE-Grant
 * (`relacl: cse_app=aw`); ein `revoke update (wochenstunden)` darauf waere
 * wirkungslos gewesen — nachgemessen, nicht vermutet. Deshalb erst das
 * Tabellenrecht weg, dann die erschoepfende Liste zurueck.
 *
 * Was fehlt, ist der Spiegel aus §6.14: `arbeitszeitmodell`, `wochenstunden`,
 * `arbeitstage_woche`, `stundensatz_intern`, `tarifgruppe`, `kostenstelle`.
 * Ein tabellenweiter Grant liess jeden Halter von `personal.schreiben`
 * `update anstellung set stundensatz_intern = …` ausfuehren — ein blinder
 * Schreibvorgang auf eine Spalte, die er nicht lesen darf, mit der datierten
 * Wahrheit in `anstellung_kondition` unberuehrt und ohne Fehlermeldung
 * irgendwo. Genau der Defekt „zwei Schreibflaechen ueber einer Spalte".
 *
 * `stundensatz_intern` verliert damit auch seinen INSERT-Weg nicht: `insert`
 * bleibt tabellenweit, weil eine Anstellung als GANZES angelegt wird (der
 * Seed und `/anstellungen/neu` tun das) — und der Spiegel beim Anlegen noch
 * kein Spiegel ist, sondern der erste Wert.
 */
revoke update on anstellung from cse_app;
grant  update (personalnummer, eintritt, austritt, status, austritt_grund,
               geloescht_am, geloescht_von, geaendert_am, geaendert_von)
       on anstellung to cse_app;
       -- arbeitszeitmodell, wochenstunden, arbeitstage_woche, stundensatz_intern,
       -- tarifgruppe, kostenstelle ausgelassen: der Spiegel (§6.14) hat genau
       -- einen Schreiber, kern.anstellung_kondition_spiegeln (0192)

/** Lesbar: alles bis auf die zwei Entgeltspalten (K-05). */
grant select (austritt_grund, arbeitstage_woche, kostenstelle) on anstellung to cse_app;
       -- tarifgruppe NICHT: K-05 nennt sie neben stundensatz_intern

/**
 * Der Spiegel-Trigger und der Entgeltleser gehoeren `cse_definer` (K-01) und
 * brauchen deshalb ihr eigenes Recht auf die Spalten, die `cse_app` nicht hat.
 */
grant select (stundensatz_intern, tarifgruppe, arbeitstage_woche, kostenstelle,
              arbeitszeitmodell, wochenstunden, status, austritt, austritt_grund)
      on anstellung to cse_definer;
grant update (stundensatz_intern, tarifgruppe, arbeitstage_woche, kostenstelle,
              arbeitszeitmodell, wochenstunden, status, geaendert_am)
      on anstellung to cse_definer;

create policy d_anstellung_spiegeln on anstellung for update to cse_definer
  using (true) with check (true);

comment on policy d_anstellung_spiegeln on anstellung is
  'K-01/§6.14: der Spiegel-Trigger und app.anstellung_status_nachziehen laufen '
  'als cse_definer. Ohne diese Policy schriebe der Trigger unter FORCE RLS null '
  'Zeilen — lautlos, mit der datierten Kondition als einziger Wahrheit.';

-- ---------------------------------------------------------------------------
-- 3. Der Einbahn-Uebergang auf `status` (§6.14)
-- ---------------------------------------------------------------------------

/**
 * `beendet` ist eine Einbahnstrasse.
 *
 * **Warum ein Trigger und kein CHECK.** Ein CHECK sieht nur die neue Zeile und
 * kann „von wo nach wo" nicht beurteilen; er muesste deshalb ZUSTAENDE
 * verbieten und wuerde jede Korrektur an einer beendeten Zeile mittreffen —
 * auch das Nachtragen des Beendigungsgrunds. Der Trigger verbietet genau den
 * unzulaessigen UEBERGANG und laesst alles andere an der Zeile zu (§6.14, B8).
 *
 * Eine faelschlich beendete Anstellung wird nicht zurueckgedreht, sondern neu
 * angelegt — mit eigenem Eintritt und eigener Personalnummer. Das ist keine
 * Haerte, sondern der Grund, warum Zeitdaten an `anstellung_id` haengen: eine
 * Zeile, die zweimal „lief", hat keine erkennbare Laufzeit mehr.
 */
create function kern.anstellung_status_uebergang() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status = 'beendet' and new.status <> 'beendet' then
    raise exception
      'Eine beendete Beschäftigung wird nicht wieder eröffnet (§6.14). Eine neue '
      'Beschäftigung ist eine neue Zeile — mit eigenem Eintritt und eigener '
      'Personalnummer; sonst hätte die alte zwei Laufzeiten und keine davon wäre '
      'belegbar.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_anstellung_status_uebergang
  before update of status on anstellung
  for each row execute function kern.anstellung_status_uebergang();

comment on function kern.anstellung_status_uebergang() is
  '§6.14, B8: `beendet` ist einwegs. Nur der unzulaessige UEBERGANG wirft — '
  'das Nachtragen von austritt_grund an einer beendeten Zeile bleibt moeglich.';

-- ---------------------------------------------------------------------------
-- 4. K-14 — die erzeugende und entziehende Haelfte
-- ---------------------------------------------------------------------------

/**
 * `benutzer_mandant` ist ADDITIV (K-14), und dieser Trigger ist die Haelfte,
 * die fehlte.
 *
 * **Er fuegt nur ein, wenn keine Zeile da ist, und entzieht nur, was er
 * besitzt.** Eine `leitung` der Reinigung ist normalerweise auch dort
 * ANGESTELLT. Ein Trigger, der ihre Zeile ueberschreibt, nimmt ihr lautlos den
 * ganzen Bereich; einer, der wirft, blockiert die Anstellung. Deshalb:
 * `aus_anstellung` unterscheidet die abgeleitete von der erteilten
 * Mitgliedschaft, und der Trigger ruehrt die erteilte nie an.
 *
 * **Das Entziehen setzt `aus_anstellung = false` MIT.** `kern.bm_aus_anstellung_schutz`
 * (0007) verbietet genau die Kombination „war abgeleitet, bleibt abgeleitet,
 * wird entzogen" — erst uebernehmen, dann entziehen. Eine einzige
 * UPDATE-Anweisung, die beides setzt, geht durch: die Zeile ist beim Entzug
 * keine abgeleitete mehr, und sie traegt danach den Grund, aus dem sie endete.
 *
 * **SECURITY DEFINER, und zwar notwendig.** `t_bm_entziehen` verlangt
 * `system.benutzer_verwalten`, `p_bm_aal2_update` verlangt `aal2`. Die
 * Personalstelle, die eine Anstellung beendet, hat beides in der Regel nicht —
 * und soll es fuer diesen Vorgang auch nicht brauchen. Der Trigger laeuft
 * deshalb als `cse_definer` mit eigener Policy; die Rechtepruefung sitzt eine
 * Ebene hoeher, an `personal.anstellung_beenden`.
 */
grant insert, update on benutzer_mandant to cse_definer;

create policy d_bm_aus_anstellung on benutzer_mandant for insert to cse_definer
  with check (aus_anstellung);
create policy d_bm_aus_anstellung_entziehen on benutzer_mandant for update to cse_definer
  using (true) with check (true);

comment on policy d_bm_aus_anstellung on benutzer_mandant is
  'K-14: der Trigger legt NUR abgeleitete Zeilen an. `with check (aus_anstellung)` '
  'macht das zur Eigenschaft der Datenbank und nicht zur Sorgfalt des Triggers.';

create function kern.bm_aus_anstellung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_benutzer uuid; v_rolle uuid; v_beendet boolean;
begin
  /*
   * Ohne Konto gibt es keine Mitgliedschaft zu pflegen. Das ist der Normalfall
   * einer Reinigungskraft ohne Portalzugang — kein Fehler, nichts zu tun.
   */
  select b.id into v_benutzer
    from public.benutzer b
   where b.person_id = new.person_id and b.deaktiviert_am is null
   order by b.erstellt_am
   limit 1;
  if v_benutzer is null then return null; end if;

  v_beendet := new.status = 'beendet' or new.geloescht_am is not null;

  if v_beendet then
    /*
     * Nur DIESE Gesellschaft, nur die abgeleitete Zeile — und nur, wenn der
     * Mensch hier keine andere laufende Beschaeftigung mehr hat (zwei
     * Anstellungen bei derselben Gesellschaft sind moeglich, O-137).
     */
    if exists (select 1 from public.anstellung a
                where a.person_id = new.person_id
                  and a.mandant_id = new.mandant_id
                  and a.id <> new.id
                  and a.status <> 'beendet'
                  and a.geloescht_am is null) then
      return null;
    end if;

    update public.benutzer_mandant
       set aus_anstellung = false,
           entzogen_am    = now(),
           entzugsgrund   = 'Beschäftigung beendet (K-14)'
     where benutzer_id = v_benutzer
       and mandant_id  = new.mandant_id
       and aus_anstellung
       and entzogen_am is null;
    return null;
  end if;

  /*
   * **Der Anlege-Zweig gehoert dem Beginn, nicht jedem UPDATE.**
   *
   * Der Trigger haengt an `update of status, geloescht_am` — er feuert also
   * bei jedem UPDATE, das `status` in der SET-Liste NENNT, auch wenn der Wert
   * derselbe bleibt. `beendeAnstellung` nennt sie immer
   * (`status = case when $4 then 'beendet' else status end`), und bei einem
   * Austritt in der ZUKUNFT bleibt der Status `aktiv`. Ohne diese Schranke
   * liefe „Beschaeftigung beenden" damit in den Anlege-Zweig — und ein von
   * Hand entzogener Portalzugang kaeme durch eine blosse Datumsaenderung
   * zurueck. Aus dem Entzug wuerde eine Erteilung, in derselben Anweisung.
   *
   * Gemeint ist der Zweig nur zweimal: wenn die Beschaeftigung ENTSTEHT, und
   * wenn sie aus `beendet`/geloescht zurueckkehrt (Wiedereinstellung, ein
   * zurueckgenommener Austrag). Alles andere laesst die Mitgliedschaft, wie
   * sie ist.
   */
  if tg_op = 'UPDATE'
     and not (old.status = 'beendet' or old.geloescht_am is not null) then
    return null;
  end if;

  /*
   * Anlegen — nur wenn KEINE laufende Zeile da ist. Eine erteilte `leitung`
   * bleibt damit unberuehrt, und der partielle Unique-Index
   * (benutzer_id, mandant_id) where entzogen_am is null wird nie verletzt.
   */
  if exists (select 1 from public.benutzer_mandant bm
              where bm.benutzer_id = v_benutzer
                and bm.mandant_id  = new.mandant_id
                and bm.entzogen_am is null) then
    return null;
  end if;

  /*
   * **Ein von Hand zurueckgenommener Zugang bleibt zurueckgenommen.**
   *
   * `kern.bm_aus_anstellung_schutz` (0007) zwingt den Menschen, der eine
   * abgeleitete Mitgliedschaft entzieht, sie vorher zu UEBERNEHMEN
   * (`aus_anstellung = false`). Danach ist die Zeile von der eigenen
   * Entzugszeile dieses Triggers nicht mehr zu unterscheiden — ausser am
   * Grund. Ohne diese Pruefung machte eine Wiedereinstellung eine Sperre
   * rueckgaengig, die jemand aus einem Grund verhaengt hat, den die Datenbank
   * nicht kennt. Die sichere Richtung ist, NICHT anzulegen: ein Zugang, der
   * fehlt, wird gemeldet; ein Zugang, der unbemerkt wiederkommt, nicht.
   *
   * TODO(client, O-615): Soll eine Wiedereinstellung einen zuvor von Hand
   * entzogenen Portalzugang automatisch wiederherstellen, oder bleibt die
   * Wiedererteilung eine ausdrueckliche Handlung der Leitung?
   */
  if exists (select 1 from public.benutzer_mandant bm
              where bm.benutzer_id = v_benutzer
                and bm.mandant_id  = new.mandant_id
                and bm.entzogen_am is not null
                and bm.entzugsgrund is distinct from 'Beschäftigung beendet (K-14)') then
    return null;
  end if;

  select r.id into v_rolle from public.rolle r
   where r.schluessel = 'mitarbeiter' and r.mandant_id is null
     and r.geltungsbereich = 'mandant';
  if v_rolle is null then return null; end if;

  insert into public.benutzer_mandant
    (benutzer_id, mandant_id, rolle_id, aus_anstellung, gueltig_ab)
  values (v_benutzer, new.mandant_id, v_rolle, true,
          greatest(new.eintritt, app.berlin_heute()));
  return null;
end $$;

alter function kern.bm_aus_anstellung() owner to cse_definer;

create trigger trg_bm_aus_anstellung
  after insert or update of status, geloescht_am on anstellung
  for each row execute function kern.bm_aus_anstellung();

comment on function kern.bm_aus_anstellung() is
  'K-14, die erzeugende und entziehende Haelfte. Legt nur bei INSERT oder bei '
  'Rueckkehr aus beendet/geloescht an, nur wenn keine laufende Mitgliedschaft '
  'besteht und kein von Hand entzogener Zugang vorliegt; entzieht nur Zeilen '
  'mit aus_anstellung = true. Eine erteilte Rolle ueberlebt Anlage UND '
  'Austritt, und ein Entzug ueberlebt eine Datumsaenderung.';

-- ---------------------------------------------------------------------------
-- 5. Der Nachzieher fuer ein Austrittsdatum in der Zukunft (§6.14)
-- ---------------------------------------------------------------------------

/**
 * `austritt` in der Zukunft setzt `status` NICHT sofort auf `beendet`.
 *
 * §6.14 loest das ausdruecklich nicht mit einem CHECK, sondern mit dem Job
 * `job:anstellung_status` und einer Monitoring-Abfrage. Diese Funktion ist
 * seine Mechanik: sie setzt `beendet`, sobald der Tag gekommen ist — in
 * Europe/Berlin, denn ein Austritt ist ein Kalendertag und kein Zeitpunkt
 * (Invariante 2). Der Mitgliedschaftsentzug haengt am Statuswechsel und
 * geschieht damit am richtigen Tag, nicht beim Eintragen.
 *
 * Die ANBINDUNG an den Planer gehoert nicht hierher; ohne sie bleibt der Stand
 * sichtbar falsch (eine Zeile mit vergangenem Austritt und Status `aktiv`) und
 * nicht lautlos falsch — das ist der Unterschied, auf den es ankommt.
 */
create function app.anstellung_status_nachziehen() returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_anzahl integer;
begin
  with faellig as (
    update public.anstellung a
       set status = 'beendet', geaendert_am = now()
     where a.status <> 'beendet'
       and a.austritt is not null
       and a.austritt < app.berlin_heute()
       and a.geloescht_am is null
     returning a.id)
  select count(*)::integer into v_anzahl from faellig;
  return v_anzahl;
end $$;

alter function app.anstellung_status_nachziehen() owner to cse_definer;
revoke execute on function app.anstellung_status_nachziehen() from public;
grant execute on function app.anstellung_status_nachziehen() to cse_job;

comment on function app.anstellung_status_nachziehen() is
  '§6.14: setzt `beendet`, sobald das Austrittsdatum vergangen ist (Berlin). '
  'Mechanik von job:anstellung_status — nur cse_job darf sie ausfuehren.';
