import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { legeMappeAn } from '../vergabe/mappe.js';

/**
 * Der Vorgang einer Gesellschaft zu einer Bekanntmachung — RAD-07.
 *
 * **Warum es diesen Schalter überhaupt gibt.** D-07 nimmt der Plattform mit
 * Absicht jeden „Einreichen"-Knopf: die deutschen Vergabeplattformen bieten
 * dafür keine Schnittstelle an. Ohne einen Statuswechsel gäbe es dann aber
 * gar keinen Weg, `verworfen` und `eingereicht` festzuhalten — und der
 * Bericht „gefunden · geprüft · geboten · gewonnen" (REP-06) hätte keine
 * Daten. Der Schalter ist das, was von der Vergabeplattform übrig bleibt,
 * wenn man sie nicht fernsteuern kann: ein Mensch sagt, was er getan hat.
 *
 * **Verwerfen ohne Grund geht nicht.** RAD-07 verlangt einen, und die
 * Datenbank besteht darauf (`av_verworfen_begruendet`). In einem halben Jahr
 * ist „warum haben wir das damals liegen lassen" eine echte Frage.
 */

export class VorgangFehler extends Error {
  readonly code: 'grund' | 'status' | 'unbekannt' | 'mappe_recht';
  readonly status = 400;
  constructor(code: 'grund' | 'status' | 'unbekannt' | 'mappe_recht', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'VorgangFehler';
  }
}

/**
 * Die Stände, die ein Mensch hier setzt. `eingereicht` und die Ausgänge
 * (`zuschlag`, `nicht_beruecksichtigt`, `verfahren_aufgehoben`) gehören zur
 * Vergabemappe und kommen mit ihr — sie brauchen mehr als einen Knopf.
 */
export const SETZBAR = ['geprueft', 'in_bearbeitung', 'verworfen'] as const;
export type SetzbarerStatus = typeof SETZBAR[number];

export interface VorgangEingabe {
  readonly ausschreibungId: string;
  readonly status: SetzbarerStatus;
  readonly grund: string | null;
  readonly radarProfilId?: string | null;
  readonly bewertungId?: string | null;
}

export interface VorgangErgebnis {
  readonly vorgangId: string;
  readonly status: SetzbarerStatus;
  readonly neu: boolean;
}

export async function setzeVorgangsstand(
  kontext: SchreibKontext, e: VorgangEingabe,
): Promise<VorgangErgebnis> {
  if (!(SETZBAR as readonly string[]).includes(e.status)) {
    throw new VorgangFehler('status', `"${e.status}" ist kein Stand, den diese Seite setzt.`);
  }
  const grund = e.grund === null || e.grund.trim() === '' ? null : e.grund.trim();
  if (e.status === 'verworfen' && (grund === null || grund.length < 5)) {
    throw new VorgangFehler('grund',
      'Ein Verwerfen braucht einen Grund (RAD-07) — mindestens ein halber Satz.');
  }

  /**
   * **Der Schnappschuss der Frist wird beim Anlegen genommen, nie später
   * überschrieben.** Die geltende Frist steht in `ausschreibung`; dieser Wert
   * hält fest, welche galt, als der Vorgang eröffnet wurde. Weichen beide
   * voneinander ab, ist das eine Änderungsbekanntmachung — und die soll
   * auffallen, nicht stillschweigend nachgezogen werden.
   *
   * **Der Stand wird hier NICHT gesetzt.** Das ist die zweite Anweisung, und
   * der Grund steht darunter: `in_bearbeitung` setzt eine Vergabemappe voraus,
   * die es vor dem Vorgang gar nicht geben kann (Fremdschlüssel). Erst die
   * Zeile, dann die Mappe, dann der Stand.
   */
  const [zeile] = await kontext.schreibe<{ id: string; neu: boolean }>(
    `insert into ausschreibung_vorgang
       (mandant_id, ausschreibung_id, radar_profil_id, bewertung_id, status,
        frist_angebot_snapshot, erstellt_von_art, erstellt_von)
     select $1::uuid, a.id, $3::uuid, $4::uuid, 'neu'::ausschreibung_status,
            a.frist_angebot, 'mensch', $5::uuid
       from ausschreibung a where a.id = $2::uuid
     on conflict (mandant_id, ausschreibung_id) where geloescht_am is null do update
       set radar_profil_id = coalesce(excluded.radar_profil_id, ausschreibung_vorgang.radar_profil_id),
           bewertung_id = coalesce(excluded.bewertung_id, ausschreibung_vorgang.bewertung_id)
     returning id, (xmax = 0) as neu`,
    [kontext.aktiverMandantId, e.ausschreibungId, e.radarProfilId ?? null, e.bewertungId ?? null,
      kontext.benutzerId]);

  if (zeile === undefined) {
    throw new VorgangFehler('unbekannt',
      'Die Bekanntmachung wurde nicht gefunden, oder die Sitzung darf hier nicht schreiben.');
  }

  /**
   * **„In Bearbeitung" öffnet die Vergabemappe.** Die Seitenkarte §5.18 sagt
   * es als Bedingung, die Datenbank erzwingt es (`app.vorgang_braucht_mappe`),
   * und fachlich ist es dasselbe: in Bearbeitung ist eine Ausschreibung, wenn
   * jemand anfängt, die geforderten Unterlagen zusammenzutragen. Ohne die
   * Mappe wäre der Stand eine Behauptung ohne Ort.
   *
   * Das Anlegen braucht `vergabe.schreiben` — ein anderes Recht als das
   * Statussetzen. Wer es nicht hat, bekommt hier einen Satz und nicht eine
   * Policy-Verletzung ohne Erklärung.
   */
  if (e.status === 'in_bearbeitung') {
    const [recht] = await kontext.abfrage<{ darf: boolean }>(
      `select app.hat_recht('vergabe.schreiben', app.aktiver_mandant()) as darf`);
    if (recht?.darf !== true) {
      throw new VorgangFehler('mappe_recht',
        '„In Bearbeitung" legt die Vergabemappe an — dafür fehlt das Recht vergabe.schreiben.');
    }
    await legeMappeAn(kontext, zeile.id);
  }

  await kontext.schreibe(
    `update ausschreibung_vorgang
        set status = $3::ausschreibung_status,
            verworfen_grund = case when $3 = 'verworfen' then $4 else verworfen_grund end,
            status_geaendert_am = now(), status_geaendert_von = $5::uuid,
            geaendert_am = now(), geaendert_von = $5::uuid
      where id = $1::uuid and mandant_id = $2::uuid`,
    [zeile.id, kontext.aktiverMandantId, e.status, grund, kontext.benutzerId]);

  await kontext.schreibe(
    `select app.protokolliere('radar.stand_gesetzt', 'ausschreibung_vorgang', $1, null, $2::jsonb,
                              app.aktiver_mandant())`,
    /* Ein Objekt, kein JSON-Text (D-467). */
    [zeile.id, { status: e.status, ausschreibungId: e.ausschreibungId, mitGrund: grund !== null }]);

  return { vorgangId: zeile.id, status: e.status, neu: zeile.neu };
}
