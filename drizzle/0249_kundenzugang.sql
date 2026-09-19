-- 0249 — der Kundenzugang: ausstellen, neu einladen, entziehen
-- (AUT-01, AUT-04, CRM-01, DOC-04, K-04, 04-SEITENKARTE §5.2).
--
-- ===========================================================================
-- Der Befund: der Hauptfall war technisch unmoeglich
-- ===========================================================================
--
-- `/portal/[mandant]/crm/kunden/[id]/zugang` fuehrt laut Seitenkarte drei
-- Vorgaenge: „issue, re-issue and revoke". Zwei davon gingen schon, einer
-- nicht:
--
--  · BINDEN eines bestehenden Kontos und ENTZIEHEN: `cse_app` hat auf
--    `kunde_zugang` INSERT und UPDATE, `t_zugang_verwalten` oeffnet beides
--    mit `system.benutzer_verwalten`.
--  · AUSSTELLEN eines NEUEN Zugangs: unmoeglich. Ein Kundenzugang ist ein
--    KONTO, und auf `benutzer` hat `cse_app` nur SELECT, `cse_definer` nur
--    SELECT und UPDATE. Eine `benutzer`-Zeile entstand im ganzen Haus
--    ausschliesslich im Seed, als `postgres`.
--
-- Die Folge war nicht eine Fehlermeldung, sondern eine Seite, die es nicht
-- gab: der Kunde ruft an, will ins Portal, und die Verwaltung hat keinen Weg.
--
-- ===========================================================================
-- Warum EINE Funktion und nicht vier Anweisungen in der Anwendung
-- ===========================================================================
--
-- Ein Kundenzugang besteht aus vier Zeilen, die nur zusammen einen Sinn haben:
-- ein Konto (`benutzer`), eine Mitgliedschaft mit der Rolle `kunde`
-- (`benutzer_mandant`), die Bindung an genau diesen Kunden (`kunde_zugang`)
-- und ein Einladungstoken (`kern.kennwort_token`). Fehlt die dritte, ist das
-- Konto im Bereich angemeldet und sieht — nach `app.aktuelle_kunden()` — die
-- Vorgaenge von NIEMANDEM, also eine leere Oberflaeche, die aussieht wie ein
-- Fehler. Fehlt die zweite, kommt die Anmeldung gar nicht durch.
--
-- Vier Anweisungen in vier Rechtekontexten waeren vier Stellen, an denen
-- jemand eine vergisst. Hier ist es ein Vorgang, eine Rechtepruefung, ein
-- Protokolleintrag.
--
-- ===========================================================================
-- Der zweite Faktor ist hier KEINE Formalie
-- ===========================================================================
--
-- `benutzer_mandant` traegt fuer `cse_app` die restriktive Policy `p_bm_aal2`:
-- eine Mitgliedschaft entsteht nur in einer Sitzung mit zweitem Faktor. Diese
-- Funktion laeuft als `cse_definer` und waere davon nicht gebunden — sie
-- prueft `app.aal()` deshalb SELBST. Ein Definer, der eine Bedingung
-- umgeht, weil er sie umgehen KANN, ist der Weg, auf dem eine Kontrolle
-- verschwindet, ohne dass jemand sie abgeschafft hat.
--
-- ===========================================================================
-- Was diese Migration NICHT tut: sie spricht nicht mit Supabase
-- ===========================================================================
--
-- `benutzer.id` IST `auth.users.id` (0007 §6.4). Lokal ist `auth.users` eine
-- Attrappe mit zwei Spalten; in einem Supabase-Projekt ist es die Tabelle von
-- Supabase Auth, und ein Konto entsteht dort ueber die Admin-API, nicht ueber
-- `insert`. Solange kein Projekt verbunden ist (`anbieter() = 'demo'`,
-- O-501), IST der hausinterne Weg der echte Weg: `app.kennwort_anmelden`
-- prueft gegen `kern.zugangsdaten`, und ein hier angelegtes Konto meldet sich
-- wirklich an. Der Dienst darueber (`server/services/crm/kundenzugang.ts`)
-- fragt `anbieter()` und weist mit benannter Meldung ab, sobald Supabase
-- gilt — statt ein Konto anzulegen, mit dem sich niemand anmelden kann.
--
-- TODO(client, O-662): Wird ein Kundenzugang nach dem Anschluss von Supabase
-- Auth (O-501) ueber die Admin-API angelegt, und wer traegt dann den
-- Auftragsverarbeitungsvertrag fuer die Konten externer Ansprechpartner?

-- ---------------------------------------------------------------------------
-- Die Rechte, die `cse_definer` dafuer braucht — je Tabelle begruendet
-- ---------------------------------------------------------------------------
--
-- `insert` auf `auth.users` und `benutzer`: der einzige Weg zu einem Konto
-- ausserhalb des Seeds. `cse_app` bekommt hier NICHTS dazu — die Anwendung
-- legt weiterhin kein Konto an, nur diese Funktion tut es.
--
-- **Auf `auth.users` steht die Erteilung SPALTENWEISE**, und das ist keine
-- Ziererei: in einem Supabase-Projekt ist diese Tabelle nicht die Attrappe
-- aus 0007, sondern der Kontenspeicher von Supabase Auth — mit
-- `encrypted_password`, `confirmation_token` und `recovery_token` darin. Ein
-- `grant select on auth.users` haette diese Spalten jeder kuenftigen
-- Definer-Funktion geoeffnet. Gebraucht werden zwei.
grant select (id, email), insert (id, email) on auth.users to cse_definer;
grant insert on public.benutzer to cse_definer;
grant select, insert, update on public.kunde_zugang to cse_definer;

-- `kunde_zugang` hat fuer `cse_definer` bisher keine Policy — ohne sie liest
-- und schreibt die Funktion null Zeilen, und zwar lautlos. Genau dieser
-- Ausfall ist der Grund, warum `tests/isolation/definer-eigentum.test.ts`
-- existiert.
create policy d_kunde_zugang_verwalten on public.kunde_zugang
  for all to cse_definer
  using (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

-- Die Mitgliedschaft eines KUNDENkontos ist nicht `aus_anstellung` — die
-- vorhandene Policy `d_bm_aus_anstellung` deckt sie deshalb nicht. Die neue
-- ist eng: nur die Rolle `kunde`, nur im aktiven Bereich.
create policy d_bm_kundenrolle on public.benutzer_mandant
  for insert to cse_definer
  with check (
    mandant_id = app.aktiver_mandant()
    and not aus_anstellung
    and exists (select 1 from public.rolle r
                 where r.id = benutzer_mandant.rolle_id
                   and r.schluessel = 'kunde' and r.mandant_id is null)
  );

-- `benutzer` traegt FORCE RLS und hatte fuer `cse_definer` nur
-- UPDATE-Policies (`d_benutzer_anmeldung_pflege`). Ohne eine INSERT-Policy
-- scheitert das Anlegen mit „new row violates row-level security policy" —
-- und zwar richtig: bis hierhin gab es kein Konto, das die Anwendung anlegen
-- durfte.
--
-- Die neue Policy ist so eng wie die Aufgabe: ein EINGELADENES Konto mit
-- E-Mail-Adresse, ohne Person, ohne globale Rolle, kein Dienstkonto. Damit
-- kann diese Definer-Funktion (und jede kuenftige) ueber `benutzer` kein
-- `super_admin` erzeugen und kein Konto an einen Menschen haengen, den sie
-- nicht kennt. Welchem KUNDEN das Konto gehoert, entscheidet danach
-- `kunde_zugang`, und dessen Policy prueft den Bereich.
create policy d_benutzer_einladung_anlegen on public.benutzer
  for insert to cse_definer
  with check (
    status = 'eingeladen'
    and email is not null
    and person_id is null
    and globale_rolle_id is null
    and not ist_dienstkonto
    and deaktiviert_am is null
  );

comment on policy d_benutzer_einladung_anlegen on public.benutzer is
  'Der einzige Weg zu einem neuen Konto ausserhalb des Seeds (0249). Eng '
  'gefasst: eingeladen, mit E-Mail, ohne Person, ohne globale Rolle, kein '
  'Dienstkonto — eine Definer-Funktion soll hierueber kein super_admin '
  'erzeugen koennen.';

comment on policy d_kunde_zugang_verwalten on public.kunde_zugang is
  'Nur fuer app.kundenzugang_* (0249). Der Bereich kommt aus der Sitzung, '
  'nie aus einem Argument (Invariante 3).';
comment on policy d_bm_kundenrolle on public.benutzer_mandant is
  'Die Mitgliedschaft eines Kundenkontos — ausschliesslich die globale Rolle '
  '`kunde`. Eine Definer-Funktion, die jede Rolle vergeben koennte, waere ein '
  'Weg zu `admin` ohne Rechtepruefung.';

-- ---------------------------------------------------------------------------
-- app.kundenzugang_ausstellen — Konto, Mitgliedschaft, Bindung, Einladung
-- ---------------------------------------------------------------------------
--
-- `grund` ist immer gesetzt und immer deutsch lesbar; `ok = false` heisst
-- NIE „irgendwas ging schief".
create function app.kundenzugang_ausstellen(
  p_kunde      uuid,
  p_email      text,
  p_name       text,
  p_token_hash text
) returns table (
  ok           boolean,
  grund        text,
  konto_id     uuid,
  zugang_id    uuid,
  neues_konto  boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, kern
as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_name     text := btrim(coalesce(p_name, ''));
  v_benutzer uuid;
  v_neu      boolean := false;
  v_rolle    uuid;
  v_zugang   uuid;
  v_stunden  int := coalesce((app.plattform_einstellung('auth.einladung_stunden'))::int, 168);
begin
  if app.portal() <> 'intern' then
    raise exception 'Ein Kundenzugang wird nur im internen Portal ausgestellt (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird kein Zugang ausgestellt (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_mandant is null then
    raise exception 'Ohne aktive Gesellschaft gibt es keinen Kundenzugang (K-20)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'system.benutzer_verwalten fehlt' using errcode = 'insufficient_privilege';
  end if;
  -- Siehe Kopf: `p_bm_aal2` gilt fuer `cse_app`, diese Funktion prueft es selbst.
  if app.aal() <> 'aal2' then
    raise exception 'Ein Kundenzugang wird nur mit zweitem Faktor ausgestellt (AUT-02)'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.kunde k
                  where k.id = p_kunde and k.mandant_id = v_mandant
                    and k.archiviert_am is null) then
    return query select false, 'Diesen Kunden gibt es in dieser Gesellschaft nicht.'::text,
                        null::uuid, null::uuid, false;
    return;
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return query select false, 'Ohne gueltige E-Mail-Adresse gibt es kein Konto.'::text,
                        null::uuid, null::uuid, false;
    return;
  end if;
  if v_name = '' then
    return query select false, 'Ein Konto braucht einen Namen — er steht in jeder '
                        'Freigabe und in jedem Protokolleintrag.'::text,
                        null::uuid, null::uuid, false;
    return;
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Einladungstoken wird ausserhalb der Datenbank gebildet und '
                    'nur als SHA-256 uebergeben' using errcode = 'check_violation';
  end if;

  select b.id into v_benutzer
    from public.benutzer b
   where lower(b.email) = v_email and b.deaktiviert_am is null;

  if v_benutzer is not null then
    /*
     * Ein INTERNES Konto wird nie zum Kundenkonto.
     *
     * `app.portal()` leitet die K-04-Decke aus der Rolle der aktiven
     * Mitgliedschaft ab. Haette dasselbe Konto beides, entschiede die
     * Reihenfolge der Mitgliedschaften, welche Decke gilt — und im
     * schlechteren Fall saehe die Sachbearbeitung das Portal ihres Kunden
     * oder umgekehrt.
     */
    if exists (select 1 from public.benutzer_mandant bm
                 join public.rolle r on r.id = bm.rolle_id
                where bm.benutzer_id = v_benutzer and bm.entzogen_am is null
                  and r.portal <> 'kunde') then
      return query select false, 'Diese Adresse gehoert einem internen Konto. Ein '
                          'Kundenzugang dafuer wuerde die Trennung der Portale '
                          'aufheben (K-04).'::text, v_benutzer, null::uuid, false;
      return;
    end if;
    -- Ein Konto, ein Kunde je Gesellschaft (`kunde_zugang_uk`). Der Fall ist
    -- kein Fehler, sondern eine Auskunft: der Zugang besteht schon.
    if exists (select 1 from public.kunde_zugang kz
                where kz.benutzer_id = v_benutzer and kz.mandant_id = v_mandant
                  and kz.entzogen_am is null) then
      return query select false, 'Dieses Konto hat in dieser Gesellschaft schon einen '
                          'Zugang. Entziehen Sie ihn zuerst.'::text,
                          v_benutzer, null::uuid, false;
      return;
    end if;
  else
    /*
     * LESEN ZUERST, wie im Seed (`authBenutzer`).
     *
     * Die Supabase-Attrappe traegt auf `email` keine Eindeutigkeit. Ein
     * blindes `insert` legte bei einem zweiten Versuch eine ZWEITE Zeile mit
     * derselben Adresse an, bekaeme eine neue id und scheiterte eine
     * Anweisung spaeter an `benutzer_email_key` — mit einer Meldung, die auf
     * `benutzer` zeigt, waehrend der Fehler in `auth.users` liegt.
     */
    select u.id into v_benutzer from auth.users u where lower(u.email) = v_email;
    if v_benutzer is null then
      v_benutzer := gen_random_uuid();
      insert into auth.users (id, email) values (v_benutzer, v_email);
    end if;
    insert into public.benutzer (id, email, name, status, erstellt_von)
    values (v_benutzer, v_email, v_name, 'eingeladen', app.aktueller_benutzer());
    v_neu := true;
  end if;

  select r.id into v_rolle from public.rolle r
   where r.schluessel = 'kunde' and r.mandant_id is null;
  if v_rolle is null then
    raise exception 'Die Rolle `kunde` fehlt im Rollenkatalog' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.benutzer_mandant bm
                  where bm.benutzer_id = v_benutzer and bm.mandant_id = v_mandant
                    and bm.entzogen_am is null) then
    insert into public.benutzer_mandant
      (benutzer_id, mandant_id, rolle_id, aus_anstellung, ist_standard, erstellt_von)
    values (v_benutzer, v_mandant, v_rolle, false,
            -- `benutzer_mandant_standard_uk`: genau eine Standardzeile je
            -- Konto. Die erste wird es, eine zweite nicht.
            not exists (select 1 from public.benutzer_mandant bm2
                         where bm2.benutzer_id = v_benutzer and bm2.ist_standard
                           and bm2.entzogen_am is null),
            app.aktueller_benutzer());
  end if;

  insert into public.kunde_zugang
    (mandant_id, kunde_id, benutzer_id, erstellt_von)
  values (v_mandant, p_kunde, v_benutzer, app.aktueller_benutzer())
  returning id into v_zugang;

  -- Zwei gueltige Einladungen auf ein Konto sind eine zu viel (0155).
  update kern.kennwort_token t set eingeloest_am = now()
   where t.benutzer_id = v_benutzer and t.zweck = 'einladung' and t.eingeloest_am is null;
  insert into kern.kennwort_token
    (benutzer_id, zweck, token_hash, gueltig_bis, erstellt_von)
  values (v_benutzer, 'einladung', p_token_hash,
          now() + make_interval(hours => v_stunden), app.aktueller_benutzer());

  perform app.protokolliere('kunde.zugang_ausgestellt', 'kunde', p_kunde::text, null,
                            jsonb_build_object('benutzer_id', v_benutzer,
                                               'neues_konto', v_neu,
                                               'gueltig_stunden', v_stunden),
                            v_mandant);

  return query select true, 'ausgestellt'::text, v_benutzer, v_zugang, v_neu;
end $$;

alter function app.kundenzugang_ausstellen(uuid, text, text, text) owner to cse_definer;
revoke execute on function app.kundenzugang_ausstellen(uuid, text, text, text) from public;
grant execute on function app.kundenzugang_ausstellen(uuid, text, text, text) to cse_app;

comment on function app.kundenzugang_ausstellen(uuid, text, text, text) is
  'Konto, Mitgliedschaft (Rolle kunde), Bindung an den Kunden und '
  'Einladungstoken in EINEM Vorgang. Prueft system.benutzer_verwalten und '
  'aal2. Der Klartext des Tokens entsteht ausserhalb und wird nie '
  'gespeichert.';

-- ---------------------------------------------------------------------------
-- app.kundenzugang_neu_einladen — ein frischer Link, der alte verfaellt
-- ---------------------------------------------------------------------------
create function app.kundenzugang_neu_einladen(
  p_zugang     uuid,
  p_token_hash text
) returns table (ok boolean, grund text, konto_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, app, kern
as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_benutzer uuid;
  v_kunde    uuid;
  v_stunden  int := coalesce((app.plattform_einstellung('auth.einladung_stunden'))::int, 168);
begin
  if app.portal() <> 'intern' then
    raise exception 'Eine Einladung wird nur im internen Portal ausgestellt (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird nichts eingeladen (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'system.benutzer_verwalten fehlt' using errcode = 'insufficient_privilege';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Eine neue Einladung wird nur mit zweitem Faktor ausgestellt (AUT-02)'
      using errcode = 'insufficient_privilege';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Einladungstoken wird ausserhalb der Datenbank gebildet'
      using errcode = 'check_violation';
  end if;

  select kz.benutzer_id, kz.kunde_id into v_benutzer, v_kunde
    from public.kunde_zugang kz
   where kz.id = p_zugang and kz.mandant_id = v_mandant and kz.entzogen_am is null;
  if v_benutzer is null then
    return query select false, 'Diesen Zugang gibt es nicht — oder er ist entzogen.'::text,
                        null::uuid;
    return;
  end if;

  update kern.kennwort_token t set eingeloest_am = now()
   where t.benutzer_id = v_benutzer and t.zweck = 'einladung' and t.eingeloest_am is null;
  insert into kern.kennwort_token
    (benutzer_id, zweck, token_hash, gueltig_bis, erstellt_von)
  values (v_benutzer, 'einladung', p_token_hash,
          now() + make_interval(hours => v_stunden), app.aktueller_benutzer());

  perform app.protokolliere('kunde.zugang_neu_eingeladen', 'kunde', v_kunde::text, null,
                            jsonb_build_object('benutzer_id', v_benutzer,
                                               'gueltig_stunden', v_stunden),
                            v_mandant);
  return query select true, 'eingeladen'::text, v_benutzer;
end $$;

alter function app.kundenzugang_neu_einladen(uuid, text) owner to cse_definer;
revoke execute on function app.kundenzugang_neu_einladen(uuid, text) from public;
grant execute on function app.kundenzugang_neu_einladen(uuid, text) to cse_app;

comment on function app.kundenzugang_neu_einladen(uuid, text) is
  'Ein frisches Einladungstoken; jedes aeltere offene verfaellt dabei. Setzt '
  'keinen Zugang neu und legt kein Konto an.';

-- ---------------------------------------------------------------------------
-- app.kundenzugang_entziehen — ein Datum, keine Loeschung
-- ---------------------------------------------------------------------------
--
-- **Der Entzug beendet die laufenden Sitzungen.** Ohne das haette der Zugang
-- bis zum Ablauf der Sitzung weiter funktioniert: `app.aktuelle_kunden()`
-- liest `kunde_zugang`, aber eine schon gebundene Sitzung fragt es erst bei
-- der naechsten Anfrage — und die kann Stunden spaeter kommen. Ein Entzug,
-- der erst morgen wirkt, ist kein Entzug.
create function app.kundenzugang_entziehen(
  p_zugang uuid,
  p_grund  text
) returns table (ok boolean, grund text, sitzungen integer)
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_benutzer uuid;
  v_kunde    uuid;
  v_text     text := nullif(btrim(coalesce(p_grund, '')), '');
  v_anzahl   integer := 0;
begin
  if app.portal() <> 'intern' then
    raise exception 'Ein Kundenzugang wird nur im internen Portal entzogen (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird nichts entzogen (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'system.benutzer_verwalten fehlt' using errcode = 'insufficient_privilege';
  end if;
  if v_text is null then
    return query select false, 'Ein Entzug traegt einen Grund — er steht spaeter in der '
                        'Frage, warum der Kunde nicht mehr hineinkommt.'::text, 0;
    return;
  end if;

  select kz.benutzer_id, kz.kunde_id into v_benutzer, v_kunde
    from public.kunde_zugang kz
   where kz.id = p_zugang and kz.mandant_id = v_mandant and kz.entzogen_am is null;
  if v_benutzer is null then
    return query select false, 'Diesen Zugang gibt es nicht — oder er ist schon '
                        'entzogen.'::text, 0;
    return;
  end if;

  update public.kunde_zugang kz
     set entzogen_am = now(), entzogen_von = app.aktueller_benutzer()
   where kz.id = p_zugang and kz.mandant_id = v_mandant;

  -- Die Mitgliedschaft geht mit: ohne sie ist das Konto im Bereich nicht
  -- mehr angemeldet, und `app.sitzung_aufloesen` findet keinen Mandanten.
  update public.benutzer_mandant bm
     set entzogen_am = now(), entzogen_von = app.aktueller_benutzer(),
         entzugsgrund = v_text
   where bm.benutzer_id = v_benutzer and bm.mandant_id = v_mandant
     and bm.entzogen_am is null and not bm.aus_anstellung;

  -- Offene Einladungen verfallen mit dem Entzug; ein Link, der nach dem
  -- Entzug noch ein Kennwort setzt, ist ein offenes Fenster.
  update kern.kennwort_token t set eingeloest_am = now()
   where t.benutzer_id = v_benutzer and t.zweck = 'einladung' and t.eingeloest_am is null;

  update public.benutzer_sitzung bs
     set beendet_am = now(), ende_grund = 'gesperrt'
   where bs.benutzer_id = v_benutzer and bs.beendet_am is null;
  get diagnostics v_anzahl = row_count;

  perform app.protokolliere('kunde.zugang_entzogen', 'kunde', v_kunde::text, null,
                            jsonb_build_object('benutzer_id', v_benutzer,
                                               'grund', v_text,
                                               'beendete_sitzungen', v_anzahl),
                            v_mandant);
  return query select true, 'entzogen'::text, v_anzahl;
end $$;

alter function app.kundenzugang_entziehen(uuid, text) owner to cse_definer;
revoke execute on function app.kundenzugang_entziehen(uuid, text) from public;
grant execute on function app.kundenzugang_entziehen(uuid, text) to cse_app;

comment on function app.kundenzugang_entziehen(uuid, text) is
  'Entzieht Bindung und Mitgliedschaft, laesst offene Einladungen verfallen '
  'und beendet die laufenden Sitzungen dieses Kontos. Keine Zeile '
  'verschwindet — ein Entzug ist ein Datum (Invariante 8).';

-- ---------------------------------------------------------------------------
-- app.kundenzugang_liste — die Zugaenge EINES Kunden, mit Konto
-- ---------------------------------------------------------------------------
--
-- Warum ein Definer fuer eine Leseabfrage: die Seite steht hinter
-- `system.benutzer_verwalten`, das Konto selbst (`benutzer.email`,
-- `benutzer.name`) liegt aber hinter `t_benutzer_lesen` und damit hinter
-- `system.benutzer_lesen`. Wem das zweite entzogen ist, saehe die Zeilen
-- ohne Namen — eine Liste aus Bindestrichen, die aussieht, als sei kein
-- Konto hinterlegt. Diese Funktion prueft das Recht der SEITE und
-- antwortet vollstaendig oder gar nicht.
create function app.kundenzugang_liste(p_kunde uuid)
returns table (
  zugang_id        uuid,
  benutzer_id      uuid,
  email            text,
  name             text,
  konto_status     text,
  aktiviert_am     timestamptz,
  entzogen_am      timestamptz,
  entzogen_von     text,
  einladung_offen  boolean,
  einladung_bis    timestamptz,
  letzte_anmeldung timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app, kern
as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if app.portal() <> 'intern' then
    raise exception 'Kundenzugaenge sind nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('system.benutzer_verwalten', v_mandant) then
    raise exception 'system.benutzer_verwalten fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select kz.id, kz.benutzer_id, b.email, b.name, b.status::text,
           kz.aktiviert_am, kz.entzogen_am, e.name,
           exists (select 1 from kern.kennwort_token t
                    where t.benutzer_id = kz.benutzer_id and t.zweck = 'einladung'
                      and t.eingeloest_am is null and t.gueltig_bis > now()),
           (select max(t.gueltig_bis) from kern.kennwort_token t
             where t.benutzer_id = kz.benutzer_id and t.zweck = 'einladung'
               and t.eingeloest_am is null and t.gueltig_bis > now()),
           b.letzter_login_am
      from public.kunde_zugang kz
      join public.benutzer b on b.id = kz.benutzer_id
      left join public.benutzer e on e.id = kz.entzogen_von
     where kz.mandant_id = v_mandant and kz.kunde_id = p_kunde
     order by kz.entzogen_am nulls first, kz.aktiviert_am desc;
end $$;

alter function app.kundenzugang_liste(uuid) owner to cse_definer;
revoke execute on function app.kundenzugang_liste(uuid) from public;
grant execute on function app.kundenzugang_liste(uuid) to cse_app;

comment on function app.kundenzugang_liste(uuid) is
  'Die Zugaenge eines Kunden samt Konto und offener Einladung. Prueft das '
  'Recht der Seite (system.benutzer_verwalten), damit eine fehlende '
  'system.benutzer_lesen nicht als „kein Konto hinterlegt" erscheint.';
