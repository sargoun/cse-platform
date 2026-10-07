-- ===========================================================================
-- 0524 — Das Tor prueft die Matrix des § 7 UWG, und die transaktionale Post
--        laeuft (V-339, V-342, O-65, O-660, D-833)
--
-- app.darf_kontaktiert_werden entstand in 0020 und wurde zuletzt in 0376
-- ersetzt (V-110: ausgeschieden_am in beiden Zweigen). Diese Fassung geht von
-- 0376 aus; alles, was dort stand, steht hier wieder — geaendert sind zwei
-- Dinge, beide als Voreinstellung entschieden und bis hierher nur auf dem
-- Bildschirm angekuendigt.
--
-- 1. transaktional (V-339, O-65, D-792). Terminbestaetigung,
--    Leistungsnachweis, Mahnung, Stoerungs- und Behinderungsanzeige dienen
--    der Durchfuehrung des Vertrags und sind keine Werbung. Sie laufen wie
--    die vertragliche Post: ein Werbewiderspruch (§ 7 Abs. 3 Nr. 3 UWG)
--    haelt sie nicht auf, der Widerspruch nach Art. 21 DSGVO, ein
--    archivierter, anonymisierter oder ausgeschiedener Kontakt schon. Bis
--    hierher fiel transaktional in den Werbezweig und wurde nach einem
--    Werbewiderspruch abgewiesen — der restriktive Zweig, sichtbar statt
--    still, bis zu dieser Migration.
--
-- 2. werbung nach der Matrix (V-342, O-660, D-793) auf den fuenf
--    Fernkanaelen (email, telefon, sms, post, whatsapp):
--      keine          nie                      (§ 7 Abs. 2 Nr. 2 UWG)
--      anfrage        nie — die Anfrage deckt die Antwort, nicht Werbung
--      bestandskunde  nur per E-Mail und nur mit festgestellter aehnlicher
--                     eigener Leistung (aehnliche_leistung, 0246;
--                     § 7 Abs. 3 Nr. 1 und 2 UWG)
--      einwilligung   nur auf den eingewilligten Kanaelen
--    Ausserhalb der Fernkanaele (vor Ort) bleibt es wie bisher: eine
--    aufgezeichnete Grundlage genuegt. Die Ebene des Kunden (Grundlage,
--    beide Widersprueche, gesperrt, archiviert) prueft das Tor weiter mit —
--    die Matrix kennt sie nicht, das Tor bleibt dort strenger.
--
--    Den Hinweis auf das Widerspruchsrecht (§ 7 Abs. 3 Nr. 4 UWG) prueft das
--    Tor nicht: es beurteilt einen Kontakt, keine Nachricht. Der Versandweg
--    haengt ihn an jede Werbenachricht (crm/nachricht-an-kontakt.ts).
--
-- Ein unbekannter Zweck faellt zu (false) — bis hierher landete er im
-- Werbezweig.
--
-- Nur Kommentare mit Doppelstrich.
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
      -- Seit 0524 ebenso die transaktionale (V-339, O-65, D-792).
      when p_zweck in ('vertraglich', 'transaktional') then
           ap.widerspruch_am is null and ap.archiviert_am is null
       and ap.anonymisiert_am is null
       -- V-110: auch die vertragliche Post endet an einer Person, die das
       -- Unternehmen verlassen hat. Sie geht danach an den naechsten Kontakt
       -- oder an kunde.email_zentral — nicht an ein Postfach, das jemand
       -- anderes liest (Art. 5 Abs. 1 lit. d DSGVO).
       and ap.ausgeschieden_am is null
      when p_zweck = 'werbung' then
           ap.widerspruch_am is null
       and ap.werbewiderspruch_am is null
       and ap.archiviert_am is null
       and ap.anonymisiert_am is null
       -- V-110: eine Einwilligung gehoert der PERSON, nicht dem Stuhl.
       and ap.ausgeschieden_am is null
       -- V-342, O-660: die Matrix des § 7 UWG auf den Fernkanaelen.
       and case
             when p_kanal not in ('email','telefon','sms','post','whatsapp')
               then ap.rechtsgrundlage <> 'keine'
             when ap.rechtsgrundlage = 'einwilligung'
               then p_kanal = any (coalesce(ap.einwilligung_kanaele, array[]::text[]))
             when ap.rechtsgrundlage = 'bestandskunde'
               then p_kanal = 'email' and ap.aehnliche_leistung
             else false
           end
       and (ap.kunde_id is null
            or exists (select 1 from public.kunde k
                        where k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
                          and k.rechtsgrundlage <> 'keine'
                          and k.widerspruch_am is null
                          and k.werbewiderspruch_am is null
                          and k.status <> 'gesperrt'
                          and k.archiviert_am is null))
      else false
    end
      from public.ansprechpartner ap
     where ap.id = p_ansprechpartner
       and ap.mandant_id = app.aktiver_mandant()
  ), false);
$$;

comment on function app.darf_kontaktiert_werden(uuid, text, text) is
  'LEG-08 / § 7 UWG: das Tor fuer jede ausgehende Nachricht. V-110 ergaenzt '
  'ausgeschieden_am in BEIDEN Zweigen. 0524 (V-339, V-342): transaktional laeuft wie '
  'vertraglich; Werbung folgt auf den Fernkanaelen der Matrix — anfrage nie, '
  'bestandskunde nur per E-Mail mit aehnlicher Leistung, einwilligung auf den '
  'eingewilligten Kanaelen; die Ebene des Kunden bleibt.';
