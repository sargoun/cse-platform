-- 0146 · Was die Prüfrunde am Radar gefunden hat (RAD-04, RAD-07, RAD-09, D-491)
--
-- Sechs Befunde aus der Copilot-Runde auf PR 13, jeder mit demselben Muster:
-- **eine Zusage stand im Kommentar, aber nicht im Schema.** Genau das ist die
-- Sorte Fehler, die spaeter niemand sucht, weil die Dokumentation sagt, es
-- koenne nicht passieren.
--
--   (1) Drei Fremdschluessel auf `benutzer` — eine GLOBALE Tabelle — ohne
--       Mitgliedschaftspruefung. `radar_profil_empfaenger` behauptet in
--       seinem Kommentar sogar, ein Empfaenger aus einem fremden Mandanten
--       sei unmoeglich; der Fremdschluessel allein hat das nie geleistet.
--   (2) `ausschreibung_vorgang.bewertung_id` war nur an denselben Mandanten
--       gebunden, nicht an DIESELBE Bekanntmachung: der Vorgang zu
--       Ausschreibung A konnte die Bewertung von B tragen.
--   (3) Der Empfaengertisch zaehlte die Profilfassung bei INSERT und DELETE
--       hoch, nicht beim Aendern von `ab_punkte`.
--   (4) Die fuenf Referenztische waren nur mit AKTIVEM Mandanten lesbar —
--       die Gruppenansicht (`/portal/gruppe/radar`, `gruppe.radar.lesen`)
--       haette null Bekanntmachungen gesehen.
--   (5) Die Schreibpolicy des Plattformkatalogs verlangte Super-Admin, aber
--       nicht das interne Portal — anders als jede Lesepolicy daneben.
--   (6) Der Kommentar in 0145 zaehlte „vier Tabellen ohne Mandant" und
--       beschrieb weiter unten fuenf. Beides stand da; eines war falsch.

-- ---------------------------------------------------------------------------
-- (1) Ein Konto gehört zu dieser Gesellschaft — oder es steht hier nicht
-- ---------------------------------------------------------------------------

/**
 * Dasselbe Muster wie `kern.auftrag_verantwortlich_im_mandant` (0025), aus
 * demselben Grund: das Formular fuellt seine Auswahlliste mandantengefiltert,
 * aber eine Auswahlliste ist keine Grenze — ein von Hand abgeschickter POST
 * setzt jede beliebige id. Geprueft wird beim Anlegen UND beim Umhaengen.
 */
create function kern.radar_benutzer_im_mandant() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare
  v_neu uuid;
  v_alt uuid;
begin
  execute format('select ($1).%I', tg_argv[0]) into v_neu using new;
  if v_neu is null then return new; end if;
  if tg_op = 'UPDATE' then
    execute format('select ($1).%I', tg_argv[0]) into v_alt using old;
    if v_alt is not distinct from v_neu then return new; end if;
  end if;

  if not app.ist_mitglied(v_neu, new.mandant_id) then
    raise exception 'Das Konto gehoert nicht zu dieser Gesellschaft'
      using errcode = 'check_violation',
            detail  = format('%I.%I zeigt auf ein Konto ohne gueltige benutzer_mandant-Zeile '
                             || 'in diesem Mandanten.', tg_table_name, tg_argv[0]),
            hint    = 'Erst die Mitgliedschaft anlegen, dann zuweisen.';
  end if;
  return new;
end $$;

create trigger trg_rpe_empfaenger_im_mandant
  before insert or update on radar_profil_empfaenger
  for each row execute function kern.radar_benutzer_im_mandant('benutzer_id');

create trigger trg_mpr_verantwortlich_im_mandant
  before insert or update on mandant_plattform_registrierung
  for each row execute function kern.radar_benutzer_im_mandant('verantwortlich_benutzer_id');

create trigger trg_av_verantwortlich_im_mandant
  before insert or update on ausschreibung_vorgang
  for each row execute function kern.radar_benutzer_im_mandant('verantwortlich_benutzer_id');

-- ---------------------------------------------------------------------------
-- (2) Eine Bewertung gehört zu DIESER Bekanntmachung
-- ---------------------------------------------------------------------------

/**
 * Der bisherige Fremdschluessel band `bewertung_id` an den Mandanten, nicht an
 * die Bekanntmachung. Ein Vorgang zu Ausschreibung A konnte damit die
 * Bewertung von B tragen — und der Bericht „gefunden · geprueft · geboten ·
 * gewonnen" (REP-06) haette Punkte neben einer Vergabe gezeigt, zu der sie
 * nicht gehoeren. Die Datenbank haelt das jetzt selbst zusammen: der
 * Schluessel traegt die Ausschreibung mit.
 */
alter table bewertung
  add constraint bewertung_je_ausschreibung_uk unique (mandant_id, id, ausschreibung_id);

alter table ausschreibung_vorgang drop constraint av_bewertung_fk;
alter table ausschreibung_vorgang
  add constraint av_bewertung_fk foreign key (mandant_id, bewertung_id, ausschreibung_id)
    references bewertung (mandant_id, id, ausschreibung_id);

-- ---------------------------------------------------------------------------
-- (3) Die Profilfassung zählt auch beim Ändern eines Empfängers
-- ---------------------------------------------------------------------------

/**
 * `ab_punkte` ist die persoenliche Schwelle eines Empfaengers und damit eine
 * Eingabe der Benachrichtigung (RAD-08). Wird sie geaendert, ohne dass die
 * Fassung steigt, benutzt der naechste Lauf denselben `eingaben_hash` — und
 * eine geaenderte Einstellung bliebe ohne Wirkung, ohne dass es auffiele.
 */
create trigger trg_rpe_version_upd after update on radar_profil_empfaenger
  referencing new table as neu old table as alt
  for each statement execute function app.radar_profil_version_bump();

-- ---------------------------------------------------------------------------
-- (4) Die Gruppenansicht liest die öffentlichen Tische auch ohne Mandant
-- ---------------------------------------------------------------------------

/**
 * Die Lesepolicies aus 0145 verlangen `app.aktiver_mandant()`. In der
 * Gruppenansicht ist der NULL (das ist ihr Wesen, D-474), und
 * `/portal/gruppe/radar` haette deshalb null Bekanntmachungen gezeigt — eine
 * leere Seite, die aussieht wie ein ruhiger Markt.
 *
 * Die Gruppenpolicy haengt an `gruppe.radar.lesen` in IRGENDEINER sichtbaren
 * Gesellschaft: die Bekanntmachungen sind oeffentliche Tatsachen, kein
 * Mandantsdatum — wer sie in einer Gesellschaft lesen darf, darf sie lesen.
 * Die BEWERTUNGEN bleiben mandantsgebunden; dort gilt weiter die Policy aus
 * 0145, die je Mandant prueft.
 */
do $$
declare t text;
begin
  foreach t in array array['vergabeplattform', 'ausschreibung', 'ausschreibung_nuts',
                           'ausschreibung_rohdaten', 'radar_ingest_lauf']
  loop
    execute format($p$
      create policy r_gruppe_lesen on %I for select to cse_app
        using (app.portal() = 'intern' and app.ist_gruppenansicht()
               and cardinality(app.rechte_mandanten('gruppe.radar.lesen')) > 0)$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- (5) Auch der Katalog wird nur aus dem internen Portal geschrieben
-- ---------------------------------------------------------------------------

/**
 * Die Lesepolicy daneben verlangt `app.portal() = 'intern'`, die Schreibpolicy
 * verlangte es nicht. Eine Super-Administration im Kunden- oder
 * Personenportal haette den gruppenweiten Katalog aendern koennen — ein
 * Unterschied ohne Grund, und Unterschiede ohne Grund sind die, die jemand
 * findet.
 */
drop policy r_plattform_schreiben on vergabeplattform;
create policy r_plattform_schreiben on vergabeplattform for all to cse_app
  using      (app.portal() = 'intern' and app.ist_super_admin() and not app.ist_readonly())
  with check (app.portal() = 'intern' and app.ist_super_admin() and not app.ist_readonly());

-- ---------------------------------------------------------------------------
-- (6) Der Kommentar sagt jetzt, was das Schema tut
-- ---------------------------------------------------------------------------

comment on table radar_ingest_lauf is
  'RAD-01, RAD-02. Ein Lauf je Quelle — die Evidenz, dass der Radar lief. Eine leere Quelle '
  'ist ein Ausschlag in saetze_gelesen, kein Schweigen. FUENFTER Referenztisch ohne Mandant: '
  'ein Einlesevorgang gehoert keiner Gesellschaft (0145 zaehlte im Kopf vier und meinte fuenf).';

comment on table radar_profil_empfaenger is
  'RAD-08, NOT-01. Empfaenger einer Radar-Benachrichtigung. Der Fremdschluessel allein haelt '
  'die Gesellschaft NICHT zusammen — das tut trg_rpe_empfaenger_im_mandant (0146).';
