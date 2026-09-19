-- ===========================================================================
-- 0195 — Der Aufloeser kommt dort an, wo je MENSCH aggregiert wird
--        (Invariante 9, K-06, 01-KERN §6.13, D-09)
--
-- **Der Befund.** 0194 hat den Zeiger (`person.zusammengefuehrt_in_person_id`)
-- und den Aufloeser (`app.person_kanonisch`, `app.person_identitaeten`)
-- gebaut — und NIEMAND hat den Aufloeser gerufen. Im ganzen Anwendungscode
-- kam er nur in Kommentaren vor. Der Kopf von 0194 sagt selbst, was das
-- bedeutet: „Ohne den Aufloeser zeigt die Plattform nach der
-- Zusammenfuehrung weiter zwei Menschen — und ArbZG-Grenzen, die nach
-- Invariante 9 je PERSON aggregieren, aggregieren weiter falsch." Genau das
-- war der Stand. Die Oberflaeche unter /personal/zusammenfuehren behauptete
-- dagegen, die Zusammenfuehrung leiste „die Identitaet, damit
-- Arbeitszeitgrenzen je Mensch und nicht je Zeile aggregieren".
--
-- **Warum die Reparatur hier liegt und nicht in TypeScript.** Die
-- Schichtmenge einer Person kommt aus GENAU ZWEI Lesern:
-- `app.arbzg_belastung` (Portal) und `zeit_intern.arbzg_belastung_job`
-- (Nachtlauf), beide aus 0040. Beide filtern `f.person_id = p_person`. Wer
-- den Aufloeser stattdessen in den Aufrufern verteilte, haette ihn an vier
-- Stellen — und die fuenfte, die morgen dazukommt, haette ihn nicht. Hier
-- ist er an der Quelle, und beide Wege erben ihn.
--
-- **Die Belastung bleibt an der alten Kennung haengen, und das ist gewollt.**
-- Eine Zusammenfuehrung haengt keine Zeile um (0194: 52 Fremdschluessel,
-- eingefrorene Kindzeilen, `mitarbeiter_zugang UNIQUE (person_id)`). Die
-- Geschichte ist eingefroren und bleibt es; was sich aendert, ist die Frage,
-- welche Kennungen DENSELBEN Menschen bezeichnen. `app.person_identitaeten`
-- beantwortet sie, von jeder Seite gefragt.
--
-- **Und die Vorbedingung faellt mit.** `app.arbzg_belastung` verlangt eine
-- Beschaeftigung des Menschen in der aktiven Gesellschaft. Nach einer
-- Zusammenfuehrung kann die Beschaeftigung an der DUBLETTE haengen, waehrend
-- die Seite die fuehrende Kennung in der Hand haelt — die Pruefung wies dann
-- eine berechtigte Anfrage mit 42501 ab. Sie fragt jetzt dieselbe
-- Identitaetsmenge.
--
-- Nebenbei: die zwei Aufloeser aus 0194 behalten ihr voreingestelltes
-- EXECUTE fuer PUBLIC. Kein Datenleck (beide sind `security invoker` und
-- lesen `person` unter der RLS des Aufrufers), aber eine Abweichung von der
-- Hausregel, die jede andere Funktion dieser Domaene einhaelt. Sie faellt
-- nirgends auf, weil `tests/isolation/definer-eigentum.test.ts` auf
-- `p.prosecdef` filtert. Eine Ausnahme, die nur deshalb keine Meldung
-- erzeugt, weil der Waechter sie nicht sieht, ist genau die Sorte, die
-- spaeter zur Regel wird.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die zwei Aufloeser: PUBLIC entziehen (Hausregel K-01)
-- ---------------------------------------------------------------------------

revoke execute on function app.person_kanonisch(uuid)    from public;
revoke execute on function app.person_identitaeten(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. app.arbzg_belastung — die Portalfassung (K-06 §6.3)
-- ---------------------------------------------------------------------------

/**
 * Woertlich die Fassung aus 0040, mit genau zwei Aenderungen:
 * `f.person_id = p_person` wird zu `f.person_id = any(v_identitaeten)`, und
 * die Anstellungs-Vorbedingung fragt dieselbe Menge.
 *
 * Die Identitaeten werden EINMAL aufgeloest und in einem Array gehalten: die
 * Menge wird dreimal gebraucht (Vorbedingung, Zaehlung fuer die Auditzeile,
 * Ergebnis), und dreimal aufzuloesen hiesse, dass eine gleichzeitige
 * Zusammenfuehrung die drei Antworten gegeneinander verschieben koennte.
 *
 * Die Auditzeile traegt die Zahl der Kennungen mit. Wer im Protokoll liest,
 * dass ein Aggregat ueber zwei Kennungen lief, sieht die Zusammenfuehrung —
 * ohne sie waere der Sprung in den Zahlen unerklaerlich (LEG-09).
 *
 * Herausgegeben wird weiterhin NUR, was K-06 erlaubt: Dauern, Grenzen und
 * `fremd`. Insbesondere nicht, welche Kennung ein Fenster getragen hat — das
 * waere ein neuer Weg zu der Information, wer mit wem zusammengefuehrt wurde.
 */
create or replace function app.arbzg_belastung(
  p_person uuid, p_von timestamptz, p_bis timestamptz)
returns table (fenster_gruppe text,
               beginn_utc timestamptz, ende_utc timestamptz,
               minuten integer, fremd boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare v_mandant      uuid := app.aktiver_mandant();
        v_identitaeten uuid[];
        v_zeilen       integer;
        v_fremde       integer;
begin
  select array_agg(t) into v_identitaeten from app.person_identitaeten(p_person) as t;
  if v_identitaeten is null then v_identitaeten := array[p_person]; end if;

  if v_mandant is null
     or not app.hat_recht('dienstplan.arbzg_pruefen', v_mandant)
     or not exists (select 1 from public.anstellung a
                     where a.person_id = any(v_identitaeten)
                       and a.mandant_id = v_mandant
                       and a.geloescht_am is null)
  then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  if p_bis - p_von > interval '35 days' then
    raise exception 'Fenster zu gross' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where f.mandant_id <> v_mandant)
    into v_zeilen, v_fremde
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = any(v_identitaeten)
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);

  perform app.protokolliere('arbzg.aggregat_gelesen', 'person', p_person::text,
            null,
            jsonb_build_object('von', p_von, 'bis', p_bis,
                               'zeilen', v_zeilen, 'fremde_zeilen', v_fremde,
                               'kennungen', cardinality(v_identitaeten)));

  return query
  select encode(hmac(convert_to(f.zuordnung_quelle_id::text, 'UTF8'),
                     app.fenster_schluessel(), 'sha256'), 'hex'),
         f.beginn_utc,
         f.ende_utc,
         greatest(0, (extract(epoch from (coalesce(f.ende_utc, now()) - f.beginn_utc)) / 60)::int
                     - f.pause_minuten),
         f.mandant_id <> v_mandant
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = any(v_identitaeten)
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);
end $$;

comment on function app.arbzg_belastung(uuid, timestamptz, timestamptz) is
  'K-06: Dauern und Intervallgrenzen, sonst nichts. Nie mandant_id, nie Name, '
  'Objekt, Kunde, Personalnummer oder Stundensatz. Aggregiert ueber '
  'app.person_identitaeten — nach einer Zusammenfuehrung zaehlt die Belastung '
  'BEIDER Kennungen (Invariante 9). Jeder Aufruf schreibt audit_log mit '
  'aktion = arbzg.aggregat_gelesen.';

-- ---------------------------------------------------------------------------
-- 3. zeit_intern.arbzg_belastung_job — die Fassung des Nachtlaufs (§6.4)
-- ---------------------------------------------------------------------------

/**
 * Derselbe Schnitt fuer den Job. Er hat keine Sitzung und keinen aktiven
 * Mandanten; deshalb prueft er nichts und gibt die rohe `mandant_id` heraus,
 * gegen die der Aufrufer „fremd" bestimmt. Was er NICHT anders machen darf
 * als der Portalweg, ist die Frage, welche Fenster zu einem Menschen
 * gehoeren: zwei verschiedene Antworten hiessen, dass der Nachtlauf eine
 * Grenze meldet, die das Portal nicht kennt — oder umgekehrt verschweigt.
 */
create or replace function zeit_intern.arbzg_belastung_job(
  p_person uuid, p_von timestamptz, p_bis timestamptz)
returns table (fenster_gruppe text, beginn_utc timestamptz, ende_utc timestamptz,
               minuten integer, mandant_id uuid)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_identitaeten uuid[];
begin
  select array_agg(t) into v_identitaeten from app.person_identitaeten(p_person) as t;
  if v_identitaeten is null then v_identitaeten := array[p_person]; end if;

  perform app.protokolliere('arbzg.job_aggregat_gelesen', 'person', p_person::text,
            null, jsonb_build_object('von', p_von, 'bis', p_bis,
                                     'kennungen', cardinality(v_identitaeten)));

  return query
  select encode(hmac(convert_to(f.zuordnung_quelle_id::text, 'UTF8'),
                     app.fenster_schluessel(), 'sha256'), 'hex'),
         f.beginn_utc,
         f.ende_utc,
         greatest(0, (extract(epoch from (coalesce(f.ende_utc, now()) - f.beginn_utc)) / 60)::int
                     - f.pause_minuten),
         f.mandant_id
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = any(v_identitaeten)
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);
end $$;

comment on function zeit_intern.arbzg_belastung_job(uuid, timestamptz, timestamptz) is
  '§6.4: der Leser des Nachtlaufs. Dieselbe Identitaetsmenge wie '
  'app.arbzg_belastung (Invariante 9) — zwei verschiedene Antworten hiessen, '
  'dass Job und Portal verschiedene Grenzen kennen.';

/**
 * `cse_job` ruft `app.person_identitaeten` innerhalb eines Definers, der
 * `cse_definer` gehoert — das Recht steht dort schon (0194). Die Zeile hier
 * ist fuer den Fall, dass ein Job sie einmal direkt braucht, und sie ist
 * nach dem `revoke ... from public` oben nicht mehr selbstverstaendlich.
 */
grant execute on function app.person_kanonisch(uuid)    to cse_app, cse_job, cse_definer;
grant execute on function app.person_identitaeten(uuid) to cse_app, cse_job, cse_definer;
