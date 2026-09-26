-- ===========================================================================
-- 0376 — Wer ausgeschieden ist, ist nicht mehr erreichbar (V-110, LEG-08,
--        § 7 UWG, Art. 5 Abs. 1 lit. d DSGVO)
--
-- **Der Befund, und er ist aufgefallen, weil ein Test ihn behauptet hat.**
-- `crm/aendern.ts` bekam `scheideKontaktAus()` — der Weg, einen
-- Ansprechpartner als ausgeschieden zu vermerken. Der Kommentar dort sagte:
-- „`app.darf_kontaktiert_werden` prueft `ausgeschieden_am` mit — die Sperre
-- wirkt damit sofort und ueberall."
--
-- Der Test hat das nachgemessen. Es stimmte nicht.
--
--   grep -n ausgeschieden_am  ->  drizzle/0020: die SPALTE.
--                                 Sonst nirgends in einer Bedingung.
--
-- `app.darf_kontaktiert_werden` prueft `widerspruch_am`,
-- `werbewiderspruch_am`, `archiviert_am`, `anonymisiert_am`, den Kanal der
-- Einwilligung und die ganze Kundenseite — aber nicht, ob die Person das
-- Unternehmen verlassen hat.
--
-- ---------------------------------------------------------------------------
-- **Warum das beide Zweige betrifft, auch den vertraglichen.**
-- ---------------------------------------------------------------------------
--
-- Fuer die WERBUNG ist es offensichtlich: eine Einwilligung gehoert der
-- Person, nicht dem Stuhl. Wer die Firma verlaesst, hat in nichts mehr
-- eingewilligt, und die naechste Werbemail geht an ein Postfach, das jemand
-- anderes liest.
--
-- Fuer die VERTRAGLICHE Post gilt dasselbe, und der Grund ist strenger: eine
-- Rechnung oder ein Leistungsnachweis an die persoenliche Adresse einer
-- ausgeschiedenen Person geht an einen Menschen, der sie nicht mehr bekommen
-- soll — oder an einen Nachfolger, der fremde Post liest. Art. 5 Abs. 1
-- lit. d DSGVO verlangt, dass personenbezogene Daten „sachlich richtig und
-- erforderlichenfalls auf dem neuesten Stand" sind; ein Kontakt, von dem das
-- Haus WEISS, dass er ausgeschieden ist, und an den es weiter zustellt, ist
-- das Gegenteil.
--
-- Die vertragliche Post hoert damit nicht auf: sie geht an den naechsten
-- hinterlegten Kontakt oder an die zentrale Adresse des Kunden
-- (`kunde.email_zentral`). Was hier endet, ist die Zustellung an EINE Person,
-- die nicht mehr da ist.
--
-- ---------------------------------------------------------------------------
-- **Der Rest der Funktion bleibt Wort fuer Wort stehen** — einschliesslich
-- des offenen O-65 zum Zweck `transaktional`. Geaendert werden zwei Zeilen;
-- alles andere steht hier nur, weil `create or replace` den ganzen Rumpf
-- verlangt.
-- ===========================================================================

create or replace function app.darf_kontaktiert_werden(
  p_ansprechpartner uuid, p_kanal text, p_zweck text default 'werbung'
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select coalesce((
    select case
      when p_zweck = 'intern' then true
      -- Vertragliche Kommunikation haengt NIE an den Werberegeln (§5.1):
      -- eine Rechnung darf zugestellt werden, auch nach Werbewiderspruch.
      --
      -- `transaktional` steht hier ABSICHTLICH NICHT. Ob eine
      -- Terminbestaetigung oder eine Mahnung vertraglich notwendig ist oder
      -- als Werbung gilt, ist die offene Frage O-65 — und §5.1 nennt fuer den
      -- Zweifel den restriktiven Zweig. Die Folge ist gewollt und sichtbar:
      -- bis O-65 beantwortet ist, wird eine transaktionale Nachricht an einen
      -- Kontakt mit Werbewiderspruch abgelehnt, statt lautlos zu gehen.
      -- // TODO(client, O-65): Gilt `transaktional` (Terminbestaetigung,
      -- Leistungsnachweis, Mahnung) als vertraglich notwendig?
      when p_zweck = 'vertraglich' then
           ap.widerspruch_am is null and ap.archiviert_am is null
       and ap.anonymisiert_am is null
       -- V-110: auch die vertragliche Post endet an einer Person, die das
       -- Unternehmen verlassen hat. Sie geht danach an den naechsten Kontakt
       -- oder an `kunde.email_zentral` — nicht an ein Postfach, das jemand
       -- anderes liest (Art. 5 Abs. 1 lit. d DSGVO).
       and ap.ausgeschieden_am is null
      else
           ap.rechtsgrundlage <> 'keine'
       and ap.widerspruch_am is null
       and ap.werbewiderspruch_am is null
       and ap.archiviert_am is null
       and ap.anonymisiert_am is null
       -- V-110: eine Einwilligung gehoert der PERSON, nicht dem Stuhl.
       and ap.ausgeschieden_am is null
       and (ap.rechtsgrundlage <> 'einwilligung'
            or p_kanal not in ('email','telefon','sms','post','whatsapp')
            or p_kanal = any (coalesce(ap.einwilligung_kanaele, array[]::text[])))
       and (ap.kunde_id is null
            or exists (select 1 from public.kunde k
                        where k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
                          and k.rechtsgrundlage <> 'keine'
                          and k.widerspruch_am is null
                          and k.werbewiderspruch_am is null
                          and k.status <> 'gesperrt'
                          and k.archiviert_am is null))
    end
      from public.ansprechpartner ap
     where ap.id = p_ansprechpartner
       and ap.mandant_id = app.aktiver_mandant()
  ), false);
$$;

comment on function app.darf_kontaktiert_werden(uuid, text, text) is
  'LEG-08 / § 7 UWG: das Tor fuer jede ausgehende Nachricht. V-110 ergaenzt '
  '`ausgeschieden_am` in BEIDEN Zweigen — eine Einwilligung gehoert der '
  'Person, nicht dem Stuhl, und vertragliche Post an eine ausgeschiedene '
  'Person liest ihr Nachfolger (Art. 5 Abs. 1 lit. d DSGVO).';
