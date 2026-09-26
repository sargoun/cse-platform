import 'server-only';

/**
 * Der Anschluss an eine fremde Plattform — **als Vertrag, nicht als Zusage**
 * (SOC-06, SOC-07).
 *
 * Genau der Aufbau von `versand/email.ts` und `auth/sms.ts`, und aus demselben
 * Grund: ein Adapter, der `true` zurueckgibt, ohne zu senden, laesst jeden
 * Bildschirm fertig aussehen und faellt erst dem Menschen auf, der den Beitrag
 * bei Instagram sucht und nicht findet.
 *
 * **`nicht verbunden` ist ein ERGEBNIS, kein Fehler.** Es wird gefangen,
 * gespeichert und angezeigt (`beitrag_kanal.ergebnis`); der Beitrag bleibt
 * bestehen, die uebrigen Kanaele laufen weiter, und auf dem Bildschirm steht,
 * welcher Kanal wartet und warum. Ein abgebrochener Lauf waere hier die
 * schlechtere Antwort: er machte aus einem bekannten Zustand einen Vorfall.
 *
 * **Die eigene Website ist hier nicht vertreten.** Sie ist kein Anschluss,
 * sondern diese Plattform selbst (SOC-05, `0163`): ein freigegebener Beitrag
 * steht auf der Gesellschaftsseite, weil sein Status es sagt.
 */

export type Plattform = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube';

export const PLATTFORMEN: readonly Plattform[] = [
  'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube',
] as const;

/** Wie die Plattform beim Namen genannt wird — auf dem Bildschirm. */
export const PLATTFORM_NAME: Readonly<Record<Plattform, string>> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

export function istPlattform(wert: string): wert is Plattform {
  return (PLATTFORMEN as readonly string[]).includes(wert);
}

export interface BeitragAuftrag {
  readonly beitragId: string;
  readonly titel: string;
  readonly text: string;
  /**
   * Die absolute Adresse des Beitrags auf der eigenen Seite. Jede Plattform
   * will einen Link, und ein relativer waere dort dasselbe Nichts wie in einer
   * E-Mail (D-532).
   */
  readonly adresse: string | null;
  /**
   * Das Bild des Beitrags (SOC-02, V-225) — eine ABSOLUTE Adresse, unter der
   * die Plattform es abholt, oder nichts. Instagram, TikTok und YouTube
   * verlangen Medien; ein Adapter für sie prüft dieses Feld, statt ohne Bild
   * „veröffentlicht" zu melden.
   */
  readonly medien?: {
    readonly url: string;
    readonly mimeTyp: string;
    readonly alt: string;
  };
}

export interface Veroeffentlicht {
  /** Die Kennung auf der fremden Plattform — der einzige Beleg, dass es ankam. */
  readonly externeRef: string;
}

export class KanalNichtVerbundenFehler extends Error {
  constructor(readonly plattform: Plattform, readonly grund: string) {
    super(grund);
    this.name = 'KanalNichtVerbundenFehler';
  }
}

export interface SocialKanalPort {
  readonly plattform: Plattform;
  readonly verbunden: boolean;
  /** Warum nicht verbunden — dieser Satz steht so auf dem Bildschirm. */
  readonly hinweis: string;
  veroeffentliche(auftrag: BeitragAuftrag): Promise<Veroeffentlicht>;
}
