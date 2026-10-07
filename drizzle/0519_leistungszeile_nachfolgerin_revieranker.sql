-- 0519 — Eine Leistungszeile hat eine Nachfolgerin, die Schicht nimmt die
--        Fassung ihres Plantags, und ein Turnus ohne eigene Zeile die seines
--        Reviers (V-360 Nachtrag, V-352, O-921, O-927, D-826).
--
-- (1) auftrag_leistung.ersetzt_id. Eine Preisanpassung ist eine neue Zeile ab
--     dem Stichtag (Voreinstellung O-921, D-796, D-825), und die neue nennt
--     die Zeile, die sie ersetzt. Eine Zeile hat hoechstens eine
--     Nachfolgerin (eindeutiger Index), beide gehoeren zu demselben Auftrag
--     (Schluessel ueber mandant_id und auftrag_id), keine ersetzt sich
--     selbst, und die Kette wird nach dem Anlegen nicht mehr umgeschrieben.
--
-- (2) kern.leistung_am(mandant, zeile, tag): die Fassung einer Zeile, die an
--     einem Tag gilt. Rueckwaerts ueber die Vorgaengerinnen, solange die
--     Zeile erst nach dem Tag beginnt; dann vorwaerts ueber die
--     Nachfolgerinnen, solange sie vor dem Tag endet. Ohne Kette ist es die
--     Zeile selbst. Nur der Ausloeser aus (3) ruft sie, als cse_definer.
--
-- (3) kern.einsatz_auftrag_ableiten (0050, 0430) setzt eine Schicht zuerst auf
--     die Fassung ihres Plantags und leitet danach, wie bisher, den Auftrag
--     aus der Zeile ab. Der Ausloeser feuert jetzt auch, wenn sich der
--     Plantag aendert. Warum das in den Ausloeser gehoert: der Generator
--     schreibt bei jedem Lauf den Anker des Turnus oder Postens auf alle
--     kuenftigen Schichten ohne erfasste Zeit. Ohne die Aufloesung legte er
--     nach einer Preisanpassung jede umgehaengte Schicht in der naechsten
--     Nacht auf die alte Zeile zurueck, und die Stunden ab dem Stichtag
--     gingen mit dem alten Preis in die Abrechnung. Mit ihr bleibt der Anker
--     des Turnus, wie er ist, und jede Schicht bekommt die Fassung ihres
--     Tages. Die Zeilen einer Kette gehoeren demselben Auftrag; ein schon
--     gesetzter Auftrag der Schicht bleibt damit stimmig.
--
-- (4) app.leistung_bindung(zeile, nach): was nach einem Tag an einer Zeile
--     haengt, gezaehlt als cse_definer: gueltige Zeiteintraege (nicht
--     storniert, nicht ersetzt) nach ihrem Berliner Tag, nicht stornierte
--     Schichten nach ihrem Plantag. Beenden und Preisanpassung (V-360)
--     pruefen damit. Vorher zaehlten sie unter der RLS des Aufrufers, und wer
--     Auftraege schreiben, aber Zeiten oder Dienstplan nicht lesen darf, sah
--     null und haette eine Zeile vor erfasster Zeit beenden koennen. Nur in
--     der aktiven Gesellschaft, nicht lesend, unter auftrag.schreiben.
--
-- (5) app.planungsbedarf (0029, 0069): ein Turnus ohne eigene Leistungszeile
--     uebernimmt die seines Reviers; sind beide gesetzt, gilt die des Turnus
--     (Voreinstellung O-927 (2), D-795, V-352). revier.auftrag_leistung_id
--     (0029) las bis hierher niemand. Der Rumpf ist der aus 0069 bis auf
--     diese eine Spalte; Eigentum und Ausfuehrungsrechte bleiben, wie 0069,
--     0093 und 0143 sie gesetzt haben.
--
-- (6) app.abruf_in_rechnung(abruf): steht ein Einzelabruf (sonderleistung) in
--     einer wirksamen Rechnungsposition, auch im Entwurf? Die Vertragszeile
--     eines Abrufs laesst sich bis zur Abrechnung nachtragen und aendern
--     (Voreinstellung O-708, D-789, V-325) — aber nicht, solange ein Entwurf
--     ihn mit dem Preis der bisherigen Zeile fuehrt. Gelesen als cse_definer
--     (d_quelle_lesen, 0107), weil die Reinigung die Rechnungsherkunft sonst
--     nicht sieht. Nur unter reinigung.schreiben in der aktiven Gesellschaft.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Die Nachfolgerin einer Zeile
-- ---------------------------------------------------------------------------

alter table auftrag_leistung add column ersetzt_id uuid;

alter table auftrag_leistung add constraint auftrag_leistung_ersetzt_fk
  foreign key (mandant_id, auftrag_id, ersetzt_id)
  references auftrag_leistung (mandant_id, auftrag_id, id);

alter table auftrag_leistung add constraint auftrag_leistung_ersetzt_nicht_selbst
  check (ersetzt_id is null or ersetzt_id <> id);

create unique index auftrag_leistung_ersetzt_uk on auftrag_leistung (ersetzt_id)
  where ersetzt_id is not null;

comment on column auftrag_leistung.ersetzt_id is
  'V-360, O-921, D-826. Die Zeile, die diese ab ihrem gueltig_ab ersetzt '
  '(Preisanpassung). Hoechstens eine Nachfolgerin je Zeile, beide am selben '
  'Auftrag; nach dem Anlegen unveraenderlich.';

create function kern.leistung_ersetzt_unveraenderlich() returns trigger
language plpgsql as $$
begin
  if new.ersetzt_id is distinct from old.ersetzt_id then
    raise exception 'Die Vorgaengerin einer Leistungszeile wird nicht umgeschrieben'
      using errcode = 'check_violation',
            detail  = 'auftrag_leistung.ersetzt_id ist nach dem Anlegen fest (D-826).',
            hint    = 'Eine andere Preisanpassung ist eine neue Zeile.';
  end if;
  return new;
end $$;

comment on function kern.leistung_ersetzt_unveraenderlich() is
  'Haelt die Kette der Leistungszeilen fest (D-826): ersetzt_id aendert sich '
  'nach dem Anlegen nicht.';

revoke execute on function kern.leistung_ersetzt_unveraenderlich() from public;

create trigger trg_auftrag_leistung_ersetzt_fest
  before update of ersetzt_id on auftrag_leistung
  for each row execute function kern.leistung_ersetzt_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 2. Die Fassung einer Zeile an einem Tag
-- ---------------------------------------------------------------------------

create function kern.leistung_am(p_mandant uuid, p_zeile uuid, p_tag date) returns uuid
language plpgsql stable
set search_path = pg_catalog, public as $$
declare
  v_zeile    uuid := p_zeile;
  v_ab       date;
  v_bis      date;
  v_vorher   uuid;
  v_weiter   uuid;
  v_schritte integer := 0;
begin
  if p_zeile is null or p_tag is null then
    return p_zeile;
  end if;
  -- Rueckwaerts, solange die Zeile erst nach dem Tag beginnt.
  loop
    v_schritte := v_schritte + 1;
    select al.gueltig_ab, al.ersetzt_id into v_ab, v_vorher
      from public.auftrag_leistung al
     where al.mandant_id = p_mandant and al.id = v_zeile;
    exit when not found or v_vorher is null or p_tag >= v_ab or v_schritte > 100;
    v_zeile := v_vorher;
  end loop;
  -- Vorwaerts, solange sie vor dem Tag endet und eine Nachfolgerin hat.
  loop
    v_schritte := v_schritte + 1;
    select al.gueltig_bis into v_bis
      from public.auftrag_leistung al
     where al.mandant_id = p_mandant and al.id = v_zeile;
    exit when not found or v_bis is null or p_tag <= v_bis or v_schritte > 200;
    select al.id into v_weiter
      from public.auftrag_leistung al
     where al.mandant_id = p_mandant and al.ersetzt_id = v_zeile;
    exit when not found;
    v_zeile := v_weiter;
  end loop;
  return v_zeile;
end $$;

comment on function kern.leistung_am(uuid, uuid, date) is
  'Die Fassung einer Leistungszeile, die an einem Tag gilt (D-826): rueckwaerts '
  'ueber ersetzt_id, solange sie erst danach beginnt, vorwaerts ueber die '
  'Nachfolgerin, solange sie davor endet. Ohne Kette die Zeile selbst.';

alter function kern.leistung_am(uuid, uuid, date) owner to cse_definer;
revoke execute on function kern.leistung_am(uuid, uuid, date) from public;

-- ---------------------------------------------------------------------------
-- 3. Die Schicht nimmt die Fassung ihres Plantags (ersetzt 0050 und 0430)
-- ---------------------------------------------------------------------------

create or replace function kern.einsatz_auftrag_ableiten() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_auftrag uuid;
  v_zeile   uuid;
begin
  if new.auftrag_leistung_id is null then
    return new;
  end if;
  v_zeile := kern.leistung_am(new.mandant_id, new.auftrag_leistung_id, new.plan_datum);
  if v_zeile is distinct from new.auftrag_leistung_id then
    new.auftrag_leistung_id := v_zeile;
  end if;
  if new.auftrag_id is not null then
    return new;
  end if;
  select al.auftrag_id into v_auftrag
    from public.auftrag_leistung al
   where al.mandant_id = new.mandant_id and al.id = new.auftrag_leistung_id;
  if not found then
    raise exception 'Die Leistungszeile dieser Schicht gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation',
            detail  = 'einsatz.auftrag_leistung_id zeigt auf keine Zeile dieses Mandanten.',
            hint    = 'Anker der Bedarfsquelle (turnus, posten) pruefen.';
  end if;
  new.auftrag_id := v_auftrag;
  return new;
end $$;

comment on function kern.einsatz_auftrag_ableiten() is
  'Setzt eine Schicht auf die Fassung ihrer Leistungszeile am Plantag (D-826) '
  'und leitet einsatz.auftrag_id aus der Zeile ab (TIM-12, FIN-07). Als '
  'cse_definer seit 0430 (V-192).';

alter function kern.einsatz_auftrag_ableiten() owner to cse_definer;
revoke execute on function kern.einsatz_auftrag_ableiten() from public;

drop trigger trg_einsatz_auftrag_ableiten on einsatz;
create trigger trg_einsatz_auftrag_ableiten
  before insert or update of auftrag_leistung_id, plan_datum on einsatz
  for each row execute function kern.einsatz_auftrag_ableiten();

-- ---------------------------------------------------------------------------
-- 4. Was nach einem Tag an einer Zeile haengt
-- ---------------------------------------------------------------------------

create function app.leistung_bindung(p_zeile uuid, p_nach date)
returns table (zeiten integer, schichten integer)
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or app.ist_readonly()
     or not app.hat_recht('auftrag.schreiben', v_mandant) then
    raise exception 'Was an einer Leistungszeile haengt, zaehlt nur, wer Auftraege schreiben darf'
      using errcode = 'insufficient_privilege';
  end if;
  if p_zeile is null or p_nach is null then
    raise exception 'Zeile und Tag sind Pflicht'
      using errcode = 'null_value_not_allowed';
  end if;
  if not exists (select 1 from public.auftrag_leistung al
                  where al.mandant_id = v_mandant and al.id = p_zeile) then
    raise exception 'Diese Leistungszeile gibt es in dieser Gesellschaft nicht'
      using errcode = 'no_data_found';
  end if;
  return query
    select (select count(*)::integer from public.zeiteintrag z
             where z.mandant_id = v_mandant and z.auftrag_leistung_id = p_zeile
               and z.storniert_am is null and z.ersetzt_am is null
               and (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date > p_nach),
           (select count(*)::integer from public.einsatz e
             where e.mandant_id = v_mandant and e.auftrag_leistung_id = p_zeile
               and e.storniert_am is null
               and e.plan_datum > p_nach);
end $$;

comment on function app.leistung_bindung(uuid, date) is
  'V-360, D-826. Zeiteintraege und Schichten an einer Leistungszeile nach einem '
  'Tag, gezaehlt unabhaengig von den Leserechten des Aufrufers. Nur unter '
  'auftrag.schreiben in der aktiven Gesellschaft.';

alter function app.leistung_bindung(uuid, date) owner to cse_definer;
revoke execute on function app.leistung_bindung(uuid, date) from public;
grant execute on function app.leistung_bindung(uuid, date) to cse_app;

-- ---------------------------------------------------------------------------
-- 5. Der Turnus uebernimmt die Zeile seines Reviers (ersetzt 0029 und 0069)
-- ---------------------------------------------------------------------------

create or replace function app.planungsbedarf(p_mandant uuid, p_von date, p_bis date)
returns table (planungsserie_id uuid, quelle einsatz_quelle, carrier_id uuid,
               objekt_id uuid, revier_id uuid, posten_id uuid, veranstaltung_id uuid,
               auftrag_leistung_id uuid, rrule text, dtstart_lokal timestamp, zeitzone text,
               dauer_minuten integer, soll_besetzung smallint, min_besetzung smallint,
               feiertagsregel turnus_feiertagsregel, gueltig_ab date, gueltig_bis date)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if p_mandant is null then
    raise exception 'app.planungsbedarf ohne Mandant aufgerufen'
      using errcode = 'null_value_not_allowed',
            detail  = 'Der Generator laeuft je Mandant; ohne ihn waere die Antwort '
                      || 'mandantenuebergreifend.',
            hint    = 'job:turnus_generator ruft je Mandant einmal auf.';
  end if;
  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'Das Planungsfenster ist leer oder verkehrt herum'
      using errcode = 'invalid_parameter_value',
            detail  = format('p_von = %s, p_bis = %s.', p_von, p_bis),
            hint    = 'p_bis muss auf oder nach p_von liegen.';
  end if;

  return query
    -- Zweig 1, turnus (CLN-02). Die Leistungszeile ist die des Turnus, sonst
    -- die seines Reviers (O-927 (2), V-352).
    select ps.id,
           'turnus'::einsatz_quelle,
           t.id,
           r.objekt_id,
           t.revier_id,
           null::uuid,
           null::uuid,
           coalesce(t.auftrag_leistung_id, r.auftrag_leistung_id),
           t.rrule,
           t.dtstart_lokal,
           t.zeitzone,
           t.dauer_minuten,
           1::smallint,
           1::smallint,
           t.feiertagsregel,
           t.gueltig_ab,
           t.gueltig_bis
      from public.turnus t
      join public.revier r
        on r.id = t.revier_id
       and r.mandant_id = t.mandant_id
      left join public.planungsserie ps
        on ps.turnus_id = t.id
       and ps.mandant_id = t.mandant_id
       and ps.archiviert_am is null
     where t.mandant_id = p_mandant
       and t.archiviert_am is null
       and t.gueltig_ab <= p_bis
       and (t.gueltig_bis is null or t.gueltig_bis >= p_von)

    -- Zweig 2, posten (SEC-01), wie 0069: keine feiertagsregel (sie ist NULL,
    -- nicht ausfall; 0028 8.5), und ein Posten ohne abdeckung_rrule kommt mit
    -- rrule = null durch, weil er durchgehend besetzt ist.
    union all
    select ps.id,
           'posten'::einsatz_quelle,
           p.id,
           p.objekt_id,
           null::uuid,
           p.id,
           null::uuid,
           p.auftrag_leistung_id,
           p.abdeckung_rrule,
           p.dtstart_lokal,
           p.zeitzone,
           p.dauer_minuten,
           p.soll_besetzung,
           p.min_besetzung,
           null::turnus_feiertagsregel,
           p.gueltig_ab,
           p.gueltig_bis
      from public.posten p
      left join public.planungsserie ps
        on ps.posten_id = p.id
       and ps.mandant_id = p.mandant_id
       and ps.archiviert_am is null
     where p.mandant_id = p_mandant
       and p.archiviert_am is null
       and p.gueltig_ab <= p_bis
       and (p.gueltig_bis is null or p.gueltig_bis >= p_von)

    -- Zweig 3, veranstaltung (SEC-08), bleibt Platzhalter wie in 0069.
    union all
    select null::uuid, 'veranstaltung'::einsatz_quelle, null::uuid,
           null::uuid, null::uuid, null::uuid, null::uuid,
           null::uuid, null::text, null::timestamp, null::text,
           null::integer, null::smallint, null::smallint,
           null::turnus_feiertagsregel, null::date, null::date
     where false;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Steht ein Abruf in einer Rechnung?
-- ---------------------------------------------------------------------------

create function app.abruf_in_rechnung(p_abruf uuid) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or app.ist_readonly()
     or not app.hat_recht('reinigung.schreiben', v_mandant) then
    raise exception 'Ob ein Abruf in einer Rechnung steht, fragt nur, wer Abrufe pflegen darf'
      using errcode = 'insufficient_privilege';
  end if;
  return exists (
    select 1 from public.rechnungsposition_quelle q
     where q.mandant_id = v_mandant and q.sonderleistung_id = p_abruf
       and q.quelle_typ = 'sonderleistung' and q.wirksam);
end $$;

comment on function app.abruf_in_rechnung(uuid) is
  'V-325, D-826. Steht der Abruf in einer wirksamen Rechnungsposition (auch im '
  'Entwurf)? Dann bleibt seine Vertragszeile, wie sie ist.';

alter function app.abruf_in_rechnung(uuid) owner to cse_definer;
revoke execute on function app.abruf_in_rechnung(uuid) from public;
grant execute on function app.abruf_in_rechnung(uuid) to cse_app;
