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
    unbestaetigt: 'noch nicht bestätigt',
    warnung:
      'Die Angaben dieser Gesellschaft sind noch nicht bestätigt. Sie stammen aus '
      + 'dem Demonstrationsbestand und sind KEINE gültige Auskunft nach § 5 TMG.',
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
    unbestaetigt: 'not yet confirmed',
    warnung:
      'The details of this company have not been confirmed. They come from the '
      + 'demonstration data set and are NOT a valid legal notice.',
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
  /*
   * **Am Telefon untereinander, ab `sm` nebeneinander.**
   *
   * Hier stand fest `grid-cols-[auto_1fr]` mit einem 224px breiten `dt`. Die
   * `1fr`-Spalte hat als Mindestmass ihren MIN-CONTENT, und der ist bei
   * `kontakt@operations.cse-gruppe.de` rund 170px: Bindestrich trennt, `@` und
   * `.` trennen nicht. Bei 375px blieben nach Rand und Beschriftung rund 90px
   * uebrig — das Raster wurde breiter als die Seite, und `/impressum` und
   * `/en/impressum` scrollten waagerecht. Das ist WCAG 1.4.10 (Reflow), und es
   * trifft ausgerechnet die Seite, die § 5 TMG verlangt.
   *
   * `min-w-0` am `dd` nimmt der Spalte dieses Mindestmass, `break-words` bricht
   * die Adresse dann wirklich um. Beides zusammen — ohne `min-w-0` bricht der
   * Umbruch zwar die Zeile, aendert aber die Mindestbreite der Spalte nicht.
   */
  return (
    <div className="grid grid-cols-1 gap-s1 border-b border-line py-s2
                    sm:grid-cols-[auto_1fr] sm:gap-s3">
      <dt className="text-sm text-text-muted sm:w-56">{was}</dt>
      <dd className={`m-0 min-w-0 break-words text-sm ${
        wert === null ? 'text-text-subtle italic' : 'text-text'}`}
      >
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
    <section data-cse="gesellschaften"
      className="mx-auto max-w-content px-s5 py-s6 cse-auftritt cse-auftritt-2">
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
              {/*
                * **Die Warnung steht VOR den Angaben, nicht darunter.**
                *
                * Anschrift, Register- und Steuernummer stammen bis zur
                * Bestaetigung aus dem Demonstrationsbestand — erfunden, nicht
                * falsch abgeschrieben. Sie hier ohne Kennzeichnung als Angaben
                * nach § 5 TMG auszugeben, waere eine amtlich aussehende
                * Falschauskunft. Wer erst die Nummer liest und dann den
                * Hinweis, hat die Nummer schon geglaubt.
                */}
              {!b.angabenBestaetigt && (
                <p data-cse="angaben-unbestaetigt"
                   className="mb-s3 border-s-2 border-warning bg-warning-soft px-s3 py-s2
                              text-sm text-warning">
                  {t.warnung}
                </p>
              )}
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
