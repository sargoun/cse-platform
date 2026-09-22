import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { AuditBuendelFehler, MAX_ZEILEN, zaehleAuditZeilen }
  from '@/server/services/audit/buendel';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/einstellungen/protokoll/export` — das Beweismittelbuendel
 * ueber das Pruefprotokoll (SEC-A9, DOC-08, LEG-01).
 *
 * **Die Seite laesst nichts herunterladen, was sie nicht vorher gezaehlt
 * hat.** Ein Buendel ist ein Beweismittel: wer es abruft, soll vorher sehen,
 * wieviele Zeilen es trifft und was ausdruecklich NICHT darin steht. Erst
 * danach stehen die beiden Knoepfe.
 *
 * **Zwei Rechte, und die Seite sagt, wenn das zweite fehlt.** Die Route ist
 * mit `system.audit_exportieren` bewacht; die Vorher/Nachher-Werte haengen an
 * `system.audit_sensitiv_lesen` (05-API-KARTE, 03-AUTH-BERECHTIGUNGEN) und
 * `cse_app` haelt auf den beiden Spalten ueberhaupt keinen Grant. Ohne das
 * zweite Recht entsteht ein REDIGIERTES Buendel, und das Manifest schreibt
 * den Grund hinein — statt eines Buendels, das aussieht, als sei nichts
 * geaendert worden.
 *
 * **Das zweite Recht verlangt den ZWEITEN FAKTOR** (0206, AUT-02): es
 * oeffnet Loehne, Geburtsdaten und gesundheitsnahe Abwesenheitsgruende im
 * Klartext. `app.hat_recht` gibt es in einer `aal1`-Sitzung gar nicht erst
 * zurueck — die Abfrage unten faellt deshalb ohne Zutun auf `false`, und der
 * Hinweis erscheint. Ein Riegel in der Route deckte einen Weg; die Pflicht an
 * der Berechtigung deckt jeden.
 *
 * **Nur diese Gesellschaft, nur `ebene = 'mandant'`.** Plattformzeilen
 * gehoeren nie in ein Mandantenbuendel (K-16(d)); die Spalte `ebene` steht
 * trotzdem in jeder exportierten Zeile, damit die beiden Ebenen nie
 * stillschweigend vermischt werden.
 */
export const dynamic = 'force-dynamic';

const AKTEUR_WAHL: readonly (readonly [string, string])[] = [
  ['', 'alle'],
  ['mensch', 'Mensch'],
  ['agent', 'Agent'],
  ['system', 'System'],
];

export default async function ProtokollExport(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const eines = (name: string): string => {
    const wert = suche[name];
    return typeof wert === 'string' ? wert.trim() : '';
  };

  const tor = await mandantTor(
    `/portal/${mandant}/einstellungen/protokoll/export`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Der Vorgabezeitraum und das Recht auf die Werte — in DERSELBEN gebundenen
   * Transaktion. Der Monatserste kommt aus `app.berlin_heute()` und nicht aus
   * `new Date()`: die Uhr des Node-Prozesses liest UTC und boete am 31.12. um
   * 23:30 Berliner Zeit den falschen Monat an (K-11, Invariante 2).
   */
  const grund = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [tage] = await kontext.abfrage<{
        erster: string; heute: string; sensitiv: boolean;
      }>(`select date_trunc('month', app.berlin_heute())::date::text as erster,
                 app.berlin_heute()::text as heute,
                 app.hat_recht('system.audit_sensitiv_lesen',
                               app.aktiver_mandant()) as sensitiv`);
      return { tage };
    })) as Promise<{ tage: { erster: string; heute: string; sensitiv: boolean } | undefined }>);

  const erster = grund.tage?.erster ?? '';
  const heute = grund.tage?.heute ?? '';
  const sensitiv = grund.tage?.sensitiv === true;

  const von = eines('von') === '' ? erster : eines('von');
  const bis = eines('bis') === '' ? heute : eines('bis');
  const objektTyp = eines('objektTyp');
  const objektId = eines('objektId');
  const akteurTyp = eines('akteurTyp');
  const gezaehlt = eines('zaehlen') === 'ja';

  let treffer: number | null = null;
  let fehler: string | null = null;
  if (gezaehlt) {
    try {
      treffer = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
        withTenant(tx, zugang.sitzung, (kontext) => zaehleAuditZeilen(kontext, {
          von,
          bis,
          objektTyp: objektTyp === '' ? null : objektTyp,
          objektId: objektId === '' ? null : objektId,
          akteurTyp: akteurTyp === '' ? null : akteurTyp,
        }))) as Promise<number>);
    } catch (f: unknown) {
      if (f instanceof AuditBuendelFehler) fehler = f.message;
      else throw f;
    }
  }

  const abfrage = new URLSearchParams({ mandant, von, bis });
  if (objektTyp !== '') abfrage.set('objektTyp', objektTyp);
  if (objektId !== '') abfrage.set('objektId', objektId);
  if (akteurTyp !== '') abfrage.set('akteurTyp', akteurTyp);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'inline-flex min-h-11 items-center rounded-md bg-brand px-s5 py-s3 '
    + 'text-base font-semibold text-white hover:bg-brand-hover';

  return (
    <PortalRahmen
      titel="Protokoll exportieren"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Protokoll exportieren</h1>
      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Ein Bündel besteht aus dem Manifest (kanonisches JSON mit seinem SHA-256), den
        Protokollzeilen als CSV und — wo das Recht es zulässt — den Vorher/Nachher-Werten.
        Der Abruf selbst steht im Protokoll: ein Beweismittel verlässt das Haus.
      </p>

      <Hinweis art="hinweis" cse="export-umfang" className="mb-s5 max-w-[72ch]">
        <strong>Enthalten ist ausschliesslich diese Gesellschaft.</strong> Zeilen der
        Ebene „Plattform" — Anmeldung, zweiter Faktor, Sperre, Anlage einer Gesellschaft,
        die Quellseite eines Bereichswechsels — gehören nie in ein Bündel einer
        einzelnen Gesellschaft. Die Spalte „Ebene" steht trotzdem in jeder exportierten
        Zeile, damit die beiden Ebenen später nicht stillschweigend vermischt werden.
      </Hinweis>

      {sensitiv ? null : (
        <Hinweis art="warnung" cse="export-redigiert" className="mb-s5 max-w-[72ch]">
          <strong>Das Bündel wird redigiert.</strong> Die Vorher/Nachher-Werte hängen an
          einem eigenen Recht (<Recht schluessel="system.audit_sensitiv_lesen" />) — sie können
          Löhne, Geburtsdaten und Gesundheitsangaben tragen. Ihre Sitzung hält es nicht
          — entweder fehlt das Recht, oder der zweite Faktor wurde in dieser Anmeldung
          nicht vorgezeigt (das Recht verlangt ihn). Das Manifest trägt diesen Grund
          ein und die Nutzlastdatei fehlt. Ein Bündel ohne diesen Satz sähe aus, als
          hätte sich nichts geändert.
        </Hinweis>
      )}

      <section aria-labelledby="zeitraum-titel"
               className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 id="zeitraum-titel" className="text-h2 text-text">Zeitraum und Filter</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Die Tage sind Berliner Kalendertage, einschliesslich; serverseitig werden sie
          in UTC-Zeitpunkte aufgelöst — der letzte Tag reicht bis 24:00 Ortszeit.
        </p>
        <form method="get">
          <input type="hidden" name="zaehlen" value="ja" />
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="von">Von</label>
              <input id="von" name="von" type="date" required className={feld}
                     defaultValue={von} max={heute} />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="bis">Bis</label>
              <input id="bis" name="bis" type="date" required className={feld}
                     defaultValue={bis} max={heute} />
            </div>
          </div>

          <label className="mt-s4 block text-sm text-text" htmlFor="objektTyp">
            Objekttyp (Tabellenname, leer = alle)
          </label>
          <input id="objektTyp" name="objektTyp" type="text" className={feld}
                 defaultValue={objektTyp} placeholder="rechnung" />

          <label className="mt-s4 block text-sm text-text" htmlFor="objektId">
            Objekt-Kennung (leer = alle)
          </label>
          <input id="objektId" name="objektId" type="text" className={feld}
                 defaultValue={objektId} />

          <label className="mt-s4 block text-sm text-text" htmlFor="akteurTyp">
            Akteursart
          </label>
          <select id="akteurTyp" name="akteurTyp" className={feld} defaultValue={akteurTyp}>
            {AKTEUR_WAHL.map(([wert, beschriftung]) => (
              <option key={wert} value={wert}>{beschriftung}</option>
            ))}
          </select>

          <button type="submit" className={`mt-s5 ${knopf}`}>Zeilen zählen</button>
        </form>
      </section>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="export-fehler" className="mb-s5 max-w-prose">
          {fehler}
        </Hinweis>
      ) : null}

      {treffer !== null ? (
        <section aria-labelledby="treffer-titel"
                 className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 id="treffer-titel" className="text-h2 text-text">Das Bündel</h2>
          <p data-cse="export-treffer" data-treffer={String(treffer)}
             className="mt-s2 text-sm text-text-muted">
            {treffer === 0
              ? 'Kein Eintrag im gewählten Zeitraum. Ein Bündel darüber wäre ein '
                + 'Manifest ohne Zeilen — es entsteht, sagt aber nichts aus.'
              : `${String(treffer)} Einträge dieser Gesellschaft. `
                + `Höchstens ${String(MAX_ZEILEN)} Zeilen je Bündel; darüber teilt man `
                + 'den Zeitraum.'}
          </p>
          <div className="mt-s5 flex flex-wrap gap-s4">
            <a data-cse="export-manifest" className={knopf}
               href={`/api/einstellungen/protokoll/export?${abfrage.toString()}&format=manifest`}>
              Manifest (JSON)
            </a>
            <a data-cse="export-zip"
               className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface-3 px-s5 py-s3 text-base font-semibold text-text hover:border-line-strong"
               href={`/api/einstellungen/protokoll/export?${abfrage.toString()}&format=zip`}>
              Bündel (ZIP)
            </a>
          </div>
          <p className="mt-s4 text-xs text-text-muted">
            Der SHA-256 des Manifests steht in der Kopfzeile der Antwort
            (<code>x-cse-manifest-sha256</code>) und im Dateinamen des Bündels. Zwei
            Abrufe desselben Zeitraums ergeben dieselben Bytes — das Archiv trägt keine
            Uhr (STORE, Nullzeitstempel).
          </p>
        </section>
      ) : null}

      <p className="mt-s7 max-w-[72ch] text-sm text-text-subtle">
        Signiert ist das Manifest, nicht eine Kette. Die Hashkette über das Protokoll
        (<code>kern.audit_kette</code>) wird beim Bilden eines Bündels fortgeschrieben,
        und das Manifest nennt, wieviele Zeilen des Zeitraums gekettet sind — das Wort
        „revisionssicher" steht hier nicht, solange es keine Deckung hat. Wie lange
        Protokollzeilen aufbewahrt werden und auf welcher Rechtsgrundlage, ist offen
        (O-92).
      </p>
    </PortalRahmen>
  );
}
