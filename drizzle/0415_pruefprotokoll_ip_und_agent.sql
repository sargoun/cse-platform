-- 0415 — das Pruefprotokoll traegt IP und Agent (SEC-A9, V-163, D-657).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- SEC-A9 verlangt je Eintrag den Akteur (Mensch, Agent, System), die
-- Handlung, vorher und nachher, den Zeitpunkt und die IP. audit_log traegt
-- dafuer seit 0003 die Spalten akteur_typ, agent_id und ip. Geschrieben wird
-- es von genau einer Funktion, app.protokolliere (0004; 0093 entzog PUBLIC
-- das Ausfuehren, 0096 gab es cse_definer zurueck). Zwei der drei Spalten
-- blieben trotzdem leer:
--
--   ip        app.protokolliere las app.guc('app.ip'), aber KEINE
--             Sitzungsbindung setzte die GUC. Jede Zeile trug ip = NULL, und
--             die Spalte ip im GoBD- und Revisionsexport war immer leer.
--   agent_id  wurde nie geschrieben, und kein Weg setzte app.akteur_typ auf
--             agent. Was ein Agentenlauf anlegte, stand als mensch mit der
--             Kennung dessen im Protokoll, der den Knopf gedrueckt hatte.
--
-- Die Anwendung setzt beide GUCs jetzt (bindeSitzung, alsAgent). Diese
-- Migration sorgt dafuer, dass die Funktion sie auch liest — und dass ein
-- unbrauchbarer Wert keine Schreibtransaktion zu Fall bringt.
--
-- ===========================================================================
-- Was sich an der Funktion aendert, und was nicht
-- ===========================================================================
--
-- Die Fassung aus 0004 ist die einzige; 0093 und 0096 haben nur die Rechte
-- angefasst. Uebernommen wird sie Zeile fuer Zeile: dieselbe Signatur,
-- dieselben Vorgaben, dieselbe Ebene, derselbe Akteur, dieselbe Berechnung
-- der geaenderten Felder. Neu sind genau zwei Dinge:
--
--   1. ip ueber pg_input_is_valid statt eines nackten Casts. Bisher haette
--      ein kaputter Wert in app.ip JEDE protokollierende Transaktion mit
--      invalid input syntax abgebrochen — auch eine Rechnung, die gerade
--      festgeschrieben wird. Jetzt wird er NULL: eine fehlende Herkunft ist
--      ehrlicher als eine abgebrochene Buchung. Die Anwendung prueft vorher
--      mit isIP (src/server/auth/adresse.ts); das hier ist die zweite Linie.
--      Kein Ausnahmeblock: das waere eine Untertransaktion je Protokollzeile
--      im heissesten Pfad der Plattform (0204 sagt, warum dieser Pfad nichts
--      Teures tragen darf).
--   2. agent_id aus app.agent_id, und NUR fuer akteur_typ = agent. Eine
--      Menschenzeile mit Agentenkennung waere eine Aussage, die niemand
--      getroffen hat.
--
-- Der Eigentuemer bleibt, wer er ist (postgres, Altlast nach D-300, gefuehrt
-- in tests/isolation/definer-eigentum.test.ts). Ihn auf cse_definer
-- umzuhaengen hiesse, cse_definer ein INSERT auf audit_log zu geben — also
-- genau den Schreibpfad fuer jede Definer-Funktion, den 0204 bewusst
-- verweigert. create or replace laesst Eigentuemer und Grants unberuehrt.
--
-- TODO(client, O-92): Wie lange darf die IP-Adresse einer angemeldeten
-- Person im Pruefprotokoll stehen — so lange wie der Eintrag selbst, oder
-- wird sie nach einer Frist gekuerzt oder entfernt? Bis zur Antwort steht sie
-- vollstaendig da, wie SEC-A9 es verlangt; eine Kuerzung waere eine
-- Loeschregel, und die legt O-92 fest, nicht diese Migration.
--
-- Die oeffentliche Formularannahme (withEingang) setzt KEINE IP: dort handelt
-- ein Dienstprinzipal fuer einen anonymen Besucher, und dessen rohe Adresse
-- wird nirgends gespeichert (02-CRM-OPERATIONS, formular_eingang.ip_hash:
-- The raw IP is never stored). Das Protokoll macht davon keine Ausnahme.

create or replace function app.protokolliere(
  p_aktion text, p_objekt_typ text, p_objekt_id text,
  p_vorher jsonb default null, p_nachher jsonb default null,
  p_mandant uuid default null
) returns void
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  m          uuid := coalesce(p_mandant, app.aktiver_mandant());
  v_typ      akteur_art := coalesce(app.guc('app.akteur_typ'), 'system')::akteur_art;
  v_ip_roh   text := app.guc('app.ip');
  v_agent_roh text := app.guc('app.agent_id');
  v_ip       inet;
  v_agent    uuid;
begin
  if v_ip_roh is not null and pg_input_is_valid(v_ip_roh, 'inet') then
    v_ip := v_ip_roh::inet;
  end if;
  if v_typ = 'agent' and v_agent_roh is not null
     and pg_input_is_valid(v_agent_roh, 'uuid') then
    v_agent := v_agent_roh::uuid;
  end if;

  insert into public.audit_log
    (mandant_id, ebene, akteur_typ, akteur_id, agent_id, aktion, objekt_typ, objekt_id,
     vorher, nachher, geaendert_felder, ip, sitzung_id)
  values
    (m,
     case when m is null then 'plattform' else 'mandant' end::audit_ebene,
     v_typ,
     app.aktueller_benutzer(),
     v_agent,
     p_aktion, p_objekt_typ, p_objekt_id, p_vorher, p_nachher,
     case when p_vorher is null or p_nachher is null then null
          else (select coalesce(array_agg(k), '{}') from jsonb_object_keys(p_nachher) k
                 where p_vorher -> k is distinct from p_nachher -> k) end,
     v_ip,
     app.guc('app.sitzung_id')::uuid);
end $$;

comment on function app.protokolliere(text, text, text, jsonb, jsonb, uuid) is
  'Der einzige Schreiber von audit_log (0004). Seit 0415 mit IP aus app.ip und '
  'agent_id aus app.agent_id (nur fuer akteur_typ = agent); ein ungueltiger Wert '
  'wird NULL statt die Transaktion abzubrechen (SEC-A9, V-163).';
