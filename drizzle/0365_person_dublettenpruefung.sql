-- ===========================================================================
-- 0365 — Die Dublettenprobe VOR der Einstellung (D-09, EMP-14, LEG-09,
--        01-KERN §6.13, Invariante 9)
--
-- Vertrag: `docs/architecture/04-SEITENKARTE.md` §5.12,
-- `/portal/[mandant]/personal/anstellungen/neu` — „find or create the
-- `person`, then create the employment".
--
-- **Das Problem, gegen das diese Funktion geschrieben ist.** `person` traegt
-- keinen Mandanten (D-09), und `t_person_lesen` (0004) zeigt einen Menschen
-- nur dort, wo er BESCHAEFTIGT ist. Wer bei einer Schwestergesellschaft
-- arbeitet und heute hier eingestellt wird, ist aus dieser Sitzung heraus
-- unsichtbar — die Einstellungsmaske findet nichts, legt eine zweite
-- `person`-Zeile an, und genau dagegen ist `app.person_zusammenfuehren`
-- (0194) gebaut. Die Dublette entsteht also an der Stelle, an der sie am
-- billigsten zu vermeiden waere: beim Anlegen.
--
-- Und sie ist teuer: die ArbZG-Belastung aggregiert nach Invariante 9 je
-- MENSCH ueber alle Gesellschaften (`app.arbzg_belastung`, 0040/0195). Zwei
-- Zeilen fuer einen Menschen aggregieren zweimal die Haelfte — die Grenze,
-- wegen der die Aggregation existiert, wird dann nie erreicht.
--
-- **Was diese Funktion deshalb tut, und was ausdruecklich nicht.** Sie
-- beantwortet EINE Frage: „gibt es ausserhalb dieser Gesellschaft schon einen
-- Menschen dieses Namens?" — und sie beantwortet sie mit einer ZAHL. Kein
-- Name, keine Kennung, keine Gesellschaft, kein Geburtsdatum. Das ist
-- dieselbe Linie wie `app.arbzg_belastung`, die fremde Belastung als Minuten
-- und ein `fremd`-Kennzeichen zurueckgibt und nie als Zeile: eine
-- Gesellschaft darf wissen, DASS eine Grenze beruehrt ist, ohne zu erfahren,
-- WO der Mensch sonst arbeitet.
--
-- Ob aus dieser Zahl mehr werden darf — der Name, die Kennung, das Recht,
-- eine bestehende `person` zu uebernehmen statt eine zweite anzulegen — ist
-- eine Rechts- und keine Bauentscheidung: getrennte Verantwortliche nach
-- Art. 4 Nr. 7 DSGVO, und die Beschaeftigung bei einer Schwestergesellschaft
-- ist ein personenbezogenes Datum des Menschen, nicht der Gruppe.
-- **Offen: O-860.**
-- // TODO(client, O-860): Darf die Einstellungsmaske einer Gesellschaft mehr sehen als die ZAHL gleichnamiger Menschen in der Gruppe — Name, Kennung, beschaeftigende Gesellschaft — und darf sie eine bestehende `person` uebernehmen, statt eine zweite anzulegen?
--
-- **Jede Probe hinterlaesst eine Auditzeile.** Eine Auskunft ueber Menschen
-- ausserhalb der eigenen Gesellschaft ist eine Offenlegung, auch wenn sie nur
-- aus einer Zahl besteht. Dieselbe Form wie `app.person_stammdaten_lesen`
-- (0190): wer gefragt hat, wonach, und was herauskam.
-- ===========================================================================

/**
 * Die Namensform, in der verglichen wird.
 *
 * Getrimmt und kleingeschrieben — mehr nicht. Eine unscharfe Suche
 * (Trigramm, Levenshtein) faende „Meier" fuer „Maier" und gaebe damit eine
 * Zahl heraus, die ueber Menschen spricht, die gar nicht gemeint sind; eine
 * ZU scharfe (byteweise) faende „Yildiz" nicht fuer „yildiz " und meldete
 * lautlos „keine Dublette". Die Mitte ist die einzige Form, die sich
 * begruenden laesst: derselbe Name, anders getippt.
 *
 * `immutable`, damit sie in einem Index stehen KANN — der Index selbst kommt
 * erst, wenn `person` gross genug ist, dass er sich lohnt.
 */
create function app.namensform(p_text text) returns text
language sql immutable strict set search_path = pg_catalog as $$
  select lower(btrim(p_text))
$$;

comment on function app.namensform(text) is
  'D-09/§6.13: die Vergleichsform eines Namens — getrimmt, kleingeschrieben. '
  'Bewusst keine unscharfe Suche: eine Dublettenprobe, die Namen verwechselt, '
  'spricht ueber Menschen, die niemand gemeint hat.';

/**
 * Die Dublettenprobe — zwei Zahlen, kein Name.
 *
 * `hier` sind die Menschen dieses Namens, die in der AKTIVEN Gesellschaft
 * beschaeftigt sind; sie sind ohnehin lesbar (`t_person_lesen`), und die
 * Maske zeigt sie mit Namen und Kennung. `fremd` sind die, die es nicht sind
 * — die Zahl allein, und sie ist die ganze Auskunft.
 *
 * **Warum `personal.schreiben` und nicht `personal.lesen`.** Die Probe gehoert
 * zur EINSTELLUNG. Wer nur lesen darf, stellt niemanden ein und braucht die
 * Auskunft ueber fremde Gesellschaften nicht — und eine Auskunft, die mehr
 * Menschen offensteht als der Vorgang, zu dem sie gehoert, ist eine Auskunft
 * zu viel.
 *
 * **Zusammengefuehrte Zeilen zaehlen nicht mit.** Eine Zeile, die auf eine
 * fuehrende zeigt (0194), IST der fuehrende Mensch; sie doppelt zu zaehlen
 * ergaebe „2 Treffer" fuer einen einzigen Menschen und damit eine Warnung,
 * die niemand einordnen kann.
 */
create function app.person_dublettenpruefung(p_vorname text, p_nachname text)
returns table (hier integer, fremd integer)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_vorname  text := app.namensform(coalesce(p_vorname, ''));
  v_nachname text := app.namensform(coalesce(p_nachname, ''));
  v_hier     integer := 0;
  v_fremd    integer := 0;
begin
  if v_mandant is null then
    raise exception
      'Eine Dublettenprobe braucht genau eine aktive Gesellschaft (Invariante 10).'
      using errcode = 'restrict_violation';
  end if;
  if not app.hat_recht('personal.schreiben', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;
  /*
   * Ein leerer Nachname traefe jede Zeile. Die Probe antwortet dann mit
   * Nullen statt mit der Gesamtzahl aller Menschen der Gruppe — das waere
   * genau die Abfrage, die diese Funktion nicht sein soll.
   */
  if v_nachname = '' then
    hier := 0; fremd := 0; return next; return;
  end if;

  select
    count(*) filter (where p.beschaeftigt_hier)::int,
    count(*) filter (where not p.beschaeftigt_hier)::int
    into v_hier, v_fremd
    from (
      select pe.id,
             exists (select 1 from public.anstellung a
                      where a.person_id = pe.id
                        and a.mandant_id = v_mandant
                        and a.geloescht_am is null) as beschaeftigt_hier
        from public.person pe
       where pe.geloescht_am is null
         and pe.zusammengefuehrt_in_person_id is null
         and app.namensform(pe.nachname) = v_nachname
         and (v_vorname = '' or app.namensform(pe.vorname) = v_vorname)
    ) p;

  /*
   * Die Auditzeile. Sie traegt den SUCHBEGRIFF und die beiden Zahlen, nicht
   * die getroffenen Kennungen: was hier protokolliert wird, ist die Anfrage
   * und ihre Auskunft — genau das, was offengelegt wurde, und nicht mehr.
   */
  perform app.protokolliere(
    'personal.dublettenprobe', 'person', v_nachname,
    null,
    jsonb_build_object(
      'vorname', v_vorname, 'nachname', v_nachname,
      'treffer_hier', v_hier, 'treffer_fremd', v_fremd,
      'rechtsgrundlage', 'Art. 5 Abs. 1 lit. d DSGVO — Richtigkeit'),
    v_mandant);

  hier := v_hier; fremd := v_fremd; return next;
end $$;

alter function app.person_dublettenpruefung(text, text) owner to cse_definer;
revoke execute on function app.person_dublettenpruefung(text, text) from public;
grant execute on function app.person_dublettenpruefung(text, text) to cse_app;

comment on function app.person_dublettenpruefung(text, text) is
  'D-09/EMP-14: gibt ZWEI ZAHLEN zurueck — gleichnamige Menschen in der aktiven '
  'Gesellschaft und ausserhalb. Nie einen Namen, nie eine Kennung, nie eine '
  'Gesellschaft (O-860). Prueft personal.schreiben und protokolliert jede Probe.';

/**
 * `cse_definer` liest `person` bereits (0190/0194: `d_person_stammdaten`,
 * Spaltenrechte auf `vorname`/`nachname`) und `anstellung` ueber
 * `a_definer` (0031). Diese Funktion braucht darueber hinaus nichts —
 * ausdruecklich festgehalten, damit ein spaeterer Leser nicht nach einem
 * fehlenden Grant sucht.
 */
