import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { leseAusgangsbuch, stimmeAb } from '@/server/services/finanz/ausgangsbuch';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/ausgangsbuch` — die Folge der ausgestellten
 * Rechnungen (FIN-16, FIN-06, LEG-01).
 *
 * **Die Abstimmung steht OBEN, nicht unten.** Wer das Ausgangsbuch öffnet,
 * fragt zuerst: stimmt es? Drei Aussagen beantworten das — lückenlos,
 * summengleich, jedes Glied da —, und sie stehen über der Liste, damit
 * niemand sie überliest.
 *
 * **Die Summe wird zweimal gebildet.** Einmal aus der Sicht, einmal aus der
 * Belegtabelle daneben. Weichen sie ab, ist die Sicht falsch — und eine
 * Sicht mit einem falschen Join zeigt plausible Zahlen, bis jemand
 * nachrechnet. Deshalb rechnet hier immer jemand nach.
 *
 * **Entwürfe stehen nicht darin**, und das ist die Zusage, nicht die
 * Auslassung: sie haben keine Nummer und keine rechtliche Existenz.
 */
export const dynamic = 'force-dynamic';

const ART: Readonly<Record<string, string>> = {
  standard: 'Rechnung', abschlag: 'Abschlag', anzahlung: 'Anzahlung',
  schluss: 'Schlussrechnung', storno: 'Storno',
};

export default async function Ausgangsbuch(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/ausgangsbuch`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const jahr = jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      zeilen: await leseAusgangsbuch(kontext, { jahr }),
      abstimmung: await stimmeAb(kontext, { jahr }),
    }))) as Promise<{
      zeilen: Awaited<ReturnType<typeof leseAusgangsbuch>>;
      abstimmung: Awaited<ReturnType<typeof stimmeAb>>;
    }>);

  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Rechnungsausgangsbuch"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="ausgangsbuch"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Rechnungsausgangsbuch</h1>
        <form method="get" className="flex items-center gap-s3">
          <label className="text-sm text-text" htmlFor="jahr">Jahr</label>
          <input
            id="jahr" name="jahr" type="number" min="2000" max="2999" step="1"
            defaultValue={jahr ?? ''} placeholder="alle" className={feld}
          />
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            Anzeigen
          </button>
        </form>
      </div>

      <section aria-labelledby="abstimmung-titel" className="mb-s7">
        <h2 id="abstimmung-titel" className="mb-s3 text-h2 text-text">Abstimmung</h2>
        {daten.abstimmung.kreise.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Zeitraum ist keine Rechnung ausgestellt. Entwürfe stehen
            hier nicht — sie haben keine Nummer.
          </p>
        ) : (
          <div
            data-cse="ausgangsbuch-abstimmung"
            data-ok={String(daten.abstimmung.ok)}
            className={`rounded-lg border p-s5 text-sm ${
              daten.abstimmung.ok
                ? 'border-line bg-surface text-text'
                : 'border-warning bg-warning-soft text-warning'}`}
          >
            <ul className="flex flex-col gap-s3">
              {daten.abstimmung.kreise.map((k) => (
                <li key={k.nummernkreis}>
                  <strong className="text-text">{k.nummernkreis}</strong>:{' '}
                  {k.anzahl} Belege, Nummern {k.ersteNummer}–{k.letzteNummer},{' '}
                  Summe {formatiereGeld(k.summeBuchCent)}
                  {k.summeBuchCent === k.summeBelegeCent
                    ? ' — Buch und Belege stimmen überein'
                    : ` — ABWEICHUNG: die Belege ergeben ${formatiereGeld(k.summeBelegeCent)}`}
                  {k.luecken.length === 0 ? '' : ` · Lücke bei ${k.luecken.join(', ')}`}
                  {k.ohneKettenglied === 0
                    ? ''
                    : ` · ${k.ohneKettenglied} Beleg(e) ohne Kettenglied`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {daten.zeilen.length === 0 ? null : (
        <DataTable
          beschriftung="Ausgestellte Rechnungen je Nummernkreis, nach laufender Nummer"
          zeilen={daten.zeilen}
          schluessel={(z) => z.rechnungId}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${z.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.nummer}
                </Link>
              ),
            },
            { schluessel: 'datum', kopf: 'Datum', zelle: (z) => z.rechnungsdatum },
            {
              schluessel: 'kunde', kopf: 'Kunde (wie auf dem Beleg)',
              zelle: (z) => z.kundeName ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'art', kopf: 'Art',
              zelle: (z) => ART[z.rechnungsart] ?? z.rechnungsart,
            },
            {
              schluessel: 'netto', kopf: 'Netto', numerisch: true,
              zelle: (z) => formatiereGeld(z.nettoCent),
            },
            {
              schluessel: 'steuer', kopf: 'USt', numerisch: true,
              zelle: (z) => formatiereGeld(z.steuerCent),
            },
            {
              schluessel: 'brutto', kopf: 'Brutto', numerisch: true,
              zelle: (z) => formatiereGeld(z.bruttoCent),
            },
            {
              schluessel: 'kette', kopf: 'Kette',
              zelle: (z) => (z.hash === null
                ? <StatusPill zustand="Fehler" />
                : (
                  <span className="font-mono text-xs text-text-muted">
                    #{z.kettePosition} · {z.hash.slice(0, 8)}
                  </span>
                )),
            },
            {
              schluessel: 'hinweis',
              kopf: 'Hinweis',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  {z.storniert ? <StatusPill zustand="Archiviert" /> : null}
                  {z.luecke ? <StatusPill zustand="Fehler" /> : null}
                  {z.storniert ? <span className="text-xs text-text-muted">storniert</span> : null}
                  {z.luecke ? <span className="text-xs text-warning">Lücke davor</span> : null}
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        Der Kundenname stammt aus dem eingefrorenen Beleg, nicht aus dem
        Stammsatz (K-12): wird ein Kunde umbenannt oder anonymisiert, zeigt das
        Buch weiter, was auf der Rechnung stand. Summe {formatiereGeld(cent(
          daten.zeilen.reduce((s, z) => s + z.bruttoCent, 0n)))} über{' '}
        {daten.zeilen.length} Belege.
      </p>
    </PortalRahmen>
  );
}
