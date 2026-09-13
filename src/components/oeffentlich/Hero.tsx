import Image from 'next/image';
import { KARTEN_GRADIENT } from './MarkenKarte';
import { shellTexte } from '@/lib/i18n/texte';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * Der Hero — 21:9 am Schreibtisch, 4:5 am Telefon (DESIGN §4.5).
 *
 * Die Schreibschrift erscheint hier und **nur** hier: DESIGN §2 laesst sie
 * einmal je Seite zu. Zweimal ist sie kein Akzent mehr, sondern ein Stil.
 * Ebenso das eine rote Akzentwort — es kommt als eigenes Feld aus der
 * Datenbank, damit es nicht als Markup im Fliesstext landet.
 */
export interface HeroProps {
  readonly ueberschrift: string;
  /** Das EINE rote Wort. Wird an die Ueberschrift angehaengt. */
  readonly akzentWort?: string | null;
  readonly text?: string | null;
  readonly bild: { readonly pfad: string; readonly alt: string; readonly platzhalter: boolean };
  /** Dieselbe Begruendung wie bei `MarkenKarte`: das Schild erscheint auch auf `/en`. */
  readonly sprache?: Sprache;
}

export function Hero({
  ueberschrift, akzentWort, text, bild, sprache = VORGABE_SPRACHE,
}: HeroProps) {
  const t = shellTexte(sprache);
  return (
    <section
      data-cse="hero"
      className="relative flex aspect-[4/5] flex-col justify-end overflow-hidden md:aspect-[21/9]"
    >
      <Image
        src={bild.pfad}
        alt={bild.alt}
        fill
        // `priority` NUR hier (§4.6): auf jedem Bild gesetzt heisst es nichts.
        priority
        sizes="100vw"
        className="object-cover"
      />
      <span aria-hidden="true" className="absolute inset-0" style={{ background: KARTEN_GRADIENT }} />
      {/*
        * `mx-auto` und derselbe Seitenabstand wie die Abschnitte darunter.
        *
        * `max-w-content` ohne `mx-auto` heisst linksbuendig: auf 1440px begann
        * die Ueberschrift bei 32px, die Karten darunter bei 104px — zwei
        * Kanten auf einer Seite, und das Auge sieht es, ohne es benennen zu
        * koennen. DESIGN §3 nennt die Breite (`1280px`); wo sie steht, sagt
        * erst die Zentrierung.
        */}
      <div className="relative mx-auto flex w-full max-w-content flex-col gap-s3
                      px-s5 py-s6 cse-auftritt">
        <h1 className="text-h1 text-white">
          {ueberschrift}
          {akzentWort !== null && akzentWort !== undefined && akzentWort !== '' && (
            <>
              {' '}
              <span data-cse="akzent-wort" className="text-brand">{akzentWort}</span>
            </>
          )}
        </h1>
        {text !== null && text !== undefined && text !== '' && (
          <p className="max-w-prose text-base text-white/85">{text}</p>
        )}
      </div>
      {bild.platzhalter && (
        <span
          data-cse="platzhalter-marke"
          className="absolute right-s3 top-s3 rounded-full bg-warning-soft px-s3 py-s1 text-micro text-warning"
        >
          {t.platzhalterbild}
        </span>
      )}
    </section>
  );
}
