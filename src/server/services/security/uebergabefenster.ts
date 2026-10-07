/**
 * Das Übergabefenster des Wachbuchs einstellen (V-323, O-151, SEC-05, D-808).
 *
 * `wachbuch.uebergabe_fenster` entscheidet, wie weit vor ihrem Schichtbeginn
 * eine Wache die Einträge ihrer Vorgänger am selben Objekt sieht (0302,
 * `app.uebergabe_fenster`). Ausgeliefert ist es mit 0 (0033): bis jemand es
 * setzt, sieht jede Wache nur ihre eigenen Seiten. Gesetzt wurde der Wert bis
 * hierher nur per SQL — ein Eingabeweg fehlte.
 *
 * TODO(client, O-151): Voreinstellung — zwölf Stunden vor Schichtbeginn am
 * selben Objekt; das Formular schlägt sie vor, gesetzt wird je Gesellschaft
 * (0 bis 24 Stunden). Ausgeliefert bleibt 0: das Fenster zeigt Einträge
 * anderer Menschen, und ob es offen ist, ist eine Entscheidung (O-06,
 * § 87 Abs. 1 Nr. 6 BetrVG), kein Vorgabewert. Gebaut mit V-323. D-789.
 *
 * **Ganze Stunden, 0 bis 24.** Ein Fenster über einen Tag hinaus zeigte die
 * Übergabe der Vorvorschicht; ein Bruchteil einer Stunde ist eine Genauigkeit,
 * die niemand am Objekt braucht. Gespeichert wird ISO 8601 (`PT12H`) — die
 * Form, die 0033 ausliefert und `app.uebergabe_fenster` liest.
 *
 * **Protokolliert.** Wer das Fenster öffnet, öffnet fremde Einträge für eine
 * ganze Belegschaft; die Auditzeile nennt alten und neuen Wert.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export const UEBERGABE_VOREINSTELLUNG_STUNDEN = 12;
export const UEBERGABE_HOECHSTENS_STUNDEN = 24;

export class UebergabefensterFehler extends Error {
  readonly status = 422;
  readonly grund = 'ausserhalb';
  constructor() {
    super(`Das Übergabefenster liegt zwischen 0 und ${String(UEBERGABE_HOECHSTENS_STUNDEN)} `
      + 'ganzen Stunden.');
    this.name = 'UebergabefensterFehler';
  }
}

/** Prüft die Eingabe — ganze Stunden zwischen 0 und 24, sonst wirft sie. */
export function pruefeUebergabeStunden(roh: string): number {
  const text = roh.trim();
  if (!/^\d{1,2}$/u.test(text)) throw new UebergabefensterFehler();
  const stunden = Number(text);
  if (stunden > UEBERGABE_HOECHSTENS_STUNDEN) throw new UebergabefensterFehler();
  return stunden;
}

export interface UebergabefensterStand {
  /** Die eingestellten Stunden — `null`, wenn die Gesellschaft keinen Wert hat. */
  readonly stunden: number | null;
}

/** Der Stand der aktiven Gesellschaft, in Stunden. */
export async function leseUebergabefenster(
  kontext: LeseKontext,
): Promise<UebergabefensterStand> {
  const [z] = await kontext.abfrage<{ stunden: string | null; gesetzt: boolean }>(
    `select (extract(epoch from app.uebergabe_fenster(app.aktiver_mandant())) / 3600)::text
              as stunden,
            (app.einstellung('wachbuch.uebergabe_fenster') is not null) as gesetzt`,
  );
  if (z === undefined || !z.gesetzt || z.stunden === null) return { stunden: null };
  return { stunden: Number(z.stunden) };
}

/**
 * Setzt das Fenster der aktiven Gesellschaft.
 *
 * `system.einstellung_verwalten` prüft die Route (`authorize`) und noch einmal
 * die Policy `mandant_einstellung.t_mandant` (0033) — der Dienst schreibt
 * unter derselben Sitzung.
 */
export async function setzeUebergabefenster(
  kontext: SchreibKontext, stunden: number,
): Promise<void> {
  if (!Number.isInteger(stunden) || stunden < 0 || stunden > UEBERGABE_HOECHSTENS_STUNDEN) {
    throw new UebergabefensterFehler();
  }
  const vorher = await leseUebergabefenster(kontext);
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into mandant_einstellung
       (mandant_id, schluessel, wert, beschreibung, gesetzt_von_grundlage, erstellt_von)
     values (app.aktiver_mandant(), 'wachbuch.uebergabe_fenster',
             jsonb_build_object('interval', $1::text),
             'SEC-05: das Fenster, in dem eine Uebergabe quittiert werden kann.',
             'Gesetzt in Security › Wachbuch (V-323)', app.aktueller_benutzer())
     on conflict (mandant_id, schluessel) do update
       set wert = excluded.wert,
           gesetzt_von_grundlage = excluded.gesetzt_von_grundlage,
           geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
     returning id`,
    [`PT${String(stunden)}H`],
  );
  await kontext.schreibe(
    `select app.protokolliere('wachbuch.uebergabe_fenster_gesetzt', 'mandant_einstellung', $1,
                              $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    [z!.id, { stunden: vorher.stunden }, { stunden }],
  );
}
