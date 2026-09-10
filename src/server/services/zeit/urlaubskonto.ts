/**
 * Das Urlaubskonto (EMP-05; 01-KERN §6.26).
 *
 * **Der Anspruch wird eingetragen, nicht gerechnet** (K-17, O-18). Gesetzlich
 * sind es 24 Werktage bei Sechstagewoche (§ 3 BUrlG), tariflich und
 * vertraglich fast immer mehr; Teilzeit rechnet anders, das Eintritts- und das
 * Austrittsjahr rechnen anders (§ 5 BUrlG), und ob ein Uebertrag am 31.03.
 * verfaellt, ist eine betriebliche Regelung — nach der Rechtsprechung des EuGH
 * ausserdem nur, wenn der Arbeitgeber vorher aufgefordert und belehrt hat.
 * Fuenf Entscheidungen, von denen keine in der SPEC steht.
 *
 * Also liefert die ausgelieferte Regel `null`, `anspruch_tage` bleibt 0, und 0
 * heisst „nicht hinterlegt". Ein Dienst, der stattdessen 20 oder 24 einsetzte,
 * bekaeme nie eine Rueckfrage: die Zahl saehe richtig aus, bis jemand
 * Resturlaub einklagt.
 *
 * **Tage sind `numeric(12,3)`, hier also `MilliMenge`** — Tausendstel als
 * `bigint`, dieselbe Rechnung wie fuer jede andere Menge (`finanz/menge.ts`).
 * Ein `number` waere ein Fliesskommawert, und ein halber Urlaubstag ist ein
 * Anspruch, kein Rundungsergebnis.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  mengeAusPostgres, mengeNachPostgres, NULL_MENGE, type MilliMenge,
} from '../finanz/menge.js';

export interface Urlaubskonto {
  readonly id: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly jahr: number;
  /** 0 heisst „nicht hinterlegt" (O-18), nicht „kein Urlaub". */
  readonly anspruchTage: MilliMenge;
  readonly uebertragTage: MilliMenge;
  readonly uebertragVerfaelltAm: string | null;
  readonly zusatzTage: MilliMenge;
  readonly genommenTage: MilliMenge;
  readonly verplantTage: MilliMenge;
  readonly restTage: MilliMenge;
  readonly abgeschlossenAm: Date | null;
  /** Wahr, solange der Anspruch nicht hinterlegt ist — die Anzeige sagt das. */
  readonly anspruchOffen: boolean;
}

export interface AnspruchEingabe {
  readonly anstellungId: string;
  readonly jahr: number;
  readonly arbeitszeitmodell: string;
  /** Vertragliche Wochenstunden in Tausendsteln, oder `null`. */
  readonly wochenstunden: MilliMenge | null;
  readonly eintritt: string;
  readonly austritt: string | null;
}

export interface UrlaubsanspruchRegel {
  readonly schluessel: string;
  /** Die Anspruchstage, oder `null`, wenn die Regel offen ist. */
  anspruchTage(eingabe: AnspruchEingabe): MilliMenge | null;
}

export class UrlaubsanspruchOffenFehler extends Error {
  readonly code = 'nicht_konfiguriert';
  readonly status = 409;
  constructor(jahr: number) {
    super(`Der Urlaubsanspruch fuer ${String(jahr)} ist nicht hinterlegt (O-18).`);
    this.name = 'UrlaubsanspruchOffenFehler';
  }
}

export class UrlaubsjahrAbgeschlossenFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(jahr: number) {
    super(`Das Urlaubsjahr ${String(jahr)} ist abgeschlossen; korrigiert wird im Folgejahr.`);
    this.name = 'UrlaubsjahrAbgeschlossenFehler';
  }
}

/**
 * Die ausgelieferte Regel: sie antwortet nicht.
 *
 * // TODO(client, O-18): Urlaubsanspruch je Entitaet und Beschaeftigungsart —
 * gesetzlich, tariflich oder vertraglich? Wie rechnen Teilzeit, Eintritts- und
 * Austrittsjahr, wann verfaellt ein Uebertrag, und gibt es einen
 * Ueberstundenverfall daneben?
 */
export const URLAUBSANSPRUCH_OFFEN: UrlaubsanspruchRegel = {
  schluessel: 'offen',
  anspruchTage(): MilliMenge | null {
    return null;
  },
};

/** Der Anspruch — oder eine Meldung. Nie ein stillschweigendes `0`. */
export function anspruchOderFehler(
  regel: UrlaubsanspruchRegel, eingabe: AnspruchEingabe,
): MilliMenge {
  const tage = regel.anspruchTage(eingabe);
  if (tage === null) throw new UrlaubsanspruchOffenFehler(eingabe.jahr);
  return tage;
}

interface KontoZeile {
  id: string; mandant_id: string; anstellung_id: string; jahr: number;
  anspruch_tage: string; uebertrag_tage: string; uebertrag_verfaellt_am: Date | string | null;
  zusatz_tage: string; genommen_tage: string; verplant_tage: string; rest_tage: string;
  abgeschlossen_am: Date | null;
}

const SPALTEN =
  `id, mandant_id, anstellung_id, jahr, anspruch_tage, uebertrag_tage,
   uebertrag_verfaellt_am, zusatz_tage, genommen_tage, verplant_tage, rest_tage,
   abgeschlossen_am`;

function alsDatum(wert: Date | string | null): string | null {
  if (wert === null) return null;
  if (typeof wert === 'string') return wert.slice(0, 10);
  return `${String(wert.getUTCFullYear()).padStart(4, '0')}-`
    + `${String(wert.getUTCMonth() + 1).padStart(2, '0')}-`
    + `${String(wert.getUTCDate()).padStart(2, '0')}`;
}

function alsKonto(z: KontoZeile): Urlaubskonto {
  const anspruch = mengeAusPostgres(z.anspruch_tage);
  return {
    id: z.id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    jahr: Number(z.jahr),
    anspruchTage: anspruch,
    uebertragTage: mengeAusPostgres(z.uebertrag_tage),
    uebertragVerfaelltAm: alsDatum(z.uebertrag_verfaellt_am),
    zusatzTage: mengeAusPostgres(z.zusatz_tage),
    genommenTage: mengeAusPostgres(z.genommen_tage),
    verplantTage: mengeAusPostgres(z.verplant_tage),
    restTage: mengeAusPostgres(z.rest_tage),
    abgeschlossenAm: z.abgeschlossen_am,
    /**
     * Der Unterschied zwischen „null Tage Anspruch" und „wir wissen es nicht"
     * ist im Portal der ganze Punkt: das erste ist eine Auskunft, das zweite
     * eine offene Frage. Ohne diese Marke stuende auf dem Bildschirm des
     * Menschen „Resturlaub: 0 Tage", und das waere schlicht falsch.
     */
    anspruchOffen: anspruch === NULL_MENGE,
  };
}

export async function leseUrlaubskonten(
  kontext: LeseKontext,
  filter: { readonly anstellungId?: string; readonly personId?: string; readonly jahr?: number } = {},
): Promise<readonly Urlaubskonto[]> {
  const werte: unknown[] = [];
  const wo: string[] = [];
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    wo.push(`u.anstellung_id = $${String(werte.length)}`);
  }
  if (filter.personId !== undefined) {
    werte.push(filter.personId);
    wo.push(`exists (select 1 from anstellung a
                      where a.id = u.anstellung_id and a.person_id = $${String(werte.length)})`);
  }
  if (filter.jahr !== undefined) {
    werte.push(filter.jahr);
    wo.push(`u.jahr = $${String(werte.length)}`);
  }
  const zeilen = await kontext.abfrage<KontoZeile>(
    `select ${SPALTEN} from urlaubskonto u
      ${wo.length === 0 ? '' : `where ${wo.join(' and ')}`}
      order by u.jahr desc, u.anstellung_id asc`,
    werte,
  );
  return zeilen.map(alsKonto);
}

export interface UrlaubskontoEroeffnung {
  readonly anstellungId: string;
  readonly jahr: number;
  /** Ohne Angabe bleibt der Anspruch 0 — „nicht hinterlegt" (O-18). */
  readonly anspruchTage?: MilliMenge;
  readonly uebertragTage?: MilliMenge;
  /** Ohne Angabe NULL: „keine Frist hinterlegt", nicht „verfaellt nie". */
  readonly uebertragVerfaelltAm?: string | null;
  readonly zusatzTage?: MilliMenge;
}

/**
 * Legt das Urlaubskonto eines Jahres an — idempotent, wie das Stundenkonto.
 *
 * `genommen_tage` und `verplant_tage` werden hier NICHT gesetzt: sie folgen
 * aus genehmigten Abwesenheiten (PR 38), und `urlaubskonto_tage_quelle` (0061)
 * weist jede Buchung von Hand ab. Ein Resturlaub, zu dem sich keine
 * Abwesenheit finden laesst, ist im Streit die schlechtere Haelfte.
 */
export async function eroeffneUrlaubskonto(
  kontext: SchreibKontext, eingabe: UrlaubskontoEroeffnung,
): Promise<Urlaubskonto> {
  await kontext.schreibe(
    `insert into urlaubskonto
       (mandant_id, anstellung_id, jahr, anspruch_tage, uebertrag_tage,
        uebertrag_verfaellt_am, zusatz_tage, erstellt_von)
     values ($1, $2, $3, $4::numeric, $5::numeric, $6::date, $7::numeric, $8)
     on conflict (anstellung_id, jahr) do nothing`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, eingabe.jahr,
      mengeNachPostgres(eingabe.anspruchTage ?? NULL_MENGE),
      mengeNachPostgres(eingabe.uebertragTage ?? NULL_MENGE),
      eingabe.uebertragVerfaelltAm ?? null,
      mengeNachPostgres(eingabe.zusatzTage ?? NULL_MENGE),
      kontext.benutzerId,
    ],
  );
  const konto = await findeUrlaubskonto(kontext, eingabe.anstellungId, eingabe.jahr);
  if (konto === null) throw new UrlaubsanspruchOffenFehler(eingabe.jahr);
  return konto;
}

async function findeUrlaubskonto(
  kontext: LeseKontext, anstellungId: string, jahr: number,
): Promise<Urlaubskonto | null> {
  const [z] = await kontext.abfrage<KontoZeile>(
    `select ${SPALTEN} from urlaubskonto u
      where u.anstellung_id = $1 and u.jahr = $2`,
    [anstellungId, jahr],
  );
  return z === undefined ? null : alsKonto(z);
}

/**
 * Traegt den Anspruch nach, den ein Mensch entschieden hat.
 *
 * Der Weg fuer eine Antwort auf O-18, bevor es eine Regel gibt: jemand mit
 * `zeit.schreiben` traegt die Tage aus dem Arbeitsvertrag ein. Das ist keine
 * Herleitung und gibt sich auch nicht als eine aus.
 */
export async function setzeAnspruch(
  kontext: SchreibKontext,
  eingabe: {
    readonly anstellungId: string; readonly jahr: number;
    readonly anspruchTage: MilliMenge;
    readonly uebertragTage?: MilliMenge;
    readonly uebertragVerfaelltAm?: string | null;
    readonly zusatzTage?: MilliMenge;
  },
): Promise<Urlaubskonto> {
  const vorher = await findeUrlaubskonto(kontext, eingabe.anstellungId, eingabe.jahr);
  if (vorher === null) throw new UrlaubsanspruchOffenFehler(eingabe.jahr);
  if (vorher.abgeschlossenAm !== null) throw new UrlaubsjahrAbgeschlossenFehler(eingabe.jahr);

  await kontext.schreibe(
    `update urlaubskonto
        set anspruch_tage = $2::numeric,
            uebertrag_tage = coalesce($3::numeric, uebertrag_tage),
            uebertrag_verfaellt_am = $4::date,
            zusatz_tage = coalesce($5::numeric, zusatz_tage),
            geaendert_von = $6
      where id = $1`,
    [
      vorher.id, mengeNachPostgres(eingabe.anspruchTage),
      eingabe.uebertragTage === undefined ? null : mengeNachPostgres(eingabe.uebertragTage),
      eingabe.uebertragVerfaelltAm ?? null,
      eingabe.zusatzTage === undefined ? null : mengeNachPostgres(eingabe.zusatzTage),
      kontext.benutzerId,
    ],
  );
  const konto = await findeUrlaubskonto(kontext, eingabe.anstellungId, eingabe.jahr);
  if (konto === null) throw new UrlaubsanspruchOffenFehler(eingabe.jahr);
  return konto;
}
