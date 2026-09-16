import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { type BeitragZeile, ladeBeitrag } from '@/server/services/social/dienst';
import { STATUS_TEXT, naechsterStatus } from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/social/posts/[id]/planung` — einen freigegebenen Beitrag
 * auf einen Zeitpunkt legen (SOC-03).
 *
 * **Eine eigene Seite, und ein eigenes Recht** (`social.planen`). Planen ist
 * nicht Schreiben: es legt fest, wann derselbe Text nach draussen geht, und
 * ab da geschieht es ohne weiteres Zutun.
 *
 * **Die Uhrzeit ist Berliner Ortszeit** — das Feld sagt es, und der Server
 * rechnet es um (Invariante 2). Ein `datetime-local` ohne Zone, das jemand als
 * UTC liest, verschiebt jeden Sommerbeitrag um zwei Stunden.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Planen — Social Media' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short',
});

const FEHLER: Readonly<Record<string, string>> = {
  vergangenheit: 'Der Zeitpunkt lag nicht in der Zukunft.',
  falscher_status: 'Geplant wird nur, was freigegeben ist.',
  zeitpunkt_unlesbar: 'Der Zeitpunkt war nicht zu lesen.',
  kein_kalendertag: 'Diesen Tag gibt es nicht.',
  keine_uhrzeit: 'Diese Uhrzeit gibt es nicht.',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

export default async function Planung(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/social/posts/[id]/planung`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const b = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) =>
      ladeBeitrag(kontext, id))) as Promise<BeitragZeile | null>);
  if (b === null) notFound();

  const planbar = naechsterStatus(b.status, 'planen') !== null;

  return (
    <PortalRahmen
      titel="Planen"
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="min-w-0 text-h1 text-text hyphens-auto">Planen</h1>
        <Link href={`/portal/${mandant}/social/posts/${id}`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zurück zum Beitrag
        </Link>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="planung-beitrag">
        <strong>{b.titel}</strong> — {STATUS_TEXT[b.status] ?? b.status}
      </p>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="planung-fehler" className="mb-s5 max-w-prose">
          {FEHLER[fehler] ?? 'Die Planung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {!planbar ? (
        <Hinweis art="warnung" cse="planung-unmoeglich" className="max-w-prose">
          <strong>Dieser Beitrag lässt sich nicht planen.</strong> Geplant wird, was
          freigegeben ist — ohne Freigabe gäbe es einen Zeitpunkt, zu dem etwas
          Unbestätigtes hinausginge (SOC-08).
        </Hinweis>
      ) : (
        <form method="post" action={`/api/social/beitraege/${id}/planung`}
              data-cse="planung-formular" className="flex max-w-prose flex-col gap-s4">
          {/*
            * **Ohne dieses Feld kam die Tafel oben nie zum Zug.**
            *
            * `FEHLER[…]` stand hier von Anfang an; die Route antwortete einem
            * Formular aber mit `{"fehler":"vergangenheit"}` auf einer weissen
            * Seite. Jetzt schickt sie den Schlüssel hierher zurück.
            */}
          <input type="hidden" name="zurueck"
                 value={`/portal/${mandant}/social/posts/${id}/planung`} />
          <div className="flex flex-col gap-s2">
            <label htmlFor="zeitpunkt" className="text-xs text-text-muted">
              Zeitpunkt (Berliner Zeit)
            </label>
            <input id="zeitpunkt" name="zeitpunkt" type="datetime-local" required
                   className={FELD} data-cse="planung-zeitpunkt" />
            <p className="text-xs text-text-subtle">
              Angezeigt und gemeint ist Europe/Berlin; gespeichert wird der Zeitpunkt in UTC.
              Geprüft wird gegen die Uhr des Servers, nicht die dieses Geräts.
            </p>
          </div>
          <Button type="submit" variante="primary" data-cse="planung-speichern">
            Auf diesen Zeitpunkt legen
          </Button>
        </form>
      )}

      {b.geplantFuer !== null ? (
        <p className="mt-s6 max-w-prose text-sm text-text-muted" data-cse="planung-bisher">
          Bisher geplant: {BERLIN.format(new Date(b.geplantFuer))}
        </p>
      ) : null}
    </PortalRahmen>
  );
}
