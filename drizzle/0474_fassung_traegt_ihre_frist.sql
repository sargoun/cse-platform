-- ===========================================================================
-- 0474 — Eine neue Fassung traegt ihre eigene Aufbewahrungsfrist
--        (DOC-05, DOC-07, V-266, D-758, O-955)
-- ===========================================================================
-- Ersetzt kern.dokument_fassung_pruefen aus 0470 (die einzige aeltere
-- Fassung dieser Funktion); Pruefungen 1 bis 3 bleiben woertlich, dazu kommt 4.
--
-- **Der Befund.** aufbewahrung_bis wird nur beim INSERT der Dokumentzeile aus
-- entstanden_am gerechnet (kern.setze_aufbewahrung, 0141). Eine zweite
-- Fassung (V-219) aenderte die Frist nicht: ein Angebot von 2019 mit einer
-- heute abgelegten ueberarbeiteten Fassung stand mit der Frist 31.12.2025 da
-- und damit im Kreis des Nachtlaufs (0382, j_dokument_aufbewahrung_abgelaufen)
-- — er haette das Dokument in der naechsten Nacht samt der neuen Fassung
-- geloescht. Ein ueberarbeitetes, neu abgesandtes Angebot ist aber ein eigener
-- Handelsbrief mit eigenem Fristbeginn (Paragraf 257 Abs. 5 HGB).
--
-- **Die Regel.** Mit jeder Fassung jenseits der ersten rechnet die Datenbank
-- die Frist, die HEUTE fuer die Kategorie gilt (dieselbe Regel wie beim
-- Anlegen: app.aufbewahrung_regel je Gesellschaft, app.aufbewahrung_ende ab
-- dem Berliner Kalendertag der Datenbank — Invariante 5), und das Dokument
-- behaelt die LAENGERE. Eine Loeschsperre der Regel kommt dazu; geloest wird
-- keine (D-49). Eine offene Frist (NULL, Loeschsperre) bleibt offen: eine
-- unbekannte Pflicht wird als Pflicht behandelt (K-17).
--
-- Kuerzer wird dabei nichts — kern.setze_aufbewahrung (0141) weist jede
-- Verkuerzung ohnehin ab, auch hier.
--
-- **Warum hier und nicht nur im Dienst.** Hier steht seit 0470, was fuer
-- JEDEN Schreiber einer Fassung gilt. Eine Frist, die nur der Dienst
-- verlaengert, verlaengert ein Schreiber an der Route vorbei nicht — und der
-- Nachtlauf loescht nach der Zeile, nicht nach dem Dienst.
--
-- **Kein SECURITY DEFINER** (wie 0470): das UPDATE laeuft als der Aufrufer,
-- also unter t_mandant — wer eine Fassung anlegt, muss das Dokument lesen UND
-- schreiben duerfen; sonst weist die Policy ab, statt still vorbeizugehen.
--
-- TODO(client, O-955): Laeuft nach einer neuen Fassung jede Fassung fuer sich ab (die aeltere wird nach IHRER Frist einzeln geloescht), oder gilt die laengere Frist fuer das ganze Dokument mit allen Fassungen? Ausgeliefert ist das Zweite als Platzhalter.
--
-- Kommentare nur mit --, keine Backticks (dieselbe Regel wie in 0392).
-- ===========================================================================

create or replace function kern.dokument_fassung_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_kategorie text;
  v_geloescht timestamptz;
  v_hoechste  integer;
  v_bis       date;
  v_sperre    boolean;
begin
  if new.version = 1 then
    return new;
  end if;

  select d.kategorie::text, d.geloescht_am
    into v_kategorie, v_geloescht
    from public.dokument d
   where d.id = new.dokument_id and d.mandant_id = new.mandant_id;
  if not found then
    raise exception
      'Fassung % zu Dokument %: das Dokument ist fuer diese Sitzung nicht sichtbar',
      new.version, new.dokument_id
      using errcode = 'insufficient_privilege',
            hint = 'Eine Fassung legt an, wer das Dokument lesen und ablegen darf.';
  end if;
  if v_geloescht is not null then
    raise exception 'Dokument %: es ist geloescht und bekommt keine Fassung', new.dokument_id
      using errcode = 'restrict_violation';
  end if;
  if v_kategorie in ('rechnung', 'beleg', 'buchhaltung') then
    raise exception
      'Dokument % (%): Rechnungen, Belege und Buchhaltungsunterlagen bekommen keine neue '
      'Fassung (DOC-05, GoBD, Paragraf 147 AO)', new.dokument_id, v_kategorie
      using errcode = 'restrict_violation',
            hint = 'Berichtigt wird durch Gegenbuchung oder Storno, nie durch den Austausch '
                   'der Datei.';
  end if;

  select max(v.version) into v_hoechste
    from public.dokument_version v
   where v.dokument_id = new.dokument_id and v.mandant_id = new.mandant_id;
  if v_hoechste is null or new.version <> v_hoechste + 1 then
    raise exception
      'Fassung % zu Dokument %: die Kette ist lueckenlos — erwartet wird Fassung %',
      new.version, new.dokument_id, coalesce(v_hoechste + 1, 1)
      using errcode = 'check_violation';
  end if;

  -- 4. Die neue Fassung traegt ihre eigene Frist — das Dokument die laengere.
  --    Keine Regel heisst nicht keine Pflicht: dann Loeschsperre (K-17).
  select app.aufbewahrung_ende(app.berlin_heute(), r.jahre),
         (r.loeschsperre or r.ist_platzhalter)
    into v_bis, v_sperre
    from app.aufbewahrung_regel(new.mandant_id, v_kategorie) r
   limit 1;
  if not found then
    v_bis := null;
    v_sperre := true;
  end if;

  update public.dokument d
     set aufbewahrung_bis = case when d.aufbewahrung_bis is null then null
                                 else greatest(d.aufbewahrung_bis, v_bis) end,
         loeschsperre = d.loeschsperre or coalesce(v_sperre, true)
   where d.id = new.dokument_id and d.mandant_id = new.mandant_id
     and ((d.aufbewahrung_bis is not null and v_bis is not null
           and v_bis > d.aufbewahrung_bis)
          or (coalesce(v_sperre, true) and not d.loeschsperre));
  return new;
end $$;

comment on function kern.dokument_fassung_pruefen() is
  'DOC-05, DOC-07, V-219, V-266, D-713, D-758. Eine Fassung jenseits der ersten folgt '
  'lueckenlos der hoechsten, nie an einem geloeschten Dokument und nie an Rechnung, Beleg '
  'oder Buchhaltung (GoBD) — und sie traegt ihre eigene Aufbewahrungsfrist: das Dokument '
  'behaelt die laengere (0474, O-955).';
