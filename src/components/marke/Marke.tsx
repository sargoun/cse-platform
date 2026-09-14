import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die Marken der Gruppe — ein Bildzeichen je Gesellschaft und eines fuer die
 * Gruppe (DESIGN §1 „Marken und Bildzeichen").
 *
 * **Vorlaeufig, und das steht dazu.** Die offiziellen Logodateien liegen
 * nicht vor (O-12). Bis dahin tragen die vier Gesellschaften ein
 * geometrisches Zeichen in ihrer Identitaetsfarbe (§1) auf demselben
 * Kachelraster — erkennbar zusammengehoerig, erkennbar verschieden, und mit
 * einem Glyph, der das Gewerk nennt. Die Gruppe traegt die vier Farben auf
 * einer Kachel in `--ink`: vier Gesellschaften, ein Haus.
 *
 * **Nur Tokens.** Flaechen sind `var(--area-*)`, `var(--ink)`, `var(--red)`;
 * der Glyph ist `var(--white)` mit Strichstaerke 2 auf einem 24er-Raster,
 * runde Enden — dieselbe Zeichensprache wie die Icons (§5). Das Zeichen
 * wird nie gestreckt: `width` und `height` sind gleich, und die Groesse
 * kommt aus der Tabelle in DESIGN §1, nicht aus einer Zahl im Aufruf.
 *
 * `aria-hidden`: neben dem Namen ist das Zeichen Schmuck; steht es allein
 * (Favicon, Avatar), traegt das Elternelement den Namen.
 */
export type MarkeArt = BereichSchluessel | 'gruppe';

export type MarkeGroesse = 'sm' | 'md' | 'lg' | 'xl';

/** DESIGN §1: `marke-sm` 24 · `marke-md` 32 · `marke-lg` 40 · `marke-xl` 56. */
const PX: Record<MarkeGroesse, number> = { sm: 24, md: 32, lg: 40, xl: 56 };

/** Die Glyphen — Pfade auf 24×24, Strich 2, runde Enden, kein Fuellen. */
const GLYPH: Record<BereichSchluessel, string> = {
  /* Reinigung: ein Bogen, der Flaeche frei wischt, und ein Glanzpunkt. */
  reinigung: 'M15.5 8.3a5 5 0 1 0 0 7.4M17.5 5.5v3M16 7h3',
  /* Security: ein Schild mit Haken. */
  security: 'M12 4.5l5.5 2.2v4.6c0 3.7-2.3 6.3-5.5 8.2-3.2-1.9-5.5-4.5-5.5-8.2V6.7zM9.6 12.1l1.7 1.7 3.2-3.4',
  /* Bau: zwei Baukoerper auf einer Grundlinie. */
  bau: 'M4.5 19h15M7 19V6.5h5V19M12 19v-7.5h5V19M9.5 9.5h.01M9.5 12.5h.01M14.5 14.5h.01',
  /* Operations: vier Knoten, ein Netz. */
  operations: 'M8 8h8M8 16h8M8 8v8M16 8v8M8 8m-1.8 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M16 8m-1.8 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M8 16m-1.8 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0M16 16m-1.8 0a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 1 0-3.6 0',
};

export function Marke({ art, groesse = 'md', className = '' }: {
  readonly art: MarkeArt;
  readonly groesse?: MarkeGroesse;
  readonly className?: string;
}) {
  const px = PX[groesse];
  return (
    <svg
      aria-hidden="true"
      data-cse="marke"
      data-art={art}
      viewBox="0 0 24 24"
      width={px}
      height={px}
      className={`shrink-0 ${className}`}
    >
      {art === 'gruppe' ? (
        <>
          <rect width="24" height="24" rx="6" fill="var(--ink)" />
          <circle cx="8.5" cy="8.5" r="3" fill="var(--area-reinigung)" />
          <circle cx="15.5" cy="8.5" r="3" fill="var(--area-security)" />
          <circle cx="8.5" cy="15.5" r="3" fill="var(--area-bau)" />
          <circle cx="15.5" cy="15.5" r="3" fill="var(--area-operations)" />
        </>
      ) : (
        <>
          <rect width="24" height="24" rx="6" fill={`var(--area-${art})`} />
          <path
            d={GLYPH[art]}
            fill="none"
            stroke="var(--white)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}

/**
 * Das Logo: Zeichen und Name nebeneinander — die eine Form, in der eine
 * Marke im Kopf, im Fuss und auf einer Karte steht.
 *
 * Der Name kommt vom Aufrufer (aus `mandant.name` oder der
 * `plattform_einstellung`), nie aus dieser Datei: die Datenbank fuehrt ihn,
 * und ein zweiter Ort waere der, den niemand nachpflegt.
 */
export function Logo({ art, name, groesse = 'md', href, className = '', nurZeichen = false }: {
  readonly art: MarkeArt;
  readonly name: string;
  readonly groesse?: MarkeGroesse;
  readonly href?: string;
  readonly className?: string;
  /** Der Name bleibt fuer Screenreader, verschwindet aber sichtbar (enge Kopfzeilen). */
  readonly nurZeichen?: boolean;
}) {
  const schrift = groesse === 'xl' ? 'text-h2' : groesse === 'lg' ? 'text-h3' : 'text-base font-semibold';
  const inhalt = (
    <>
      <Marke art={art} groesse={groesse} />
      <span className={`min-w-0 truncate tracking-tight text-text ${schrift} ${nurZeichen ? 'sr-only' : ''}`}>
        {name}
      </span>
    </>
  );
  const klassen = `inline-flex min-w-0 items-center gap-s2 ${className}`;
  if (href !== undefined) {
    return (
      <a href={href} data-cse="logo" data-art={art} className={`${klassen} min-h-11`}>
        {inhalt}
      </a>
    );
  }
  return <span data-cse="logo" data-art={art} className={klassen}>{inhalt}</span>;
}
