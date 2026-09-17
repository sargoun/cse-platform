-- ===========================================================================
-- 0204 — kern.audit_kette und kern.audit_kettenglied: die Hashkette ueber
--        das Pruefprotokoll, und der Buendel-Lesepfad fuer Vorher/Nachher
--        (01-KERN §6.12, §9.1, SEC-A9, LEG-01, ACC-06, FIN-06, DOC-08)
--
-- **Warum die Kette in EIGENEN Tabellen liegt und nicht in Spalten auf
-- `audit_log`.** §9 beschreibt `kette_id`, `ketten_nr`, `vorheriger_hash` und
-- `hash` als Spalten des Protokolls, gezogen in `app.protokolliere()` unter
-- `SELECT … FOR UPDATE`. Umgesetzt ist eine ANDERE Bauart, und zwar aus zwei
-- nachrechenbaren Gruenden:
--
--  1. **`audit_log` ist heute anfuegend OHNE jeden Schreibpfad** — keine
--     UPDATE-Policy, kein UPDATE-Grant, fuer niemanden. Spalten
--     nachzutragen, die nachtraeglich gefuellt werden muessen, verlangte
--     genau diesen Schreibpfad. Ein Protokoll, an dem man Zeilen aendern
--     kann, bezeugt weniger als eines, an dem man es nicht kann — auch wenn
--     die Aenderung nur einen Hash setzt.
--  2. **Der Kettenkopf in `app.protokolliere()` waere eine Sperre im
--     heissesten Pfad der Plattform.** Jeder Trigger jeder Domaene laeuft
--     durch diese Funktion. Eine Zeilensperre, die bis zum Commit gehalten
--     wird, serialisiert jede schreibende Transaktion — und sie erzeugt eine
--     Sperrreihenfolge gegen die Zaehlerzeilen in `nummernkreis` und
--     `freigabe_kette`: eine Transaktion, die zuerst protokolliert und dann
--     eine Nummer zieht, verklemmt mit einer, die es umgekehrt tut. Diese
--     Umkehrung ist im Bestand nicht auszuschliessen, und ein Deadlock im
--     Auditpfad trifft jeden Vorgang.
--
-- Umgesetzt ist deshalb ein **anfuegendes Kettenbuch NEBEN dem Protokoll**:
-- `kern.audit_kettenglied` traegt je Protokollzeile ihre Position, ihren
-- Vorgaengerhash und ihren Hash; `audit_log` wird nicht angefasst. Die
-- Fortschreibung laeuft unter `system.audit_exportieren` — also genau dann,
-- wenn ein Beweismittel gebildet wird — und nimmt dabei alles mit, was seit
-- dem letzten Mal dazugekommen ist. Was gekettet ist, ist danach
-- nachrechenbar; was noch nicht gekettet ist, SAGT das Manifest, statt es zu
-- verschweigen. Beides ist ehrlicher als das Wort „revisionssicher" ohne
-- Deckung.
--
-- **Das Tor fuer Vorher/Nachher ist `system.audit_sensitiv_lesen`, nicht
-- `system.audit_exportieren`.** 05-API-KARTE Z. 369/591 und
-- 03-AUTH-BERECHTIGUNGEN Z. 2342 binden die Nutzlast ausdruecklich an das
-- erste Recht; `cse_app` haelt auf `audit_log.vorher`/`nachher` ueberhaupt
-- keinen Spaltengrant. `app.audit_nutzlast_lesen` (0139) loest das schon —
-- aber ZEILENWEISE und mit einer eigenen Protokollzeile je Aufruf: ein
-- Buendel ueber 5000 Zeilen schrieb 5000 zusaetzliche Auditzeilen und
-- dokumentierte damit sich selbst zu Tode. `app.audit_nutzlast_buendel`
-- unten ist dieselbe Pruefung als MENGE, mit EINER Protokollzeile fuer den
-- einen Abruf.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Kettenkopf (§6.12)
-- ---------------------------------------------------------------------------

create table kern.audit_kette (
  id uuid not null default gen_random_uuid(),
  /**
   * Eine Kette je Monat, damit die Serialisierung nicht ueber zehn Jahre auf
   * eine einzige Zeile laeuft (§6.12). Der Name folgt der Partitionsbenennung
   * aus §6.11 (`audit_log_2026_09`) und wird in UTC gebildet — derselbe
   * Zeitbegriff, in dem `erstellt_am` gespeichert ist (Invariante 2).
   */
  partition text not null,
  letzte_nr bigint not null default 0,
  letzter_hash text,
  /**
   * Der letzte Hash der Vormonatskette ist der Startwert dieser, sodass die
   * Ketten EINE durchgehende Kette bilden (§6.12). Ohne diesen Verweis
   * koennte ein ganzer Monat entfernt werden, ohne dass eine Kette bricht.
   */
  vorgaenger_kette_id uuid references kern.audit_kette(id),
  /** Letzte erfolgreiche Verifikation. */
  geprueft_am timestamptz,
  /**
   * Die Position, an der die letzte Pruefung einen Bruch fand — `null` heisst
   * „kein Bruch bekannt", nicht „nie geprueft" (das sagt `geprueft_am`).
   */
  gebrochen_bei bigint,
  erstellt_am timestamptz not null default now(),

  constraint audit_kette_pk primary key (id),
  constraint audit_kette_partition_uk unique (partition),
  constraint ak_partition_form check (partition ~ '^audit_log_\d{4}_\d{2}$'),
  constraint ak_nr_nicht_negativ check (letzte_nr >= 0),
  constraint ak_hash_form check (letzter_hash is null or letzter_hash ~ '^[0-9a-f]{64}$'),
  /** Eine leere Kette hat keinen Hash, eine gefuellte hat einen. */
  constraint ak_hash_paarweise check ((letzte_nr = 0) = (letzter_hash is null))
);

comment on table kern.audit_kette is
  '§6.12: der Kettenkopf je Monatspartition des Protokolls. Fortgeschrieben '
  'ausschliesslich von app.audit_kette_fortschreiben (K-08-Muster, kein cse_app-Grant).';

-- ---------------------------------------------------------------------------
-- 2. Das Kettenbuch — ein Glied je Protokollzeile
-- ---------------------------------------------------------------------------

create table kern.audit_kettenglied (
  kette_id  uuid   not null references kern.audit_kette(id),
  ketten_nr bigint not null,
  /**
   * Die Protokollzeile, die dieses Glied bezeugt. Mit Fremdschluessel: ein
   * Glied ohne Zeile waere ein Hash ueber nichts, und `audit_log` kennt
   * keinen Loeschpfad (Invariante 8), also kann der Schluessel nie ins Leere
   * zeigen.
   */
  audit_id  bigint not null references audit_log(id),
  vorheriger_hash text,
  /** `SHA256(kanonische Nutzlast ‖ vorheriger_hash)` — Invariante-4-Muster. */
  hash text not null,
  erstellt_am timestamptz not null default now(),

  constraint audit_kettenglied_pk primary key (kette_id, ketten_nr),
  constraint audit_kettenglied_audit_uk unique (audit_id),
  constraint akg_nr_positiv check (ketten_nr >= 1),
  constraint akg_hash_form check (hash ~ '^[0-9a-f]{64}$'),
  constraint akg_vorhash_form check (
    vorheriger_hash is null or vorheriger_hash ~ '^[0-9a-f]{64}$')
);

comment on table kern.audit_kettenglied is
  '§9.1: je Protokollzeile ihre Kettenposition und ihr Hash. Anfuegend; '
  'audit_log selbst wird nicht angefasst (siehe Kopf der Migration 0204).';

-- ---------------------------------------------------------------------------
-- 3. Loeschsperre von Hand (die Tabellen liegen in `kern`)
-- ---------------------------------------------------------------------------

/**
 * **Warum diese vier Trigger hier stehen und nicht im generierten Block.**
 * `scripts/generate-triggers.ts` bildet den Triggernamen aus dem
 * Tabellennamen (`trg_${tabelle}_kein_hard_delete`). Bei einem
 * schemaqualifizierten Namen entstuende `trg_kern.audit_kette_…` — kein
 * gueltiger Bezeichner. Beide Tabellen stehen deshalb in
 * `rls.ts.NUR_UEBER_DEFINER` (kein Grant, keine `cse_app`-Policy) und tragen
 * ihre Sperre hier, mit gueltigen Namen und derselben Funktion.
 */
create trigger trg_audit_kette_kein_hard_delete
  before delete on kern.audit_kette
  for each row execute function kern.verhindere_loeschung();
create trigger trg_audit_kette_kein_truncate
  before truncate on kern.audit_kette
  for each statement execute function kern.verhindere_loeschung();

create trigger trg_audit_kettenglied_kein_hard_delete
  before delete on kern.audit_kettenglied
  for each row execute function kern.verhindere_loeschung();
create trigger trg_audit_kettenglied_kein_truncate
  before truncate on kern.audit_kettenglied
  for each statement execute function kern.verhindere_loeschung();

alter table kern.audit_kette      enable row level security;
alter table kern.audit_kette      force  row level security;
alter table kern.audit_kettenglied enable row level security;
alter table kern.audit_kettenglied force  row level security;

/**
 * KEIN Grant fuer `cse_app`, `cse_job`, `cse_anon`, `cse_checkin` und keine
 * Policy fuer sie (K-08-Muster wie `freigabe_kette`): der Kettenkopf darf von
 * aussen nicht bewegbar sein. Eine Kette, deren Kopf jemand verstellen kann,
 * bezeugt nichts.
 */
create policy d_audit_kette on kern.audit_kette for all to cse_definer
  using (true) with check (true);
create policy d_audit_kettenglied on kern.audit_kettenglied for all to cse_definer
  using (true) with check (true);

grant select, insert, update on kern.audit_kette to cse_definer;
grant select, insert on kern.audit_kettenglied to cse_definer;

-- ---------------------------------------------------------------------------
-- 4. Der Definer-Lesepfad auf `audit_log`
-- ---------------------------------------------------------------------------

/**
 * `audit_log` traegt FORCE RLS und genau eine Policy — `t_audit_lesen` fuer
 * `cse_app`. Eine `cse_definer`-eigene Funktion (K-01) liest damit NULL
 * Zeilen und berechnete stillschweigend eine leere Kette: der klassische
 * Definer-Fehler, den `definer-eigentum.test.ts` beschreibt. Lesen, nicht
 * schreiben — `audit_log` bleibt unveraenderlich.
 */
create policy d_audit_lesen on audit_log for select to cse_definer using (true);
grant select on audit_log to cse_definer;

-- ---------------------------------------------------------------------------
-- 5. app.audit_kette_fortschreiben — der EINE Schreiber der Kette
-- ---------------------------------------------------------------------------

/**
 * Kettet jede noch nicht gekettete Protokollzeile, aelteste zuerst.
 *
 * **Die Reihenfolge ist `(erstellt_am, id)` und nicht `id`.** `id` ist eine
 * Identity-Spalte; zwei gleichzeitige Transaktionen bekommen ihre Nummern in
 * der Reihenfolge des Ziehens, committen aber moeglicherweise umgekehrt. Fuer
 * die Kette zaehlt die ZEIT der Zeile, und `id` entscheidet nur den
 * Gleichstand — sonst haetten zwei Laeufe verschiedene Ketten ueber
 * dieselben Zeilen, und beide waeren „gueltig".
 *
 * **Das Tor ist `system.audit_exportieren`.** Die Kette entsteht, wenn ein
 * Beweismittel gebildet wird; wer kein Beweismittel bilden darf, schreibt
 * auch keine Kette. Ohne das Recht: 0, kein Fehler — der Aufrufer ist der
 * Buendeldienst, und ein Wurf hier machte aus einer fehlenden Berechtigung
 * einen Serverfehler statt eines leeren Buendels.
 */
create function app.audit_kette_fortschreiben(p_grenze integer default 20000)
  returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_zeile record;
  v_partition text;
  v_kette kern.audit_kette;
  v_prev text;
  v_nr bigint;
  v_hash text;
  v_anzahl integer := 0;
begin
  if not app.hat_recht('system.audit_exportieren') then return 0; end if;
  /**
   * **Und nicht in der Gruppenansicht** (Invariante 10).
   *
   * `system.audit_exportieren` traegt die Aktion `exportieren`, und
   * `app.hat_recht_fuer` laesst `lesen` und `exportieren` in der
   * Gruppenansicht ausdruecklich durch — richtig fuer einen Export, falsch
   * fuer diese Funktion: sie SCHREIBT Kettenglieder. Ein Super-Admin mit
   * globaler Rolle kaeme ueber den Rechtezweig durch und schriebe in einer
   * Ansicht, die nur lesen darf. Das Tor dagegen ist `app.ist_readonly`.
   */
  if app.ist_readonly() then return 0; end if;

  for v_zeile in
    select a.id, a.mandant_id, a.ebene, a.akteur_typ, a.akteur_id, a.agent_id,
           a.aktion, a.objekt_typ, a.objekt_id, a.vorher, a.nachher,
           a.geaendert_felder, a.ip, a.sitzung_id, a.erstellt_am,
           'audit_log_' || to_char(a.erstellt_am at time zone 'UTC', 'YYYY_MM') as part
      from public.audit_log a
     where not exists (select 1 from kern.audit_kettenglied g where g.audit_id = a.id)
     order by a.erstellt_am, a.id
     limit p_grenze
  loop
    if v_partition is null or v_partition <> v_zeile.part then
      v_partition := v_zeile.part;
      /*
       * Der Kopf unter `FOR UPDATE`: zwei gleichzeitige Buendel wuerden die
       * Kette sonst gabeln. Gesperrt wird EINE Zeile je Monat, und nur im
       * Exportpfad — nicht in `app.protokolliere` (siehe Kopf).
       */
      select * into v_kette from kern.audit_kette k
       where k.partition = v_partition for update;
      if not found then
        insert into kern.audit_kette (partition, vorgaenger_kette_id)
        values (v_partition,
                (select k2.id from kern.audit_kette k2
                  where k2.partition < v_partition
                  order by k2.partition desc limit 1))
        returning * into v_kette;
        /* Der Startwert ist der letzte Hash der Vormonatskette (§6.12). */
        select k2.letzter_hash into v_prev from kern.audit_kette k2
         where k2.id = v_kette.vorgaenger_kette_id;
      else
        v_prev := v_kette.letzter_hash;
      end if;
      v_nr := v_kette.letzte_nr;
    end if;

    v_nr := v_nr + 1;
    /*
     * Die kanonische Nutzlast: jedes Feld, das Beweiswert traegt, mit
     * festem Trenner und festem Zeitformat in UTC. `jsonb::text` ist
     * normalisiert (Schluessel sortiert), also stabil ueber Laeufe.
     * `convert_to(…, 'UTF8')` und nicht `::text`: pgcrypto hasht Bytes, und
     * die Bytes einer Zeichenkette haengen sonst an der Serverkodierung.
     */
    v_hash := encode(digest(convert_to(
      coalesce(v_prev, '')
      || '|' || v_zeile.id::text
      || '|' || coalesce(v_zeile.mandant_id::text, '')
      || '|' || v_zeile.ebene::text
      || '|' || v_zeile.akteur_typ::text
      || '|' || coalesce(v_zeile.akteur_id::text, '')
      || '|' || coalesce(v_zeile.agent_id::text, '')
      || '|' || v_zeile.aktion
      || '|' || v_zeile.objekt_typ
      || '|' || coalesce(v_zeile.objekt_id, '')
      || '|' || coalesce(v_zeile.vorher::text, '')
      || '|' || coalesce(v_zeile.nachher::text, '')
      || '|' || coalesce(array_to_string(v_zeile.geaendert_felder, ','), '')
      || '|' || coalesce(v_zeile.ip::text, '')
      || '|' || coalesce(v_zeile.sitzung_id::text, '')
      || '|' || to_char(v_zeile.erstellt_am at time zone 'UTC',
                        'YYYY-MM-DD HH24:MI:SS.US'),
      'UTF8'), 'sha256'), 'hex');

    insert into kern.audit_kettenglied (kette_id, ketten_nr, audit_id, vorheriger_hash, hash)
    values (v_kette.id, v_nr, v_zeile.id, v_prev, v_hash);

    update kern.audit_kette
       set letzte_nr = v_nr, letzter_hash = v_hash
     where id = v_kette.id;

    v_prev := v_hash;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end $$;

alter function app.audit_kette_fortschreiben(integer) owner to cse_definer;
revoke execute on function app.audit_kette_fortschreiben(integer) from public;
grant execute on function app.audit_kette_fortschreiben(integer) to cse_app, cse_job;

comment on function app.audit_kette_fortschreiben(integer) is
  '§9.1: kettet jede noch nicht gekettete Protokollzeile, aelteste zuerst. '
  'Verlangt system.audit_exportieren; ohne das Recht 0. Gibt die Zahl der Glieder zurueck.';

-- ---------------------------------------------------------------------------
-- 6. app.audit_kette_pruefen — die Gegenprobe
-- ---------------------------------------------------------------------------

/**
 * Rechnet jedes Glied einer Kette nach und gibt die ERSTE Abweichung zurueck.
 *
 * Ohne Gegenprobe ist eine Hashkette eine Behauptung: sie faellt nur auf,
 * wenn jemand nachrechnet. Gibt `null` als `bruch_bei` zurueck, wenn die
 * Kette geschlossen ist, und setzt dann `geprueft_am`.
 */
create function app.audit_kette_pruefen(p_partition text)
  returns table (glieder bigint, bruch_bei bigint, kopf_hash text)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_kette kern.audit_kette;
  v_zeile record;
  v_prev text;
  v_hash text;
  v_bruch bigint := null;
  v_anzahl bigint := 0;
begin
  if not app.hat_recht('system.audit_exportieren') then return; end if;

  select * into v_kette from kern.audit_kette k where k.partition = p_partition;
  if not found then return; end if;
  /*
   * Die Pruefung selbst SCHREIBT ihren Befund (`geprueft_am`,
   * `gebrochen_bei`) — also nicht in der Gruppenansicht (Invariante 10,
   * dieselbe Begruendung wie bei `fortschreiben`).
   */
  if app.ist_readonly() then return; end if;

  select k2.letzter_hash into v_prev from kern.audit_kette k2
   where k2.id = v_kette.vorgaenger_kette_id;

  for v_zeile in
    select g.ketten_nr, g.vorheriger_hash, g.hash,
           a.id, a.mandant_id, a.ebene, a.akteur_typ, a.akteur_id, a.agent_id,
           a.aktion, a.objekt_typ, a.objekt_id, a.vorher, a.nachher,
           a.geaendert_felder, a.ip, a.sitzung_id, a.erstellt_am
      from kern.audit_kettenglied g
      join public.audit_log a on a.id = g.audit_id
     where g.kette_id = v_kette.id
     order by g.ketten_nr
  loop
    v_anzahl := v_anzahl + 1;
    v_hash := encode(digest(convert_to(
      coalesce(v_prev, '')
      || '|' || v_zeile.id::text
      || '|' || coalesce(v_zeile.mandant_id::text, '')
      || '|' || v_zeile.ebene::text
      || '|' || v_zeile.akteur_typ::text
      || '|' || coalesce(v_zeile.akteur_id::text, '')
      || '|' || coalesce(v_zeile.agent_id::text, '')
      || '|' || v_zeile.aktion
      || '|' || v_zeile.objekt_typ
      || '|' || coalesce(v_zeile.objekt_id, '')
      || '|' || coalesce(v_zeile.vorher::text, '')
      || '|' || coalesce(v_zeile.nachher::text, '')
      || '|' || coalesce(array_to_string(v_zeile.geaendert_felder, ','), '')
      || '|' || coalesce(v_zeile.ip::text, '')
      || '|' || coalesce(v_zeile.sitzung_id::text, '')
      || '|' || to_char(v_zeile.erstellt_am at time zone 'UTC',
                        'YYYY-MM-DD HH24:MI:SS.US'),
      'UTF8'), 'sha256'), 'hex');
    if v_hash <> v_zeile.hash
       or coalesce(v_zeile.vorheriger_hash, '') <> coalesce(v_prev, '') then
      v_bruch := v_zeile.ketten_nr;
      exit;
    end if;
    v_prev := v_zeile.hash;
  end loop;

  update kern.audit_kette
     set geprueft_am = case when v_bruch is null then now() else geprueft_am end,
         gebrochen_bei = v_bruch
   where id = v_kette.id;

  return query select v_anzahl, v_bruch, v_kette.letzter_hash;
end $$;

alter function app.audit_kette_pruefen(text) owner to cse_definer;
revoke execute on function app.audit_kette_pruefen(text) from public;
grant execute on function app.audit_kette_pruefen(text) to cse_app, cse_job;

comment on function app.audit_kette_pruefen(text) is
  '§9.1: rechnet eine Kette nach und gibt die erste Abweichung zurueck. '
  'Verlangt system.audit_exportieren.';

-- ---------------------------------------------------------------------------
-- 7. app.audit_nutzlast_buendel — Vorher/Nachher als MENGE, mit EINER Spur
-- ---------------------------------------------------------------------------

/**
 * Die Nutzlasten eines Zeitraums, fuer das Beweismittelbuendel.
 *
 * **Zwei Rechte, und beide muessen gehalten werden.**
 * `system.audit_exportieren` ist das Recht der Route (04-SEITENKARTE
 * Z. 1917); `system.audit_sensitiv_lesen` ist das Recht der WERTE
 * (05-API-KARTE Z. 369/591, 03-AUTH-BERECHTIGUNGEN Z. 2342). Wer nur das
 * erste haelt, bekommt ein redigiertes Buendel und den Satz, warum — nicht
 * eines, das aussieht, als sei nichts geaendert worden.
 *
 * **Nur `ebene = 'mandant'` des AKTIVEN Bereichs.** Plattformzeilen gehoeren
 * nie in ein Mandantenbuendel (K-16(d), 04-SEITENKARTE Z. 1950-1957) — sie
 * betreffen Anmeldungen, Sperren und Mandantenanlagen, also andere
 * Gesellschaften mit.
 *
 * **EINE Protokollzeile fuer den einen Abruf.** `app.audit_nutzlast_lesen`
 * (0139) schreibt eine je Zeile; ueber ein Jahresbuendel waeren das
 * Zehntausende, und der naechste Export traegt sie mit. Ein Protokoll, das
 * ueberwiegend sein eigenes Lesen protokolliert, ist unlesbar.
 */
create function app.audit_nutzlast_buendel(p_von timestamptz, p_bis timestamptz)
  returns table (audit_id bigint, vorher jsonb, nachher jsonb)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant(); v_anzahl bigint;
begin
  if v_mandant is null then return; end if;
  if not app.hat_recht('system.audit_exportieren', v_mandant) then return; end if;
  if not app.hat_recht('system.audit_sensitiv_lesen', v_mandant) then return; end if;

  select count(*) into v_anzahl
    from public.audit_log a
   where a.mandant_id = v_mandant
     and a.ebene = 'mandant'
     and a.erstellt_am >= p_von and a.erstellt_am < p_bis
     and (a.vorher is not null or a.nachher is not null);

  perform app.protokolliere(
    'audit.nutzlast_buendel_gelesen', 'audit_log', null, null,
    jsonb_build_object('von', p_von, 'bis', p_bis, 'zeilen', v_anzahl),
    v_mandant);

  return query
    select a.id, a.vorher, a.nachher
      from public.audit_log a
     where a.mandant_id = v_mandant
       and a.ebene = 'mandant'
       and a.erstellt_am >= p_von and a.erstellt_am < p_bis
       and (a.vorher is not null or a.nachher is not null)
     order by a.erstellt_am, a.id;
end $$;

alter function app.audit_nutzlast_buendel(timestamptz, timestamptz) owner to cse_definer;
revoke execute on function app.audit_nutzlast_buendel(timestamptz, timestamptz) from public;
grant execute on function app.audit_nutzlast_buendel(timestamptz, timestamptz) to cse_app;

comment on function app.audit_nutzlast_buendel(timestamptz, timestamptz) is
  'DOC-08: Vorher/Nachher eines Zeitraums als Menge, nur ebene=mandant des aktiven '
  'Bereichs. Verlangt system.audit_exportieren UND system.audit_sensitiv_lesen; '
  'schreibt EINE Protokollzeile fuer den Abruf.';

-- ---------------------------------------------------------------------------
-- 8. app.audit_kette_deckung — was das Manifest ueber die Kette sagen darf
-- ---------------------------------------------------------------------------

/**
 * Wieviele Protokollzeilen des Zeitraums gekettet sind, und welche Ketten sie
 * beruehren. Das Manifest nennt diese Zahlen, statt „revisionssicher" zu
 * behaupten: eine ungekettete Zeile ist keine Luecke im Beweis, sie ist ein
 * Beweis, der noch nicht gebildet ist — und der Unterschied gehoert dem
 * Pruefer, nicht der Software.
 */
create function app.audit_kette_deckung(p_von timestamptz, p_bis timestamptz)
  returns table (zeilen bigint, gekettet bigint, ketten text[])
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null then return; end if;
  if not app.hat_recht('system.audit_exportieren', v_mandant) then return; end if;

  return query
    select count(*)::bigint,
           count(g.audit_id)::bigint,
           coalesce(array_agg(distinct k.partition) filter (where k.partition is not null),
                    '{}'::text[])
      from public.audit_log a
      left join kern.audit_kettenglied g on g.audit_id = a.id
      left join kern.audit_kette k on k.id = g.kette_id
     where a.mandant_id = v_mandant
       and a.ebene = 'mandant'
       and a.erstellt_am >= p_von and a.erstellt_am < p_bis;
end $$;

alter function app.audit_kette_deckung(timestamptz, timestamptz) owner to cse_definer;
revoke execute on function app.audit_kette_deckung(timestamptz, timestamptz) from public;
grant execute on function app.audit_kette_deckung(timestamptz, timestamptz) to cse_app;

comment on function app.audit_kette_deckung(timestamptz, timestamptz) is
  'DOC-08: Zeilen und davon gekettete Zeilen eines Zeitraums, plus die beruehrten '
  'Ketten. Grundlage des Satzes im Manifest; verlangt system.audit_exportieren.';
