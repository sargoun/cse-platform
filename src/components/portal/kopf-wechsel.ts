import type { UmschalterHuelle } from '@/app/portal/huellen-speicher';
import { istBereich } from '@/lib/design/theme';
import type { InternSprache } from '@/lib/i18n/intern';
import {
  ausloeserName, BEREICHSWECHSEL_TEXTE, unterzeile,
} from '@/lib/i18n/verwaltung/bereichswechsel';
import { istInterneLeiste, type LeistenSchluessel } from '@/server/registry/tableiste';
import type { UmschalterBereich } from './typen';

/**
 * **Was die Kopfzeile aus den Bereichen einer Anmeldung macht** (DESIGN §6,
 * TEN-06, TEN-10, V-165, D-659).
 *
 * Eine reine Funktion, damit die Regel ohne gerenderten Rahmen geprüft werden
 * kann (`tests/kern/bereichswechsel.test.ts`):
 *
 *  - **Nicht gefragt** (`null` — die Vorschau unter `/dev/portal`, ein Rahmen
 *    ohne Tor): der Verweis „Bereich wechseln" bleibt, kein Umschalter. So
 *    stand die Kopfzeile vor V-165; niemand soll ohne Ausgang dastehen, weil
 *    ein Wert fehlte.
 *  - **Ein Bereich: nichts** — kein Umschalter, kein Verweis (TEN-06, D-43,
 *    DESIGN §6 Regel 1). Wohin sollte er führen?
 *  - **Mehr als einer:** der Verweis steht (er ist der Weg ohne JavaScript),
 *    und im internen Portal und in der Gruppenansicht dazu der Umschalter mit
 *    Live-Zählern (Regel 2) und dem Gruppeneintrag (Regel 3). Das Mitarbeiter-
 *    und das Kundenportal tragen nur den Verweis: dort ist der Bereich keine
 *    Arbeitsumgebung, sondern die Frage, in welches Portal man will.
 */
export interface KopfWechsel {
  /** „Bereich wechseln" als Verweis — Kopfzeile, Telefonmenü, `Mehr`-Blatt. */
  readonly verweis: boolean;
  /** Der Umschalter oben links — `null`: keiner. */
  readonly umschalter: KopfUmschalter | null;
}

export interface KopfUmschalter {
  readonly bereiche: readonly UmschalterBereich[];
  /** Der aktive Bereich — `null` in der Gruppenansicht. */
  readonly aktiv: string | null;
  readonly gruppenansicht: boolean;
  /** Darf diese Anmeldung die Gruppenübersicht betreten (`app.darf_gruppenansicht`)? */
  readonly gruppeSichtbar: boolean;
  /**
   * Was der Auslöser zeigt (`ausloeserName`). Der Rahmen vergleicht damit
   * seinen Titel: trägt die Seite denselben Namen — die Übersicht eines
   * Bereichs, die Gruppenübersicht —, ist der Umschalter ihr Logo (§6
   * „Placement"), und ein zweites daneben entfällt am Schreibtisch.
   */
  readonly name: string;
}

export function kopfWechsel(
  huelle: UmschalterHuelle | null,
  leiste: LeistenSchluessel,
  sprache: InternSprache,
): KopfWechsel {
  if (huelle === null) return { verweis: true, umschalter: null };
  const auswahl = huelle.stand.bereiche.length > 1;
  if (!auswahl || !istInterneLeiste(leiste)) return { verweis: auswahl, umschalter: null };

  const bereiche: readonly UmschalterBereich[] = huelle.stand.bereiche.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    unterzeile: unterzeile(e.gewerke, e.zaehler, sprache),
    /* Ein fünfter Bereich ohne eigenen Hue trägt das Zeichen der Gruppe (TEN-08). */
    bereich: istBereich(e.slug) ? e.slug : null,
  }));
  return {
    verweis: true,
    umschalter: {
      bereiche,
      aktiv: huelle.aktiverMandantId,
      gruppenansicht: huelle.gruppenansicht,
      gruppeSichtbar: huelle.stand.gruppe,
      name: ausloeserName(
        bereiche, huelle.aktiverMandantId, huelle.gruppenansicht, BEREICHSWECHSEL_TEXTE[sprache]),
    },
  };
}
