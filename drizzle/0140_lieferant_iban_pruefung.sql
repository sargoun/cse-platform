-- ===========================================================================
-- 0140 — Die Bankverbindung einer E-Rechnung gegen den Stamm pruefen,
--        ohne die Bankverbindung zu lesen (PR 63, D-482)
-- ===========================================================================
--
-- **Die Betrugsflaeche.** Der haeufigste Angriff auf eine Kreditorenbuchhaltung
-- ist die echte Rechnung mit der falschen IBAN: Lieferant, Nummer, Betrag
-- stimmen, nur das Konto gehoert jemand anderem. Ein Vorschlag aus einer
-- E-Rechnung (ACC-05) muss deshalb sagen, ob die IBAN in der Datei die des
-- Stamms ist — BEVOR ein Mensch freigibt.
--
-- **Aber die IBAN gehoert nicht in die Sitzung.** 0123 hat `lieferant.iban`
-- aus dem Spaltenrecht von `cse_app` genommen (K-05): gelesen wird sie nur
-- ueber `app.lieferant_konditionen`, unter `zahlung.lesen`, mit Spur im
-- `audit_log`. Wer einen Vorschlag anlegt (`eingang.schreiben`), zahlt nicht
-- und soll die Bankverbindung nicht sehen. Er soll nur EINE Antwort bekommen:
-- stimmt sie mit dem, was die Datei nennt, oder nicht.
--
-- Deshalb ein Tor, das ein Boolean zurueckgibt und nie die IBAN:
--   true   — die Datei nennt die Bankverbindung des Stamms
--   false  — sie weicht ab (der Vorschlag markiert das Feld unsicher)
--   null   — nicht pruefbar: kein Lieferant, kein Recht, kein Stamm-Eintrag
--            (O-183: Lieferanten ohne Bankverbindung sind heute der Normalfall)
--
-- `null` fuer „kein Recht" und fuer „kein Eintrag" ist dieselbe Antwort, mit
-- Absicht: wer das Recht nicht hat, erfaehrt nicht einmal, OB ein Eintrag
-- existiert. Der Vergleich normalisiert Leerzeichen und Schreibung, sonst
-- nichts — eine IBAN, die nur bis auf einen Bindestrich stimmt, stimmt nicht.
--
-- Jede Pruefung steht im `audit_log` (`lieferant.iban_geprueft`): wer wann
-- welche Lieferantin gegen welche Datei gehalten hat, ist im Streitfall die
-- Spur, die zaehlt.
-- ===========================================================================

create function app.lieferant_iban_stimmt(p_lieferant uuid, p_iban text)
returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid;
  v_iban    text;
begin
  if p_lieferant is null or p_iban is null or btrim(p_iban) = '' then return null; end if;

  select l.mandant_id, l.iban into v_mandant, v_iban
    from public.lieferant l where l.id = p_lieferant;
  if v_mandant is null then return null; end if;
  if not (v_mandant = any (app.sichtbare_mandanten())) then return null; end if;
  if not app.hat_recht('eingang.schreiben', v_mandant) then return null; end if;
  if v_iban is null or btrim(v_iban) = '' then return null; end if;

  perform app.protokolliere('lieferant.iban_geprueft', 'lieferant',
                            p_lieferant::text, null, null, v_mandant);

  return upper(replace(v_iban, ' ', '')) = upper(replace(p_iban, ' ', ''));
end $$;

comment on function app.lieferant_iban_stimmt(uuid, text) is
  'Stimmt die IBAN einer eingehenden Rechnung mit der Bankverbindung des Lieferanten im Stamm ueberein? '
  'Gibt nur true/false/null zurueck, nie die IBAN (K-05, 0123); protokolliert jede Pruefung (D-482).';

alter function app.lieferant_iban_stimmt(uuid, text) owner to cse_definer;
revoke execute on function app.lieferant_iban_stimmt(uuid, text) from public;
grant execute on function app.lieferant_iban_stimmt(uuid, text) to cse_app;
