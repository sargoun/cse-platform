import Image from 'next/image';
import type { BereichZeile } from '@/server/inhalt/lesen';
import type { Referenz } from '@/server/services/inhalt/referenz';
import type { BeitragZeile } from '@/server/services/social/dienst';
import { praefix, type Sprache } from '@/lib/sprache';

/**
 * Die Inhalte der Profil-Unterseiten (SEITENKARTE §2.2).
 *
 * Alle in einer Datei, weil sie sich vier Dinge teilen: die Kartenform, den
 * Platzhalter-Hinweis am Bild, die Leerzeile und die zweisprachigen Texte.
 * Vier Dateien mit je einer Kopie davon liefen beim ersten Satz auseinander.
 */

const T = {
  de: {
    keinProjekt: 'Für diese Gesellschaft ist noch kein Projekt freigegeben.',
    keinProjektWarum:
      'Ein Projekt erscheint hier erst, wenn der Kunde seiner Veröffentlichung '
      + 'schriftlich zugestimmt hat — ein Kundenname ohne Zustimmung ist kein '
      + 'Anzeigefehler, sondern ein Problem, das man durch Löschen nicht '
      + 'ungeschehen macht.',
    keinBeitrag: 'Noch kein veröffentlichter Beitrag.',
    keineNeuigkeit: 'Noch keine Meldung.',
    keinBild: 'Für diese Gesellschaft ist noch kein Bild in der Galerie.',
    keineLeistung: 'Für diese Gesellschaft sind noch keine Leistungen hinterlegt.',
    platzhalterbild: 'Platzhalterbild',
    kunde: 'Kunde',
    jahr: 'Jahr',
    zurueck: 'Zurück zur Übersicht',
    ungeprueft:
      'Diese Angaben sind noch nicht von einem Menschen bestätigt worden und '
      + 'ersetzen deshalb keine Auskunft nach § 5 TMG.',
    art: {
      beitrag: 'Beitrag', projektschau: 'Projekt',
      neuigkeit: 'Neuigkeit', aktualisierung: 'Aktualisierung',
    } as Record<string, string>,
  },
  en: {
    keinProjekt: 'No project has been released for this company yet.',
    keinProjektWarum:
      'A project appears here only once the customer has agreed to its '
      + 'publication in writing — a customer name without consent is not a '
      + 'display error but a problem that deleting does not undo.',
    keinBeitrag: 'No published post yet.',
    keineNeuigkeit: 'No announcement yet.',
    keinBild: 'No image in this company’s gallery yet.',
    keineLeistung: 'No services recorded for this company yet.',
    platzhalterbild: 'Placeholder image',
    kunde: 'Customer',
    jahr: 'Year',
    zurueck: 'Back to the list',
    ungeprueft:
      'These details have not yet been confirmed by a person and therefore do '
      + 'not constitute the disclosure required by § 5 TMG.',
    art: {
      beitrag: 'Post', projektschau: 'Project',
      neuigkeit: 'News', aktualisierung: 'Update',
    } as Record<string, string>,
  },
} as const;

function texte(sprache: Sprache) {
  return sprache === 'en' ? T.en : T.de;
}

/**
 * Die Zeile, die statt einer Liste steht, wenn es nichts gibt.
 *
 * **Sie sagt, WARUM.** „Keine Einträge" allein liest sich wie ein Fehler; auf
 * der Projektseite ist es dagegen die Zusage, die das Haus dem Kunden gegeben
 * hat, und die gehört dort hin, wo jemand sie liest.
 */
function Leer({ satz, grund }: { readonly satz: string; readonly grund?: string }) {
  return (
    <div data-cse="leer" className="rounded-lg border border-line bg-surface p-s5">
      <p className="m-0 text-base text-text">{satz}</p>
      {grund !== undefined && (
        <p className="mt-s3 max-w-[72ch] text-sm text-text-subtle">{grund}</p>
      )}
    </div>
  );
}

/** Ein Bild mit dem Hinweis, wenn es ein Platzhalter ist (DESIGN §4.1). */
function Bild(
  { bild, sprache, klasse, unoptimiert }: {
    readonly bild: { readonly pfad: string; readonly alt: string; readonly platzhalter: boolean };
    readonly sprache: Sprache;
    readonly klasse?: string;
    /**
     * Ein hochgeladenes Beitragsbild (V-225) liegt im PRIVATEN Behälter; seine
     * Adresse ist eine Tür, die auf eine signierte, ablaufende Adresse weiterleitet.
     * Der Bildoptimierer hielte das Ergebnis fest — länger, als die Signatur gilt.
     * Also lädt der Browser es selbst, über dieselbe Tür.
     */
    readonly unoptimiert?: boolean;
  },
) {
  const t = texte(sprache);
  return (
    <span className={`relative block overflow-hidden rounded-md ${klasse ?? ''}`}>
      {/*
        * `fill` und `sizes`, wie `Hero` und `MarkenKarte` es tun: der Rahmen
        * gibt das Seitenverhältnis vor, das Bild füllt ihn. Ohne `sizes` lädt
        * Next die grösste Fassung — auf einem Telefon im Treppenhaus ist das
        * der Unterschied zwischen einer Seite und einer Wartezeit.
        *
        * Kein `priority`: §4.6 erlaubt es genau einmal je Seite, und dort steht
        * der Held. Eine Galerie mit dreissig vorrangigen Bildern hat keines.
        */}
      <Image
        src={bild.pfad}
        alt={bild.alt}
        fill
        sizes="(min-width: 768px) 33vw, 50vw"
        className="object-cover"
        unoptimized={unoptimiert === true}
      />
      {bild.platzhalter && (
        <span
          data-cse="platzhalter-marke"
          className="absolute right-s2 top-s2 rounded-full bg-warning-soft px-s3 py-s1 text-micro text-warning"
        >
          {t.platzhalterbild}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ Projekte */

export function ProjekteListe(
  { referenzen, bereich, sprache }: {
    readonly referenzen: readonly Referenz[];
    readonly bereich: string;
    readonly sprache: Sprache;
  },
) {
  const t = texte(sprache);
  if (referenzen.length === 0) {
    return <Leer satz={t.keinProjekt} grund={t.keinProjektWarum} />;
  }
  const basis = `${praefix(sprache)}/unternehmen/${bereich}/projekte`;
  return (
    <ul data-cse="projekte" className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
      {referenzen.map((r) => (
        <li key={r.id} className="rounded-lg border border-line bg-surface">
          <a
            href={`${basis}/${r.slug}`}
            data-cse="projekt"
            data-slug={r.slug}
            className="flex min-h-11 flex-col gap-s3 p-s4 text-text hover:bg-surface-2"
          >
            {r.bild !== null && <Bild bild={r.bild} sprache={sprache} klasse="aspect-[3/2]" />}
            <span className="text-h3">{r.titel}</span>
            {r.jahr !== null && (
              <span className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                {t.jahr} {r.jahr}
              </span>
            )}
            {r.kundeName !== null && (
              <span className="text-sm text-text-muted">{t.kunde}: {r.kundeName}</span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ProjektDetail(
  { referenz, bereich, sprache }: {
    readonly referenz: Referenz;
    readonly bereich: string;
    readonly sprache: Sprache;
  },
) {
  const t = texte(sprache);
  return (
    <article data-cse="projekt-detail" className="flex flex-col gap-s4">
      {referenz.bild !== null && (
        <Bild bild={referenz.bild} sprache={sprache} klasse="aspect-[3/1]" />
      )}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">
        {referenz.kundeName !== null && (
          <>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.kunde}</dt>
            <dd className="m-0 min-w-0 break-words text-sm text-text">{referenz.kundeName}</dd>
          </>
        )}
        {referenz.jahr !== null && (
          <>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.jahr}</dt>
            <dd className="m-0 min-w-0 text-sm text-text">{referenz.jahr}</dd>
          </>
        )}
      </dl>
      {referenz.beschreibung !== null && (
        <p className="m-0 max-w-[72ch] whitespace-pre-line text-base text-text">
          {referenz.beschreibung}
        </p>
      )}
      <p className="m-0">
        <a
          href={`${praefix(sprache)}/unternehmen/${bereich}/projekte`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          {t.zurueck}
        </a>
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ Beiträge */

export function BeitraegeListe(
  { beitraege, bereich, sprache, segment }: {
    readonly beitraege: readonly BeitragZeile[];
    readonly bereich: string;
    readonly sprache: Sprache;
    /** `news` oder `beitraege` — bestimmt die Adresse der Einträge. */
    readonly segment: 'news' | 'beitraege';
  },
) {
  const t = texte(sprache);
  if (beitraege.length === 0) {
    return <Leer satz={segment === 'news' ? t.keineNeuigkeit : t.keinBeitrag} />;
  }
  const datum = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long',
  });
  const basis = `${praefix(sprache)}/unternehmen/${bereich}/${segment}`;
  return (
    <ul data-cse="beitraege" className="m-0 flex list-none flex-col gap-s4 p-0">
      {beitraege.map((b) => (
        <li key={b.id} className="rounded-lg border border-line bg-surface">
          <a
            href={`${basis}/${b.slug}`}
            data-cse="beitrag"
            data-slug={b.slug}
            className="flex min-h-11 flex-col gap-s2 p-s4 text-text hover:bg-surface-2"
          >
            <span className="inline-flex flex-wrap items-center gap-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
              <span>{t.art[b.art] ?? b.art}</span>
              {b.veroeffentlichtAm !== null && (
                <time dateTime={b.veroeffentlichtAm}>
                  {datum.format(new Date(b.veroeffentlichtAm))}
                </time>
              )}
            </span>
            <span className="text-h3">{b.titel}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Das Bild eines Beitrags — oder nichts (SOC-02, V-225). */
function Beitragsbild(
  { beitrag, sprache, klasse }: {
    readonly beitrag: BeitragZeile;
    readonly sprache: Sprache;
    readonly klasse: string;
  },
) {
  if (beitrag.bildAdresse === null) return null;
  return (
    <Bild
      bild={{
        pfad: beitrag.bildAdresse,
        alt: beitrag.bildAlt ?? '',
        platzhalter: beitrag.bildPlatzhalter === true,
      }}
      sprache={sprache}
      klasse={klasse}
      unoptimiert={beitrag.bildPrivat === true}
    />
  );
}

export function BeitragDetail(
  { beitrag, bereich, sprache, segment }: {
    readonly beitrag: BeitragZeile;
    readonly bereich: string;
    readonly sprache: Sprache;
    readonly segment: 'news' | 'beitraege';
  },
) {
  const t = texte(sprache);
  const datum = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long',
  });
  return (
    <article data-cse="beitrag-detail" className="flex flex-col gap-s4">
      <p className="m-0 inline-flex flex-wrap items-center gap-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
        <span>{t.art[beitrag.art] ?? beitrag.art}</span>
        {beitrag.veroeffentlichtAm !== null && (
          <time dateTime={beitrag.veroeffentlichtAm}>
            {datum.format(new Date(beitrag.veroeffentlichtAm))}
          </time>
        )}
      </p>
      {/*
        * `whitespace-pre-line` und kein Markdown: `beitrag.text` ist der Text,
        * den die Redaktion geschrieben hat, und wird auch an fremde Plattformen
        * so übergeben. Ihn hier anders zu deuten als dort hiesse, zwei
        * Fassungen desselben Beitrags zu haben.
        */}
      <span data-cse="beitrag-bild" className="contents">
        <Beitragsbild beitrag={beitrag} sprache={sprache} klasse="aspect-[3/2] w-full max-w-[72ch]" />
      </span>
      <p className="m-0 max-w-[72ch] whitespace-pre-line text-base text-text">{beitrag.text}</p>
      <p className="m-0">
        <a
          href={`${praefix(sprache)}/unternehmen/${bereich}/${segment}`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          {t.zurueck}
        </a>
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------- Galerie */

export interface GalerieBild {
  readonly id: string;
  readonly pfad: string;
  readonly alt: string;
  readonly platzhalter: boolean;
}

export function GalerieRaster(
  { bilder, sprache }: {
    readonly bilder: readonly GalerieBild[];
    readonly sprache: Sprache;
  },
) {
  const t = texte(sprache);
  if (bilder.length === 0) return <Leer satz={t.keinBild} />;
  return (
    <ul data-cse="galerie" className="m-0 grid list-none grid-cols-2 gap-s3 p-0 md:grid-cols-3">
      {bilder.map((b) => (
        <li key={b.id} data-cse="galerie-bild">
          <Bild
            bild={{ pfad: b.pfad, alt: b.alt, platzhalter: b.platzhalter }}
            sprache={sprache}
            klasse="aspect-square"
          />
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------- Unternehmensdaten */

/**
 * Die Pflichtangaben EINER Gesellschaft (PRO-02, PUB-12, LEG-09).
 *
 * **Dieselben Spalten wie der Rechnungsfuss** (`02-datenmodell/05-FINANZEN.md`
 * §5.3): Website und Rechnung können nicht auseinanderlaufen, weil sie
 * dieselbe Zeile lesen.
 *
 * **`null` wird ANGEZEIGT, nicht weggelassen.** Eine fehlende Registernummer
 * stillschweigend zu überspringen macht aus einer unvollständigen Auskunft
 * eine, die vollständig aussieht — und § 5 TMG verlangt die Angabe, nicht den
 * Anschein.
 */
export function Unternehmensdaten(
  { bereich, sprache }: { readonly bereich: BereichZeile; readonly sprache: Sprache },
) {
  const t = texte(sprache);
  const en = sprache === 'en';
  const zeilen: readonly (readonly [string, string | null])[] = [
    [en ? 'Company' : 'Firma', bereich.firma],
    [en ? 'Legal form' : 'Rechtsform', bereich.rechtsform],
    [en ? 'Address' : 'Anschrift',
      bereich.strasse === null ? null
        : `${bereich.strasse}, ${bereich.plz ?? ''} ${bereich.ort ?? ''}`.trim()],
    [en ? 'Register court' : 'Registergericht', bereich.handelsregisterGericht],
    [en ? 'Register number' : 'Registernummer', bereich.handelsregisterNummer],
    [en ? 'Managing directors' : 'Geschäftsführung',
      bereich.geschaeftsfuehrer.length === 0 ? null : bereich.geschaeftsfuehrer.join(', ')],
    [en ? 'VAT ID' : 'Umsatzsteuer-ID', bereich.ustId],
    [en ? 'Phone' : 'Telefon', bereich.telefon],
    [en ? 'E-mail' : 'E-Mail', bereich.email],
  ];
  return (
    <div className="flex flex-col gap-s4">
      <dl data-cse="unternehmensdaten" className="m-0 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">
        {zeilen.map(([kopf, wert]) => (
          <div key={kopf} className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{kopf}</dt>
            <dd
              className="m-0 min-w-0 break-words text-sm text-text"
              data-cse="angabe"
              data-feld={kopf}
              data-fehlt={wert === null ? 'ja' : 'nein'}
            >
              {wert ?? (en ? 'not recorded yet' : 'noch nicht hinterlegt')}
            </dd>
          </div>
        ))}
      </dl>
      {!bereich.angabenBestaetigt && (
        <p
          data-cse="ungeprueft"
          className="m-0 max-w-[72ch] rounded-md bg-warning-soft p-s4 text-sm text-warning"
        >
          {t.ungeprueft}
        </p>
      )}
    </div>
  );
}
