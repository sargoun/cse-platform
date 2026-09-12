import type { BereichZeile } from '@/server/inhalt/lesen';
import type { Sprache } from '@/lib/sprache';

/**
 * Die Angaben nach § 5 TMG, je Gesellschaft.
 *
 * **Warum das eine eigene Komponente ist und kein Abschnitt im Redaktions-
 * system.** Ein `abschnitt` traegt freien Text. Firma, Rechtsform,
 * Handelsregister und Umsatzsteuer-Identifikationsnummer stehen aber schon in
 * `mandant` — dort, wo die Rechnung sie hernimmt. Stuenden sie zusaetzlich als
 * Fliesstext im Impressum, gaebe es zwei Wahrheiten, und die im Impressum
 * waere die, die niemand nachpflegt.
 *
 * **Eine fehlende Angabe wird GEZEIGT, nicht weggelassen.** Ein Impressum mit
 * stillschweigend ausgelassener Zeile sieht vollstaendig aus und ist es nicht
 * — und § 5 TMG ist eine Pflicht, deren Verletzung abgemahnt wird. „Noch nicht
 * hinterlegt" ist die ehrliche Auskunft und zugleich die sichtbare Aufgabe.
 */
const TEXT = {
  de: {
    ueberschrift: 'Die Gesellschaften der Gruppe',
    vertreten: 'Vertreten durch',
    register: 'Handelsregister',
    ustId: 'Umsatzsteuer-Identifikationsnummer',
    telefon: 'Telefon',
    epost: 'E-Mail',
    fehlt: 'noch nicht hinterlegt',
    hinweis:
      'Angaben, die hier als „noch nicht hinterlegt" erscheinen, sind von der '
      + 'Geschäftsführung zu bestätigen. Sie stehen bewusst sichtbar offen, statt '
      + 'weggelassen zu werden.',
  },
  en: {
    ueberschrift: 'The companies of the group',
    vertreten: 'Represented by',
    register: 'Commercial register',
    ustId: 'VAT identification number',
    telefon: 'Phone',
    epost: 'E-mail',
    fehlt: 'not yet recorded',
    hinweis:
      'Entries shown as “not yet recorded” are awaiting confirmation by the '
      + 'management. They are left visibly open rather than omitted.',
  },
} as const;

function Angabe({ was, wert, fehlt }: {
  readonly was: string;
  readonly wert: string | null;
  readonly fehlt: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-s3 border-b border-line py-s2">
      <dt className="w-56 text-sm text-text-muted">{was}</dt>
      <dd className={`m-0 text-sm ${wert === null ? 'text-text-subtle italic' : 'text-text'}`}>
        {wert ?? fehlt}
      </dd>
    </div>
  );
}

function leer(wert: string | null | undefined): string | null {
  return wert === null || wert === undefined || wert.trim() === '' ? null : wert;
}

export function Gesellschaften({ bereiche, sprache }: {
  readonly bereiche: readonly BereichZeile[];
  readonly sprache: Sprache;
}) {
  const t = TEXT[sprache === 'en' ? 'en' : 'de'];
  return (
    <section data-cse="gesellschaften" className="mx-auto max-w-content px-s5 py-s6">
      <h2 className="mb-s5 text-h2 text-text">{t.ueberschrift}</h2>
      <div className="flex flex-col gap-s6">
        {bereiche.map((b) => {
          const register = leer(b.handelsregisterGericht) === null
            || leer(b.handelsregisterNummer) === null
            ? null
            : `${b.handelsregisterGericht}, ${b.handelsregisterNummer}`;
          const anschrift = leer(b.strasse) === null || leer(b.ort) === null
            ? null
            : `${b.strasse}, ${b.plz ?? ''} ${b.ort}, ${b.land}`.replace(/\s+/gu, ' ');
          return (
            <div key={b.id} data-cse="gesellschaft" data-slug={b.slug}>
              <h3 className="mb-s2 text-h3 text-text">
                {b.firma}
                {leer(b.rechtsform) !== null && !b.firma.includes(b.rechtsform!)
                  ? ` (${b.rechtsform!})` : ''}
              </h3>
              <dl className="m-0">
                <Angabe was="Anschrift" wert={anschrift} fehlt={t.fehlt} />
                <Angabe
                  was={t.vertreten}
                  wert={b.geschaeftsfuehrer.length === 0
                    ? null : b.geschaeftsfuehrer.join(', ')}
                  fehlt={t.fehlt}
                />
                <Angabe was={t.register} wert={register} fehlt={t.fehlt} />
                <Angabe was={t.ustId} wert={leer(b.ustId)} fehlt={t.fehlt} />
                <Angabe was={t.telefon} wert={leer(b.telefon)} fehlt={t.fehlt} />
                <Angabe was={t.epost} wert={leer(b.email)} fehlt={t.fehlt} />
              </dl>
            </div>
          );
        })}
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">{t.hinweis}</p>
    </section>
  );
}
