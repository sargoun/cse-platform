-- 0148 · Der Fristenwächter und die Trefferbenachrichtigung (SPEC §14, RAD-08)
--
-- **Zwei Wächter, ein Tisch.** SPEC §14 nennt „Tender deadline < 5 days,
-- untouched → notify owner"; RAD-08 nennt „Notification above a score
-- threshold". Beide melden über dieselbe Bekanntmachung an denselben
-- Menschen, und beide dürfen das genau EINMAL tun — sonst steht am vierten
-- Tag vor der Abgabe zum vierten Mal dieselbe Zeile im Posteingang, und
-- spätestens beim dritten Mal liest sie niemand mehr.
--
-- **Die Quittung ist der Tisch, nicht ein Vermerk an der Bekanntmachung.**
-- Eine Spalte `gewarnt_am` an `ausschreibung` wäre falsch gelegen: die
-- Bekanntmachung gehört keiner Gesellschaft (0145), die Warnung schon. Vier
-- Gesellschaften warnen unabhängig voneinander, und die Reinigung soll nicht
-- deshalb keine Warnung bekommen, weil der Bau gestern schon eine hatte.
--
-- **Der Schnappschuss der Frist steht mit drin.** Verschiebt die
-- Vergabestelle die Abgabe, ist das eine NEUE Lage und eine neue Warnung —
-- dieselbe Überlegung wie bei `nachweis_warnung.gueltig_bis` (0030). Ohne
-- ihn wäre die einmalige Warnung eine Warnung für immer, auch wenn die
-- Verlängerung die Sache erst wieder machbar macht.

create type radar_warnung_art as enum ('frist_knapp', 'treffer');

comment on type radar_warnung_art is
  'SPEC §14 / RAD-08. frist_knapp: die Abgabe rueckt heran und niemand hat den Vorgang '
  'angefasst. treffer: die Punktzahl erreicht die Schwelle, die ein Empfaenger gesetzt hat.';

create table radar_warnung (
  id               uuid primary key default gen_random_uuid(),
  mandant_id       uuid not null references mandant(id),

  ausschreibung_id uuid not null references ausschreibung(id),
  empfaenger_id    uuid not null references benutzer(id),
  art              radar_warnung_art not null,

  /**
   * Die Frist, auf die sich die Warnung bezieht. `null` bei einem Treffer:
   * dort entscheidet die Punktzahl, nicht die Uhr — und eine Bekanntmachung
   * ohne Frist (OCDS lässt sie oft weg) soll trotzdem einmal melden dürfen.
   */
  frist_angebot    timestamptz,
  /** Womit gemeldet wurde — damit im Nachhinein nachvollziehbar ist, warum. */
  punkte           integer,
  ab_punkte        integer,
  rest_tage        integer,

  /** Serveruhr (Invariante 5): der Meldezeitpunkt ist keine Angabe des Aufrufers. */
  ausgeloest_am    timestamptz not null default now(),
  erstellt_am      timestamptz not null default now(),

  constraint rw_mandant_uk unique (mandant_id, id)
);

/**
 * **Der eigentliche Zweck des Tisches.** Eine Bekanntmachung, ein Empfänger,
 * eine Art, eine Frist — einmal. Ein Teilindex mit `coalesce` und nicht die
 * Spalte selbst, weil `null` in einem Eindeutigkeitsschlüssel nicht gleich
 * `null` ist: eine Bekanntmachung ohne Frist dürfte sonst beliebig oft melden.
 */
create unique index rw_einmal on radar_warnung
  (ausschreibung_id, empfaenger_id, art, coalesce(frist_angebot, 'epoch'::timestamptz));
create index rw_mandant_idx on radar_warnung (mandant_id, ausgeloest_am desc);

comment on table radar_warnung is
  'SPEC §14, RAD-08, NOT-01. Die Quittung einer Radarwarnung: wem wurde was gemeldet, und '
  'zu welcher Frist. Sie verhindert die zweite Meldung derselben Lage.';

/**
 * Der Empfänger gehört zu dieser Gesellschaft — dieselbe Prüfung wie in 0146,
 * aus demselben Grund: `benutzer` ist global, und ein Fremdschlüssel allein
 * hat noch nie eine Mitgliedschaft geprüft.
 */
create trigger trg_rw_empfaenger_im_mandant
  before insert or update on radar_warnung
  for each row execute function kern.radar_benutzer_im_mandant('empfaenger_id');

alter table radar_warnung enable row level security;
alter table radar_warnung force  row level security;

/**
 * Lesen darf, wer den Radar liest — die Quittung ist der Beleg dafür, dass
 * gemeldet WURDE, und genau das ist die Frage, wenn jemand sagt, er habe
 * nichts gehört.
 */
create policy t_warnung_lesen on radar_warnung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy p_intern_ceiling on radar_warnung as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');
/** Geschrieben wird sie ausschliesslich vom Waechter. */
create policy j_radar_warnung on radar_warnung for all to cse_job
  using (true) with check (true);

grant select on radar_warnung to cse_app, cse_job;
grant insert on radar_warnung to cse_job;

/**
 * **Der Slug der Gesellschaft — und warum er dem Wächter fehlte.**
 *
 * Eine Benachrichtigung braucht ein Ziel (NOT-03), und ein Portalziel trägt
 * das Segment `[mandant]` als SLUG, nicht als Kennung — eine Adresse aus der
 * uuid führte auf 404. Der Wächter muss ihn also lesen können, und `cse_job`
 * hatte auf `mandant` weder Recht noch Policy: der erste nächtliche Lauf wäre
 * an „permission denied for table mandant" gestorben, nachdem alles andere
 * längst grün war. Gefunden hat es der Isolationstest, der den Lauf unter der
 * ECHTEN Jobrolle fährt statt als Eigentümer.
 *
 * Es ist ein SPALTENrecht: `id` und `slug`, mehr braucht niemand, der eine
 * Adresse baut. Steuernummer, Handelsregister und Geschäftsführer stehen in
 * derselben Zeile und gehen einen Wächter nichts an.
 */
create policy j_mandant_lesen on mandant for select to cse_job using (true);
grant select (id, slug) on mandant to cse_job;

/**
 * **Mehr braucht der Wächter nicht.** `ausschreibung`, `ausschreibung_vorgang`,
 * `radar_profil` und `radar_profil_empfaenger` liest `cse_job` bereits (0145),
 * und `benachrichtigung` schreibt er über die Policy aus 0011. Hier kommt nur
 * die Quittung dazu — geprüft, statt vorsichtshalber noch einmal zu granten:
 * ein doppeltes GRANT sagt dem nächsten Leser, hier fehle etwas.
 */
