-- 0151 · Der Wissensindex (AGT-06) — und warum er leer bleibt
--
-- **Die gefährlichste Tabelle dieses Systems.** Sie enthält Passagen aus
-- Verträgen, Objektakten, Angeboten und Korrespondenz — je Gesellschaft, und
-- eine Ähnlichkeitssuche kennt von sich aus keine Mandantengrenze: ein
-- `order by embedding <=> $1 limit 10` ohne Filter liefert fröhlich den
-- Vertrag der Schwestergesellschaft, weil er inhaltlich ähnlich ist. Deshalb
-- steht `mandant_id` hier im PRIMARY KEY, in jeder Policy und in jeder
-- Abfrage — und `vertraulichkeit` steht auf `vertraulich`, bis ein Mensch
-- etwas anderes sagt.
--
-- **Und deshalb bleibt er leer, solange kein Anbieter bestätigt ist.** Ohne
-- Einbettungsmodell gibt es keine Vektoren. Ein Index aus Nullvektoren oder
-- aus einem lokal gewürfelten Ersatz wäre der schlimmste Platzhalter, den
-- diese Plattform kennt: die Suche liefert Treffer, sie sehen plausibel aus,
-- und dass ihre Reihenfolge Zufall ist, merkt niemand.
--
-- **Die Dimension ist Schema, keine Einstellung.** 1536 steht in der Spalte
-- und in einem CHECK. Ein Modellwechsel ist eine Migration plus vollständiger
-- Neuaufbau — zwei Vektoren aus verschiedenen Modellen im selben Index sind
-- kein Index.

create extension if not exists vector;

create type wissens_quelle_typ as enum ('vertrag', 'objekt', 'angebot', 'korrespondenz');

comment on type wissens_quelle_typ is
  'AGT-06, genau die vier. Ein fuenfter Typ waere eine Entscheidung darueber, was ein Agent '
  'lesen darf — und die trifft keine Migration nebenbei.';

create type vertraulichkeit as enum ('normal', 'vertraulich');

create table wissens_chunk (
  mandant_id        uuid not null references mandant(id),
  id                uuid not null default gen_random_uuid(),

  quelle_typ        wissens_quelle_typ not null,
  /** Polymorph, deshalb ohne Fremdschlüssel (§7.2) — die Tabelle steht daneben. */
  quelle_id         uuid not null,
  quelle_tabelle    text not null check (quelle_tabelle ~ '^[a-z][a-z0-9_]*$'),
  dokument_id       uuid,

  chunk_index       integer not null check (chunk_index >= 0),
  /** Die eingebettete Passage — sie wird als Beleg zurückgegeben (APR-03). */
  text              text not null check (length(btrim(text)) > 0),
  seite             integer check (seite is null or seite > 0),
  token_anzahl      integer check (token_anzahl is null or token_anzahl > 0),

  embedding         vector(1536) not null,
  embedding_modell  text not null,
  embedding_dim     integer not null,

  /**
   * **Vorgabe `vertraulich`, nicht `normal`.** Wer eine Passage für
   * unbedenklich hält, sagt es ausdrücklich und steht mit Namen daneben. Die
   * andere Richtung — alles ist normal, bis jemand widerspricht — verliert
   * beim ersten vergessenen Widerspruch einen Vertrag an einen Agenten, der
   * ihn zitieren darf.
   */
  vertraulichkeit   vertraulichkeit not null default 'vertraulich',
  klassifiziert_von uuid references benutzer(id),
  klassifiziert_am  timestamptz,

  /** Woraus der Text stammte, als er eingebettet wurde — für den Neuaufbau. */
  quell_hash        text not null,
  eingebettet_am    timestamptz not null default now(),
  erstellt_am       timestamptz not null default now(),
  geaendert_am      timestamptz,

  /**
   * **`primary key (mandant_id, id)`** — die Abweichung, die K-16(a) erlaubt,
   * und der Fall, den die Konvention beim Namen nennt. Sie IST zugleich das
   * `unique (mandant_id, id)`, das S5 verlangt.
   */
  constraint wissens_chunk_pk primary key (mandant_id, id),
  constraint wc_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint wc_dimension_stimmt check (vector_dims(embedding) = embedding_dim),
  constraint wc_dimension_ist_1536 check (embedding_dim = 1536),
  /** Eine Herabstufung trägt den Namen dessen, der sie vornimmt. */
  constraint wc_klassifikation_belegt check (
    vertraulichkeit = 'vertraulich'
    or (klassifiziert_von is not null and klassifiziert_am is not null)),
  constraint wc_quelle_uk unique (mandant_id, quelle_typ, quelle_id, chunk_index)
);

create index wc_quelle_idx on wissens_chunk (mandant_id, quelle_typ, quelle_id);
create index wc_frische_idx on wissens_chunk (mandant_id, eingebettet_am desc);

/**
 * **Kein Vektorindex, solange die Tabelle leer ist.**
 *
 * `ivfflat` verlangt Zeilen zum Trainieren der Listen; auf einer leeren
 * Tabelle angelegt, ist er ein Index auf null Clustern und muss nach dem
 * ersten Aufbau ohnehin neu gebaut werden. `hnsw` ginge auch leer, kostet
 * aber Schreibzeit für Daten, die es nicht gibt. Der Index gehört in den
 * Schritt, in dem der erste echte Aufbau läuft — und dann mit einer
 * Listenzahl, die zur Zeilenzahl passt.
 *
 * -- TODO(client) [O-15]: entfaellt hier; die offene Frage ist der Anbieter,
 * -- nicht die Indexart. Siehe `src/server/config/rag.ts`.
 */

comment on table wissens_chunk is
  'AGT-06. Der Vektorindex je Gesellschaft ueber Vertraege, Objekte, Angebote und '
  'Korrespondenz. Leer, solange kein Einbettungsanbieter bestaetigt ist (D-04, D-496).';
comment on column wissens_chunk.vertraulichkeit is
  'Vorgabe vertraulich. Eine Herabstufung ist eine Handlung mit Namen und Zeitpunkt.';

create trigger trg_wc_geaendert before update on wissens_chunk
  for each row execute function kern.setze_geaendert_am();

alter table wissens_chunk enable row level security;
alter table wissens_chunk force  row level security;

/**
 * **Lesen nur mit aktivem Mandanten — und ohne Gruppenansicht.**
 *
 * Es gibt hier mit Absicht KEINE `t_gruppe`-Policy. Eine gruppenweite
 * Ähnlichkeitssuche über die Verträge aller vier Gesellschaften ist genau der
 * Abfluss, den die Trennung verhindern soll: „zeig mir ähnliche Klauseln"
 * wäre dann „zeig mir den Vertrag der Schwester".
 */
create policy t_wissen_lesen on wissens_chunk for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('agent.lesen', app.aktiver_mandant()));
create policy p_intern_ceiling on wissens_chunk as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/** Gebaut wird der Index vom Job, nie von der Anwendungsrolle. */
create policy j_wissens_chunk on wissens_chunk for all to cse_job
  using (true) with check (true);

grant select on wissens_chunk to cse_app;
grant select, insert, update, delete on wissens_chunk to cse_job;

/**
 * Die Herabstufung ist eine eigene Handlung mit eigenem Recht — sie gibt eine
 * Vertragspassage für die Zitierung durch einen Agenten frei.
 */
grant update (vertraulichkeit, klassifiziert_von, klassifiziert_am, geaendert_am)
  on wissens_chunk to cse_app;
create policy t_wissen_klassifizieren on wissens_chunk for update to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('agent.werkzeug_verbinden', app.aktiver_mandant()));
