/**
 * Der persönliche Posteingang als EINE Liste — aus zwei Quellen (EMP-11,
 * NOT-01, NOT-03).
 *
 * **Warum das eine Rechenfunktion ist und kein `order by`.** Die beiden
 * Quellen liegen in zwei Tabellen, in zwei verschiedenen Scopes gelesen
 * (`benachrichtigung` über `empfaenger_id = app.aktueller_benutzer()`,
 * `nachricht` über die Fadenbeteiligung) und mit zwei verschiedenen
 * Zeitbegriffen. Sie in einer `union` zu mischen hiesse, eine der beiden
 * Abfragen der anderen anzupassen — und die angepasste verlöre, was sie
 * ausmacht: eine Systemmeldung hat ein ZIEL und keinen Absender, ein Faden
 * hat einen Absender, einen Verlauf und eine Antwort.
 *
 * Also: zwei ehrliche Abfragen, und genau hier die Zusammenführung — eine
 * reine Funktion ohne Datenbank, die `tests/kern/mein-posteingang.test.ts`
 * Fall für Fall prüfen kann.
 *
 * **Der Bildschirm einer Kraft heisst „Nachrichten", und was ihr geschickt
 * wurde, gehört dorthin.** Vor diesem PR zeigte er ausschliesslich
 * Systemmeldungen; eine interne Nachricht der Leitung kam nie an, weil die
 * Seite die andere Tabelle las. Unterscheidbar bleiben die beiden trotzdem —
 * `art` steht an jeder Zeile, und die Oberfläche beschriftet sie.
 */

export type EintragArt = 'meldung' | 'faden';

/** Eine Zeile des Posteingangs — gleich welcher Herkunft. */
export interface PosteingangZeile {
  readonly art: EintragArt;
  /** Die Adresse unter `/portal/mein/nachrichten/` — Meldungs-Id oder Faden-Id. */
  readonly id: string;
  readonly titel: string;
  /** Ein bis zwei Zeilen Vorschau. Nie der ganze Text. */
  readonly auszug: string;
  /** Wer geschrieben hat — bei einer Systemmeldung niemand. */
  readonly absender: string | null;
  /** Der Zeitpunkt, nach dem sortiert wird. UTC (Invariante 2). */
  readonly zeitpunkt: Date;
  /** Wie viele Zeilen davon für mich ungelesen sind. Eine Meldung: 0 oder 1. */
  readonly ungelesen: number;
  readonly mandantSlug: string | null;
  readonly mandantName: string | null;
  /** Ein abgeschlossener Faden nimmt nichts mehr auf (Invariante 8). */
  readonly geschlossen: boolean;
}

export interface Ungelesen {
  readonly meldungen: number;
  readonly faeden: number;
  readonly gesamt: number;
}

/**
 * Beide Quellen in EINER Liste, neueste zuerst.
 *
 * **Die Sortierung ist stabil und vollständig bestimmt.** Zwei Einträge mit
 * demselben Zeitstempel — im Seed und nach einem Stapellauf keine Seltenheit
 * — kämen sonst je nach Eingabereihenfolge mal so und mal so heraus, und eine
 * Liste, die sich beim Neuladen umsortiert, sieht aus wie eine, die etwas
 * verloren hat. Bei Gleichstand entscheidet deshalb die Id.
 *
 * Einträge OHNE gültigen Zeitpunkt fallen nicht heraus, sondern ans Ende:
 * etwas wegzulassen ist die eine Antwort, die ein Posteingang nie geben darf.
 */
export function mischePosteingang(
  ...quellen: readonly (readonly PosteingangZeile[])[]
): readonly PosteingangZeile[] {
  const alle = quellen.flat();
  return [...alle].sort((a, b) => {
    const za = zahl(a.zeitpunkt);
    const zb = zahl(b.zeitpunkt);
    if (za !== zb) return zb - za;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function zahl(d: Date): number {
  const t = d.getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Wie viele ungelesen — je Quelle UND zusammen.
 *
 * **Je Quelle, weil die Zahlen verschiedene Dinge bedeuten.** „3 ungelesene
 * Meldungen" heisst: drei Warnungen warten. „3 ungelesene Nachrichten" heisst:
 * drei Menschen warten auf eine Antwort. Eine einzige Summe an der Glocke
 * verwischt genau diesen Unterschied — und die Kraft, die abends auf das
 * Telefon sieht, trifft danach ihre Entscheidung.
 */
export function zaehleUngelesen(
  zeilen: readonly PosteingangZeile[],
): Ungelesen {
  let meldungen = 0;
  let faeden = 0;
  for (const z of zeilen) {
    const offen = Math.max(0, z.ungelesen);
    if (z.art === 'meldung') meldungen += offen; else faeden += offen;
  }
  return { meldungen, faeden, gesamt: meldungen + faeden };
}
