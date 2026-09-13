import Link from 'next/link';
import { notFound } from 'next/navigation';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm` — die Einstiegsseite des Moduls.
 *
 * Sie zaehlt und verweist, mehr nicht. Die Zahlen kommen aus EINER Abfrage:
 * drei Kacheln mit drei Rundreisen waeren drei Momentaufnahmen, die sich
 * widersprechen koennen.
 *
 * **Die letzte Zahl fragt das TOR, nicht die Spalten.** Der
 * `rechtsgrundlage`-Block auf `ansprechpartner` ist `cse_app` entzogen
 * (K-05) — ein `where rechtsgrundlage = 'keine'` scheitert hier mit
 * `42501`, und das ist richtig so. Gezaehlt wird deshalb, was
 * `app.darf_kontaktiert_werden` ABWEIST: dieselbe Funktion, die auch der
 * Sendepfad fragt, statt einer zweiten Formulierung derselben Regel.
 */
export const dynamic = 'force-dynamic';

interface Zahlen {
  readonly kunden: string;
  readonly kontakte: string;
  readonly leads_offen: string;
  readonly ohne_grundlage: string;
}

export default async function CrmUebersicht(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/crm`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const [zahlen] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Zahlen>(
      `select (select count(*) from kunde where archiviert_am is null)::text as kunden,
              (select count(*) from ansprechpartner where archiviert_am is null)::text
                as kontakte,
              (select count(*) from lead
                where archiviert_am is null
                  and status not in ('gewonnen','verloren','kein_bedarf'))::text as leads_offen,
              (select count(*) from ansprechpartner ap
                where ap.archiviert_am is null
                  and not app.darf_kontaktiert_werden(ap.id, 'email', 'werbung'))::text
                as ohne_grundlage`,
    ))) as Promise<readonly Zahlen[]>);

  /**
   * Das Ziel steht als Objekt, nicht als zusammengebaute Zeichenkette.
   *
   * `typedRoutes` prueft `href` gegen die WIRKLICH vorhandenen Routen; eine
   * zur Laufzeit gebaute Adresse kann es nicht pruefen und weist sie ab. Die
   * Objektform sagt Pfadmuster und Werte getrennt — und faellt damit auf, wenn
   * die Route eines Tages anders heisst.
   */
  const kacheln = [
    { label: 'Kunden', wert: zahlen?.kunden ?? '0',
      ziel: { pathname: `/portal/${mandant}/crm/kunden` } },
    { label: 'Ansprechpartner', wert: zahlen?.kontakte ?? '0',
      ziel: { pathname: `/portal/${mandant}/crm/kunden` } },
    { label: 'Leads offen', wert: zahlen?.leads_offen ?? '0',
      ziel: { pathname: `/portal/${mandant}/crm/leads` } },
  ];

  return (
    <PortalRahmen
      titel="CRM"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">CRM</h1>

      <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {kacheln.map((k) => (
          <li key={k.label}>
            <Link
              href={k.ziel}
              className="block rounded-lg border border-line bg-surface p-s5 hover:bg-surface-2"
            >
              <span className="text-micro uppercase tracking-[0.08em] text-text-muted">
                {k.label}
              </span>
              <span className="mt-s2 block cse-zahl text-h2 text-text">{k.wert}</span>
            </Link>
          </li>
        ))}
      </ul>

      {(zahlen?.ohne_grundlage ?? '0') === '0' ? null : (
        <p
          data-cse="ohne-grundlage"
          className="mt-s5 max-w-prose rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          {`${zahlen?.ohne_grundlage ?? '0'} Ansprechpartner dürfen nicht beworben werden`}
          {' '}— keine Rechtsgrundlage oder ein Widerspruch. Das Tor hält sie
          zurück; diese Zahl sagt, wie viele es sind.
        </p>
      )}
    </PortalRahmen>
  );
}
