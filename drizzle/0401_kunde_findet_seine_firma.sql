-- ===========================================================================
-- 0401 — Ein Kunde mit USt-IdNr. findet seine Firma (V-140, CRM-06)
-- ===========================================================================
-- **Der Befund.** Die Gruppenliste der Kunden erkennt denselben Kunden in
-- zwei Gesellschaften allein an kunde.firma_id (Spalte auch in). Die einzige
-- Stelle, an der eine firma entsteht, ist app.firma_aufloesen (0020) — und
-- die hatte in der Anwendung keinen Aufrufer. Jeder im Portal angelegte
-- Kunde blieb ohne firma_id, auch mit USt-IdNr., und die
-- gesellschaftsuebergreifende Historie war fuer echte Daten immer leer.
--
-- **Ab jetzt** loest services/crm/anlegen.ts beim Anlegen und
-- services/crm/aendern.ts beim Nachtragen der USt-IdNr. ueber
-- app.firma_aufloesen auf (D-634). Diese Migration holt den BESTAND nach.
--
-- **Warum hier nicht app.firma_aufloesen.** Die Funktion verlangt
-- crm.schreiben im aktiven Mandanten; sie ist der Weg einer Benutzersitzung.
-- Eine Migration hat keine Sitzung. Sie uebernimmt deshalb dieselbe Regel
-- wortgleich: die USt-IdNr. ohne Leerraum und in Grossbuchstaben ist die
-- Identitaet, eine vorhandene Firma mit dieser Nummer wird verknuepft, sonst
-- entsteht genau eine. Ohne USt-IdNr. entsteht KEINE Firma: ein gleicher
-- Name ist keine gleiche Rechtseinheit, und zwei Muster GmbH in Berlin sind
-- zwei Unternehmen.
--
-- Nicht angefasst werden: Privatkunden (eine Person ist keine Firma),
-- archivierte und anonymisierte Kunden (eine Anonymisierung darf nicht
-- nachtraeglich wieder eine Identitaet bekommen), und Kunden, die schon eine
-- firma_id tragen.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0394 bis 0400 (0392 und 0393 folgen ihr noch nicht).
-- ===========================================================================

do $$
declare
  k       record;
  v_norm  text;
  v_firma uuid;
begin
  for k in
    select id, name, ust_id, land
      from public.kunde
     where firma_id is null
       and typ in ('firma', 'behoerde')
       and archiviert_am is null
       and anonymisiert_am is null
       and nullif(regexp_replace(coalesce(ust_id, ''), '\s', '', 'g'), '') is not null
     order by erstellt_am, id
  loop
    v_norm := upper(regexp_replace(k.ust_id, '\s', '', 'g'));
    v_firma := null;
    select f.id into v_firma from public.firma f where f.ust_id = v_norm;
    if v_firma is null then
      insert into public.firma (name, ust_id, land)
      values (btrim(k.name), v_norm, coalesce(k.land, 'DE'))
      returning id into v_firma;
    end if;
    update public.kunde set firma_id = v_firma where id = k.id;
  end loop;
end $$;
