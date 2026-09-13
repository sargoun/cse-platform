-- ===========================================================================
-- 0138 — Das Portal einer Mandantssitzung kommt auch aus der GLOBALEN Rolle
-- ===========================================================================
--
-- Gefunden von `tests/e2e/gruppe.spec.ts` (D-474): eine Super-Administration
-- ohne Mitgliedschaft — TEN-08 sagt ausdruecklich, dass sie keine
-- Zuweisungszeile mitbringt — wechselt aus der Gruppenansicht in einen Bereich
-- und landet auf `/portal/mein`. `app.sitzung_aufloesen` leitete das Portal
-- einer Mandantssitzung allein aus `benutzer_mandant` ab und fiel ohne Zeile
-- auf `mitarbeiter` zurueck: fail-closed fuer ein UNBEKANNTES Portal, hier aber
-- schlicht falsch — die Rolle ist bekannt, sie steht in `benutzer.globale_rolle_id`
-- und traegt `portal = 'intern'`.
--
-- Die K-04-Decke griff dann mit dem falschen Portal: `intern` darf `mandant`
-- betreten, `mitarbeiter` nicht, also Weiterleitung ins Arbeiterportal. Dass
-- der Switcher der Super-Administration jeden Bereich ANBIETET
-- (`app.switcher_mandanten`, `kern.sitzung_mandant_pruefen`), war damit ein
-- Angebot, das man annehmen, aber nicht nutzen konnte.
--
-- Die Reihenfolge bleibt: Mitgliedschaftsrolle vor globaler Rolle. Wer in
-- einer Gesellschaft eine engere Rolle traegt, wird dort nicht durch die
-- globale Rolle geweitet — die Mitgliedschaft ist die Aussage ueber DIESEN
-- Bereich. Erst wo keine steht, zaehlt die globale Rolle; und erst wo auch die
-- fehlt, bleibt es beim fail-closed `mitarbeiter`.
-- ===========================================================================

create or replace function app.sitzung_aufloesen(p_token_hash text)
returns table (
  benutzer_id uuid, person_id uuid, aktiver_mandant_id uuid,
  ansicht text, aal text, portal text, sitzung_id uuid
)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_leerlauf int := coalesce((app.plattform_einstellung('auth.leerlauf_minuten'))::int, 480);
begin
  return query
  update public.benutzer_sitzung s
     set letzte_aktivitaet_am = now()
    from public.benutzer b
   where s.token_hash = p_token_hash
     and s.benutzer_id = b.id
     and s.beendet_am is null
     and s.ablauf_am > now()
     and s.letzte_aktivitaet_am > now() - make_interval(mins => v_leerlauf)
     and b.deaktiviert_am is null
     and b.status = 'aktiv'
     and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
     and not b.ist_dienstkonto
  returning b.id, b.person_id, s.aktiver_mandant_id,
            s.ansicht::text, s.aal::text,
            -- Das Portal kommt aus der ROLLE (K-04), nicht aus dem Cookie:
            -- zuerst aus der Mitgliedschaft im aktiven Bereich, sonst aus
            -- der globalen Rolle (TEN-08), sonst fail-closed. In den drei
            -- mandantenuebergreifenden Ansichten ist es eine Konstante des
            -- Scopes.
            case
              when s.ansicht = 'mandant' then coalesce(
                (select r.portal from public.benutzer_mandant bm
                   join public.rolle r on r.id = bm.rolle_id
                  where bm.benutzer_id = b.id and bm.mandant_id = s.aktiver_mandant_id
                    and bm.entzogen_am is null limit 1),
                (select r.portal from public.rolle r
                  where r.id = b.globale_rolle_id
                    and r.geltungsbereich = 'global' and r.archiviert_am is null),
                'mitarbeiter')
              when s.ansicht = 'gruppe' then 'intern'
              when s.ansicht = 'person' then 'mitarbeiter'
              else 'kunde'
            end,
            s.id;
end $$;

comment on function app.sitzung_aufloesen(text) is
  'Loest ein Sitzungstoken auf. Portal: Mitgliedschaftsrolle, sonst globale Rolle (TEN-08), sonst mitarbeiter (K-04). 0138.';
