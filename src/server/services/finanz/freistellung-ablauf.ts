import { tagePlus } from '../../../lib/datum/kalendertag.js';
import { tageZwischen } from '../nachweis/gueltigkeit.js';

/**
 * Der Hinweis vor dem Ablauf der EIGENEN Freistellungsbescheinigung nach
 * § 48b EStG (V-388, O-130, D-846).
 *
 * **Warum es ihn braucht.** Ohne gültige eigene Bescheinigung behält jeder
 * Kunde, an den die Gesellschaft eine Bauleistung abrechnet, 15 % ein (§ 48
 * EStG) — und eine neue stellt das Finanzamt nicht über Nacht aus. Ein
 * Ablaufdatum, an das niemand erinnert wird, fällt erst an der ersten
 * gekürzten Zahlung auf.
 *
 * // TODO(client, O-130): Voreinstellung — Buchhaltung und Geschäftsführung erfahren 60, 30 und 7 Tage vor dem Ablauf davon (wie bei Nachweisen, EMP-08), solange keine Nachfolgerin erfasst ist; den neuen Antrag stellt die Buchhaltung beim Finanzamt. D-846.
 *
 * **Rein bis auf die Eingabe.** `ablaufStufe` und `eigeneAblaeufe` rechnen
 * aus Kalendertagen und der Liste der eigenen Bescheinigungen; der Stichtag
 * kommt aus der Datenbank (Invariante 5), nie aus der Uhr des Prozesses.
 */

/** Die Stufen des Hinweises in Tagen vor dem Ablauf (Voreinstellung O-130). */
export const ABLAUF_STUFEN = [60, 30, 7] as const;
export type AblaufStufe = (typeof ABLAUF_STUFEN)[number];

/**
 * Die Stufe für `tage` Tage bis zum Ablauf — die kleinste, die sie noch
 * enthält. Am letzten Tag (0) und in der letzten Woche gilt 7; mehr als 60
 * oder schon abgelaufen (< 0): keine.
 */
export function ablaufStufe(tage: number): AblaufStufe | null {
  if (!Number.isInteger(tage) || tage < 0) return null;
  for (const stufe of [...ABLAUF_STUFEN].sort((a, b) => a - b)) {
    if (tage <= stufe) return stufe;
  }
  return null;
}

/** Eine eigene Bescheinigung, wie die Prüfung sie braucht. */
export interface EigeneBescheinigung {
  readonly id: string;
  readonly nummer: string;
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly widerrufenAm: string | null;
  readonly umfang: 'unbeschraenkt' | 'auftragsbezogen';
  readonly auftragId: string | null;
}

export interface AblaufLage {
  readonly id: string;
  readonly nummer: string;
  readonly gueltigBis: string;
  /** Tage bis einschliesslich dem letzten gültigen Tag. */
  readonly tage: number;
  readonly stufe: AblaufStufe;
}

/**
 * Welche eigenen Bescheinigungen am Tag `heute` einen Hinweis brauchen.
 *
 * Eine braucht ihn, wenn sie nicht widerrufen ist, höchstens 60 Tage vor
 * ihrem Ablauf steht — und keine NACHFOLGERIN hat: eine andere eigene
 * Bescheinigung, die am Tag danach gilt (nicht widerrufen, im Zeitraum) und
 * dasselbe deckt (unbeschränkt, oder für denselben Auftrag). Wer die neue
 * schon erfasst hat, wird nicht mehr erinnert.
 */
export function eigeneAblaeufe(
  zeilen: readonly EigeneBescheinigung[], heute: string,
): readonly AblaufLage[] {
  const lagen: AblaufLage[] = [];
  for (const b of zeilen) {
    if (b.widerrufenAm !== null) continue;
    const stufe = ablaufStufe(tageZwischen(heute, b.gueltigBis));
    if (stufe === null) continue;
    const danach = tagePlus(b.gueltigBis, 1);
    const nachfolgerin = zeilen.some((n) => n.id !== b.id
      && (n.widerrufenAm === null || n.widerrufenAm > danach)
      && n.gueltigVon <= danach && n.gueltigBis >= danach
      && (n.umfang === 'unbeschraenkt'
        || (b.umfang === 'auftragsbezogen' && n.auftragId === b.auftragId)));
    if (nachfolgerin) continue;
    lagen.push({
      id: b.id, nummer: b.nummer, gueltigBis: b.gueltigBis,
      tage: tageZwischen(heute, b.gueltigBis), stufe,
    });
  }
  return lagen.sort((a, b) => a.tage - b.tage);
}
