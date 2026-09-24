-- ===========================================================================
-- 0405 — Die Wiedervorlage erinnert, wenn jemand es verlangt (V-146, CRM-04,
--        NOT-01, D-640)
-- ===========================================================================
-- **Der Befund.** Lead- und Kontaktblatt bieten das Feld Erinnerung an, und
-- lead_aktivitaet.erinnerung_am wird geschrieben und beim Verschieben
-- mitgefuehrt (0017, services/crm/wiedervorlage.ts). Gelesen hat den Wert
-- niemand: kein Lauf, keine Benachrichtigungsart, kein Kalenderalarm. Wer
-- eine Erinnerung eintrug, bekam keine — die Wiedervorlage erschien nur, wenn
-- jemand von sich aus die Liste oeffnete.
--
-- **Was hier entsteht.**
--   1. Das Gedaechtnis: erinnert_am. Ohne es erinnerte ein Lauf alle
--      fuenfzehn Minuten erneut an dieselbe Wiedervorlage.
--   2. Die Rechte des Laufs wiedervorlage_erinnerung. Er laeuft je Mandant
--      unter cse_job mit gebundenem Mandanten (jobs/sitzung.ts,
--      alsJobSitzung) und bekam bisher auf lead_aktivitaet nur insert
--      (0017, t_aktivitaet_job). Er braucht die Spalten, die er waehlt und
--      zurueckgibt, und schreibt genau eine: erinnert_am.
--   3. Ein Teilindex auf genau die Frage des Laufs.
--
-- Die Policies haengen an app.aktiver_mandant() und NICHT an using (true):
-- der Lauf ist je_mandant, und eine Policy, die ueber die Mandantengrenze
-- hinweg liest, waere eine Entscheidung, die hier niemand getroffen hat.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0396.
-- ===========================================================================

alter table lead_aktivitaet add column erinnert_am timestamptz;

comment on column lead_aktivitaet.erinnert_am is
  'V-146, CRM-04. Wann die Erinnerung (erinnerung_am) zugestellt wurde. Gesetzt vom Lauf '
  'wiedervorlage_erinnerung, zurueckgesetzt beim Verschieben. NULL heisst: noch nicht erinnert.';

-- ---------------------------------------------------------------------------
-- Die Rechte des Laufs — Spalten, nicht die Tabelle.
-- ---------------------------------------------------------------------------
-- inhalt und rechtsgrundlage_snapshot bleiben dem Lauf entzogen: er braucht
-- sie nicht, und ein Lauf, der sie lesen koennte, waere ein zweiter Leseweg
-- auf den Paragraf-7-Beleg neben RLS.
grant select (id, mandant_id, betreff, faellig_am, erinnerung_am, erinnert_am,
              erledigt_am, zustaendig_benutzer_id, benutzer_id)
      on lead_aktivitaet to cse_job;
grant update (erinnert_am) on lead_aktivitaet to cse_job;

create policy j_aktivitaet_erinnerung_lesen on lead_aktivitaet for select to cse_job
  using (mandant_id = app.aktiver_mandant() and faellig_am is not null);

-- Nur eine offene Wiedervorlage wird als erinnert gestempelt oder
-- zurueckgegeben; eine erledigte bleibt, wie sie ist.
create policy j_aktivitaet_erinnerung_setzen on lead_aktivitaet for update to cse_job
  using      (mandant_id = app.aktiver_mandant() and faellig_am is not null
              and erledigt_am is null)
  with check (mandant_id = app.aktiver_mandant() and faellig_am is not null
              and erledigt_am is null);

-- ---------------------------------------------------------------------------
-- Der Index auf die eine Frage des Laufs.
-- ---------------------------------------------------------------------------
create index lead_aktivitaet_erinnerung_idx
  on lead_aktivitaet (mandant_id, erinnerung_am)
  where erinnerung_am is not null and erinnert_am is null and erledigt_am is null;
