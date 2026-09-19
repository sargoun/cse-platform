-- 0247 — der Rechtsgrundlagen-Block eines Kontakts, LISTENFAEHIG gelesen
-- (CRM-08, LEG-08, 04-SEITENKARTE §5.2).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- `/portal/[mandant]/crm/kontakte` soll die Einstufung je Kontakt zeigen und
-- nach ihr filtern. Mit den vorhandenen Mitteln geht beides nicht:
--
--  1. Der Block ist `cse_app` spaltenweise ENTZOGEN (K-05, 0020): nur INSERT
--     und UPDATE, kein SELECT. Ein `where rechtsgrundlage = 'keine'` scheitert
--     mit `42501` — und ein `order by` ebenso, nicht nur die Auswahlliste.
--  2. `app.rechtsgrundlage_lesen(uuid)` (0020) liest EINEN Kontakt und
--     schreibt bei JEDEM Aufruf eine Protokollzeile. Eine Liste mit sechzig
--     Kontakten erzeugte damit sechzig LEG-08-Zeilen pro Seitenaufruf: das
--     Pruefprotokoll fuellte sich mit Abrufen statt mit Vorgaengen, und genau
--     darin verschwindet der eine Abruf, auf den es ankommt.
--
-- 0222 hat dieses Problem fuer das Widerspruchsblatt schon geloest —
-- `app.werbewiderspruch_liste()`: ein Abruf, EINE Protokollzeile. Diese
-- Migration setzt dasselbe Muster fuer die Kontaktliste und fuer das
-- Kontaktblatt.
--
-- ===========================================================================
-- Welches Recht traegt den Block? — `crm.rechtsgrundlage_lesen`
-- ===========================================================================
--
-- Hier stand ein Widerspruch im Haus, und er wird mit dieser Migration
-- aufgeloest:
--
--  · `app.rechtsgrundlage_lesen` (0020) prueft `crm.lesen`.
--  · Der Rechtekatalog fuehrt ein EIGENES Recht `crm.rechtsgrundlage_lesen`,
--    und `04-SEITENKARTE.md` §5.25 bewacht mit ihm genau diese Daten
--    (`/portal/[mandant]/datenschutz/widersprueche`).
--    `app.werbewiderspruch_liste()` (0222) prueft es ebenfalls.
--  · Die Bindungen sind verschieden: `crm.lesen` hat jede `leitung`
--    gebunden, `crm.rechtsgrundlage_lesen` ist fuer `leitung` nur BINDBAR.
--
-- Haetten die neuen Leser `crm.lesen` genommen, saehe jede Leitung auf dem
-- Kontaktblatt genau die Einstufung, die ihr der Werbewiderspruchs-Katalog
-- eine Seite weiter vorenthaelt — eine stille Ausweitung eines Rechts durch
-- die Wahl der Funktion. Die neuen Funktionen verlangen deshalb
-- `crm.rechtsgrundlage_lesen`.
--
-- **`app.rechtsgrundlage_lesen` bleibt unveraendert.** Sie ist die
-- Einzelabfrage der Vorgangsakte, sie hat Aufrufer und eine Zusage in
-- `tests/isolation/datenschutz-nachweis.test.ts`. Eine Funktion, deren
-- geprueftes Recht sich unter ihren Aufrufern aendert, ist kein
-- Rechte-Aufraeumen, sondern ein Ausfall an einer Stelle, die niemand
-- gesucht haette. Welche der beiden bleibt, ist eine Entscheidung und keine
-- Ableitung:
--
-- TODO(client, O-661): Traegt der Rechtsgrundlagen-Block `crm.lesen` (so
-- `app.rechtsgrundlage_lesen`, 0020) oder das engere
-- `crm.rechtsgrundlage_lesen` (so Katalog, Seitenkarte §5.25 und 0222)? Bis
-- zur Antwort gilt in den neuen Lesern das engere Recht und in der alten
-- Einzelabfrage das weitere.

-- ---------------------------------------------------------------------------
-- app.kontakt_rechtsgrundlage_liste() — alle Kontakte, EINE Protokollzeile
-- ---------------------------------------------------------------------------
--
-- Gibt absichtlich NICHT Quelle, Erfassungszeitpunkt und Belegdokument
-- zurueck: fuer eine Liste genuegt die Einstufung, und der Nachweis selbst
-- gehoert auf das Blatt EINES Kontakts, wo ein Mensch ihn liest, statt in eine
-- Tabelle, die jemand exportiert.
--
-- `kunde_name` und `email` stehen mit drin, damit die Seite die Liste nicht
-- gegen eine zweite Abfrage haelt und dabei zwei Momentaufnahmen mischt.
create function app.kontakt_rechtsgrundlage_liste()
returns table (
  ansprechpartner_id  uuid,
  name                text,
  kunde_id            uuid,
  kunde_name          text,
  email               text,
  rechtsgrundlage     text,
  werbewiderspruch_am timestamptz,
  widerspruch_am      timestamptz,
  aehnliche_leistung  boolean,
  kanaele             text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Der Rechtsgrundlagen-Block ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant()) then
    raise exception 'crm.rechtsgrundlage_lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('crm.kontakt_grundlagen_liste_gelesen', 'mandant',
                            app.aktiver_mandant()::text, null, null,
                            app.aktiver_mandant());

  return query
    select ap.id,
           btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname),
           ap.kunde_id, k.name, ap.email,
           ap.rechtsgrundlage::text,
           ap.werbewiderspruch_am, ap.widerspruch_am,
           ap.aehnliche_leistung,
           ap.einwilligung_kanaele
      from public.ansprechpartner ap
      left join public.kunde k
        on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
     where ap.mandant_id = app.aktiver_mandant()
       and ap.archiviert_am is null;
end $$;

alter function app.kontakt_rechtsgrundlage_liste() owner to cse_definer;
revoke execute on function app.kontakt_rechtsgrundlage_liste() from public;
grant execute on function app.kontakt_rechtsgrundlage_liste() to cse_app;

comment on function app.kontakt_rechtsgrundlage_liste() is
  'Die Einstufung nach § 7 UWG je Kontakt, listenfaehig. Prueft '
  'crm.rechtsgrundlage_lesen und schreibt EINE Protokollzeile je Abruf — nicht '
  'eine je Kontakt (LEG-08). Der Nachweis selbst (Quelle, Datum, Beleg) steht '
  'nicht drin; dafuer gibt es app.kontakt_rechtsgrundlage_blatt.';

-- ---------------------------------------------------------------------------
-- app.kontakt_rechtsgrundlage_blatt(uuid) — EIN Kontakt, mit dem Nachweis
-- ---------------------------------------------------------------------------
--
-- Wie `app.rechtsgrundlage_lesen`, aber mit den zwei Spalten aus 0246 und mit
-- dem engeren Recht. Sie ersetzt die alte Funktion NICHT — sie steht neben ihr
-- (siehe O-661 oben).
create function app.kontakt_rechtsgrundlage_blatt(p_ansprechpartner uuid)
returns table (
  rechtsgrundlage        text,
  quelle                 text,
  erfasst_am             timestamptz,
  beleg_dokument_id      uuid,
  einwilligung_kanaele   text[],
  werbewiderspruch_am    timestamptz,
  widerspruch_am         timestamptz,
  aehnliche_leistung     boolean,
  aehnliche_begruendung  text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Der Rechtsgrundlagen-Block ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant()) then
    raise exception 'crm.rechtsgrundlage_lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('ansprechpartner.rechtsgrundlage_gelesen', 'ansprechpartner',
                            p_ansprechpartner::text, null, null, app.aktiver_mandant());

  return query
    select ap.rechtsgrundlage::text, ap.rechtsgrundlage_quelle,
           ap.rechtsgrundlage_erfasst_am, ap.rechtsgrundlage_beleg_dokument_id,
           ap.einwilligung_kanaele, ap.werbewiderspruch_am, ap.widerspruch_am,
           ap.aehnliche_leistung, ap.aehnliche_leistung_begruendung
      from public.ansprechpartner ap
     where ap.id = p_ansprechpartner
       and ap.mandant_id = app.aktiver_mandant();
end $$;

alter function app.kontakt_rechtsgrundlage_blatt(uuid) owner to cse_definer;
revoke execute on function app.kontakt_rechtsgrundlage_blatt(uuid) from public;
grant execute on function app.kontakt_rechtsgrundlage_blatt(uuid) to cse_app;

comment on function app.kontakt_rechtsgrundlage_blatt(uuid) is
  'Der vollstaendige § 7-UWG-Nachweis EINES Kontakts, inklusive der '
  'aehnlichen Leistung (0246). Prueft crm.rechtsgrundlage_lesen und '
  'protokolliert den Abruf (LEG-08).';
