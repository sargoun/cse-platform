import type { BereichSchluessel } from '@/lib/design/theme';

/** Ein Bereich, wie ihn der Umschalter zeigt. */
export interface UmschalterBereich {
  readonly id: string;
  readonly slug: string;
  /** Der Anzeigename — `mandant.name`. */
  readonly name: string;
  /** Das Gewerk, als Unterzeile: „Reinigung · 24 Aufträge". */
  readonly gewerk: string;
  /** Der LIVE gezählte Wert. `null` = der Benutzer darf ihn nicht sehen. */
  readonly zaehler: number | null;
  /** Das Wort hinter der Zahl — „Aufträge", „Projekte". */
  readonly zaehlerWort: string;
  /** Der Identitäts-Hue aus DESIGN §1. */
  readonly bereich: BereichSchluessel;
}
