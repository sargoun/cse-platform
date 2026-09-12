/**
 * Eine erzeugte Benachrichtigung IN DIE DATENBANK schreiben (NOT-01).
 *
 * **Warum es das geben muss.** `erzeuge()` baut eine Benachrichtigung — Titel,
 * Text, Ziel, Kanaele — und gibt sie zurueck. Bis hierher hat sie niemanden
 * erreicht: sie ist ein Objekt im Speicher eines Nachtlaufs, der gleich endet.
 * Im ganzen Zweig gab es keine einzige Stelle, die `insert into
 * benachrichtigung` ausfuehrt. Der EMP-08-Warnweg war damit vollstaendig
 * gebaut und vollstaendig wirkungslos: die Quittung in `nachweis_warnung`
 * entstand, die Meldung nicht — und weil die Quittung verhindert, dass eine
 * Stufe zweimal anschlaegt, war die Warnung danach fuer immer weg.
 *
 * **Der Empfaenger ist ein `benutzer`, die Quelle kennt eine `person`.**
 * Das ist kein Schoenheitsfehler, sondern D-09: der Mensch und sein Zugang
 * sind zwei Dinge. Wer keinen Zugang hat — und das sind heute die meisten,
 * solange PR 20 offen ist —, bekommt keine Zeile. Das wird GEMELDET und nicht
 * verschluckt: eine Warnung, die niemanden erreicht, ist keine Warnung, und
 * der Bericht des Laufs muss das sagen koennen.
 *
 * **Der In-App-Eintrag ist die Zustellung, nicht ihr Anfang.** Push, Mail und
 * SMS haengen an Diensten, die nicht verbunden sind (CLAUDE.md „no fake
 * integrations"); was hier entsteht, ist der Posteingang, den die Person im
 * Portal sieht. Sobald ein Kanal verbunden ist, liest er diese Zeilen — er
 * ersetzt sie nicht.
 */
import type { ErzeugteBenachrichtigung } from './registry.js';

/*
 * Methodensyntax, nicht Eigenschaftssyntax — wie ueberall sonst im Baum
 * (`generator.ts`, `ablauf.ts`, `postgres-protokoll.ts`). TypeScript prueft
 * Methoden bivariant und Funktionseigenschaften streng kontravariant; mit
 * `unsafe: (…) => …` laesst sich `postgres.Sql` hier gar nicht uebergeben,
 * weil dessen Parameterliste ein veraenderliches Array verlangt.
 */
export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface Zustellauftrag {
  readonly benachrichtigung: ErzeugteBenachrichtigung;
  /** Der MENSCH. Der Zugang wird hier aufgeloest, nicht vom Aufrufer. */
  readonly personId: string;
  readonly objektTyp: string;
  readonly objektId: string | null;
}

export interface Zustellbericht {
  readonly zugestellt: number;
  /** Je Auftrag, der NIEMANDEN erreicht hat — mit dem Grund. */
  readonly ohneEmpfaenger: readonly { personId: string; art: string; grund: string }[];
}

/**
 * Schreibt die Auftraege in den Posteingang und sagt, was nicht ankam.
 *
 * Je Auftrag hoechstens EINE Zeile: der Empfaenger wird ueber
 * `benutzer_person_key` aufgeloest, und der Index laesst nur einen
 * nicht-deaktivierten Zugang je Mensch zu (EMP-14).
 *
 * Kein `on conflict`: die Eindeutigkeit liegt eine Ebene hoeher. Im
 * Ablaufweg entsteht die Zeile in `nachweis_warnung` VOR dieser Zustellung
 * und genau einmal je (Nachweis, Gueltigkeit, Stufe) — wer dort null Zeilen
 * trifft, kommt hier gar nicht an (K-09).
 */
export async function stelleZu(
  db: Abfrage, auftraege: readonly Zustellauftrag[],
): Promise<Zustellbericht> {
  const ohneEmpfaenger: { personId: string; art: string; grund: string }[] = [];
  let zugestellt = 0;

  for (const auftrag of auftraege) {
    /**
     * **Deckungsgleich mit `benutzer_person_key`** — und deshalb liefert die
     * Abfrage hoechstens EINE Zeile, ohne dass jemand darauf hoffen muss.
     *
     * 0007 legt den Index als `unique … on benutzer (person_id) where
     * person_id is not null and deaktiviert_am is null` an: EIN Login je
     * Mensch (EMP-14, D-09). Der erste Entwurf hier filterte auf
     * `status = 'aktiv'`, sortierte nach `erstellt_am` und behandelte den
     * Fall „mehrere Zugaenge" — toter Code gegen etwas, das das Schema
     * verhindert. Gefunden hat es der Test, der genau diesen Fall herstellen
     * wollte und an `duplicate key value violates unique constraint
     * "benutzer_person_key"` scheiterte.
     *
     * `deaktiviert_am is null` MUSS dabei mit: nur diese Bedingung macht die
     * Abfrage zur Teilmenge des Index. `status` allein tut es nicht — die
     * beiden Spalten bewegen sich per Gewohnheit zusammen, nicht per
     * Bedingung.
     */
    const konten = (await db.unsafe(
      `select id from benutzer
        where person_id = $1::uuid and status = 'aktiv' and deaktiviert_am is null`,
      [auftrag.personId],
    )) as readonly { id: string }[];

    if (konten.length === 0) {
      ohneEmpfaenger.push({
        personId: auftrag.personId,
        art: auftrag.benachrichtigung.art,
        grund: 'Kein aktiver Zugang zu dieser Person (D-09) — PR 20 steht aus.',
      });
      continue;
    }

    const b = auftrag.benachrichtigung;
    await db.unsafe(
      `insert into benachrichtigung
         (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
       values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)`,
      [b.mandantId, konten[0]!.id, b.art, b.titel, b.text, b.ziel,
        auftrag.objektTyp, auftrag.objektId, b.sammelbar],
    );
    zugestellt += 1;
  }

  return { zugestellt, ohneEmpfaenger };
}
