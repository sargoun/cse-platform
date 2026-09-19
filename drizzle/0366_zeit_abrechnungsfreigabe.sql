-- ===========================================================================
-- 0366 — Die Freigabe erfasster Zeit zur Abrechnung (TIM-12, FIN-07, FIN-18,
--        EMP-04, 04-PLANUNG-ZEIT §3.3/§7.3, Invariante 5, Invariante 8)
--
-- Vertrag: `docs/architecture/04-SEITENKARTE.md` §5.11,
-- `/portal/[mandant]/zeiten/freigabe` — „release worked time for billing".
--
-- **Die Spalte gibt es seit 0034, den Weg dorthin nicht.** `zeiteintrag`
-- traegt `freigegeben_am`/`freigegeben_von` als das Tor zu Stundenkonto und
-- Abrechnung, und beide Leser sind gebaut und verlassen sich darauf:
-- `bucheFreigegebeneZeiten` filtert `freigegeben_am is not null` (§7.3,
-- EMP-04), und `zeiteintrag_auftrag` waehlt fuer die Rechnungsstellung
-- `freigegeben_am is not null and abgerechnet_am is null` (§3.3, FIN-07).
-- Geschrieben hat die Spalte bisher NIEMAND ausser dem Seed — der das an
-- Ort und Stelle als Demo-Annahme benennt. Ein Tor ohne Tuer: die Zeit
-- staut sich davor, das Stundenkonto bleibt leer, und niemand sieht warum.
--
-- **Was O-39 offen laesst und was es nicht offen laesst.** O-39 fragt, ob es
-- diesen Schritt als eigenen menschlichen Akt UEBERHAUPT gibt, oder ob eine
-- festgeschriebene Rechnung sich die Zeilen direkt nimmt. Solange das offen
-- ist, wird `zeit.abrechnung_freigeben` NICHT geseedet und an keine Rolle
-- gebunden (03-AUTH §12.4) — die Funktion unten ist damit gebaut, geprueft
-- und fuer jede heutige Sitzung unerreichbar. Das ist Absicht und der
-- einzige ehrliche Zustand: die Seite existiert, der Riegel haelt, und die
-- Antwort des Mandanten oeffnet ihn mit einer Bindung statt mit einem PR.
--
-- Was O-39 NICHT offen laesst, ist die BEDEUTUNG der Spalte. Sie steht seit
-- 0034 im Schema, zwei gebaute Leser haengen daran, und diese Funktion
-- schreibt genau das hinein, was dort steht — sie erfindet keine Regel,
-- sondern gibt der vorhandenen ihren einzigen zulaessigen Schreiber.
--
-- **Offen bleibt die EINHEIT und die Rueckseite: O-861.** Wird je Eintrag,
-- je Woche, je Person oder je Monat freigegeben, und laesst sich eine
-- erteilte Freigabe zuruecknehmen, solange nicht abgerechnet ist? Heute:
-- je EINTRAG (die feinste Einheit, aus der sich jede groebere bilden laesst)
-- und OHNE Ruecknahme (Invariante 8 — was freigegeben ist, ist in ein
-- Stundenkonto geflossen, und ein stilles Zurueckdrehen aenderte eine Zahl,
-- die ein Mensch schon in der Hand hatte).
-- // TODO(client, O-861): In welcher Einheit wird Zeit zur Abrechnung freigegeben — je Eintrag, je Woche, je Person, je Monat —, und laesst sich eine erteilte Freigabe zuruecknehmen, solange nichts abgerechnet ist?
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Definer-Policy — schmal, und nur fuer diesen einen Vorgang
-- ---------------------------------------------------------------------------

/**
 * `z_definer_update` (0034) laesst nur OFFENE Zeilen zu — es ist die Policy
 * des Check-in-Pfads, der eine laufende Schicht schliesst. Die
 * Abrechnungsfreigabe trifft genau das Gegenteil: eine abgeschlossene Zeile.
 * Ohne eigene Policy schriebe die Funktion unter FORCE RLS null Zeilen,
 * lautlos.
 *
 * Die Bedingungen sind der Vorgang selbst: nur abgeschlossene, nicht
 * stornierte, nicht ersetzte und noch nicht freigegebene Zeilen — und was
 * dabei herauskommt, traegt beide Freigabespalten (`z_freigabe_paarweise`
 * verlangt sie ohnehin paarweise, hier steht es als Absicht).
 */
create policy z_definer_abrechnungsfreigabe on zeiteintrag
  as permissive for update to cse_definer
  using      (ende_zeitpunkt is not null
              and storniert_am is null
              and ersetzt_am is null
              and freigegeben_am is null)
  with check (freigegeben_am is not null and freigegeben_von is not null);

comment on policy z_definer_abrechnungsfreigabe on zeiteintrag is
  'TIM-12/§3.3: der einzige Weg, freigegeben_am zu setzen — '
  'app.zeit_zur_abrechnung_freigeben. Trifft nur abgeschlossene, nicht '
  'stornierte, noch nicht freigegebene Zeilen.';

-- ---------------------------------------------------------------------------
-- 2. Der Vorgang
-- ---------------------------------------------------------------------------

/**
 * Gibt Zeiteintraege zur Abrechnung frei — mit Recht, je Zeile und mit Spur.
 *
 * **Je Zeile ein Ergebnis, kein Alles-oder-nichts.** Ein Lauf ueber sechzig
 * Eintraege, der an der einen stornierten Zeile stirbt, erzieht dazu, ihn
 * nicht zu benutzen; einer, der sie stillschweigend mitnimmt, waere falsch.
 * Also: jede Zeile bekommt ihr Wort, und der Aufrufer zeigt es an. Dasselbe
 * Muster wie die Stapelfreigabe im Freigabe-Posteingang (APR-04).
 *
 * **Der Zeitpunkt kommt aus `now()` der Datenbank** — `kern.zeiteintrag_
 * zeitstempel` (0034) ueberschreibt ihn ohnehin; hier steht er, damit die
 * Funktion ohne den Ausloeser dasselbe taete (Invariante 5).
 *
 * **Und der Mensch aus der SITZUNG**, nie aus einem Argument: wer freigibt,
 * ist eine Tatsache der Sitzung und keine Angabe des Aufrufers.
 */
create function app.zeit_zur_abrechnung_freigeben(p_ids uuid[])
returns table (zeiteintrag_id uuid, ergebnis text)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_benutzer uuid := app.aktueller_benutzer();
  v_id       uuid;
  v_zeile    record;
begin
  if v_mandant is null then
    raise exception
      'Eine Abrechnungsfreigabe braucht genau eine aktive Gesellschaft (Invariante 10).'
      using errcode = 'restrict_violation';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht schreibt nicht (Invariante 10).'
      using errcode = 'restrict_violation';
  end if;
  if v_benutzer is null then
    raise exception 'Eine Freigabe ohne Menschen ist keine Freigabe.'
      using errcode = 'restrict_violation';
  end if;
  /*
   * **O-39 haelt hier, nicht nur in der Route.** Das Recht ist nicht geseedet
   * und an keine Rolle gebunden; `app.hat_recht` antwortet deshalb heute
   * ueberall `false`. Die Zeile ist trotzdem keine Formalie: sobald der
   * Mandant O-39 beantwortet, ist sie die Stelle, die die Antwort umsetzt.
   */
  if not app.hat_recht('zeit.abrechnung_freigeben', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception
      'Höchstens 500 Einträge auf einmal — darüber ist es keine Prüfung mehr.'
      using errcode = 'check_violation';
  end if;

  foreach v_id in array p_ids loop
    select z.id, z.status::text as status, z.storniert_am, z.ersetzt_am,
           z.freigegeben_am, z.ende_zeitpunkt, z.dauer_netto_minuten
      into v_zeile
      from public.zeiteintrag z
     where z.id = v_id and z.mandant_id = v_mandant;

    if not found then
      zeiteintrag_id := v_id; ergebnis := 'nicht_gefunden'; return next; continue;
    end if;
    if v_zeile.storniert_am is not null or v_zeile.ersetzt_am is not null then
      zeiteintrag_id := v_id; ergebnis := 'storniert'; return next; continue;
    end if;
    if v_zeile.ende_zeitpunkt is null or v_zeile.status <> 'abgeschlossen' then
      zeiteintrag_id := v_id; ergebnis := 'nicht_abgeschlossen'; return next; continue;
    end if;
    if v_zeile.freigegeben_am is not null then
      zeiteintrag_id := v_id; ergebnis := 'bereits_freigegeben'; return next; continue;
    end if;
    /*
     * Ohne Nettodauer gibt es nichts abzurechnen und nichts zu buchen. Die
     * Zeile freizugeben waere kein Fehler, aber eine Freigabe ohne Gegenwert
     * — und sie verschwaende die Aufmerksamkeit, die die Liste einfordert.
     */
    if v_zeile.dauer_netto_minuten is null then
      zeiteintrag_id := v_id; ergebnis := 'ohne_dauer'; return next; continue;
    end if;

    update public.zeiteintrag
       set freigegeben_am = now(), freigegeben_von = v_benutzer
     where id = v_id and mandant_id = v_mandant and freigegeben_am is null;

    if not found then
      /* Ein zweiter Lauf auf derselben Zeile — die Wahrheit steht in der Zeile. */
      zeiteintrag_id := v_id; ergebnis := 'bereits_freigegeben'; return next; continue;
    end if;

    perform app.protokolliere(
      'zeit.abrechnung_freigegeben', 'zeiteintrag', v_id::text,
      jsonb_build_object('freigegeben_am', null),
      jsonb_build_object(
        'netto_minuten', v_zeile.dauer_netto_minuten,
        'grundlage', 'TIM-12, 04-PLANUNG-ZEIT §3.3 — Tor zu Stundenkonto und Abrechnung'),
      v_mandant);

    zeiteintrag_id := v_id; ergebnis := 'freigegeben'; return next;
  end loop;
end $$;

alter function app.zeit_zur_abrechnung_freigeben(uuid[]) owner to cse_definer;
revoke execute on function app.zeit_zur_abrechnung_freigeben(uuid[]) from public;
grant execute on function app.zeit_zur_abrechnung_freigeben(uuid[]) to cse_app;

comment on function app.zeit_zur_abrechnung_freigeben(uuid[]) is
  'TIM-12/FIN-07/§7.3: setzt freigegeben_am/freigegeben_von je Eintrag, prueft '
  'zeit.abrechnung_freigeben (O-39: nicht geseedet) und protokolliert jede Zeile. '
  'Gibt je Kennung ein Ergebnis zurueck — kein Alles-oder-nichts.';
