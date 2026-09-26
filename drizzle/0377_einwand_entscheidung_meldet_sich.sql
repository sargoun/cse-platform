-- ===========================================================================
-- 0377 — Die Entscheidung ueber einen Einwand erreicht die Meldende
--        (V-051, EMP-07, TIM-11, NOT-01, NOT-03)
--
-- **Der Befund.** `entscheideEinwand` setzt Zustand, Zeitpunkt und
-- Begruendung — und danach passiert nichts. Die betroffene Person erfaehrt
-- es nur, wenn sie von sich aus dieselbe Seite noch einmal oeffnet. Bei einer
-- Meldung ueber FALSCH ERFASSTE ARBEITSZEIT ist das die eine Stelle, an der
-- Schweigen teuer ist: wer nicht weiss, dass abgelehnt wurde, widerspricht
-- nicht, und die Frist laeuft.
--
-- ---------------------------------------------------------------------------
-- **Warum das eine SECURITY-DEFINER-Funktion ist und keine neue Policy.**
-- ---------------------------------------------------------------------------
--
-- Gemessen an `pg_policies` fuer `benachrichtigung`:
--
--   t_benachrichtigung_eigene        cse_app     SELECT  nur die eigenen
--   t_benachrichtigung_lesen_setzen  cse_app     UPDATE  nur die eigenen
--   t_benachrichtigung_job_anlegen   cse_job     INSERT  check true
--   d_benachrichtigung_anlegen       cse_definer INSERT  check true
--
-- `cse_app` hat auf dieser Tabelle also KEINEN Schreibweg — mit Absicht: eine
-- Rolle, die dem Posteingang eines anderen Menschen etwas hinzufuegen kann,
-- kann ihm alles hinzufuegen. Bis hierher schrieb nur der Nachtlauf
-- (`cse_job`) Meldungen; eine Entscheidung faellt aber IN EINER ANFRAGE, und
-- bis zum naechsten Nachtlauf zu warten hiesse, die Meldung um bis zu einem
-- Tag zu verspaeten.
--
-- Der Weg ist deshalb derselbe wie bei Stempeluhr (0373) und Zusage (0374):
-- eine Funktion unter `cse_definer`, eng auf EINEN Fall geschnitten.
--
-- ---------------------------------------------------------------------------
-- **Was die Funktion NICHT kann, und das ist ihr Entwurf.**
-- ---------------------------------------------------------------------------
--
--  * **Nicht frei adressieren.** Der Empfaenger wird aus dem Einwand
--    abgeleitet: Anstellung → Person → Zugang. Kein Parameter nennt ihn.
--  * **Keine fremde Gesellschaft.** Der Einwand muss in `app.aktiver_mandant()`
--    liegen. Der Definer umgeht RLS — also prueft die Funktion selbst, was
--    die Policy sonst geprueft haette (Invariante 3).
--  * **Keine andere Art.** `art` ist im Rumpf festgeschrieben. Die Funktion
--    laesst sich nicht als allgemeiner Briefkasten missbrauchen.
--  * **Kein Ziel ausserhalb des Arbeiterportals.** `p_ziel` muss mit
--    `/portal/mein/` beginnen. Titel und Text kommen aus dem Artenregister
--    (`services/zeit/benachrichtigung.ts`), damit die Formulierung an EINER
--    Stelle steht; das Ziel wird hier trotzdem gegengelesen, weil ein Verweis
--    der einzige Teil einer Meldung ist, der jemanden woandershin fuehrt.
--  * **Nicht vor der Entscheidung.** `entschieden_am is null` liefert NULL.
--    Eine Meldung „es wurde entschieden", bevor entschieden ist, waere
--    schlimmer als keine.
--
-- **Doppelte Meldungen verhindert sie nicht, und das ist richtig.**
-- `entscheideEinwand` laesst einen bereits entschiedenen Vorgang nicht noch
-- einmal entscheiden (`EinwandBereitsEntschiedenFehler`); der Uebergang nach
-- `in_pruefung` setzt `entschieden_am` ausdruecklich NICHT. Die Eindeutigkeit
-- liegt damit eine Ebene hoeher — dieselbe Bauart wie bei `nachweis_warnung`
-- (K-09). Ein `unique` auf dem Posteingang waere eine zweite Fassung
-- derselben Regel.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- **Was `cse_definer` dafuer lesen darf — und warum das eine eigene Zeile ist.**
-- ---------------------------------------------------------------------------
--
-- Der Definer umgeht RLS nicht automatisch: er laeuft ALS `cse_definer`, und
-- diese Rolle hatte auf `zeit_einwand` weder GRANT noch Policy. Ohne beides
-- scheitert die Funktion mit `permission denied for table zeit_einwand` —
-- gefunden vom Seed, nicht von einer Ueberlegung.
--
-- `anstellung` und `benutzer` sind bereits freigegeben (`a_definer`,
-- `d_benutzer_anmeldung`), `benachrichtigung` ebenfalls
-- (`d_benachrichtigung_anlegen`). Was fehlt, ist genau EIN Lesezugriff, und
-- er bleibt einer: **nur SELECT**. Schreiben kann `cse_definer` auf dieser
-- Tabelle weiterhin nicht — die Entscheidung selbst faellt unter `cse_app`
-- und unter deren Rechtepruefung.
grant select on public.zeit_einwand to cse_definer;

create policy ze_definer_lesen on public.zeit_einwand
  for select to cse_definer
  using (true);

create or replace function app.einwand_entscheidung_melden(
  p_einwand uuid,
  p_titel   text,
  p_text    text,
  p_ziel    text
) returns uuid
language plpgsql
security definer
set search_path = public, app, kern, pg_temp
as $$
declare
  v_mandant     uuid;
  v_person      uuid;
  v_empfaenger  uuid;
  v_id          uuid;
begin
  if p_einwand is null or app.aktiver_mandant() is null then
    return null;
  end if;

  -- Ein Verweis ist der einzige Teil einer Meldung, der jemanden woandershin
  -- fuehrt. Er bleibt im Arbeiterportal (NOT-03).
  if p_ziel is null or p_ziel not like '/portal/mein/%' then
    raise exception 'Das Ziel einer Einwandmeldung liegt im Arbeiterportal.'
      using errcode = '22023',
            detail  = 'p_ziel muss mit /portal/mein/ beginnen.',
            hint    = 'Das Ziel kommt aus services/zeit/benachrichtigung.ts.';
  end if;

  if p_titel is null or btrim(p_titel) = '' or p_text is null or btrim(p_text) = '' then
    raise exception 'Eine Meldung ohne Titel oder Text ist keine.'
      using errcode = '22023';
  end if;

  /*
   * Der Empfaenger wird ABGELEITET, nicht uebergeben — und zwar ueber
   * dieselbe Kette wie `stelleZu` in `server/benachrichtigung/ablage.ts`:
   * Anstellung → Person → aktiver, nicht deaktivierter Zugang. Der Index
   * `benutzer_person_key` laesst hoechstens einen zu (EMP-14, D-09).
   */
  select e.mandant_id, a.person_id
    into v_mandant, v_person
    from zeit_einwand e
    join anstellung a on a.mandant_id = e.mandant_id and a.id = e.anstellung_id
   where e.id = p_einwand
     and e.mandant_id = app.aktiver_mandant()
     and e.entschieden_am is not null;

  if v_person is null then
    return null;
  end if;

  select b.id into v_empfaenger
    from benutzer b
   where b.person_id = v_person
     and b.status = 'aktiv'
     and b.deaktiviert_am is null;

  -- Kein Zugang, keine Zeile. Das ist kein Fehler, sondern D-09: der Mensch
  -- und sein Login sind zwei Dinge, und die meisten Kraefte haben heute
  -- keines. Der Aufrufer meldet es in seinem Bericht.
  if v_empfaenger is null then
    return null;
  end if;

  insert into benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  values
    (v_mandant, v_empfaenger, 'zeit.einwand_entschieden',
     p_titel, p_text, p_ziel, 'zeit_einwand', p_einwand::text, false)
  returning id into v_id;

  return v_id;
end;
$$;

alter function app.einwand_entscheidung_melden(uuid, text, text, text) owner to cse_definer;

revoke all on function app.einwand_entscheidung_melden(uuid, text, text, text) from public;
grant execute on function app.einwand_entscheidung_melden(uuid, text, text, text) to cse_app;

comment on function app.einwand_entscheidung_melden(uuid, text, text, text) is
  'V-051: stellt die Entscheidung ueber einen Zeit-Einwand in den Posteingang '
  'der meldenden Person zu. Empfaenger abgeleitet, Art festgeschrieben, Ziel '
  'auf /portal/mein/ begrenzt. Gibt NULL zurueck, wenn die Person keinen '
  'aktiven Zugang hat (D-09).';
