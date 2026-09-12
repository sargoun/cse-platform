-- ---------------------------------------------------------------------------
-- 0063 — `kern.checkin_token_widerrufen` wird SECURITY DEFINER
--
-- Der Auslöser aus `0035` widerruft die lebenden Check-in-Marken, sobald eine
-- Schicht verschoben oder storniert oder eine Einteilung zurückgenommen wird
-- (§9.3). Er läuft unter der Rolle, die die Anweisung fährt — und das ist im
-- Portal `cse_app`.
--
-- **`cse_app` hat auf `checkin_token` kein einziges Recht, und das ist
-- Absicht** (K-01, K-08): die Marke ist ein Inhabergeheimnis, ihre Zeilen
-- gehören `cse_definer` und `cse_checkin`. Der Auslöser scheiterte deshalb mit
-- „permission denied for table checkin_token", sobald das erste
-- Anwendungsstück eine Einteilung zurücknahm oder eine Schicht verschob.
--
-- Gefunden hat das nicht ein Test der Marke, sondern der erste Schreibweg auf
-- `einsatz_zuordnung` (`services/dienstplan/einteilung.ts`): vorher gab es
-- keinen, also hatte nie jemand `entfernt_am` gesetzt. Ein Auslöser, den nur
-- der Eigentümer ausführen kann, ist auf einer Tabelle mit erzwungener RLS
-- kein Schutz, sondern eine Zeitbombe.
--
-- **Warum Definer und nicht ein GRANT auf `cse_app`:** ein UPDATE-Recht auf
-- `checkin_token` gäbe der Anwendungsrolle den Weg, `eingeloest_am` und
-- `token_hash` zu berühren. Der Definer hebt genau eine Handlung heraus —
-- Widerruf mit Grund, nur an lebenden Marken — und lässt alles andere
-- unerreichbar. Der `search_path` steht fest, damit kein Aufrufer ihn
-- unterschieben kann.
--
-- Der Rumpf ist unverändert; geändert sind ausschliesslich `security definer`
-- und `set search_path`. Die beiden Auslöser bleiben, wie sie sind — ein
-- `create or replace function` behält sie.
-- ---------------------------------------------------------------------------

create or replace function kern.checkin_token_widerrufen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_grund text;
begin
  if tg_table_name = 'einsatz' then
    if new.storniert_am is not null and old.storniert_am is null then
      v_grund := 'einsatz_storniert';
    elsif new.beginn_zeitpunkt is distinct from old.beginn_zeitpunkt
       or new.ende_zeitpunkt is distinct from old.ende_zeitpunkt then
      v_grund := 'einsatz_verschoben';
    else
      return null;
    end if;

    update checkin_token
       set widerrufen_am = now(), widerruf_grund = v_grund
     where einsatz_id = new.id
       and eingeloest_am is null and widerrufen_am is null;
    return null;
  end if;

  -- einsatz_zuordnung: die Einteilung wurde zurueckgenommen.
  if new.entfernt_am is not null and old.entfernt_am is null then
    update checkin_token
       set widerrufen_am = now(), widerruf_grund = 'zuordnung_entfernt'
     where einsatz_zuordnung_id = new.id
       and eingeloest_am is null and widerrufen_am is null;
  end if;
  return null;
end $$;

-- Der Eigentümer ist `postgres`; damit läuft der Rumpf mit dessen Rechten und
-- unterliegt der FORCE-RLS der Tabelle nicht. Ausführen darf ihn, wer die
-- Auslöser auslöst — Trigger-Funktionen brauchen dafür kein eigenes GRANT.
comment on function kern.checkin_token_widerrufen() is
  'Widerruft lebende Check-in-Marken bei Verschiebung, Storno oder '
  'Rücknahme der Einteilung (§9.3). SECURITY DEFINER, weil cse_app auf '
  'checkin_token bewusst kein Recht hält (K-01, K-08).';
