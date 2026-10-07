/**
 * Die Regel zum Leistungsort einer Rechnung — eine Einstellung je
 * Gesellschaft (V-373, O-933, D-796, D-836).
 *
 * Darf das Objekt einer Rechnung einem ANDEREN Kunden zugeordnet sein als dem
 * Rechnungsempfänger? Die übliche Antwort ist ja: eine Hausverwaltung empfängt
 * die Rechnung für das Haus eines Eigentümers, ein Generalunternehmer für die
 * Baustelle seines Bauherrn, eine Muttergesellschaft für die Niederlassung
 * der Tochter. Eine Gesellschaft, die nur für ihre eigenen Objektkunden
 * abrechnet, will das umgekehrt ausschließen.
 *
 * // TODO(client, O-933): Voreinstellung — `frei`: der Leistungsort darf einem
 * anderen Kunden gehören; geprüft wird, ob der Mensch das Objekt sehen darf.
 * Je Gesellschaft umstellbar auf `gleich` unter Einstellungen › Rechnungen
 * (V-373). D-796, D-836.
 *
 * **Gespeichert in `mandant_einstellung`** unter `rechnung.leistungsort_regel`
 * als `{"art": "frei" | "gleich"}`. Gelesen über `app.einstellung` (Definer,
 * 0033) — wer einen Entwurf anlegt, muss die Einstellungen nicht lesen dürfen,
 * um ihre Regel zu befolgen. Fehlt der Schlüssel oder steht dort etwas
 * Unbekanntes, gilt die Voreinstellung: eine kaputte Zeile darf eine
 * Rechnung nicht strenger und nicht lockerer machen, als die Gesellschaft
 * entschieden hat — und `frei` ist das, was sie ohne Entscheidung hat.
 *
 * **Protokolliert.** Wer die Regel umstellt, ändert, welche Belege künftig
 * entstehen dürfen; die Auditzeile nennt alten und neuen Wert.
 */
import type { SchreibKontext } from '../../kontext/index.js';

/** Was die Regel sagen kann. `frage` hält die Herkunft fest: O-933. */
export interface ObjektKundeRegel {
  readonly art: 'frei' | 'gleich';
  readonly frage: 'O-933';
}

/** Die Voreinstellung — sie gilt, solange eine Gesellschaft nichts setzt. */
export const OBJEKT_KUNDE_REGEL: ObjektKundeRegel = { art: 'frei', frage: 'O-933' };

export const LEISTUNGSORT_SCHLUESSEL = 'rechnung.leistungsort_regel';
export const LEISTUNGSORT_ARTEN: readonly ObjektKundeRegel['art'][] = ['frei', 'gleich'];

/** Der schmale Ausschnitt eines Treibers, den das Lesen braucht. */
interface Lesend {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class LeistungsortRegelFehler extends Error {
  readonly status = 422;
  readonly grund = 'unbekannte_regel';
  constructor(wert: string) {
    super(`„${wert}" ist keine Regel zum Leistungsort — erlaubt sind „frei" und „gleich".`);
    this.name = 'LeistungsortRegelFehler';
  }
}

/** Prüft die Eingabe des Formulars — eine der beiden Arten, sonst wirft sie. */
export function pruefeLeistungsortArt(roh: string): ObjektKundeRegel['art'] {
  const wert = roh.trim();
  const art = LEISTUNGSORT_ARTEN.find((a) => a === wert);
  if (art === undefined) throw new LeistungsortRegelFehler(wert);
  return art;
}

export interface LeistungsortStand {
  readonly regel: ObjektKundeRegel;
  /** `false`: die Gesellschaft hat nichts gesetzt, es gilt die Voreinstellung. */
  readonly gesetzt: boolean;
}

/** Die Regel der aktiven Gesellschaft — oder die Voreinstellung. */
export async function leseLeistungsortRegel(db: Lesend): Promise<LeistungsortStand> {
  const [z] = await db.abfrage<{ art: string | null }>(
    `select app.einstellung($1) ->> 'art' as art`, [LEISTUNGSORT_SCHLUESSEL]);
  const art = LEISTUNGSORT_ARTEN.find((a) => a === z?.art);
  return art === undefined
    ? { regel: OBJEKT_KUNDE_REGEL, gesetzt: false }
    : { regel: { art, frage: 'O-933' }, gesetzt: true };
}

/** Kurzform für die Prüfung beim Anlegen und Ändern eines Entwurfs. */
export async function objektKundeRegel(db: Lesend): Promise<ObjektKundeRegel> {
  return (await leseLeistungsortRegel(db)).regel;
}

/**
 * Setzt die Regel der aktiven Gesellschaft.
 *
 * `system.einstellung_verwalten` prüft die Route (`authorize`) und noch einmal
 * die Policy `mandant_einstellung.t_mandant` (0033). Erst sperren, dann den
 * alten Wert lesen — zwei gleichzeitige Speichervorgänge läsen sonst
 * denselben alten Wert, und die Auditzeile des zweiten nennte als „vorher"
 * nicht den Wert, den der erste gerade gesetzt hat.
 */
export async function setzeLeistungsortRegel(
  kontext: SchreibKontext, art: ObjektKundeRegel['art'],
): Promise<{ readonly geaendert: boolean }> {
  pruefeLeistungsortArt(art);
  await kontext.schreibe(
    `select pg_advisory_xact_lock(hashtext('leistungsort:' || app.aktiver_mandant()::text))`);
  const vorher = await leseLeistungsortRegel(kontext);
  if (vorher.gesetzt && vorher.regel.art === art) return { geaendert: false };

  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into mandant_einstellung
       (mandant_id, schluessel, wert, beschreibung, gesetzt_von_grundlage, erstellt_von)
     values (app.aktiver_mandant(), $1, jsonb_build_object('art', $2::text),
             'O-933: ob der Leistungsort einer Rechnung einem anderen Kunden gehoeren darf.',
             'Gesetzt in Einstellungen › Rechnungen (V-373)', app.aktueller_benutzer())
     on conflict (mandant_id, schluessel) do update
       set wert = excluded.wert,
           gesetzt_von_grundlage = excluded.gesetzt_von_grundlage,
           geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
     returning id`,
    [LEISTUNGSORT_SCHLUESSEL, art]);
  await kontext.schreibe(
    `select app.protokolliere('rechnung.leistungsort_regel_gesetzt', 'mandant_einstellung', $1,
                              $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    [z!.id, { art: vorher.gesetzt ? vorher.regel.art : null }, { art }]);
  return { geaendert: true };
}
