-- 0533 — Die Obergrenze gegen doppelte Abrechnung eines Aufmasses gilt je
--        LV-Position, nicht je Blatt (V-357, O-340, D-796, D-849, § 16 VOB/B)
--
-- Der Befund: fin.pruefe_aufmass_menge (0107) verglich die Summe ALLER Zeilen
-- eines Blattes mit der Summe aller wirksamen Anteile — ueber Einheiten und
-- LV-Positionen hinweg. Zwei Fehler folgten daraus:
--   * eine doppelt abgerechnete Position in m2 versteckte sich hinter einer
--     unberechneten in Stueck (40 m2 gemessen, 80 m2 abgerechnet, 50 Stk
--     gemessen und nicht abgerechnet: 80 <= 90, durchgelassen);
--   * eine Rueckbauposition mit negativer Menge auf demselben Blatt senkte die
--     Blattsumme, und die ehrliche Abrechnung der anderen Position schlug an
--     (100 m2 und -30 m2 Rueckbau gemessen, 100 m2 abgerechnet: 100 > 70, abgewiesen).
-- Die Abrechnung gruppiert ohnehin je LV-Position (einheitspreis-aufmass.ts:
-- je Position eine Rechnungszeile mit lv_position_id und je Blatt ein Anteil).
--
-- TODO(client, O-340): Voreinstellung — ein Aufmassblatt darf Zeilen verschiedener Einheiten tragen, wenn jede an einer LV-Position haengt; die Obergrenze gilt je LV-Position (die Zeilen ausserhalb des LV bilden eine eigene Gruppe). D-796, D-849.
--
-- Die neue Regel, je Blatt:
--   * Die Gruppe eines Anteils ist die LV-Position seiner Rechnungszeile.
--   * Nennt die Rechnungszeile keine (eine von Hand angelegte Zeile), ist der
--     Anteil eindeutig, solange das Blatt nur EINE Gruppe misst — er zaehlt
--     dorthin. Misst das Blatt mehrere, laesst er sich keiner zuordnen und
--     wird abgewiesen: geraten wird nicht.
--   * Je Gruppe: der Betrag der wirksamen Anteile ueberschreitet nie den
--     Betrag der gemessenen Menge (Betraege, weil ein Rueckbau negativ misst —
--     unveraendert aus 0107).
-- aufmass.abgerechnet_menge bleibt die Summe aller wirksamen Anteile des
-- Blattes (§2.3 Punkt 5); sie ist eine Anzeige, die Pruefung steht je Gruppe.
--
-- Der Ausloeser quelle_aufmass_menge (0107) bleibt, wie er ist: aufgeschoben,
-- bei insert und update, also auch beim Storno. Die Funktion bleibt ein
-- Definer (sie schreibt abgerechnet_menge) und liest die Rechnungszeile durch
-- d_rp_pflichtfeld (0104, aktiver Mandant) — der Ausloeser feuert in der
-- Sitzung, die die Rechnung schreibt.
--
-- Nur Kommentare mit Doppelstrich.

create or replace function fin.pruefe_aufmass_menge() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_aufmass    uuid := coalesce(new.aufmass_id, old.aufmass_id);
  v_nummer     text;
  v_gruppen    integer;
  v_einzige    uuid;
  v_gesamt     numeric(12,3);
  v_offen      integer;
  g            record;
begin
  if v_aufmass is null then return null; end if;

  select a.nummer into v_nummer from public.aufmass a where a.id = v_aufmass;
  if not found then return null; end if;

  -- Die Gruppen des Blattes: je LV-Position, die Zeilen ausserhalb des LV als eine.
  select count(*) into v_gruppen
    from (select distinct z.lv_position_id from public.aufmass_zeile z
           where z.aufmass_id = v_aufmass) d;
  if v_gruppen = 1 then
    select z.lv_position_id into v_einzige from public.aufmass_zeile z
     where z.aufmass_id = v_aufmass limit 1;
  end if;

  -- Ein Anteil ohne LV-Position auf einem Blatt mit mehreren Gruppen: keiner zuzuordnen.
  select count(*) into v_offen
    from public.rechnungsposition_quelle q
    left join public.rechnungsposition p on p.id = q.rechnungsposition_id
   where q.aufmass_id = v_aufmass and q.quelle_typ = 'aufmass' and q.wirksam
     and p.lv_position_id is null and v_gruppen > 1;
  if v_offen > 0 then
    raise exception
      'Aufmass %: das Blatt misst % LV-Positionen — ein Anteil ohne LV-Position laesst sich keiner zuordnen (§ 16 VOB/B, O-340)',
      coalesce(v_nummer, v_aufmass::text), v_gruppen
      using errcode = 'restrict_violation',
            hint = 'Die Rechnungszeile nennt die LV-Position, deren Menge sie abrechnet; '
                   'die Abrechnung nach Aufmass tut das je Position von selbst.';
  end if;

  for g in
    with anteil as (
      select coalesce(p.lv_position_id, v_einzige) as lv, q.menge_anteil
        from public.rechnungsposition_quelle q
        left join public.rechnungsposition p on p.id = q.rechnungsposition_id
       where q.aufmass_id = v_aufmass and q.quelle_typ = 'aufmass' and q.wirksam
    ),
    verbraucht as (
      select a.lv, coalesce(sum(a.menge_anteil), 0)::numeric(12,3) as menge
        from anteil a group by a.lv
    )
    select v.lv, v.menge as verbraucht,
           coalesce((select sum(z.menge) from public.aufmass_zeile z
                      where z.aufmass_id = v_aufmass
                        and z.lv_position_id is not distinct from v.lv), 0)::numeric(12,3)
             as gemessen,
           (select l.oz from public.lv_position l where l.id = v.lv) as oz
      from verbraucht v
  loop
    -- In BETRAEGEN, nicht mit `>`: ein Rueckbau misst negativ (0107).
    if abs(g.verbraucht) > abs(g.gemessen) then
      raise exception
        'Aufmass %, LV-Position %: abgerechnet waeren % von gemessenen % (§ 16 VOB/B, §4.4)',
        coalesce(v_nummer, v_aufmass::text),
        coalesce(g.oz, case when g.lv is null then 'ausserhalb des LV' else g.lv::text end),
        g.verbraucht, g.gemessen
        using errcode = 'restrict_violation',
              hint = 'Ein Aufmassblatt wird anteilig abgerechnet — je LV-Position aber nie '
                     'mehr, als dort gemessen wurde.';
    end if;
  end loop;

  select coalesce(sum(q.menge_anteil), 0) into v_gesamt
    from public.rechnungsposition_quelle q
   where q.aufmass_id = v_aufmass and q.quelle_typ = 'aufmass' and q.wirksam;

  -- Der Rueckschreibweg auf das Blatt (§2.3 Punkt 5), durch d_aufmass_abrechnung (0107).
  update public.aufmass set abgerechnet_menge = v_gesamt where id = v_aufmass;

  return null;
end $$;

comment on function fin.pruefe_aufmass_menge() is
  '§4.4, V-357, O-340, D-849: je LV-Position des Blattes ueberschreitet die Summe der '
  'wirksamen Anteile die gemessene Menge nicht (ein Anteil ohne LV-Position zaehlt nur auf '
  'einem Blatt mit einer Gruppe); die Summe aller Anteile wird auf das Blatt zurueckgeschrieben. '
  'Kein Unique-Index: § 16 VOB/B rechnet anteilig ab.';
