-- 0494 — die Angaben einer Gesellschaft pflegen und bestaetigen (V-390, D-804).
--
-- Register, Steuernummern, Anschrift, Bank und Rechtsform einer Gesellschaft
-- kamen bis hierher nur aus dem Seed oder per SQL: cse_app liest mandant
-- (0004), schreibt aber nicht, und das Recht system.mandant_verwalten (0008,
-- nur global, Super-Administration) hatte keinen Weg. Die Seite
-- Unternehmensdaten sagte trotzdem, geaendert werde ueber die
-- Super-Administration.
--
-- Zwei Wege, beide als Definer mit demselben Tor — genau eine aktive
-- Gesellschaft und keine Gruppenansicht (Invariante 10), keine lesende
-- Sitzung, zweiter Faktor, system.mandant_verwalten:
--
--   app.mandant_angaben_setzen(jsonb)   schreibt die pflegbaren Spalten der
--     aktiven Gesellschaft. Aendert sich etwas, ist die Bestaetigung weg: eine
--     geaenderte Angabe ist eine unbestaetigte.
--   app.mandant_angaben_bestaetigen()   setzt angaben_bestaetigt_am auf die
--     Serveruhr (Invariante 5).
--
-- Slug, Markenname, Module, Farbe und Sortierung bleiben draussen. Jede
-- Aenderung schreibt trg_mandant_audit (0005) mit vorher und nachher ins
-- Protokoll (TEN-09). Die CHECKs aus 0001 und 0120 bleiben die letzte Linie;
-- der Dienst sagt dieselben Regeln vorher in Worten. Festgeschriebene
-- Rechnungen tragen ihre eingefrorenen Angaben (0120) und aendern sich nicht.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Was der Definer schreiben darf — und an welcher Zeile.
-- ---------------------------------------------------------------------------
grant update (firma, rechtsform, ist_rechtseinheit, eigener_nummernkreis,
              handelsregister_gericht, handelsregister_nummer, geschaeftsfuehrer,
              ust_id, steuernummer, finanzamt, betriebsnummer,
              strasse, plz, ort, land, telefon, email, web,
              iban, bic, bank, rechnung_kontakt_name,
              elektronische_adresse, elektronische_adresse_schema,
              angaben_bestaetigt_am)
  on mandant to cse_definer;

-- Nur die aktive Gesellschaft. Das Tor steht in den Funktionen UND hier:
-- fehlt eines, haelt das andere.
create policy d_mandant_angaben_pflegen on mandant for update to cse_definer
  using      (id = app.aktiver_mandant())
  with check (id = app.aktiver_mandant());

-- ---------------------------------------------------------------------------
-- 2. Pflegen.
-- ---------------------------------------------------------------------------
-- Gibt zurueck, ob sich etwas geaendert hat. Dasselbe Formular zweimal
-- abzuschicken ist kein Fehler und nimmt keine Bestaetigung zurueck.
create function app.mandant_angaben_setzen(p_angaben jsonb) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_unbekannt text;
  v_zahl integer;
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Die Angaben einer Gesellschaft pflegt man in genau einer aktiven Gesellschaft.'
      using errcode = '42501', hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Die Angaben einer Gesellschaft verlangen den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  if not app.hat_recht('system.mandant_verwalten', v_mandant) then
    raise exception 'Die Angaben einer Gesellschaft verlangen system.mandant_verwalten.'
      using errcode = '42501';
  end if;

  if p_angaben is null or jsonb_typeof(p_angaben) <> 'object' then
    raise exception 'Angaben fehlen.' using errcode = '22023', detail = 'keine_angaben';
  end if;
  select k into v_unbekannt
    from jsonb_object_keys(p_angaben) k
   where k not in ('firma', 'rechtsform', 'ist_rechtseinheit', 'eigener_nummernkreis',
                   'handelsregister_gericht', 'handelsregister_nummer', 'geschaeftsfuehrer',
                   'ust_id', 'steuernummer', 'finanzamt', 'betriebsnummer',
                   'strasse', 'plz', 'ort', 'land', 'telefon', 'email', 'web',
                   'iban', 'bic', 'bank', 'rechnung_kontakt_name',
                   'elektronische_adresse', 'elektronische_adresse_schema')
   limit 1;
  if v_unbekannt is not null then
    raise exception 'Unbekanntes Feld: %', v_unbekannt
      using errcode = '22023', detail = 'unbekanntes_feld';
  end if;
  if coalesce(btrim(p_angaben ->> 'firma'), '') = '' then
    raise exception 'Die Firma fehlt.' using errcode = '22023', detail = 'firma_fehlt';
  end if;

  with neu as (
    select btrim(p_angaben ->> 'firma')                                      as firma,
           nullif(btrim(p_angaben ->> 'rechtsform'), '')                     as rechtsform,
           (p_angaben ->> 'ist_rechtseinheit')::boolean                      as ist_rechtseinheit,
           coalesce((p_angaben ->> 'eigener_nummernkreis')::boolean, false)  as eigener_nummernkreis,
           nullif(btrim(p_angaben ->> 'handelsregister_gericht'), '')        as handelsregister_gericht,
           nullif(btrim(p_angaben ->> 'handelsregister_nummer'), '')         as handelsregister_nummer,
           coalesce(array(select nullif(btrim(g), '')
                            from jsonb_array_elements_text(
                                   coalesce(p_angaben -> 'geschaeftsfuehrer', '[]'::jsonb)) g
                           where nullif(btrim(g), '') is not null), '{}')    as geschaeftsfuehrer,
           nullif(btrim(p_angaben ->> 'ust_id'), '')                         as ust_id,
           nullif(btrim(p_angaben ->> 'steuernummer'), '')                   as steuernummer,
           nullif(btrim(p_angaben ->> 'finanzamt'), '')                      as finanzamt,
           nullif(btrim(p_angaben ->> 'betriebsnummer'), '')                 as betriebsnummer,
           nullif(btrim(p_angaben ->> 'strasse'), '')                        as strasse,
           nullif(btrim(p_angaben ->> 'plz'), '')                            as plz,
           nullif(btrim(p_angaben ->> 'ort'), '')                            as ort,
           coalesce(nullif(upper(btrim(p_angaben ->> 'land')), ''), 'DE')    as land,
           nullif(btrim(p_angaben ->> 'telefon'), '')                        as telefon,
           nullif(btrim(p_angaben ->> 'email'), '')                          as email,
           nullif(btrim(p_angaben ->> 'web'), '')                            as web,
           nullif(btrim(p_angaben ->> 'iban'), '')                           as iban,
           nullif(btrim(p_angaben ->> 'bic'), '')                            as bic,
           nullif(btrim(p_angaben ->> 'bank'), '')                           as bank,
           nullif(btrim(p_angaben ->> 'rechnung_kontakt_name'), '')          as rechnung_kontakt_name,
           nullif(btrim(p_angaben ->> 'elektronische_adresse'), '')          as elektronische_adresse,
           nullif(btrim(p_angaben ->> 'elektronische_adresse_schema'), '')   as elektronische_adresse_schema
  )
  update public.mandant m
     set firma = n.firma, rechtsform = n.rechtsform,
         ist_rechtseinheit = n.ist_rechtseinheit,
         eigener_nummernkreis = n.eigener_nummernkreis,
         handelsregister_gericht = n.handelsregister_gericht,
         handelsregister_nummer = n.handelsregister_nummer,
         geschaeftsfuehrer = n.geschaeftsfuehrer,
         ust_id = n.ust_id, steuernummer = n.steuernummer, finanzamt = n.finanzamt,
         betriebsnummer = n.betriebsnummer,
         strasse = n.strasse, plz = n.plz, ort = n.ort, land = n.land,
         telefon = n.telefon, email = n.email, web = n.web,
         iban = n.iban, bic = n.bic, bank = n.bank,
         rechnung_kontakt_name = n.rechnung_kontakt_name,
         elektronische_adresse = n.elektronische_adresse,
         elektronische_adresse_schema = n.elektronische_adresse_schema,
         angaben_bestaetigt_am = null
    from neu n
   where m.id = v_mandant
     and (m.firma, m.rechtsform, m.ist_rechtseinheit, m.eigener_nummernkreis,
          m.handelsregister_gericht, m.handelsregister_nummer, m.geschaeftsfuehrer,
          m.ust_id, m.steuernummer, m.finanzamt, m.betriebsnummer,
          m.strasse, m.plz, m.ort, m.land::text, m.telefon, m.email, m.web,
          m.iban, m.bic, m.bank, m.rechnung_kontakt_name,
          m.elektronische_adresse, m.elektronische_adresse_schema)
         is distinct from
         (n.firma, n.rechtsform, n.ist_rechtseinheit, n.eigener_nummernkreis,
          n.handelsregister_gericht, n.handelsregister_nummer, n.geschaeftsfuehrer,
          n.ust_id, n.steuernummer, n.finanzamt, n.betriebsnummer,
          n.strasse, n.plz, n.ort, n.land, n.telefon, n.email, n.web,
          n.iban, n.bic, n.bank, n.rechnung_kontakt_name,
          n.elektronische_adresse, n.elektronische_adresse_schema);
  get diagnostics v_zahl = row_count;
  return v_zahl > 0;
end $$;

comment on function app.mandant_angaben_setzen(jsonb) is
  'V-390, D-804: schreibt die pflegbaren Angaben der aktiven Gesellschaft '
  '(Firma, Rechtsform, Register, Steuern, Anschrift, Kontakt, Bank, '
  'Rechnungskontakt, elektronische Adresse). Verlangt system.mandant_verwalten '
  'und aal2. Aendert sich etwas, ist angaben_bestaetigt_am wieder leer. Gibt '
  'zurueck, ob sich etwas geaendert hat.';

alter function app.mandant_angaben_setzen(jsonb) owner to cse_definer;
revoke execute on function app.mandant_angaben_setzen(jsonb) from public;
grant execute on function app.mandant_angaben_setzen(jsonb) to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Bestaetigen.
-- ---------------------------------------------------------------------------
create function app.mandant_angaben_bestaetigen() returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_am timestamptz;
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Die Angaben einer Gesellschaft bestaetigt man in genau einer aktiven Gesellschaft.'
      using errcode = '42501', hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() then
    raise exception 'Diese Sitzung ist lesend.' using errcode = '42501';
  end if;
  if app.aal() <> 'aal2' then
    raise exception 'Die Angaben einer Gesellschaft verlangen den zweiten Faktor.'
      using errcode = '42501', hint = 'K-15.';
  end if;
  if not app.hat_recht('system.mandant_verwalten', v_mandant) then
    raise exception 'Die Angaben einer Gesellschaft verlangen system.mandant_verwalten.'
      using errcode = '42501';
  end if;

  update public.mandant
     set angaben_bestaetigt_am = now()
   where id = v_mandant
  returning angaben_bestaetigt_am into v_am;
  if v_am is null then
    raise exception 'Gesellschaft nicht gefunden.' using errcode = 'P0002';
  end if;
  return v_am;
end $$;

comment on function app.mandant_angaben_bestaetigen() is
  'V-390, D-804: setzt angaben_bestaetigt_am der aktiven Gesellschaft auf die '
  'Serveruhr. Verlangt system.mandant_verwalten und aal2.';

alter function app.mandant_angaben_bestaetigen() owner to cse_definer;
revoke execute on function app.mandant_angaben_bestaetigen() from public;
grant execute on function app.mandant_angaben_bestaetigen() to cse_app;
