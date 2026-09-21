-- ===========================================================================
-- 0372 — Die Einladung eines Verwaltungskontos (AUT-04, D-610, 0155, 0249)
--
-- **Der schwerste Befund der Mandantenbefragung.** Die einzige Stelle, die in
-- `benutzer` schrieb, war der SEED (`src/server/db/seed/index.ts`, Zeilen 391,
-- 468, 542, 1475). Keine Einladungsroute, kein Formular, keine API. Praktisch:
-- es liess sich kein neuer Admin einsetzen, ausser durch einen erneuten
-- Seed-Lauf — auf einer Produktionsdatenbank also gar nicht.
--
-- **Und das Schema hat die Einladung die ganze Zeit erwartet.**
-- `benutzer.status` hat den Vorgabewert `'eingeladen'` (0007, Zeile 159), und
-- `einstellungen/benutzer` zeigt diesen Zustand als Pille „Wartet" — ein
-- Zustand, den nichts erzeugen konnte.
--
-- **Gebaut war ausserdem schon die ganze ANNAHMEhaelfte:**
--   * `kern.kennwort_token` fuehrt `zweck in ('zuruecksetzen','einladung')` (0155)
--   * `/auth/einladung/[token]` leitet auf `/auth/passwort-neu?token=…`
--   * `/auth/passwort-neu` liest den Zweck und beschriftet sich danach
--   * `0249` benutzt exakt diese Kette fuer den KUNDENzugang
-- Es fehlte allein die absendende Haelfte fuer interne Konten. Diese Migration
-- ist deshalb bewusst eine Kopie von `app.kundenzugang_ausstellen` (0249) mit
-- den drei Unterschieden, die eine Verwaltung von einem Kunden trennen.
--
-- **Unterschied 1: das Recht steigt auf (D-610).**
-- `system.verwaltungskonto_erstellen` ist `nur_global` — nur der Super-Admin.
-- Die Trennlinie aus D-610: was bei Missbrauch die GRUPPE trifft, gehoert nach
-- oben. Ein eingeladenes Konto mit interner Rolle sieht Personal, Zeiten und
-- Finanzen einer Gesellschaft; wer solche Konten anlegen darf, kann sich die
-- Gruppe erschliessen. `system.benutzer_verwalten` bleibt unten und deckt
-- weiter, was es immer deckte: Mitarbeiter- und Kundenzugaenge, Bearbeiten,
-- Deaktivieren.
--
-- **Unterschied 2: die Rolle ist INTERN und wird gewaehlt.** Ein Kundenzugang
-- bekommt immer `kunde`; hier waehlt der Einladende `admin` oder `leitung`.
-- Die Auswahl ist eng, und zwar mit Absicht (siehe Unterschied 3).
--
-- **Unterschied 3: `super_admin` ist NICHT einladbar — und das ist eine offene
-- Frage, keine Entscheidung dieser Migration.** Heute entsteht ein
-- Super-Admin ausschliesslich im Seed. Diese Funktion aendert daran nichts:
-- eine Einladung, die Super-Admins erzeugen kann, ist ein Weg zur vollen
-- Gruppenmacht, und ob es ihn geben soll — und unter welcher zweiten
-- Bedingung (Vier-Augen? zweiter bestehender Super-Admin?) — ist eine
-- Entscheidung des Mandanten und keine des Codes (K-17).
-- // TODO(client, O-887): Darf ein Super-Admin einen zweiten Super-Admin einladen, und wenn ja unter welcher zusaetzlichen Bedingung (Bestaetigung durch einen zweiten bestehenden Super-Admin, Vier-Augen-Prinzip)? Heute entsteht ein Super-Admin nur im Seed, und der Verlust des einzigen Kontos macht die Plattform unverwaltbar.
--
-- **Der Klartext des Tokens entsteht ausserhalb** und wird nie gespeichert —
-- dieselbe Regel wie bei 0249 und bei der Check-in-Marke: die Datenbank sieht
-- nur `sha256`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Bindung des neuen Rechts fuer bereits gewanderte Datenbanken
-- ---------------------------------------------------------------------------

/*
 * Der Seed-Block in `0008` traegt die Zeile jetzt mit (`pnpm katalog`), aber
 * nur fuer eine Datenbank, die `0008` noch vor sich hat — dieselbe Lage wie
 * bei `0371`. Zwei Wege, ein Ziel.
 */
insert into berechtigung (schluessel, modul, objekt, aktion, bezeichnung, nur_global, sortierung)
select 'system.verwaltungskonto_erstellen', 'system', 'verwaltungskonto',
       'erstellen'::berechtigung_aktion, 'system.verwaltungskonto_erstellen', true,
       (select coalesce(max(sortierung), 0) + 1 from berechtigung)
on conflict (schluessel) do update set nur_global = true;

insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
select r.id, b.id, null, true
  from rolle r
  join berechtigung b on b.schluessel = 'system.verwaltungskonto_erstellen'
 where r.schluessel = 'super_admin' and r.mandant_id is null
on conflict (rolle_id, berechtigung_id, mandant_id) do nothing;

do $$
declare v_anzahl int;
begin
  select count(*) into v_anzahl
    from rolle_berechtigung rb
    join rolle r        on r.id = rb.rolle_id
    join berechtigung b on b.id = rb.berechtigung_id
   where b.schluessel = 'system.verwaltungskonto_erstellen'
     and rb.mandant_id is null and rb.gewaehrt and r.schluessel = 'super_admin';
  if v_anzahl <> 1 then
    raise exception 'D-610: system.verwaltungskonto_erstellen muss an super_admin gebunden sein, gefunden: %', v_anzahl;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Die Definer-Policy fuer die Mitgliedschaft — eng wie ihre Schwester
-- ---------------------------------------------------------------------------

/**
 * `benutzer_mandant` traegt FORCE RLS, und fuer `cse_definer` gibt es bisher
 * `d_bm_aus_anstellung` (Mitarbeiterkonten) und `d_bm_kundenrolle` (0249,
 * ausschliesslich die Rolle `kunde`). Eine Verwaltungsmitgliedschaft ist
 * weder das eine noch das andere — ohne eigene Policy scheitert der Vorgang
 * mit „new row violates row-level security policy for table
 * benutzer_mandant".
 *
 * **Die Rollenliste steht hier ein ZWEITES Mal, und das ist Absicht.** Die
 * Funktion prueft sie schon, damit der Fehlschlag einen lesbaren Satz
 * bekommt; die Policy prueft sie, damit die Sperre auch dann haelt, wenn
 * spaeter eine zweite Definer-Funktion auf dieselbe Tabelle schreibt. 0249
 * sagt den Grund in einem Satz, der hier woertlich gilt: „Eine
 * Definer-Funktion, die jede Rolle vergeben koennte, waere ein Weg zu `admin`
 * ohne Rechtepruefung."
 *
 * `super_admin` ist damit auch auf Policy-Ebene ausgeschlossen (O-887) — und
 * `benutzer.globale_rolle_id` bleibt ohnehin durch
 * `d_benutzer_einladung_anlegen` (0249) auf `null` festgenagelt.
 */
create policy d_bm_verwaltungsrolle on public.benutzer_mandant
  for insert to cse_definer
  with check (
    mandant_id = app.aktiver_mandant()
    and not aus_anstellung
    and exists (select 1 from public.rolle r
                 where r.id = benutzer_mandant.rolle_id
                   and r.schluessel in ('admin', 'leitung')
                   and r.mandant_id is null)
  );

comment on policy d_bm_verwaltungsrolle on public.benutzer_mandant is
  'Die Mitgliedschaft eines Verwaltungskontos (0372) — ausschliesslich die '
  'globalen Rollen `admin` und `leitung`. `super_admin` bleibt aussen vor '
  '(O-887), Mitarbeiter- und Kundenrollen haben eigene Wege.';

-- ---------------------------------------------------------------------------
-- 3. Der Vorgang
-- ---------------------------------------------------------------------------

create function app.verwaltungskonto_einladen(
  p_mandant    uuid,
  p_email      text,
  p_name       text,
  p_rolle      text,
  p_token_hash text
) returns table (
  ok          boolean,
  grund       text,
  konto_id    uuid,
  neues_konto boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, kern
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_name     text := btrim(coalesce(p_name, ''));
  v_rolle    text := btrim(coalesce(p_rolle, ''));
  v_benutzer uuid;
  v_neu      boolean := false;
  v_rolle_id uuid;
  v_stunden  int := coalesce((app.plattform_einstellung('auth.einladung_stunden'))::int, 168);
begin
  if app.portal() <> 'intern' then
    raise exception 'Ein Verwaltungskonto wird nur im internen Portal eingeladen (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht schreibt nicht (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if p_mandant is null then
    raise exception 'Ein Verwaltungskonto gehoert zu genau einer Gesellschaft (K-20)'
      using errcode = 'insufficient_privilege';
  end if;
  /*
   * **`nur_global` heisst: die Mitgliedschaft zaehlt hier nicht.**
   * `app.hat_recht` wertet fuer ein `nur_global`-Recht nur den Zweig ueber
   * `benutzer.globale_rolle_id` aus (0169) — ein Admin einer Gesellschaft
   * bekommt hier also `false`, auch in seiner eigenen. Genau das ist D-610.
   */
  if not app.hat_recht('system.verwaltungskonto_erstellen', p_mandant) then
    raise exception 'system.verwaltungskonto_erstellen fehlt (D-610: nur der Super-Admin)'
      using errcode = 'insufficient_privilege';
  end if;
  /* Dasselbe wie bei 0249: ein Konto anzulegen ist ein aal2-Vorgang (AUT-02). */
  if app.aal() <> 'aal2' then
    raise exception 'Ein Verwaltungskonto wird nur mit zweitem Faktor eingeladen (AUT-02)'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.mandant m where m.id = p_mandant) then
    return query select false, 'Diese Gesellschaft gibt es nicht.'::text, null::uuid, false;
    return;
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return query select false, 'Ohne gueltige E-Mail-Adresse gibt es kein Konto.'::text,
                        null::uuid, false;
    return;
  end if;
  if v_name = '' then
    return query select false, 'Ein Konto braucht einen Namen — er steht in jeder '
                        'Freigabe und in jedem Protokolleintrag.'::text, null::uuid, false;
    return;
  end if;
  /*
   * **Die enge Rollenliste ist die Sicherung, nicht die Bequemlichkeit.**
   * `super_admin` fehlt hier bewusst (O-887 im Kopf), und `mitarbeiter` und
   * `kunde` gehoeren nicht hierher: fuer sie gibt es eigene, gebaute Wege
   * (`/personal/personen/[id]/zugang`, `/crm/kunden/[id]/zugang`), die mehr
   * tun als ein Konto anzulegen — sie binden es an einen Menschen bzw. einen
   * Kunden. Eine Verwaltungseinladung, die eine `mitarbeiter`-Rolle vergibt,
   * erzeugte ein Konto ohne `person_id` und damit ein Arbeiterportal ohne
   * Arbeiter.
   */
  if v_rolle not in ('admin', 'leitung') then
    return query select false, 'Ueber diesen Weg werden nur `admin` und `leitung` '
                        'eingeladen. Mitarbeiter- und Kundenzugaenge haben eigene '
                        'Wege; ein Super-Admin entsteht heute nur im Seed (O-887).'::text,
                        null::uuid, false;
    return;
  end if;

  select r.id into v_rolle_id from public.rolle r
   where r.schluessel = v_rolle and r.mandant_id is null;
  if v_rolle_id is null then
    raise exception 'Die Rolle % fehlt im Rollenkatalog', v_rolle using errcode = 'no_data_found';
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
     * **Ein KUNDENkonto wird nie zum Verwaltungskonto** — die Gegenrichtung
     * der Sperre aus 0249. `app.portal()` leitet die K-04-Decke aus der Rolle
     * der aktiven Mitgliedschaft ab; haette dasselbe Konto beides, entschiede
     * die Reihenfolge der Mitgliedschaften, welche Decke gilt.
     */
    if exists (select 1 from public.benutzer_mandant bm
                 join public.rolle r on r.id = bm.rolle_id
                where bm.benutzer_id = v_benutzer and bm.entzogen_am is null
                  and r.portal = 'kunde') then
      return query select false, 'Diese Adresse gehoert einem Kundenkonto. Ein '
                          'Verwaltungszugang dafuer wuerde die Trennung der Portale '
                          'aufheben (K-04).'::text, v_benutzer, false;
      return;
    end if;
    if exists (select 1 from public.benutzer_mandant bm
                where bm.benutzer_id = v_benutzer and bm.mandant_id = p_mandant
                  and bm.entzogen_am is null) then
      return query select false, 'Dieses Konto ist in dieser Gesellschaft schon '
                          'eingetragen. Aendern Sie seine Rolle, statt es erneut '
                          'einzuladen.'::text, v_benutzer, false;
      return;
    end if;
  else
    /* Lesen zuerst — siehe 0249: die Supabase-Attrappe traegt auf `email`
       keine Eindeutigkeit, und ein blindes `insert` scheiterte erst eine
       Anweisung spaeter mit einer Meldung auf der falschen Tabelle. */
    select u.id into v_benutzer from auth.users u where lower(u.email) = v_email;
    if v_benutzer is null then
      v_benutzer := gen_random_uuid();
      insert into auth.users (id, email) values (v_benutzer, v_email);
    end if;
    insert into public.benutzer (id, email, name, status, erstellt_von)
    values (v_benutzer, v_email, v_name, 'eingeladen', app.aktueller_benutzer());
    v_neu := true;
  end if;

  insert into public.benutzer_mandant
    (benutzer_id, mandant_id, rolle_id, aus_anstellung, ist_standard, erstellt_von)
  values (v_benutzer, p_mandant, v_rolle_id, false,
          not exists (select 1 from public.benutzer_mandant bm2
                       where bm2.benutzer_id = v_benutzer and bm2.ist_standard
                         and bm2.entzogen_am is null),
          app.aktueller_benutzer());

  -- Zwei gueltige Einladungen auf ein Konto sind eine zu viel (0155).
  update kern.kennwort_token t set eingeloest_am = now()
   where t.benutzer_id = v_benutzer and t.zweck = 'einladung' and t.eingeloest_am is null;
  insert into kern.kennwort_token
    (benutzer_id, zweck, token_hash, gueltig_bis, erstellt_von)
  values (v_benutzer, 'einladung', p_token_hash,
          now() + make_interval(hours => v_stunden), app.aktueller_benutzer());

  perform app.protokolliere('system.verwaltungskonto_eingeladen', 'benutzer',
                            v_benutzer::text, null,
                            jsonb_build_object('rolle', v_rolle,
                                               'neues_konto', v_neu,
                                               'gueltig_stunden', v_stunden),
                            p_mandant);

  return query select true, 'eingeladen'::text, v_benutzer, v_neu;
end $$;

alter function app.verwaltungskonto_einladen(uuid, text, text, text, text) owner to cse_definer;
revoke execute on function app.verwaltungskonto_einladen(uuid, text, text, text, text) from public;
grant execute on function app.verwaltungskonto_einladen(uuid, text, text, text, text) to cse_app;

comment on function app.verwaltungskonto_einladen(uuid, text, text, text, text) is
  'D-610/AUT-04: Konto, Mitgliedschaft (admin oder leitung) und Einladungstoken '
  'in EINEM Vorgang. Prueft system.verwaltungskonto_erstellen (nur_global — nur '
  'der Super-Admin) und aal2. super_admin ist nicht einladbar (O-887). Der '
  'Klartext des Tokens entsteht ausserhalb und wird nie gespeichert.';
