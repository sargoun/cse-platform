import Image from 'next/image';
import { Marke } from '@/components/marke/Marke';
import type { BereichSchluessel } from '@/lib/design/theme';
import { shellTexte } from '@/lib/i18n/texte';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

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
  /**
   * Die Karte erscheint auf `/` UND auf `/en`.
   *
   * Ohne diese Angabe stand hier „Mehr erfahren →" und „Platzhalterbild" als
   * deutsches Literal — auf der englischen Startseite. D-82 sagt, eine
   * englische Seite ist eine eigene Zeile; fuer Bedienwoerter ist die Zeile
   * `SHELL_TEXTE`, und ein fehlender Eintrag dort ist ein Bauzeitfehler statt
   * eines deutschen Wortes fuer jemanden, der kein Deutsch kann.
   */
  readonly sprache?: Sprache;
}

export function MarkenKarte({
  bereich, titel, anspruch, href, bild, sprache = VORGABE_SPRACHE,
}: MarkenKarteProps) {
  const t = shellTexte(sprache);
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
        className="object-cover transition-transform duration-slow ease-brand group-hover:scale-[1.03]"
      />
      {/* PFLICHT (§4.4). Ohne ihn steht der Text auf dem, was das Foto gerade hergibt. */}
      <span
        aria-hidden="true"
        data-cse="karten-gradient"
        className="absolute inset-0"
        style={{ background: KARTEN_GRADIENT }}
      />
      <span className="relative flex flex-col gap-s1 p-s4">
        <Marke art={bereich} groesse="md" className="mb-s2" />
        <span className="text-h3 text-white">{titel}</span>
        {/*
          * Zwei Zeilen, immer — auch wenn der Anspruch nur eine braucht.
          *
          * Die Karten richten ihren Text am UNTEREN Rand aus. Ein einzeiliger
          * Anspruch schob den Titel deshalb eine Zeile tiefer als beim
          * Nachbarn, und in einer Reihe von vier Karten standen die vier
          * Namen auf drei verschiedenen Hoehen. Das liest sich als
          * Unordnung, bevor man es benennen kann. `line-clamp-2` haelt die
          * lange Variante ebenfalls bei zwei.
          */}
        <span className="line-clamp-2 min-h-[3em] text-sm text-white/80">{anspruch}</span>
        <span className="mt-s2 text-sm font-semibold text-brand">{t.mehrErfahren}</span>
      </span>
      {bild.platzhalter && (
        <span
          data-cse="platzhalter-marke"
          className="absolute right-s2 top-s2 rounded-full bg-warning-soft px-s3 py-s1 text-micro text-warning"
        >
          {t.platzhalterbild}
        </span>
      )}
    </a>
  );
}
