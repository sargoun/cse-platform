-- ===========================================================================
-- 0194 — Personendubletten: der Zeiger, der Aufloeser und der Vorgang
--        (01-KERN §6.13, D-09, LEG-09, Invariante 8, Invariante 9)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.13
-- (`zusammengefuehrt_in_person_id`: „die veraltete Zeile bleibt und zeigt auf
-- die fuehrende (kein Hard Delete)").
--
-- **Warum eine Zusammenfuehrung keine Geschichte umschreiben kann.** 50
-- Tabellen tragen einen Fremdschluessel auf `person`, 52 Fremdschluessel
-- insgesamt. Die Zeitdomaene traegt `person_id` denormalisiert mit
-- zusammengesetzten Fremdschluesseln `(anstellung_id, person_id) →
-- anstellung (id, person_id)` und OHNE `on update cascade`:
-- `anstellung.person_id` umzuschreiben scheitert an den Kindzeilen. Und die
-- Kindzeilen sind zum Teil eingefroren — `trg_zeiteintrag_1_unveraenderlich`,
-- `w_nur_storno`, `da_kenntnisnahme_unveraenderlich`,
-- `trg_checkin_token_unveraenderlich`, `trg_as_3_unveraenderlich`,
-- `trg_ln_signatur_unveraenderlich` weisen ein UPDATE ab. Auch `nachweis`
-- laesst sich nicht umhaengen (`nachweis_warnung` haengt mit
-- `(nachweis_id, person_id)` daran), und `mitarbeiter_zugang` traegt
-- `UNIQUE (person_id)` — hat die Dublette ebenfalls einen Zugang, und das ist
-- der Regelfall einer Personendublette, wirft jedes Umhaengen 23505.
--
-- **Daraus folgt die Form: ein ZEIGER und ein AUFLOESER, kein Umschreiben.**
-- Die veraltete Zeile bleibt lesbar und zeigt auf die fuehrende; jeder
-- Lesepfad, dem die Identitaet wichtig ist, loest den Zeiger auf. Ohne den
-- Aufloeser zeigt die Plattform nach der Zusammenfuehrung weiter zwei
-- Menschen — und ArbZG-Grenzen, die nach Invariante 9 je PERSON aggregieren,
-- aggregieren weiter falsch. Der Zeiger allein ist deshalb keine halbe
-- Loesung, sondern die halbe Haelfte; `app.person_kanonisch` und
-- `app.person_identitaeten` sind die andere.
--
-- **Was diese Migration ausdruecklich NICHT entscheidet.** Welche Zeile bei
-- widersprechenden Angaben gewinnt, welcher Portalzugang ueberlebt, ob eine
-- Zusammenfuehrung rueckgaengig gemacht werden kann und ob eine Gesellschaft
-- eine Dublette zusammenfuehren darf, deren zweite Beschaeftigung bei einer
-- Schwestergesellschaft liegt: das sind Geschaeftsregeln mit Rechtsfolge
-- (O-611). Der Vorgang unten fuehrt deshalb nur zusammen, was die aufrufende
-- Gesellschaft SELBST sieht, und haengt keine einzige Zeile um.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Zeiger (§6.13)
-- ---------------------------------------------------------------------------

alter table person add column zusammengefuehrt_in_person_id uuid references person(id);

comment on column person.zusammengefuehrt_in_person_id is
  '§6.13: Dublettenaufloesung. Die veraltete Zeile BLEIBT und zeigt auf die '
  'fuehrende (Invariante 8). Gesetzt nur durch app.person_zusammenfuehren; '
  'aufgeloest durch app.person_kanonisch.';

/**
 * Lesbar fuer `cse_app` — sonst kann keine Oberflaeche den Hinweis „dieser
 * Datensatz wurde zusammengefuehrt" zeigen, und eine unsichtbare
 * Zusammenfuehrung ist schlimmer als keine: der Bearbeiter pflegt weiter die
 * veraltete Zeile. Nicht SCHREIBBAR: der Zeiger entsteht in einem Vorgang mit
 * Rechtepruefung und Protokoll, nicht in einem `update`.
 */
grant select (zusammengefuehrt_in_person_id) on person to cse_app;
grant select (vorname, nachname, telefon, zusammengefuehrt_in_person_id)
      on person to cse_definer;
grant update (zusammengefuehrt_in_person_id) on person to cse_definer;

create policy d_person_merge on person for update to cse_definer
  using (true) with check (true);

create index person_zusammengefuehrt_idx on person (zusammengefuehrt_in_person_id)
  where zusammengefuehrt_in_person_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Kein Selbstbezug, keine Ketten
-- ---------------------------------------------------------------------------

/**
 * **Warum Ketten verboten sind und nicht aufgeloest werden.**
 *
 * A → B → C ist mit einer Schleife aufloesbar, und genau das ist das Problem:
 * jeder Aufloeser muesste sie fahren, und der erste, der es vergisst, liest
 * die mittlere Zeile als fuehrend. Ein Zeiger, der immer genau EINEN Sprung
 * weit ist, laesst sich in einer `coalesce` aufloesen — und ist damit auch in
 * einer Policy und in einem Index verwendbar.
 *
 * Verboten sind drei Lagen: der Selbstbezug, das Zeigen auf eine bereits
 * zusammengefuehrte Zeile, und das Zusammenfuehren einer Zeile, auf die selbst
 * schon jemand zeigt. Die dritte fehlt in der naheliegenden Umsetzung — und
 * genau sie erzeugt die Kette.
 */
create function kern.person_merge_kein_zyklus() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.zusammengefuehrt_in_person_id is null then return new; end if;

  if new.zusammengefuehrt_in_person_id = new.id then
    raise exception 'Ein Mensch ist keine Dublette von sich selbst.'
      using errcode = 'restrict_violation';
  end if;

  if exists (select 1 from public.person z
              where z.id = new.zusammengefuehrt_in_person_id
                and z.zusammengefuehrt_in_person_id is not null) then
    raise exception
      'Die gewählte führende Zeile ist selbst schon zusammengeführt (§6.13). '
      'Der Zeiger ist genau einen Sprung weit — sonst liest der erste Lesepfad, '
      'der die Kette nicht verfolgt, die mittlere Zeile als führend.'
      using errcode = 'restrict_violation';
  end if;

  if exists (select 1 from public.person z
              where z.zusammengefuehrt_in_person_id = new.id) then
    raise exception
      'Auf diese Zeile zeigt bereits eine Dublette; sie ist damit eine führende '
      'Zeile und kann nicht selbst zusammengeführt werden (§6.13). Führen Sie '
      'zuerst beide Dubletten auf dieselbe Zeile.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create trigger trg_person_merge_kein_zyklus
  before insert or update of zusammengefuehrt_in_person_id on person
  for each row execute function kern.person_merge_kein_zyklus();

comment on function kern.person_merge_kein_zyklus() is
  '§6.13: Selbstbezug, Zeigen auf eine zusammengefuehrte Zeile und das '
  'Zusammenfuehren einer fuehrenden Zeile sind ausgeschlossen. Der Zeiger '
  'bleibt damit genau einen Sprung weit.';

-- ---------------------------------------------------------------------------
-- 3. Der Aufloeser (Invariante 9)
-- ---------------------------------------------------------------------------

/**
 * Die fuehrende Kennung eines Menschen — oder die eigene, wenn es keine gibt.
 *
 * `STABLE` und ohne Rechtepruefung: die Funktion beantwortet „welche Zeile ist
 * dieselbe Person", nicht „was steht darin". Sie gibt eine Kennung zurueck,
 * und was der Aufrufer damit liest, bleibt seiner RLS unterworfen.
 *
 * Nicht `SECURITY DEFINER` — sie liest `person` unter der Policy des
 * Aufrufers. Wer die fuehrende Zeile nicht sehen darf, bekommt ihre Kennung
 * trotzdem; das verraet nichts, was er nicht schon hat (er haelt die Kennung
 * der Dublette in der Hand), und alles Weitere braucht Leserecht.
 */
create function app.person_kanonisch(p_person uuid) returns uuid
language sql stable set search_path = pg_catalog, public, app as $$
  select coalesce(p.zusammengefuehrt_in_person_id, p.id)
    from public.person p where p.id = p_person;
$$;

grant execute on function app.person_kanonisch(uuid) to cse_app, cse_job;

comment on function app.person_kanonisch(uuid) is
  '§6.13: loest den Dublettenzeiger auf. Genau ein Sprung — der Trigger '
  'kern.person_merge_kein_zyklus haelt die Kette flach.';

/**
 * Alle Kennungen, die DENSELBEN Menschen bezeichnen — die fuehrende und jede
 * darauf zeigende Dublette.
 *
 * **Das ist die Funktion, die Invariante 9 braucht.** ArbZG-Grenzen
 * aggregieren je PERSON ueber alle Gesellschaften (K-06); nach einer
 * Zusammenfuehrung haengen die alten Zeiteintraege weiter an der alten
 * `anstellung` mit der alten `person_id` — die Geschichte ist eingefroren und
 * bleibt es. Eine Aggregation, die nur die fuehrende Kennung nimmt, verliert
 * genau die Belastung, wegen der die Grenze existiert.
 */
create function app.person_identitaeten(p_person uuid) returns setof uuid
language sql stable set search_path = pg_catalog, public, app as $$
  with kanonisch as (select app.person_kanonisch(p_person) as id)
  select k.id from kanonisch k
  union
  select p.id from public.person p, kanonisch k
   where p.zusammengefuehrt_in_person_id = k.id;
$$;

grant execute on function app.person_identitaeten(uuid) to cse_app, cse_job;

comment on function app.person_identitaeten(uuid) is
  'Invariante 9, K-06: die fuehrende Kennung und jede darauf zeigende Dublette. '
  'Eine Aggregation je Mensch nimmt DIESE Menge, nicht eine einzelne Kennung.';

-- ---------------------------------------------------------------------------
-- 4. Der Vorgang (LEG-09)
-- ---------------------------------------------------------------------------

/**
 * Zwei Zeilen, ein Mensch — in EINER Transaktion, mit Recht und Protokoll.
 *
 * **Warum ein Definer, obwohl nichts umgehaengt wird.** Der Zeiger ist
 * `cse_app` nicht schreibbar (oben), und das soll er nicht werden: eine
 * Zusammenfuehrung ist ein Vorgang mit Rechtsfolge — sie aendert, wer nach
 * Invariante 9 als ein Mensch zaehlt — und kein `update` in einer Maske.
 *
 * **Beide Menschen muessen in der AKTIVEN Gesellschaft beschaeftigt sein.**
 * Das ist die heutige Annahme und ausdruecklich eine (O-611): die Dublette
 * kann bei einer Schwestergesellschaft beschaeftigt sein, die die
 * zusammenfuehrende Sitzung gar nicht sieht, und ob eine Gesellschaft ueber
 * eine Beschaeftigung entscheiden darf, die sie nicht sehen kann, ist eine
 * Rechtsfrage. Die Funktion weist diesen Fall mit einem Satz ab, der ihn
 * benennt — statt still die Haelfte zu tun.
 * // TODO(client, O-611): Darf eine Gesellschaft eine Personendublette zusammenfuehren, deren zweite Beschaeftigung bei einer Schwestergesellschaft liegt und die sie deshalb nicht sehen kann — und welcher Portalzugang ueberlebt, wenn beide Zeilen einen haben?
 */
create function app.person_zusammenfuehren(
  p_dublette uuid, p_fuehrend uuid, p_grund text)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null then
    raise exception
      'Eine Zusammenführung braucht genau eine aktive Gesellschaft (Invariante 10).'
      using errcode = 'restrict_violation';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht schreibt nicht (Invariante 10).'
      using errcode = 'restrict_violation';
  end if;
  if not app.hat_recht('personal.zusammenfuehren', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;
  if p_dublette = p_fuehrend then
    raise exception 'Ein Mensch ist keine Dublette von sich selbst.'
      using errcode = 'restrict_violation';
  end if;
  if coalesce(btrim(p_grund), '') = '' then
    raise exception
      'Eine Zusammenführung ohne Begründung ist kein Vorgang, sondern ein Klick.'
      using errcode = 'check_violation';
  end if;

  /*
   * Beide Zeilen muessen in DIESER Gesellschaft beschaeftigt sein — sonst
   * entscheidet eine Gesellschaft ueber einen Menschen, den sie nicht fuehrt
   * (O-611). Der Satz nennt den Grund; „nicht gefunden" liesse den Aufrufer
   * raten, ob er sich vertippt hat.
   */
  if not exists (select 1 from public.anstellung a
                  where a.person_id = p_dublette and a.mandant_id = v_mandant
                    and a.geloescht_am is null)
     or not exists (select 1 from public.anstellung a
                     where a.person_id = p_fuehrend and a.mandant_id = v_mandant
                       and a.geloescht_am is null) then
    raise exception
      'Beide Datensätze müssen in DIESER Gesellschaft beschäftigt sein. Liegt die '
      'zweite Beschäftigung bei einer Schwestergesellschaft, ist die Zusammenführung '
      'offen (O-611) — sie entschiede über einen Menschen, den diese Gesellschaft '
      'nicht führt.'
      using errcode = 'restrict_violation';
  end if;

  update public.person p
     set zusammengefuehrt_in_person_id = p_fuehrend,
         geaendert_am = now()
   where p.id = p_dublette
     and p.zusammengefuehrt_in_person_id is null;

  if not found then
    raise exception
      'Dieser Datensatz ist bereits zusammengeführt. Eine Zusammenführung wird '
      'nicht überschrieben (Invariante 8).'
      using errcode = 'restrict_violation';
  end if;

  /*
   * Die Auditzeile traegt BEIDE Kennungen und den Grund. Sie ist der einzige
   * Ort, an dem nachlesbar ist, wer zwei Menschen zu einem erklaert hat —
   * `person` selbst traegt nur das Ergebnis.
   */
  perform app.protokolliere(
    'personal.person_zusammengefuehrt', 'person', p_dublette::text,
    jsonb_build_object('person_id', p_dublette),
    jsonb_build_object(
      'zusammengefuehrt_in_person_id', p_fuehrend,
      'grund', btrim(p_grund),
      'rechtsgrundlage', 'Art. 5 Abs. 1 lit. d DSGVO — Richtigkeit'),
    v_mandant);
end $$;

alter function app.person_zusammenfuehren(uuid, uuid, text) owner to cse_definer;
revoke execute on function app.person_zusammenfuehren(uuid, uuid, text) from public;
grant execute on function app.person_zusammenfuehren(uuid, uuid, text) to cse_app;

comment on function app.person_zusammenfuehren(uuid, uuid, text) is
  '§6.13, LEG-09: setzt den Dublettenzeiger, prueft personal.zusammenfuehren im '
  'aktiven Mandanten und protokolliert beide Kennungen mit Grund. Haengt KEINE '
  'Zeile um — die Geschichte ist eingefroren (siehe Kopf von 0194).';
