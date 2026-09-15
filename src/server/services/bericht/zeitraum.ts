import 'server-only';

/**
 * Der Zeitraum, über den ein Bericht spricht — an EINER Stelle.
 *
 * **Warum es das getrennt gibt.** Sechs Berichte fragen dieselbe Frage („von
 * wann bis wann"), und jeder von ihnen könnte sie anders beantworten. Eine
 * Umsatzzahl für „dieses Jahr" und eine Auftragszahl für „letzte 365 Tage"
 * stehen dann nebeneinander auf einem Bildschirm und widersprechen sich, ohne
 * dass es jemand merkt.
 *
 * **Die Grenzen sind BERLINER Kalendertage** (Invariante 2). Ein Monat endet
 * nicht 24 Stunden nach seinem Anfang, und ein Geschäftsjahr schon gar nicht.
 * Gerechnet wird trotzdem über UTC-Zeitpunkte — die Umrechnung macht die
 * Datenbank, weil nur sie die Zeitzonendatenbank hat.
 */

export type Granularitaet = 'monat' | 'quartal' | 'jahr';

export interface Zeitraum {
  /** `YYYY-MM-DD`, Berliner Kalendertag, einschliesslich. */
  readonly von: string;
  /** `YYYY-MM-DD`, Berliner Kalendertag, einschliesslich. */
  readonly bis: string;
  readonly bezeichnung: string;
}

const MONATE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

function tag(jahr: number, monat: number, t: number): string {
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

/** Der letzte Tag eines Monats — Schaltjahr eingeschlossen. */
export function letzterTag(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/**
 * Ein Jahr in seine Abschnitte zerlegen.
 *
 * Kein Kalenderjahr-Zwang: `versatz` verschiebt den Anfang, damit ein
 * abweichendes Wirtschaftsjahr (O-05) dieselbe Funktion benutzt. Ohne
 * Versatz ist es der Kalender.
 */
export function abschnitte(
  jahr: number, koernung: Granularitaet, versatzMonate = 0,
): readonly Zeitraum[] {
  if (koernung === 'jahr') {
    const start = verschiebe(jahr, 1, versatzMonate);
    const ende = verschiebe(jahr, 13, versatzMonate);
    return [{
      von: tag(start.jahr, start.monat, 1),
      bis: vortag(ende.jahr, ende.monat),
      bezeichnung: versatzMonate === 0 ? String(jahr) : `Wirtschaftsjahr ${String(jahr)}`,
    }];
  }

  const schritt = koernung === 'quartal' ? 3 : 1;
  const stuecke: Zeitraum[] = [];
  for (let i = 0; i < 12; i += schritt) {
    const start = verschiebe(jahr, 1 + i, versatzMonate);
    const ende = verschiebe(jahr, 1 + i + schritt, versatzMonate);
    stuecke.push({
      von: tag(start.jahr, start.monat, 1),
      bis: vortag(ende.jahr, ende.monat),
      bezeichnung: koernung === 'quartal'
        ? `Q${String(Math.floor(i / 3) + 1)} ${String(start.jahr)}`
        : `${MONATE[start.monat - 1]!} ${String(start.jahr)}`,
    });
  }
  return stuecke;
}

function verschiebe(jahr: number, monat: number, versatz: number): { jahr: number; monat: number } {
  const roh = (monat - 1) + versatz;
  return { jahr: jahr + Math.floor(roh / 12), monat: (((roh % 12) + 12) % 12) + 1 };
}

/** Der Tag vor dem Ersten des genannten Monats. */
function vortag(jahr: number, monat: number): string {
  const vor = monat === 1 ? { jahr: jahr - 1, monat: 12 } : { jahr, monat: monat - 1 };
  return tag(vor.jahr, vor.monat, letzterTag(vor.jahr, vor.monat));
}

/** Das ganze Jahr als EIN Zeitraum. */
export function ganzesJahr(jahr: number, versatzMonate = 0): Zeitraum {
  return abschnitte(jahr, 'jahr', versatzMonate)[0]!;
}

/**
 * Das Jahr aus einer Abfrage — oder das laufende.
 *
 * **Das laufende Jahr kommt vom AUFRUFER**, nicht aus `new Date()`: die Uhr
 * des Anwendungsservers entscheidet sonst darüber, welches Jahr ein Bericht
 * zeigt (Invariante 5). Die Seiten reichen `app.berlin_heute()` durch.
 */
export function jahrAus(roh: unknown, heute: string): number {
  const laufend = Number(heute.slice(0, 4));
  if (typeof roh !== 'string' || !/^\d{4}$/u.test(roh)) return laufend;
  const jahr = Number(roh);
  // Kein Bericht über das Jahr 0 und keiner über 9999: beides wäre eine
  // Abfrage, die nur Zeit kostet.
  return jahr >= 2000 && jahr <= laufend + 1 ? jahr : laufend;
}
