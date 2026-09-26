-- 0383 — die Aufwandskategorie findet ihr Konto (V-126, ACC-01, FIN-14, O-05).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `0180:469` hat die Sperre `km_typ_hat_eltern` aufgehoben und
-- `konto_mapping.ausgabe_kategorie_id` samt Fremdschluessel gesetzt: eine
-- Kontenzuordnung je Aufwandskategorie laesst sich seither eintragen, und
-- `/buchhaltung/konten` fuehrt sie als „Aufwandskonto (Kategorie)".
--
-- **Gefunden wird sie nie.** Die Stufenleiter in `app.konto_aufloesen`
-- (0126) kennt keinen Zweig fuer `aufwand_kategorie`; jede solche Zeile
-- bekommt `stufe = null` und faellt aus `where ka.stufe is not null`
-- heraus. Der Aufrufer bekommt „Kontenzuordnung fehlt (aufwand_kategorie)"
-- — und zwar auch dann, wenn sie danebensteht.
--
-- Betroffen ist nicht nur die Ausgabe (V-011): `bucheEingangsrechnung`
-- kontiert den Aufwand einer Lieferantenrechnung seit `0131` ueber
-- denselben Typ.
--
-- ===========================================================================
-- Warum ein DROP und kein CREATE OR REPLACE
-- ===========================================================================
--
-- Ein zusaetzlicher Parameter mit Vorgabewert erzeugt eine zweite Signatur,
-- keine ersetzte. Beide lebten dann nebeneinander, und ein Aufruf mit zehn
-- Argumenten waere mehrdeutig — PostgreSQL entscheidet das nicht, es weist
-- ab. Die alte Fassung wird deshalb entfernt und die neue gesetzt.
--
-- ===========================================================================
-- Vier Stufen, und die Reihenfolge ist die Aussage
-- ===========================================================================
--
--   1  diese Kategorie UND dieser Steuersatz   — die genaueste Zuordnung
--   2  diese Kategorie, Satz offen             — die Kategorie entscheidet
--   3  keine Kategorie, dieser Steuersatz      — die Hausregel je Satz
--   4  keine Kategorie, kein Satz              — das Sammelkonto
--
-- Dieselbe Bauart wie bei `erloes_leistung` (Stufen 1–4 dort), und aus
-- demselben Grund: die speziellere Zeile gewinnt, und wo keine steht, faellt
-- es auf die allgemeinere zurueck — statt gar nichts zu finden.
--
-- **Die Stufen 3 und 4 sind kein erfundener Kontenrahmen.** Sie greifen nur
-- auf Zeilen, die jemand eingetragen hat; ohne Eintrag bleibt es bei
-- „Kontenzuordnung fehlt", und die Buchungszeile steht mit Hinweis in der
-- Arbeitsliste (D-425). Welches SKR-Konto je Kategorie gilt, bleibt O-05.

drop function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                  uuid, uuid, uuid, uuid);

create function app.konto_aufloesen(
  p_mandant                     uuid,
  p_typ                         konto_schluessel_typ,
  p_datum                       date,
  p_leistungskatalog_position   uuid    default null,
  p_erloeskonto_schluessel      text    default null,
  p_steuersatz_gruppe           uuid    default null,
  p_kunde                       uuid    default null,
  p_lieferant                   uuid    default null,
  p_bankkonto                   uuid    default null,
  p_kasse                       uuid    default null,
  p_ausgabe_kategorie           uuid    default null
) returns konto_treffer
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_rahmen kontenrahmen;
  v_zeile  record;
begin
  if session_user = 'cse_job' then
    null;
  elsif app.ist_gruppenansicht() then
    if not (p_mandant = any (app.rechte_mandanten('gruppe.buchhaltung.lesen'))) then
      raise exception 'gruppe.buchhaltung.lesen fehlt' using errcode = '42501';
    end if;
  elsif not (app.hat_recht('buchhaltung.schreiben', p_mandant)
             or app.hat_recht('buchhaltung.lesen', p_mandant)
             or app.hat_recht('buchhaltung_konfiguration.lesen', p_mandant)) then
    raise exception 'buchhaltung.lesen fehlt' using errcode = '42501';
  end if;

  select dk.kontenrahmen into v_rahmen
    from public.datev_konfiguration dk
   where dk.mandant_id = p_mandant;

  if v_rahmen is null then
    return (null, null, null, null, true,
            'Kontenrahmen nicht festgelegt (O-05)')::konto_treffer;
  end if;

  select k.* into v_zeile from (
    with kandidat as (
      select km.*,
             case
               when km.schluessel_typ = 'erloes_leistung'
                    and km.leistungskatalog_position_id is not null
                    and km.leistungskatalog_position_id = p_leistungskatalog_position
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 1
               when km.schluessel_typ = 'erloes_leistung'
                    and km.leistungskatalog_position_id is not null
                    and km.leistungskatalog_position_id = p_leistungskatalog_position
                    and km.steuersatz_gruppe_id is null                            then 2
               when km.schluessel_typ = 'erloes_leistung'
                    and km.erloeskonto_schluessel is not null
                    and km.erloeskonto_schluessel = p_erloeskonto_schluessel
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 3
               when km.schluessel_typ = 'erloes_leistung'
                    and km.erloeskonto_schluessel is not null
                    and km.erloeskonto_schluessel = p_erloeskonto_schluessel
                    and km.steuersatz_gruppe_id is null                            then 4
               -- V-126: der Zweig, der fehlte.
               when km.schluessel_typ = 'aufwand_kategorie'
                    and km.ausgabe_kategorie_id is not null
                    and km.ausgabe_kategorie_id = p_ausgabe_kategorie
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 1
               when km.schluessel_typ = 'aufwand_kategorie'
                    and km.ausgabe_kategorie_id is not null
                    and km.ausgabe_kategorie_id = p_ausgabe_kategorie
                    and km.steuersatz_gruppe_id is null                            then 2
               when km.schluessel_typ = 'aufwand_kategorie'
                    and km.ausgabe_kategorie_id is null
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 3
               when km.schluessel_typ = 'aufwand_kategorie'
                    and km.ausgabe_kategorie_id is null
                    and km.steuersatz_gruppe_id is null                            then 4
               when km.schluessel_typ = 'steuer_gruppe'
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 5
               when km.schluessel_typ = 'debitor_kunde'      and km.kunde_id     = p_kunde     then 1
               when km.schluessel_typ = 'kreditor_lieferant' and km.lieferant_id = p_lieferant then 1
               when km.schluessel_typ = 'geldkonto'
                    and (km.bankkonto_id = p_bankkonto or km.kasse_id = p_kasse)   then 1
               when km.schluessel_typ in ('bauabzugsteuer_verbindlichkeit', 'skonto_aufwand',
                                          'skonto_ertrag', 'mahngebuehr_ertrag', 'zins_ertrag',
                                          'durchlaufender_posten')                 then 1
               else null
             end as stufe
        from public.konto_mapping km
       where km.mandant_id = p_mandant
         and km.schluessel_typ = p_typ
         and km.kontenrahmen = v_rahmen
         and km.gueltig_von <= p_datum
         and (km.gueltig_bis is null or km.gueltig_bis >= p_datum)
    )
    select ka.id, ka.konto, ka.gegenkonto, ka.bu_schluessel, ka.ist_platzhalter,
           ka.stufe, ka.prioritaet, ka.gueltig_von,
           count(*) over (partition by ka.stufe, ka.prioritaet, ka.gueltig_von) as gleichstand
      from kandidat ka
     where ka.stufe is not null
     order by ka.stufe, ka.prioritaet, ka.gueltig_von desc
     limit 1
  ) k;

  if not found then
    return (null, null, null, null, true,
            format('Kontenzuordnung fehlt (%s)', p_typ))::konto_treffer;
  end if;

  if v_zeile.gleichstand > 1 then
    return (null, null, null, v_zeile.id, true, 'Kontierung mehrdeutig')::konto_treffer;
  end if;

  if v_zeile.ist_platzhalter then
    return (null, null, null, v_zeile.id, true,
            'Kontenzuordnung ist noch ein Platzhalter (O-05)')::konto_treffer;
  end if;

  return (v_zeile.konto, v_zeile.gegenkonto, v_zeile.bu_schluessel,
          v_zeile.id, false, null)::konto_treffer;
end $$;

alter function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                   uuid, uuid, uuid, uuid, uuid) owner to cse_definer;
revoke all on function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                           uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text,
                                              uuid, uuid, uuid, uuid, uuid, uuid)
  to cse_app, cse_job;

comment on function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                        uuid, uuid, uuid, uuid, uuid) is
  'V-126, ACC-01. Loest die Kontenzuordnung eines Geschaeftsvorfalls auf. Der '
  'Zweig fuer aufwand_kategorie kam mit 0383 dazu: 0180 hatte die Sperre '
  'aufgehoben und die Elternspalte gesetzt, die Stufenleiter aber nicht '
  'erweitert — eine hinterlegte Zuordnung war damit eintragbar und '
  'unauffindbar. Kein Treffer bleibt KEIN Fehler: die Buchungszeile entsteht '
  'ohne Konto, mit Hinweis, und haelt den Monatsabschluss auf (D-425).';
