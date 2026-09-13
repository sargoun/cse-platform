import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/buchhaltung/buchungen/[id]` — eine Buchung mit allen
 * ihren Zeilen und ihrem Beleg (ACC-01, ACC-03).
 *
 * **Die ganze Buchung, nicht die eine Zeile.** Die Adresse trägt die Kennung
 * EINER Zeile, weil die Liste dorthin verweist; gezeigt werden alle Zeilen
 * derselben `buchung_id`. Eine einzelne Zeile ist keine Aussage — sie ist
 * eine Hälfte, und die Frage „geht das auf" lässt sich an ihr nicht
 * beantworten.
 *
 * **Soll und Haben werden hier verglichen, nicht gerechnet.** Die Summe zweier
 * gespeicherter Cent-Beträge ist keine Berechnung im Sinne von Invariante 6,
 * sondern eine Probe — und sie steht da, weil eine schiefe Buchung sichtbar
 * sein muss, auch wenn ein Riegel sie nie hätte entstehen lassen dürfen.
 */
export const dynamic = 'force-dynamic';

interface ZeileRoh {
  readonly id: string;
  readonly buchung_id: string;
  readonly belegdatum: string;
  readonly buchungsdatum: string;
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly soll_haben: string;
  readonly umsatz_cent: string;
  readonly bu_schluessel: string | null;
  readonly buchungstext: string | null;
  readonly belegfeld1: string | null;
  readonly herkunft: string;
  readonly festgeschrieben: boolean;
  readonly pruefhinweis: string | null;
  readonly beleg_id: string | null;
  readonly belegnummer: string | null;
  readonly beleg_typ: string | null;
  readonly datei_sha256: string | null;
  readonly dokument_titel: string | null;
  readonly rechnung_id: string | null;
  readonly rechnung_nummer: string | null;
}

const HERKUNFT: Readonly<Record<string, string>> = {
  rechnung: 'Ausgangsrechnung', eingangsrechnung: 'Eingangsrechnung',
  zahlung: 'Zahlung', ausgabe: 'Ausgabe', kassenbewegung: 'Kasse',
  manuell: 'Manuell',
};

export default async function Buchung(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/buchungen/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      kontext.abfrage<ZeileRoh>(
        /*
         * Der Unterverbund auf `buchung_id` und nicht zwei Abfragen: eine
         * zweite Rundreise waere ein zweiter Zeitpunkt, und die Zeilen
         * stammten dann aus zwei Zustaenden derselben Buchung.
         */
        `select bs.id, bs.buchung_id, bs.belegdatum::text as belegdatum,
                bs.buchungsdatum::text as buchungsdatum,
                bs.konto, bs.gegenkonto, bs.soll_haben::text as soll_haben,
                bs.umsatz_cent::text, bs.bu_schluessel, bs.buchungstext,
                bs.belegfeld1, bs.herkunft::text as herkunft, bs.festgeschrieben,
                bs.pruefhinweis, bs.beleg_id,
                b.belegnummer, b.typ::text as beleg_typ, b.datei_sha256,
                d.titel as dokument_titel,
                bs.rechnung_id, r.nummer as rechnung_nummer
           from buchungssatz bs
           left join beleg b    on b.id = bs.beleg_id   and b.mandant_id = bs.mandant_id
           left join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
           left join rechnung r on r.id = bs.rechnung_id and r.mandant_id = bs.mandant_id
          where bs.buchung_id = (select buchung_id from buchungssatz where id = $1)
          order by bs.soll_haben, bs.umsatz_cent desc`,
        [id])))) as readonly ZeileRoh[];

  if (zeilen.length === 0) notFound();
  const kopf = zeilen[0]!;

  const summe = (sh: string): bigint => zeilen
    .filter((z) => z.soll_haben === sh)
    .reduce((s, z) => s + BigInt(z.umsatz_cent), 0n);
  const soll = summe('soll');
  const haben = summe('haben');
  const gehtAuf = soll === haben;

  return (
    <PortalRahmen
      titel={`Buchung vom ${kopf.belegdatum}`}
      wurzelTitel="Buchungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="buchungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Buchung vom {kopf.belegdatum}</h1>
        <Link
          href={`/portal/${mandant}/buchhaltung/buchungen`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zur Liste
        </Link>
      </div>

      <dl className="mb-s7 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-text-subtle">Herkunft</dt>
          <dd className="text-text">{HERKUNFT[kopf.herkunft] ?? kopf.herkunft}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-subtle">Buchungsdatum</dt>
          <dd className="text-text">{kopf.buchungsdatum}</dd>
        </div>
        <div>
          <dt className="text-sm text-text-subtle">Stand</dt>
          <dd>
            <StatusPill zustand={kopf.festgeschrieben ? 'Abgeschlossen' : 'Entwurf'} />
          </dd>
        </div>
      </dl>

      {/* Die Probe: geht die Buchung auf? */}
      <section
        data-cse="buchung-probe"
        data-geht-auf={String(gehtAuf)}
        className={`mb-s7 rounded-lg border p-s5 text-sm ${
          gehtAuf ? 'border-line bg-surface text-text'
                  : 'border-warning bg-warning-soft text-warning'}`}
      >
        Soll {formatiereGeld(cent(soll))} · Haben {formatiereGeld(cent(haben))}
        {gehtAuf
          ? ' — die Buchung geht auf.'
          : ` — ABWEICHUNG von ${formatiereGeld(cent(soll - haben))}.`}
      </section>

      {/* Der Beleg. Ein Link, kein Häkchen. */}
      <section aria-labelledby="beleg-titel" className="mb-s7">
        <h2 id="beleg-titel" className="mb-s3 text-h2 text-text">Beleg</h2>
        {kopf.beleg_id === null ? (
          <div className={`rounded-lg border p-s5 text-sm ${
            kopf.herkunft === 'manuell'
              ? 'border-line bg-surface text-text-muted'
              : 'border-warning bg-warning-soft text-warning'}`}
          >
            {kopf.herkunft === 'manuell'
              ? (kopf.pruefhinweis
                ?? 'Eine manuelle Buchung ohne Beleg — sie trägt ihren Grund selbst.')
              : 'Für diese Buchung liegt noch kein archiviertes Dokument. Der '
                + 'Archivlauf legt es ab; bis dahin ist der Zeitraum nicht '
                + 'exportfähig.'}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-s5">
            <p className="text-text">
              <a
                href={`/api/buchhaltung/buchungen/${kopf.id}/beleg`}
                className="underline underline-offset-2 hover:text-brand"
              >
                {kopf.dokument_titel ?? kopf.belegnummer ?? 'Dokument öffnen'}
              </a>
            </p>
            <p className="mt-s2 text-sm text-text-muted">
              {kopf.beleg_typ === null ? null : <>Typ {kopf.beleg_typ} · </>}
              Der Link gilt fünfzehn Minuten; danach wird er neu ausgestellt.
            </p>
            {kopf.datei_sha256 === null ? null : (
              /* D-420: 64 Zeichen ohne Trennstelle machten `main` breiter
                 als das Fenster. */
              <p className="mt-s2 break-all font-mono text-xs text-text-subtle">
                SHA-256 {kopf.datei_sha256}
              </p>
            )}
            {kopf.rechnung_id === null ? null : (
              <p className="mt-s3 text-sm">
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${kopf.rechnung_id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  Zur Rechnung {kopf.rechnung_nummer ?? ''}
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      <DataTable
        beschriftung="Die Zeilen dieser Buchung"
        zeilen={zeilen}
        schluessel={(z) => z.id}
        spalten={[
          {
            schluessel: 'konto', kopf: 'Konto',
            zelle: (z) => (z.konto === null
              ? (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand="Fehler" />
                  <span className="text-xs text-warning">
                    {z.pruefhinweis ?? 'Kontenzuordnung fehlt'}
                  </span>
                </span>
              )
              : <span className="font-mono text-sm text-text">{z.konto}</span>),
          },
          {
            schluessel: 'sh', kopf: 'S/H',
            zelle: (z) => (z.soll_haben === 'soll' ? 'Soll' : 'Haben'),
          },
          {
            schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
            zelle: (z) => formatiereGeld(cent(BigInt(z.umsatz_cent))),
          },
          {
            schluessel: 'bu', kopf: 'BU',
            zelle: (z) => z.bu_schluessel ?? <span className="text-text-subtle">—</span>,
          },
          {
            schluessel: 'text', kopf: 'Buchungstext',
            zelle: (z) => z.buchungstext ?? <span className="text-text-subtle">—</span>,
          },
          {
            schluessel: 'belegfeld', kopf: 'Belegfeld 1',
            zelle: (z) => z.belegfeld1 ?? <span className="text-text-subtle">—</span>,
          },
        ]}
      />
    </PortalRahmen>
  );
}
