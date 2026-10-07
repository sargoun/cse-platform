-- 0528 — Der Widerruf einer Referenzfreigabe stellt die Aufgabe
--        "Referenz herausnehmen" (V-287, O-735, D-780, D-841)
--
-- Der Befund: widerrufeKundenfreigabe (services/auftrag/kundenfreigabe.ts)
-- stempelte den Auftrag und protokollierte den Grund. Eine schon
-- veroeffentlichte Referenz aus diesem Auftrag blieb auf der Website, bis
-- jemand zufaellig daran dachte. Die Voreinstellung zu O-735 (D-780) sagt:
-- die Website-Pflege nimmt sie binnen fuenf Arbeitstagen von Hand heraus,
-- nicht rueckwirkend. Eine Frist ohne Aufgabe ist eine Pflicht, an die
-- niemand erinnert wird.
--
-- Diese Migration gibt dem Widerruf den Weg dazu:
--
-- 1. app.referenz_herausnahme_aufgabe(p_referenz, p_faellig, p_titel,
--    p_beschreibung) legt GENAU EINE Art Aufgabe an: offen, Prioritaet hoch,
--    Frist als Berliner Kalendertag, Bezug auf die Referenz, Quelle ereignis,
--    Doppelungsschluessel ereignis:referenz_widerruf (aufgabe_job_uk, 0230).
--    Steht zu der Referenz schon eine offene oder in Arbeit befindliche
--    Aufgabe derselben Art, entsteht keine zweite und die Funktion gibt null
--    zurueck; sonst die Kennung der neuen.
--
--    Ein Definer, weil das Recht zum Widerruf (referenz.kundenfreigabe_
--    erfassen) und das Recht, Aufgaben zu schreiben (aufgabe.schreiben,
--    t_aufgabe_schreiben) verschiedene Rechte sind: eine Modulbeschraenkung
--    der Mitgliedschaft (AUT-01) oder eine Rolle je Gesellschaft nimmt das
--    zweite weg, und unter FORCE RLS schluege das INSERT dann fehl und naehme
--    den Widerruf mit. Die Pflicht haengt nicht am Aufgabenrecht dessen, der
--    widerruft.
--
--    Die Funktion prueft selbst, was sie zulaesst:
--      * eine Sitzung mit Gesellschaft und Konto, nicht in der
--        Gruppenansicht (Invariante 10), mit referenz.kundenfreigabe_erfassen;
--      * Titel und Beschreibung nicht leer (sie kommen aus dem Dienst);
--      * die Frist ein Tag nach dem heutigen Berliner Tag und hoechstens
--        einunddreissig Tage weit — gerechnet wird sie im Dienst mit einer
--        getesteten Funktion (werktageNach, lib/datum/werktage.ts); hier
--        steht nur die Grenze, damit kein Tag in der Vergangenheit und keiner
--        im naechsten Jahr hineinkommt;
--      * die Referenz gehoert zur aktiven Gesellschaft, steht auf der Website
--        (freigegeben, veroeffentlicht, nicht geloescht), und ihr
--        Ursprungsauftrag wurde IN DIESER TRANSAKTION widerrufen:
--        freigabe_widerrufen_am = now(). kern.auftrag_freigabe_stempeln
--        (0025) setzt den Widerruf auf now(), und now() ist der Beginn der
--        Transaktion — ein spaeterer Aufruf fuer einen alten Widerruf findet
--        keine Referenz und legt nichts an.
--
-- 2. cse_definer liest die Referenz (nur die Spalten, die die Funktion
--    braucht) und legt die Aufgabe an — beides auf den aktiven Mandanten
--    begrenzt, das Anlegen ausserdem auf genau diese Art (K-01, K-05). Die
--    Kennung der neuen Aufgabe vergibt die Funktion selbst, damit sie ohne
--    RETURNING und damit ohne Leserecht auf aufgabe auskommt.
--
-- Zugewiesen wird niemandem einzeln: die Aufgabe steht in der Aufgabenliste
-- der Gesellschaft, die jeder mit aufgabe.lesen sieht — und damit jeder, der
-- eine Referenz zurueckziehen darf (referenz.veroeffentlichen). Wer sie
-- uebernimmt, weist sie sich zu (aufgabe.zuweisen). Der Mensch, der
-- widerrufen hat, steht in erstellt_von und sieht sie auch ohne
-- aufgabe.lesen (t_aufgabe_eigene).
--
-- Nur Kommentare mit Doppelstrich.

grant select (id, mandant_id, auftrag_id, titel, status, freigegeben_vom_kunden, geloescht_am)
  on referenz to cse_definer;

create policy d_referenz_herausnahme_lesen on referenz for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

comment on policy d_referenz_herausnahme_lesen on referenz is
  'V-287 (0528): app.referenz_herausnahme_aufgabe prueft, ob die Referenz der aktiven '
  'Gesellschaft auf der Website steht und aus welchem Auftrag sie stammt.';

grant insert (id, mandant_id, titel, beschreibung, status, prioritaet, faellig_datum,
              bezug_typ, bezug_id, quelle, quelle_job, erstellt_von)
  on aufgabe to cse_definer;

create policy d_aufgabe_referenz_herausnahme on aufgabe for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant()
              and quelle = 'ereignis'
              and quelle_job = 'ereignis:referenz_widerruf'
              and bezug_typ = 'referenz');

comment on policy d_aufgabe_referenz_herausnahme on aufgabe is
  'V-287 (0528): app.referenz_herausnahme_aufgabe legt die Aufgabe Referenz herausnehmen '
  'an — nur diese Art und nur in der aktiven Gesellschaft.';

create function app.referenz_herausnahme_aufgabe(
  p_referenz     uuid,
  p_faellig      date,
  p_titel        text,
  p_beschreibung text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_konto   uuid := app.aktueller_benutzer();
  v_heute   date := app.berlin_heute();
  v_id      uuid := gen_random_uuid();
  v_anzahl  integer;
begin
  if v_mandant is null or v_konto is null or app.ist_readonly()
     or not app.hat_recht('referenz.kundenfreigabe_erfassen', v_mandant) then
    raise exception 'Die Aufgabe Referenz herausnehmen stellt nur, wer die Kundenfreigabe widerrufen darf (V-287)'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_titel), '') = '' or coalesce(btrim(p_beschreibung), '') = '' then
    raise exception 'Titel und Beschreibung der Aufgabe kommen aus dem Dienst und sind nicht leer'
      using errcode = 'invalid_parameter_value';
  end if;
  if p_faellig is null or p_faellig <= v_heute or p_faellig > v_heute + 31 then
    raise exception 'Die Frist liegt nach dem heutigen Berliner Tag und hoechstens einen Monat weit (V-287)'
      using errcode = 'invalid_parameter_value';
  end if;

  perform 1
     from public.referenz r
     join public.auftrag a on a.mandant_id = r.mandant_id and a.id = r.auftrag_id
    where r.id = p_referenz
      and r.mandant_id = v_mandant
      and r.freigegeben_vom_kunden
      and r.status = 'veroeffentlicht'
      and r.geloescht_am is null
      and a.freigabe_widerrufen_am = now();
  if not found then
    raise exception 'Eine Herausnahme-Aufgabe entsteht nur fuer eine veroeffentlichte Referenz, deren Auftrag in dieser Transaktion widerrufen wurde'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.aufgabe
    (id, mandant_id, titel, beschreibung, status, prioritaet, faellig_datum,
     bezug_typ, bezug_id, quelle, quelle_job, erstellt_von)
  values
    (v_id, v_mandant, btrim(p_titel), btrim(p_beschreibung), 'offen', 'hoch', p_faellig,
     'referenz', p_referenz, 'ereignis', 'ereignis:referenz_widerruf', v_konto)
  on conflict do nothing;
  get diagnostics v_anzahl = row_count;
  return case when v_anzahl = 1 then v_id end;
end $$;

comment on function app.referenz_herausnahme_aufgabe(uuid, date, text, text) is
  'V-287, O-735, D-841. Stellt beim Widerruf einer Kundenfreigabe die Aufgabe Referenz '
  'herausnehmen fuer eine veroeffentlichte Referenz aus diesem Auftrag. Gibt die Kennung '
  'der neuen Aufgabe zurueck, oder null, wenn zu der Referenz schon eine offen ist.';

alter function app.referenz_herausnahme_aufgabe(uuid, date, text, text) owner to cse_definer;
revoke all on function app.referenz_herausnahme_aufgabe(uuid, date, text, text) from public;
grant execute on function app.referenz_herausnahme_aufgabe(uuid, date, text, text) to cse_app;
