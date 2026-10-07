-- 0530 — Eine Freistellungsbescheinigung aendert sich nach dem Anlegen nicht
--        mehr; widerrufen wird einmal und nie rueckwirkend
--        (V-283, O-604, D-779, D-845, Paragraph 48b EStG)
--
-- Der Befund: freistellungsbescheinigung (0118) hatte keinen Schreibweg
-- ausser dem Seed, und cse_app haelt UPDATE auf der ganzen Zeile
-- (finanzen.schreiben, t_mandant). Mit dem Schreibweg aus V-283
-- (finanz/freistellung.ts) wird die Zeile gepflegt — und eine Bescheinigung
-- ist ein Beleg: ein festgeschriebener Beleg nennt sie (rechnung und
-- eingangsrechnung tragen freistellungsbescheinigung_id, die Nutzlast ihre
-- Nummer, ihren Zeitraum und ihr Finanzamt). Eine nachtraeglich geaenderte
-- Nummer oder ein verschobener Zeitraum liesse jede Bewertung von gestern
-- auf eine Bescheinigung zeigen, die es so nie gab.
--
-- Der Ausloeser haelt fest:
--   * Traeger, Nummer, Finanzamt, Zeitraum, Umfang und Auftrag aendern sich
--     nicht. Eine falsch erfasste Bescheinigung wird widerrufen und neu
--     angelegt.
--   * widerrufen_am wird EINMAL gesetzt, nicht vor dem heutigen Berliner
--     Tag und nicht nach ihrem letzten gueltigen Tag: ein Widerruf beendet
--     die Bescheinigung ab seinem Tag, rueckwirkend nie (0118) — fuer die
--     Zeit davor durfte ausgezahlt werden —, und nach dem Ablauf widerriefe
--     er nichts mehr.
--   * dokument_id (der Beleg) wird EINMAL verknuepft und dann nicht mehr
--     getauscht.
-- Geaendert-Spalten bleiben frei.
--
-- Nur Kommentare mit Doppelstrich.

create function kern.freistellung_fest() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.kunde_id is distinct from old.kunde_id
     or new.lieferant_id is distinct from old.lieferant_id
     or new.bescheinigung_nummer is distinct from old.bescheinigung_nummer
     or new.finanzamt is distinct from old.finanzamt
     or new.gueltig_von is distinct from old.gueltig_von
     or new.gueltig_bis is distinct from old.gueltig_bis
     or new.umfang is distinct from old.umfang
     or new.auftrag_id is distinct from old.auftrag_id then
    raise exception 'Eine Freistellungsbescheinigung aendert sich nach dem Anlegen nicht'
      using errcode = 'check_violation',
            detail  = 'Festgeschriebene Belege nennen ihre Nummer, ihren Zeitraum und ihr '
                      || 'Finanzamt (V-283).',
            hint    = 'Eine falsch erfasste Bescheinigung wird widerrufen und neu angelegt.';
  end if;
  if old.widerrufen_am is not null
     and new.widerrufen_am is distinct from old.widerrufen_am then
    raise exception 'Ein Widerruf wird nicht geaendert und nicht zurueckgenommen'
      using errcode = 'check_violation';
  end if;
  if old.widerrufen_am is null and new.widerrufen_am is not null
     and new.widerrufen_am < app.berlin_heute() then
    raise exception 'Ein Widerruf wirkt nicht rueckwirkend (Paragraph 48b EStG, 0118)'
      using errcode = 'check_violation',
            detail  = 'Fuer die Zeit vor dem Widerruf durfte ohne Einbehalt ausgezahlt werden.';
  end if;
  if old.widerrufen_am is null and new.widerrufen_am is not null
     and new.widerrufen_am > old.gueltig_bis then
    raise exception 'Ein Widerruf nach dem Ablauf widerriefe nichts'
      using errcode = 'check_violation',
            detail  = 'Die Bescheinigung endet ohnehin an ihrem letzten gueltigen Tag.';
  end if;
  if old.dokument_id is not null
     and new.dokument_id is distinct from old.dokument_id then
    raise exception 'Der Beleg einer Freistellungsbescheinigung wird nicht getauscht'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.freistellung_fest() is
  'V-283, D-845. Haelt eine Freistellungsbescheinigung nach dem Anlegen fest: '
  'Kernfelder unveraenderlich, Widerruf einmal, nicht rueckwirkend und nicht nach dem '
  'Ablauf, Beleg einmal.';

create trigger trg_freistellung_fest
  before update on freistellungsbescheinigung
  for each row execute function kern.freistellung_fest();
