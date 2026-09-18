import 'server-only';
import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Pille, Feldklasse und Fehlertexte des Leistungskatalogs — NEBEN `page.tsx`.
 *
 * Beide Katalogseiten teilen sie, und eine `page.tsx` exportiert nur, was
 * Next.js kennt: jeder weitere Export bricht `pnpm build` mit „Property … is
 * incompatible with index signature", und `tsc --noEmit` sieht es nicht.
 */

/** `katalog_status` auf das FESTE Pillenvokabular aus DESIGN §5 abgebildet. */
export const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  aktiv: 'Aktiv',
  archiviert: 'Archiviert',
};

export const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  archiviert:
    'Diese Fassung ist archiviert — ihre Positionen sind unveränderlich. Andere Werte '
    + 'brauchen eine neue Fassung.',
  status_endstation:
    'Eine archivierte Fassung wird nicht wieder geöffnet: das täute das Einfrieren ihrer '
    + 'Positionen auf, ohne dass es jemand sähe.',
  schluessel_belegt:
    'Zu diesem Schlüssel gilt bereits eine aktive Fassung. Zuerst die geltende '
    + 'archivieren, dann diese aktivieren.',
  oz_belegt: 'Diese Ordnungszahl ist in dieser Fassung schon belegt.',
  ohne_wert:
    'Eine Position braucht mindestens einen Wert: Zeitwert, Leistungswert oder '
    + 'Standardeinzelpreis. Ist der richtige Wert offen (O-17, O-731), trägt sie einen '
    + 'gekennzeichneten Platzhalter — keinen leeren Wert.',
  fremder_elternteil: 'Die gewählte Elternposition gehört zu einer anderen Fassung.',
  zyklus: 'Diese Zuordnung hängt die Position unter sich selbst.',
  zahl_unlesbar:
    'Ein Zahlenfeld war nicht lesbar. Deutsch schreiben: 12,5 — der Punkt ist der '
    + 'Tausendertrenner.',
  unvollstaendig: 'Eine Pflichtangabe fehlt.',
  nicht_gefunden: 'Diese Fassung oder Position gibt es nicht.',
  kein_recht: 'Ihnen fehlt katalog.schreiben.',
};

/** Die vier Steuerkennzeichen mit ihrem deutschen Namen. */
export const KENNZEICHEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'regelsatz', text: 'Regelsatz' },
  { wert: 'ermaessigt', text: 'Ermäßigt' },
  { wert: 'steuerfrei', text: 'Steuerfrei (Norm nennen)' },
  { wert: 'reverse_charge_13b', text: '§ 13b UStG (Reverse Charge)' },
];

/** Die fünf Kostenarten. */
export const KOSTENARTEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'lohn', text: 'Lohn' },
  { wert: 'material', text: 'Material' },
  { wert: 'geraet', text: 'Gerät' },
  { wert: 'gemeinkosten', text: 'Gemeinkosten' },
  { wert: 'wagnis_gewinn', text: 'Wagnis und Gewinn' },
];
