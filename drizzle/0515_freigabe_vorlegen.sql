-- 0515 — Vorlegen ist nicht Entscheiden (V-376, O-369, O-513, D-819).
--
-- Die Schreibpolicy auf freigabe (t_mandant, 0136) verlangt
-- freigabe.entscheiden fuer jeden Schreibvorgang, auch fuer das Anlegen einer
-- offenen Bitte. Eine Rolle, die vorlegt und nicht entscheidet — genau die
-- Trennung, fuer die Invariante 7 da ist —, scheiterte damit an der Policy,
-- mit einer Meldung, die nach einem fehlenden Fachrecht aussah. Sechs Wege
-- legen offene Bitten an: der Social-Beitrag, die Stellenanzeige, die
-- Bewerberantwort, der Vorschlag zur Eingangsrechnung, der Agentenlauf und
-- das zurueckgehaltene Werkzeugergebnis des Assistenten.
--
-- (1) app.freigabe_vorlegen(jsonb) ist der eine Weg fuer eine offene Bitte.
--     Gesellschaft (die aktive), Status (offen), Urheber und die
--     Entscheidungsfelder setzt er selbst; der Aufrufer gibt nur den Vorgang
--     mit, aus einer festen Liste von Angaben — eine fremde Angabe ist ein
--     Fehler, kein stilles Weglassen. Die extrahierten Felder eines
--     Vorschlags (freigabe_feld) gehoeren zum Vorgang und kommen im selben
--     Aufruf: ihre Policy verlangt freigabe.lesen, und der Zaehler an ihnen
--     (0136) schreibt in die Freigabe — beides hielte einen Vorleger ohne
--     Freigaberecht sonst wieder auf. Wer vorlegt, braucht (Voreinstellung
--     O-513, D-799, Antwort b: abgeleitet aus dem Katalog, kein neues
--     Register):
--       - fuer eine Bitte mit erforderlichem Recht ein nicht lesendes Recht im
--         MODUL dieses Rechts: social.freigeben laesst vorlegen, wer
--         social.schreiben haelt, eingang.freigeben, wer eingang.schreiben
--         haelt. Eine erfundene Rechnungsfreigabe aus dem Social-Modul geht
--         damit nicht in den Posteingang.
--       - fuer die Bitte eines Agentenlaufs das Recht, Agentenaufgaben zu
--         starten, und eine noch laufende Aufgabe dieser Gesellschaft. Agent
--         und Aufgabe kommen aus der Aufgabe, nicht vom Aufrufer. Die Bitte
--         hat keinen menschlichen Urheber: erstellt_von bleibt leer wie
--         bisher (0496 liest es so).
--       - ohne beides: ein nicht lesendes Recht im Modul freigabe — wie bisher.
-- (2) app.freigabe_zurueckziehen(uuid, text): wer vorlegen duerfte, nimmt
--     eine offene Bitte wieder zurueck (der Beitrag geht zur Ueberarbeitung).
--     Nur aus offen, nur nach zurueckgezogen; eine entschiedene Freigabe
--     bleibt, wie sie ist (APR-07).
-- (3) Eine offene Bitte entsteht nur noch ueber (1): eine restriktive Policy
--     verbietet cse_app den direkten insert mit Status offen. Der direkte
--     insert einer bereits gefallenen Entscheidung (erteilen.ts, Seed) bleibt
--     wie bisher an freigabe.entscheiden gebunden; Lesen, Entscheiden und die
--     Policy t_mandant aendern sich nicht.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 0. Was cse_definer dafuer braucht
-- ---------------------------------------------------------------------------

-- Lesen: Kennung, Gesellschaft und Status (0123), erforderliches Recht
-- (0137); dazu die Begruendung, die (2) nicht ueberschreibt. Schreiben: die
-- Spalten der offenen Bitte. Die Policies binden beides an die aktive
-- Gesellschaft; d_freigabe_lesen (0123) traegt das returning.
grant select (begruendung, stapel_faehig) on freigabe to cse_definer;
grant insert (mandant_id, status, erstellt_von, aktion, vorgang_typ, titel,
              zusammenfassung, risiko, risiko_punkte, diff, vorschau_payload,
              payload_hash, betrag_cent, min_konfidenz, stapel_faehig,
              stapel_sperre_grund, erforderliches_recht, bezug_typ, bezug_id,
              externe_ref, agent_id, agent_aufgabe_id, frist)
  on freigabe to cse_definer;

create policy d_freigabe_vorlegen on freigabe for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant() and status = 'offen');

-- Die Felder des Vorgangs, und was kern.freigabe_felder_zaehlen (0136) danach
-- in der Freigabe nachfuehrt: er laeuft als die Rolle, die das Feld schreibt.
grant insert (mandant_id, freigabe_id, feld_pfad, bezeichnung, wert_vorher, wert_nachher,
              konfidenz, unsicher, grund, quelle_dokument_id, quelle_seite,
              quelle_tabelle, quelle_zelle, quelle_bbox, quelle_zitat,
              extraktion_modell, erstellt_von)
  on freigabe_feld to cse_definer;
create policy d_freigabe_feld_vorlegen on freigabe_feld for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant());
grant update (unsichere_felder_anzahl, min_konfidenz, stapel_faehig)
  on freigabe to cse_definer;

-- berechtigung (modul, aktion) liest cse_definer seit 0136 (Tabellenrecht)
-- unter d_berechtigung_lesen (0128); agent_aufgabe seit 0128 (d_aufgabe).

-- ---------------------------------------------------------------------------
-- 1. Wer vorlegen darf — eine Stelle fuer (1) und (2)
-- ---------------------------------------------------------------------------

create function kern.freigabe_darf_vorlegen(p_recht text, p_mandant uuid)
returns boolean
language sql stable
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1 from public.berechtigung b
     where b.modul = split_part(coalesce(p_recht, 'freigabe.entscheiden'), '.', 1)
       and b.aktion <> 'lesen'
       and app.hat_recht(b.schluessel, p_mandant))
$$;

comment on function kern.freigabe_darf_vorlegen(text, uuid) is
  'V-376, O-513, D-819: ob die Sitzung eine Bitte vorlegen darf, die p_recht '
  'entscheidet — ein nicht lesendes Recht im Modul von p_recht (ohne p_recht: '
  'im Modul freigabe). Gerufen nur aus den beiden Definern.';

revoke all on function kern.freigabe_darf_vorlegen(text, uuid) from public;
grant execute on function kern.freigabe_darf_vorlegen(text, uuid) to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Vorlegen
-- ---------------------------------------------------------------------------

create function app.freigabe_vorlegen(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_recht   text;
  v_aufgabe uuid;
  v_agent   uuid;
  v_fremd   text;
  v_urheber uuid;
  v_id      uuid;
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Eine Freigabe wird in genau einer Gesellschaft vorgelegt (Invariante 10).'
      using errcode = '42501', detail = 'kein_mandant';
  end if;
  if app.ist_readonly() or app.portal() is distinct from 'intern' then
    raise exception 'Diese Sitzung legt nichts vor.'
      using errcode = '42501', detail = 'nur_lesend';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Der Vorgang fehlt.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k) into v_fremd
    from jsonb_object_keys(p) k
   where k not in ('aktion', 'vorgang_typ', 'titel', 'zusammenfassung', 'risiko',
                   'risiko_punkte', 'diff', 'vorschau_payload', 'payload_hash',
                   'betrag_cent', 'min_konfidenz', 'stapel_faehig',
                   'stapel_sperre_grund', 'erforderliches_recht', 'bezug_typ',
                   'bezug_id', 'externe_ref', 'agent_aufgabe_id', 'frist', 'felder');
  if v_fremd is not null then
    raise exception 'Diese Angaben setzt die Freigabe selbst: %.', v_fremd
      using errcode = '22023', detail = 'fremde_angabe';
  end if;
  if p ? 'felder' and jsonb_typeof(p -> 'felder') <> 'array' then
    raise exception 'Die Felder sind eine Liste.' using errcode = '22023';
  end if;

  v_recht := nullif(p ->> 'erforderliches_recht', '');
  if v_recht is not null
     and not exists (select 1 from public.berechtigung b where b.schluessel = v_recht) then
    raise exception 'erforderliches_recht %: kein Schluessel im Rechtekatalog (K-19).', v_recht
      using errcode = 'foreign_key_violation';
  end if;

  v_aufgabe := nullif(p ->> 'agent_aufgabe_id', '')::uuid;
  if v_aufgabe is not null then
    if not app.hat_recht('agent.aufgabe_starten', v_mandant) then
      raise exception 'Eine Bitte aus einem Agentenlauf legt vor, wer Agentenaufgaben starten darf.'
        using errcode = '42501', detail = 'kein_vorlegerecht';
    end if;
    select a.agent_id into v_agent
      from public.agent_aufgabe a
     where a.id = v_aufgabe and a.mandant_id = v_mandant
       and a.status in ('wartend', 'laufend');
    if not found then
      raise exception 'Zu dieser Bitte laeuft keine Agentenaufgabe dieser Gesellschaft.'
        using errcode = '42501', detail = 'keine_laufende_aufgabe';
    end if;
  elsif not kern.freigabe_darf_vorlegen(v_recht, v_mandant) then
    raise exception 'Vorlegen verlangt ein schreibendes Recht im Modul %.',
      split_part(coalesce(v_recht, 'freigabe.entscheiden'), '.', 1)
      using errcode = '42501', detail = 'kein_vorlegerecht';
  end if;

  v_urheber := case when v_aufgabe is null then app.aktueller_benutzer() end;

  insert into public.freigabe
    (mandant_id, status, erstellt_von,
     aktion, vorgang_typ, titel, zusammenfassung, risiko, risiko_punkte,
     diff, vorschau_payload, payload_hash, betrag_cent, min_konfidenz,
     stapel_faehig, stapel_sperre_grund, erforderliches_recht,
     bezug_typ, bezug_id, externe_ref, agent_id, agent_aufgabe_id, frist)
  values
    (v_mandant, 'offen', v_urheber,
     p ->> 'aktion',
     (p ->> 'vorgang_typ')::agent_vorgang_typ,
     p ->> 'titel',
     p ->> 'zusammenfassung',
     (p ->> 'risiko')::risiko_stufe,
     (p ->> 'risiko_punkte')::integer,
     coalesce(p -> 'diff', '[]'::jsonb),
     p -> 'vorschau_payload',
     p ->> 'payload_hash',
     (p ->> 'betrag_cent')::bigint,
     (p ->> 'min_konfidenz')::numeric,
     coalesce((p ->> 'stapel_faehig')::boolean, false),
     p ->> 'stapel_sperre_grund',
     v_recht,
     p ->> 'bezug_typ',
     (p ->> 'bezug_id')::uuid,
     p ->> 'externe_ref',
     v_agent,
     v_aufgabe,
     (p ->> 'frist')::timestamptz)
  returning id into v_id;

  insert into public.freigabe_feld
    (mandant_id, freigabe_id, feld_pfad, bezeichnung, wert_vorher, wert_nachher,
     konfidenz, unsicher, grund, quelle_dokument_id, quelle_seite, quelle_tabelle,
     quelle_zelle, quelle_bbox, quelle_zitat, extraktion_modell, erstellt_von)
  select v_mandant, v_id, x.feld_pfad, x.bezeichnung, x.wert_vorher, x.wert_nachher,
         x.konfidenz, coalesce(x.unsicher, false), x.grund, x.quelle_dokument_id,
         x.quelle_seite, x.quelle_tabelle, x.quelle_zelle, x.quelle_bbox, x.quelle_zitat,
         x.extraktion_modell, v_urheber
    from jsonb_to_recordset(coalesce(p -> 'felder', '[]'::jsonb)) as x(
           feld_pfad text, bezeichnung text, wert_vorher text, wert_nachher text,
           konfidenz numeric, unsicher boolean, grund text, quelle_dokument_id uuid,
           quelle_seite integer, quelle_tabelle text, quelle_zelle text,
           quelle_bbox jsonb, quelle_zitat text, extraktion_modell text);

  return v_id;
end $$;

comment on function app.freigabe_vorlegen(jsonb) is
  'V-376, O-369, O-513, D-819: legt eine offene Bitte um Freigabe in der aktiven '
  'Gesellschaft an, mit ihren extrahierten Feldern. Status, Urheber und '
  'Entscheidungsfelder setzt die Funktion; '
  'vorlegen darf, wer im Modul des erforderlichen Rechts ein nicht lesendes Recht '
  'haelt, bei einem Agentenlauf wer Agentenaufgaben starten darf (laufende Aufgabe). '
  'Entscheiden bleibt app.freigabe_entscheiden.';

alter function app.freigabe_vorlegen(jsonb) owner to cse_definer;
revoke all on function app.freigabe_vorlegen(jsonb) from public;
grant execute on function app.freigabe_vorlegen(jsonb) to cse_app;

-- ---------------------------------------------------------------------------
-- 3. Zuruecknehmen
-- ---------------------------------------------------------------------------

create function app.freigabe_zurueckziehen(p_id uuid, p_grund text) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_status  freigabe_status;
  v_recht   text;
begin
  if v_mandant is null or app.ist_gruppenansicht() then
    raise exception 'Eine Freigabe wird in genau einer Gesellschaft zurueckgenommen (Invariante 10).'
      using errcode = '42501', detail = 'kein_mandant';
  end if;
  if app.ist_readonly() or app.portal() is distinct from 'intern' then
    raise exception 'Diese Sitzung nimmt nichts zurueck.'
      using errcode = '42501', detail = 'nur_lesend';
  end if;

  select f.status, f.erforderliches_recht into v_status, v_recht
    from public.freigabe f
   where f.id = p_id and f.mandant_id = v_mandant
   for update;
  if not found then
    raise exception 'Diese Freigabe gibt es in dieser Gesellschaft nicht.'
      using errcode = 'P0002';
  end if;
  if not kern.freigabe_darf_vorlegen(v_recht, v_mandant) then
    raise exception 'Zuruecknehmen verlangt ein schreibendes Recht im Modul %.',
      split_part(coalesce(v_recht, 'freigabe.entscheiden'), '.', 1)
      using errcode = '42501', detail = 'kein_vorlegerecht';
  end if;
  if v_status <> 'offen' then
    return false;
  end if;

  update public.freigabe
     set status = 'zurueckgezogen', geaendert_am = now(),
         begruendung = coalesce(begruendung, nullif(btrim(p_grund), ''))
   where id = p_id;
  return true;
end $$;

comment on function app.freigabe_zurueckziehen(uuid, text) is
  'V-376, D-819: nimmt eine offene Bitte zurueck (Status zurueckgezogen, Grund in der '
  'Begruendung, wenn noch keine dasteht). Darf, wer sie vorlegen duerfte; eine '
  'entschiedene Freigabe bleibt unveraendert (Rueckgabe false).';

alter function app.freigabe_zurueckziehen(uuid, text) owner to cse_definer;
revoke all on function app.freigabe_zurueckziehen(uuid, text) from public;
grant execute on function app.freigabe_zurueckziehen(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 4. Eine offene Bitte entsteht nur ueber app.freigabe_vorlegen
-- ---------------------------------------------------------------------------

-- Restriktiv: sie gilt zusaetzlich zu t_mandant und nur fuer den insert. Eine
-- bereits entschiedene Freigabe (genehmigt, abgelehnt) schreibt cse_app mit
-- freigabe.entscheiden weiter direkt.
create policy p_offen_nur_vorlegen on freigabe as restrictive for insert to cse_app
  with check (status <> 'offen');

comment on policy p_offen_nur_vorlegen on freigabe is
  'V-376, D-819: eine offene Bitte entsteht nur ueber app.freigabe_vorlegen, '
  'das das Vorlegerecht prueft und Status und Urheber selbst setzt.';
