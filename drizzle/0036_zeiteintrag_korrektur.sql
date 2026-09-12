-- ===========================================================================
-- 0036 — zeiteintrag_korrektur: die unveraenderliche Korrekturspur
--        (04-PLANUNG-ZEIT.md §5.7 und §15.6; TIM-11, EMP-04, EMP-07,
--         LEG-01, LEG-02, SEC-A9)
--
-- Wer einen Zeitdatensatz geaendert hat, wann, warum, und wie die Werte davor
-- und danach lauteten.
--
-- **Warum eine neue Fassung und kein UPDATE mit Auditzeile daneben.** Der
-- naheliegende Weg — den Beleg aendern und die Aenderung protokollieren —
-- verliert genau das, worauf es ankommt: den Datensatz, DER GALT, als der Lohn
-- gezahlt und die Rechnung geschrieben wurde. Eine festgeschriebene Rechnung
-- zeigt danach auf eine Zeile, deren Inhalt sich seither geaendert hat, und im
-- Lohnstreit gibt es keine Fassung mehr, auf die sich beide Seiten beziehen
-- koennen. Hier praegt jede Korrektur eine NEUE `zeiteintrag`-Fassung, die
-- alte wird als abgeloest markiert — die einzige Mutation, die
-- `z_unveraenderlich` zulaesst — und diese Tabelle haelt das Warum.
--
-- Drei Sperren, die keine Verwaltungsentscheidung sind, sondern Bedingungen:
--
--  1. **`zk_write_once`** wirft bei jedem UPDATE und jedem DELETE. Der ganze
--     Wert dieser Tabelle ist, dass sie sich nicht bearbeiten laesst — auch
--     nicht von `super_admin`, auch nicht „nur der Tippfehler in der
--     Begruendung".
--
--  2. **`zk_nicht_selbst`**: der Mensch hinter `durchgefuehrt_von` ist nie der
--     betroffene Mensch (EMP-07). Der Arbeitnehmer fasst seinen eigenen
--     Zeitdatensatz nicht an, auch nicht mit einem Recht, das jemand ihm
--     versehentlich erteilt hat.
--
--  3. **`zk_sperre_ausgleich`**: ist der Monat des Ursprungs gesperrt, verlangt
--     die Korrektur ihre Gegenbuchung. Ohne diese Bedingung liesse sich eine
--     Korrektur an einem abgeschlossenen Monat aufschreiben, deren Wirkung
--     nirgends ankommt — der gesperrte Monat bliebe richtig, der offene wuesste
--     nichts davon, und die Differenz waere verschwunden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1, §3.2)
-- ---------------------------------------------------------------------------

create type korrektur_art as enum
  ('zeit_korrektur','pause_korrektur','zuordnung_korrektur','nacherfassung','storno');

/**
 * PROVISORISCH (§3.2). Aus diesem Vokabular entsteht die TIM-11-Auswertung
 * und die Frage, ob irgendwo blind abgenickt wird.
 * // TODO(client, O-173): Welche Korrekturgruende soll die Auswertung
 * unterscheiden — diese fuenf oder eine andere Systematik?
 */
create type korrektur_grund as enum
  ('vergessen_auszustempeln','geraet_defekt','falsches_objekt',
   'einwand_mitarbeiter','nachtrag_offline','sonstiges');

-- ---------------------------------------------------------------------------
-- 2. zeiteintrag_korrektur (§5.7)
-- ---------------------------------------------------------------------------

create table zeiteintrag_korrektur (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  -- Der logische Eintrag. Damit liest sich die ganze Geschichte als EIN
  -- indizierter Zugriff — das ist die Ansicht, die ein Pruefer vorgelegt
  -- bekommt.
  kette_id      uuid not null,
  ursprung_zeiteintrag_id uuid not null,
  ersatz_zeiteintrag_id   uuid,

  art           korrektur_art not null,
  grund_kategorie korrektur_grund not null,
  /**
   * Freitext, und BEWUSST ohne Mindestlaenge.
   *
   * Eine Regel wie `length >= 10` weist berechtigte kurze Gruende ab
   * („Krank", das arabische oder tuerkische Aequivalent), waehrend EMP-12
   * kurze mehrsprachige Texte gerade wahrscheinlich macht — und eine
   * Zeichenzahl ist ohnehin keine Qualitaetskontrolle. Verlangt wird, dass
   * ueberhaupt etwas dasteht.
   */
  begruendung   text not null,

  -- Vollstaendige Feldabbilder der abgeloesten und der ersetzenden Zeile
  -- (SEC-A9 „vorher"/„nachher").
  vorher        jsonb not null,
  nachher       jsonb not null,

  /**
   * Der Einwand, den diese Korrektur beantwortet (EMP-07), und die
   * Gegenbuchung in den naechsten offenen Monat (EMP-04, §12.2). Beide
   * Elterntabellen kommen spaeter (PR 36 und PR 37) — die Spalten stehen
   * schon hier, weil die Struktur ab der ersten Migration steht (§19), und
   * `zk_sperre_ausgleich` prueft die zweite bereits.
   */
  zeit_einwand_id       uuid,
  ausgleich_bewegung_id uuid,

  -- Nie der betroffene Mensch (Ausloeser unten).
  durchgefuehrt_von uuid not null references benutzer(id),
  durchgefuehrt_am  timestamptz not null default now(),
  ip_adresse        inet,

  -- §1.13 / §13: dieselbe Klasse wie der Eintrag, den sie korrigiert.
  -- // TODO(client, O-25): Aufbewahrungsfrist der Korrekturspur — sie teilt
  -- die des korrigierten Eintrags, aber ab wann laeuft dessen Frist?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  /**
   * Genau einmal geschrieben: keine `geaendert_*`-Spalten, keine weiche
   * Loeschung. Es gibt hier nichts, was eine Zeile beenden koennte.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint zeiteintrag_korrektur_mandant_uk unique (mandant_id, id),

  constraint zk_ursprung_fk foreign key (mandant_id, ursprung_zeiteintrag_id)
    references zeiteintrag (mandant_id, id),
  constraint zk_ersatz_fk foreign key (mandant_id, ersatz_zeiteintrag_id)
    references zeiteintrag (mandant_id, id),

  -- Nur ein Storno hat keine Ersatzfassung: er nimmt zurueck, er ersetzt nicht.
  constraint zk_ersatz_ausser_storno check (
    art = 'storno' or ersatz_zeiteintrag_id is not null),
  constraint zk_begruendung_nicht_leer check (btrim(begruendung) <> ''),
  constraint zk_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- „Die Geschichte dieses Zeiteintrags" — die Ansicht fuer Pruefer und Anwalt.
create index zk_kette_idx on zeiteintrag_korrektur (mandant_id, kette_id, durchgefuehrt_am);
create index zk_ursprung_idx on zeiteintrag_korrektur (mandant_id, ursprung_zeiteintrag_id);
/**
 * Die EINZELAUSKUNFT „wer hat diese Korrektur gemacht" — sie ist Audit und
 * jederzeit erlaubt. Was §1.15 sperrt, ist die AGGREGATION daraus: eine
 * Rangliste „wer korrigiert viel" ist eine Leistungskontrolle und haengt an
 * `zeit.korrekturstatistik` (O-06/O-172). Der Index bleibt, der Bildschirm
 * nicht.
 */
create index zk_akteur_idx on zeiteintrag_korrektur (mandant_id, durchgefuehrt_von, durchgefuehrt_am);
create index zk_zeitraum_idx on zeiteintrag_korrektur (mandant_id, durchgefuehrt_am);

comment on table zeiteintrag_korrektur is
  'Die unveraenderliche Korrekturspur zu zeiteintrag (§5.7, TIM-11): wer, '
  'wann, warum, vorher, nachher. Kein UPDATE, kein DELETE, fuer niemanden.';
comment on column zeiteintrag_korrektur.ausgleich_bewegung_id is
  'Die Gegenbuchung im naechsten offenen Monat, wenn der Ursprungsmonat '
  'gesperrt war (§12.2). Das ist es, was „die Differenz ist angekommen" '
  'beweisbar statt behauptet macht.';

-- ---------------------------------------------------------------------------
-- 3. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * Der Zeitpunkt gehoert dem Server (Invariante 5). Eigene Funktion, weil
 * `kern.erzwinge_serverzeit()` auf `eingegangen_am` festgeschrieben ist und
 * ein Ausloeser keine Spaltennamen als Argument nimmt.
 */
create function kern.korrektur_serverzeit() returns trigger
language plpgsql as $$
begin
  new.durchgefuehrt_am := now();
  return new;
end $$;

create trigger trg_zeiteintrag_korrektur_1_serverzeit
  before insert on zeiteintrag_korrektur
  for each row execute function kern.korrektur_serverzeit();

/**
 * `zk_write_once` — wirft bedingungslos bei UPDATE und DELETE.
 *
 * Guertel und Hosentraeger neben der fehlenden Policy und dem entzogenen
 * Grant: eine fehlende Policy loescht null Zeilen und meldet ERFOLG — von
 * einem Nichts-Tun nicht zu unterscheiden —, und eine Verbindung, die nicht
 * `cse_app` ist, fragt die Policy gar nicht erst.
 */
create function kern.korrektur_write_once() returns trigger
language plpgsql as $$
begin
  raise exception 'Die Korrekturspur ist unveraenderlich'
    using errcode = 'P0001',
          detail  = format('%s auf zeiteintrag_korrektur ist nicht vorgesehen.', tg_op),
          hint    = 'Eine falsche Korrektur wird durch eine WEITERE Korrektur '
                    || 'richtiggestellt, nie durch Bearbeiten (TIM-11).';
end $$;

create trigger trg_zeiteintrag_korrektur_write_once
  before update or delete on zeiteintrag_korrektur
  for each row execute function kern.korrektur_write_once();

/**
 * `zk_kette_pruefen` — die Kette gabelt nicht, und der Ursprung wird als
 * abgeloest markiert.
 *
 * Diese Zeile ist die EINZIGE Stelle, an der `zeiteintrag.ersetzt_am` und
 * `ersetzt_durch_zeiteintrag_id` gesetzt werden; `z_unveraenderlich` laesst
 * genau diese beiden Spalten an einem geschlossenen Eintrag zu. Ohne die
 * Markierung gaebe es zwei Zeilen mit `ersetzt_am is null` in einer Kette —
 * also zwei „aktuelle" Fassungen derselben Schicht, und jede Auswertung
 * zaehlte die Stunden doppelt.
 */
create function kern.korrektur_kette_pruefen() returns trigger
language plpgsql as $$
declare u record; e record;
begin
  select z.kette_id, z.version, z.ersetzt_am, z.mandant_id, z.status, z.gesperrt_am
    into u
    from zeiteintrag z
   where z.id = new.ursprung_zeiteintrag_id and z.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Der korrigierte Zeiteintrag gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  if u.ersetzt_am is not null then
    raise exception 'Dieser Zeiteintrag wurde bereits abgeloest'
      using errcode = 'check_violation',
            detail  = 'Korrigiert wird immer die AKTUELLE Fassung der Kette.',
            hint    = 'Die Fassung mit ersetzt_am is null waehlen.';
  end if;

  if new.kette_id is distinct from u.kette_id then
    raise exception 'Die Korrektur nennt eine andere Kette als ihr Ursprung'
      using errcode = 'check_violation';
  end if;

  if new.ersatz_zeiteintrag_id is not null then
    select z.kette_id, z.version, z.mandant_id into e
      from zeiteintrag z
     where z.id = new.ersatz_zeiteintrag_id and z.mandant_id = new.mandant_id;
    if not found then
      raise exception 'Die Ersatzfassung gehoert nicht zu dieser Gesellschaft'
        using errcode = 'foreign_key_violation';
    end if;
    if e.kette_id is distinct from u.kette_id then
      raise exception 'Die Ersatzfassung haengt an einer anderen Kette'
        using errcode = 'check_violation';
    end if;
    if e.version is distinct from u.version + 1 then
      raise exception 'Die Ersatzfassung ist nicht die naechste Fassung'
        using errcode = 'check_violation',
              detail  = format('Ursprung Fassung %s, Ersatz Fassung %s.', u.version, e.version);
    end if;
  end if;

  /**
   * Ein Storno setzt `storniert_am`, `storniert_von` UND den Grund — nicht nur
   * den Status.
   *
   * `z_storno_begruendet` verlangt beides, und das ist keine Formalie: eine
   * stornierte Arbeitszeit ohne Grund ist im Lohnstreit keine Auskunft. Der
   * Grund ist die Begruendung der Korrektur; sie hier ein zweites Mal
   * abzufragen hiesse, zwei Texte fuer eine Entscheidung zu fuehren.
   */
  update zeiteintrag
     set ersetzt_am = now(),
         ersetzt_durch_zeiteintrag_id = new.ersatz_zeiteintrag_id,
         status        = case when new.art = 'storno' then 'storniert' else status end,
         storniert_am  = case when new.art = 'storno' then now() else storniert_am end,
         storniert_von = case when new.art = 'storno' then new.durchgefuehrt_von
                              else storniert_von end,
         storno_grund  = case when new.art = 'storno' then new.begruendung
                              else storno_grund end
   where id = new.ursprung_zeiteintrag_id;
  return new;
end $$;

/**
 * **Die Reihenfolge der vier `BEFORE INSERT`-Ausloeser ist Teil der Regel, und
 * deshalb steht sie im Namen.**
 *
 * Postgres feuert Zeilenausloeser derselben Stufe in der alphabetischen
 * Reihenfolge ihrer NAMEN. Ohne die Ziffern lief `..._kette` vor
 * `..._nicht_selbst` und `..._sperre` — und damit war der Ursprungseintrag
 * bereits als abgeloest und storniert markiert, BEVOR ueberhaupt geprueft
 * wurde, ob der Handelnde das darf. Die Anweisung faellt zwar ganz zurueck, so
 * dass nichts falsch stehen bleibt; die Fehlermeldung nannte aber die falsche
 * Ursache („Storno ohne Grund" statt „das ist dein eigener Eintrag"), und eine
 * Fehlermeldung, die auf die falsche Faehrte fuehrt, kostet den naechsten
 * Leser eine Stunde.
 *
 * Also: erst die Uhr, dann die zwei Verbote, zuletzt die Kette, die schreibt.
 */
create trigger trg_zeiteintrag_korrektur_4_kette
  before insert on zeiteintrag_korrektur
  for each row execute function kern.korrektur_kette_pruefen();

/**
 * `zk_nicht_selbst` — der Handelnde ist nie der Betroffene (EMP-07).
 *
 * Geprueft wird ueber `benutzer.person_id`, nicht ueber die Benutzer-id: ein
 * Mensch mit zwei Beschaeftigungen hat EINEN Login, und die Frage ist, wessen
 * Zeitdatensatz das ist — nicht, mit welchem Konto jemand angemeldet war.
 */
create function kern.korrektur_nicht_selbst() returns trigger
language plpgsql as $$
declare v_betroffen uuid; v_handelnd uuid;
begin
  select z.person_id into v_betroffen
    from zeiteintrag z where z.id = new.ursprung_zeiteintrag_id;
  select b.person_id into v_handelnd
    from benutzer b where b.id = new.durchgefuehrt_von;

  if v_betroffen is not null and v_handelnd is not null and v_betroffen = v_handelnd then
    raise exception 'Niemand korrigiert seinen eigenen Zeiteintrag'
      using errcode = 'insufficient_privilege',
            detail  = 'EMP-07: der Arbeitnehmer schreibt einen zeit_einwand, '
                      || 'die Planung entscheidet.',
            hint    = 'Die Korrektur muss von einer anderen Person ausgehen.';
  end if;
  return new;
end $$;

create trigger trg_zeiteintrag_korrektur_2_nicht_selbst
  before insert on zeiteintrag_korrektur
  for each row execute function kern.korrektur_nicht_selbst();

/**
 * `zk_sperre_ausgleich` — eine Korrektur an einem GESPERRTEN Monat braucht
 * ihre Gegenbuchung (EMP-04, §12.2).
 *
 * Der gesperrte Monat aendert sich nicht: er ist abgerechnet, die Zahlen sind
 * ausgegeben worden, und ein Dokument, das nach der Ausgabe andere Zahlen
 * zeigt, ist kein Nachweis mehr. Die Differenz landet im ersten offenen
 * Monat — und dass sie dort ankommt, ist hier eine BEDINGUNG und keine Bitte:
 * ohne `ausgleich_bewegung_id` entsteht die Korrekturzeile gar nicht.
 *
 * `zeiteintrag.gesperrt_am` wird von `z_monat_sperren` gesetzt, einem
 * Ausloeser auf `stundenkonto`, den PR 37 mitbringt. Bis dahin ist die Spalte
 * immer NULL, dieser Ausloeser also wirkungslos — und das ist genau der
 * Grund, warum er JETZT entsteht: nachtraeglich eingezogen liesse er alle
 * Korrekturen durch, die zwischendurch entstanden sind.
 */
create function kern.korrektur_sperre_ausgleich() returns trigger
language plpgsql as $$
declare v_gesperrt timestamptz;
begin
  select z.gesperrt_am into v_gesperrt
    from zeiteintrag z where z.id = new.ursprung_zeiteintrag_id;

  if v_gesperrt is not null and new.ausgleich_bewegung_id is null then
    raise exception 'Der Monat dieses Zeiteintrags ist gesperrt'
      using errcode = 'check_violation',
            detail  = format('Gesperrt am %s. Eine Korrektur ohne Gegenbuchung '
                             || 'verschoebe die Differenz ins Nichts.', v_gesperrt),
            hint    = 'ausgleich_bewegung_id angeben: die Buchung im ersten '
                      || 'offenen Monat (EMP-04, §12.2).';
  end if;
  return new;
end $$;

create trigger trg_zeiteintrag_korrektur_3_sperre
  before insert on zeiteintrag_korrektur
  for each row execute function kern.korrektur_sperre_ausgleich();

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz — zeiteintrag_korrektur (§5.7)
-- ---------------------------------------------------------------------------

alter table zeiteintrag_korrektur enable row level security;
alter table zeiteintrag_korrektur force  row level security;

/**
 * Getrennt nach `SELECT` und `INSERT`, weil die Rechte verschieden sind: lesen
 * darf, wer Zeiten liest; schreiben nur, wer korrigieren darf. Eine
 * `for all`-Policy waere hier zusaetzlich falsch, weil sie einen UPDATE-Zweig
 * ergaebe, den es nicht geben darf.
 */
create policy t_mandant_lesen on zeiteintrag_korrektur for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())));

create policy t_mandant_schreiben on zeiteintrag_korrektur for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.korrigieren', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on zeiteintrag_korrektur for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * Weder `t_person` noch `t_kunde`: ob und wie der Arbeitgeber einen
 * Zeitdatensatz korrigiert hat, ist eine Arbeitgeberbewertung, und EMP-13
 * begrenzt das Portal. Der Arbeitnehmer sieht seine STUNDEN; die Spur darueber
 * bekommt er auf Auskunft, nicht als Bildschirm.
 *
 * Die K-04-Decke fuehrt ueber den korrigierten Eintrag — diese Tabelle traegt
 * selbst kein `anstellung_id`, und eine Unterabfrage ist hier vertretbar, weil
 * sie auf `zeiteintrag` zeigt, dessen eigene Decke gleichzeitig greift.
 */
create policy p_ma_decke on zeiteintrag_korrektur as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on zeiteintrag_korrektur as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- KEINE UPDATE- und KEINE DELETE-Policy — fuer niemanden, auch nicht fuer
-- `super_admin`. Zusaetzlich entzogen, damit ein Versuch am Grant scheitert
-- und nicht erst an der fehlenden Policy (die null Zeilen und ERFOLG melden
-- wuerde).
grant select, insert on zeiteintrag_korrektur to cse_app;
revoke update, delete on zeiteintrag_korrektur from cse_app;

create policy t_job on zeiteintrag_korrektur for select to cse_job using (true);
create policy t_job_frist on zeiteintrag_korrektur for update to cse_job
  using (true) with check (true);
grant select on zeiteintrag_korrektur to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on zeiteintrag_korrektur to cse_job;

-- ---------------------------------------------------------------------------
-- 5. Fremdschluessel, die eine spaetere Migration nachtraegt (§19)
-- ---------------------------------------------------------------------------

/**
 * Zwei Elternteile existieren heute nicht:
 *
 *   alter table zeiteintrag_korrektur add constraint zk_einwand_fk
 *     foreign key (mandant_id, zeit_einwand_id)
 *     references zeit_einwand (mandant_id, id);            -- PR 36, EMP-07
 *   alter table zeiteintrag_korrektur add constraint zk_ausgleich_fk
 *     foreign key (mandant_id, ausgleich_bewegung_id)
 *     references stundenkonto_bewegung (mandant_id, id);   -- PR 37, EMP-04
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0036)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeiteintrag_korrektur (append): TIM-11, LEG-01, SEC-A9. Eine Korrekturspur mit Loeschpfad ist keine. Der ganze Wert dieser Tabelle liegt darin, dass sich eine einmal aufgeschriebene Korrektur weder aendern noch entfernen laesst — auch nicht von super_admin.
create trigger trg_zeiteintrag_korrektur_kein_hard_delete
  before delete on zeiteintrag_korrektur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeiteintrag_korrektur_kein_truncate
  before truncate on zeiteintrag_korrektur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeiteintrag_korrektur from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
