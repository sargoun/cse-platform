-- 0525 — Jeder Kundenabruf einer Rechnungsdatei hinterlaesst eine Spur
--        (V-347, O-843, D-794, D-835)
--
-- Die beiden Abrufe des Kundenportals (/api/kunde/rechnungen/[id]/zugferd.pdf
-- und .../xrechnung.xml) erzeugten die Datei aus rechnung_snapshot und
-- vermerkten nichts. Voreinstellung (O-843, D-794): jeder Kundenabruf
-- hinterlaesst VOR der Auslieferung eine Spur.
--
-- Die Spur ist eine Zeile im Pruefprotokoll (audit_log), geschrieben ueber
-- app.protokolliere mit der Gesellschaft DES BELEGS — der Kunden-Scope hat
-- keinen aktiven Mandanten (K-20), und eine Zeile ohne Gesellschaft fiele aus
-- jeder Sicht der Gesellschaft heraus. aktion = kundenportal.rechnung_abgerufen,
-- objekt = die Rechnung, nachher = Datei, Kunde und Nummer; Zeit, Konto und
-- Sitzung setzt app.protokolliere selbst.
--
-- Geprueft wird hier, nicht in der Route:
--  1. nur eine Kundensitzung vermerkt einen Kundenabruf;
--  2. nur die beiden Dateien, die es gibt;
--  3. nur ein EIGENER festgeschriebener Beleg — gelesen unter der RLS des
--     Kunden (t_kunde, 0075; die Decke p_rechnung_decke). Die Funktion laeuft
--     deshalb als Aufrufer und nicht als Definer: eine Leseerlaubnis fuer
--     cse_definer auf rechnung im Kunden-Scope waere eine Verbreiterung
--     (tests/isolation/rechnung.test.ts zaehlt jede), und die Policy des
--     Kunden ist genau die Pruefung, die hier gebraucht wird. Geschrieben wird
--     ueber den bestehenden Definer app.protokolliere.
--
-- Nur Kommentare mit Doppelstrich.

create function app.kunde_rechnung_abruf_vermerken(p_rechnung uuid, p_datei text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid;
  v_kunde   uuid;
  v_nummer  text;
begin
  if app.scope() is distinct from 'kunde' then
    raise exception 'Einen Kundenabruf vermerkt nur eine Kundensitzung (V-347)'
      using errcode = 'insufficient_privilege';
  end if;
  if p_datei is null or p_datei not in ('zugferd', 'xrechnung') then
    raise exception 'Unbekannte Datei: %', coalesce(p_datei, 'NULL')
      using errcode = 'invalid_parameter_value';
  end if;

  select r.mandant_id, r.kunde_id, r.nummer
    into v_mandant, v_kunde, v_nummer
    from public.rechnung r
   where r.id = p_rechnung
     and r.status = 'festgeschrieben'
     and r.kunde_id = any (app.aktuelle_kunden());
  if v_mandant is null then
    raise exception 'Diese Rechnung steht nicht im Zugang dieses Kunden'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere(
    'kundenportal.rechnung_abgerufen', 'rechnung', p_rechnung::text, null,
    jsonb_build_object('datei', p_datei, 'kunde_id', v_kunde, 'nummer', v_nummer),
    v_mandant);
end $$;

comment on function app.kunde_rechnung_abruf_vermerken(uuid, text) is
  'V-347, O-843, D-835. Vermerkt den Abruf einer Rechnungsdatei durch den Kunden im '
  'Pruefprotokoll — vor der Auslieferung, mit der Gesellschaft des Belegs. Nur in der '
  'Kundensitzung, nur fuer einen eigenen festgeschriebenen Beleg (RLS des Aufrufers).';

revoke all on function app.kunde_rechnung_abruf_vermerken(uuid, text) from public;
grant execute on function app.kunde_rechnung_abruf_vermerken(uuid, text) to cse_app;
