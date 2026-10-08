-- 0537 — Krankheit im Urlaub: die Tage einer nachgewiesenen Arbeitsunfaehigkeit
--        im genehmigten Urlaub kommen auf das Urlaubskonto zurueck
--        (V-319, O-138, D-788, D-853, § 9 BUrlG, EMP-05, EMP-10, LEG-09)
--
-- Der Befund: § 9 BUrlG — „die durch aerztliches Zeugnis nachgewiesenen Tage
-- der Arbeitsunfaehigkeit werden auf den Jahresurlaub nicht angerechnet".
-- Die Voreinstellung (O-138, D-788) sagt dasselbe: mit AU-Bescheinigung werden
-- die Krankheitstage gutgeschrieben. Gebaut war nichts davon. Eine Krankmeldung
-- ueber einem genehmigten Urlaub liess sich zwar erfassen — ab_keine_dublette
-- (0073) sperrt nur dieselbe Art, und der Kommentar dort nennt genau diesen
-- Fall —, aber kern.abwesenheit_urlaubskonto bucht nur Genehmigung und
-- Stornierung: das Konto behielt die vollen Urlaubstage abgezogen. Der einzige
-- Weg war, den ganzen Urlaub zu stornieren und neu zu beantragen.
--
-- Die Loesung, in einer Transaktion: app.krankheit_im_urlaub_erfassen legt die
-- Krankheit an — mit Verweis auf den Urlaub, den sie unterbricht, und den
-- gutgeschriebenen Tagen —, und der Ausloeser bucht die Tage auf das
-- Urlaubskonto zurueck. Der Urlaub selbst bleibt, wie er genehmigt wurde: die
-- Gutschrift ist eine eigene Tatsache an der Krankheit, und sie nimmt ihre
-- Stornierung mit.
--
-- Die Zahl rechnet der Dienst (Invariante 6, abwesenheit/krankheit-im-urlaub.ts:
-- die Arbeitstage des Urlaubs, die in die Krankheit fallen, nach derselben
-- Regel wie der Urlaub selbst). Hier stehen nur die Decken.
--
-- Wer: zeit.abwesenheit_melden (die Krankheit) UND zeit.abwesenheit_genehmigen
-- (die Gutschrift aendert, was der genehmigte Urlaub kostet — dieselbe
-- Entscheidung wie eine Stornierung).
--
-- Art. 9 DSGVO: die zwei neuen Spalten verraten, dass eine Abwesenheit eine
-- Krankheit ist. cse_app liest sie deshalb nicht (die Spaltenliste aus 0073
-- nennt sie nicht) und schreibt sie nicht (ein Ausloeser weist es ab —
-- das Tabellenrecht fuer insert und update aus 0073 deckte sie sonst).
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Welche Art den Urlaub unterbricht — eine Katalogangabe
-- ---------------------------------------------------------------------------

alter table abwesenheitsart
  add column unterbricht_urlaub boolean not null default false,
  add constraint aa_unterbricht_nicht_sich_selbst
    check (not (unterbricht_urlaub and zaehlt_auf_urlaubskonto));

comment on column abwesenheitsart.unterbricht_urlaub is
  'V-319, O-138, D-853: Tage dieser Art im genehmigten Urlaub werden mit AU-Bescheinigung '
  'nicht auf den Urlaub angerechnet (§ 9 BUrlG). Voreinstellung: nur die Plattformart krankheit.';

-- TODO(client, O-138): Voreinstellung — nur die eigene Arbeitsunfaehigkeit (Plattformart krankheit) unterbricht den genehmigten Urlaub, und nur mit AU-Bescheinigung (§ 9 BUrlG); „Kind krank" nicht, § 9 BUrlG kennt nur die Erkrankung des Arbeitnehmers. Pflege unter Stammdaten › Abwesenheitsarten. D-788, D-853.
update abwesenheitsart set unterbricht_urlaub = true
 where mandant_id is null and schluessel = 'krankheit';

-- ---------------------------------------------------------------------------
-- 2. Die Gutschrift an der Krankheit
-- ---------------------------------------------------------------------------

alter table abwesenheit
  add column unterbrochener_urlaub_id   uuid,
  add column urlaub_gutgeschrieben_tage numeric(12,3),
  add constraint ab_unterbrochener_urlaub_fk foreign key (mandant_id, unterbrochener_urlaub_id)
    references abwesenheit (mandant_id, id),
  add constraint ab_gutschrift_paarweise check (
    (unterbrochener_urlaub_id is null) = (urlaub_gutgeschrieben_tage is null)),
  add constraint ab_gutschrift_positiv check (
    urlaub_gutgeschrieben_tage is null or urlaub_gutgeschrieben_tage > 0),
  -- § 9 BUrlG: „durch aerztliches Zeugnis nachgewiesen".
  add constraint ab_gutschrift_mit_au check (
    unterbrochener_urlaub_id is null or au_bescheinigung_vorliegt),
  add constraint ab_gutschrift_nicht_selbst check (
    unterbrochener_urlaub_id is distinct from id);

create index abwesenheit_unterbrochener_urlaub_idx on abwesenheit (unterbrochener_urlaub_id)
  where unterbrochener_urlaub_id is not null;

comment on column abwesenheit.unterbrochener_urlaub_id is
  'V-319, D-853: der genehmigte Urlaub, den diese Krankheit unterbricht (§ 9 BUrlG). '
  'Art. 9 DSGVO — cse_app liest die Spalte nicht.';
comment on column abwesenheit.urlaub_gutgeschrieben_tage is
  'V-319, D-853: die Urlaubstage, die diese Krankheit dem Urlaubskonto zurueckgibt — '
  'gerechnet vom Dienst (Invariante 6), solange sie erfasst ist; storniert bucht sie zurueck.';

-- ---------------------------------------------------------------------------
-- 3. Die Pruefung beim Anlegen — nur ueber die Funktion, nur innerhalb der Decken
-- ---------------------------------------------------------------------------

-- Mit den Rechten des Aufrufers (kein Definer): current_user unterscheidet die
-- Funktion (cse_definer) von einem direkten insert der Anwendung (cse_app).
-- Gelesen wird erst, nachdem die Anwendungsrollen abgewiesen sind — als
-- cse_definer ueber ab_definer und aa_definer (0073), als Migration oder Seed
-- ohne Zeilenschutz.
create function kern.abwesenheit_gutschrift_anlegen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare
  v_urlaub  record;
  v_art     record;
  v_bisher  numeric(12,3);
begin
  if new.unterbrochener_urlaub_id is null then return new; end if;

  if current_user in ('cse_app', 'cse_anon', 'cse_checkin', 'cse_job') then
    raise exception 'Krankheit im Urlaub: der Weg ist app.krankheit_im_urlaub_erfassen, nicht ein direkter insert (D-853)'
      using errcode = 'insufficient_privilege';
  end if;

  select u.mandant_id, u.anstellung_id, u.status, u.von, u.bis, u.tage_angerechnet,
         a.zaehlt_auf_urlaubskonto
    into v_urlaub
    from public.abwesenheit u
    join public.abwesenheitsart a on a.id = u.abwesenheitsart_id
   where u.id = new.unterbrochener_urlaub_id;
  if not found or v_urlaub.mandant_id is distinct from new.mandant_id
     or v_urlaub.anstellung_id is distinct from new.anstellung_id then
    raise exception 'Krankheit im Urlaub: der Urlaub gehoert nicht zu dieser Beschaeftigung'
      using errcode = 'check_violation';
  end if;
  if not v_urlaub.zaehlt_auf_urlaubskonto then
    raise exception 'Krankheit im Urlaub: die unterbrochene Abwesenheit zaehlt nicht auf das Urlaubskonto'
      using errcode = 'check_violation';
  end if;
  if v_urlaub.status <> 'genehmigt' then
    raise exception 'Krankheit im Urlaub: der Urlaub ist nicht genehmigt (%)', v_urlaub.status
      using errcode = 'check_violation';
  end if;

  select a.unterbricht_urlaub, a.mandant_id, a.archiviert_am into v_art
    from public.abwesenheitsart a where a.id = new.abwesenheitsart_id;
  if not found or v_art.archiviert_am is not null
     or (v_art.mandant_id is not null and v_art.mandant_id <> new.mandant_id) then
    raise exception 'Krankheit im Urlaub: diese Abwesenheitsart gibt es in dieser Gesellschaft nicht'
      using errcode = 'check_violation';
  end if;
  if not v_art.unterbricht_urlaub then
    raise exception 'Krankheit im Urlaub: diese Abwesenheitsart unterbricht keinen Urlaub (O-138)'
      using errcode = 'check_violation';
  end if;
  if new.status <> 'erfasst' then
    raise exception 'Krankheit im Urlaub: die Krankheit wird erfasst, nicht beantragt oder genehmigt'
      using errcode = 'check_violation';
  end if;
  if new.von > v_urlaub.bis or new.bis < v_urlaub.von then
    raise exception 'Krankheit im Urlaub: die Krankheit liegt nicht im Urlaub (% bis %)', v_urlaub.von, v_urlaub.bis
      using errcode = 'check_violation';
  end if;

  -- Die Decken. Die Zahl selbst rechnet der Dienst (Invariante 6).
  if new.urlaub_gutgeschrieben_tage
       > (least(new.bis, v_urlaub.bis) - greatest(new.von, v_urlaub.von) + 1) then
    raise exception 'Krankheit im Urlaub: % Tage gutgeschrieben, aber nur % Kalendertage im Urlaub krank',
      new.urlaub_gutgeschrieben_tage, least(new.bis, v_urlaub.bis) - greatest(new.von, v_urlaub.von) + 1
      using errcode = 'check_violation';
  end if;
  select coalesce(sum(k.urlaub_gutgeschrieben_tage), 0) into v_bisher
    from public.abwesenheit k
   where k.unterbrochener_urlaub_id = new.unterbrochener_urlaub_id and k.status = 'erfasst';
  if new.urlaub_gutgeschrieben_tage > coalesce(v_urlaub.tage_angerechnet, 0) - v_bisher then
    raise exception 'Krankheit im Urlaub: der Urlaub kostet % Tage, % sind schon gutgeschrieben — % gingen darueber',
      v_urlaub.tage_angerechnet, v_bisher, new.urlaub_gutgeschrieben_tage
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_abwesenheit_gutschrift_anlegen
  before insert on abwesenheit
  for each row execute function kern.abwesenheit_gutschrift_anlegen();

-- ---------------------------------------------------------------------------
-- 4. Die Gutschrift ist eine Tatsache — und der Urlaub, auf den sie zeigt, auch
-- ---------------------------------------------------------------------------

-- Definer: eine Stornierung des Urlaubs kommt von cse_app, und cse_app liest
-- unterbrochener_urlaub_id nicht (Art. 9). Der Ausloeser fragt mit den Rechten
-- von cse_definer (ab_definer, 0073).
create function kern.abwesenheit_gutschrift_schuetzen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (new.unterbrochener_urlaub_id, new.urlaub_gutgeschrieben_tage)
       is distinct from (old.unterbrochener_urlaub_id, old.urlaub_gutgeschrieben_tage) then
    raise exception 'Krankheit im Urlaub: Verweis und gutgeschriebene Tage bleiben, wie sie sind (D-853)'
      using errcode = 'check_violation',
            hint = 'Zurueckgenommen wird die Krankheit ueber den Status storniert.';
  end if;

  if old.unterbrochener_urlaub_id is not null
     and (new.von, new.bis, new.anstellung_id, new.abwesenheitsart_id, new.au_bescheinigung_vorliegt)
         is distinct from
         (old.von, old.bis, old.anstellung_id, old.abwesenheitsart_id, old.au_bescheinigung_vorliegt) then
    raise exception 'Krankheit im Urlaub: was die Gutschrift begruendet, bleibt, wie es ist (D-853)'
      using errcode = 'check_violation',
            hint = 'Eine falsche Erfassung wird storniert und neu erfasst.';
  end if;

  if (new.von, new.bis, new.anstellung_id, new.tage_angerechnet, new.von_halbtags, new.bis_halbtags)
       is distinct from
     (old.von, old.bis, old.anstellung_id, old.tage_angerechnet, old.von_halbtags, old.bis_halbtags)
     and exists (select 1 from public.abwesenheit k
                  where k.unterbrochener_urlaub_id = old.id and k.status = 'erfasst') then
    raise exception 'Krankheit im Urlaub: ein Urlaub mit geltender Gutschrift behaelt Zeitraum und Tage (D-853)'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

alter function kern.abwesenheit_gutschrift_schuetzen() owner to cse_definer;
revoke all on function kern.abwesenheit_gutschrift_schuetzen() from public;

create trigger trg_abwesenheit_gutschrift_schuetzen
  before update on abwesenheit
  for each row execute function kern.abwesenheit_gutschrift_schuetzen();

-- ---------------------------------------------------------------------------
-- 5. Das Urlaubskonto: die Gutschrift bucht, ihre Stornierung bucht zurueck
-- ---------------------------------------------------------------------------

-- Der Rumpf aus 0073 bleibt; neu sind zwei Stellen:
--   (a) eine Krankheit mit Gutschrift: erfasst angelegt — die Tage gehen auf das
--       Konto des Urlaubsjahres zurueck (Jahr des Urlaubsbeginns, wie 0073);
--       storniert, solange der Urlaub genehmigt ist — sie werden wieder
--       abgezogen. Ist das Konto des Jahres nicht offen, wird die Gutschrift
--       abgewiesen (die Stornierung danach aendert ein abgeschlossenes Jahr
--       nicht, wie 0073).
--   (b) die Stornierung eines Urlaubs gibt nur zurueck, was er noch kostet:
--       seine Tage abzueglich der geltenden Gutschriften — sonst kaemen die
--       gutgeschriebenen Tage zweimal zurueck.
create or replace function kern.abwesenheit_urlaubskonto() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_zaehlt boolean; v_jahr integer; v_treffer integer;
        v_alt public.abwesenheit_status;
        v_urlaub record; v_gutgeschrieben numeric(12,3);
begin
  -- (a) Die Gutschrift einer Krankheit im Urlaub (V-319, D-853).
  if new.unterbrochener_urlaub_id is not null then
    select u.status, extract(year from u.von)::integer as jahr into v_urlaub
      from public.abwesenheit u where u.id = new.unterbrochener_urlaub_id;
    perform set_config('cse.urlaubsbuchung', 'an', true);
    if tg_op = 'INSERT' and new.status = 'erfasst' then
      update public.urlaubskonto
         set genommen_tage = greatest(genommen_tage - new.urlaub_gutgeschrieben_tage, 0),
             geaendert_am = now()
       where anstellung_id = new.anstellung_id and jahr = v_urlaub.jahr
         and abgeschlossen_am is null;
      get diagnostics v_treffer = row_count;
      if v_treffer = 0 then
        raise exception 'Kein offenes Urlaubskonto % fuer diese Beschaeftigung', v_urlaub.jahr
          using errcode = 'no_data_found',
                hint = 'Die Gutschrift nach § 9 BUrlG gehoert auf das Konto des Urlaubsjahres (O-18, D-853).';
      end if;
    elsif tg_op = 'UPDATE' and old.status = 'erfasst' and new.status = 'storniert'
          and v_urlaub.status = 'genehmigt' then
      update public.urlaubskonto
         set genommen_tage = genommen_tage + old.urlaub_gutgeschrieben_tage,
             geaendert_am = now()
       where anstellung_id = new.anstellung_id and jahr = v_urlaub.jahr
         and abgeschlossen_am is null;
    end if;
    perform set_config('cse.urlaubsbuchung', 'aus', true);
    return new;
  end if;

  select a.zaehlt_auf_urlaubskonto into v_zaehlt
    from public.abwesenheitsart a where a.id = new.abwesenheitsart_id;
  if not coalesce(v_zaehlt, false) then return new; end if;

  -- `old` gibt es beim INSERT nicht — der Antragsdienst legt die Abwesenheit
  -- fertig genehmigt an (0073).
  v_alt := case when tg_op = 'INSERT' then null else old.status end;

  -- Das Jahr des BEGINNS (0073, O-18).
  v_jahr := extract(year from new.von)::integer;

  perform set_config('cse.urlaubsbuchung', 'an', true);

  if new.status = 'genehmigt' and v_alt is distinct from 'genehmigt' then
    update public.urlaubskonto
       set genommen_tage = genommen_tage + coalesce(new.tage_angerechnet, 0),
           geaendert_am = now()
     where anstellung_id = new.anstellung_id and jahr = v_jahr
       and abgeschlossen_am is null;
    get diagnostics v_treffer = row_count;
    if v_treffer = 0 then
      raise exception 'Kein offenes Urlaubskonto % fuer diese Beschaeftigung', v_jahr
        using errcode = 'no_data_found',
              hint = 'Das Konto wird eroeffnet, bevor Urlaub genehmigt wird (O-18).';
    end if;
  elsif new.status = 'storniert' and v_alt = 'genehmigt' then
    -- (b) Was die geltenden Gutschriften schon zurueckgegeben haben, nicht zweimal.
    select coalesce(sum(k.urlaub_gutgeschrieben_tage), 0) into v_gutgeschrieben
      from public.abwesenheit k
     where k.unterbrochener_urlaub_id = old.id and k.status = 'erfasst';
    update public.urlaubskonto
       set genommen_tage = greatest(
             genommen_tage - greatest(coalesce(old.tage_angerechnet, 0) - v_gutgeschrieben, 0), 0),
           geaendert_am = now()
     where anstellung_id = new.anstellung_id and jahr = v_jahr
       and abgeschlossen_am is null;
    -- Ein abgeschlossenes Jahr wird NICHT rueckwirkend veraendert (0073).
  end if;

  perform set_config('cse.urlaubsbuchung', 'aus', true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Der Weg: eine Funktion, eine Transaktion
-- ---------------------------------------------------------------------------

create function app.krankheit_im_urlaub_erfassen(
  p_urlaub uuid, p_art uuid, p_von date, p_bis date, p_au_bis date, p_bemerkung text,
  p_tage numeric, p_gutschrift numeric
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_urlaub  record;
  v_neu     uuid;
begin
  if v_mandant is null or app.aktueller_benutzer() is null or app.ist_readonly() then
    raise exception 'Krankheit im Urlaub: nur in einer Gesellschaft, angemeldet und nicht lesend'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('zeit.abwesenheit_melden', v_mandant)
     or not app.hat_recht('zeit.abwesenheit_genehmigen', v_mandant) then
    raise exception 'Krankheit im Urlaub: erfasst, wer zeit.abwesenheit_melden und zeit.abwesenheit_genehmigen haelt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_von is null or p_bis is null or p_von > p_bis then
    raise exception 'Krankheit im Urlaub: kein Zeitraum (% bis %)', p_von, p_bis
      using errcode = 'invalid_parameter_value';
  end if;

  -- Der Urlaub wird gesperrt: eine gleichzeitige Stornierung wartet, bis die
  -- Gutschrift steht — oder die Gutschrift sieht danach „storniert".
  select u.id, u.anstellung_id into v_urlaub
    from public.abwesenheit u
   where u.id = p_urlaub and u.mandant_id = v_mandant
   for update;
  if not found then
    raise exception 'Krankheit im Urlaub: diesen Urlaub gibt es hier nicht'
      using errcode = 'no_data_found';
  end if;

  -- ab_keine_dublette (0073) wiese dieselbe Art im selben Zeitraum roh ab.
  if exists (select 1 from public.abwesenheit k
              where k.anstellung_id = v_urlaub.anstellung_id and k.abwesenheitsart_id = p_art
                and k.status in ('beantragt', 'genehmigt', 'erfasst')
                and daterange(k.von, k.bis, '[]') && daterange(p_von, p_bis, '[]')) then
    raise exception 'Krankheit im Urlaub: in diesem Zeitraum ist schon eine Abwesenheit dieser Art erfasst'
      using errcode = 'exclusion_violation';
  end if;

  insert into public.abwesenheit
    (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, tage_angerechnet, status,
     au_bescheinigung_vorliegt, au_bis, bemerkung, erstellt_von,
     unterbrochener_urlaub_id, urlaub_gutgeschrieben_tage)
  values
    (v_mandant, v_urlaub.anstellung_id, p_art, p_von, p_bis, p_tage, 'erfasst',
     true, p_au_bis, nullif(btrim(coalesce(p_bemerkung, '')), ''), app.aktueller_benutzer(),
     v_urlaub.id, p_gutschrift)
  returning id into v_neu;

  return v_neu;
end $$;

comment on function app.krankheit_im_urlaub_erfassen(uuid, uuid, date, date, date, text, numeric, numeric) is
  'V-319, O-138, D-853: erfasst die Krankheit im genehmigten Urlaub (AU-Bescheinigung liegt vor) '
  'und gibt die gutgeschriebenen Tage dem Urlaubskonto zurueck (§ 9 BUrlG) — in einer Transaktion; '
  'mit zeit.abwesenheit_melden und zeit.abwesenheit_genehmigen.';

alter function app.krankheit_im_urlaub_erfassen(uuid, uuid, date, date, date, text, numeric, numeric)
  owner to cse_definer;
revoke all on function app.krankheit_im_urlaub_erfassen(uuid, uuid, date, date, date, text, numeric, numeric)
  from public;
grant execute on function app.krankheit_im_urlaub_erfassen(uuid, uuid, date, date, date, text, numeric, numeric)
  to cse_app;

-- Die zwei Policies des Weges. cse_definer liest abwesenheit seit 0073
-- (ab_definer) und haelt insert und update als Tabellenrecht; geschrieben hat
-- er bisher nichts — es gab keine Schreibpolicy.
--   * anlegen: nur eine Krankheit mit Verweis, in der aktiven Gesellschaft
--     (den Rest prueft trg_abwesenheit_gutschrift_anlegen);
--   * sperren: nur den genehmigten Urlaub der aktiven Gesellschaft, fuer das
--     FOR UPDATE oben — aendern nie (with check false).
create policy d_krankheit_im_urlaub on abwesenheit for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant() and unterbrochener_urlaub_id is not null);
create policy d_urlaub_sperren on abwesenheit for update to cse_definer
  using (mandant_id = app.aktiver_mandant() and status = 'genehmigt')
  with check (false);

comment on policy d_krankheit_im_urlaub on abwesenheit is
  'V-319, D-853: app.krankheit_im_urlaub_erfassen legt nur eine Krankheit mit Verweis auf den '
  'unterbrochenen Urlaub an, in der aktiven Gesellschaft.';
comment on policy d_urlaub_sperren on abwesenheit is
  'V-319, D-853: app.krankheit_im_urlaub_erfassen sperrt den genehmigten Urlaub (FOR UPDATE) — '
  'aendern darf cse_definer abwesenheit nie (with check false).';

-- ---------------------------------------------------------------------------
-- 7. Der Lohnexport sagt die Gutschrift mit
-- ---------------------------------------------------------------------------

-- Sonst stuenden fuer dieselben Tage zehn Urlaubstage und drei Krankheitstage
-- im Export, und das Urlaubskonto saehe sieben: die Abweichung fiele erst in
-- der Lohnabrechnung auf. Neu: gutgeschrieben_tage — an der Krankheit die Tage,
-- die sie zurueckgibt; am Urlaub die Summe der geltenden Gutschriften.
-- Die Rueckgabe aendert sich, also drop und create; Rechte wie 0143.
drop function app.lohnexport_abwesenheiten(date, date);

create function app.lohnexport_abwesenheiten(p_von date, p_bis date)
returns table (
  id uuid, anstellung_id uuid, art text, bezeichnung text, bezahlt boolean, lohnart text,
  gesundheitsbezogen boolean, von date, bis date, von_halbtags boolean, bis_halbtags boolean,
  tage_angerechnet numeric, status text, gutgeschrieben_tage numeric
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or not app.hat_recht('zeit.exportieren', v_mandant) then
    raise insufficient_privilege using message =
      'Abwesenheiten mit Art liest nur der Lohnexport (zeit.exportieren).';
  end if;
  return query
    select a.id, a.anstellung_id, art.schluessel, art.bezeichnung, art.bezahlt,
           art.lohnart_schluessel, art.ist_gesundheitsbezogen,
           a.von, a.bis, a.von_halbtags, a.bis_halbtags, a.tage_angerechnet, a.status::text,
           coalesce(a.urlaub_gutgeschrieben_tage,
                    (select sum(k.urlaub_gutgeschrieben_tage) from public.abwesenheit k
                      where k.unterbrochener_urlaub_id = a.id and k.status = 'erfasst'))
      from public.abwesenheit a
      join public.abwesenheitsart art on art.id = a.abwesenheitsart_id
     where a.mandant_id = v_mandant
       and a.storniert_am is null
       and a.status in ('genehmigt', 'erfasst')
       and a.von <= p_bis and a.bis >= p_von
     order by a.von, a.id;
end $$;

comment on function app.lohnexport_abwesenheiten(date, date) is
  'Abwesenheiten eines Zeitraums MIT Art fuer den Lohnexport (ACC-12) — die Art ist cse_app '
  'sonst entzogen (0073). Nur unter zeit.exportieren, nur die aktive Gesellschaft (D-487). '
  'gutgeschrieben_tage: § 9 BUrlG, V-319, D-853.';

alter function app.lohnexport_abwesenheiten(date, date) owner to cse_definer;
revoke execute on function app.lohnexport_abwesenheiten(date, date) from public;
grant execute on function app.lohnexport_abwesenheiten(date, date) to cse_app;
