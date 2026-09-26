import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dokumentKategorieText } from '@/lib/i18n/texte';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  findeEigenesDokument, groesseText, SIGNATUR_MINUTEN, type MeinDokument,
} from '@/server/services/mitarbeiter/dokumente';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft, Hinweis } from '../../bausteine';

/**
 * `/portal/mein/dokumente/[id]` — ein freigegebenes Dokument und sein Abruf
 * (EMP-11, DOC-03, DOC-04, SEC-A6, AUT-06).
 *
 * **Die Datei kommt ueber eine signierte Adresse, nie ueber einen Pfad**
 * (DOC-03). Es gibt keinen oeffentlichen Bucket; die Adresse gilt
 * `SIGNATUR_MINUTEN` Minuten und wird bei jedem Oeffnen neu ausgestellt.
 *
 * **Warum der Abruf ein LINK auf eine Route ist und nicht eine Adresse in
 * dieser Seite.** Zwei Gruende, und beide zaehlen:
 *
 *  1. **Die Spur.** DOC-03 und SEC-A6 verlangen, dass jeder Abruf eine Zeile
 *     in `dokument_zugriff` hinterlaesst — „wer wissen will, wer eine
 *     Personalakte gesehen hat (Art. 15 DSGVO), findet sie hier" (0139). Eine
 *     Seite im Personen-Scope kann das nicht: der Scope ist `readonly`, und
 *     `app.aktiver_mandant()` ist dort NULL (K-20). Der Abruf faehrt deshalb
 *     ueber die PER->M1-Bruecke in `api/mein/dokumente/[id]/datei`.
 *  2. **Der Vorabruf.** Next.js holt die Nutzlast einer `<Link>`-Route im
 *     Voraus. Eine Adresse, die beim RENDERN entstuende, waere damit ein
 *     Abruf, den niemand ausgeloest hat — und eine Protokollzeile fuer eine
 *     Datei, die nie jemand gesehen hat. Der Knopf unten ist deshalb ein
 *     schlichtes `<a>` und kein `<Link>`.
 *
 * **Ohne verbundenen Speicher steht das da** (CLAUDE.md, „No fake
 * integrations"): kein toter Knopf, keine erfundene Adresse. Die ZEILE bleibt
 * trotzdem stehen — dass es das Dokument gibt, ist selbst die Auskunft.
 *
 * **Ohne JavaScript bedienbar**: ein Link, ein Ziel, kein Skript. Das ist
 * keine Bequemlichkeit — diese Seite laeuft auf alten Diensttelefonen im
 * Treppenhaus (SPEC §10, DESIGN §8).
 */
export const dynamic = 'force-dynamic';

export default async function MeinDokumentBlatt(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  kennungOder404(id);
  const speicher = waehleSpeicher();

  const ergebnis = await meinPortal<MeinDokument | null>(
    `/portal/mein/dokumente/${id}`,
    async (kontext) => findeEigenesDokument(kontext, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  // Ein fremdes oder nicht freigegebenes Dokument gibt dieselbe Antwort: 404.
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const d = ergebnis.daten;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={d.titel} aktiverTab="heute"
      zurueck={{ ziel: "/portal/mein/dokumente", text: t.dokumente }}
    >

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <Gesellschaft slug={d.mandantSlug} name={d.mandantName} />
        <span data-cse="kategorie" className="text-base text-text-muted">
          {dokumentKategorieText(basis.sprache, d.kategorie)}
        </span>
      </div>

      <h1 className="mb-s4 text-h1 text-text">{d.titel}</h1>

      {d.beschreibung !== null && (
        <p data-cse="beschreibung" className="mb-s5 max-w-prose text-base text-text">
          {d.beschreibung}
        </p>
      )}

      <section
        data-cse="dokument-angaben"
        className="mb-s5 rounded-lg border border-line bg-surface p-s4"
      >
        <Felder>
          <Feld label={t.abgelegtAm}>
            <span className="cse-zahl">{d.abgelegtLokal}</span>
          </Feld>
          <Feld label={t.datum}>
            <span className="cse-zahl">{d.entstandenAm}</span>
          </Feld>
          <Feld label={t.groesse}>
            <span className="cse-zahl">{groesseText(d.groesseBytes)}</span>
          </Feld>
          <Feld label={t.art}>{d.mimeTyp}</Feld>
          {d.version !== null && (
            <Feld label={t.fassung}>
              <span className="cse-zahl">{String(d.version)}</span>
            </Feld>
          )}
          {d.objektBezeichnung !== null && (
            <Feld label={t.objekt}>
              {d.objektId === null ? d.objektBezeichnung : (
                <Link
                  href={`/portal/mein/objekte/${d.objektId}`}
                  className="inline-flex min-h-11 items-center text-text underline"
                >
                  {d.objektBezeichnung}
                </Link>
              )}
            </Feld>
          )}
        </Felder>
      </section>

      <section data-cse="abruf" className="mb-s5">
        {speicher.verbunden ? (
          /*
           * Ein `<a>` und kein `<Link>`: der Abruf ist eine Handlung, kein
           * Seitenwechsel. Next.js holt `<Link>`-Ziele im Voraus, und ein
           * vorgeholter Abruf waere eine Protokollzeile ohne Menschen davor.
           * `rel="nofollow"` sagt dasselbe jedem Vorleser und jedem Roboter.
           */
          <a
            href={`/api/mein/dokumente/${d.id}/datei`}
            data-cse="datei-oeffnen"
            rel="nofollow"
            className="inline-flex min-h-11 items-center rounded-md border
                       border-line-strong bg-surface-2 px-s4 text-base text-text
                       no-underline"
          >
            {t.dateiOeffnen}
          </a>
        ) : (
          <Hinweis text={t.nichtVerbunden} marke="speicher-nicht-verbunden" />
        )}
        <p className="mt-s3 m-0 max-w-prose text-base text-text-muted">
          {t.signaturHinweis}{' '}
          <span className="cse-zahl">{String(SIGNATUR_MINUTEN)}</span> {t.gueltigMinuten}.
        </p>
        {/* SEC-A6, Art. 15 DSGVO: die Spur wird angekuendigt, nicht versteckt. */}
        <p data-cse="abruf-spur" className="mt-s2 m-0 max-w-prose text-base text-text-muted">
          {t.abrufProtokolliert}
        </p>
      </section>
    </MeinRahmen>
  );
}
