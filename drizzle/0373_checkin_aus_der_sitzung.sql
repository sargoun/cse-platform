-- ===========================================================================
-- 0373 — Die zweite Tuer zur selben Uhr (D-618, O-93, EMP-01, EMP-07, K-08)
--
-- **Der Befund.** `src/app/check-in/[token]/` ist vollstaendig und sorgfaeltig
-- gebaut: ein Bildschirm, ein Hauptknopf, kein Scrollen, mit Handschuhen
-- bedienbar, Serveruhr als Wahrheit (Invariante 5), Offline-Warteschlange,
-- Schichtfoto. Erreichbar ist sie ausschliesslich ueber einen Token-Link.
-- Eine Suche nach `check-in` im Arbeiterportal liefert NULL Treffer: wer sich
-- als Mitarbeiterin anmeldet, findet keinen Knopf „Arbeit beginnen".
--
-- **Warum das kein fehlender Verweis war.** Die Marke wird EINMAL im Klartext
-- zurueckgegeben und danach nirgends gespeichert (`checkin.ts:209`; in der
-- Datenbank steht nur `sha256`). Es gibt also keinen bestehenden Token, auf
-- den ein Portal verweisen koennte — die Frage „wie kommt der Link zu ihr"
-- (O-93) stellt sich fuer eine ANGEMELDETE Arbeiterin aber gar nicht.
--
-- **D-618: die Sitzung ist der staerkere Beweis.** Ein Token ist ein
-- Inhaberpapier — weiterleitbar, abfotografierbar, ueber die Schulter lesbar.
-- Eine Sitzung haengt an einem Konto, das ueber Telefonnummer und Einmalcode
-- entstanden ist (EMP-01). Von einer angemeldeten Arbeiterin zusaetzlich
-- einen Token zu verlangen, den sie sich im selben Browser besorgt, fuegt
-- keine Sicherheit hinzu und haelt sie von der Arbeit ab.
--
-- **Die Marke bleibt trotzdem die Einheit der Aufzeichnung.** Diese Funktion
-- stellt sie serverseitig aus und loest sie im selben Vorgang ein. Damit
-- bleibt `app.checkin_verbrauchen` der EINZIGE Schreiber von `zeiteintrag`
-- auf diesem Weg: dieselbe Wettlauf-Sicherung, dieselbe Geo-Schranke, dieselbe
-- Ableitung der Feldzeit. Was die Sitzung ersetzt, ist die ZUSTELLUNG der
-- Marke, nicht die Marke.
--
-- **Und es entsteht kein zweiter Schreibweg fuer die Arbeiterin.** EMP-07
-- (`p_ma_kein_update`, 0052) verbietet dem Arbeiterportal das AENDERN von
-- `zeiteintrag` ueber `cse_app`; der Kommentar dort sagt ausdruecklich, warum
-- INSERT nicht mitverboten ist: „der Check-in schreibt ueber `cse_definer`
-- (K-08) und nicht ueber `cse_app`." Genau dieser Weg wird hier benutzt.
--
-- **`zeit.checkin_verwalten` wird hier NICHT geprueft — mit Absicht.** Das ist
-- das Recht der PLANUNG, Marken fuer FREMDE auszugeben; eine Reinigungskraft
-- haelt es nicht und soll es nicht halten. Geprueft wird stattdessen das,
-- worauf es hier ankommt: dass die Sitzung genau dieser Person gehoert.
-- ===========================================================================

create function app.checkin_aus_der_sitzung(
  p_zuordnung    uuid,
  p_zweck        token_zweck,
  p_geraete_zeit timestamptz,
  p_ip           inet,
  p_user_agent   text,
  p_geo          jsonb default null
) returns table (ergebnis text, zeiteintrag_id uuid, objekt text,
                 beginn timestamptz, zeitabweichung_sek integer)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_person   uuid := app.aktuelle_person();
  v_klartext text;
  v_hash     text;
  z          record;
begin
  /*
   * **Nur aus dem Arbeiterportal.** Die Verwaltung hat ihren eigenen Weg
   * (`zeiten/checkin-links`), und eine Funktion, die aus JEDEM Portal die
   * eigene Zeit stempelt, waere ein zweiter Weg zu demselben Ziel — der
   * zweite ist der, den niemand prueft.
   */
  if app.portal() <> 'mitarbeiter' then
    raise exception 'Dieser Weg gehoert dem Arbeiterportal (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_person is null then
    raise exception 'Ohne Person keine eigene Zeit (EMP-01)'
      using errcode = 'insufficient_privilege';
  end if;

  select ez.mandant_id, ez.person_id, ez.beginn_zeitpunkt, ez.ende_zeitpunkt
    into z
    from public.einsatz_zuordnung ez
   where ez.id = p_zuordnung and ez.entfernt_am is null;
  if not found then
    return query select 'abgelehnt'::text, null::uuid, null::text,
                        null::timestamptz, null::integer;
    return;
  end if;

  /*
   * **Die eine Pruefung, auf die es ankommt.** Sie steht hier und nicht in
   * einer Policy, weil dieser Weg als Definer laeuft: wer eine fremde
   * Einteilungskennung errate, stempelte sonst fuer einen fremden Menschen.
   *
   * EIN Ergebnis fuer „gibt es nicht" und „gehoert dir nicht" (AUT-06): eine
   * Antwort, die sie unterscheidet, macht das Durchprobieren von Kennungen
   * lohnend — dieselbe Regel, die `checkin_verbrauchen` fuer Marken befolgt.
   */
  if z.person_id is distinct from v_person then
    return query select 'abgelehnt'::text, null::uuid, null::text,
                        null::timestamptz, null::integer;
    return;
  end if;

  /*
   * Die Marke wird ausgestellt und im selben Vorgang eingeloest. `gueltig_ab`
   * und `gueltig_bis` kommen wie beim Planerweg aus der ZUORDNUNG — damit
   * gilt dasselbe Zeitfenster: wer drei Stunden vor Schichtbeginn auf den
   * Knopf drueckt, wird von `checkin_verbrauchen` abgewiesen, und zwar mit
   * derselben Begruendung wie ueber den Link.
   *
   * `ausgabe_kanal = 'portal'` ist die Antwort auf O-93 in der Zeile selbst:
   * die Spalte sagt hinterher, welcher Weg genommen wurde.
   */
  v_klartext := encode(gen_random_bytes(32), 'hex');
  v_hash     := encode(digest(v_klartext, 'sha256'), 'hex');

  update public.checkin_token
     set widerrufen_am = now(), widerruf_grund = 'neu_ausgegeben'
   where einsatz_zuordnung_id = p_zuordnung and zweck = p_zweck
     and eingeloest_am is null and widerrufen_am is null;

  insert into public.checkin_token
        (mandant_id, einsatz_id, einsatz_zuordnung_id, anstellung_id, person_id,
         zweck, token_hash, gueltig_ab, gueltig_bis, ausgabe_kanal,
         erstellt_von_art, erstellt_von)
  select ez.mandant_id, ez.einsatz_id, ez.id, ez.anstellung_id, ez.person_id,
         p_zweck, v_hash, ez.beginn_zeitpunkt, ez.ende_zeitpunkt, 'portal',
         /*
          * **Handelnder und Kennung muessen zusammenpassen** —
          * `ct_akteur_stimmig`. Hier stand fest `'mensch'`, und das ist
          * genau dann falsch, wenn die Sitzung eine PERSON traegt, aber
          * kein Benutzerkonto aufloest: der Satz haette `erstellt_von_art
          * = 'mensch'` mit `erstellt_von = null` verlangt und wurde von der
          * Bedingung abgewiesen. `checkin_ausgeben` macht es seit 0035
          * richtig; hier steht dieselbe Fallunterscheidung.
          */
         case when app.aktueller_benutzer() is null then 'system'
              else 'mensch' end::akteur_art,
         app.aktueller_benutzer()
    from public.einsatz_zuordnung ez
   where ez.id = p_zuordnung;

  perform app.protokolliere('zeit.checkin_aus_sitzung', 'einsatz_zuordnung',
                            p_zuordnung::text, null,
                            jsonb_build_object('zweck', p_zweck::text,
                                               'kanal', 'portal'),
                            z.mandant_id);

  /*
   * **Und hier muendet alles in den einen Schreiber.** Kein zweites INSERT in
   * `zeiteintrag`, keine zweite Fassung der Wettlauf-Sicherung, keine zweite
   * Geo-Schranke. Was `checkin_verbrauchen` seit 0035 richtig macht, macht es
   * auch fuer diesen Weg.
   */
  return query
    select * from app.checkin_verbrauchen(v_hash, p_geraete_zeit, p_ip,
                                          p_user_agent, p_geo);
end $$;

alter function app.checkin_aus_der_sitzung(uuid, token_zweck, timestamptz, inet, text, jsonb)
  owner to cse_definer;
revoke execute on function
  app.checkin_aus_der_sitzung(uuid, token_zweck, timestamptz, inet, text, jsonb) from public;
grant execute on function
  app.checkin_aus_der_sitzung(uuid, token_zweck, timestamptz, inet, text, jsonb) to cse_app;

/*
 * **Und `cse_definer` braucht das Recht auf den Schreiber, den er ruft.**
 *
 * Diese Funktion gehoert `cse_definer` und laeuft unter ihm; Postgres loest
 * `app.checkin_verbrauchen` deshalb gegen SEINE Rechte auf, nicht gegen die
 * des Aufrufers. `0035` hat das Ausfuehrungsrecht an `cse_app` vergeben und
 * `0093` es `public` entzogen — fuer `cse_definer` stand es nie da, weil ihn
 * bis jetzt niemand rufen liess. Ohne diese Zeile endet der Weg mit
 * „permission denied for function checkin_verbrauchen", und zwar erst zur
 * Laufzeit: ein Schematest sieht eine Funktion, die es gibt.
 */
grant execute on function
  app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb) to cse_definer;

comment on function app.checkin_aus_der_sitzung(uuid, token_zweck, timestamptz, inet, text, jsonb) is
  'D-618/O-93: die zweite Tuer zur Stempeluhr — fuer die ANGEMELDETE '
  'Arbeiterin. Prueft Portal und Personenzugehoerigkeit statt einer Marke, '
  'stellt die Marke serverseitig aus und loest sie sofort ein. '
  'app.checkin_verbrauchen bleibt der einzige Schreiber (K-08); die Sitzung '
  'ersetzt die ZUSTELLUNG der Marke, nicht die Marke.';
