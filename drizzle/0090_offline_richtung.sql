-- ===========================================================================
-- 0090 — die Richtung eines nachgereichten Stempels steht in der MARKE,
--        nicht im Geraet
--        (04-PLANUNG-ZEIT.md §5.5, §5.9, §5.13, §9; TIM-08, TIM-09;
--         Invariante 5; K-01)
--
-- **Der Befund.** Die Stempelflaeche legte JEDEN offline gemerkten Stempel
-- als `checkin` in die Warteschlange, und `app.offline_ereignis_annehmen`
-- uebernahm `art` woertlich aus der Nutzlast. Ein SchichtENDE, das im
-- Funkloch getippt wurde, erschien der Planung damit als SchichtBEGINN —
-- nichts wirft, nichts faellt rot, es steht eine plausible Falschaussage in
-- genau der Tabelle, die im Lohnstreit vorgelegt wird.
--
-- **Drei Entscheidungen:**
--
--  1. **Nicht raten, sondern lesen.** Der naheliegende Entwurf liesse das
--     Geraet die Richtung ableiten — aus der zuletzt bestaetigten Richtung
--     plus den seither eingereihten Stempeln. Das waere eine Vermutung, und
--     sie ist ueberfluessig: 0035 gibt JE BEIN eine eigene Marke aus
--     (`zweck ∈ {checkin, checkout}`, §5.5 Nr. 3), und
--     `app.checkin_verbrauchen` entscheidet Beginn oder Ende allein an
--     `t.zweck`. Diese Funktion LAS `ct.zweck` bereits in `t` und warf ihn
--     weg. Die Richtung musste nie erraten werden, sie musste gelesen
--     werden — und zwar dort, wo sie serverseitig entstanden ist.
--
--     Das repariert zugleich, was schon auf den Telefonen liegt: eine
--     Warteschlange, die eine aeltere Fassung der Flaeche mit `checkin`
--     gefuellt hat, wird beim Nachreichen richtig eingeordnet, ohne dass
--     jemand etwas loeschen muss.
--
--  2. **`unbekannt` fuer den Fall, in dem es wirklich niemand weiss.** Loest
--     die Marke nicht auf — widerrufen, Zuordnung entfernt, Hash unbekannt —,
--     faellt die Einreichung in den Vorbereich (§5.13), und dann kennt auch
--     der Server die Richtung nicht. Der Enum bekommt dafuer einen Wert. Das
--     Geraet sagt ihn von sich aus, weil es ihn nie weiss: die Flaeche ist
--     EIN Knopf und loest die Marke bewusst nicht auf (AUT-06, §9.2). Ein
--     ersatzweise gesetztes `checkin` waere an dieser Stelle die bequemste
--     Luege.
--
--  3. **Die Behauptung bleibt stehen.** Was das Geraet gesagt hat, steht
--     byte-treu in `nutzlast_roh` und wird nicht geloescht — es wird nur
--     nicht geglaubt. `art` traegt ab hier, was die Marke sagt; die Nutzlast
--     traegt weiter, was das Telefon gesagt hat. Beides nebeneinander ist
--     der Unterschied zwischen einer Aufzeichnung und einer Bereinigung.
--
-- **`alter type … add value` und der neue Wert in EINER Transaktion.** Der
-- Migrationslauf fuehrt jede Datei in einer Transaktion aus, und Postgres
-- verbietet die BENUTZUNG eines frisch angelegten Enum-Werts bis zum Commit.
-- Benutzt wird er hier nirgends: er steht ausschliesslich im Rumpf einer
-- plpgsql-Funktion, und der wird beim Anlegen geparst, nicht ausgewertet.
-- Deshalb steht in dieser Datei kein `default 'unbekannt'`, kein `check`
-- darauf und kein `update` — das waere jeweils die Auswertung, die scheitert.
--
-- **Kein `alter function … owner to cse_definer`** (K-01): `create or
-- replace` erbt den Eigentuemer der Funktion aus 0042. Die Zeile gehoert zu
-- einer NEU angelegten `security definer`-Funktion, und hier entsteht keine.
-- ===========================================================================

alter type offline_ereignis_art add value if not exists 'unbekannt' after 'checkout';

comment on type offline_ereignis_art is
  'Was ein Geraet nachgereicht hat. Die drei Stempelwerte checkin/checkout/'
  'unbekannt setzt der Server aus dem Zweck der MARKE (0090) — ein Geraet, '
  'das nur einen Knopf hat, kennt die Richtung nicht und behauptet sie '
  'deshalb nicht. unbekannt heisst: die Marke hat nicht aufgeloest, also '
  'weiss die Richtung niemand.';

-- ---------------------------------------------------------------------------
-- app.offline_ereignis_annehmen — unveraendert bis auf die Richtung
-- (K-08 Registerzeile 4: dieselbe Signatur, dieselbe Rolle, derselbe Weg.
--  Eine zweite Fassung mit anderer Stelligkeit waere ein zweiter Weg, und
--  das Register nennt genau einen.)
-- ---------------------------------------------------------------------------

create or replace function app.offline_ereignis_annehmen(p_token_hash text,
                                              p_ereignisse jsonb,
                                              p_ip inet)
/**
 * **Die Rueckgabespalten heissen `ereignis_kennung` und `ergebnis`, nicht
 * `client_ereignis_id` und `status`** — und das ist kein Geschmack.
 *
 * In plpgsql sind OUT-Parameter Variablen, und Postgres setzt sie ueberall
 * dort ein, wo ein Bezeichner sonst eine Spalte waere. Hiessen sie wie die
 * Spalten, schluege `on conflict (client_ereignis_id)` mit „column reference
 * is ambiguous" fehl — und zwar erst zur Laufzeit, beim ersten
 * Wiedereinspielen, also genau an der Stelle, die diese Funktion absichert.
 */
returns table (ereignis_kennung uuid, vorgang_id uuid, ergebnis text)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  t            record;
  ev           jsonb;
  v_client     uuid;
  v_geraet     text;
  v_ua         text;
  v_art        offline_ereignis_art;
  v_behauptet  timestamptz;
  v_geraetezeit timestamptz;
  v_roh        text;
  v_sha        text;
  v_geo_an     boolean := false;
  v_geo        jsonb;
  v_grund      ablehnung_grund;
  v_benutzer   uuid;
  v_id         uuid;
  v_status     offline_status;
  v_fenster    integer;
  v_medien     uuid;
  v_bezug_tab  text;
  v_bezug_id   uuid;
begin
  if jsonb_typeof(p_ereignisse) <> 'array' then
    raise exception 'p_ereignisse ist eine Liste von Ereignissen'
      using errcode = 'invalid_parameter_value';
  end if;

  /**
   * Die Marke wird GELESEN, nicht eingeloest — und das ist der Unterschied zu
   * K-09.
   *
   * Eine Nacherfassung darf ausserhalb des Gueltigkeitsfensters ankommen; sie
   * ist ja gerade deshalb spaet, weil kein Netz da war. Sie am Fenster
   * abzuweisen hiesse, die Stunden zu verlieren, um die es geht — der Fehler,
   * den B11 im ersten Entwurf gefunden hat. Was zaehlt, ist, dass die Marke
   * EXISTIERT und nicht WIDERRUFEN ist; alles andere entscheidet ein Mensch.
   */
  select ct.id, ct.mandant_id, ct.einsatz_id, ct.einsatz_zuordnung_id,
         ct.anstellung_id, ct.person_id, ct.zweck, ct.eingeloest_am, ct.widerrufen_am,
         ez.entfernt_am
    into t
    from public.checkin_token ct
    left join public.einsatz_zuordnung ez on ez.id = ct.einsatz_zuordnung_id
   where ct.token_hash = p_token_hash;

  if found and t.widerrufen_am is null and t.entfernt_am is null then
    v_grund := null;
    v_geo_an := coalesce(
      (app.einstellung(t.mandant_id, 'zeit.geolokalisierung'))::boolean, false);
    v_fenster := coalesce(
      (app.einstellung(t.mandant_id, 'zeit.nacherfassung_fenster_tage'))::integer, 7);
    select b.id into v_benutzer
      from public.benutzer b
     where b.person_id = t.person_id and b.deaktiviert_am is null;
  elsif found and t.widerrufen_am is not null then
    v_grund := 'token_ungueltig';
  elsif found then
    v_grund := 'zuordnung_entfernt';
  else
    v_grund := 'token_ungueltig';
  end if;

  for ev in select * from jsonb_array_elements(p_ereignisse)
  loop
    v_client      := (ev ->> 'client_ereignis_id')::uuid;
    v_art         := (ev ->> 'art')::offline_ereignis_art;
    v_behauptet   := (ev ->> 'behauptete_zeit')::timestamptz;
    v_geraetezeit := coalesce((ev ->> 'geraete_zeit')::timestamptz, now());
    v_ua          := ev ->> 'user_agent';
    v_roh         := ev ->> 'roh';
    v_sha         := encode(digest(coalesce(v_roh, ''), 'sha256'), 'hex');
    v_geo         := ev -> 'geo';

    /**
     * `geraet_id` ist nur dann die Kennung des Geraets, wenn die Gesellschaft
     * das eingeschaltet hat (§1.15). Sonst ein Zufallswert je Einreichung —
     * das Feld bleibt gefuellt (die Spalte ist `not null`), taugt aber nicht
     * mehr, ein Telefon ueber Wochen wiederzuerkennen. Genau deshalb traegt
     * die Deduplizierung `client_ereignis_id` als eigenen Schluessel.
     */
    if v_grund is null and coalesce(
         (app.einstellung(t.mandant_id, 'zeit.geraetekennung'))::boolean, false) then
      v_geraet := coalesce(ev ->> 'geraet_id', gen_random_uuid()::text);
    else
      v_geraet := gen_random_uuid()::text;
    end if;

    if v_client is null or v_art is null or v_behauptet is null or v_roh is null then
      raise exception 'Ein Ereignis braucht client_ereignis_id, art, behauptete_zeit und roh'
        using errcode = 'invalid_parameter_value';
    end if;

    /**
     * **Die Richtung steht in der MARKE, nicht im Geraet** (0090).
     *
     * Bis hierhin stand `art` woertlich so in der Zeile, wie das Telefon es
     * geschickt hat — und die Flaeche schickte immer `checkin`, weil sie nur
     * einen Knopf hat. Ein im Funkloch getipptes SchichtENDE reiste damit als
     * SchichtBEGINN zur Planung.
     *
     * Das Geraet KANN die Richtung nicht kennen: die Seite loest die Marke
     * bewusst nicht auf (AUT-06, §9.2). Die Marke kennt sie — 0035 gibt je
     * Bein eine eigene aus, und `app.checkin_verbrauchen` entscheidet Beginn
     * oder Ende an nichts anderem als `t.zweck`.
     *
     * Loest die Marke nicht auf, geht die Einreichung in den Vorbereich, und
     * dort weiss die Richtung wirklich niemand: dann steht `unbekannt` da und
     * nicht ein ersatzweise gesetztes `checkin`.
     *
     * `pause`, `foto` und `nacherfassung` sind keine Richtungen und bleiben
     * unberuehrt — was das Geraet dort sagt, kann nur es wissen.
     *
     * Die Behauptung des Geraets wird nicht geloescht: `nutzlast_roh` haelt
     * sie byte-treu fest. Sie wird nur nicht geglaubt.
     */
    if v_art in ('checkin', 'checkout', 'unbekannt') then
      if v_grund is not null then
        v_art := 'unbekannt';
      elsif t.zweck = 'checkin' then
        v_art := 'checkin';
      else
        v_art := 'checkout';
      end if;
    end if;

    if v_grund is not null then
      -- Der Vorbereich (§5.13). Kein Mandant, kein Ort, aber der Beweis bleibt.
      insert into zeit_intern.offline_eingang
            (geraet_id, client_ereignis_id, praesentierter_token_hash, art,
             behauptete_zeit, geraete_zeit_bei_uebertragung,
             zeitabweichung_sek, verzoegerung_sek, nutzlast_roh, nutzlast_sha256,
             grund, ip_adresse, user_agent)
      values (v_geraet, v_client, p_token_hash, v_art,
              v_behauptet, v_geraetezeit, 0, 0, v_roh, v_sha,
              v_grund, p_ip, v_ua)
      on conflict (client_ereignis_id) do nothing
      returning id into v_id;

      if v_id is null then
        select e.id into v_id from zeit_intern.offline_eingang e
         where e.client_ereignis_id = v_client;
      end if;

      ereignis_kennung := v_client;
      vorgang_id := v_id;
      ergebnis := 'empfangen';
      return next;
      continue;
    end if;

    /**
     * Eine Einreichung, die aelter ist als das Nacherfassungsfenster, wird
     * NICHT verworfen — sie geht auf `manuelle_pruefung`. § 17 Abs. 1 MiLoG
     * setzt sieben Kalendertage als gesetzliche Hoechstfrist; das ist die
     * Vorgabe, nicht eine gewaehlte Betriebsregel.
     * // TODO(client, O-165): Welche interne Frist gilt fuer die
     * Nacherfassung, unterhalb der gesetzlichen Hoechstfrist von sieben
     * Kalendertagen, und wer wird beim Ueberschreiten informiert?
     *
     * Ebenso `manuelle_pruefung`, wenn die Marke BEREITS EINGELOEST ist: dann
     * gibt es zu diesem Bein schon einen serverseitig erfassten Datensatz, und
     * die nachgereichte Behauptung darf ihn unter keinen Umstaenden
     * ueberschreiben (Abnahmekriterium 3). Sie kann es auch nicht — von hier
     * fuehrt kein Pfad zu einem bestehenden `zeiteintrag` —, aber sie soll
     * einem Menschen auffallen statt still in der Warteschlange zu liegen.
     */
    v_status := case
      when t.eingeloest_am is not null then 'manuelle_pruefung'
      when now() - v_behauptet > make_interval(days => v_fenster) then 'manuelle_pruefung'
      else 'empfangen' end::offline_status;

    insert into public.offline_ereignis
          (mandant_id, client_ereignis_id, geraet_id,
           checkin_token_id, einsatz_id, einsatz_zuordnung_id, anstellung_id, person_id,
           art, behauptete_zeit, geraete_zeit_bei_uebertragung,
           zeitabweichung_sek, verzoegerung_sek,
           nutzlast_roh, nutzlast_sha256, nutzlast,
           geo_lat, geo_lon, geo_genauigkeit_m, geo_status,
           status, ip_adresse, user_agent,
           erstellt_von_art, erstellt_von, erstellt_von_person_id)
    values (t.mandant_id, v_client, v_geraet,
            t.id, t.einsatz_id, t.einsatz_zuordnung_id, t.anstellung_id, t.person_id,
            v_art, v_behauptet, v_geraetezeit,
            0, 0,
            v_roh, v_sha, coalesce(ev, '{}'::jsonb),
            case when v_geo_an then (v_geo ->> 'lat')::numeric end,
            case when v_geo_an then (v_geo ->> 'lon')::numeric end,
            case when v_geo_an then (v_geo ->> 'genauigkeit_m')::numeric end,
            case when v_geo_an and (v_geo ->> 'lat') is not null then 'erfasst'
                 when v_geo_an then coalesce(v_geo ->> 'status', 'nicht_verfuegbar')
                 else 'deaktiviert' end::geo_status,
            v_status, p_ip, v_ua,
            /**
             * Anders als beim Check-in ist ein fehlendes Benutzerkonto hier
             * KEIN Abbruch. Der Check-in muss abbrechen, weil er sonst eine
             * einmal verwendbare Marke verbrennt; hier gibt es nichts zu
             * verbrennen, und die Behauptung einer Kraft, die vor ihrer
             * Freischaltung eine erste Schicht gearbeitet hat, ist genau der
             * strittige Fall, den diese Tabelle aufheben soll.
             */
            case when v_benutzer is null then 'system' else 'mensch' end::akteur_art,
            v_benutzer, t.person_id)
    on conflict (client_ereignis_id) do nothing
    returning id into v_id;

    if v_id is null then
      -- Schon da: dieselbe Zeile, derselbe Ausgang. Die Warteschlange eines
      -- Telefons wird nach einem Funkloch mehrfach gesendet (K-09).
      select o.id into v_id from public.offline_ereignis o
       where o.client_ereignis_id = v_client;
      ereignis_kennung := v_client;
      vorgang_id := v_id;
      ergebnis := 'empfangen';
      return next;
      continue;
    end if;

    /**
     * Das Medium haengt an dem, was es belegt: am laufenden Zeiteintrag der
     * Einteilung, wenn es einen gibt, sonst an der Schicht selbst. Beides sind
     * registrierte Elternteile (§5.8.1).
     *
     * An die Schicht zu haengen, wenn ein Eintrag existiert, waere die
     * bequemere Wahl und die schlechtere: die Mitarbeiterdecke und die
     * `t_person`-Policy setzen auf `zeiteintrag_id` auf, und ein Foto, das
     * daran vorbei an der Schicht haengt, ist fuer den Menschen, der es
     * gemacht hat, unsichtbar.
     */
    if v_art = 'foto' and ev ? 'medium' then
      if v_benutzer is null then
        raise exception 'kein Benutzerkonto fuer diese Person'
          using errcode = 'P0003',
                hint = 'Ein Medium traegt immer einen Menschen (me_definer_insert).';
      end if;

      select z.id into v_bezug_id
        from public.zeiteintrag z
       where z.einsatz_zuordnung_id = t.einsatz_zuordnung_id
         and z.storniert_am is null and z.ersetzt_am is null
       order by z.beginn_zeitpunkt desc
       limit 1;
      v_bezug_tab := case when v_bezug_id is null then 'einsatz' else 'zeiteintrag' end;
      v_bezug_id  := coalesce(v_bezug_id, t.einsatz_id);

      insert into public.einsatz_medien
            (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
             mime_typ, groesse_bytes, sha256, breite, hoehe, dauer_sek,
             exif_entfernt, aufgenommen_am_geraet, beschreibung,
             erstellt_von_art, erstellt_von, erstellt_von_person_id)
      values (t.mandant_id, v_bezug_tab, v_bezug_id,
              ((ev -> 'medium') ->> 'art')::medien_art,
              coalesce((ev -> 'medium') ->> 'bucket', 'einsatz-medien'),
              (ev -> 'medium') ->> 'pfad',
              (ev -> 'medium') ->> 'mime_typ',
              ((ev -> 'medium') ->> 'groesse_bytes')::bigint,
              (ev -> 'medium') ->> 'sha256',
              ((ev -> 'medium') ->> 'breite')::integer,
              ((ev -> 'medium') ->> 'hoehe')::integer,
              ((ev -> 'medium') ->> 'dauer_sek')::integer,
              /**
               * Der Dienst hat bereinigt, BEVOR das Objekt im Bucket landete.
               * Was hier steht, ist die Bestaetigung — und `me_exif` laesst die
               * Zeile ohnehin nicht entstehen, wenn sie fehlt.
               */
              coalesce(((ev -> 'medium') ->> 'exif_entfernt')::boolean, false),
              ((ev -> 'medium') ->> 'aufgenommen_am_geraet')::timestamptz,
              (ev -> 'medium') ->> 'beschreibung',
              'mensch', v_benutzer, t.person_id)
      returning id into v_medien;

      update public.offline_ereignis set medien_id = v_medien where id = v_id;
    end if;

    perform app.protokolliere('zeit.offline_empfangen', 'offline_ereignis', v_id::text, null,
                              jsonb_build_object('art', v_art::text,
                                                 'status', v_status::text,
                                                 'ip', p_ip::text),
                              t.mandant_id);

    ereignis_kennung := v_client;
    vorgang_id := v_id;
    ergebnis := 'empfangen';
    return next;
  end loop;
end $$;

comment on function app.offline_ereignis_annehmen(text, jsonb, inet) is
  'K-08-Register Zeile 4, Rolle cse_checkin. Nimmt die Warteschlange eines '
  'Geraets entgegen und schreibt Behauptungen — nie einen Zeiteintrag (§9.4). '
  'Die Richtung eines Stempels kommt seit 0090 aus dem Zweck der Marke, nie '
  'aus der Nutzlast; loest die Marke nicht auf, heisst sie unbekannt.';

-- `create or replace` behaelt die Rechte der Funktion. Die Zeile steht
-- trotzdem: sie ist die Zusage aus K-08, und eine Zusage, die man nur
-- deshalb weglaesst, weil sie gerade erhalten bleibt, faellt beim naechsten
-- Mal weg, wenn sie es nicht tut.
grant execute on function app.offline_ereignis_annehmen(text, jsonb, inet) to cse_checkin;
