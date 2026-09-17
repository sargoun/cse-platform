-- ===========================================================================
-- 0211 — Die Abnahme (§ 12 VOB/B) und ihre Maengelliste
--        (03-GEWERKE §7.2/§7.3, BAU-01, OPS-11, LEG-01, FIN-08)
-- ===========================================================================
--
-- **Die Abnahme ist der teuerste Zeitpunkt eines Bauvertrags**, und bis
-- heute gab es dafuer keine Zeile. Mit ihr schlagen drei Dinge gleichzeitig
-- um:
--
--  1. **Die Gefahr** geht auf den Auftraggeber ueber (§ 12 Abs. 6 VOB/B).
--  2. **Die Gewaehrleistungsfrist** beginnt zu laufen (§ 13 Abs. 4).
--  3. **Die Faelligkeit** der Schlussrechnung entsteht (§ 16 Abs. 3).
--
-- Und ein Anspruch ERLISCHT: nach **§ 11 Abs. 4 VOB/B** verfaellt die
-- Vertragsstrafe, wenn sie bei der Abnahme nicht vorbehalten wird. Der
-- Entwurf des Datenmodells fuehrte die Abnahme als zwei Spalten auf
-- `projekt` — ohne Protokoll, ohne Maengelliste und ohne
-- `vorbehalt_vertragsstrafe`. Er hielt damit das Datum fest, an dem der
-- Anspruch verloren ging, und nicht, ob er gewahrt wurde. Genau diese Spalte
-- ist der Grund, warum es diese Tabelle gibt (03-GEWERKE §7.2, review
-- MISSING).
--
-- **Einmalig und nicht loeschbar.** Eine Abnahme wird nicht wiederholt: sie
-- findet statt oder wird verweigert, und beides ist ein Datensatz. Korrigiert
-- wird durch Storno mit Ersatzprotokoll (§1.3), nie durch Aendern — deshalb
-- friert `kern.abnahme_einfrieren()` jede Protokollspalte ab dem Einfuegen
-- ein, und deshalb steht die Tabelle mit `kern.verhindere_loeschung()` im
-- Register.
--
-- **Die Frist rechnet sie NICHT.** `projekt.gewaehrleistung_bis` bleibt NULL.
-- Ob vier Jahre (§ 13 Abs. 4 VOB/B) oder fuenf (§ 634a BGB) gelten, haengt am
-- Vertragsregime, und ob BGB-Bauvertraege ueberhaupt vorkommen, ist offen
-- (O-154). Ein gerechnetes Datum waere hier eine erfundene Rechtsfolge: eine
-- Frist, die ein Jahr zu kurz notiert ist, laesst einen Anspruch verjaehren,
-- und das faellt erst auf, wenn er geltend gemacht werden soll. Die Ableitung
-- liegt hinter der Schnittstelle `GewaehrleistungsFrist` in
-- `src/server/services/bau/abnahme.ts` — ein benannter Platzhalter, sichtbar
-- in der Oberflaeche, statt eines plausiblen Datums in der Spalte.

-- ---------------------------------------------------------------------------
-- 1. Das Protokoll
-- ---------------------------------------------------------------------------

create table abnahme (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,
  /** Denormalisiert fuer die Kundendecke (§1.8) — VOM KOPF, nie Eingabe. */
  kunde_id      uuid not null,

  art           bau_abnahme_art not null,
  /** Berliner Kalendertag (K-11) — der Tag, an dem abgenommen wurde. */
  abnahme_am    date not null,
  /** SERVERZEIT (Invariante 5): wann das Protokoll entstand, nicht wann es datiert ist. */
  protokolliert_am timestamptz not null default now(),

  /** Bei `teilabnahme`: WELCHER Teil. Ohne ihn misst die Teilabnahme nichts. */
  leistungsumfang text,

  /**
   * **§ 11 Abs. 4 VOB/B — die Spalte, um die es geht.**
   *
   * `not null default false` und nicht nullbar: „nicht vorbehalten" ist eine
   * Tatsache mit Rechtsfolge (der Anspruch ist weg) und nicht eine fehlende
   * Angabe. Ein NULL hier liesse offen, ob niemand gefragt hat oder ob
   * niemand vorbehalten hat — und das ist der Unterschied zwischen einem
   * Protokoll und einer Notiz.
   */
  vorbehalt_vertragsstrafe boolean not null default false,
  /** § 12 Abs. 3 VOB/B: Vorbehalt wegen bekannter Maengel. */
  vorbehalt_maengel boolean not null default false,
  /** Der Vorbehalt im protokollierten Wortlaut — nie eine Zusammenfassung. */
  vorbehalt_text text,

  /**
   * Eine Abnahme kann VERWEIGERT werden (§ 12 Abs. 3 VOB/B), und die
   * Verweigerung ist ein vollwertiger Datensatz. Kein Vorgabewert: wer eine
   * Abnahme protokolliert, sagt ausdruecklich, ob sie erfolgt ist.
   */
  abgenommen    boolean not null,
  verweigerung_grund text,

  /** Wer teilgenommen hat, auf beiden Seiten (§ 12 Abs. 4 Nr. 1). */
  teilnehmer    jsonb not null default '[]'::jsonb,
  /** Das unterschriebene Protokoll als Datei — NULL, solange kein Speicher verbunden ist. */
  dokument_id   uuid,

  /** Das Protokoll, wie es beim Unterschreiben angezeigt wurde (§1.15). */
  snapshot      jsonb not null,
  snapshot_hash text not null,

  /** §1.14 — GoBD/§ 147 AO: das Protokoll traegt die Aufbewahrung des Projekts. */
  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  /** §1.3 — die Stornoseite. Korrigiert wird durch ERSETZEN. */
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  -- Auditblock (§1.2)
  erstellt_am   timestamptz not null default now(),
  erstellt_von_art akteur_art not null default 'mensch',
  erstellt_von  uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint abnahme_mandant_uk unique (mandant_id, id),
  /** §1.4: als FK-Ziel fuer `abnahme_mangel`, MIT dem Projekt in der Kette. */
  constraint abnahme_projekt_uk unique (mandant_id, projekt_id, id),
  constraint abnahme_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint abnahme_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint abnahme_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint abnahme_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references abnahme (mandant_id, id),

  /** 03-GEWERKE §7.2 woertlich: eine Verweigerung ohne Grund ist keine. */
  constraint abnahme_verweigerung_begruendet check (
    abgenommen or verweigerung_grund is not null),
  /**
   * Eine Teilabnahme ohne benannten Leistungsumfang laesst offen, WAS
   * abgenommen wurde — und damit auch, fuer welchen Teil Gefahr und Frist
   * umschlagen. Das ist keine erfundene Geschaeftsregel, sondern § 12 Abs. 2
   * VOB/B: abgenommen werden „in sich abgeschlossene Teile der Leistung",
   * und welcher Teil das war, steht im Protokoll oder nirgends.
   */
  constraint abnahme_teil_benannt check (
    art <> 'teilabnahme' or (leistungsumfang is not null
                             and btrim(leistungsumfang) <> '')),
  /**
   * Ein Vorbehalt ohne Wortlaut ist im Streit nichts wert: § 11 Abs. 4
   * verlangt die ERKLAERUNG, nicht ein Haekchen.
   */
  constraint abnahme_vorbehalt_wortlaut check (
    (not vorbehalt_vertragsstrafe and not vorbehalt_maengel)
    or (vorbehalt_text is not null and btrim(vorbehalt_text) <> '')),
  constraint abnahme_teilnehmer_liste check (jsonb_typeof(teilnehmer) = 'array'),
  constraint abnahme_hash_form check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint abnahme_storno_paarweise check (
    (storniert_am is null) = (storniert_von is null)),
  constraint abnahme_storno_begruendet check (
    storniert_am is null or btrim(coalesce(storno_grund, '')) <> ''),
  constraint abnahme_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index abnahme_projekt_idx on abnahme (mandant_id, projekt_id, abnahme_am desc);

/**
 * **Der Bericht, der eine verfallene Vertragsstrafe sichtbar macht** — das
 * Praedikat aus 03-GEWERKE §7.2. Eine abgenommene Leistung ohne Vorbehalt
 * ist der Regelfall und darf trotzdem auffindbar sein: genau hier ist ein
 * Anspruch untergegangen, und ohne diesen Index findet ihn niemand mehr.
 */
create index abnahme_strafe_idx on abnahme (mandant_id, abnahme_am)
  where abgenommen and not vorbehalt_vertragsstrafe;

/**
 * **Einmalig.** Je Projekt gibt es genau EINE wirksame Abnahme der
 * Gesamtleistung.
 *
 * Das Praedikat ist bewusst dreiteilig: eine VERWEIGERTE Abnahme sperrt die
 * spaetere wirksame nicht (sonst waere die Verweigerung eine Falle statt
 * eines Protokolls), eine `teilabnahme` sperrt gar nichts (§ 12 Abs. 2
 * erlaubt mehrere), und ein Storno gibt den Platz frei — weil das Storno
 * genau dafuer da ist.
 */
create unique index abnahme_gesamt_uk on abnahme (mandant_id, projekt_id)
  where abgenommen and art <> 'teilabnahme' and storniert_am is null;

comment on table abnahme is
  '§ 12 VOB/B (03-GEWERKE §7.2): das Abnahmeprotokoll. Mit ihr schlagen '
  'Gefahr, Gewaehrleistungsfrist und Faelligkeit um; ohne '
  'vorbehalt_vertragsstrafe verfaellt die Vertragsstrafe (§ 11 Abs. 4). '
  'Einmalig je Projekt, unveraenderlich, korrigiert durch Storno mit Ersatz.';

comment on column abnahme.vorbehalt_vertragsstrafe is
  '§ 11 Abs. 4 VOB/B. Der Anspruch auf die Vertragsstrafe verfaellt, wenn er '
  'bei der Abnahme nicht vorbehalten wird — deshalb wird BEIDES aufgezeichnet, '
  'der Vorbehalt und sein Fehlen.';

comment on column abnahme.snapshot is
  '§1.15: das Protokoll, wie es beim Unterschreiben auf dem Bildschirm stand — '
  'mit Maengelliste und Teilnehmern. Frisch gejointe Zeilen zeigten im '
  'Streitfall die heutigen Daten neben einer Unterschrift von damals.';

-- ---------------------------------------------------------------------------
-- 2. Die Maengelliste
-- ---------------------------------------------------------------------------

create table abnahme_mangel (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  abnahme_id    uuid not null,
  /** Denormalisiert fuer die FK-Kette und die Decke — VOM KOPF. */
  projekt_id    uuid not null,
  kunde_id      uuid not null,
  /** §1.4: die Position, auf die sich der Mangel bezieht — im selben Projekt. */
  lv_position_id uuid,

  reihenfolge   smallint not null default 0,
  beschreibung  text not null,
  /** Die im Protokoll festgehaltene Frist zur Beseitigung (§ 13 Abs. 5). */
  frist_am      date,
  behoben_am    date,
  /** Ein Mangel wird zur verfolgten Reklamation (§8.2). */
  reklamation_id uuid,

  -- Auditblock (§1.2)
  erstellt_am   timestamptz not null default now(),
  erstellt_von_art akteur_art not null default 'mensch',
  erstellt_von  uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint abnahme_mangel_mandant_uk unique (mandant_id, id),
  constraint am_abnahme_fk foreign key (mandant_id, projekt_id, abnahme_id)
    references abnahme (mandant_id, projekt_id, id),
  constraint am_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint am_lv_position_fk foreign key (mandant_id, projekt_id, lv_position_id)
    references lv_position (mandant_id, projekt_id, id),
  constraint am_reklamation_fk foreign key (mandant_id, reklamation_id)
    references reklamation (mandant_id, id),
  constraint am_reihenfolge_uk unique (abnahme_id, reihenfolge)
    deferrable initially immediate,
  constraint am_beschreibung_gefuellt check (btrim(beschreibung) <> ''),
  /** Behoben, bevor der Mangel aufgenommen wurde, ist keine Behebung. */
  constraint am_behoben_nach_frist check (
    behoben_am is null or frist_am is null or behoben_am >= frist_am - 3650),
  constraint am_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index abnahme_mangel_kopf_idx on abnahme_mangel (abnahme_id, reihenfolge);

/** Die Fristwache (NOT-01): welcher Mangel ist offen und wann laeuft er ab? */
create index abnahme_mangel_offen_idx on abnahme_mangel (mandant_id, frist_am)
  where behoben_am is null;

comment on table abnahme_mangel is
  '03-GEWERKE §7.3: ein bei der Abnahme aufgenommener Mangel mit seiner '
  'Beseitigungsfrist. Er entsteht MIT dem Protokoll (siehe '
  'kern.abnahme_mangel_erben) und wird spaeter nur noch als behoben gemeldet '
  'oder zur Reklamation gemacht.';

-- ---------------------------------------------------------------------------
-- 3. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `protokolliert_am` gehoert dem Server (Invariante 5, TIM-08).
 *
 * **Eine eigene Funktion und nicht `kern.erzwinge_serverzeit()`**: die ist
 * auf den Spaltennamen `eingegangen_am` festgeschrieben (0016), und
 * 0017/0028 haben fuer genau diese Lage ihre eigene daneben gestellt. Ein
 * `default now()` allein greift nur, wenn die Spalte WEGGELASSEN wird — ein
 * INSERT, der einen Zeitpunkt mitschickt, datierte das Protokoll frei, und
 * der Einfrierer darunter machte diese Datierung dauerhaft.
 *
 * `abnahme_am` bleibt dagegen Eingabe: die Abnahme kann am Freitag
 * stattgefunden und am Montag protokolliert worden sein. Beide Daten stehen
 * deshalb nebeneinander, und keines ersetzt das andere.
 */
create function kern.abnahme_serverzeit() returns trigger
language plpgsql as $$
begin
  new.protokolliert_am := now();
  return new;
end $$;

create trigger trg_abnahme_1_serverzeit
  before insert on abnahme
  for each row execute function kern.abnahme_serverzeit();

/**
 * `kunde_id` kommt VOM PROJEKT — dieselbe Bauart wie
 * `kern.aufmass_kind_erben()` (0072, §1.8).
 *
 * Waere sie Eingabe, koennte ein Protokoll behaupten, zu einem anderen Kunden
 * zu gehoeren als sein Projekt — und genau darauf ruhen die Kundendecke und
 * `t_kunde`, die aus gutem Grund nicht ueber den Elternteil joinen.
 */
create function kern.abnahme_kunde_erben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare p record;
begin
  select pr.kunde_id into p
    from public.projekt pr
   where pr.id = new.projekt_id and pr.mandant_id = new.mandant_id;
  if p.kunde_id is null then
    raise exception 'Zu dieser Abnahme gibt es kein Projekt in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  new.kunde_id := p.kunde_id;
  return new;
end $$;

create trigger trg_abnahme_2_erben
  before insert or update on abnahme
  for each row execute function kern.abnahme_kunde_erben();

/**
 * **Das Protokoll ist ab dem Einfuegen unveraenderlich** (§1.15).
 *
 * `snapshot_hash` ist `not null`, also ist jede Zeile von der ersten Sekunde
 * an gesiegelt — ein „ab Unterschrift" gibt es hier nicht, weil eine Abnahme
 * ohne Protokoll keine ist. Beweglich bleiben genau fuenf Spalten, jede aus
 * einem Grund: die Stornoseite, weil Korrektur durch Ersetzen laeuft;
 * `aufbewahrung_bis`/`loeschsperre`, weil `job:aufbewahrung` sie
 * fortschreibt (§1.14); der Auditstempel.
 *
 * Der Vergleich laeuft ueber `is distinct from` und nicht `<>`: bei NULL
 * ergaebe `<>` NULL, die Bedingung waere nicht wahr, und eine Aenderung von
 * NULL auf einen Wert ginge lautlos durch — also genau der Fall, um den es
 * geht.
 */
create function kern.abnahme_einfrieren() returns trigger
language plpgsql as $$
begin
  if new.art                      is distinct from old.art
     or new.projekt_id            is distinct from old.projekt_id
     or new.kunde_id              is distinct from old.kunde_id
     or new.abnahme_am            is distinct from old.abnahme_am
     or new.protokolliert_am      is distinct from old.protokolliert_am
     or new.leistungsumfang       is distinct from old.leistungsumfang
     or new.vorbehalt_vertragsstrafe is distinct from old.vorbehalt_vertragsstrafe
     or new.vorbehalt_maengel     is distinct from old.vorbehalt_maengel
     or new.vorbehalt_text        is distinct from old.vorbehalt_text
     or new.abgenommen            is distinct from old.abgenommen
     or new.verweigerung_grund    is distinct from old.verweigerung_grund
     or new.teilnehmer            is distinct from old.teilnehmer
     or new.snapshot              is distinct from old.snapshot
     or new.snapshot_hash         is distinct from old.snapshot_hash then
    raise exception 'Ein Abnahmeprotokoll ist unveraenderlich'
      using errcode = 'restrict_violation',
            detail  = 'Protokolliert am ' || old.protokolliert_am || ' (§1.15).',
            hint    = 'Korrigiert wird durch Stornieren und ein Ersatzprotokoll '
                      || '(ersetzt_durch_id), nie durch Aendern (§ 12 VOB/B, LEG-01).';
  end if;
  return new;
end $$;

create trigger trg_abnahme_3_einfrieren
  before update on abnahme
  for each row execute function kern.abnahme_einfrieren();

/**
 * **Der Projektstatus folgt der Abnahme** (03-GEWERKE §7.2).
 *
 * Nur die erste WIRKSAME Abnahme der Gesamtleistung schlaegt ihn um: eine
 * `teilabnahme` laesst den Rest der Leistung offen, eine Verweigerung ist
 * das Gegenteil einer Abnahme, und ein bereits abgeschlossenes oder
 * archiviertes Projekt wird nicht zurueckgesetzt — das waere eine Regression
 * im Lebenslauf.
 *
 * **Kein `security definer`, und das ist Absicht.** `projekt` traegt fuer
 * `cse_app` eine UPDATE-Policy (`t_mandant`, 0071), und wer ein
 * Abnahmeprotokoll schreibt, haelt `bau.schreiben` — die Policy greift also.
 * Damit laeuft der Ausloeser unter den Rechten des Menschen, der ihn
 * ausgeloest hat, und nicht unter erhoehten. Trifft er trotzdem keine Zeile,
 * WIRFT er: ein UPDATE ohne passende Policy aendert null Zeilen und meldet
 * Erfolg, und dann stuende das Projekt dauerhaft auf `in_arbeit`, ohne dass
 * jemand einen Fehler saehe.
 */
create function kern.abnahme_projekt_status() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_status text;
begin
  if not new.abgenommen or new.art = 'teilabnahme' then return null; end if;

  select pr.status::text into v_status
    from public.projekt pr
   where pr.id = new.projekt_id and pr.mandant_id = new.mandant_id;

  if v_status is distinct from 'geplant' and v_status is distinct from 'in_arbeit' then
    return null;
  end if;

  update public.projekt pr
     set status = 'abgenommen'
   where pr.id = new.projekt_id and pr.mandant_id = new.mandant_id
     and pr.status in ('geplant', 'in_arbeit');
  if not found then
    raise exception 'Der Projektstatus liess sich nicht auf abgenommen setzen'
      using errcode = 'insufficient_privilege',
            hint    = 'Die Abnahme wird von der Rolle geschrieben, die auch das '
                      || 'Projekt fortschreiben darf (bau.schreiben).';
  end if;
  return null;
end $$;

create trigger trg_abnahme_9_projekt_status
  after insert on abnahme
  for each row execute function kern.abnahme_projekt_status();

/**
 * Ein Mangel gehoert ZU SEINEM PROTOKOLL — und zwar in dieselbe Transaktion.
 *
 * `projekt_id` und `kunde_id` kommen vom Kopf und sind keine Eingabe (§1.8).
 * Und ein NACHGETRAGENER Mangel wird abgewiesen: das Protokoll ist gesiegelt,
 * sein `snapshot` enthaelt die Maengelliste, wie sie unterschrieben wurde.
 * Eine Zeile, die danach dazukommt, stuende in der Tabelle und nicht im
 * Siegel — zwei Maengellisten zu einem Protokoll, von denen die Oberflaeche
 * die eine und der Beweis die andere zeigt.
 *
 * Erkannt wird das an `now()`: `kern.abnahme_serverzeit()` stempelt
 * `protokolliert_am` mit dem Transaktionsbeginn, und der ist innerhalb
 * derselben Transaktion derselbe Wert. Ein Kopf aus einer frueheren
 * Transaktion hat damit immer eine frueheres `protokolliert_am` als `now()`.
 */
create function kern.abnahme_mangel_erben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare k record;
begin
  select a.projekt_id, a.kunde_id, a.protokolliert_am, a.storniert_am into k
    from public.abnahme a
   where a.id = new.abnahme_id and a.mandant_id = new.mandant_id;
  if k.projekt_id is null then
    raise exception 'Zu diesem Mangel gibt es kein Abnahmeprotokoll in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  new.projekt_id := k.projekt_id;
  new.kunde_id   := k.kunde_id;

  if tg_op = 'INSERT' and k.protokolliert_am <> now() then
    raise exception 'Ein Mangel wird MIT dem Abnahmeprotokoll aufgenommen, nicht danach'
      using errcode = 'restrict_violation',
            detail  = 'Das Protokoll ist seit ' || k.protokolliert_am || ' gesiegelt.',
            hint    = 'Ein nachtraeglich entdeckter Mangel ist eine Reklamation '
                      || '(§ 13 VOB/B) oder ein Ersatzprotokoll nach Storno — nie '
                      || 'eine Zeile neben einem Siegel, das sie nicht enthaelt.';
  end if;
  return new;
end $$;

create trigger trg_abnahme_mangel_1_erben
  before insert or update on abnahme_mangel
  for each row execute function kern.abnahme_mangel_erben();

/**
 * Am Mangel bewegen sich genau zwei Dinge: ob er behoben ist und ob daraus
 * eine verfolgte Reklamation wurde. Alles andere stand im Protokoll.
 */
create function kern.abnahme_mangel_einfrieren() returns trigger
language plpgsql as $$
begin
  if new.abnahme_id      is distinct from old.abnahme_id
     or new.projekt_id   is distinct from old.projekt_id
     or new.kunde_id     is distinct from old.kunde_id
     or new.lv_position_id is distinct from old.lv_position_id
     or new.reihenfolge  is distinct from old.reihenfolge
     or new.beschreibung is distinct from old.beschreibung
     or new.frist_am     is distinct from old.frist_am then
    raise exception 'Ein protokollierter Mangel ist unveraenderlich'
      using errcode = 'restrict_violation',
            hint    = 'Beweglich sind behoben_am und reklamation_id. Eine andere '
                      || 'Beschreibung oder Frist ist ein Ersatzprotokoll.';
  end if;
  return new;
end $$;

create trigger trg_abnahme_mangel_3_einfrieren
  before update on abnahme_mangel
  for each row execute function kern.abnahme_mangel_einfrieren();

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz — Modul `bau`, Kundendecke auf `kunde_id`
-- ---------------------------------------------------------------------------

alter table abnahme        enable row level security;
alter table abnahme        force  row level security;
alter table abnahme_mangel enable row level security;
alter table abnahme_mangel force  row level security;

create policy t_mandant on abnahme for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on abnahme for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/** CRM-06: der Kunde sieht sein eigenes Abnahmeprotokoll — er war dabei. */
create policy t_kunde on abnahme for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and storniert_am is null);

/**
 * **Zwei Zweige, und der Mitarbeiterzweig fehlt mit Absicht.**
 *
 * Ein Aufmassblatt gehoert der Kraft, die es aufgenommen hat (§1.8, Form A ∪
 * C) — ein Abnahmeprotokoll nicht: es ist die Erklaerung der Vertragsparteien
 * ueber Gefahruebergang, Fristbeginn und Vertragsstrafe. Wer es im
 * Mitarbeiterportal oeffnete, laese die Vorbehalte des Auftraggebers und die
 * Maengelliste seiner eigenen Arbeit. Das gehoert ins Buero und zum Kunden,
 * nicht auf das Baustellentelefon.
 */
create policy p_portal_decke on abnahme as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and storniert_am is null));

create policy t_mandant on abnahme_mangel for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on abnahme_mangel for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_kunde on abnahme_mangel for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_portal_decke on abnahme_mangel as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde' and kunde_id = any (app.aktuelle_kunden())));

grant select, insert, update on abnahme, abnahme_mangel to cse_app;

/** §1.14: `job:aufbewahrung` schreibt die Frist fort und sonst nichts. */
grant select on abnahme to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on abnahme to cse_job;

create policy t_job_aufbewahrung on abnahme for select to cse_job using (true);
create policy t_job_fortschreiben on abnahme for update to cse_job
  using (true) with check (true);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0211)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- abnahme (archiv): BAU-01, OPS-11, LEG-01, FIN-08. Mit der Abnahme schlagen Gefahr, Gewaehrleistungsfrist und Faelligkeit um (§ 12 VOB/B), und ohne vorbehalt_vertragsstrafe verfaellt die Vertragsstrafe (§ 11 Abs. 4). Geloescht bliebe ein Projekt zurueck, das abgenommen ist, ohne dass jemand sagen koennte wann, von wem und unter welchem Vorbehalt. Beendet wird mit storniert_am und einem Ersatzprotokoll.
create trigger trg_abnahme_kein_hard_delete
  before delete on abnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abnahme_kein_truncate
  before truncate on abnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abnahme from cse_app, cse_anon, cse_checkin, cse_job;

-- abnahme_mangel (append): BAU-01, OPS-11, NOT-01. Der bei der Abnahme aufgenommene Mangel mit seiner Beseitigungsfrist. Er steht im gesiegelten Protokoll des Kopfes; eine geloeschte Zeile ergaebe eine Maengelliste, die kuerzer ist als das Siegel darueber — und kein Fristablauf waere mehr nachweisbar.
create trigger trg_abnahme_mangel_kein_hard_delete
  before delete on abnahme_mangel
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abnahme_mangel_kein_truncate
  before truncate on abnahme_mangel
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abnahme_mangel from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_abnahme_geaendert_am
  before update on abnahme
  for each row execute function kern.setze_geaendert_am();
create trigger trg_abnahme_mangel_geaendert_am
  before update on abnahme_mangel
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
