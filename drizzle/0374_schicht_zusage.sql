-- ===========================================================================
-- 0374 — Zusagen und Absagen: der Zustand, den siebzehn Stellen LESEN und
--        keine einzige schreibt (V-049, V-050, D-622, EMP-02, REC-01)
--
-- **Der Befund, und er ist kein Schoenheitsfehler.** `zuordnung_status` kennt
-- seit 0028 den Wert `zugesagt`. Siebzehn Stellen im Baum lesen ihn. Eine
-- Gegenprobe ueber `src/` und `drizzle/` findet KEINEN einzigen Schreiber:
-- der einzige `UPDATE` auf `einsatz_zuordnung.status` steht in
-- `services/dienstplan/einteilung.ts` und setzt `abgesagt` — durch das BUERO.
--
-- Die Folge ist eine falsche Zahl an einer Stelle, an der sie weh tut.
-- `services/dienstplan/besetzungsluecke.ts` und der Nachtwaechter
-- `dienstplan.morgen_unbesetzt` zaehlen ausdruecklich ZUSAGEN und nicht
-- Einteilungen (`waechter/benachrichtigung.ts`: „Gezaehlt werden ZUSAGEN").
-- Ohne Schreiber meldet die Besetzungswarnung daher fuer JEDE Schicht null
-- Zusagen — sie warnt immer, also warnt sie nie. Und der Pillenzweig „Bereit"
-- im Arbeiterportal (`portal/mein/bausteine.tsx`) ist unerreichbarer Code.
--
-- ---------------------------------------------------------------------------
-- **Warum das eine SECURITY-DEFINER-Funktion ist und keine neue Policy.**
-- ---------------------------------------------------------------------------
--
-- Gemessen an `pg_policy`:
--
--   t_selbst_m1   cse_app   nur `r`  — die Arbeiterin LIEST ihre Zuordnung
--   t_mandant     cse_app   `*`      — verlangt `dienstplan.schreiben`
--   p_ma_decke    cse_app   restriktiv, deckelt auf die eigene Anstellung
--
-- Das Arbeiterportal hat ueber `cse_app` also keinen Schreibweg auf diese
-- Tabelle, und das ist richtig so: `dienstplan.schreiben` ist das Recht, den
-- Plan zu MACHEN. Wer ihm eine Reinigungskraft gaebe, gaebe ihr den Plan.
--
-- Der Weg ist deshalb derselbe wie bei der Stempeluhr (0373): eine Funktion
-- unter `cse_definer`, die PORTAL und PERSONENZUGEHOERIGKEIT prueft statt
-- eines Rechts. Was sie darf, ist genau eine Spalte auf genau einer Zeile.
--
-- ---------------------------------------------------------------------------
-- **D-622: eine Absage laesst sich NICHT zurueknehmen.**
-- ---------------------------------------------------------------------------
--
-- Vom Auftraggeber entschieden, und die Begruendung ist betrieblich, nicht
-- technisch: sagt eine Kraft ab, besetzt das Buero den Platz nach. Naehme sie
-- die Absage zwei Stunden spaeter mit einem Knopfdruck zurueck, stuenden
-- VIER Menschen auf einer Schicht fuer drei — und einer wird vor Ort
-- weggeschickt. Der Weg zurueck laeuft ueber das Buero, das als einziges
-- weiss, ob der Platz noch frei ist.
--
-- `zusagen` geht deshalb nur aus `geplant`. `absagen` geht aus `geplant` und
-- aus `zugesagt` — wer zusagt und dann krank wird, muss absagen koennen.
--
-- ---------------------------------------------------------------------------
-- **Was die Datenbank ohnehin erzwingt, und was hier NICHT noch einmal steht.**
-- ---------------------------------------------------------------------------
--
--   ez_absage_begruendet  — `status = 'abgesagt'` verlangt `abgesagt_am` UND
--                           einen nicht leeren `absage_grund`. Eine Absage
--                           ohne Grund ist in dieser Datenbank unmoeglich.
--                           Die Funktion prueft den Grund trotzdem selbst —
--                           nicht doppelt gemoppelt, sondern damit der Mensch
--                           davor einen SATZ liest und keinen Constraint-Namen.
--   trg_einsatz_besetzung_zaehlen — `AFTER UPDATE OF entfernt_am, status`
--                           schreibt `einsatz.besetzt_anzahl` fort. Hier wird
--                           deshalb NICHTS von Hand gezaehlt; ein zweiter
--                           Zaehler waere der, der irgendwann abweicht.
--   trg_einsatz_zuordnung_audit — protokolliert jede Aenderung von selbst.
--                           `app.protokolliere` steht hier zusaetzlich, weil
--                           die HANDLUNG einen Namen bekommen soll: das
--                           Aenderungsprotokoll sagt „status: geplant →
--                           zugesagt", nicht „sie hat zugesagt".
-- ===========================================================================

/*
 * **`cse_definer` darf diese Tabelle bisher nur LESEN** — und das ist die
 * Falle, die erst zur Laufzeit zuschnappt.
 *
 * `ez_definer` gibt ihm eine Policy fuer `SELECT`, und das Tabellenrecht
 * dazu; `UPDATE` stand fuer ihn nie da, weil ihn bis jetzt niemand schreiben
 * liess. Ohne diese Zeile endet jeder Aufruf mit „permission denied for table
 * einsatz_zuordnung", und zwar NACH allen Pruefungen: ein Schematest sieht
 * eine Funktion, die es gibt, und die Isolationssuite ist der erste Ort, an
 * dem es auffaellt. (Genau derselbe Fall wie der fehlende `grant execute on
 * checkin_verbrauchen` in 0373.)
 *
 * **Es braucht auch eine Policy.** Die Tabelle faehrt `FORCE ROW LEVEL
 * SECURITY`, also gilt RLS auch fuer den Eigentuemer — `ez_definer` deckt nur
 * `for select` ab. `ez_definer_update` erlaubt das Schreiben und traegt die
 * eigentliche Schranke im `with check`: der Status darf nur einer der beiden
 * Werte werden, die diese Datei setzt, und `entfernt_am` muss leer bleiben.
 * Damit kann auch eine kuenftige Definer-Funktion ueber diesen Weg keine
 * Zeile aus dem Plan nehmen — das bleibt dem Buero.
 */
grant update on public.einsatz_zuordnung to cse_definer;

create policy ez_definer_update on public.einsatz_zuordnung
  for update to cse_definer
  using (entfernt_am is null)
  with check (entfernt_am is null
              and status in ('zugesagt', 'abgesagt'));

/*
 * **Und der Besetzungszaehler schreibt `einsatz` — unter DEMSELBEN Benutzer.**
 *
 * `kern.einsatz_besetzung_zaehlen` haengt als `AFTER UPDATE OF entfernt_am,
 * status` an `einsatz_zuordnung` und schreibt `einsatz.besetzt_anzahl` fort.
 * Die Funktion ist `SECURITY INVOKER`, laeuft hier also als `cse_definer` —
 * und der durfte `einsatz` bisher nur lesen. Ohne die beiden Zeilen hier
 * endet jede Zusage mit „permission denied for table einsatz", und zwar NACH
 * dem erfolgreichen UPDATE auf die Zuordnung: der Ausloeser bringt die ganze
 * Transaktion zu Fall.
 *
 * Das ist der zweite Teil derselben Lektion: eine Definer-Funktion braucht
 * nicht nur Rechte auf DIE Tabelle, die sie nennt, sondern auf alles, was
 * ihre Ausloeser anfassen.
 *
 * **Das Recht ist auf EINE SPALTE beschnitten**, und das ist der eigentliche
 * Riegel. `grant update (besetzt_anzahl)` laesst `cse_definer` genau die
 * Zahl fortschreiben, die der Ausloeser rechnet — `status`, `objekt_id`,
 * `beginn_zeitpunkt` bleiben fuer ihn unerreichbar. Ein blankes `grant
 * update on einsatz` haette jeder kuenftigen Definer-Funktion den ganzen
 * Dienstplan geoeffnet, und zwar still.
 *
 * Die Policy daneben ist offen (`using true`), und das ist keine Nachlaessigkeit,
 * sondern die Arbeitsteilung: eine Policy kann nicht sagen, WELCHE Spalte
 * geschrieben wird — das kann nur das Spaltenrecht. Sie muss trotzdem
 * existieren, weil die Tabelle `FORCE ROW LEVEL SECURITY` faehrt und ohne
 * passende Policy auch der Eigentuemer nicht schreibt.
 */
grant update (besetzt_anzahl) on public.einsatz to cse_definer;

create policy e_definer_besetzung on public.einsatz
  for update to cse_definer
  using (true)
  with check (true);

create function app.schicht_zusagen(p_zuordnung uuid)
returns table (ergebnis text, neuer_status text)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_person uuid := app.aktuelle_person();
  z        record;
begin
  /*
   * **Nur aus dem Arbeiterportal.** Das Buero hat seinen eigenen Weg ueber
   * `dienstplan.schreiben`. Eine Funktion, die aus JEDEM Portal zusagt, waere
   * ein zweiter Weg zu demselben Ziel — der zweite ist der, den niemand
   * prueft.
   */
  if app.portal() <> 'mitarbeiter' then
    raise exception 'Dieser Weg gehoert dem Arbeiterportal (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_person is null then
    raise exception 'Ohne Person keine eigene Zusage (EMP-01)'
      using errcode = 'insufficient_privilege';
  end if;

  select ez.id, ez.mandant_id, ez.person_id, ez.status, ez.ende_zeitpunkt
    into z
    from public.einsatz_zuordnung ez
   where ez.id = p_zuordnung and ez.entfernt_am is null
   for update;

  /*
   * EIN Ergebnis fuer „gibt es nicht" und „gehoert dir nicht" (AUT-06).
   * Zwei unterscheidbare Antworten machen das Durchprobieren von Kennungen
   * lohnend — dieselbe Regel, der `checkin_verbrauchen` seit 0035 folgt.
   */
  if not found or z.person_id is distinct from v_person then
    return query select 'unbekannt'::text, null::text;
    return;
  end if;

  if z.ende_zeitpunkt <= now() then
    return query select 'vorbei'::text, z.status::text;
    return;
  end if;

  /*
   * Schon zugesagt ist KEIN Fehler, sondern derselbe Wunsch zweimal —
   * zwei Daumen auf demselben Knopf, ein langsames Netz. Die Antwort sagt es,
   * und die Zeile bleibt, wie sie ist (samt `zugesagt_am` des ersten Males).
   */
  if z.status = 'zugesagt' then
    return query select 'schon_zugesagt'::text, z.status::text;
    return;
  end if;

  -- D-622: aus `abgesagt` fuehrt kein Weg zurueck, und auch nicht aus
  -- `ersetzt` oder `nicht_erschienen` — die gehoeren dem Buero.
  if z.status <> 'geplant' then
    return query select 'nicht_moeglich'::text, z.status::text;
    return;
  end if;

  update public.einsatz_zuordnung
     set status = 'zugesagt', zugesagt_am = now(),
         geaendert_von_art = case when app.aktueller_benutzer() is null
                                  then 'system' else 'mensch' end::akteur_art,
         geaendert_von = app.aktueller_benutzer()
   where id = p_zuordnung;

  perform app.protokolliere('dienstplan.schicht_zugesagt', 'einsatz_zuordnung',
                            p_zuordnung::text,
                            jsonb_build_object('status', 'geplant'),
                            jsonb_build_object('status', 'zugesagt'),
                            z.mandant_id);

  return query select 'zugesagt'::text, 'zugesagt'::text;
end $$;

create function app.schicht_absagen(p_zuordnung uuid, p_grund text)
returns table (ergebnis text, neuer_status text)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_person uuid := app.aktuelle_person();
  v_grund  text := btrim(coalesce(p_grund, ''));
  z        record;
begin
  if app.portal() <> 'mitarbeiter' then
    raise exception 'Dieser Weg gehoert dem Arbeiterportal (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_person is null then
    raise exception 'Ohne Person keine eigene Absage (EMP-01)'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * **Der Grund wird HIER geprueft, obwohl `ez_absage_begruendet` ihn ohnehin
   * erzwingt.** Der Unterschied ist der Mensch davor: die Bedingung antwortet
   * mit ihrem Namen, diese Zeile mit einem Ergebnis, das die Oberflaeche in
   * vier Sprachen uebersetzen kann.
   *
   * Und der Grund ist nicht Buerokratie: die Disposition muss um 05:40
   * unterscheiden koennen zwischen „krank" und „ich habe den Bus verpasst" —
   * das eine besetzt sie nach, das andere ruft sie an.
   */
  if v_grund = '' then
    return query select 'grund_fehlt'::text, null::text;
    return;
  end if;

  select ez.id, ez.mandant_id, ez.person_id, ez.status, ez.ende_zeitpunkt
    into z
    from public.einsatz_zuordnung ez
   where ez.id = p_zuordnung and ez.entfernt_am is null
   for update;

  if not found or z.person_id is distinct from v_person then
    return query select 'unbekannt'::text, null::text;
    return;
  end if;

  if z.ende_zeitpunkt <= now() then
    return query select 'vorbei'::text, z.status::text;
    return;
  end if;

  if z.status = 'abgesagt' then
    return query select 'schon_abgesagt'::text, z.status::text;
    return;
  end if;

  -- Absagen darf man aus `geplant` UND aus `zugesagt`: wer zusagt und dann
  -- krank wird, muss absagen koennen. `ersetzt` und `nicht_erschienen` sind
  -- Feststellungen des Bueros und keine Zustaende, aus denen die Kraft handelt.
  if z.status not in ('geplant', 'zugesagt') then
    return query select 'nicht_moeglich'::text, z.status::text;
    return;
  end if;

  update public.einsatz_zuordnung
     set status = 'abgesagt', abgesagt_am = now(),
         absage_grund = left(v_grund, 500),
         geaendert_von_art = case when app.aktueller_benutzer() is null
                                  then 'system' else 'mensch' end::akteur_art,
         geaendert_von = app.aktueller_benutzer()
   where id = p_zuordnung;

  perform app.protokolliere('dienstplan.schicht_abgesagt', 'einsatz_zuordnung',
                            p_zuordnung::text,
                            jsonb_build_object('status', z.status::text),
                            jsonb_build_object('status', 'abgesagt',
                                               'grund', left(v_grund, 500)),
                            z.mandant_id);

  return query select 'abgesagt'::text, 'abgesagt'::text;
end $$;

alter function app.schicht_zusagen(uuid) owner to cse_definer;
alter function app.schicht_absagen(uuid, text) owner to cse_definer;
revoke execute on function app.schicht_zusagen(uuid) from public;
revoke execute on function app.schicht_absagen(uuid, text) from public;
grant execute on function app.schicht_zusagen(uuid) to cse_app;
grant execute on function app.schicht_absagen(uuid, text) to cse_app;

comment on function app.schicht_zusagen(uuid) is
  'V-049/D-622: die Kraft sagt ihre eigene Schicht zu. Prueft Portal und '
  'Personenzugehoerigkeit statt eines Rechts — `dienstplan.schreiben` ist das '
  'Recht, den Plan zu MACHEN. Nur aus `geplant`; `besetzt_anzahl` pflegt '
  'trg_einsatz_besetzung_zaehlen.';
comment on function app.schicht_absagen(uuid, text) is
  'V-049/D-622: die Kraft sagt ihre eigene Schicht ab, mit Grund. Aus '
  '`geplant` und aus `zugesagt`. Zurueknehmen laesst sich eine Absage NICHT '
  '(D-622) — das Buero hat den Platz womoeglich nachbesetzt.';
