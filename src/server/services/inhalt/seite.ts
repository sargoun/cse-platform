/**
 * Das Lesen der oeffentlichen Inhalte (PUB-07).
 *
 * Keine fest verdrahtete Kopie: eine Textaenderung ist ein UPDATE und kein
 * Deployment. Die Funktionen hier sind rein — sie bekommen eine Abfrage und
 * geben Daten zurueck, damit sich das Rendern ohne laufende Datenbank pruefen
 * laesst.
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export type AbschnittArt =
  | 'hero' | 'text' | 'markenkarten' | 'leistungen' | 'projekte'
  | 'kontakt' | 'zahlen' | 'zitat';

export interface Medium {
  readonly pfad: string;
  readonly alt: string;
  readonly platzhalter: boolean;
}

export interface Abschnitt {
  readonly id: string;
  readonly art: AbschnittArt;
  readonly reihenfolge: number;
  readonly ueberschrift: string | null;
  readonly akzentWort: string | null;
  readonly text: string | null;
  readonly medium: Medium | null;
  readonly daten: Record<string, unknown>;
}

export interface Seite {
  readonly id: string;
  readonly pfad: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly abschnitte: readonly Abschnitt[];
}

interface Zeile {
  seite_id: string; pfad: string; titel: string; beschreibung: string | null;
  abschnitt_id: string | null; art: AbschnittArt | null; reihenfolge: number | null;
  ueberschrift: string | null; akzent_wort: string | null; text: string | null;
  daten: Record<string, unknown> | null;
  medien_pfad: string | null; medien_alt: string | null; medien_platzhalter: boolean | null;
}

/** Liest eine veroeffentlichte Seite samt Abschnitten in EINER Abfrage. */
export async function ladeSeite(
  db: Abfrage, pfad: string, sprache = 'de',
): Promise<Seite | null> {
  const zeilen = (await db.unsafe(
    `select s.id seite_id, s.pfad, s.titel, s.beschreibung,
            a.id abschnitt_id, a.art, a.reihenfolge, a.ueberschrift, a.akzent_wort,
            a.text, a.daten,
            m.pfad medien_pfad, m.alt_text medien_alt, m.ist_platzhalter medien_platzhalter
       from seite s
       left join abschnitt a on a.seite_id = s.id and a.geloescht_am is null
       left join medien m on m.id = a.medien_id
      where s.pfad = $1 and s.sprache = $2
        and s.status = 'veroeffentlicht' and s.geloescht_am is null
      order by a.reihenfolge`,
    [pfad, sprache],
  )) as readonly Zeile[];

  const erste = zeilen[0];
  if (erste === undefined) return null;

  return {
    id: erste.seite_id,
    pfad: erste.pfad,
    titel: erste.titel,
    beschreibung: erste.beschreibung,
    abschnitte: zeilen
      .filter((z) => z.abschnitt_id !== null)
      .map((z) => ({
        id: z.abschnitt_id!,
        art: z.art!,
        reihenfolge: z.reihenfolge!,
        ueberschrift: z.ueberschrift,
        akzentWort: z.akzent_wort,
        text: z.text,
        daten: z.daten ?? {},
        medium: z.medien_pfad === null ? null : {
          pfad: z.medien_pfad,
          alt: z.medien_alt ?? '',
          platzhalter: z.medien_platzhalter ?? true,
        },
      })),
  };
}

export class InhaltFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'InhaltFehler'; }
}

/**
 * Prueft eine Seite, bevor sie gerendert wird.
 *
 * DESIGN §2 laesst die Schreibschrift und das rote Akzentwort **einmal je
 * Seite** zu. Zweimal ist kein Akzent mehr, sondern ein Stil — und das faellt
 * niemandem auf, der die Seite baut, sondern erst dem, der sie sieht.
 */
export function pruefeSeite(seite: Seite): void {
  const heroes = seite.abschnitte.filter((a) => a.art === 'hero');
  if (heroes.length > 1) {
    throw new InhaltFehler(
      `${seite.pfad}: ${String(heroes.length)} Hero-Abschnitte. Die Schreibschrift `
      + 'erscheint genau einmal je Seite (DESIGN §2).',
    );
  }
  const akzente = seite.abschnitte.filter(
    (a) => a.akzentWort !== null && a.akzentWort !== '',
  );
  if (akzente.length > 1) {
    throw new InhaltFehler(
      `${seite.pfad}: ${String(akzente.length)} rote Akzentwörter. Es ist genau eines `
      + '(DESIGN §2) — zwei sind kein Akzent mehr.',
    );
  }
  for (const a of seite.abschnitte) {
    if (a.medium !== null && a.medium.alt.trim().length < 3) {
      throw new InhaltFehler(
        `${seite.pfad}: Abschnitt ${a.id} hat ein Bild ohne Alternativtext. `
        + 'Für einen Screenreader ist das keine Abbildung, sondern eine Lücke.',
      );
    }
  }
}
