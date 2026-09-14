import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import {
  listeAbwesenheiten, type AbwesenheitZeile,
} from '@/server/services/abwesenheit/index';

/**
 * `/portal/[mandant]/personal/abwesenheiten` — wer wann nicht da ist (EMP-05,
 * EMP-10, TIM-05).
 *
 * **Diese Liste sagt „abwesend", nicht „krank".** Die Art der Abwesenheit
 * steht hier nirgends, und das ist kein Ausblenden in der Oberfläche: die
 * Spalten `abwesenheitsart_id`, `bemerkung`, `au_*` sind der Anwendungsrolle
 * als Spaltenrecht entzogen (0073, Art. 9 DSGVO). Wer den Grund braucht, hat
 * dafür ein eigenes Recht — und jeder solche Zugriff steht im Auditlog.
 *
 * Gezeigt wird ein Fenster von vier Wochen um den gewählten Montag. Eine Liste
 * „alles ab heute" wäre im Januar leer und im Juli unlesbar.
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  beantragt: 'Beantragt',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
  storniert: 'Storniert',
  erfasst: 'Erfasst',
};

export default async function Abwesenheitsliste({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/abwesenheiten`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = typeof frage['woche'] === 'string' ? frage['woche'] : null;
  const anker = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? roh : heute;
  // Eine Woche zurück, drei nach vorn: der Blick, den eine Planung braucht.
  const von = tagePlus(montag(anker), -7);
  const bis = tagePlus(von, 27);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const liste = await listeAbwesenheiten(kontext, { von, bis });
      // Die Zahl am Knopf zählt ANTRÄGE, nicht Abwesenheiten — sonst stünde
      // neben „Anträge" die Zahl von etwas anderem.
      const [offeneAntraege] = await kontext.abfrage<{ anzahl: string }>(
        `select count(*)::text as anzahl from antrag
          where status in ('eingereicht','in_pruefung')`,
      );
      return { liste, offeneAntraege: Number(offeneAntraege?.anzahl ?? '0') };
    }),
  ) as Promise<{ liste: readonly AbwesenheitZeile[]; offeneAntraege: number }>);
  const { liste: zeilen, offeneAntraege } = daten;

  return (
    <PortalRahmen
      titel="Abwesenheiten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Abwesenheiten</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Eintrag' : `${String(zeilen.length)} Einträge`}
          {' · '}
          <span className="tabular-nums">{von}</span> bis <span className="tabular-nums">{bis}</span>
        </p>
      </div>

      <nav aria-label="Zeitraum wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung mandant={mandant} ziel={tagePlus(von, -28)} text="← Früher" />
        <Sprung mandant={mandant} ziel={heute} text="Um heute" />
        <Sprung mandant={mandant} ziel={tagePlus(von, 28)} text="Später →" />
        <Link
          href={`/portal/${mandant}/personal/antraege`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Anträge
          {offeneAntraege > 0 && (
            <span className="ml-s2 text-warning">{offeneAntraege}</span>
          )}
        </Link>
        <Link
          href={`/portal/${mandant}/personal/stundenkonten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Stundenkonten
        </Link>
        <Link
          href={`/portal/${mandant}/personal/nachweise`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Nachweise
        </Link>
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In diesen vier Wochen ist niemand abgemeldet. Das ist eine Aussage
          über das Fenster, nicht über das Jahr.
        </p>
      ) : (
        <DataTable
          beschriftung={`Abwesenheiten vom ${von} bis ${bis}`}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'person', kopf: 'Person', zelle: (z) => z.personName },
            {
              schluessel: 'zeitraum',
              kopf: 'Von – bis',
              zelle: (z) => (
                <span className="tabular-nums">
                  {z.von}
                  {z.vonHalbtags && ' ½'}
                  {' – '}
                  {z.bis}
                  {z.bisHalbtags && ' ½'}
                </span>
              ),
            },
            {
              schluessel: 'tage',
              kopf: 'Tage',
              numerisch: true,
              zelle: (z) => (z.tageAngerechnet === null ? '—' : tageText(z.tageAngerechnet)),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className={z.status === 'beantragt' ? 'text-warning' : 'text-text-muted'}>
                  {STATUS_TEXT[z.status] ?? z.status}
                </span>
              ),
            },
            {
              schluessel: 'handlung',
              kopf: 'Entscheidung',
              zelle: (z) => <Entscheidung zeile={z} mandant={mandant} pfad={pfad} />,
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Warum jemand fehlt, steht hier nicht — und lässt sich hier auch nicht
        erfragen. Die Art der Abwesenheit, eine vorliegende
        Arbeitsunfähigkeitsbescheinigung und jede Bemerkung sind
        Gesundheitsdaten nach Art. 9 DSGVO und hängen an einem eigenen Recht;
        jeder Zugriff darauf wird protokolliert (LEG-09).
      </p>
    </PortalRahmen>
  );
}

/**
 * `"4.000"` → `„4"`, `"4.500"` → `„4,5"`.
 *
 * `numeric(12,3)` kommt mit drei Nachkommastellen aus der Datenbank, und
 * „4,000" liest sich auf einem deutschen Bildschirm wie viertausend. Die
 * Stellen bleiben in der Datenbank, wo sie hingehören; die Anzeige zeigt, was
 * die Zahl bedeutet.
 */
function tageText(roh: string): string {
  const [ganz = '0', bruch = ''] = roh.split('.');
  const gekuerzt = bruch.replace(/0+$/u, '');
  return gekuerzt === '' ? ganz : `${ganz},${gekuerzt}`;
}

function Entscheidung({ zeile, mandant, pfad }: {
  readonly zeile: AbwesenheitZeile; readonly mandant: string; readonly pfad: string;
}) {
  if (zeile.status === 'abgelehnt' || zeile.status === 'storniert') {
    return <span className="text-sm text-text-subtle">abgeschlossen</span>;
  }
  return (
    <form
      action={`/api/abwesenheiten/${zeile.id}`}
      method="post"
      className="flex flex-wrap items-center gap-s2"
    >
      <input type="hidden" name="mandant" value={mandant} />
      <input type="hidden" name="zurueck" value={pfad} />
      <label>
        <span className="sr-only">Grund</span>
        <input
          name="grund"
          placeholder="Grund"
          className="min-h-11 w-32 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
        />
      </label>
      {zeile.status === 'beantragt' && (
        <>
          <Button type="submit" name="entscheidung" value="genehmigt" variante="primary">
            Genehmigen
          </Button>
          <Button type="submit" name="entscheidung" value="abgelehnt" variante="secondary">
            Ablehnen
          </Button>
        </>
      )}
      <Button type="submit" name="entscheidung" value="storniert" variante="ghost">
        Stornieren
      </Button>
    </form>
  );
}

function Sprung({ mandant, ziel, text }: {
  readonly mandant: string; readonly ziel: string; readonly text: string;
}) {
  return (
    <Link
      href={`/portal/${mandant}/personal/abwesenheiten?woche=${ziel}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
