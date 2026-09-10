import { ICON_GROESSEN, ICON_PFADE, type IconGroesse, type IconName } from '@/lib/design/icons';

/**
 * Ein Icon aus dem geschlossenen Satz (DESIGN §5 "Icons").
 *
 * Zwei Betriebsarten, und der Unterschied ist eine Barrierefreiheitsfrage,
 * keine Geschmacksfrage (DESIGN §9, BFSG):
 *
 * - **Neben Text** — der Regelfall. Das Icon ist Dekoration, der Text traegt
 *   die Bedeutung. `aria-hidden`, kein Name, keine Rolle. Ein Screenreader,
 *   der hier "Grafik Uhr" vorliest, sagt dasselbe zweimal.
 * - **Allein** — dann traegt es die Bedeutung und braucht einen Namen.
 *   `titel` setzt ihn; ohne `titel` bleibt ein alleinstehendes Icon fuer
 *   einen Screenreader eine leere Schaltflaeche.
 *
 * Die Farbe kommt aus `currentColor` und wird hier nicht gesetzt: dasselbe
 * Icon steht im aktiven Navigationspunkt weiss, in der Danger-Pille rot und
 * in der KPI-Kachel im Ton der Kachel — ohne zweite Datei.
 */
export interface IconProps {
  readonly name: IconName;
  readonly groesse?: IconGroesse;
  /** Der zugaengliche Name. Nur setzen, wenn das Icon ALLEIN steht. */
  readonly titel?: string;
  readonly className?: string;
}

export function Icon({ name, groesse = 'lg', titel, className }: IconProps) {
  const px = ICON_GROESSEN[groesse];
  const beschriftet = titel !== undefined && titel !== '';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // Sichtbar fuer die Vorlesetechnik nur, wenn das Icon allein steht.
      role={beschriftet ? 'img' : undefined}
      aria-label={beschriftet ? titel : undefined}
      aria-hidden={beschriftet ? undefined : true}
      focusable="false"
      data-icon={name}
    >
      <path d={ICON_PFADE[name]} />
    </svg>
  );
}
