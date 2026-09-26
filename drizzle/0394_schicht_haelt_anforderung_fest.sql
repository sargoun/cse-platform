-- ===========================================================================
-- 0394 — Die Schicht haelt fest, was DAMALS verlangt war (V-129, D-624,
--        03-GEWERKE §9.2/§9.4, SEC-04, TIM-05)
-- ===========================================================================
-- **Der Befund** (V-129). 0028 legte an jeder Schicht zwei Spalten an:
--   anforderung_snapshot  — „die zur Materialisierung aufgeloeste
--                            Anforderungsmenge ... SEC-04 wird an dem
--                            gemessen, was DAMALS verlangt war"
--   anforderung_erfuellt  — „NULL = noch nicht bewertet. Trennt unbesetzt
--                            von mit der falschen Qualifikationsmischung
--                            besetzt"
-- Eine Suche ueber das ganze Projekt fand beide Namen genau einmal: dort, wo
-- sie angelegt wurden. Kein Dienst, kein Ausloeser, kein Job schrieb sie.
--
-- **Die Entscheidung (D-624): die Zusage einloesen, nicht streichen.**
--
--   1. Beim ANLEGEN einer Schicht — Generator, Einzelschicht, Eventbesetzung,
--      Seed, Konsole: jeder Weg — loest ein BEFORE-Ausloeser die
--      Anforderungsmenge auf und schreibt sie in den Schnappschuss. Derselbe
--      Filter wie app.qualifikationsanforderung (0031): vier Bereiche
--      additiv, lebend, gueltig_ab gegen den BERLINER Tag des Beginns (K-11).
--   2. Bis zum BEGINN der Schicht folgt der Schnappschuss dem Katalog: bei
--      jeder Besetzungsaenderung wird er neu aufgeloest. Das ist dieselbe
--      Menge, die das harte Tor je Zuordnung in diesem Moment prueft
--      (app.einsatz_qualifikation_erfuellt liest live) — Schnappschuss und
--      Tor koennen also nicht auseinanderlaufen, solange die Schicht in der
--      Zukunft liegt.
--   3. AB dem Beginn ist er eingefroren. Ein spaeter geaenderter Katalog
--      macht eine vergangene Schicht nicht rueckwirkend falsch besetzt — das
--      ist genau das Versprechen aus 0028.
--   4. anforderung_erfuellt wird bei jeder Besetzungsaenderung GEGEN DEN
--      SCHNAPPSCHUSS bewertet (§9.4): „jeder" heisst jede lebende Zuordnung
--      haelt den Nachweis am Schichttag, „mindestens_einer" heisst
--      mindestens mindestanzahl davon; eine Anforderung mit Registerpflicht
--      zaehlt nur Menschen mit lebender Eintragung. NULL, solange niemand
--      eingeteilt ist — unbesetzt ist etwas anderes als falsch gemischt.
--   5. Die Bewertung MELDET und sperrt nicht. Gesperrt wird weiter je
--      Zuordnung (das harte Tor aus 0031); die Zwischenstands-Regel
--      ea_geltung_zwischenstand bleibt, bis die verzoegerte Sperre aus §9.4
--      gebaut ist. Eine Sperre auf Schichtebene erzwaenge eine Reihenfolge
--      beim Einteilen („erst die Ersthelferin, dann die anderen"), und die zu
--      erfinden ist nicht Sache dieser Migration.
--
-- **Eigentum** (K-01): jede neue Definer-Funktion gehoert cse_definer, setzt
-- ihren search_path und gibt PUBLIC kein EXECUTE. cse_definer bekommt dafuer
-- Leserechte auf genau die Spalten, die die Bewertung liest, und das
-- Schreibrecht auf genau die zwei Spalten, die sie schreibt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Rechte, die die Bewertung braucht — und nicht mehr
-- ---------------------------------------------------------------------------

grant select (id, mandant_id, geltungsbereich, posten_id, veranstaltung_id, objekt_id,
              qualifikation_id, zwingend, geltung, mindestanzahl, gueltig_ab,
              bewacherregister_pflicht, rechtsgrundlage, ist_platzhalter, archiviert_am)
      on einsatzanforderung to cse_definer;
grant select (person_id, qualifikation_id, status, widerrufen_am, gueltig_ab, gueltig_bis)
      on nachweis to cse_definer;
grant select (person_id, erloschen_am, status, gueltig_bis)
      on bewacher_eintrag to cse_definer;
grant update (anforderung_snapshot, anforderung_erfuellt) on einsatz to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Die Aufloesung — aus den SPALTEN einer Schicht, nicht aus ihrer id
-- ---------------------------------------------------------------------------
-- Aus den Spalten, weil der BEFORE-INSERT-Ausloeser die Zeile noch nicht in
-- der Tabelle hat: app.qualifikationsanforderung(p_einsatz) fände sie nicht.
-- Sortiert nach Qualifikation und id, damit derselbe Katalog denselben
-- Schnappschuss ergibt — ein Vergleich „hat sich etwas geaendert" ist sonst
-- ein Vergleich von Reihenfolgen.

create function kern.anforderung_aufloesen(
  p_mandant uuid, p_objekt uuid, p_posten uuid, p_veranstaltung uuid,
  p_beginn timestamptz)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'anforderung_id',           a.id,
           'qualifikation_id',         a.qualifikation_id,
           'geltungsbereich',          a.geltungsbereich,
           'zwingend',                 a.zwingend,
           'geltung',                  a.geltung,
           'mindestanzahl',            a.mindestanzahl,
           'bewacherregister_pflicht', a.bewacherregister_pflicht,
           'rechtsgrundlage',          a.rechtsgrundlage,
           'ist_platzhalter',          a.ist_platzhalter)
         order by a.qualifikation_id, a.id), '[]'::jsonb)
    from public.einsatzanforderung a
   where a.archiviert_am is null
     and (a.gueltig_ab is null
          or a.gueltig_ab <= (p_beginn at time zone 'Europe/Berlin')::date)
     and (   (a.geltungsbereich = 'posten'        and a.posten_id        = p_posten)
          or (a.geltungsbereich = 'veranstaltung' and a.veranstaltung_id = p_veranstaltung)
          or (a.geltungsbereich = 'objekt'        and a.objekt_id        = p_objekt)
          or (a.geltungsbereich = 'mandant'       and a.mandant_id       = p_mandant));
$$;

alter function kern.anforderung_aufloesen(uuid, uuid, uuid, uuid, timestamptz)
  owner to cse_definer;
revoke execute on function kern.anforderung_aufloesen(uuid, uuid, uuid, uuid, timestamptz)
  from public;
grant execute on function kern.anforderung_aufloesen(uuid, uuid, uuid, uuid, timestamptz)
  to cse_app, cse_job, cse_definer;

comment on function kern.anforderung_aufloesen(uuid, uuid, uuid, uuid, timestamptz) is
  'V-129, D-624: die Anforderungsmenge einer Schicht aus ihren Spalten — derselbe '
  'Filter wie app.qualifikationsanforderung (0031), als sortiertes jsonb-Feld.';

-- ---------------------------------------------------------------------------
-- 3. Die Bewertung der Mischung gegen einen Schnappschuss (§9.4)
-- ---------------------------------------------------------------------------

create function kern.anforderung_mischung(p_einsatz uuid, p_snapshot jsonb)
returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_stichtag date;
  v_lebend   integer;
  v_halter   integer;
  a          jsonb;
begin
  select (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
    into v_stichtag
    from public.einsatz e where e.id = p_einsatz;
  if v_stichtag is null or p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'array' then
    return null;
  end if;

  select count(*) into v_lebend
    from public.einsatz_zuordnung z
   where z.einsatz_id = p_einsatz
     and z.entfernt_am is null and z.abgesagt_am is null;
  -- Unbesetzt ist nicht falsch gemischt (0028): NULL.
  if v_lebend = 0 then return null; end if;

  for a in select * from jsonb_array_elements(p_snapshot) loop
    select count(*) into v_halter
      from public.einsatz_zuordnung z
      join public.anstellung an on an.id = z.anstellung_id
     where z.einsatz_id = p_einsatz
       and z.entfernt_am is null and z.abgesagt_am is null
       and exists (
         select 1 from public.nachweis n
          where n.person_id        = an.person_id
            and n.qualifikation_id = (a->>'qualifikation_id')::uuid
            and n.status           = 'gueltig'
            and n.widerrufen_am is null
            and n.gueltig_ab <= v_stichtag
            and (n.gueltig_bis is null or n.gueltig_bis >= v_stichtag))
       and (coalesce((a->>'bewacherregister_pflicht')::boolean, false) = false
            or exists (
              select 1 from public.bewacher_eintrag b
               where b.person_id = an.person_id
                 and b.erloschen_am is null
                 and b.status = 'registriert'
                 and (b.gueltig_bis is null or b.gueltig_bis >= v_stichtag)));

    if a->>'geltung' = 'jeder' and v_halter < v_lebend then
      return false;
    end if;
    if a->>'geltung' = 'mindestens_einer'
       and v_halter < coalesce((a->>'mindestanzahl')::integer, 1) then
      return false;
    end if;
  end loop;
  return true;
end $$;

alter function kern.anforderung_mischung(uuid, jsonb) owner to cse_definer;
revoke execute on function kern.anforderung_mischung(uuid, jsonb) from public;
grant execute on function kern.anforderung_mischung(uuid, jsonb) to cse_app, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- 4. Beim Anlegen: der Schnappschuss (jeder Weg, der eine Schicht anlegt)
-- ---------------------------------------------------------------------------

create function kern.einsatz_anforderung_stempeln() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  new.anforderung_snapshot := kern.anforderung_aufloesen(
    new.mandant_id, new.objekt_id, new.posten_id, new.veranstaltung_id,
    new.beginn_zeitpunkt);
  -- Neu angelegt ist niemand eingeteilt: nicht bewertet, nicht „falsch".
  new.anforderung_erfuellt := null;
  return new;
end $$;

alter function kern.einsatz_anforderung_stempeln() owner to cse_definer;

create trigger trg_einsatz_anforderung_stempeln
  before insert on einsatz
  for each row execute function kern.einsatz_anforderung_stempeln();

-- ---------------------------------------------------------------------------
-- 5. Bei jeder Besetzungsaenderung: nachziehen bis zum Beginn, bewerten immer
-- ---------------------------------------------------------------------------

create function kern.einsatz_anforderung_bewerten() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_einsaetze uuid[] := array[new.einsatz_id];
  v_einsatz   uuid;
  e           record;
  v_snapshot  jsonb;
begin
  if tg_op = 'UPDATE' then
    if old.einsatz_id is distinct from new.einsatz_id then
      v_einsaetze := v_einsaetze || old.einsatz_id;
    end if;
  end if;

  foreach v_einsatz in array v_einsaetze loop
    select x.id, x.mandant_id, x.objekt_id, x.posten_id, x.veranstaltung_id,
           x.beginn_zeitpunkt, x.anforderung_snapshot
      into e
      from public.einsatz x where x.id = v_einsatz;
    continue when e.id is null;

    -- Bis zum Beginn folgt der Schnappschuss dem Katalog, danach nie mehr.
    v_snapshot := case
      when e.beginn_zeitpunkt > now() or e.anforderung_snapshot = '{}'::jsonb
        then kern.anforderung_aufloesen(e.mandant_id, e.objekt_id, e.posten_id,
                                        e.veranstaltung_id, e.beginn_zeitpunkt)
      else e.anforderung_snapshot
    end;

    update public.einsatz x
       set anforderung_snapshot = v_snapshot,
           anforderung_erfuellt = kern.anforderung_mischung(x.id, v_snapshot)
     where x.id = v_einsatz
       and (x.anforderung_snapshot is distinct from v_snapshot
            or x.anforderung_erfuellt is distinct from
               kern.anforderung_mischung(x.id, v_snapshot));
  end loop;
  return null;
end $$;

alter function kern.einsatz_anforderung_bewerten() owner to cse_definer;

create trigger trg_einsatz_anforderung_bewerten
  after insert or update of entfernt_am, abgesagt_am, status, anstellung_id, einsatz_id
  on einsatz_zuordnung
  for each row execute function kern.einsatz_anforderung_bewerten();

-- ---------------------------------------------------------------------------
-- 6. Der Bestand: jede Schicht bekommt ihren Schnappschuss und ihre Bewertung
-- ---------------------------------------------------------------------------
-- Fuer eine VERGANGENE Schicht ist das der Katalog von heute — ein besseres
-- „damals" gibt es fuer sie nicht mehr, und das steht hier, statt es zu
-- verschweigen. Ab jetzt friert jede Schicht an ihrem Beginn ein.

update einsatz e
   set anforderung_snapshot = kern.anforderung_aufloesen(
         e.mandant_id, e.objekt_id, e.posten_id, e.veranstaltung_id, e.beginn_zeitpunkt)
 where e.anforderung_snapshot = '{}'::jsonb;

update einsatz e
   set anforderung_erfuellt = kern.anforderung_mischung(e.id, e.anforderung_snapshot)
 where e.anforderung_erfuellt is distinct from
       kern.anforderung_mischung(e.id, e.anforderung_snapshot);

comment on column einsatz.anforderung_snapshot is
  'V-129, D-624: die aufgeloeste Anforderungsmenge (jsonb-Feld). Gesetzt beim '
  'Anlegen, nachgezogen bei jeder Besetzungsaenderung bis zum Beginn, danach '
  'eingefroren. Fuer Schichten vor 0394 der Katalog vom Tag der Migration.';
comment on column einsatz.anforderung_erfuellt is
  'V-129, D-624: die Mischung gegen den Schnappschuss (§9.4) — NULL unbesetzt, '
  'true erfuellt, false falsch gemischt. Meldet, sperrt nicht; gesperrt wird je '
  'Zuordnung (0031). Bewertet bei jeder Besetzungsaenderung.';
