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
  berichtTabelle, blattFormat, istBericht, koernungAus, MIT_KOERNUNG, zellenFuerBlatt,
  type BerichtName,
} from '@/server/services/bericht/export';
import { MASSE_DRUCK } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BERICHT_DRUCK_TEXTE } from '@/lib/i18n/verwaltung/bericht-druck';
import { DruckKnopf } from '@/components/ui/DruckKnopf';
import { MandantAntwort, mandantTor } from '../../../../unterseite';
import { druckblattStil } from './stil';

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
    blatt: ReturnType<typeof zellenFuerBlatt>; format: ReturnType<typeof blattFormat>;
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
        return {
          kopf, jahr, koernung, blatt: zellenFuerBlatt(tabelle), format: blattFormat(tabelle),
        };
      }))) as typeof daten;
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler || fehler instanceof NichtAngemeldetFehler) {
      notFound();
    }
    throw fehler;
  }

  const { kopf, jahr, koernung, blatt, format } = daten;
  const titel = t.titel[bericht as BerichtName];
  const zurueck = alsRoute(
    `/portal/${mandant}/berichte/${bericht}?jahr=${String(jahr)}&koernung=${koernung}`);

  return (
    <article data-cse="bericht-druckblatt" data-bericht={bericht} data-format={format}
             className="cse-blatt">
      {/*
        Die Druckregeln gehören diesem Blatt und nicht der globalen CSS; sie
        stehen in `./stil.ts` — hoch oder quer je nach Tabelle (DESIGN §11,
        V-269), dort begründet und geprüft.
      */}
      <style>{druckblattStil(format)}</style>

      <div className="cse-nicht-drucken steuerung">
        <DruckKnopf text={t.drucken} cse="bericht-drucken" />
        {/* Ein 44-px-Ziel wie jeder Rückweg (DESIGN §8), kein Fliesstextverweis. */}
        <Link href={zurueck} data-cse="bericht-druck-zurueck"
              className="inline-flex min-h-11 items-center underline underline-offset-2">
          {t.zurueck}
        </Link>
        <p className="leise" style={{ margin: 0 }}>{t.anleitung}</p>
      </div>

      <header>
        <p className="firma">{kopf.firma}</p>
        <hr className="kopflinie" />
      </header>

      <h1>{t.dokumentTitel(titel, kopf.name)}</h1>
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
        <div className="rollbar" data-cse="bericht-druck-rollbar">
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
        </div>
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
