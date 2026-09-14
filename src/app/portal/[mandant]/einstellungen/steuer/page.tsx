import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/steuer` — die Steuersatzgruppen der
 * Plattform und die steuerliche Identitaet dieser Gesellschaft (LEG-05,
 * FIN-09, §5.3), lesend.
 *
 * **Die Gruppen sind der Katalog, nicht eine Einstellung dieser Gesellschaft.**
 * Umsatzsteuer wird je Steuersatzgruppe gerechnet, nie aus einer Bruttosumme
 * (Invariante 1); welche Gruppen es gibt, sagt das Gesetz, und die Tabelle
 * sagt, seit wann. Die Identitaet (USt-IdNr., Steuernummer, Finanzamt) ist
 * die dieser Gesellschaft — und solange sie unbestaetigt ist, sagt die
 * Seite das (O-353).
 */
export const dynamic = 'force-dynamic';

const KATEGORIE: Readonly<Record<string, string>> = {
  S: 'Regelsatz', AE: 'Umkehr der Steuerschuld (Reverse Charge)', E: 'Steuerbefreit',
  Z: 'Nullsatz', G: 'Ausfuhr', O: 'Nicht steuerbar', K: 'Innergemeinschaftlich', L: 'Kanarische Inseln', M: 'Ceuta/Melilla',
};

interface Gruppe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly satz_bp: number;
  readonly kategorie: string;
  readonly kennzeichen: string;
  readonly befreiungsgrund: string | null;
  readonly gueltig_von: string | null;
  readonly gueltig_bis: string | null;
}

interface Identitaet {
  readonly firma: string;
  readonly ust_id: string | null;
  readonly steuernummer: string | null;
  readonly finanzamt: string | null;
  readonly ist_rechtseinheit: boolean;
  readonly bestaetigt: boolean;
}

/** Basispunkte als Prozent — Anzeige, keine Steuerrechnung. */
function prozent(bp: number): string {
  return `${(bp / 100).toLocaleString('de-DE')} %`;
}

export default async function Steuer(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/steuer`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const { gruppen, identitaet } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      gruppen: await kontext.abfrage<Gruppe>(
        `select schluessel, bezeichnung, satz_bp, kategorie::text as kategorie,
                steuer_kennzeichen::text as kennzeichen,
                coalesce(befreiungsgrund_text, befreiungsgrund_code) as befreiungsgrund,
                to_char(gueltig_von, 'DD.MM.YYYY') as gueltig_von,
                to_char(gueltig_bis, 'DD.MM.YYYY') as gueltig_bis
           from steuersatz_gruppe
          order by satz_bp desc, schluessel`),
      identitaet: (await kontext.abfrage<Identitaet>(
        `select firma, ust_id, steuernummer, finanzamt, ist_rechtseinheit,
                (angaben_bestaetigt_am is not null) as bestaetigt
           from mandant where id = $1`, [mandantId]))[0] ?? null,
    }))) as Promise<{ gruppen: readonly Gruppe[]; identitaet: Identitaet | null }>);
  if (identitaet === null) notFound();

  return (
    <PortalRahmen
      titel="Steuer"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/einstellungen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Steuer</h1>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Steuerliche Identität — {identitaet.firma}</h2>
        {identitaet.bestaetigt ? null : (
          <p data-cse="steuer-unbestaetigt" className="mb-s4 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
            Nicht bestätigt (O-353): USt-IdNr. und Steuernummer stammen aus dem Demonstrationsbestand.
          </p>
        )}
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">USt-IdNr.</dt>
            <dd className="m-0 text-sm text-text">{identitaet.ust_id ?? 'nicht hinterlegt'}</dd>
          </div>
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Steuernummer</dt>
            <dd className="m-0 text-sm text-text">{identitaet.steuernummer ?? 'nicht hinterlegt'}</dd>
          </div>
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Finanzamt</dt>
            <dd className="m-0 text-sm text-text">{identitaet.finanzamt ?? 'nicht hinterlegt'}</dd>
          </div>
          <div className="contents">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Rechtseinheit</dt>
            <dd className="m-0 text-sm text-text">{identitaet.ist_rechtseinheit ? 'ja — stellt eigene Rechnungen (§ 14 UStG)' : 'nein'}</dd>
          </div>
        </dl>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Steuersatzgruppen</h2>
      <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
        Umsatzsteuer entsteht je Gruppe aus den Nettobeträgen ihrer Positionen — nie
        aus einer Bruttosumme (Invariante 1). Die Gruppen gelten plattformweit; ein
        Satz ändert sich per Gesetz und Migration, nicht per Klick.
      </p>
      <div data-cse="steuersatzgruppen">
        <DataTable
          beschriftung="Steuersatzgruppen"
          zeilen={gruppen}
          schluessel={(g) => g.schluessel}
          spalten={[
            { schluessel: 'bezeichnung', kopf: 'Gruppe', zelle: (g) => g.bezeichnung },
            { schluessel: 'schluessel', kopf: 'Schlüssel', zelle: (g) => <code className="text-xs">{g.schluessel}</code> },
            { schluessel: 'satz', kopf: 'Satz', numerisch: true, zelle: (g) => prozent(g.satz_bp) },
            { schluessel: 'kategorie', kopf: 'EN 16931', zelle: (g) => `${g.kategorie} · ${KATEGORIE[g.kategorie] ?? ''}`.replace(/ · $/u, '') },
            { schluessel: 'kennzeichen', kopf: 'Kennzeichen', zelle: (g) => g.kennzeichen },
            { schluessel: 'befreiung', kopf: 'Befreiungsgrund', zelle: (g) => g.befreiungsgrund ?? '—' },
            { schluessel: 'gueltig', kopf: 'Gültig',
              zelle: (g) => `${g.gueltig_von ?? '…'} – ${g.gueltig_bis ?? 'offen'}` },
          ]}
        />
      </div>
    </PortalRahmen>
  );
}
