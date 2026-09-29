-- ===========================================================================
-- 0488 — Eine neue Fassung an einem Dokument: die Kundenfreigabe entscheidet
--        mit, und eine Buchung sperrt sie fuer jede Sitzung
--        (DOC-04, DOC-05, ACC-03, Invariante 7, V-266, D-759)
-- ===========================================================================
-- Ersetzt kern.dokument_kundenfreigabe_pruefen (Fassungen: 0297, 0325) und
-- kern.dokument_fassung_pruefen (Fassungen: 0470, 0474). Neu ist
-- fin.dokument_hat_buchung.
--
-- **Befund 1 — die Kundenfreigabe.** Sie ist der Schalter, der ein Dokument
-- aus dem Haus laesst, und haengt an einem eigenen Recht
-- (dokument.kunde_freigeben, 0297). Der Ausloeser griff nur, wenn sich der
-- SCHALTER aenderte. Eine neue Fassung (V-219) tauscht aber die DATEI hinter
-- einer bestehenden Freigabe (objekt_schluessel zeigt auf die neueste), und
-- dafuer genuegte dokument.schreiben: ein freigegebenes Dokument lieferte
-- danach einen Inhalt aus, ueber den niemand mit dem Freigaberecht entschieden
-- hatte (Invariante 7). Heute latent — das Kundenportal liefert noch keine
-- Dokumente (O-671), und im Standardkatalog halten dieselben Rollen beide
-- Rechte —, aber genau solche Wege baut 0297 ausdruecklich zu.
--
-- **Die Entscheidung (Ablauf, D-759).** Eine neue Fassung an einem fuer den
-- Kunden freigegebenen Dokument legt nur ab, wer die Kundenfreigabe selbst
-- erteilen darf — und bestaetigt am Formular ausdruecklich, dass der Kunde die
-- neue Fassung sieht. Hier steht die zweite Linie: aendert sich an einer
-- freigegebenen Zeile die Datei, gilt dasselbe wie beim Umlegen des Schalters
-- (kein Mensch in der Sitzung: nie; sonst nur mit dem Recht).
--
-- **Befund 2 — der Buchungsbezug.** legeFassungAn wies ein Dokument ab, auf
-- das sich eine Buchungszeile beruft (ACC-03) — unter der RLS des Aufrufers.
-- buchungssatz liest nur, wer buchhaltung.lesen haelt; die Rolle leitung haelt
-- dokument.schreiben, aber nicht dieses Recht: fuer sie war die Pruefung immer
-- falsch, die Sperre griff nie. fin.dokument_hat_buchung beantwortet die Frage
-- als Definer (eng: ein Wahrheitswert, der aktive Mandant, die zwei Spalten
-- aus 0132), wie fin.dokument_haengt_an_buchung beim Loeschen; der Dienst und
-- der Ausloeser der Kette fragen beide sie.
--
-- Kommentare nur mit --, keine Backticks (dieselbe Regel wie in 0392).
-- ===========================================================================

-- 1. Der Buchungsbezug, fuer jede Sitzung gleich beantwortet
create function fin.dokument_hat_buchung(p_dokument uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.beleg b
      join public.buchungssatz bs
        on bs.beleg_id = b.id and bs.mandant_id = b.mandant_id
     where b.dokument_id = p_dokument
       and b.mandant_id = app.aktiver_mandant())
$$;

alter function fin.dokument_hat_buchung(uuid) owner to cse_definer;
revoke all on function fin.dokument_hat_buchung(uuid) from public;
grant execute on function fin.dokument_hat_buchung(uuid) to cse_app;

comment on function fin.dokument_hat_buchung(uuid) is
  'ACC-03, DOC-05, V-266, D-759. Beruft sich im aktiven Mandanten eine Buchungszeile auf '
  'dieses Dokument? Ein Wahrheitswert, keine Buchungsdaten — die Fassungssperre gilt so '
  'auch fuer eine Sitzung ohne buchhaltung.lesen. Liest ueber d_beleg_dokument (0132) und '
  'd_bs_beleg (0134) die Spalten aus 0132.';

-- 2. Die Kette: dazu die Buchungssperre (Pruefungen 1 bis 4 wie in 0474)
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
  if fin.dokument_hat_buchung(new.dokument_id) then
    raise exception
      'Dokument %: eine Buchungszeile beruft sich darauf — seine Datei wird nicht durch eine '
      'neue Fassung ersetzt (ACC-03, Paragraf 147 AO)', new.dokument_id
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird die BUCHUNG durch Gegenbuchung, nie der Beleg.';
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
  'DOC-05, DOC-07, ACC-03, V-219, V-266, D-713, D-758, D-759. Eine Fassung jenseits der '
  'ersten folgt lueckenlos der hoechsten, nie an einem geloeschten Dokument, nie an '
  'Rechnung, Beleg oder Buchhaltung (GoBD) und nie an einem Dokument, auf das sich eine '
  'Buchung beruft (fuer jede Sitzung, 0488) — und sie traegt ihre eigene '
  'Aufbewahrungsfrist: das Dokument behaelt die laengere (0474, O-955).';

-- 3. Die Kundenfreigabe: auch die Datei hinter einer bestehenden Freigabe
create or replace function kern.dokument_kundenfreigabe_pruefen()
returns trigger language plpgsql
set search_path = pg_catalog, public, app as $$
declare
  v_beruehrt boolean;
  v_datei    boolean := false;
begin
  -- Wie 0325: zwei ANWEISUNGEN, weil old beim INSERT nicht zugewiesen ist.
  if tg_op = 'INSERT' then
    v_beruehrt := new.sichtbar_fuer_kunde;
  else
    v_beruehrt := new.sichtbar_fuer_kunde is distinct from old.sichtbar_fuer_kunde;
    -- 0488: an einer freigegebenen Zeile aendert sich die Datei (neue Fassung).
    if not v_beruehrt and new.sichtbar_fuer_kunde and old.sichtbar_fuer_kunde
       and new.objekt_schluessel is distinct from old.objekt_schluessel then
      v_beruehrt := true;
      v_datei := true;
    end if;
  end if;

  if not v_beruehrt then return new; end if;

  -- Kein Mensch in der Sitzung — dann keine Freigabe (Invariante 7, 0325).
  if app.aktueller_benutzer() is null then
    raise exception 'dokument.kunde_freigeben fehlt — keine Benutzersitzung'
      using errcode = 'insufficient_privilege',
            detail  = 'Eine Kundenfreigabe ist eine Willenserklaerung gegenueber dem '
                      || 'Kunden; ein Zeitplan gibt sie nicht ab (Invariante 7, DOC-04).',
            hint    = 'Ein Lauf legt Dokumente ab. Freigegeben wird ueber '
                      || '/api/dokumente/[id]/kundenfreigabe, von einem Menschen.';
  end if;

  if not app.hat_recht('dokument.kunde_freigeben', new.mandant_id) then
    if tg_op = 'INSERT' then
      raise exception 'dokument.kunde_freigeben fehlt'
        using errcode = 'insufficient_privilege',
              detail  = 'Ein Dokument entsteht nicht bereits fuer den Kunden '
                        || 'freigegeben (DOC-04).',
              hint    = 'Erst ablegen, dann freigeben — die Freigabe ist ein eigener '
                        || 'Vorgang mit eigenem Recht.';
    end if;
    if v_datei then
      raise exception 'dokument.kunde_freigeben fehlt'
        using errcode = 'insufficient_privilege',
              detail  = 'Das Dokument ist fuer den Kunden freigegeben; eine neue Fassung '
                        || 'aendert, was er zu sehen bekommt (DOC-04, Invariante 7).',
              hint    = 'Eine neue Fassung legt hier ab, wer auch die Kundenfreigabe '
                        || 'erteilen darf.';
    end if;
    raise exception 'dokument.kunde_freigeben fehlt'
      using errcode = 'insufficient_privilege',
            detail  = 'Was ein Kunde zu sehen bekommt, entscheidet nicht, wer '
                      || 'Dokumente ablegen darf (dokument.schreiben).',
            hint    = 'Die Freigabe laeuft ueber /api/dokumente/[id]/kundenfreigabe.';
  end if;

  return new;
end $$;

comment on function kern.dokument_kundenfreigabe_pruefen() is
  'DOC-04, Invariante 7, V-266, D-759. Bindet jede Aenderung von sichtbar_fuer_kunde — und '
  'seit 0488 jede neue Datei hinter einer bestehenden Kundenfreigabe (neue Fassung) — an '
  'dokument.kunde_freigeben und an einen Menschen in der Sitzung. Die Rechtsfrage steht '
  'hinter der Tatsachenfrage (0325): ohne beruehrte Freigabe wird app.hat_recht nicht '
  'einmal geplant.';
