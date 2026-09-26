-- ===========================================================================
-- 0430 — Die Ableitung des Auftrags aus der Leistungszeile liest als
--        cse_definer (V-192, D-686, TIM-12; ersetzt die Fassung aus 0050)
-- ===========================================================================
--
-- **Der Befund.** kern.einsatz_auftrag_ableiten (0050) lief als die
-- AUFRUFENDE Rolle, und auftrag_leistung liegt hinter auftrag.lesen
-- (t_mandant, 0050). Der Generator, den eine Planung beim Anlegen oder Aendern
-- einer Serie, beim Anlegen einer Ausnahme oder am Postenblatt sofort startet
-- (generiereEinsaetze mit eigen = true), laeuft ueber ALLE Serien der
-- Gesellschaft, und sein Upsert feuert den BEFORE-INSERT-Ausloeser fuer jede
-- vorgeschlagene Zeile, auch fuer die, die im Konfliktzweig landet. Traegt
-- auch nur eine Serie einen Anker, fand eine Planung mit dienstplan.schreiben
-- und ohne auftrag.lesen die Zeile nicht, der Ausloeser warf 23503, und der
-- ganze Lauf brach ab, auch fuer eine fremde, unverankerte Serie. Die
-- Standardrollen halten beide Rechte, eine eigene Rolle nicht zwingend. Seit
-- V-191 kommen Anker ueber die Oberflaeche in den Betrieb, nicht mehr nur aus
-- dem Seed.
--
-- **Warum 0050 es anders machte, und warum das nicht mehr gilt.** 0050
-- begruendete die Aufrufer-Rolle mit der geschlossenen Liste der
-- cse_definer-Policies (04-PLANUNG-ZEIT §1.1), auf der auftrag_leistung damals
-- nicht stand. 0107 hat sie aufgenommen: grant select on auftrag_leistung to
-- cse_definer und die Policy d_auftrag_leistung_lesen. Diese Migration braucht
-- deshalb weder einen neuen Grant noch eine neue Policy, und die Liste waechst
-- nicht.
--
-- **Was die Funktion liest, und was ein Aufrufer daraus erfaehrt.** Genau
-- eine Spalte (auftrag_id) genau einer Zeile: die Leistungszeile, die die
-- Schicht selbst nennt, und nur in der Gesellschaft der Schicht (mandant_id =
-- new.mandant_id). Die Kennung der Zeile bringt der Aufrufer mit; der Auftrag,
-- der daraus folgt, steht danach an seiner eigenen Schicht. Einen gewaehlten
-- Anker pruefen die Dienste vorher unter der RLS des Menschen
-- (pruefeLeistungsanker), die Zusammengehoerigkeit prueft weiter der
-- Enkel-Schluessel einsatz_leistung_fk.
--
-- Der Rumpf ist Zeile fuer Zeile der aus 0050, bis auf die Schemaangabe
-- public.auftrag_leistung. Geaendert sind der Kopf (security definer,
-- search_path), das Eigentum und EXECUTE. Der Ausloeser
-- trg_einsatz_auftrag_ableiten bleibt, wie 0050 ihn anlegte.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0422.
-- ===========================================================================

create or replace function kern.einsatz_auftrag_ableiten() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_auftrag uuid;
begin
  if new.auftrag_leistung_id is null or new.auftrag_id is not null then
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
  'Leitet einsatz.auftrag_id aus der Leistungszeile ab (TIM-12, FIN-07). Das '
  'Geschwister von kern.einsatz_kunde_setzen(). Seit 0430 als cse_definer: ob '
  'eine Schicht ihren Auftrag bekommt, haengt nicht davon ab, ob der Aufrufer '
  'auftrag.lesen haelt (V-192).';

alter function kern.einsatz_auftrag_ableiten() owner to cse_definer;
revoke execute on function kern.einsatz_auftrag_ableiten() from public;
