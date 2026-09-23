import Image from 'next/image';
import { Marke, MarkenLogo, type MarkeArt } from '@/components/marke/Marke';
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
  /**
   * Die Zeile ueber der Ueberschrift — Zeichen und Name der Gesellschaft
   * oder der Gruppe. Fehlt sie, steht die Ueberschrift allein (Unterseiten).
   */
  readonly marke?: {
    readonly art: MarkeArt;
    readonly name: string;
    /** Der hochgeladene Avatar statt des vorläufigen Zeichens (V-100). */
    readonly avatar?: { readonly adresse: string } | null;
    /**
     * Das Logo für DUNKLE Flächen (V-100, DESIGN §1): der Hero liegt auf dem
     * Verlauf aus §4.4. Das helle Logo steht hier nie — es verschwände darauf.
     */
    readonly logo?: { readonly adresse: string; readonly alt: string } | null;
  } | null;
  /**
   * Die Handlungen unter dem Text: der rote Knopf und ein Ghost-Verweis
   * (DESIGN §5 Buttons). Nur die Startseite und die Gesellschaftsseiten
   * tragen sie — ein Impressum ruft zu nichts auf.
   */
  readonly aufrufe?: readonly { readonly href: string; readonly text: string; readonly primaer: boolean }[];
}

export function Hero({
  ueberschrift, akzentWort, text, bild, sprache = VORGABE_SPRACHE, marke = null, aufrufe = [],
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
        {/*
          * `text-display`, nicht `text-h1`: DESIGN §2 nennt die 56/60-Stufe
          * ausdruecklich fuer die Hero-Ueberschrift, und auf dem Telefon faellt
          * sie ueber die §2-Mobilskala auf 36/40 (globals.css). Mit `h1` stand
          * der Hero am Schreibtisch eine Stufe zu klein und am Telefon eine zu
          * gross.
          */}
        {marke !== null && (
          <p data-cse="hero-marke" className="m-0 flex items-center gap-s2 text-sm font-semibold text-white/85">
            {marke.logo !== null && marke.logo !== undefined ? (
              <MarkenLogo bild={marke.logo} groesse="lg" />
            ) : (
              <>
                <Marke art={marke.art} groesse="md" bild={marke.avatar ?? null} />
                <span>{marke.name}</span>
              </>
            )}
          </p>
        )}
        <h1 className="text-display text-white">
          {ueberschrift}
          {akzentWort !== null && akzentWort !== undefined && akzentWort !== '' && (
            <>
              {' '}
              <span data-cse="akzent-wort" className="text-brand">{akzentWort}</span>
            </>
          )}
        </h1>
        {text !== null && text !== undefined && text !== '' && (
          <p className="max-w-prose text-lg text-white/85">{text}</p>
        )}
        {aufrufe.length > 0 && (
          <div data-cse="hero-aufrufe" className="mt-s3 flex flex-wrap gap-s3">
            {aufrufe.map((a) => (
              <a
                key={a.href}
                href={a.href}
                className={a.primaer
                  ? 'inline-flex min-h-11 items-center rounded-sm bg-brand px-s5 text-sm font-semibold text-white transition-colors duration-fast ease-brand hover:bg-brand-hover'
                  : 'inline-flex min-h-11 items-center rounded-sm border border-white/40 px-s5 text-sm font-semibold text-white transition-colors duration-fast ease-brand hover:bg-white/10'}
              >
                {a.text}
              </a>
            ))}
          </div>
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
