-- 0013 — der Seed-Pfad, konsistent gemacht.
--
-- `fin.nummernkreis_pruefen` prueft `app.hat_recht('nummernkreis.verwalten')`
-- und kannte als einzige Pruefung dieser Art KEINEN Weg fuer Migration und
-- Seed. Folge: ein Platzhalterkreis liess sich nie bestaetigen — auch nicht
-- von einem Seed —, und damit war keine Rechnung festschreibbar.
--
-- `kern.rolle_berechtigung_pruefen` (0008) macht es bereits richtig: ohne
-- angemeldeten Benutzer laeuft kein Editor, sondern eine Migration, die keine
-- Rolle hat, deren Rechte man pruefen koennte. Dieselbe Regel gilt hier.
--
-- Was NICHT gelockert wird: die drei fachlichen Pruefungen davor. Der Zaehler
-- bewegt sich auch fuer einen Seed nur um eins, die Maske friert auch fuer ihn
-- nach der ersten Vergabe ein, und ein geschlossener Kreis vergibt auch ihm
-- keine Nummern.

create or replace function fin.nummernkreis_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.naechste_nummer <> old.naechste_nummer
     and new.naechste_nummer <> old.naechste_nummer + 1 then
    raise exception 'Nummernkreis: der Zähler darf nur um genau 1 erhöht werden (FIN-03)'
      using errcode = 'restrict_violation';
  end if;

  if old.naechste_nummer > 1
     and (new.format_maske, new.zuruecksetzung, new.kreis_typ, new.jahr, new.kontext_id, new.lueckenlos)
      is distinct from
         (old.format_maske, old.zuruecksetzung, old.kreis_typ, old.jahr, old.kontext_id, old.lueckenlos) then
    raise exception 'Nummernkreis: Maske und Geltungsbereich sind nach der ersten Vergabe unveränderlich (LEG-01)'
      using errcode = 'restrict_violation';
  end if;

  if old.geschlossen_am is not null and new.naechste_nummer <> old.naechste_nummer then
    raise exception 'Nummernkreis: geschlossener Kreis vergibt keine Nummern mehr'
      using errcode = 'restrict_violation';
  end if;

  -- Ohne angemeldeten Benutzer laeuft kein Editor, sondern eine Migration
  -- oder ein Seed. Sie haben keine Rolle, deren Rechte man pruefen koennte.
  if app.aktueller_benutzer() is null then
    return new;
  end if;

  if not app.hat_recht('nummernkreis.verwalten', new.mandant_id)
     and (to_jsonb(new) - 'naechste_nummer' - 'letzter_hash'
                        - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art')
      is distinct from
         (to_jsonb(old) - 'naechste_nummer' - 'letzter_hash'
                        - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art') then
    raise exception 'Nummernkreis: mit nummernkreis.ziehen darf nur der Zähler bewegt werden'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;
