import Image from 'next/image';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die Markenkarte der Startseite — DESIGN §4.4 und §4 "Brand-card composition".
 *
 * Zwei Dinge sind hier PFLICHT und nicht Geschmack:
 *
 *  1. **Der Ueberlagerungs-Gradient.** Jedes Bild, das Text traegt, bekommt
 *     ihn — sonst haengt die Lesbarkeit der Ueberschrift davon ab, wie hell
 *     das Foto an dieser Stelle zufaellig ist. Genau der Wert aus §4.4, nicht
 *     ein aehnlicher.
 *  2. **Der Identitaets-Hue als 3px-Oberkante.** Er sagt, um welche
 *     Gesellschaft es geht, bevor jemand die Ueberschrift liest.
 */
/** Der Pflicht-Overlay aus DESIGN §4.4 — als CSS-Variable, nicht als Literal. */
export const KARTEN_GRADIENT = 'var(--bild-overlay)';

export interface MarkenKarteProps {
  readonly bereich: BereichSchluessel;
  readonly titel: string;
  readonly anspruch: string;
  readonly href: string;
  readonly bild: { readonly pfad: string; readonly alt: string; readonly platzhalter: boolean };
}

export function MarkenKarte({ bereich, titel, anspruch, href, bild }: MarkenKarteProps) {
  return (
    <a
      href={href}
      data-cse="marken-karte"
      data-bereich={bereich}
      className="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg"
      style={{ borderTop: `3px solid var(--area-${bereich})` }}
    >
      <Image
        src={bild.pfad}
        alt={bild.alt}
        fill
        sizes="(max-width: 768px) 100vw, 25vw"
        className="object-cover transition-transform duration-[400ms] group-hover:scale-[1.03]"
      />
      {/* PFLICHT (§4.4). Ohne ihn steht der Text auf dem, was das Foto gerade hergibt. */}
      <span
        aria-hidden="true"
        data-cse="karten-gradient"
        className="absolute inset-0"
        style={{ background: KARTEN_GRADIENT }}
      />
      <span className="relative flex flex-col gap-s1 p-s4">
        <span className="text-h3 text-white">{titel}</span>
        <span className="text-sm text-white/80">{anspruch}</span>
        <span className="mt-s2 text-sm font-semibold text-red">Mehr erfahren →</span>
      </span>
      {bild.platzhalter && (
        <span
          data-cse="platzhalter-marke"
          className="absolute right-s2 top-s2 rounded-full bg-warning-soft px-s3 py-s1 text-micro text-warning"
        >
          Platzhalterbild
        </span>
      )}
    </a>
  );
}
