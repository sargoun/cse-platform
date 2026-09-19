-- 0266 — Der Schreibweg der Veroeffentlichung (NOT-01, K-08, AUT-06).

/**
 * **Der Befund, der diese Datei gebracht hat.**
 *
 * `cse_app` hat auf `benachrichtigung` **kein Tabellenrecht INSERT** — nicht
 * bloss keine Policy. Ein `insert into benachrichtigung` aus einer Route
 * bricht mit `permission denied for table benachrichtigung` ab, also mit einem
 * 500er und nicht still. INSERT gibt es genau zweimal:
 * `d_benachrichtigung_anlegen` fuer `cse_definer` und
 * `t_benachrichtigung_job_anlegen` fuer `cse_job`; `stelleZu()` wird bis heute
 * ausschliesslich aus einem Nachtlauf und aus dem Seed gerufen.
 *
 * Die Bekanntgabe eines Dienstplans ist aber kein Nachtlauf, sondern ein Klick
 * eines Menschen. Ohne diese Funktion waere NOT-01 („schedule change") an
 * einer Route gescheitert, die vollstaendig gebaut aussieht.
 *
 * **Warum ein Definer und kein Grant.** Ein `grant insert on benachrichtigung
 * to cse_app` gaebe JEDER Route das Recht, JEDEM Konto JEDEN Text mit JEDEM
 * Ziel zuzustellen — eine Meldung ist eine Aussage im Namen des Hauses. Diese
 * Funktion kann genau eines: den Vorgang anlegen und dazu die EINE Art
 * `dienstplan.plan_veroeffentlicht` zustellen. Ein anderer Artschluessel wird
 * abgewiesen, statt geduldet zu werden — sonst waere das Argument `p_art` die
 * Hintertuer, die der fehlende Grant verhindern sollte.
 *
 * **Titel, Text und Ziel kommen von aussen, und das ist Absicht.** Sie stehen
 * im Register `src/server/benachrichtigung/registry.ts`, das NOT-03 durchsetzt
 * (eine Meldung ohne aufloesbares Ziel scheitert bei der ERZEUGUNG). Sie hier
 * ein zweites Mal zu formulieren waere die zweite Wahrheit darueber, was
 * jemand im Posteingang liest. Was die Funktion prueft, ist deshalb nicht der
 * Wortlaut, sondern dass er da ist.
 *
 * **Der Empfaenger ist ein `benutzer`, der Aufrufer kennt eine `person`**
 * (D-09). Aufgeloest wird hier, deckungsgleich mit `benutzer_person_key`
 * (0007: `unique on benutzer (person_id) where person_id is not null and
 * deaktiviert_am is null`) — also hoechstens eine Zeile je Mensch, ohne dass
 * jemand darauf hoffen muss. Wer keinen Zugang hat, bekommt keine Meldung, und
 * das wird GEZAEHLT und zurueckgegeben: eine Bekanntgabe, die die halbe
 * Kolonne nicht erreicht, ist keine, und der Planer muss es sehen, solange er
 * noch anrufen kann.
 *
 * **Und der Empfaenger muss zu DIESER Gesellschaft gehoeren.** Ohne diese
 * Schranke waere die Funktion fuer jede Stelle in `cse_app` das Primitiv
 * „stelle einem beliebigen Konto einen beliebigen Text unter
 * `dienstplan.plan_veroeffentlicht` zu" — die Hintertuer, die der fehlende
 * `grant insert` gerade verhindern sollte. Geprueft wird gegen `anstellung`
 * und nicht gegen eine Einteilung im Fenster, weil O-711 offen ist: ob auch
 * Menschen mit GESTRICHENER Schicht eine Meldung bekommen, entscheidet der
 * Kunde, und eine Schranke, die diese Antwort schon ausschliesst, waere eine
 * erfundene Geschaeftsregel. `einsatz_zuordnung.anstellung_id` ist `not null`
 * — wer im Fenster eingeteilt ist, hat hier also eine Anstellung, und die
 * Schranke schneidet niemanden weg, den die Vorschau nennt.
 *
 * Ein Eintrag ohne Anstellung in `v_mandant` wird wie „ohne Zugang" GEZAEHLT
 * und nicht zugestellt: die Zahl bedeutet „diese Meldung ist nicht
 * angekommen", und genau das trifft zu.
 *
 * **Die Serveruhr setzt die Zeit** (Invariante 5): `now()` im Definer, nie ein
 * Zeitpunkt aus dem Aufruf.
 */

create function app.dienstplan_veroeffentlichung_anlegen(
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
  'Abfrage (Invariante 6), die Zeit aus now() (Invariante 5).';

/**
 * **`owner to cse_definer`** (K-01): eine neu angelegte `security
 * definer`-Funktion gehoert sonst `postgres` und laeuft als Superuser an jeder
 * RLS vorbei. Nachgesehen und nicht vermutet, dass der Rumpf danach noch
 * schreibt und liest: `benachrichtigung` gewaehrt `cse_definer` INSERT und
 * traegt `d_benachrichtigung_anlegen with check (true)`; `benutzer` gewaehrt
 * SELECT und traegt `d_benutzer_anmeldung using (true)`;
 * `dienstplan_veroeffentlichung` bekommt in 0265 Grant und Policy
 * ausdruecklich dafuer. `app.protokolliere` ist an `cse_definer` granted.
 * `anstellung` gewaehrt `cse_definer` SELECT und traegt `a_definer using
 * (true)` — nachgesehen, nicht vermutet. `person` wird NICHT gelesen —
 * `cse_definer` haelt darauf kein Tabellenrecht, und der Aufrufer liefert die
 * Kennung.
 */
alter function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  owner to cse_definer;

/* 0092: Postgres legt jede Funktion mit EXECUTE fuer PUBLIC an. */
revoke all on function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  from public;
grant execute on function app.dienstplan_veroeffentlichung_anlegen(
  date, date, text, integer, integer, integer, integer, jsonb, text, text, jsonb)
  to cse_app;
