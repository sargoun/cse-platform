-- ===========================================================================
-- 0203 — agent_richtlinie: das Recht der Seite UND die Spur der Aenderung
--        (AGT-03, APR-01, Invariante 7, AUT-06, SEC-A9)
--
-- **Der Rechtekonflikt, der wie „keine Daten" aussieht.** `0012` legte auf
-- `agent_richtlinie` zwei Policies: `t_richtlinie_lesen` mit
-- `app.hat_recht('versand.lesen')` und `t_richtlinie_schreiben` mit
-- `versand.freigeben`. Die Seite `/portal/[mandant]/einstellungen/agent-richtlinien`
-- und `/portal/[mandant]/agenten/richtlinien` werden aber mit
-- `agent.richtlinie_verwalten` bewacht (04-SEITENKARTE §5.19/§5.24). Eine
-- Sitzung, die genau dieses Recht haelt, kommt durch das Tor und bekommt von
-- der Datenbank NULL ZEILEN und eine abgewiesene Schreibung — der stille
-- Fehler, den Invariante 3 meint: der Bildschirm sagt „keine Richtlinie
-- hinterlegt", und „keine Richtlinie" heisst nach Invariante 7 „Freigabe
-- noetig". Es sieht also aus wie eine besonders vorsichtige Konfiguration
-- und ist ein Rechtefehler. Heute latent (nur `super_admin` haelt beides),
-- erreichbar ueber `rolle_berechtigung.gewaehrt = false` je Mandant oder ueber
-- die Modul-Schnittmenge in `app.hat_recht_fuer`.
--
-- **Beide Rechte bleiben, und das ist Absicht.** `agent.richtlinie_verwalten`
-- kommt hinzu, `versand.lesen`/`versand.freigeben` werden NICHT entzogen:
-- `services/bau/nachtrag.ts` liest die Zeile unter den Rechten des
-- Versandwegs, und ihm das Lesen zu nehmen hiesse, dass `gate()` dort ein
-- `null` bekommt. Fail-closed waere das zwar — aber eine Richtlinie, die es
-- gibt und die niemand sieht, ist eine Konfiguration, die nicht wirkt, und
-- das faellt erst auf, wenn jemand sich auf sie verlaesst.
--
-- **Und die Spur.** Die Tabelle trug KEINEN Trigger: keine Loeschsperre, kein
-- Audit, kein `geaendert_am`-Setzer, kein `geaendert_von`. Eine Aenderung an
-- der Richtlinie, die entscheidet, ob eine Mail ohne Menschen hinausgeht,
-- liess damit keine Spur — bei einer Invariante-7-Konfiguration ist das der
-- teuerste denkbare fehlende Trigger.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Wer hat es geaendert
-- ---------------------------------------------------------------------------

alter table agent_richtlinie
  add column geaendert_von uuid references benutzer(id);

comment on column agent_richtlinie.geaendert_von is
  'AGT-03: wer die Richtlinie zuletzt gesetzt hat. `geaendert_am` stand seit 0012 '
  'daneben und nannte nur den Zeitpunkt — ein Zeitpunkt ohne Namen belegt nichts.';

-- ---------------------------------------------------------------------------
-- 2. Die Policies auf das Recht der Seite ziehen
-- ---------------------------------------------------------------------------

drop policy t_richtlinie_lesen on agent_richtlinie;
drop policy t_richtlinie_schreiben on agent_richtlinie;

/**
 * Lesen: das Recht der SEITE oder das Recht des VERSANDWEGS.
 *
 * `sichtbare_mandanten()` und nicht `aktiver_mandant()` — wie in 0012: die
 * Gruppenansicht liest die Konfiguration aller Bereiche, die sie sehen darf
 * (Invariante 10: lesend).
 */
create policy t_richtlinie_lesen on agent_richtlinie for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and ((select app.hat_recht('agent.richtlinie_verwalten', mandant_id))
           or (select app.hat_recht('versand.lesen', mandant_id))));

/**
 * Schreiben: `agent.richtlinie_verwalten` — das Recht, mit dem die Seite
 * bewacht ist — oder `versand.freigeben` wie bisher. Im AKTIVEN Bereich und
 * nie in der Gruppenansicht (`app.ist_readonly`).
 */
create policy t_richtlinie_schreiben on agent_richtlinie for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and ((select app.hat_recht('agent.richtlinie_verwalten', mandant_id))
                or (select app.hat_recht('versand.freigeben', mandant_id))))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and ((select app.hat_recht('agent.richtlinie_verwalten', mandant_id))
                or (select app.hat_recht('versand.freigeben', mandant_id))));

comment on table agent_richtlinie is
  'AGT-03/APR-01: je Aktion, ob sie ohne Menschen hinausgehen darf. Lesen und '
  'Schreiben unter agent.richtlinie_verwalten (Recht der Seite) ODER versand.* '
  '(Recht des Versandwegs) — 0203. Keine Zeile heisst: Freigabe noetig.';

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0203)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- agent_richtlinie (archiv): AGT-03, APR-01, Invariante 7, SEC-A9. Die Zeile entscheidet, ob eine Nachricht ohne benannten Menschen hinausgeht. Sie zu loeschen ist fail-closed — und genau deshalb verfuehrerisch: der Bildschirm sagt danach „nicht hinterlegt", und niemand kann belegen, ob je etwas anderes dort stand. Abgeschaltet wird eine Richtlinie ueber `ist_aktiv`, nicht durch DELETE.
create trigger trg_agent_richtlinie_kein_hard_delete
  before delete on agent_richtlinie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_richtlinie_kein_truncate
  before truncate on agent_richtlinie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_richtlinie from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_agent_richtlinie_geaendert_am
  before update on agent_richtlinie
  for each row execute function kern.setze_geaendert_am();

create trigger trg_agent_richtlinie_audit
  after insert or update or delete on agent_richtlinie
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
