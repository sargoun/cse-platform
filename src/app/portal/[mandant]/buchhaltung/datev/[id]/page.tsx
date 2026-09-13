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
 * `/portal/[mandant]/buchhaltung/datev/[id]` — ein Stapel, seine Datei und
 * das Belegmanifest (ACC-02, ACC-03 Abnahme (4)).
 *
 * **Das Manifest ist der Grund, warum diese Seite existiert.** Eine
 * Exportdatei allein beantwortet die Frage einer Betriebsprüfung nicht; die
 * Frage lautet, zu welcher Zeile welches Dokument gehört. Hier steht die
 * Paarung, je Datei einmal, mit ihrem SHA-256.
 *
 * **Die Stammdaten stehen EINGEFROREN da**, nicht als Verweis: eine
 * Beraternummer ändert sich, wenn das Büro wechselt, und ein drei Jahre alter
 * Stapel soll zeigen, was damals galt.
 */
export const dynamic = 'force-dynamic';

interface KopfRoh {
  readonly id: string;
  readonly von: string;
  readonly bis: string;
  readonly status: string;
  readonly zeilen: number;
  readonly summe_soll_cent: string;
  readonly summe_haben_cent: string;
  readonly berater_nummer: string;
  readonly mandanten_nummer: string;
  readonly kontenrahmen: string;
  readonly sachkontenlaenge: number;
  readonly extf_version: string;
  readonly versteuerungsart: string;
  readonly festschreibung: boolean;
  readonly datei_sha256: string | null;
  readonly dokument_id: string | null;
  readonly format_ungeprueft: boolean;
  readonly erstellt_am: string;
  readonly uebergeben_am: string | null;
  readonly verwerfungsgrund: string | null;
}

interface ManifestRoh {
  readonly belegnummer: string | null;
  readonly datei_sha256: string;
  readonly typ: string;
  readonly zeilen: string;
  readonly summe_cent: string;
  readonly buchungssatz_id: string;
}

const STATUS: Readonly<Record<string, 'Bereit' | 'Abgeschlossen' | 'Abgelehnt'>> = {
  erzeugt: 'Bereit', uebergeben: 'Abgeschlossen', verworfen: 'Abgelehnt',
};

export default async function DatevStapel(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/buchhaltung/datev/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<KopfRoh>(
        `select id, von::text, bis::text, status::text as status, zeilen,
                summe_soll_cent::text, summe_haben_cent::text,
                berater_nummer, mandanten_nummer, kontenrahmen::text as kontenrahmen,
                sachkontenlaenge, extf_version,
                versteuerungsart::text as versteuerungsart, festschreibung,
                datei_sha256, dokument_id, format_ungeprueft, verwerfungsgrund,
                to_char(erstellt_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as erstellt_am,
                to_char(uebergeben_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as uebergeben_am
           from datev_export where id = $1`,
        [id]);
      if (kopf === undefined) return { kopf: null, manifest: [] as ManifestRoh[] };

      /*
       * Ein Eintrag je BELEG, nicht je Zeile: eine Rechnung erzeugt vier bis
       * sechs Buchungszeilen und genau ein PDF. Ein Manifest, das das PDF
       * sechsmal führt, behauptet sechs Belege (D-443).
       */
      const manifest = await kontext.abfrage<ManifestRoh>(
        `select b.belegnummer, b.datei_sha256, b.typ::text as typ,
                count(*)::text as zeilen,
                coalesce(sum(bs.umsatz_cent) filter (where bs.soll_haben = 'soll'),
                         0)::text as summe_cent,
                min(bs.id::text) as buchungssatz_id
           from buchungssatz bs
           join beleg b on b.id = bs.beleg_id and b.mandant_id = bs.mandant_id
          where bs.datev_export_id = $1
          group by b.id, b.belegnummer, b.datei_sha256, b.typ
          order by b.belegnummer nulls last`,
        [id]);

      return { kopf, manifest };
    }))) as { kopf: KopfRoh | null; manifest: readonly ManifestRoh[] };

  if (daten.kopf === null) notFound();
  const k = daten.kopf;

  return (
    <PortalRahmen
      titel={`Stapel ${k.von} – ${k.bis}`}
      wurzelTitel="DATEV-Export"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="datev"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Stapel {k.von} – {k.bis}</h1>
        <div className="flex flex-wrap items-center gap-s3">
          <StatusPill zustand={STATUS[k.status] ?? 'Offen'} />
          <Link
            href={`/portal/${mandant}/buchhaltung/datev`}
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Zur Liste
          </Link>
          {k.dokument_id === null ? (
            <span className="text-sm text-text-muted">
              keine Archivkopie — Speicher nicht verbunden
            </span>
          ) : (
            <a href={`/api/buchhaltung/datev/${k.id}/datei`}
              className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
              Datei laden
            </a>
          )}
        </div>
      </div>

      {k.format_ungeprueft ? (
        <section
          data-cse="datev-format-ungeprueft"
          className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s5"
        >
          <h2 className="text-h3 text-text">
            Format nicht gegen ein echtes Muster geprüft
          </h2>
          <p className="mt-s2 text-sm text-text-muted">
            Dieser Stapel wurde erzeugt, bevor eine EXTF-Musterdatei dieses
            Steuerbüros vorlag (O-05). Die Feldreihenfolge stammt aus der
            veröffentlichten Formatbeschreibung.
          </p>
        </section>
      ) : null}

      <dl className="mb-s7 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {[
          ['Erzeugt', k.erstellt_am],
          ['Zeilen', String(k.zeilen)],
          ['Summe Soll', formatiereGeld(cent(BigInt(k.summe_soll_cent)))],
          ['Summe Haben', formatiereGeld(cent(BigInt(k.summe_haben_cent)))],
          ['Beraternummer', k.berater_nummer],
          ['Mandantennummer', k.mandanten_nummer],
          ['Kontenrahmen', k.kontenrahmen.toUpperCase()],
          ['Sachkontenlänge', String(k.sachkontenlaenge)],
          ['EXTF-Fassung', k.extf_version],
          ['Versteuerungsart', k.versteuerungsart === 'soll' ? 'Soll' : 'Ist'],
          ['Festschreibung', k.festschreibung ? 'ja' : 'nein'],
          ['Übergeben', k.uebergeben_am ?? '—'],
        ].map(([titel, wert]) => (
          /*
           * `min-w-0 break-words` am Wert — D-420: in einem `auto/1fr`-Raster
           * wird die Spalte sonst so breit wie ihr laengstes Wort, und eine
           * Beraternummer neben einem Kontenrahmen reicht dafuer schon.
           */
          <div key={titel} className="min-w-0">
            <dt className="text-sm text-text-subtle">{titel}</dt>
            <dd className="break-words text-text">{wert}</dd>
          </div>
        ))}
      </dl>

      {k.datei_sha256 === null ? null : (
        <p className="mb-s7 break-all font-mono text-xs text-text-subtle">
          SHA-256 der Datei: {k.datei_sha256}
        </p>
      )}

      {k.verwerfungsgrund === null ? null : (
        <section className="mb-s7 rounded-lg border border-warning bg-warning-soft p-s5 text-sm">
          Verworfen: {k.verwerfungsgrund}
        </section>
      )}

      <h2 className="mb-s3 text-h2 text-text">Belegmanifest</h2>
      {daten.manifest.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Diesem Stapel ist keine Buchungszeile zugeordnet. Das ist der Fall,
          wenn jede Zeile des Zeitraums schon in einem früheren Stapel
          gestempelt wurde.
        </p>
      ) : (
        <DataTable
          beschriftung="Je Beleg ein Eintrag, mit seinen Buchungszeilen"
          zeilen={daten.manifest}
          schluessel={(z) => z.datei_sha256 + (z.belegnummer ?? '')}
          spalten={[
            {
              schluessel: 'beleg', kopf: 'Beleg',
              zelle: (z) => (
                <a
                  href={`/api/buchhaltung/buchungen/${z.buchungssatz_id}/beleg`}
                  className="text-text underline underline-offset-2 hover:text-brand"
                >
                  {z.belegnummer ?? 'Dokument'}
                </a>
              ),
            },
            { schluessel: 'typ', kopf: 'Typ', zelle: (z) => z.typ },
            { schluessel: 'zeilen', kopf: 'Zeilen', numerisch: true, zelle: (z) => z.zeilen },
            {
              schluessel: 'summe', kopf: 'Soll', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.summe_cent))),
            },
            {
              schluessel: 'hash', kopf: 'SHA-256 der Datei',
              zelle: (z) => (
                <span className="font-mono text-xs text-text-muted">
                  {z.datei_sha256.slice(0, 16)}…
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
