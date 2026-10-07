-- 0536 — Nachunternehmerleistung ist eine eigene Kostenart der Kalkulation
--        (V-338, O-57, D-792, D-852, OPS-07)
--
-- Der Befund: kostenart (0022) kannte lohn, material, geraet, gemeinkosten und
-- wagnis_gewinn. Fremdleistung war in der Kalkulation nicht erfassbar, und ein
-- Angebot mit Nachunternehmer trug ihren Anteil nicht in der Preisbegruendung.
--
-- TODO(client, O-57): Voreinstellung — Nachunternehmerleistung ist eine eigene Kostenart neben Material und Geraet, getrennt ausgewiesen; § 13b UStG und § 48 EStG gelten je nach Leistung und Empfaenger (reverseChargeLage, abzugLage) — die Kostenart ist kein Steuerkennzeichen. D-792, D-852.
--
-- 1. Der Wert `nachunternehmer` (nach geraet). Er wird in dieser Migration
--    nur in Funktionsrumpfen genannt — die binden ihn erst bei der
--    Ausfuehrung, also nach dem COMMIT, in dem der Wert entsteht.
-- 2. `summe_nachunternehmer_cent` neben den fuenf Summen; der Ausloeser
--    kp_summen fuehrt sie, und die Angebotssumme enthaelt sie.
-- 3. Das Einfrieren (0023) kennt die neue Summe: festgeschrieben heisst
--    auch sie.
--
-- Nur Kommentare mit Doppelstrich.

alter type kostenart add value if not exists 'nachunternehmer' after 'geraet';

alter table kalkulation add column summe_nachunternehmer_cent bigint not null default 0;

comment on column kalkulation.summe_nachunternehmer_cent is
  'V-338, O-57, D-852: Summe der Nachunternehmerzeilen — erfasst, nie vorbelegt; vom Ausloeser '
  'kp_summen gepflegt wie die anderen Bloecke.';

create or replace function kern.aktualisiere_kalkulation_summen() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.kalkulation_id, old.kalkulation_id);
begin
  update public.kalkulation k
     set summe_lohn_cent = s.lohn,
         summe_material_cent = s.material,
         summe_geraet_cent = s.geraet,
         summe_nachunternehmer_cent = s.nachunternehmer,
         summe_gemeinkosten_cent = s.gemeinkosten,
         summe_wagnis_gewinn_cent = s.wagnis,
         angebotssumme_netto_cent =
           s.lohn + s.material + s.geraet + s.nachunternehmer + s.gemeinkosten + s.wagnis
    from (select
            coalesce(sum(betrag_cent) filter (where kostenart = 'lohn'), 0)            as lohn,
            coalesce(sum(betrag_cent) filter (where kostenart = 'material'), 0)        as material,
            coalesce(sum(betrag_cent) filter (where kostenart = 'geraet'), 0)          as geraet,
            coalesce(sum(betrag_cent) filter (where kostenart = 'nachunternehmer'), 0) as nachunternehmer,
            coalesce(sum(betrag_cent) filter (where kostenart = 'gemeinkosten'), 0)    as gemeinkosten,
            coalesce(sum(betrag_cent) filter (where kostenart = 'wagnis_gewinn'), 0)   as wagnis
          from public.kalkulation_position where kalkulation_id = v_id) s
   where k.id = v_id;
  return null;
end $$;

create or replace function kern.kalkulation_eingefroren() returns trigger
language plpgsql as $$
declare v_status kalkulation_status;
begin
  if tg_table_name = 'kalkulation' then
    if tg_op = 'UPDATE' and old.status = 'festgeschrieben' then
      -- Der Uebergang selbst darf noch schreiben; danach nur noch `bemerkung`.
      if new.status <> old.status
         or new.stundenverrechnungssatz_cent is distinct from old.stundenverrechnungssatz_cent
         or new.gemeinkosten_basis is distinct from old.gemeinkosten_basis
         or new.gemeinkosten_bp is distinct from old.gemeinkosten_bp
         or new.wagnis_gewinn_bp is distinct from old.wagnis_gewinn_bp
         or new.ist_platzhalter is distinct from old.ist_platzhalter
         or new.version is distinct from old.version
         or new.angebot_id is distinct from old.angebot_id
         or new.auftrag_id is distinct from old.auftrag_id
         or new.basis_objekt_id is distinct from old.basis_objekt_id
         or new.summe_lohn_cent is distinct from old.summe_lohn_cent
         or new.summe_material_cent is distinct from old.summe_material_cent
         or new.summe_geraet_cent is distinct from old.summe_geraet_cent
         or new.summe_nachunternehmer_cent is distinct from old.summe_nachunternehmer_cent
         or new.summe_gemeinkosten_cent is distinct from old.summe_gemeinkosten_cent
         or new.summe_wagnis_gewinn_cent is distinct from old.summe_wagnis_gewinn_cent
         or new.selbstkosten_cent is distinct from old.selbstkosten_cent
         or new.angebotssumme_netto_cent is distinct from old.angebotssumme_netto_cent
         or new.festgeschrieben_am is distinct from old.festgeschrieben_am
         or new.festgeschrieben_von is distinct from old.festgeschrieben_von then
        raise exception 'Festgeschriebene Kalkulation: nur die Bemerkung ist noch aenderbar'
          using errcode = 'check_violation',
                hint = 'Eine geaenderte Kalkulation ist eine neue Version.';
      end if;
    end if;
    return new;
  end if;

  select status into v_status from public.kalkulation
   where id = coalesce(new.kalkulation_id, old.kalkulation_id);
  if v_status = 'festgeschrieben' then
    raise exception 'Positionen einer festgeschriebenen Kalkulation sind unveraenderlich'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
