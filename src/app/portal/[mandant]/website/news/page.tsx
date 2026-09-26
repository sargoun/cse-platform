import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  NEUIGKEITS_ARTEN, listeBeitraege, type BeitragZeile,
} from '@/server/services/social/dienst';
import { type BeitragStatus, STATUS_TEXT } from '@/server/services/social/weg';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/website/news` — was auf
 * `/unternehmen/<bereich>/news` erscheint (PRO-02, SOC-05).
 *
 * **Der Unterschied zu `/social/posts` ist die ART, nicht die Tabelle.** Beide
 * lesen `beitrag`. Diese Liste zeigt, was die Gesellschaft auf ihrer EIGENEN
 * Seite ankündigt — `NEUIGKEITS_ARTEN`, also `neuigkeit` und
 * `aktualisierung`; `/social/posts` zeigt alles und kümmert sich um die
 * externen Kanäle. Ob eine `projektschau` als Neuigkeit zählt, ist offen
 * (O-548) und steht an genau dieser einen Konstante.
 *
 * **Bearbeitet wird auf der Social-Seite.** Zwei Editoren auf einer Tabelle
 * sind später zwei Verhaltensweisen, und die eine läuft der Regel in `weg.ts`
 * hinterher. Diese Seite zeigt, was öffentlich steht, und führt zum Editor —
 * sie ist keine zweite Fassung von ihm.
 *
 * **`beitrag` hat keine Sprachspalte.** Die englische Newsseite zeigt dieselbe
 * Zeile; ein Beitrag steht auf `/unternehmen/<bereich>/news` und
 * `/en/unternehmen/<bereich>/news` im selben Wortlaut. Das ist kein Versehen
 * dieser Seite, sondern der heutige Stand des Schemas — und er steht hier, weil
 * er sonst niemandem auffällt.
 *
 * // TODO(client, O-681): Sollen Neuigkeiten zweisprachig geführt werden?
 * // `seite` und `unternehmensprofil` tragen eine `sprache` und führen je
 * // Sprache eine eigene Zeile (D-82); `beitrag` nicht — die englische
 * // Newsseite zeigt deshalb den deutschen Wortlaut.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Neuigkeiten' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const ART: Readonly<Record<string, string>> = {
  neuigkeit: 'Neuigkeit', aktualisierung: 'Aktualisierung',
  beitrag: 'Beitrag', projektschau: 'Projektschau',
};

const FILTER: readonly BeitragStatus[] = [
  'entwurf', 'vorgelegt', 'freigegeben', 'geplant', 'veroeffentlicht',
];

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', vorgelegt: 'In Prüfung', freigegeben: 'Bereit',
  geplant: 'Geplant', veroeffentlicht: 'Aktiv', abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
};

export default async function WebsiteNews(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/website/news`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * **Die Route und die Policy fragen nach verschiedenen Rechten.** Im
   * Manifest ist `/website/news` mit `referenz.schreiben` bewacht (das halten
   * `admin` und `super_admin`); `t_beitrag_lesen` verlangt `social.lesen` und
   * `t_beitrag_schreiben` `social.schreiben` (die halten zusätzlich
   * `leitung`). Heute enthält jede Rolle mit `referenz.schreiben` auch
   * `social.lesen`, also kommt die Liste gefüllt zurück. Geprüft wird es
   * trotzdem: eine leere Tabelle, die „keine Neuigkeiten" heisst, wäre die
   * falscheste aller Auskünfte. Die Gegenrichtung — `leitung` hält
   * `social.*` ohne `referenz.schreiben` und kommt gar nicht hierher — kann
   * diese Seite nicht heilen; das ist eine Frage an die Seitenkarte.
   */
  const darf = await haeltRechte(zugang.sitzung, 'social.lesen', 'social.schreiben');
  const liest = darf['social.lesen'] === true;

  const suche = await searchParams;
  const roh = suche['status'];
  const status = typeof roh === 'string' && (FILTER as readonly string[]).includes(roh)
    ? roh as BeitragStatus : null;

  const zeilen = liest
    ? await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, (kontext) => listeBeitraege(kontext, {
        arten: NEUIGKEITS_ARTEN, ...(status === null ? {} : { status }),
      }))) as Promise<readonly BeitragZeile[]>)
    : [];

  const knopf = (aktiv: boolean): string =>
    'inline-flex min-h-11 items-center rounded-md border px-s4 py-s3 text-sm '
    + (aktiv ? 'border-brand bg-surface-3 text-text' : 'border-line text-text hover:bg-surface-2');

  const spalten: readonly Spalte<BeitragZeile>[] = [
    {
      schluessel: 'titel', kopf: 'Neuigkeit',
      zelle: (z) => (
        <div className="min-w-0">
          <Link href={`/portal/${mandant}/website/news/${z.id}`}
                data-cse="neuigkeit"
                className="text-text underline underline-offset-4 hover:text-brand">
            {z.titel}
          </Link>
          <div className="mt-s1 font-mono text-xs text-text-subtle" data-cse="slug">
            {`/unternehmen/${mandant}/news/${z.slug}`}
          </div>
        </div>
      ),
    },
    { schluessel: 'art', kopf: 'Art', zelle: (z) => ART[z.art] ?? z.art },
    {
      schluessel: 'status', kopf: 'Stand',
      zelle: (z) => (
        <span className="inline-flex flex-wrap items-center gap-s2"
              data-cse="beitrag-status" data-status={z.status}>
          <StatusPill zustand={PILLE[z.status] ?? 'Offen'} />
          {z.zurueckgezogenAm === null ? null : (
            <span className="text-xs text-warning">zurückgezogen</span>
          )}
        </span>
      ),
    },
    {
      schluessel: 'wann', kopf: 'Geplant / öffentlich',
      zelle: (z) => {
        const wann = z.veroeffentlichtAm ?? z.geplantFuer;
        return wann === null
          ? <span className="text-text-subtle">—</span>
          : <span className="text-sm">{BERLIN.format(new Date(wann))}</span>;
      },
    },
  ];

  return (
    <PortalRahmen
      titel="Neuigkeiten"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="news"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Neuigkeiten</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Hier steht, was auf{' '}
        <code className="font-mono">/unternehmen/{mandant}/news</code> erscheint — nicht,
        was in externe Kanäle geht. Das ist{' '}
        <Link href={`/portal/${mandant}/social/posts`}
              className="underline underline-offset-4 hover:text-brand"
              data-cse="zu-social">Social Media</Link>
        {' '}und derselbe Datensatz: ein Beitrag geht auf die eigene Seite, sobald er
        veröffentlicht ist, und in einen Kanal nur, wenn er dort gewählt wurde.
      </p>

      {!liest && (
        <Hinweis art="warnung" cse="ohne-social-lesen" className="mb-s5 max-w-prose">
          <strong className="block">Diese Liste ist dieser Sitzung nicht lesbar.</strong>
          Die Tabelle <code className="font-mono">beitrag</code> hängt am Recht{' '}
          <Recht schluessel="social.lesen" /> (Policy{' '}
          <code className="font-mono">t_beitrag_lesen</code>), diese Route dagegen an{' '}
          <Recht schluessel="referenz.schreiben" />. Hier steht deshalb
          nichts — und das heisst nicht, dass es keine Neuigkeiten gibt.
        </Hinweis>
      )}

      <nav aria-label="Nach Stand filtern" className="mb-s5 flex flex-wrap gap-s2">
        <Link href={`/portal/${mandant}/website/news`} className={knopf(status === null)}
              data-cse="filter-alle">Alle</Link>
        {FILTER.map((s) => (
          <Link key={s} href={`/portal/${mandant}/website/news?status=${s}`}
                className={knopf(status === s)} data-cse={`filter-${s}`}>
            {STATUS_TEXT[s]}
          </Link>
        ))}
      </nav>

      {liest && (zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-neuigkeiten" className="max-w-prose">
          {status === null
            ? 'Noch keine Neuigkeit. Ein Entwurf entsteht unter Social Media und geht von '
              + 'dort durch die Freigabe — nicht direkt auf die Website.'
            : `Keine Neuigkeit mit dem Stand „${STATUS_TEXT[status]}".`}
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Neuigkeiten dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={spalten}
        />
      ))}

      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        Als Neuigkeit zählen die Arten {NEUIGKEITS_ARTEN.map((k) => ART[k] ?? k).join(' und ')}.
        Ob eine Projektschau dazugehört, ist redaktionell offen (O-548); sie hat mit{' '}
        <code className="font-mono">/unternehmen/{mandant}/projekte</code> ohnehin ihre
        eigene Liste. <strong>Die englische Newsseite zeigt dieselben Zeilen</strong> —{' '}
        <code className="font-mono">beitrag</code> führt keine Sprachspalte (O-681).
      </p>
    </PortalRahmen>
  );
}
