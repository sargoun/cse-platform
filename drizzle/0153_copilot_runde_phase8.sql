-- 0153 · Die Befunde der Prüfrunde auf PR #14
--
-- Fünf Sorten Fehler, und keine davon war ein Geschmacksfrage:
--
--   1. Ein Eindeutigkeitsschlüssel, der den Mandanten vergisst, unterdrückt
--      die Meldung der ZWEITEN Gesellschaft (RAD-08).
--   2. Ein `revoke update` ohne `revoke insert` lässt dieselbe Spalte auf dem
--      anderen Weg herein.
--   3. Eine Definer-Funktion, die die Umkehrbarkeit dem Aufrufer glaubt, ist
--      keine Wand — TypeScript steht nicht zwischen `psql` und der Tabelle.
--   4. Eine Policy, die `agent.lesen` prüft, wo der Katalog `wissen.lesen`
--      und `wissen.vertraulich_lesen` führt, gibt Vertragstext an jemanden,
--      der ihn nicht lesen darf.
--   5. Eine Tabelle, die die Architektur `PARTITION BY LIST (mandant_id)`
--      nennt und die als Haufen entstand, lässt sich nur JETZT ohne
--      Datenumzug richtigstellen — sie ist mit Absicht leer.

-- ---------------------------------------------------------------------------
-- (1) RAD-08: eine Warnung je Gesellschaft, nicht eine je Bekanntmachung
-- ---------------------------------------------------------------------------

/**
 * **Der Schlüssel hat den Mandanten vergessen.**
 *
 * `rw_einmal` stand auf `(ausschreibung, empfaenger, art, frist)`. Eine
 * Bekanntmachung ist GLOBAL — sie gehört keiner Gesellschaft, sie wird von
 * mehreren beobachtet. Trägt dieselbe Person in zwei Gesellschaften
 * Verantwortung (es gibt sie, siehe D-09), dann quittierte die erste
 * Gesellschaft und die zweite bekam nichts: `on conflict do nothing` schluckte
 * sie, und der Lauf meldete eine Zustellung weniger, ohne zu sagen warum.
 *
 * Genau diese Sorte Fehler ist der Grund für Invariante 3: `mandant_id` gehört
 * in JEDEN Schlüssel einer Mandantentabelle, auch in den, bei dem es
 * „eigentlich egal" scheint.
 */
drop index rw_einmal;
create unique index rw_einmal on radar_warnung
  (mandant_id, ausschreibung_id, empfaenger_id, art,
   coalesce(frist_angebot, 'epoch'::timestamptz));

-- ---------------------------------------------------------------------------
-- (2) Die zweite Hälfte des Riegels aus 0152
-- ---------------------------------------------------------------------------

/**
 * **`revoke update` allein genügte nicht.**
 *
 * 0152 nahm `cse_app` das Tabellenrecht UPDATE und gab die übrigen Spalten
 * einzeln zurück — und liess `insert` aus `0012` unberührt. Ein
 * `insert into freigabe (…, verzoegerte_freigabe_bis) values (…)` ging damit
 * weiter durch: kein Risikocheck, keine Fensterprüfung, kein Protokolleintrag.
 * Ein Weg zu verschliessen und den zweiten offen zu lassen ist kein halber
 * Riegel, sondern keiner.
 */
do $$
declare v_spalten text;
begin
  select string_agg(quote_ident(attname), ', ' order by attname) into v_spalten
    from pg_attribute
   where attrelid = 'public.freigabe'::regclass
     and attnum > 0 and not attisdropped
     and attname not in ('verzoegerte_freigabe_bis', 'undo_bis');
  execute 'revoke insert on public.freigabe from cse_app';
  execute format('grant insert (%s) on public.freigabe to cse_app', v_spalten);
end $$;

-- ---------------------------------------------------------------------------
-- (3) APR-06: die Umkehrbarkeit gehört in die Datenbank
-- ---------------------------------------------------------------------------

/**
 * **Welche Vorgangsarten sich zurücknehmen lassen — die EINE Liste.**
 *
 * Sie stand in `fenster.platzhalter.ts`, also in TypeScript, also nicht
 * zwischen einem direkten Aufruf und der Tabelle: `select
 * app.freigabe_ruecknahme_fenster(id, 60)` armierte ein Fenster für einen
 * versendeten E-Mail, und die Oberfläche bot danach einen Knopf „rückgängig"
 * an, der nichts zurückholt. Ein solcher Knopf ist schlimmer als keiner.
 *
 * Die Liste steht deshalb hier, `immutable`, und TypeScript fragt sie — nicht
 * umgekehrt. Sie zu verlängern heisst zu behaupten, etwas sei umkehrbar, und
 * das ist eine Behauptung mit Folgen.
 */
create function app.freigabe_umkehrbar(p_typ agent_vorgang_typ) returns boolean
language sql immutable set search_path = pg_catalog as $$
  /*
   * **Heute: keine.** Und das ist die ehrliche Antwort, nicht eine Lücke.
   *
   * „Umkehrbar" heisst nicht „der Stand lässt sich zurücksetzen", sondern
   * „die HANDLUNG lässt sich zurückholen". Genau eine Handlung wird heute
   * ausgeführt — `eingangsrechnung_uebernehmen` legt eine Eingangsrechnung an
   * —, und für sie gibt es keinen gebauten Rückweg: im Finanzbereich wird
   * nicht hart gelöscht (Invariante 8), korrigiert wird durch Storno, und eine
   * Stornofunktion für Eingangsrechnungen existiert nicht.
   *
   * Ein Fenster für sie zu öffnen hiesse, einen Knopf „rückgängig"
   * anzubieten, der `ausfuehrung_status` umsetzt und die Rechnung stehen
   * lässt. Jemand drückt ihn und glaubt, es sei zurückgeholt — genau die
   * Sorte vorgetäuschter Erfolg, die diese Plattform bei fremden Diensten
   * nicht zulässt und bei sich selbst erst recht nicht zulassen darf.
   *
   * Der ganze Weg steht (Fenster, Recht, Frist, Protokoll, Abweisung nach
   * Ablauf); er ist für nichts armiert, bis eine Rückholung gebaut ist. Wer
   * eine baut, trägt ihre Vorgangsart hier ein — und schreibt den Test dazu.
   *
   * // TODO(client) [O-368]: Fuer welche Handlungen soll es ein
   * // Rueckgaengig geben, und was genau soll es zurueckdrehen?
   */
  select false and p_typ is not null
$$;

comment on function app.freigabe_umkehrbar(agent_vorgang_typ) is
  'APR-06, D-498, O-368. Die eine Liste umkehrbarer Vorgangsarten — heute leer, weil '
  'fuer die einzige ausgefuehrte Handlung kein Rueckweg gebaut ist. Ein Knopf, der '
  'nur den Stand umsetzt, waere ein vorgetaeuschter Erfolg.';

/**
 * Das Rücknahmefenster — jetzt mit Recht, Umkehrbarkeit und Protokoll.
 *
 * Drei Dinge fehlten: die Prüfung auf `freigabe.rueckgaengig` (im Katalog ein
 * eigenes, bindbares Recht — wer entscheiden darf, darf nicht schon
 * zurücknehmen), die Umkehrbarkeit (siehe oben) und der Protokolleintrag. Die
 * drei Nachbarfunktionen schreiben ins Protokoll; diese schrieb nichts, und
 * damit war im Nachhinein nicht zu sehen, wann das Fenster entstand.
 *
 * **Nicht umkehrbar heisst NULL, nicht Fehler.** Der Aufrufer fragt für jeden
 * ausgeführten Vorgang an; ein Fehler an dieser Stelle risse eine
 * Stapeltransaktion mit, in der neunundvierzig geprüfte Entscheidungen stehen.
 */
create or replace function app.freigabe_ruecknahme_fenster(p_freigabe uuid, p_minuten integer)
returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_bis     timestamptz;
  f         record;
begin
  if v_mandant is null then
    raise insufficient_privilege using message = 'Ohne Sitzung kein Ruecknahmefenster.';
  end if;
  select id, ausfuehrung_status, vorgang_typ, erforderliches_recht into f
    from public.freigabe where id = p_freigabe and mandant_id = v_mandant for update;
  if not found then
    raise exception 'Freigabe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht(coalesce(f.erforderliches_recht, 'freigabe.entscheiden'), v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht an dieser Freigabe.';
  end if;
  if f.ausfuehrung_status <> 'ausgefuehrt' then
    raise exception 'Ein Ruecknahmefenster gibt es erst nach der Ausfuehrung'
      using errcode = 'check_violation';
  end if;

  /* Nicht umkehrbar: kein Fenster, und das ist kein Fehler (siehe oben). */
  if f.vorgang_typ is null or not app.freigabe_umkehrbar(f.vorgang_typ) then
    return null;
  end if;

  v_bis := now() + make_interval(mins => greatest(p_minuten, 1));
  update public.freigabe set undo_bis = v_bis, geaendert_am = now() where id = p_freigabe;

  perform app.protokolliere('freigabe.ruecknahmefenster', 'freigabe', p_freigabe::text, null,
                            jsonb_build_object('bis', v_bis, 'minuten', p_minuten), v_mandant);
  return v_bis;
end $$;

comment on function app.freigabe_ruecknahme_fenster(uuid, integer) is
  'APR-06, D-498. Armiert das Ruecknahmefenster — nur nach einer Ausfuehrung und nur fuer '
  'eine umkehrbare Vorgangsart (app.freigabe_umkehrbar). NULL heisst: kein Fenster.';

alter function app.freigabe_ruecknahme_fenster(uuid, integer) owner to cse_definer;
revoke execute on function app.freigabe_ruecknahme_fenster(uuid, integer) from public;
grant execute on function app.freigabe_ruecknahme_fenster(uuid, integer) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- (4) APR-08: die Verteilung zählt Entscheidungen, nicht jedes Ereignis
-- ---------------------------------------------------------------------------

/**
 * **`korrektur` und `widerruf` sind keine Prüfungen.**
 *
 * `freigabe_snapshot.art` kennt fünf Werte. Die Verteilung zählte alle, und
 * damit standen in der Spanne „unter 3 Sekunden" auch Ereignisse, denen
 * überhaupt keine Prüfung vorausging — die Zahl, die „wird hier durchgewunken?"
 * beantworten soll, war dadurch nach oben verfälscht.
 *
 * Gezählt werden `genehmigt` und `abgelehnt`: die beiden, denen ein Mensch
 * eine Ansicht und eine Entscheidung vorausgeschickt hat. `automatisch_nach_frist`
 * gehört ausdrücklich nicht dazu — dort hat niemand geprüft, und eine
 * Prüfdauer von null Sekunden wäre keine Aussage über einen Menschen.
 */
create or replace function app.freigabe_pruefdauer_verteilung()
returns table (eimer text, anzahl bigint, davon_stapel bigint)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null then return; end if;
  if not app.hat_recht('freigabe.pruefdauer_lesen', v_mandant) then return; end if;

  return query
    select b.eimer, count(*)::bigint, count(*) filter (where b.aus_stapel)::bigint
      from (
        select case
                 when s.pruefdauer_sek is null then 'unbekannt'
                 when s.pruefdauer_sek < 3   then 'unter_3s'
                 when s.pruefdauer_sek < 10  then 'unter_10s'
                 when s.pruefdauer_sek < 60  then 'unter_60s'
                 else 'ab_60s'
               end as eimer,
               exists (select 1 from public.freigabe_ansicht a
                        where a.freigabe_id = s.freigabe_id
                          and a.benutzer_id = s.entschieden_von
                          and a.kanal = 'stapel') as aus_stapel
          from public.freigabe_snapshot s
         where s.mandant_id = v_mandant
           and s.art in ('genehmigt', 'abgelehnt')
      ) b
     group by b.eimer;
end $$;

comment on function app.freigabe_pruefdauer_verteilung() is
  'APR-08, §4.9, D-497. Die Verteilung der Pruefdauer OHNE Personenbezug, ueber die '
  'ENTSCHEIDUNGEN (genehmigt, abgelehnt) — nicht ueber Korrekturen, Widerrufe oder '
  'Fristablaeufe, denen keine Pruefung vorausging (D-498).';

alter function app.freigabe_pruefdauer_verteilung() owner to cse_definer;
revoke all on function app.freigabe_pruefdauer_verteilung() from public;
grant execute on function app.freigabe_pruefdauer_verteilung() to cse_app;

-- ---------------------------------------------------------------------------
-- (5) Der Wissensindex, wie ihn die Architektur beschreibt
-- ---------------------------------------------------------------------------

/**
 * **`PARTITION BY LIST (mandant_id)` — und warum das kein Feinschliff ist.**
 *
 * `06-RADAR-KI-INHALT.md` §1881 und §3.11 beschreiben diese Tabelle als
 * partitioniert, mit EINEM HNSW-Index je Gesellschaft. 0151 baute sie als
 * einen Haufen mit einem gemeinsamen Index, und das ist bei einer
 * Ähnlichkeitssuche etwas anderes als bei einer Liste: pgvector wählt die
 * nächsten `k` Nachbarn im Index und filtert DANACH. Die Mandantenbedingung
 * greift also erst, nachdem der Kandidatenpfad schon über fremde Verträge
 * gelaufen ist — bei `k = 10` und drei Gesellschaften bleiben womöglich drei
 * eigene Treffer übrig, und die Suche wirkt einfach schlecht. Ein Index je
 * Partition kennt die fremden Zeilen gar nicht.
 *
 * **Jetzt oder mit Datenumzug.** Die Tabelle ist mit Absicht leer (D-496), bis
 * ein Einbettungsanbieter bestätigt ist. Später wäre dasselbe eine Umkopie von
 * Millionen Vektoren.
 *
 * **`ist_aktiv` kommt mit.** Die Architektur (§1897) nennt es als das, was eine
 * Neueinbettung neben dem laufenden Betrieb erlaubt; `wc_quelle_uk` ohne
 * `embedding_modell` hätte die zweite Fassung derselben Passage abgewiesen,
 * und der Modellwechsel wäre nur mit Abschalten gegangen.
 */
drop table wissens_chunk;

create table wissens_chunk (
  mandant_id        uuid not null references mandant(id),
  id                uuid not null default gen_random_uuid(),

  quelle_typ        wissens_quelle_typ not null,
  /** Polymorph, deshalb ohne Fremdschlüssel (§7.2) — die Tabelle steht daneben. */
  quelle_id         uuid not null,
  quelle_tabelle    text not null check (quelle_tabelle ~ '^[a-z][a-z0-9_]*$'),
  dokument_id       uuid,

  chunk_index       integer not null check (chunk_index >= 0),
  /** Die eingebettete Passage — sie wird als Beleg zurückgegeben (APR-03). */
  text              text not null check (length(btrim(text)) > 0),
  seite             integer check (seite is null or seite > 0),
  token_anzahl      integer check (token_anzahl is null or token_anzahl > 0),

  embedding         vector(1536) not null,
  embedding_modell  text not null,
  embedding_dim     integer not null,

  /**
   * **Die laufende Fassung.** Eine Neueinbettung mit einem anderen Modell
   * entsteht daneben und wird in EINER Anweisung scharf geschaltet; bis dahin
   * liest die Suche weiter die alte. Ohne diese Spalte gäbe es den Wechsel nur
   * mit einer Lücke, in der die Suche nichts findet (§1897).
   */
  ist_aktiv         boolean not null default true,

  /**
   * **Vorgabe `vertraulich`, nicht `normal`.** Wer eine Passage für
   * unbedenklich hält, sagt es ausdrücklich und steht mit Namen daneben.
   */
  vertraulichkeit   vertraulichkeit not null default 'vertraulich',
  klassifiziert_von uuid references benutzer(id),
  klassifiziert_am  timestamptz,

  /** Woraus der Text stammte, als er eingebettet wurde — für den Neuaufbau. */
  quell_hash        text not null,
  inhalt_hash       text,
  eingebettet_am    timestamptz not null default now(),
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz,

  constraint wissens_chunk_pk primary key (mandant_id, id),
  constraint wc_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint wc_dimension_stimmt check (vector_dims(embedding) = embedding_dim),
  constraint wc_dimension_ist_1536 check (embedding_dim = 1536),
  /** Eine Herabstufung trägt den Namen dessen, der sie vornimmt. */
  constraint wc_klassifikation_belegt check (
    vertraulichkeit = 'vertraulich'
    or (klassifiziert_von is not null and klassifiziert_am is not null)),
  /**
   * **Das Modell gehört in den Schlüssel.** Dieselbe Passage darf in zwei
   * Modellfassungen nebeneinander liegen — das IST die Neueinbettung.
   */
  constraint wc_quelle_uk
    unique (mandant_id, quelle_typ, quelle_id, chunk_index, embedding_modell)
) partition by list (mandant_id);

create index wc_quelle_idx on wissens_chunk (mandant_id, quelle_typ, quelle_id);
create index wc_frische_idx on wissens_chunk (mandant_id, eingebettet_am desc);

comment on table wissens_chunk is
  'AGT-06. Der Vektorindex je Gesellschaft ueber Vertraege, Objekte, Angebote und '
  'Korrespondenz — PARTITION BY LIST (mandant_id), ein ANN-Index je Partition, weil '
  'pgvector erst die Nachbarn waehlt und dann filtert. Leer, solange kein '
  'Einbettungsanbieter bestaetigt ist (D-04, D-496, D-498).';
comment on column wissens_chunk.vertraulichkeit is
  'Vorgabe vertraulich. Eine Herabstufung ist eine Handlung mit Namen und Zeitpunkt.';
comment on column wissens_chunk.ist_aktiv is
  'Die laufende Modellfassung. Eine Neueinbettung entsteht daneben und wird in einer '
  'Anweisung scharf geschaltet (§1897).';

create trigger trg_wc_geaendert before update on wissens_chunk
  for each row execute function kern.setze_geaendert_am();

alter table wissens_chunk enable row level security;
alter table wissens_chunk force  row level security;

/**
 * **Lesen mit `wissen.lesen` — und `vertraulich` nur mit dem zweiten Recht.**
 *
 * 0151 prüfte `agent.lesen`. Der Katalog führt aber `wissen.lesen` UND
 * `wissen.vertraulich_lesen`, und die Vorgabe jeder Passage ist
 * `vertraulich`: mit der alten Policy bekam jede Sitzung mit Agentenzugang den
 * vollen Vertragstext. Zwei Rechte, die es gibt und die niemand prüft, sind
 * schlimmer als keine — sie sehen wie ein Riegel aus.
 *
 * Es gibt hier weiterhin mit Absicht KEINE `t_gruppe`-Policy: „zeig mir
 * ähnliche Klauseln" wäre gruppenweit „zeig mir den Vertrag der Schwester".
 */
create policy t_wissen_lesen on wissens_chunk for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('wissen.lesen', app.aktiver_mandant())
         and (vertraulichkeit = 'normal'
              or app.hat_recht('wissen.vertraulich_lesen', app.aktiver_mandant())));
create policy p_intern_ceiling on wissens_chunk as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/** Gebaut wird der Index vom Job, nie von der Anwendungsrolle. */
create policy j_wissens_chunk on wissens_chunk for all to cse_job
  using (true) with check (true);

grant select on wissens_chunk to cse_app;
grant select, insert, update, delete on wissens_chunk to cse_job;

/**
 * **Die Herabstufung geht nur durch die Funktion.**
 *
 * 0151 gab `cse_app` das Schreibrecht auf `klassifiziert_von` und
 * `klassifiziert_am` mit — also auf die Angabe, WER die Passage freigegeben
 * hat und WANN. Wer herabstufen darf, konnte die Entscheidung damit einem
 * anderen Namen und einem beliebigen Zeitpunkt zuschreiben. Das ist dieselbe
 * Form wie D-07 bei der Einreichung: der Mensch kommt aus der Sitzung, der
 * Zeitpunkt aus `now()`, und die Spalten sind der Anwendung entzogen.
 */
grant update (vertraulichkeit, geaendert_am) on wissens_chunk to cse_app;
create policy t_wissen_klassifizieren on wissens_chunk for update to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()));

create function app.wissen_klassifizieren(p_chunk uuid, p_stufe vertraulichkeit)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_ich     uuid := app.aktueller_benutzer();
begin
  if v_mandant is null or v_ich is null then
    raise insufficient_privilege using message = 'Ohne Sitzung keine Einstufung.';
  end if;
  if app.ist_readonly() then
    raise insufficient_privilege using message = 'Die Gruppenansicht stuft nicht ein.';
  end if;
  if not app.hat_recht('agent.werkzeug_verbinden', v_mandant) then
    raise insufficient_privilege using message = 'Kein Recht auf die Einstufung.';
  end if;

  update public.wissens_chunk
     set vertraulichkeit = p_stufe,
         klassifiziert_von = case when p_stufe = 'normal' then v_ich end,
         klassifiziert_am  = case when p_stufe = 'normal' then now() end,
         geaendert_am = now()
   where id = p_chunk and mandant_id = v_mandant;
  if not found then
    raise exception 'Passage nicht gefunden' using errcode = 'no_data_found';
  end if;

  perform app.protokolliere('wissen.eingestuft', 'wissens_chunk', p_chunk::text, null,
                            jsonb_build_object('stufe', p_stufe, 'von', v_ich), v_mandant);
  return true;
end $$;

comment on function app.wissen_klassifizieren(uuid, vertraulichkeit) is
  'AGT-06, D-498. Der einzige Weg zur Herabstufung: der Mensch kommt aus der SITZUNG, '
  'der Zeitpunkt aus now() — beide Spalten sind cse_app entzogen.';

alter function app.wissen_klassifizieren(uuid, vertraulichkeit) owner to cse_definer;
revoke execute on function app.wissen_klassifizieren(uuid, vertraulichkeit) from public;
grant execute on function app.wissen_klassifizieren(uuid, vertraulichkeit) to cse_app;

/**
 * **Eine neue Gesellschaft ist eine Zeile, kein Codeeingriff** (TEN-08).
 *
 * Die Partition einer partitionierten Tabelle entsteht nicht von selbst. Ohne
 * diesen Haken schlüge der erste Aufbau des Index für eine fünfte
 * Gesellschaft mit „no partition of relation found" fehl — und zwar nachts, im
 * Job, nicht beim Anlegen. Also legt das Anlegen sie mit an.
 *
 * Der ANN-Index entsteht bewusst NICHT hier: er gehört in den Schritt, in dem
 * der erste echte Aufbau läuft, und dann mit Parametern zur Zeilenzahl
 * (§3.11). Eine leere Partition bekommt keinen HNSW-Index, der nur
 * Schreibzeit für Daten kostet, die es nicht gibt.
 */
create function app.mandant_domaene_einrichten(p_mandant uuid) returns void
language plpgsql set search_path = pg_catalog, public, app as $$
declare v_name text := 'wissens_chunk_' || replace(p_mandant::text, '-', '');
begin
  if to_regclass('public.' || quote_ident(v_name)) is null then
    execute format(
      'create table public.%I partition of public.wissens_chunk for values in (%L)',
      v_name, p_mandant);
    /*
     * **Auch die Partition trägt RLS.** Eine Policy am Elternteil greift,
     * wenn über den Elternteil gefragt wird — und eine Partition ohne eigenes
     * `row level security` wäre die Tabelle, auf der die Regel fehlt, sobald
     * jemand sie direkt anspricht. Der Strukturtest prüft genau das, und zu
     * Recht: „gilt schon über den Elternteil" ist die Sorte Annahme, die bei
     * der ersten direkten Abfrage bricht.
     */
    execute format('alter table public.%I enable row level security', v_name);
    execute format('alter table public.%I force  row level security', v_name);
  end if;
  /* Der Kettenkopf entsteht ohnehin faul in app.freigabe_kette_ziehen (0012);
     hier steht er, damit eine neue Gesellschaft ihn von Anfang an hat. */
  insert into public.freigabe_kette (mandant_id) values (p_mandant)
    on conflict (mandant_id) do nothing;
end $$;

comment on function app.mandant_domaene_einrichten(uuid) is
  'TEN-08, AGT-06, APR-07. Der eine AFTER-INSERT-Haken an mandant: Wissenspartition '
  'und Kettenkopf. Eine fuenfte Gesellschaft ist eine Zeile, kein Codeeingriff.';

/**
 * **Kein `security definer` — mit Absicht, und ohne Verlust.**
 *
 * Eine Partition anzulegen ist DDL: sie verlangt `create` auf dem Schema UND
 * das Eigentum an der Elterntabelle. `cse_definer` hat beides nicht, und es
 * ihm zu geben hiesse, der Rolle, die hinter jeder Definer-Funktion steht,
 * das Anlegen beliebiger Tabellen zu erlauben — ein hoher Preis für einen
 * Haken, der viermal im Leben feuert.
 *
 * Er kostet auch nichts: `mandant` ist weder für `cse_app` noch für `cse_job`
 * beschreibbar (geprüft), eine Gesellschaft legt also ohnehin nur der
 * Eigentümer an. Der Haken läuft mit dessen Rechten, und das ist genau die
 * Rolle, die eine Partition anlegen darf. Die Regel „Definer-Funktionen
 * gehören `cse_definer`" bleibt unberührt — diese hier ist keine.
 */
revoke execute on function app.mandant_domaene_einrichten(uuid) from public;

create function kern.mandant_domaene_anlegen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  perform app.mandant_domaene_einrichten(new.id);
  return null;
end $$;

revoke execute on function kern.mandant_domaene_anlegen() from public;

create trigger trg_mandant_domaene after insert on mandant
  for each row execute function kern.mandant_domaene_anlegen();

/** Die vier Gesellschaften, die es schon gibt, bekommen ihre Partition jetzt. */
do $$
declare m record;
begin
  for m in select id from public.mandant loop
    perform app.mandant_domaene_einrichten(m.id);
  end loop;
end $$;
