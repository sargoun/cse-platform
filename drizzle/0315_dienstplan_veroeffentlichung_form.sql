-- 0315 — Die Form der jsonb-Argumente der Bekanntgabe (Korrektur zu 0266).

/**
 * **Der Befund.** 14 Faelle in `tests/isolation/dienstplan-veroeffentlichung.
 * test.ts` endeten mit `cannot extract elements from a scalar` — der Meldung,
 * die `jsonb_array_elements` gibt, wenn sein Argument kein Array ist.
 * Betroffen war jeder Aufruf, der bis zur Empfaengerschleife kam: der Beleg,
 * die Serveruhr, das Pruefprotokoll, die Mandantentrennung, die Wachen der
 * Tabelle. Drei davon (NOT-03, `dv_zeitraum_begrenzt`, `dv_umfang_platzhalter`)
 * prueften ihren Riegel gar nicht mehr — sie kamen nicht bis zu ihm.
 *
 * **Die Ursache lag auf zwei Seiten, und beide werden behoben.**
 *
 * 1. Der TEST rief den Definer mit `JSON.stringify(...)` bzw. `'[]'` in den
 *    `::jsonb`-Parametern auf und behauptete daneben, das sei „der Aufruf, so
 *    wie der Dienst ihn macht". Das war er nicht: `postgres.js` serialisiert
 *    eine JS-Zeichenkette in ein `jsonb`-Argument als JSON-ZEICHENKETTE, aus
 *    `'[]'` wird der Skalar `"[]"` (D-467). Der Dienst uebergibt das OBJEKT
 *    und war die ganze Zeit richtig; der Test ist auf dieselbe Form gestellt.
 *
 * 2. Die FUNKTION zerbrach an der falschen Form, statt sie zu benennen. Ein
 *    `jsonb`-Argument traegt seine Form nicht im Typ — sie ist Teil des
 *    Vertrags und gehoert deshalb in eine Pruefung mit Namen und `errcode`,
 *    wie sie `app.offline_ereignis_annehmen` (0042/0090) fuer `p_ereignisse`
 *    schon fuehrt. Eine Datenbankfunktion, die bei falscher Eingabe mit einer
 *    internen Postgres-Meldung endet, laesst den Aufrufer raten.
 *
 * **Warum eine neue Datei und kein Eingriff in 0266.** 0266 ist auf
 * Datenbanken bereits angewendet; sie nachtraeglich umzuschreiben baute einen
 * Stand, den kein Migrationslauf je erzeugt. Korrigiert wird durch
 * `create or replace` — Signatur, Rueckgabe und Rumpf sonst Wort fuer Wort
 * wie in 0266.
 */

create or replace function app.dienstplan_veroeffentlichung_anlegen(
  p_von             date,
  p_bis             date,
  p_umfang          text,
  p_schichten       integer,
  p_unbesetzt       integer,
  p_konflikte       integer,
  p_blockierend     integer,
  p_umfang_daten    jsonb,
  p_notiz           text,
  p_art             text,
  p_empfaenger      jsonb
)
returns table (id uuid, empfaenger_anzahl integer, ohne_zugang_anzahl integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_mandant   uuid := app.aktiver_mandant();
  v_id        uuid;
  v_zu        integer := 0;
  v_ohne      integer := 0;
  v_eintrag   jsonb;
  v_person    uuid;
  v_konto     uuid;
begin
  /**
   * AUT-06: fehlendes Recht, fremder Bereich und Nur-Lesen antworten gleich.
   * `app.portal() = 'intern'` steht mit, weil die Decke auf der Tabelle
   * dasselbe sagt — eine Funktion, die schwaecher prueft als die Policy
   * dahinter, ist eine Einladung.
   */
  if v_mandant is null
     or not app.hat_recht('dienstplan.veroeffentlichen', v_mandant)
     or app.ist_readonly()
     or app.portal() <> 'intern'
  then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  -- Die eine Art, die dieser Weg zustellen darf.
  if p_art is distinct from 'dienstplan.plan_veroeffentlicht' then
    raise exception
      'Dieser Weg stellt ausschliesslich dienstplan.plan_veroeffentlicht zu'
      using errcode = '42501';
  end if;

  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'Der Zeitraum ist leer oder verkehrt'
      using errcode = 'check_violation';
  end if;

  /**
   * **Die FORM der beiden jsonb-Argumente, benannt statt erlitten.**
   *
   * `jsonb_array_elements` verlangt ein Array. Kommt `p_empfaenger` als
   * jsonb-Skalar oder -Objekt herein, brach die Funktion bis hier mit
   * `cannot extract elements from a scalar` ab — einer internen
   * Postgres-Meldung, die weder sagt, welches Argument gemeint ist, noch was
   * erwartet wurde. `coalesce` faengt nur SQL-NULL, nicht die falsche Form.
   *
   * Der Weg dorthin ist derselbe Fehler, den D-467 schon einmal gekostet hat:
   * `JSON.stringify(...)` in einem `::jsonb`-Parameter legt eine JSON-
   * ZEICHENKETTE ab, kein Array — aus `[]` wird `"[]"`, und `jsonb_typeof`
   * sagt dazu `string`. Der Dienst
   * `src/server/services/dienstplan/veroeffentlichung.ts` uebergibt das
   * OBJEKT und ist damit richtig; ein anderer Aufrufer kann es aber jederzeit
   * anders machen, und ein `jsonb`-Argument traegt seine Form nicht im Typ.
   * Deshalb steht die Erwartung hier, mit Namen und errcode, und nicht in der
   * Hoffnung, dass jeder Aufrufer sie kennt.
   *
   * `p_umfang_daten` steht mit: dort waere der Schaden STILL. Die Spalte ist
   * laut 0265 der Beleg der Abgrenzung (O-711); eine JSON-Zeichenkette darin
   * verletzt keine Bedingung, und jeder spaetere `->>`-Zugriff greift ins
   * Leere, ohne dass irgendwo etwas rot wird.
   *
   * Gemessen wird nach den Pruefungen auf Recht, Art und Zeitraum: fehlendes
   * Recht antwortet weiter zuerst und gleich (AUT-06) — eine Formmeldung
   * davor verriete einem Unberechtigten, dass er die richtige Funktion
   * getroffen hat.
   */
  if jsonb_typeof(coalesce(p_empfaenger, '[]'::jsonb)) <> 'array' then
    raise exception
      'p_empfaenger ist eine Liste von Meldungen (jsonb-Array), erhalten: %',
      jsonb_typeof(p_empfaenger)
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(coalesce(p_umfang_daten, '{}'::jsonb)) <> 'object' then
    raise exception
      'p_umfang_daten ist die Abgrenzung als jsonb-Objekt, erhalten: %',
      jsonb_typeof(p_umfang_daten)
      using errcode = 'invalid_parameter_value';
  end if;

  -- Die Empfaenger werden VOR dem Vorgang aufgeloest: die Zeile traegt die
  -- endgueltigen Zahlen, und die Tabelle kennt kein UPDATE (0265).
  for v_eintrag in
    select value from jsonb_array_elements(coalesce(p_empfaenger, '[]'::jsonb))
  loop
    if coalesce(btrim(v_eintrag->>'titel'), '') = ''
       or coalesce(btrim(v_eintrag->>'text'), '') = ''
       or coalesce(length(v_eintrag->>'ziel'), 0) < 2
    then
      -- NOT-03: eine Meldung ohne Text oder ohne Ziel ist eine Mitteilung
      -- ueber etwas, das man nicht ansehen kann. Das Register verhindert das
      -- schon; hier scheitert es, statt eine leere Zeile zu schreiben.
      raise exception 'Benachrichtigung ohne Titel, Text oder Ziel (NOT-03)'
        using errcode = 'check_violation';
    end if;
    v_person := (v_eintrag->>'person_id')::uuid;
    select b.id into v_konto
      from public.benutzer b
     where b.person_id = v_person
       and b.status = 'aktiv'
       and b.deaktiviert_am is null
       and exists (select 1 from public.anstellung a
                    where a.person_id = v_person
                      and a.mandant_id = v_mandant);
    if v_konto is null then
      v_ohne := v_ohne + 1;
    else
      v_zu := v_zu + 1;
    end if;
  end loop;

  insert into public.dienstplan_veroeffentlichung
    (mandant_id, zeitraum_von, zeitraum_bis, umfang,
     schichten_anzahl, unbesetzt_anzahl, konflikte_offen, konflikte_blockierend,
     empfaenger_anzahl, ohne_zugang_anzahl, umfang_daten, notiz,
     veroeffentlicht_am, veroeffentlicht_von, erstellt_von_art, erstellt_von)
  values
    (v_mandant, p_von, p_bis, p_umfang,
     greatest(coalesce(p_schichten, 0), 0), greatest(coalesce(p_unbesetzt, 0), 0),
     greatest(coalesce(p_konflikte, 0), 0), greatest(coalesce(p_blockierend, 0), 0),
     v_zu, v_ohne, coalesce(p_umfang_daten, '{}'::jsonb),
     nullif(btrim(coalesce(p_notiz, '')), ''),
     now(), app.aktueller_benutzer(), 'mensch', app.aktueller_benutzer())
  returning dienstplan_veroeffentlichung.id into v_id;

  for v_eintrag in
    select value from jsonb_array_elements(coalesce(p_empfaenger, '[]'::jsonb))
  loop
    v_person := (v_eintrag->>'person_id')::uuid;
    -- Dieselbe Aufloesung wie oben, Wort fuer Wort: eine zweite, schwaechere
    -- Fassung hier waere die Luecke, die die erste gerade geschlossen hat.
    select b.id into v_konto
      from public.benutzer b
     where b.person_id = v_person
       and b.status = 'aktiv'
       and b.deaktiviert_am is null
       and exists (select 1 from public.anstellung a
                    where a.person_id = v_person
                      and a.mandant_id = v_mandant);
    if v_konto is not null then
      insert into public.benachrichtigung
        (mandant_id, empfaenger_id, art, titel, text, ziel,
         objekt_typ, objekt_id, sammelbar)
      values
        (v_mandant, v_konto, p_art,
         v_eintrag->>'titel', v_eintrag->>'text', v_eintrag->>'ziel',
         'dienstplan_veroeffentlichung', v_id::text,
         -- Nicht sammelbar: ein Dienstplan, den man am Einsatztag in einer
         -- Tageszusammenfassung liest, ist einer, den man zu spaet liest.
         false);
    end if;
  end loop;

  perform app.protokolliere(
    'dienstplan.veroeffentlicht', 'dienstplan_veroeffentlichung', v_id::text,
    null,
    jsonb_build_object(
      'von', p_von, 'bis', p_bis, 'umfang', p_umfang,
      'schichten', greatest(coalesce(p_schichten, 0), 0),
      'unbesetzt', greatest(coalesce(p_unbesetzt, 0), 0),
      'konflikte_offen', greatest(coalesce(p_konflikte, 0), 0),
      'konflikte_blockierend', greatest(coalesce(p_blockierend, 0), 0),
      'empfaenger', v_zu, 'ohne_zugang', v_ohne),
    v_mandant);

  return query select v_id, v_zu, v_ohne;
end $$;

comment on function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb) is
  'NOT-01, TIM-01. Legt den Veroeffentlichungsvorgang an und stellt dazu die EINE Art '
  'dienstplan.plan_veroeffentlicht zu — der einzige Weg, auf dem eine Anwendungsrolle '
  'eine benachrichtigung-Zeile erzeugen kann, denn cse_app haelt darauf kein INSERT. '
  'Prueft dienstplan.veroeffentlichen, Nur-Lesen und das interne Portal selbst; weist '
  'jeden anderen Artschluessel ab und stellt nur Menschen mit einer anstellung in der '
  'aktiven Gesellschaft zu. Zahlen kommen vom Aufrufer aus einer getesteten '
  'Abfrage (Invariante 6), die Zeit aus now() (Invariante 5). p_empfaenger ist ein '
  'jsonb-ARRAY und p_umfang_daten ein jsonb-OBJEKT; eine andere Form wird seit 0315 '
  'benannt abgewiesen (invalid_parameter_value) statt in jsonb_array_elements zu '
  'zerbrechen.';

/**
 * **K-01, auch beim Ersetzen.** `create or replace` behaelt den Eigentuemer —
 * die Zeile steht trotzdem, weil sie die Zusicherung ist, an der
 * `definer-eigentum.test.ts` misst: eine Definer-Funktion, die `postgres`
 * gehoert, laeuft als Superuser an jeder RLS vorbei. Sie hier wegzulassen
 * hiesse, sich darauf zu verlassen, dass 0266 vorher gelaufen ist und niemand
 * die Reihenfolge je aendert.
 */
alter function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  owner to cse_definer;

/* 0092: EXECUTE fuer PUBLIC bleibt auch ueber ein `create or replace` hinweg
   ausgeschlossen — `create or replace` erhaelt die ACL, und diese zwei Zeilen
   sind idempotent. Sie stehen mit, damit die Datei fuer sich lesbar bleibt. */
revoke all on function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  from public;
grant execute on function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  to cse_app;
