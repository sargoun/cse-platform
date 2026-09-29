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
import { internSprache } from '@/lib/i18n/intern';
import { PORTAL_BCP47 } from '@/lib/i18n/texte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BERICHT_DRUCK_TEXTE } from '@/lib/i18n/verwaltung/bericht-druck';
import { DruckKnopf } from '@/components/ui/DruckKnopf';
import { MandantAntwort, mandantTor } from '../../../../unterseite';
import { druckblattStil } from './stil';
import { BlattKopf } from './kopf';

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
 * **Der Stand kommt aus der Datenbank** (`app.berlin_heute()`, Invariante 5)
 * als Kalendertag JJJJ-MM-TT; geschrieben wird er im Kopf, in der Sprache des
 * Rahmens (`./kopf.tsx`, D-733, V-269).
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly heute: string;
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
  /*
   * Die Sprache des Blatts — seine Wörter UND sein `lang` an einer Stelle
   * (D-767, wie der Monatsnachweis). Das Blatt steht ohne die Hülle des
   * Portals, also sagt ihm niemand sonst die Sprache an: ohne `lang` erbte es
   * `<html lang="de-DE">`, und ein Screenreader läse die englischen Wörter
   * einer englischen Sitzung mit deutscher Aussprache. Die Tabelle darunter
   * bleibt `lang="de"` — ihre Köpfe und Werte kommen deutsch aus dem Dienst.
   */
  const blattSprache = internSprache(zugang.sprache);
  const t = nachSprache(BERICHT_DRUCK_TEXTE, blattSprache);
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
             className="cse-blatt" lang={PORTAL_BCP47[blattSprache]}>
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

      <BlattKopf t={t} sprache={zugang.sprache} firma={kopf.firma}
                 titel={t.dokumentTitel(titel, kopf.name)} jahr={jahr}
                 koernung={MIT_KOERNUNG.has(bericht) ? koernung : null} heute={kopf.heute} />

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
