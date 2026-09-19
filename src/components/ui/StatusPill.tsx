import { PILLE_TEXTE, pilleSprache, type PillZustand } from '@/lib/i18n/pille';

export type { PillZustand };

/**
 * DESIGN §5 Status pills — a FIXED vocabulary.
 *
 * The mapping below is DESIGN's table, and the type makes an unlisted label
 * unrepresentable. That matters more than it looks: §9 says colour is never
 * the only signal, so every pill carries its text, and a free-text pill would
 * let a screen invent a state the rest of the platform does not know.
 */

const TON: Record<PillZustand, string> = {
  'In Arbeit': 'success', Aktiv: 'success', Bereit: 'success',
  Geplant: 'info', 'In Prüfung': 'info', Entwurf: 'info',
  Angebot: 'warning', Offen: 'warning', Wartet: 'warning',
  'Nur Lesen': 'warning',
  'Überfällig': 'danger', Abgelehnt: 'danger', Fehler: 'danger',
  Abgeschlossen: 'muted', Archiviert: 'muted', Inaktiv: 'muted',
};

const KLASSEN: Record<string, string> = {
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-3 text-text-muted',
};

/**
 * **`sprache` ist absichtlich freiwillig und faellt auf Deutsch.**
 *
 * Es gibt 333 Pillen in 227 Dateien. Die Angabe zur Pflicht zu machen waere
 * ein Umbau aller 227 an einem Tag — mitten in einer Umstellung, die Domaene
 * fuer Domaene laeuft. Die Wache `seite-ohne-uebersetzung` haelt die Luecke
 * stattdessen fest: eine Pille OHNE `sprache` ist dort ein Befund wie jede
 * andere feste Beschriftung, und sie verschwindet, wenn ihre Domaene
 * umgestellt wird.
 */
export function StatusPill(
  { zustand, sprache }: {
    readonly zustand: PillZustand;
    readonly sprache?: string | null;
  },
) {
  const ton = TON[zustand];
  return (
    <span
      data-ton={ton}
      /* Der Zustand steht MASCHINENLESBAR daneben, weil der sichtbare Text
         jetzt die Sprache wechselt — die Browsertests greifen den Schluessel,
         nicht das Wort. */
      data-zustand={zustand}
      className={`inline-flex items-center rounded-full px-s3 py-s1 text-xs ${KLASSEN[ton] ?? ''}`}
    >
      {PILLE_TEXTE[pilleSprache(sprache)][zustand]}
    </span>
  );
}
