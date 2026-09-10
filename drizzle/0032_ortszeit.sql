-- ===========================================================================
-- 0032 — `app.loese_ortszeit`: die EINE Umrechnung Wanduhr → Instant
--        (04-PLANUNG-ZEIT.md §7.2, K-11)
-- ===========================================================================
--
-- Der Generator entfaltet die Serie in Ortszeit (`src/lib/datum/rrule.ts`) und
-- rechnet das Schichtende auf der Wanduhr aus (§7.1: „the shift's own end is a
-- wall-clock fact, not a sum"). Was er NICHT tut, ist die Ortszeit selbst in
-- einen Instant zu uebersetzen.
--
-- Der Grund steht in §7.2: „one IANA tz database — the server's — is
-- authoritative and the Node process never converts a zone itself". Zwei
-- Zonendatenbanken, die um eine Auslieferung auseinanderliegen, sind zwei
-- Wahrheiten ueber dieselbe Nacht — und der Unterschied faellt erst auf, wenn
-- er schon in der Lohnabrechnung steht.
--
-- Zwei Ortszeiten im Jahr sind pathologisch, und die Funktion RAET NICHT,
-- sondern klassifiziert. Beide Faelle werden ueber den RUECKWEG erkannt, nicht
-- ueber ein Datum: eine Regel wie „letzter Sonntag im Maerz" waere eine zweite
-- Zonendatenbank, von Hand gepflegt, und genau das soll hier nicht entstehen.

-- ---------------------------------------------------------------------------
-- 1. Der Zonenversatz an einem Instant
-- ---------------------------------------------------------------------------
--
-- Postgres hat keinen direkten Ausdruck dafuer. Den Umweg gibt es aber:
-- `i at time zone z` liefert die ORTSZEIT als `timestamp`, und dieselbe
-- Ortszeit wieder als UTC gelesen minus dem Instant ist genau der Versatz.

create or replace function app.zonenversatz(p_instant timestamptz, p_zone text)
returns interval
language sql
immutable
parallel safe
as $$
  select ((p_instant at time zone p_zone) at time zone 'UTC') - p_instant;
$$;

comment on function app.zonenversatz(timestamptz, text) is
  'Der UTC-Versatz einer Zone an einem Instant. Hilfsmittel von '
  'app.loese_ortszeit; kein Ersatz fuer `at time zone`.';

-- ---------------------------------------------------------------------------
-- 2. Der Umstellungsinstant eines Kalendertags
-- ---------------------------------------------------------------------------
--
-- §7.2 verlangt fuer die Luecke ausdruecklich „the transition instant itself".
-- Was Postgres bei einer nicht existierenden Ortszeit liefert, ist ein anderer
-- Instant: `2026-03-29 02:30` wird zu `01:30Z`, also `03:30` Ortszeit — eine
-- halbe Stunde NACH der Umstellung. Eine Schicht, die um 02:30 beginnen soll,
-- begaenne dann um 03:30 statt um 03:00, und niemand haette das entschieden.
--
-- Gesucht wird der Instant per Intervallhalbierung, weil er sich so aus der
-- Zonendatenbank selbst ergibt: keine Regel ueber Sonntage, keine Annahme
-- ueber eine Stunde Sprungweite (Lord Howe springt eine halbe).

create or replace function app.zonenumstellung(p_datum date, p_zone text)
returns timestamptz
language plpgsql
immutable
parallel safe
as $$
declare
  v_lo timestamptz;
  v_hi timestamptz;
  v_mitte timestamptz;
  v_versatz_lo interval;
begin
  -- 00:00 Ortszeit existiert an jedem Umstellungstag (die Umstellung liegt
  -- nachts nach Mitternacht); 26 Stunden decken den ganzen Tag mit Reserve.
  v_lo := date_trunc('second', (p_datum::timestamp) at time zone p_zone);
  v_hi := v_lo + interval '26 hours';
  v_versatz_lo := app.zonenversatz(v_lo, p_zone);
  if v_versatz_lo = app.zonenversatz(v_hi, p_zone) then
    return null;                      -- an diesem Tag stellt niemand um
  end if;

  -- Auf die Sekunde genau, und die Mitte wird auf ganze Sekunden ABGERUNDET:
  -- `(v_hi - v_lo) / 2` erzeugt Bruchteile, und die Suche endete dann auf
  -- `01:00:00.384522+00` statt auf `01:00:00+00`. Der Instant waere um einen
  -- Sekundenbruchteil falsch — unsichtbar in jeder Anzeige und trotzdem eine
  -- andere Zahl in jedem Vergleich.
  while v_hi - v_lo > interval '1 second' loop
    v_mitte := v_lo + make_interval(
      secs => floor(extract(epoch from (v_hi - v_lo)) / 2)::int);
    if app.zonenversatz(v_mitte, p_zone) = v_versatz_lo then
      v_lo := v_mitte;
    else
      v_hi := v_mitte;
    end if;
  end loop;
  return v_hi;                        -- der erste Instant mit dem neuen Versatz
end;
$$;

comment on function app.zonenumstellung(date, text) is
  'Der Instant, an dem sich der Zonenversatz an diesem Kalendertag aendert, '
  'oder NULL. Aus der Zonendatenbank gesucht, nicht aus einer Regel abgeleitet.';

-- ---------------------------------------------------------------------------
-- 3. Die Aufloesung selbst
-- ---------------------------------------------------------------------------
--
-- TODO(client, O-163): Wie werden die beiden Naechte der Zeitumstellung bezahlt — zaehlt die
-- geleistete Zeit (7 h bzw. 9 h) oder die geplante Schichtlaenge, und gilt bei doppelt
-- vorhandener Ortszeit der fruehere oder der spaetere Zeitpunkt?

create or replace function app.loese_ortszeit(
  p_datum date,
  p_zeit  time,
  p_zone  text default 'Europe/Berlin'
) returns table (zeitpunkt timestamptz, anomalie zeitanomalie)
language plpgsql
immutable
parallel safe
as $$
declare
  v_lokal    timestamp;
  v_instant  timestamptz;
  v_umstell  timestamptz;
  v_delta    interval;
  v_kandidat timestamptz;
begin
  if p_zone is null or btrim(p_zone) = '' then
    raise exception 'loese_ortszeit ohne Zeitzone — die Serie traegt ihre Zone (§5.2)';
  end if;
  v_lokal   := (p_datum + p_zeit);
  v_instant := v_lokal at time zone p_zone;

  -- (a) Gibt es die Ortszeit ueberhaupt? Der Rueckweg sagt es: fuehrt er
  --     woanders hin, lag die Eingabe in der Luecke.
  if (v_instant at time zone p_zone) <> v_lokal then
    zeitpunkt := coalesce(app.zonenumstellung(p_datum, p_zone), v_instant);
    anomalie  := 'dst_luecke';
    return next;
    return;
  end if;

  -- (b) Gibt es sie zweimal? Nur an einem Tag mit Rueckstellung, und dann
  --     bildet der um |delta| fruehere Instant dieselbe Ortszeit ab.
  v_umstell := app.zonenumstellung(p_datum, p_zone);
  if v_umstell is not null then
    v_delta := app.zonenversatz(v_umstell, p_zone)
             - app.zonenversatz(v_umstell - interval '1 second', p_zone);
    if v_delta < interval '0' then
      -- `v_delta` ist negativ, `v_instant + v_delta` also der fruehere Instant.
      v_kandidat := v_instant + v_delta;
      if (v_kandidat at time zone p_zone) = v_lokal then
        zeitpunkt := v_kandidat;   -- der fruehere, noch Sommerzeit (PLATZHALTER, O-163)
        anomalie  := 'dst_doppelt';
        return next;
        return;
      end if;
      -- Postgres kann auch schon den frueheren gewaehlt haben; dann liegt der
      -- zweite eine Sprungweite SPAETER, und `v_instant` ist bereits richtig.
      if ((v_instant - v_delta) at time zone p_zone) = v_lokal then
        zeitpunkt := v_instant;
        anomalie  := 'dst_doppelt';
        return next;
        return;
      end if;
    end if;
  end if;

  zeitpunkt := v_instant;
  anomalie  := 'keine';
  return next;
end;
$$;

comment on function app.loese_ortszeit(date, time, text) is
  'Wanduhr → Instant, mit Klassifikation der beiden pathologischen Ortszeiten '
  '(§7.2). Die einzige Umrechnung dieser Art in der Plattform; der Node-Prozess '
  'rechnet keine Zone um.';

grant execute on function app.zonenversatz(timestamptz, text)  to cse_app, cse_job;
grant execute on function app.zonenumstellung(date, text)      to cse_app, cse_job;
grant execute on function app.loese_ortszeit(date, time, text) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- 4. „Ist an dieser Schicht schon Zeit erfasst?" — heute immer nein
-- ---------------------------------------------------------------------------
--
-- Der Generator darf eine Schicht nicht mehr veraendern, sobald jemand darauf
-- gearbeitet hat (§8.2 Schritt 7). Die Bedingung dafuer liest `zeiteintrag` —
-- eine Tabelle, die es erst in PR 34 gibt.
--
-- Der naheliegende Ausweg waere, den Zusatz in TypeScript wegzulassen, solange
-- die Tabelle fehlt. Das waere genau die stille Sorte Fehler, die dieses
-- Projekt sonst teuer bezahlt: die Anweisung liefe weiter, der Schutz waere
-- weg, und niemand saehe es — bis der Generator eine bereits gearbeitete
-- Schicht ueberschreibt.
--
-- Stattdessen steht die Frage hier, als Funktion mit stabiler Signatur. Heute
-- ist ihre Antwort ein FAKT und keine Annahme: es gibt keine Tabelle, also
-- gibt es keinen Zeiteintrag. PR 34 ersetzt den Rumpf in derselben Migration,
-- die `zeiteintrag` anlegt — und ein Test dort haelt fest, dass sie es tat.

create or replace function app.einsatz_hat_zeiterfassung(p_einsatz uuid)
returns boolean
language sql
stable
parallel safe
as $$
  -- PR 34 ersetzt diesen Rumpf durch:
  --   select exists (select 1 from zeiteintrag t
  --                   where t.einsatz_id = p_einsatz and t.storniert_am is null);
  select false;
$$;

comment on function app.einsatz_hat_zeiterfassung(uuid) is
  'Haengt an dieser Schicht eine nicht stornierte Zeiterfassung? Solange '
  '`zeiteintrag` nicht existiert (bis PR 34) ist die Antwort ein Fakt, keine '
  'Annahme. Der Generator fragt sie, statt die Bedingung wegzulassen.';

grant execute on function app.einsatz_hat_zeiterfassung(uuid) to cse_app, cse_job;
