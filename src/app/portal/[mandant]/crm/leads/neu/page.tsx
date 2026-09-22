import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/crm/leads/neu` — einen Lead von Hand anlegen (CRM-07).
 *
 * **Der Weg für das, was am Telefon passiert.** Die Plattform kannte bisher
 * genau einen Weg, auf dem ein Lead entsteht: das öffentliche Formular. Ein
 * Anruf, eine Messe, eine Empfehlung im Vorbeigehen — alles das endete auf
 * einem Zettel, und der Vertrieb pflegte zwei Listen.
 *
 * **Er trägt KEINE Frist.** `sla_stunden` steht an einem Formular; ein Lead aus
 * einem Telefonat hat keine zu erben, und eine zu erfinden hiesse, eine
 * Geschäftsregel per Vorgabewert zu wählen (O-14). Die REQ-06-Eskalation läuft
 * deshalb auf diesen Lead nicht — was richtig ist: niemand hat dem Anrufer eine
 * Frist zugesagt.
 *
 * **Und er gehört dem, der ihn anlegt.** Ein Auswahlfeld „zuständig" wäre die
 * ehrlichere Oberfläche, sobald es mehr als eine Handvoll Menschen sind; heute
 * wäre es eine Liste, aus der man sich selbst heraussucht.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Neuer Lead — CRM' };

const FELD = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

interface KundeZeile { readonly id: string; readonly name: string; readonly kundennummer: string }

export default async function LeadNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/crm/leads/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'crm.schreiben', 'crm.lesen');
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const kunden = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<KundeZeile>(
      `select id, name, kundennummer from kunde
        where mandant_id = app.aktiver_mandant() and archiviert_am is null
        order by name limit 500`,
    ))) as Promise<readonly KundeZeile[]>);

  return (
    <PortalRahmen
      titel="Neuer Lead"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['crm.lesen'] === true && (
        <p className="mb-s3 text-sm">
          <Link href={`/portal/${mandant}/crm/leads`}
                className="text-text-muted underline-offset-2 hover:underline">
            ← Leads
          </Link>
        </p>
      )}
      <h1 className="mb-s5 mt-0 text-h1 text-text">Neuer Lead</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="lead-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['crm.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          Zum Anlegen fehlt Ihnen <Recht schluessel="crm.schreiben" />.
        </Hinweis>
      ) : (
        <form method="post" action="/api/crm/lead" data-cse="lead-formular"
              className="flex max-w-[56ch] flex-col gap-s5">
          <input type="hidden" name="zurueck" value={pfad} />

          <Card>
            <div className="flex flex-col gap-s4">
              <label className="flex flex-col gap-s2 text-sm text-text">
                Betreff
                <input name="betreff" required className={FELD} data-cse="lead-betreff"
                       placeholder="z. B. Unterhaltsreinigung Bürohaus Mitte" />
              </label>

              <label className="flex flex-col gap-s2 text-sm text-text">
                Bestehender Kunde
                <select name="kundeId" className={FELD} data-cse="lead-kunde">
                  <option value="">— keiner, Firma unten eintragen —</option>
                  {kunden.map((k) => (
                    <option key={k.id} value={k.id}>{`${k.name} (${k.kundennummer})`}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-s2 text-sm text-text">
                oder Firma im Klartext
                <input name="firmaName" className={FELD} data-cse="lead-firma" />
                <span className="text-xs text-text-muted">
                  Eines von beiden muss stehen — ein Lead ohne Namen ist eine Notiz.
                </span>
              </label>

              <label className="flex flex-col gap-s2 text-sm text-text">
                Was wird gebraucht?
                <textarea name="bedarf" rows={4} className={FELD} />
              </label>
            </div>
          </Card>

          <Hinweis art="hinweis" cse="lead-keine-frist" className="max-w-prose">
            <strong className="block">Dieser Lead bekommt keine Frist.</strong>
            Eine SLA-Frist hängt an einem Formular und daran, was dem Anfragenden
            zugesagt wurde. Für einen Lead aus einem Telefonat eine zu erfinden hiesse,
            eine Geschäftsregel zu wählen, die niemand vereinbart hat (O-14). Ein
            Wiedervorlagedatum können Sie am Lead selbst setzen.
          </Hinweis>

          <Button type="submit" variante="primary" className="self-start"
                  data-cse="lead-anlegen">
            Lead anlegen
          </Button>
        </form>
      )}
    </PortalRahmen>
  );
}
