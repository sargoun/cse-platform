-- 0527 — Eine versendete Mahnung laesst sich als erledigt vermerken
--        (V-084, V-313, D-840)
--
-- fin.mahnung_uebergang (angelegt in 0125, ersetzt in 0130; 0449 nennt sie nur)
-- sperrte jeden Wechsel aus versendet, erledigt und verworfen, BEVOR es den
-- einzigen erlaubten Weg aus versendet heraus pruefte: versendet -> erledigt.
-- Die Regel stand im Rumpf, war aber nie erreichbar — der Knopf „Als erledigt
-- vermerken" (V-084) scheiterte an der Datenbank, und kein Test hatte es je
-- versucht. Gefunden beim Bau von V-313 (D-840): eine erledigte Sache braucht
-- keine Folgeaktion mehr, und genau diesen Fall konnte der Test nicht anlegen.
--
-- Diese Fassung ist die aus 0130, Wort fuer Wort, mit einer Aenderung: die
-- Pruefung auf versendet -> erledigt steht VOR der Sperre. Alles andere —
-- Freigabesatz (K-13), Nummernkreis unter FOR UPDATE, Versandzeit — bleibt.
-- create or replace behaelt Eigentuemer, Rechte und den Ausloeser.

create or replace function fin.mahnung_uebergang() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_kreis  record;
  v_nummer bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- V-084, V-313: der eine Weg aus versendet heraus, VOR der Sperre.
  if old.status = 'versendet' and new.status = 'erledigt' then
    return new;
  end if;

  if old.status in ('versendet', 'erledigt', 'verworfen') then
    raise exception 'Eine Mahnung im Zustand „%" wird nicht mehr umgestellt.', old.status
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'verworfen' then
    if old.status <> 'entwurf' then
      raise exception
        'Nur ein Entwurf wird verworfen — eine freigegebene Mahnung traegt eine Nummer.'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'entwurf' and new.status = 'freigegeben' then
    if new.freigabe_id is null then
      raise exception 'Eine Freigabe ohne Freigabesatz gibt es nicht (K-13, Invariante 7).'
        using errcode = 'check_violation';
    end if;
    -- Ueber app.freigabe_genehmigt (0123) und nicht mit einem eigenen select:
    -- die Antwort haengt sonst am Recht versand.lesen des Freigebenden, und wem
    -- es fehlt, dem sagt die Datenbank, die Freigabe stehe nicht auf genehmigt,
    -- ueber eine Zeile, die genehmigt ist.
    if not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id, 'mahnung_senden') then
      raise exception 'Es liegt keine genehmigte Freigabe fuer mahnung_senden vor (K-13).'
        using errcode = 'check_violation';
    end if;

    select nk.* into v_kreis
      from public.nummernkreis nk
     where nk.mandant_id = new.mandant_id and nk.kreis_typ = 'mahnung'
       and nk.kontext_id is null and nk.geschlossen_am is null
       for update;
    if not found then
      raise exception 'Fuer diese Gesellschaft ist kein Kreis mahnung offen.'
        using errcode = 'restrict_violation';
    end if;
    if v_kreis.ist_platzhalter then
      raise exception 'Nummernkreis %: unbestaetigt — er vergibt keine Nummer.',
        v_kreis.bezeichnung using errcode = 'restrict_violation';
    end if;

    v_nummer := v_kreis.naechste_nummer;
    update public.nummernkreis set naechste_nummer = naechste_nummer + 1
     where id = v_kreis.id;

    new.nummernkreis_id  := v_kreis.id;
    new.nummer           := fin.nummer_formatieren(v_kreis.format_maske, v_nummer, v_kreis.jahr);
    new.freigegeben_am   := coalesce(new.freigegeben_am, now());
    new.freigegeben_von  := coalesce(new.freigegeben_von, app.aktueller_benutzer());
    return new;
  end if;

  if old.status = 'freigegeben' and new.status = 'versendet' then
    new.versendet_am := coalesce(new.versendet_am, now());
    return new;
  end if;

  raise exception 'Der Uebergang % → % ist nicht vorgesehen.', old.status, new.status
    using errcode = 'restrict_violation';
end $$;
