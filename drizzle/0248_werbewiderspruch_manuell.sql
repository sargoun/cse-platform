-- 0248 — der Werbewiderspruch, VON HAND erfasst und belegt
-- (CRM-08, LEG-08, LEG-09, Art. 21 DSGVO, 05-API-KARTE §C.7).
--
-- ===========================================================================
-- Die Luecke, die diese Migration schliesst
-- ===========================================================================
--
-- 05-API-KARTE.md Zeile 639 schreibt einen eigenen Endpunkt
-- `POST /api/crm/ansprechpartner/[id]/widerspruch` mit dem Rumpf
-- `{ quelle, eingegangen_am, umfang }` vor. Von den drei Wegen, auf denen ein
-- Widerspruch eingeht, sind heute zwei gebaut und einer fehlt:
--
--   · `quelle = 'token'`    → `app.werbewiderspruch_einloesen` (0222), der
--                             Abmeldelink unter einer Nachricht.
--   · `quelle = 'formular'` → `app.werbewiderspruch_formular` (0222), das
--                             oeffentliche Formular.
--   · `quelle = 'manuell'`  → FEHLT. Genau der Fall, der im Betrieb der
--                             haeufigste ist: ein Anruf, ein Brief, ein Satz
--                             in einer E-Mail an die Sachbearbeitung.
--
-- Fuer `umfang = 'verarbeitung'` (der Vollwiderspruch nach Art. 21 DSGVO)
-- gibt es den Weg schon: `app.widerspruch_verarbeitung_setzen` (0222) haengt
-- ihn an `datenschutz.auskunft_erstellen` und verlangt eine Begruendung. Er
-- bleibt unberuehrt. Was fehlt, ist der WERBEwiderspruch aus derselben Hand.
--
-- ===========================================================================
-- Warum KEINE neuen Spalten auf `ansprechpartner`
-- ===========================================================================
--
-- Der naheliegende Zuschnitt waere `widerspruch_quelle`, `widerspruch_umfang`
-- und `widerspruch_eingegangen_am` neben `widerspruch_am`. Er ist falsch, und
-- zwar aus zwei Gruenden:
--
--  1. **Der Nachweis ist nicht EIN Zustand, sondern ein Vorgang.** 0222 fuehrt
--     dafuer `werbewiderspruch` — mit `art` (werbung | verarbeitung), `quelle`
--     (token | formular | manuell), `eingegangen_am`, `kanal`, `bemerkung`,
--     `erfasst_von`, `token_id` und einer Loeschsperre. Drei Spalten auf
--     `ansprechpartner` haetten dieselbe Auskunft ein zweites Mal gefuehrt,
--     schlechter (nur der letzte Eingang) und daneben (welcher von beiden
--     gilt, entschiede die Reihenfolge der Abfrage).
--  2. **Ein CHECK auf den Paaren waere unhaltbar geworden.** `ap.werbe-
--     widerspruch_am` wird vom Abmeldelink gesetzt, dessen Nachweis das
--     `werbewiderspruch_token` IST und nicht ein Satz eines Menschen. Ein
--     `check (werbewiderspruch_am is null) = (widerspruch_quelle is null)`
--     haette genau diesen richtigen Weg gesperrt.
--
-- Diese Migration legt deshalb nur den fehlenden SCHREIBWEG an.
--
-- ===========================================================================
-- Welches Recht traegt ihn — `crm.rechtsgrundlage_setzen`
-- ===========================================================================
--
-- Die Seitenkarte bewacht `/portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage`
-- mit `crm.rechtsgrundlage_setzen`, und dort steht dieser Vorgang. Nicht
-- `datenschutz.auskunft_erstellen` wie beim Vollwiderspruch: der
-- Werbewiderspruch ist die taegliche Arbeit des Vertriebs, der
-- Vollwiderspruch die Entscheidung der Datenschutzstelle — zwei Vorgaenge,
-- zwei Haende, zwei Rechte. Wer beides darf, sieht beides; wer nur das erste
-- darf, kann nicht versehentlich den unwiderruflichen Vollwiderspruch setzen.
--
-- ===========================================================================
-- Einweg — und die Oberflaeche sagt es VORHER
-- ===========================================================================
--
-- `kern.erzwinge_widerspruch` (0020/0222) wirft `restrict_violation`, sobald
-- `werbewiderspruch_am` oder `widerspruch_am` wieder geleert wird. Diese
-- Funktion setzt deshalb `coalesce(alt, neu)`: ein zweiter Eingang verschiebt
-- das Datum NICHT nach hinten, er wird als weitere Zeile in
-- `werbewiderspruch` festgehalten. Das erste „nein" gilt.

create function app.werbewiderspruch_manuell_setzen(
  p_ansprechpartner uuid,
  p_kunde           uuid,
  p_kanal           text,
  p_eingegangen_am  timestamptz,
  p_bemerkung       text
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_anzahl integer := 0;
  v_zeit   timestamptz := coalesce(p_eingegangen_am, now());
begin
  if app.portal() <> 'intern' then
    raise exception 'Ein Werbewiderspruch wird nur im internen Portal erfasst (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird nichts erfasst (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.rechtsgrundlage_setzen', app.aktiver_mandant()) then
    raise exception 'crm.rechtsgrundlage_setzen fehlt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_ansprechpartner is null and p_kunde is null then
    raise exception 'Ohne Betroffenen gibt es keinen Widerspruch'
      using errcode = 'check_violation';
  end if;

  -- Ein Eingang in der Zukunft ist kein Eingang. Die Serverzeit ist die
  -- Grenze, nicht die Geraetezeit des Erfassers (Invariante 5).
  if v_zeit > now() then
    raise exception 'Ein Widerspruch kann nicht in der Zukunft eingegangen sein'
      using errcode = 'check_violation';
  end if;

  -- `ww_manuell_benannt` verlangt `erfasst_von`. Ohne gebundenes Konto waere
  -- die Zeile ein Nachweis ohne Zeugen — hier abgewiesen statt dort.
  if app.aktueller_benutzer() is null then
    raise exception 'Ein von Hand erfasster Widerspruch braucht ein angemeldetes Konto'
      using errcode = 'insufficient_privilege';
  end if;

  if p_kanal is not null
     and p_kanal not in ('email', 'telefon', 'sms', 'post', 'whatsapp') then
    raise exception 'Diesen Kanal gibt es nicht' using errcode = 'check_violation';
  end if;

  if p_ansprechpartner is not null then
    update public.ansprechpartner ap
       set werbewiderspruch_am = least(coalesce(ap.werbewiderspruch_am, v_zeit), v_zeit)
     where ap.mandant_id = app.aktiver_mandant() and ap.id = p_ansprechpartner;
    if not found then
      raise exception 'Diesen Kontakt gibt es in dieser Gesellschaft nicht'
        using errcode = 'no_data_found';
    end if;
    v_anzahl := v_anzahl + 1;
  end if;

  if p_kunde is not null then
    update public.kunde k
       set werbewiderspruch_am = least(coalesce(k.werbewiderspruch_am, v_zeit), v_zeit)
     where k.mandant_id = app.aktiver_mandant() and k.id = p_kunde;
    if not found then
      raise exception 'Diese Firma gibt es in dieser Gesellschaft nicht'
        using errcode = 'no_data_found';
    end if;
    v_anzahl := v_anzahl + 1;
  end if;

  insert into public.werbewiderspruch
    (mandant_id, art, ansprechpartner_id, kunde_id, kanal, eingegangen_am,
     quelle, bemerkung, erfasst_von)
  values (app.aktiver_mandant(), 'werbung', p_ansprechpartner, p_kunde, p_kanal,
          v_zeit, 'manuell', nullif(btrim(coalesce(p_bemerkung, '')), ''),
          app.aktueller_benutzer());

  perform app.protokolliere('crm.werbewiderspruch_manuell',
                            case when p_ansprechpartner is null
                                 then 'kunde' else 'ansprechpartner' end,
                            coalesce(p_ansprechpartner, p_kunde)::text, null,
                            jsonb_build_object('kanal', p_kanal,
                                               'eingegangen_am', v_zeit),
                            app.aktiver_mandant());
  return v_anzahl;
end $$;

-- K-01: das Eigentum ist `cse_definer` und nicht die Migrationsrolle. Sonst
-- liefe die Funktion als Superuser an jeder RLS vorbei
-- (`tests/isolation/definer-eigentum.test.ts`).
alter function app.werbewiderspruch_manuell_setzen(uuid, uuid, text, timestamptz, text)
  owner to cse_definer;
revoke execute on function
  app.werbewiderspruch_manuell_setzen(uuid, uuid, text, timestamptz, text) from public;
grant execute on function
  app.werbewiderspruch_manuell_setzen(uuid, uuid, text, timestamptz, text) to cse_app;

comment on function
  app.werbewiderspruch_manuell_setzen(uuid, uuid, text, timestamptz, text) is
  'Der Werbewiderspruch aus der Hand der Sachbearbeitung (quelle = manuell). '
  'Prueft crm.rechtsgrundlage_setzen, setzt werbewiderspruch_am auf den '
  'FRUEHESTEN bekannten Eingang und legt die Nachweiszeile in '
  'werbewiderspruch an (0222). Der Vollwiderspruch nach Art. 21 DSGVO laeuft '
  'weiter ueber app.widerspruch_verarbeitung_setzen.';
