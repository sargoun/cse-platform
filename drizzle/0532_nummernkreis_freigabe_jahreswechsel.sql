-- 0532 — Einen Nummernkreis freigeben und den Nachfolger zum Jahreswechsel
--        eroeffnen: die Administration, mit bestaetigter Maske
--        (V-284, O-134, O-352, D-779, D-848, FIN-03, LEG-01, Paragraph 14 UStG)
--
-- Der Befund hat zwei Haelften, und beide liessen sich nur per Migration
-- ausloesen — cse_app haelt auf nummernkreis kein INSERT und beim UPDATE nur
-- den Zaehler und den Kettenkopf:
--
--   * DIE FREIGABE. Der Betriebs-Seed legt den Rechnungskreis mit der
--     Voreinstellung RE-{jahr}-{nr:5} an, aber als Platzhalter (O-134, D-779):
--     eine Rechnungsnummer ist unumkehrbar. Solange ist_platzhalter steht,
--     zieht fin.rechnung_nummer_ziehen keine Nummer — es wird nichts
--     festgeschrieben. D-779: „die Freigabe braucht heute eine Migration, der
--     Knopf folgt (V-284)".
--   * DER JAHRESWECHSEL. Ein jaehrlich zurueckgesetzter Kreis traegt sein
--     Jahr; am 1. Januar weist fin.rechnung_nummer_ziehen jede Festschreibung
--     ab — „es fehlt der Nachfolgekreis" (0077) — und nennt den Weg: Kreis
--     schliessen, Nachfolger eroeffnen, letzter_hash als genesis_hash
--     uebernehmen, damit die Kette ueber die Jahresgrenze EINE Linie bleibt
--     (§5.4).
--
-- Zwei Definer, je ein Vorgang, beide nur
--   * in einer Gesellschaft, angemeldet, nicht lesend, und nur mit
--     nummernkreis.verwalten (Voreinstellung O-352, D-779: die
--     Administration);
--   * mit bestaetigter Maske — der Mensch sieht die erste Nummer, bevor sie
--     gilt; nach der ersten Vergabe friert fin.nummernkreis_pruefen Maske und
--     Geltungsbereich ein.
--
-- fin.nummernkreis_freigeben(kreis, maske, ruecksetzung, bezeichnung, bestaetigt)
--   gibt einen offenen Platzhalterkreis frei, der nie eine Nummer vergeben
--   hat. Die Voreinstellung darf dabei angepasst werden — O-134 fragt genau
--   das: Maske, Neustart am 1. Januar oder fortlaufend. Die Maske traegt
--   genau ein {nr} (Breite 1 bis 9), {jahr} genau dann, wenn jaehrlich
--   zurueckgesetzt wird, und sonst nur Buchstaben, Ziffern und - / _ . —
--   dieselbe Grammatik, die fin.nummer_formatieren (0077) und
--   formatiereNummer aufloesen. Das Jahr wird das laufende (ein Platzhalter
--   hat nichts vergeben, sein Jahr ist nur vorgemerkt), fortlaufend 0.
--
-- fin.nummernkreis_nachfolger_eroeffnen(vorgaenger, maske_bestaetigt)
--   nur fuer einen offenen, FREIGEGEBENEN, jaehrlich zurueckgesetzten Kreis,
--   dessen Jahr vergangen ist (Berliner Kalendertag), und nur, wenn es fuer
--   das neue Jahr noch keinen Kreis dieses Geltungsbereichs gibt. Ein
--   Platzhalter braucht keinen Nachfolger: er hat nichts vergeben, seine
--   Freigabe setzt ihn ins laufende Jahr. Der Vorgang schliesst den
--   Vorgaenger (geschlossen_am = heute) und legt den Nachfolger an: dieselbe
--   Maske, dieselbe Ruecksetzung, derselbe Geltungsbereich, das neue Jahr,
--   der Zaehler bei 1, vorgaenger_nummernkreis_id auf den alten, genesis_hash
--   = letzter_hash des alten (hat er nie festgeschrieben: sein eigener
--   genesis_hash). Steht das alte Jahr in der Bezeichnung, steht dort das
--   neue.
--
-- Definer, weil cse_app weder anlegen noch schliessen noch die Maske
-- aendern darf — und das bleibt so: der Weg sind diese zwei Funktionen mit
-- ihren Pruefungen. cse_definer bekommt dafuer die Spalten und vier Policies,
-- alle auf den aktiven Mandanten begrenzt UND an den Vorgangsmarker
-- app.kreisverwaltung gebunden (wie app.angebot_versand, 0024): jede der zwei
-- Funktionen setzt ihn transaktionslokal auf den Kreis, den sie verwaltet, und
-- loescht ihn vor der Rueckkehr. Ohne ihn gelten die vier nicht. Der Grund:
-- permissive Policies werden ODER-verknuepft — ungebunden haetten sie die
-- Zieher der einzelnen Kreistypen (d_rechnungskreis_*, d_eingangskreis_*,
-- d_mahnkreis_*, je NUR ihr Typ) auf jeden offenen Kreis der Gesellschaft
-- geweitet (rechnung.test.ts, „genau die aufgezaehlten cse_definer-Policies").
-- Die Spalten der Verwaltung (Maske, Ruecksetzung, Jahr, Bezeichnung,
-- geschlossen_am, ist_platzhalter) haelt cse_definer als Rolle; was ein
-- Zieher davon ueber seine eigene Policy aendern koennte, haelt
-- fin.nummernkreis_pruefen (0006) auf: ohne nummernkreis.verwalten nur der
-- Zaehler, nach der ersten Vergabe Maske und Geltungsbereich nie.
--
-- Nur Kommentare mit Doppelstrich.

create function fin.nummernkreis_freigeben(
  p_kreis uuid, p_maske text, p_zuruecksetzung text, p_bezeichnung text, p_bestaetigt boolean
) returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app, fin as $$
declare
  v_kreis       public.nummernkreis%rowtype;
  v_heute_jahr  integer := extract(year from app.berlin_heute())::integer;
  v_jahr        integer;
  v_maske       text := btrim(coalesce(p_maske, ''));
  v_bezeichnung text := btrim(coalesce(p_bezeichnung, ''));
begin
  if app.aktiver_mandant() is null or app.aktueller_benutzer() is null or app.ist_readonly() then
    raise exception 'Kreisfreigabe: nur in einer Gesellschaft, angemeldet und nicht lesend'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('nummernkreis.verwalten', app.aktiver_mandant()) then
    raise exception 'Kreisfreigabe: frei gibt, wer nummernkreis.verwalten haelt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_bestaetigt is distinct from true then
    raise exception 'Kreisfreigabe: die Maske ist nicht bestaetigt'
      using errcode = 'check_violation';
  end if;

  -- Der Vorgangsmarker: ohne ihn gelten die vier Policies dieser Migration nicht.
  perform set_config('app.kreisverwaltung', coalesce(p_kreis::text, ''), true);

  select * into v_kreis from public.nummernkreis
   where id = p_kreis and mandant_id = app.aktiver_mandant()
   for update;
  if not found then
    raise exception 'Kreisfreigabe: diesen Nummernkreis gibt es hier nicht'
      using errcode = 'no_data_found';
  end if;
  if v_kreis.geschlossen_am is not null then
    raise exception 'Kreisfreigabe: der Kreis ist geschlossen'
      using errcode = 'check_violation';
  end if;
  if not v_kreis.ist_platzhalter then
    raise exception 'Kreisfreigabe: der Kreis ist schon freigegeben'
      using errcode = 'check_violation';
  end if;
  -- Ein Platzhalter zieht nie (d_kreis_ziehen, fin.rechnung_nummer_ziehen);
  -- stuende der Zaehler nicht bei 1, waere die Maske schon auf einem Beleg.
  if v_kreis.naechste_nummer <> 1 then
    raise exception 'Kreisfreigabe: der Kreis hat schon Nummern vergeben'
      using errcode = 'check_violation';
  end if;
  if p_zuruecksetzung is null or p_zuruecksetzung not in ('jaehrlich', 'nie') then
    raise exception 'Kreisfreigabe: zurueckgesetzt wird jaehrlich oder nie'
      using errcode = 'check_violation';
  end if;
  if length(v_maske) not between 1 and 40
     or (select count(*) from regexp_matches(v_maske, '\{nr(:[1-9])?\}', 'g')) <> 1
     or (p_zuruecksetzung = 'jaehrlich') <> (strpos(v_maske, '{jahr}') > 0)
     or regexp_replace(v_maske, '\{nr(:[1-9])?\}|\{jahr\}', '', 'g') !~ '^[A-Za-z0-9/_.-]*$' then
    raise exception 'Kreisfreigabe: % ist keine gueltige Maske', v_maske
      using errcode = 'check_violation',
            detail  = 'Genau ein {nr} oder {nr:1} bis {nr:9}; {jahr} genau dann, wenn jaehrlich '
                      'zurueckgesetzt wird; sonst nur Buchstaben, Ziffern und - / _ .';
  end if;
  if length(v_bezeichnung) not between 1 and 120 then
    raise exception 'Kreisfreigabe: die Bezeichnung fehlt oder ist laenger als 120 Zeichen'
      using errcode = 'check_violation';
  end if;

  v_jahr := case when p_zuruecksetzung = 'jaehrlich'
                 then greatest(v_kreis.jahr, v_heute_jahr) else 0 end;
  if exists (select 1 from public.nummernkreis n
              where n.mandant_id = v_kreis.mandant_id and n.kreis_typ = v_kreis.kreis_typ
                and n.kontext_id is not distinct from v_kreis.kontext_id
                and n.jahr = v_jahr and n.id <> v_kreis.id) then
    raise exception 'Kreisfreigabe: fuer dieses Jahr gibt es schon einen Kreis dieses Geltungsbereichs'
      using errcode = 'check_violation';
  end if;

  update public.nummernkreis
     set format_maske    = v_maske,
         zuruecksetzung  = p_zuruecksetzung::public.nummernkreis_zuruecksetzung,
         jahr            = v_jahr,
         bezeichnung     = v_bezeichnung,
         ist_platzhalter = false,
         geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
   where id = v_kreis.id;

  perform set_config('app.kreisverwaltung', '', true);
  return v_jahr;
end $$;

comment on function fin.nummernkreis_freigeben(uuid, text, text, text, boolean) is
  'V-284, O-134, D-848: gibt einen offenen Platzhalterkreis frei, der nie eine Nummer vergeben '
  'hat — Maske und Ruecksetzung wie bestaetigt (Voreinstellung D-779 oder angepasst), das '
  'laufende Jahr; nur mit nummernkreis.verwalten und bestaetigter Maske.';

alter function fin.nummernkreis_freigeben(uuid, text, text, text, boolean) owner to cse_definer;
revoke all on function fin.nummernkreis_freigeben(uuid, text, text, text, boolean) from public;
grant execute on function fin.nummernkreis_freigeben(uuid, text, text, text, boolean) to cse_app;

create function fin.nummernkreis_nachfolger_eroeffnen(
  p_vorgaenger uuid, p_maske_bestaetigt boolean
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app, fin as $$
declare
  v_alt         public.nummernkreis%rowtype;
  v_heute       date := app.berlin_heute();
  v_jahr        integer := extract(year from app.berlin_heute())::integer;
  v_neu         uuid := gen_random_uuid();
  v_bezeichnung text;
begin
  if app.aktiver_mandant() is null or app.aktueller_benutzer() is null or app.ist_readonly() then
    raise exception 'Nachfolgekreis: nur in einer Gesellschaft, angemeldet und nicht lesend'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('nummernkreis.verwalten', app.aktiver_mandant()) then
    raise exception 'Nachfolgekreis: eroeffnet, wer nummernkreis.verwalten haelt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_maske_bestaetigt is distinct from true then
    raise exception 'Nachfolgekreis: die Maske ist nicht bestaetigt'
      using errcode = 'check_violation';
  end if;

  -- Der Vorgangsmarker: ohne ihn gelten die vier Policies dieser Migration nicht.
  perform set_config('app.kreisverwaltung', coalesce(p_vorgaenger::text, ''), true);

  select * into v_alt from public.nummernkreis
   where id = p_vorgaenger and mandant_id = app.aktiver_mandant()
   for update;
  if not found then
    raise exception 'Nachfolgekreis: diesen Nummernkreis gibt es hier nicht'
      using errcode = 'no_data_found';
  end if;
  if v_alt.geschlossen_am is not null then
    raise exception 'Nachfolgekreis: der Kreis ist schon geschlossen'
      using errcode = 'check_violation';
  end if;
  if v_alt.ist_platzhalter then
    raise exception 'Nachfolgekreis: ein Platzhalter wird freigegeben, nicht fortgesetzt'
      using errcode = 'check_violation';
  end if;
  if v_alt.zuruecksetzung is distinct from 'jaehrlich' then
    raise exception 'Nachfolgekreis: ein fortlaufender Kreis hat keinen Jahreswechsel'
      using errcode = 'check_violation';
  end if;
  if v_alt.jahr >= v_jahr then
    raise exception 'Nachfolgekreis: das Jahr % laeuft noch', v_alt.jahr
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.nummernkreis n
              where n.mandant_id = v_alt.mandant_id and n.kreis_typ = v_alt.kreis_typ
                and n.kontext_id is not distinct from v_alt.kontext_id
                and n.jahr = v_jahr) then
    raise exception 'Nachfolgekreis: fuer % gibt es schon einen Kreis', v_jahr
      using errcode = 'check_violation';
  end if;

  v_bezeichnung := case when strpos(v_alt.bezeichnung, v_alt.jahr::text) > 0
                        then replace(v_alt.bezeichnung, v_alt.jahr::text, v_jahr::text)
                        else v_alt.bezeichnung end;

  update public.nummernkreis
     set geschlossen_am = v_heute,
         geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
   where id = v_alt.id;

  insert into public.nummernkreis
    (id, mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
     zuruecksetzung, naechste_nummer, vorgaenger_nummernkreis_id, genesis_hash,
     geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von)
  values
    (v_neu, v_alt.mandant_id, v_alt.kreis_typ, v_alt.kontext_id, v_jahr, v_bezeichnung,
     v_alt.lueckenlos, v_alt.format_maske, v_alt.zuruecksetzung, 1, v_alt.id,
     coalesce(v_alt.letzter_hash, v_alt.genesis_hash),
     v_heute, false, 'mensch', app.aktueller_benutzer());

  perform set_config('app.kreisverwaltung', '', true);
  return v_neu;
end $$;

comment on function fin.nummernkreis_nachfolger_eroeffnen(uuid, boolean) is
  'V-284, O-352, D-848: der Jahreswechsel eines freigegebenen, jaehrlich zurueckgesetzten '
  'Nummernkreises — Vorgaenger schliessen, Nachfolger mit genesis_hash = letzter_hash '
  'eroeffnen; nur mit nummernkreis.verwalten und bestaetigter Maske, nur nach Ablauf des Jahres.';

alter function fin.nummernkreis_nachfolger_eroeffnen(uuid, boolean) owner to cse_definer;
revoke all on function fin.nummernkreis_nachfolger_eroeffnen(uuid, boolean) from public;
grant execute on function fin.nummernkreis_nachfolger_eroeffnen(uuid, boolean) to cse_app;

-- Die Spalten der zwei Vorgaenge. SELECT und INSERT haelt cse_definer seit 0070.
grant update (geschlossen_am, format_maske, zuruecksetzung, jahr, bezeichnung, ist_platzhalter)
  on nummernkreis to cse_definer;

-- Der Marker wird als Text verglichen, nicht nach uuid gewandelt: ein
-- unbrauchbarer Wert soll keine Policy-Auswertung zum Fehler machen, sondern
-- schlicht nichts gewaehren. Ungesetzt liefert current_setting(…, true) null,
-- geloescht ''; beides trifft keine Kennung.
create policy d_kreisverwaltung_lesen on nummernkreis for select to cse_definer
  using (mandant_id = app.aktiver_mandant()
         and current_setting('app.kreisverwaltung', true) <> '');
create policy d_kreis_freigeben on nummernkreis for update to cse_definer
  using      (mandant_id = app.aktiver_mandant()
              and id::text = current_setting('app.kreisverwaltung', true)
              and ist_platzhalter and geschlossen_am is null)
  with check (mandant_id = app.aktiver_mandant()
              and id::text = current_setting('app.kreisverwaltung', true));
create policy d_nachfolger_schliessen on nummernkreis for update to cse_definer
  using      (mandant_id = app.aktiver_mandant()
              and id::text = current_setting('app.kreisverwaltung', true)
              and not ist_platzhalter and geschlossen_am is null)
  with check (mandant_id = app.aktiver_mandant()
              and id::text = current_setting('app.kreisverwaltung', true));
create policy d_nachfolger_anlegen on nummernkreis for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant()
              and vorgaenger_nummernkreis_id::text = current_setting('app.kreisverwaltung', true));

comment on policy d_kreisverwaltung_lesen on nummernkreis is
  'V-284, D-848: Freigabe und Jahreswechsel lesen die Kreise der aktiven Gesellschaft — nur, '
  'solange eine der zwei Funktionen den Vorgangsmarker app.kreisverwaltung gesetzt hat.';
comment on policy d_kreis_freigeben on nummernkreis is
  'V-284, D-848: fin.nummernkreis_freigeben aendert nur den offenen Platzhalterkreis, den ihr '
  'Vorgangsmarker nennt, in der aktiven Gesellschaft (Maske, Ruecksetzung, Jahr, Bezeichnung, '
  'ist_platzhalter).';
comment on policy d_nachfolger_schliessen on nummernkreis is
  'V-284, D-848: fin.nummernkreis_nachfolger_eroeffnen schliesst nur den offenen, freigegebenen '
  'Kreis, den ihr Vorgangsmarker nennt, in der aktiven Gesellschaft.';
comment on policy d_nachfolger_anlegen on nummernkreis is
  'V-284, D-848: fin.nummernkreis_nachfolger_eroeffnen legt nur den Nachfolger des Kreises an, '
  'den ihr Vorgangsmarker nennt, in der aktiven Gesellschaft.';
