-- 0149 · Die drei fehlenden Wächter aus SPEC §14 — und die Frage, die keine
--        Funktion bisher beantworten konnte: WER hält dieses Recht?
--
-- SPEC §14 nennt acht Wächter. Fünf stehen (Nachweisablauf, Lead-SLA,
-- Rechnungsüberfälligkeit, Hashkette, Radarfrist). Drei fehlen, und alle drei
-- scheitern an derselben Stelle: sie sollen „den Planer" oder „den Bauleiter"
-- benachrichtigen, und keine dieser Meldungen hat ein Feld, in dem der
-- Empfänger stünde.
--
-- **`app.hat_recht` beantwortet die Frage falsch herum.** Sie sagt „hält die
-- SITZUNG dieses Recht in diesem Bereich" — das Richtige für eine Policy, das
-- Unbrauchbare für einen Job, der gar keine Sitzung hat. Gebraucht wird die
-- Umkehrung: „welche Konten halten es".
--
-- **Und die Umkehrung darf keine zweite Fassung der Rechtelogik sein.** Eine
-- abgeschriebene Auflösung (globale Rolle, dann Mitgliedschaft, dann
-- mandantenspezifisch vor Plattformvorgabe, dazu die Modul-Schnittmenge aus
-- AUT-01) driftet beim ersten Zusatz auseinander — und dann benachrichtigt
-- die Plattform jemanden, der die Seite gar nicht öffnen kann, oder schweigt
-- gegenüber jemandem, der zuständig ist. Deshalb wird `app.hat_recht` HIER
-- zerlegt: ein Kern mit ausdrücklichem Benutzer, und die bisherige Funktion
-- als Hülle darüber. Eine Implementierung, zwei Eingänge.

-- ---------------------------------------------------------------------------
-- (1) Der Kern: hält DIESES Konto das Recht in DIESEM Bereich?
-- ---------------------------------------------------------------------------

/**
 * Wortgleich mit der bisherigen `app.hat_recht(text, uuid)` — nur dass
 * Benutzer, AAL und Gruppenansicht hereingereicht werden, statt aus der
 * Sitzung zu kommen.
 *
 * **Warum die drei Parameter und nicht nur der Benutzer.** Zwei der Prüfungen
 * sind Eigenschaften der SITZUNG, nicht des Menschen: `erfordert_2fa` fragt,
 * ob die aktuelle Anmeldung stark genug ist, und die Gruppenansicht verbietet
 * jedes Schreibrecht. Für die Frage „wer ist zuständig" gilt beides nicht —
 * ein Bauleiter bleibt zuständig, auch wenn er gerade nicht angemeldet ist.
 * Die Vorgaben (`aal2`, keine Gruppenansicht) sind deshalb genau die, die
 * eine Zuständigkeitsfrage braucht; die Hülle reicht die echten Werte durch.
 */
create function app.hat_recht_fuer(
  p_benutzer      uuid,
  p_schluessel    text,
  p_mandant       uuid,
  p_aal           text    default 'aal2',
  p_gruppenansicht boolean default false
) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_recht     record;
  v_rolle     uuid;
  v_gewaehrt  boolean;
begin
  if p_benutzer is null then return false; end if;

  select b.id, b.aktion, b.nur_global, b.erfordert_2fa into v_recht
    from public.berechtigung b where b.schluessel = p_schluessel;
  if not found then return false; end if;

  if v_recht.erfordert_2fa and p_aal <> 'aal2' then
    return false;
  end if;

  if p_gruppenansicht and v_recht.aktion not in ('lesen', 'exportieren') then
    return false;
  end if;

  -- Die globale Rolle: sie gilt in jedem Bereich, ohne Zuweisungszeile (TEN-08).
  select b.globale_rolle_id into v_rolle
    from public.benutzer b
   where b.id = p_benutzer and b.deaktiviert_am is null and b.status = 'aktiv';

  if v_rolle is not null then
    select rb.gewaehrt into v_gewaehrt
      from public.rolle_berechtigung rb
     where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
       and rb.mandant_id is not distinct from p_mandant
     order by rb.mandant_id nulls last limit 1;
    if v_gewaehrt is null then
      select rb.gewaehrt into v_gewaehrt
        from public.rolle_berechtigung rb
       where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;
    end if;
    if v_gewaehrt then return true; end if;
  end if;

  if v_recht.nur_global then return false; end if;
  if p_mandant is null then return false; end if;

  -- Die Mitgliedschaftsrolle in genau diesem Bereich.
  select bm.rolle_id into v_rolle
    from public.benutzer_mandant bm
   where bm.benutzer_id = p_benutzer and bm.mandant_id = p_mandant
     and bm.entzogen_am is null
     and bm.gueltig_ab <= current_date
     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
     -- AUT-01: eine Modulbeschränkung ist eine SCHNITTMENGE, kein Zusatz.
     and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
   limit 1;
  if v_rolle is null then return false; end if;

  -- Mandantenspezifisch schlägt Plattform-Vorgabe.
  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
     and rb.mandant_id = p_mandant;
  if v_gewaehrt is not null then return v_gewaehrt; end if;

  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;

  return coalesce(v_gewaehrt, false);
end $$;

comment on function app.hat_recht_fuer(uuid, text, uuid, text, boolean) is
  'Der Kern der Rechtepruefung mit ausdruecklichem Konto (D-494). app.hat_recht ist die '
  'Huelle darueber; kern.traeger_des_rechts die Umkehrung. Eine Implementierung.';

alter function app.hat_recht_fuer(uuid, text, uuid, text, boolean) owner to cse_definer;
revoke execute on function app.hat_recht_fuer(uuid, text, uuid, text, boolean) from public;
grant execute on function app.hat_recht_fuer(uuid, text, uuid, text, boolean)
  to cse_app, cse_definer, cse_job;

/**
 * Die bisherige Funktion, jetzt als Hülle.
 *
 * Ihr Verhalten ändert sich nicht — sie reicht durch, was sie vorher selbst
 * gelesen hat. Der Beweis dafür ist die Isolationssuite: sie prüft `hat_recht`
 * an jeder Policy dieser Plattform, und sie lief vor diesem Umbau grün.
 */
create or replace function app.hat_recht(p_schluessel text, p_mandant uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select app.hat_recht_fuer(
    app.aktueller_benutzer(), p_schluessel, p_mandant, app.aal(), app.ist_gruppenansicht())
$$;

-- ---------------------------------------------------------------------------
-- (2) Die Umkehrung: wer hält es?
-- ---------------------------------------------------------------------------

/**
 * Die Konten, die `p_recht` in `p_mandant` halten — sortiert und ohne
 * Dienstkonten.
 *
 * **Ohne Dienstkonten**, weil eine Wache Menschen meint. Der Website-Renderer
 * und der Formular-Eingang halten Rechte, haben aber keinen Posteingang, den
 * jemand liest; eine Meldung an sie wäre eine Meldung an niemanden, die in
 * der Zustellstatistik trotzdem als zugestellt zählte.
 *
 * **`stable` und `security definer`**: der Wächter läuft als `cse_job` und
 * sieht `benutzer_mandant` nur über diese Funktion. Sie gibt Kennungen
 * heraus, keine Namen und keine E-Mail-Adressen.
 */
create function kern.traeger_des_rechts(p_mandant uuid, p_recht text) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce(array_agg(distinct b.id order by b.id), '{}')
    from public.benutzer b
   where b.status = 'aktiv'
     and b.deaktiviert_am is null
     and not b.ist_dienstkonto
     and app.hat_recht_fuer(b.id, p_recht, p_mandant)
$$;

comment on function kern.traeger_des_rechts(uuid, text) is
  'Die aktiven Menschenkonten, die ein Recht in einem Bereich halten (SPEC §14, D-494). '
  'Die Umkehrung von app.hat_recht — dieselbe Aufloesung, anderer Eingang.';

alter function kern.traeger_des_rechts(uuid, text) owner to cse_definer;
revoke execute on function kern.traeger_des_rechts(uuid, text) from public;
grant execute on function kern.traeger_des_rechts(uuid, text) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- (3) Das Gedächtnis der Wachen
-- ---------------------------------------------------------------------------

/**
 * Eine Wache, ein Gegenstand, ein Empfänger, eine Lage — einmal.
 *
 * **Warum ein gemeinsamer Tisch und nicht je Wache eine Spalte.** Der
 * Nachtrag hat seine eigene (`ueberfaellig_gemeldet_am`, 0080) und behält
 * sie: sie steht in der Bauakte und wird dort angezeigt. Die beiden neuen
 * Wachen melden dagegen an MEHRERE Empfänger — alle, die den Dienstplan
 * schreiben —, und „gemeldet" ist dann keine Eigenschaft des Einsatzes,
 * sondern eine des Paares (Einsatz, Mensch). Eine Spalte am Einsatz könnte
 * das nicht ausdrücken, ohne zu lügen.
 *
 * **`kennung` ist die LAGE, nicht der Gegenstand.** Für „morgen unbesetzt" ist
 * es der Tag: derselbe Einsatz darf am nächsten Tag wieder melden, wenn er
 * immer noch unbesetzt ist — nicht aber zweimal am selben Tag. Für „Schicht
 * ohne Zeiteintrag" ist die Lage einmalig und die Kennung leer. Dieselbe
 * Überlegung wie `radar_warnung.frist_angebot` (0148).
 */
create table waechter_meldung (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /** Der Jobschlüssel — `schicht_ohne_zeiteintrag`, `morgen_unbesetzt`, … */
  waechter      text not null check (waechter ~ '^[a-z][a-z0-9_]*$'),
  objekt_typ    text not null check (length(btrim(objekt_typ)) > 0),
  objekt_id     uuid not null,
  empfaenger_id uuid not null references benutzer(id),
  kennung       text not null default '',

  /** Serveruhr (Invariante 5). */
  gemeldet_am   timestamptz not null default now(),
  erstellt_am   timestamptz not null default now(),

  constraint wm_mandant_uk unique (mandant_id, id),
  constraint wm_einmal unique (waechter, objekt_id, empfaenger_id, kennung)
);

create index wm_mandant_idx on waechter_meldung (mandant_id, waechter, gemeldet_am desc);

comment on table waechter_meldung is
  'SPEC §14, NOT-01. Das Gedaechtnis der Wachen: wem wurde was gemeldet, und zu welcher Lage. '
  'Verhindert die zweite Meldung derselben Sache an denselben Menschen (D-494).';

create trigger trg_wm_empfaenger_im_mandant
  before insert or update on waechter_meldung
  for each row execute function kern.radar_benutzer_im_mandant('empfaenger_id');

alter table waechter_meldung enable row level security;
alter table waechter_meldung force  row level security;

/**
 * Lesen darf, wer den Betrieb ansieht (`system.betrieb_lesen`) — das ist die
 * Seite, auf der „warum habe ich keine Meldung bekommen" beantwortet wird.
 */
create policy t_waechter_lesen on waechter_meldung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('system.betrieb_lesen', app.aktiver_mandant()));
create policy p_intern_ceiling on waechter_meldung as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');
create policy j_waechter_meldung on waechter_meldung for all to cse_job
  using (true) with check (true);

grant select on waechter_meldung to cse_app, cse_job;
grant insert on waechter_meldung to cse_job;

/** Die beiden Dienstplanwachen lesen Einsatz, Zuordnung und Zeiteintrag. */
grant select on einsatz, einsatz_zuordnung, zeiteintrag, objekt to cse_job;
create policy j_einsatz on einsatz for select to cse_job using (true);
create policy j_einsatz_zuordnung on einsatz_zuordnung for select to cse_job using (true);
create policy j_objekt_waechter on objekt for select to cse_job using (true);

/**
 * **Der Name des Menschen — und nur er.**
 *
 * „Kein Zeiteintrag für Jonas Weber" ist eine brauchbare Meldung; „kein
 * Zeiteintrag für 7f3a…-…" ist keine. Der Wächter braucht also `person`, und
 * `cse_job` hatte darauf weder Recht noch Policy: der erste stündliche Lauf
 * wäre an „permission denied for table person" gestorben, nachdem alles
 * andere längst grün war. Gefunden hat es der Isolationstest, der den Lauf
 * unter der ECHTEN Jobrolle fährt.
 *
 * Es ist ein SPALTENrecht, und das ist hier kein Detail: in derselben Zeile
 * stehen Geburtsdatum, Staatsangehörigkeit und Sozialversicherungsnummer.
 * Eine Wache, die einen Namen in eine Meldung schreibt, hat mit ihnen nichts
 * zu tun — und ein Tabellenrecht gäbe ihr alles davon.
 */
create policy j_person_waechter on person for select to cse_job using (true);
grant select (id, vorname, nachname) on person to cse_job;
