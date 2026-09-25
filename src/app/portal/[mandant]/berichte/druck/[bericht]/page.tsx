import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler } from '@/server/auth/fehler';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import { jahrAus } from '@/server/services/bericht/zeitraum';
import {
  berichtTabelle, istBericht, koernungAus, MIT_KOERNUNG, zellenFuerBlatt,
  type BerichtName,
} from '@/server/services/bericht/export';
import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BERICHT_DRUCK_TEXTE } from '@/lib/i18n/verwaltung/bericht-druck';
import { DruckKnopf } from '@/components/ui/DruckKnopf';
import { MandantAntwort, mandantTor } from '../../../../unterseite';

/**
 * `/portal/[mandant]/berichte/druck/[bericht]` — ein Bericht als Blatt
 * (REP-07, V-227, D-721).
 *
 * **Warum ein Blatt und keine erzeugte PDF-Datei.** Dieselbe Entscheidung wie
 * beim Angebot und beim Monatsnachweis (D-204): ein serverseitiger
 * PDF-Renderer ist eine eigene Abhängigkeit mit eigener Laufzeit, und ein
 * Knopf „PDF", hinter dem keine Datei entsteht, wäre eine vorgetäuschte
 * Funktion. Diese Seite IST das Dokument — A4, weißes Blatt, die Drucktoken
 * aus DESIGN §11 —, und der Druckdialog des Browsers macht daraus Papier oder
 * eine PDF-Datei.
 *
 * **Dieselbe Quelle wie die CSV-Datei.** `berichtTabelle` liefert Zeilen und
 * Spalten für beide Ausgänge; ein Blatt, das andere Spalten zeigte als die
 * Datei, prüfte niemand gegeneinander.
 *
 * **Dasselbe Recht wie die CSV-Datei: `bericht.exportieren`.** Ein Ausdruck
 * verlässt das Portal genauso wie eine Datei. Die Seitenkarte bewacht die
 * Adresse damit; hier wird es INNERHALB der Bindung noch einmal gefragt, wie
 * in der CSV-Route — ohne gebundenen Benutzer antwortete jedes Recht `false`.
 *
 * **Der Stand kommt aus der Datenbank** (`app.berlin_heute()`, Invariante 5).
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly heute: string;
  readonly stand: string;
  readonly firma: string;
  readonly name: string;
  readonly anschrift: string | null;
}

export default async function BerichtDruckblatt({ params, searchParams }: {
  params: Promise<{ mandant: string; bericht: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, bericht } = await params;
  if (!istBericht(bericht)) notFound();
  const suche = await searchParams;

  const tor = await mandantTor(`/portal/${mandant}/berichte/druck/${bericht}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;
  const { sitzung } = zugang;
  const t = nachSprache(BERICHT_DRUCK_TEXTE, zugang.sprache);
  const roh = (name: string): string | null => {
    const w = suche[name];
    return typeof w === 'string' ? w : null;
  };

  let daten: {
    kopf: Kopf; jahr: number; koernung: ReturnType<typeof koernungAus>;
    blatt: ReturnType<typeof zellenFuerBlatt>;
  };
  try {
    daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'bericht.exportieren', mandantId },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [kopf] = await kontext.abfrage<Kopf>(
          `select app.berlin_heute()::text as heute,
                  to_char(app.berlin_heute(), 'DD.MM.YYYY') as stand,
                  m.firma, m.name,
                  nullif(concat_ws(', ', nullif(m.strasse, ''),
                                   nullif(trim(concat_ws(' ', m.plz, m.ort)), '')), '')
                    as anschrift
             from mandant m where m.id = app.aktiver_mandant()`);
        if (kopf === undefined) throw new NichtGefundenFehler('Bereich ohne Zeile');
        const jahr = jahrAus(roh('jahr'), kopf.heute);
        const koernung = koernungAus(roh('koernung'));
        const tabelle = await berichtTabelle(bericht, kontext, jahr, koernung);
        return { kopf, jahr, koernung, blatt: zellenFuerBlatt(tabelle) };
      }))) as typeof daten;
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler || fehler instanceof NichtAngemeldetFehler) {
      notFound();
    }
    throw fehler;
  }

  const { kopf, jahr, koernung, blatt } = daten;
  const titel = t.titel[bericht as BerichtName];
  const zurueck = alsRoute(
    `/portal/${mandant}/berichte/${bericht}?jahr=${String(jahr)}&koernung=${koernung}`);

  return (
    <article data-cse="bericht-druckblatt" data-bericht={bericht} className="cse-blatt">
      {/*
        Die Druckregeln gehören diesem Blatt und nicht der globalen CSS: ein
        `@page` im Anwendungsstil legte den Rand auch auf jede andere Seite
        (dasselbe Muster wie das Angebotsdokument).
      */}
      <style>{`
        .cse-blatt { background: ${FARBEN_DRUCK['druck-papier']};
                     color: ${FARBEN_DRUCK['druck-text']};
                     max-width: 210mm; margin: 0 auto; padding: 20mm;
                     font-size: 10pt; line-height: 1.5; }
        .cse-blatt table { width: 100%; border-collapse: collapse; }
        .cse-blatt th, .cse-blatt td {
                     padding: ${MASSE_DRUCK['druck-zelle-y']} ${MASSE_DRUCK['druck-zelle-x']};
                     vertical-align: top; text-align: left; }
        .cse-blatt thead th { border-bottom: 1px solid ${FARBEN_DRUCK['druck-text']};
                              font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                              text-transform: uppercase;
                              letter-spacing: ${MASSE_DRUCK['druck-kopf-sperrung']}; }
        .cse-blatt tbody tr { border-bottom: 1px solid ${FARBEN_DRUCK['druck-linie-leicht']}; }
        .cse-blatt .zahl { text-align: right; font-variant-numeric: tabular-nums;
                           white-space: nowrap; }
        .cse-blatt .leise { color: ${FARBEN_DRUCK['druck-text-leise']};
                            font-size: ${MASSE_DRUCK['druck-meta-groesse']}; }
        .cse-blatt .kopflinie { border: 0; border-top: 3px solid ${FARBEN_MARKE.red};
                                margin: ${MASSE_DRUCK['druck-block']} 0
                                        calc(2 * ${MASSE_DRUCK['druck-block']}); }
        .cse-blatt .fuss { border-top: 1px solid ${FARBEN_DRUCK['druck-linie']};
                           margin-top: calc(2 * ${MASSE_DRUCK['druck-block']});
                           padding-top: ${MASSE_DRUCK['druck-block']};
                           font-size: ${MASSE_DRUCK['druck-meta-groesse']};
                           color: ${FARBEN_DRUCK['druck-text-leise']}; }
        .cse-blatt .steuerung { display: flex; flex-wrap: wrap; align-items: center;
                                gap: ${MASSE_DRUCK['druck-block']};
                                margin-bottom: ${MASSE_DRUCK['druck-block']}; }
        @media print {
          @page { size: A4; margin: 20mm; }
          .cse-blatt { padding: 0; max-width: none; }
          .cse-nicht-drucken { display: none; }
        }
      `}</style>

      <div className="cse-nicht-drucken steuerung">
        <DruckKnopf text={t.drucken} cse="bericht-drucken" />
        <Link href={zurueck} data-cse="bericht-druck-zurueck" className="underline underline-offset-2">
          {t.zurueck}
        </Link>
        <p className="leise" style={{ margin: 0 }}>{t.anleitung}</p>
      </div>

      <header>
        <p style={{ margin: 0, fontSize: '14pt', fontWeight: 600 }}>{kopf.firma}</p>
        <hr className="kopflinie" />
      </header>

      <h1 style={{ fontSize: '13pt', margin: 0 }}>{t.dokumentTitel(titel, kopf.name)}</h1>
      <dl data-cse="bericht-druck-kopf" style={{ margin: `${MASSE_DRUCK['druck-block']} 0` }}>
        <div>
          <dt style={{ display: 'inline' }}>{`${t.zeitraum}: `}</dt>
          <dd style={{ display: 'inline', margin: 0 }}>{String(jahr)}</dd>
        </div>
        {MIT_KOERNUNG.has(bericht) ? (
          <div>
            <dt style={{ display: 'inline' }}>{`${t.koernung}: `}</dt>
            <dd style={{ display: 'inline', margin: 0 }}>{t.koernungen[koernung]}</dd>
          </div>
        ) : null}
        <div>
          <dt style={{ display: 'inline' }}>{`${t.stand}: `}</dt>
          <dd data-cse="bericht-druck-stand" style={{ display: 'inline', margin: 0 }}>
            {kopf.stand}
          </dd>
        </div>
      </dl>

      {t.tabelleDeutsch === null ? null : <p className="leise">{t.tabelleDeutsch}</p>}

      {blatt.zeilen.length === 0 ? (
        <p data-cse="bericht-druck-leer">{t.leer}</p>
      ) : (
        <table data-cse="bericht-druck-tabelle" lang="de">
          <caption className="sr-only">{t.tabelle(titel)}</caption>
          <thead>
            <tr>
              {blatt.koepfe.map((k) => (
                <th key={k.text} scope="col" className={k.zahl ? 'zahl' : undefined}>{k.text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blatt.zeilen.map((zeile, i) => (
              <tr key={String(i)}>
                {zeile.map((z, j) => (
                  <td key={String(j)} className={z.zahl ? 'zahl' : undefined}>{z.text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="fuss">
        <p style={{ margin: 0 }}>{t.quelle}</p>
        <p style={{ margin: 0 }}>
          {[kopf.firma, kopf.anschrift].filter((x) => x !== null && x !== '').join(' · ')}
        </p>
      </footer>
    </article>
  );
}
