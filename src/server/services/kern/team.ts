import 'server-only';
import type { LeseKontext, SchreibKontext } from '@/server/kontext';

/**
 * **Teams pflegen** (V-378, O-650, D-813, §7.5).
 *
 * `team` und `team_mitglied` (0230) füllte nur der Seed; Kalender (CAL-02)
 * und Aufgaben lesen sie. Hier legt eine Gesellschaft Teams an, ordnet
 * Beschäftigungen zu und beendet Mitgliedschaften. Geschrieben wird unter
 * `kalender.schreiben` — die Policies aus 0230 verlangen genau das.
 *
 * **Eine Mitgliedschaft endet, sie verschwindet nicht** (0509): wer bis wann
 * im Team war, erklärt eine Teamaufgabe von gestern. Eindeutig ist nur die
 * laufende Mitgliedschaft; danach darf dieselbe Beschäftigung wieder hinein.
 *
 * **Eine Beschäftigung, nicht eine Person** (D-09): wer für zwei
 * Gesellschaften arbeitet, ist in jedem Team dieser Gesellschaft mit genau der
 * Beschäftigung, die hier gilt.
 */

// TODO(client, O-650): Voreinstellung — die Rolle im Team ist Text mit der Vorschlagsliste Leitung, Stellvertretung, Mitglied, Springer; jede andere Bezeichnung geht ebenfalls (D-799).
export const TEAM_ROLLEN_VORSCHLAG = ['Leitung', 'Stellvertretung', 'Mitglied', 'Springer'] as const;

export class TeamFehler extends Error {
  constructor(
    readonly grund:
      | 'ohne_name' | 'zu_lang' | 'unbekanntes_team' | 'unbekannte_beschaeftigung'
      | 'schon_mitglied' | 'unbekannte_mitgliedschaft' | 'unbekannte_leitung'
      | 'unbekannter_vorgang',
  ) {
    super(grund);
    this.name = 'TeamFehler';
  }
}

export interface TeamMitglied {
  readonly id: string;
  readonly anstellungId: string;
  readonly name: string;
  readonly rolle: string | null;
  /** Berliner Tag des Eintritts und — wenn beendet — des Endes (Invariante 2). */
  readonly seit: string;
  readonly bis: string | null;
}

export interface TeamZeile {
  readonly id: string;
  readonly name: string;
  readonly bereich: string | null;
  readonly leitung: string | null;
  readonly mitglieder: readonly TeamMitglied[];
}

/** Die Teams der aktiven Gesellschaft mit ihren laufenden und beendeten Mitgliedschaften. */
export async function listeTeams(kontext: LeseKontext): Promise<readonly TeamZeile[]> {
  const teams = await kontext.abfrage<{
    id: string; name: string; bereich: string | null; leitung: string | null;
  }>(
    `select t.id, t.name, t.bereich, u.name as leitung
       from team t
       left join benutzer u on u.id = t.leitung_benutzer_id
      where t.mandant_id = app.aktiver_mandant() and t.geloescht_am is null
      order by lower(t.name)`);
  if (teams.length === 0) return [];
  const mitglieder = await kontext.abfrage<{
    id: string; team_id: string; anstellung_id: string; name: string; rolle: string | null;
    seit: string; bis: string | null;
  }>(
    `select tm.id, tm.team_id, tm.anstellung_id,
            (p.vorname || ' ' || p.nachname) as name, tm.rolle,
            to_char(tm.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as seit,
            to_char(tm.beendet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as bis
       from team_mitglied tm
       join person p on p.id = tm.person_id
      where tm.mandant_id = app.aktiver_mandant()
      order by tm.beendet_am nulls first, p.nachname, p.vorname`);
  return teams.map((t) => ({
    id: t.id, name: t.name, bereich: t.bereich, leitung: t.leitung,
    mitglieder: mitglieder.filter((m) => m.team_id === t.id).map((m) => ({
      id: m.id, anstellungId: m.anstellung_id, name: m.name, rolle: m.rolle,
      seit: m.seit, bis: m.bis,
    })),
  }));
}

/** Die aktiven Beschäftigungen der Gesellschaft — wer zugeordnet werden kann. */
export async function zuordenbareBeschaeftigungen(
  kontext: LeseKontext,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  return kontext.abfrage<{ id: string; name: string }>(
    `select a.id, (p.vorname || ' ' || p.nachname) as name
       from anstellung a
       join person p on p.id = a.person_id
      where a.mandant_id = app.aktiver_mandant()
        and a.geloescht_am is null and a.status = 'aktiv'
      order by p.nachname, p.vorname`);
}

function text(wert: string | null | undefined, max: number): string | null {
  const t = (wert ?? '').trim();
  if (t === '') return null;
  if (t.length > max) throw new TeamFehler('zu_lang');
  return t;
}

/** Ein Team anlegen — mit Namen, wahlweise Bereich und Leitung (ein Konto dieser Gesellschaft). */
export async function legeTeamAn(
  kontext: SchreibKontext,
  eingabe: { readonly name: string; readonly bereich?: string | null; readonly leitungBenutzerId?: string | null },
): Promise<string> {
  const name = text(eingabe.name, 120);
  if (name === null) throw new TeamFehler('ohne_name');
  const bereich = text(eingabe.bereich, 80);
  const leitung = text(eingabe.leitungBenutzerId, 36);
  if (leitung !== null) {
    const [m] = await kontext.abfrage<{ ok: boolean }>(
      `select app.ist_mitglied($1::uuid, app.aktiver_mandant(), app.berlin_heute()) as ok`,
      [leitung]);
    if (m?.ok !== true) throw new TeamFehler('unbekannte_leitung');
  }
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into team (mandant_id, name, bereich, leitung_benutzer_id, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3::uuid, app.aktueller_benutzer())
     returning id`,
    [name, bereich, leitung]);
  if (z === undefined) throw new TeamFehler('unbekanntes_team');
  return z.id;
}

/** Eine Beschäftigung dem Team zuordnen — mit einer Rolle aus der Vorschlagsliste oder einer eigenen. */
export async function ordneZu(
  kontext: SchreibKontext,
  eingabe: { readonly teamId: string; readonly anstellungId: string; readonly rolle?: string | null },
): Promise<string> {
  const rolle = text(eingabe.rolle, 60);
  const [t] = await kontext.abfrage<{ id: string }>(
    `select id from team where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null`, [eingabe.teamId]);
  if (t === undefined) throw new TeamFehler('unbekanntes_team');
  const [a] = await kontext.abfrage<{ person_id: string }>(
    `select person_id from anstellung
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and geloescht_am is null and status = 'aktiv'`, [eingabe.anstellungId]);
  if (a === undefined) throw new TeamFehler('unbekannte_beschaeftigung');
  try {
    const [z] = await kontext.schreibe<{ id: string }>(
      `insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id, rolle, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4, app.aktueller_benutzer())
       returning id`,
      [eingabe.teamId, eingabe.anstellungId, a.person_id, rolle]);
    if (z === undefined) throw new TeamFehler('unbekanntes_team');
    return z.id;
  } catch (fehler: unknown) {
    if ((fehler as { code?: string }).code === '23505') throw new TeamFehler('schon_mitglied');
    throw fehler;
  }
}

/** Eine laufende Mitgliedschaft beenden — die Zeile bleibt, mit Ende und Namen. */
export async function beendeMitgliedschaft(
  kontext: SchreibKontext, mitgliedId: string,
): Promise<void> {
  const [z] = await kontext.schreibe<{ id: string }>(
    `update team_mitglied
        set beendet_am = now(), beendet_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and beendet_am is null
      returning id`,
    [mitgliedId]);
  if (z === undefined) throw new TeamFehler('unbekannte_mitgliedschaft');
}
