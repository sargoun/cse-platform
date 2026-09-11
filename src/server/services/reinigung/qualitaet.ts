/**
 * Die Qualitätsprüfung und ihre Bewertung (OPS-11, SPEC §22).
 *
 * **Hier wird nichts bestanden.** SPEC nennt kein Prüfverfahren und keine
 * Bestehensschwelle; `pruefverfahren.bestehensschwelle_prozent` steht deshalb
 * auf NULL, `qualitaetspruefung.bestanden` bleibt NULL, und keine Oberfläche
 * zeigt eine Bestanden-Pille. Eine plausible Zahl — 90 %, 95 % — wäre eine
 * erfundene Geschäftsregel mit vertraglicher Wirkung (K-17).
 *
 * // TODO(client, O-29): Was löst eine Qualitätsprüfung aus, welche Skala
 * gilt, und was folgt auf eine nicht bestandene Prüfung?
 *
 * Was stattdessen steht, ist eine SCHNITTSTELLE: `QualitaetsBewertung` nimmt
 * Punkte, Skala und Schwelle und gibt `bestanden`, `nicht_bestanden` oder
 * `unbestimmt` zurück. Die heutige Umsetzung (`schwellenBewertung`) antwortet
 * `unbestimmt`, solange die Schwelle fehlt. Kommt die Antwort des Kunden, wird
 * eine Katalogzeile gepflegt — keine Migration, kein neuer Code.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type Bewertung = 'bestanden' | 'nicht_bestanden' | 'unbestimmt';

export interface BewertungsEingabe {
  /** Erreichte Punkte als `numeric`-Text, oder `null`. */
  readonly punkte: string | null;
  readonly maxPunkte: string | null;
  /** Aus dem Katalog. NULL heißt UNBEANTWORTET, nicht „0 %". */
  readonly schwelleProzent: string | null;
}

/** Die austauschbare Stelle. Eine Schnittstelle, damit das Offene tauschbar ist. */
export interface QualitaetsBewertung {
  bewerte(eingabe: BewertungsEingabe): Bewertung;
}

/**
 * Ganzzahlig, in Hundertsteln — kein Gleitkomma.
 *
 * Der Erfüllungsgrad ist kein Geld, aber er entscheidet über eine
 * Vertragsstrafe. `84.995` als Double gegen `85` zu halten ist genau die Art
 * Vergleich, die je nach Rundung anders ausgeht.
 */
function hundertstel(text: string): bigint {
  const [ganz = '0', bruch = ''] = text.trim().split('.');
  const vorzeichen = ganz.startsWith('-') ? -1n : 1n;
  const ziffern = `${bruch}00`.slice(0, 2);
  return vorzeichen * (BigInt(ganz.replace('-', '')) * 100n + BigInt(ziffern));
}

export const schwellenBewertung: QualitaetsBewertung = {
  bewerte(eingabe) {
    if (eingabe.schwelleProzent === null) return 'unbestimmt';
    if (eingabe.punkte === null || eingabe.maxPunkte === null) return 'unbestimmt';
    const max = hundertstel(eingabe.maxPunkte);
    if (max <= 0n) return 'unbestimmt';
    /**
     * Erfüllungsgrad in Hundertstelprozent, damit die Schwelle in derselben
     * Einheit verglichen wird: `85` kommt als `8500` an, und `84,995 %` ergibt
     * `8499` — also NICHT bestanden. Genau dieser Fall geht mit Gleitkomma je
     * nach Rundung anders aus.
     */
    const grad = (hundertstel(eingabe.punkte) * 10_000n) / max;
    return grad >= hundertstel(eingabe.schwelleProzent) ? 'bestanden' : 'nicht_bestanden';
  },
};

export class PruefungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Qualitätsprüfung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'PruefungNichtGefunden';
  }
}

export interface PruefverfahrenZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly maxPunkte: string | null;
  readonly schwelleProzent: string | null;
  readonly istPlatzhalter: boolean;
}

interface PvDbZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly max_punkte: string | null;
  readonly bestehensschwelle_prozent: string | null;
  readonly ist_platzhalter: boolean;
}

export async function listePruefverfahren(
  kontext: LeseKontext,
): Promise<readonly PruefverfahrenZeile[]> {
  const zeilen = await kontext.abfrage<PvDbZeile>(
    `select id, schluessel, bezeichnung,
            max_punkte::text as max_punkte,
            bestehensschwelle_prozent::text as bestehensschwelle_prozent,
            ist_platzhalter
       from pruefverfahren
      where archiviert_am is null
      order by ist_platzhalter, bezeichnung`,
  );
  return zeilen.map((z) => ({
    id: z.id,
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    maxPunkte: z.max_punkte,
    schwelleProzent: z.bestehensschwelle_prozent,
    istPlatzhalter: z.ist_platzhalter,
  }));
}

export const PRUEFUNG_NUMMER_PRAEFIX = 'QP' as const;

async function naechsteNummer(kontext: SchreibKontext): Promise<string> {
  const [z] = await kontext.schreibe<{ jahr: string; hoechste: string | null }>(
    `select to_char(now() at time zone 'Europe/Berlin', 'YYYY') as jahr,
            max(substring(nummer from '[0-9]+$')) as hoechste
       from qualitaetspruefung
      where mandant_id = app.aktiver_mandant()
        and nummer like $1 || '-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY') || '-%'`,
    [PRUEFUNG_NUMMER_PRAEFIX],
  );
  const laufend = Number(z?.hoechste ?? '0') + 1;
  return `${PRUEFUNG_NUMMER_PRAEFIX}-${z!.jahr}-${String(laufend).padStart(4, '0')}`;
}

export interface PruefungEingabe {
  readonly objektId: string;
  readonly revierId?: string | null;
  readonly kundeId?: string | null;
  readonly pruefverfahrenId: string;
  readonly prueferAnstellungId?: string | null;
  readonly prueferExternName?: string | null;
  readonly mitKunde?: boolean;
  readonly geraeteZeit?: Date | null;
  readonly bemerkung?: string | null;
  readonly positionen: readonly {
    readonly kriterium: string;
    readonly ergebnis: 'io' | 'nio' | 'nicht_pruefbar';
    readonly punkte?: string | null;
    readonly revierRaumId?: string | null;
    readonly raumId?: string | null;
    readonly mangelBeschreibung?: string | null;
    readonly fristAm?: string | null;
  }[];
}

/**
 * Prüfung samt Befunden anlegen — und die Bewertung durch den Dienst legen.
 *
 * Die Punktesumme rechnet TypeScript (Invariante 6), nicht die Datenbank:
 * `erfuellungsgrad_prozent` ist generiert, weil ein Verhältnis deterministisch
 * ist; die Summe selbst ist eine Rechnung und gehört in eine getestete
 * Funktion.
 */
export async function erfassePruefung(
  kontext: SchreibKontext,
  eingabe: PruefungEingabe,
  bewertung: QualitaetsBewertung = schwellenBewertung,
): Promise<{ readonly id: string; readonly nummer: string; readonly bewertung: Bewertung }> {
  const [verfahren] = await kontext.schreibe<{
    max_punkte: string | null; bestehensschwelle_prozent: string | null;
  }>(
    `select max_punkte::text as max_punkte,
            bestehensschwelle_prozent::text as bestehensschwelle_prozent
       from pruefverfahren where id = $1::uuid`,
    [eingabe.pruefverfahrenId],
  );
  if (verfahren === undefined) throw new PruefungNichtGefunden(eingabe.pruefverfahrenId);

  const punkte = eingabe.positionen
    .map((p) => p.punkte)
    .filter((p): p is string => p !== null && p !== undefined);
  const summe = punkte.length === 0
    ? null
    : summiereText(punkte);

  const urteil = bewertung.bewerte({
    punkte: summe,
    maxPunkte: verfahren.max_punkte,
    schwelleProzent: verfahren.bestehensschwelle_prozent,
  });

  const nummer = await naechsteNummer(kontext);
  const [kopf] = await kontext.schreibe<{ id: string }>(
    `insert into qualitaetspruefung
       (mandant_id, nummer, objekt_id, revier_id, kunde_id, pruefverfahren_id,
        geraete_zeit, pruefer_anstellung_id, pruefer_extern_name, mit_kunde,
        punkte, max_punkte, bestanden, bemerkung, erstellt_von)
     values (app.aktiver_mandant(), $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::timestamptz, $7::uuid, $8, $9,
             $10::numeric, $11::numeric, $12::boolean, $13, app.aktueller_benutzer())
     returning id`,
    [
      nummer, eingabe.objektId, eingabe.revierId ?? null, eingabe.kundeId ?? null,
      eingabe.pruefverfahrenId, eingabe.geraeteZeit?.toISOString() ?? null,
      eingabe.prueferAnstellungId ?? null, eingabe.prueferExternName ?? null,
      eingabe.mitKunde ?? false,
      summe, verfahren.max_punkte,
      // NULL, solange O-29 offen ist — nicht `false`.
      urteil === 'unbestimmt' ? null : urteil === 'bestanden',
      eingabe.bemerkung ?? null,
    ],
  );

  for (const [index, p] of eingabe.positionen.entries()) {
    await kontext.schreibe(
      `insert into qualitaetspruefung_position
         (mandant_id, qualitaetspruefung_id, raum_id, revier_raum_id, reihenfolge,
          kriterium, ergebnis, punkte, mangel_beschreibung, frist_am, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4,
               $5, $6::pruefergebnis, $7::numeric, $8, $9::date, app.aktueller_benutzer())`,
      [
        kopf!.id, p.raumId ?? null, p.revierRaumId ?? null, index,
        p.kriterium, p.ergebnis, p.punkte ?? null,
        p.mangelBeschreibung ?? null, p.fristAm ?? null,
      ],
    );
  }

  return { id: kopf!.id, nummer, bewertung: urteil };
}

/** Dezimaltexte addieren, ohne Gleitkomma — zwei Nachkommastellen. */
export function summiereText(werte: readonly string[]): string {
  const summe = werte.reduce((s, w) => s + hundertstel(w), 0n);
  const negativ = summe < 0n;
  const abs = negativ ? -summe : summe;
  return `${negativ ? '-' : ''}${String(abs / 100n)}.${String(abs % 100n).padStart(2, '0')}`;
}
