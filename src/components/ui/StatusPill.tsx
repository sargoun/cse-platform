/**
 * DESIGN §5 Status pills — a FIXED vocabulary.
 *
 * The mapping below is DESIGN's table, and the type makes an unlisted label
 * unrepresentable. That matters more than it looks: §9 says colour is never
 * the only signal, so every pill carries its text, and a free-text pill would
 * let a screen invent a state the rest of the platform does not know.
 */
export type PillZustand =
  | 'In Arbeit' | 'Aktiv' | 'Bereit'
  | 'Geplant' | 'In Prüfung' | 'Entwurf'
  | 'Angebot' | 'Offen' | 'Wartet'
  // Ein MODUS, kein Datensatzzustand — der einzige, und deshalb allein
  // stehend (DESIGN §5, verlangt von §6).
  | 'Nur Lesen'
  | 'Überfällig' | 'Abgelehnt' | 'Fehler'
  | 'Abgeschlossen' | 'Archiviert';

const TON: Record<PillZustand, string> = {
  'In Arbeit': 'success', Aktiv: 'success', Bereit: 'success',
  Geplant: 'info', 'In Prüfung': 'info', Entwurf: 'info',
  Angebot: 'warning', Offen: 'warning', Wartet: 'warning',
  'Nur Lesen': 'warning',
  'Überfällig': 'danger', Abgelehnt: 'danger', Fehler: 'danger',
  Abgeschlossen: 'muted', Archiviert: 'muted',
};

const KLASSEN: Record<string, string> = {
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-3 text-text-muted',
};

export function StatusPill({ zustand }: { readonly zustand: PillZustand }) {
  const ton = TON[zustand];
  return (
    <span
      data-ton={ton}
      className={`inline-flex items-center rounded-full px-s3 py-s1 text-xs ${KLASSEN[ton] ?? ''}`}
    >
      {zustand}
    </span>
  );
}
