import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { formatiereBytes, ilikeMuster, KATEGORIE, KATEGORIEN } from './darstellung';

/**
 * `/portal/[mandant]/dokumente` — die Ablage dieser Gesellschaft: Kategorien,
 * Suche, Filter, Schlagworte (DOC-01, DOC-02, DOC-04), lesend.
 *
 * Gelesen wird `dokument` unter `t_mandant` (`dokument.lesen` im aktiven
 * Bereich). Die Datei selbst liegt in einem privaten Bucket und wird nur ueber
 * eine signierte, kurzlebige Adresse ausgegeben (DOC-03) — die es erst gibt,
 * wenn der Speicher verbunden ist. Die Seite sagt das, statt einen Knopf zu
 * zeigen, der ins Leere fuehrt.
 */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly id: string;
  readonly titel: string;
  readonly kategorie: string;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly tags: readonly string[] | null;
  readonly mime_typ: string | null;
  readonly groesse: string | null;
  readonly sichtbar_fuer_kunde: boolean;
  readonly sichtbar_fuer_mitarbeiter: boolean;
  readonly erstellt: string;
}

type Suchparameter = Promise<Record<string, string | string[] | undefined>>;

function text(p: Record<string, string | string[] | undefined>, name: string, max: number): string {
  const roh = p[name];
  return typeof roh === 'string' ? roh.trim().slice(0, max) : '';
}

export default async function Dokumente(
  { params, searchParams }: { params: Promise<{ mandant: string }>; searchParams: Suchparameter },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/dokumente`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: „Ablegen" verlangt `dokument.schreiben`, diese Liste nur
     `dokument.lesen`. Ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf (D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'dokument.schreiben');

  const p = await searchParams;
  const q = text(p, 'q', 100);
  const tag = text(p, 'tag', 60);
  const kategorieRoh = text(p, 'kategorie', 30);
  const kategorie = KATEGORIEN.includes(kategorieRoh) ? kategorieRoh : '';

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select d.id, d.titel, d.kategorie::text as kategorie, k.name as kunde, o.bezeichnung as objekt,
              d.tags, d.mime_typ, d.groesse_bytes::text as groesse,
              d.sichtbar_fuer_kunde, d.sichtbar_fuer_mitarbeiter,
              to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as erstellt
         from dokument d
         left join kunde k on k.id = d.kunde_id
         left join objekt o on o.id = d.objekt_id
        where d.geloescht_am is null
          and ($1::text = '' or d.kategorie::text = $1)
          and ($2::text = '' or exists (select 1 from unnest(d.tags) as t(tag) where t.tag = $2))
          and ($3::text = '' or d.titel ilike $4 or d.beschreibung ilike $4
               or exists (select 1 from unnest(d.tags) as t(tag) where t.tag ilike $4))
        order by d.erstellt_am desc
        limit 300`,
      [kategorie, tag, q, ilikeMuster(q)]))) as Promise<readonly Zeile[]>);

  const speicher = new SupabaseSpeicher();
  const basis = `/portal/${mandant}/dokumente`;
  const filterLink = (k: string): string => `${basis}?kategorie=${k}${q === '' ? '' : `&q=${encodeURIComponent(q)}`}`;
  const pille = (aktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm',
    'transition-colors duration-fast ease-brand',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');

  return (
    <PortalRahmen
      titel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dokumente"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dokumente</h1>
        {darf['dokument.schreiben'] === true && (
          <Link href={`/portal/${mandant}/dokumente/upload`}
                data-cse="zum-upload"
                className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2">
            Dokument ablegen
          </Link>
        )}
      </div>
      {/*
        * Die Rückmeldung nach einer Löschung (V-026). Sie steht HIER und
        * nicht auf dem Blatt: das Blatt liest `geloescht_am is null` und wäre
        * danach ein 404 — die letzte Antwort auf eine geglückte Handlung darf
        * keine Fehlerseite sein.
        */}
      {p['geloescht'] === '1' ? (
        <Hinweis art="erfolg" cse="dokument-geloescht" className="mb-s5 max-w-prose">
          <strong>Gelöscht.</strong> Die Datei ist aus der Ablage entfernt; die Zeile
          bleibt mit Zeitpunkt, Person und Grund erhalten (Invariante 8) und taucht in
          dieser Liste nicht mehr auf.
        </Hinweis>
      ) : null}
      {speicher.verbunden ? null : (
        <p data-cse="speicher-nicht-verbunden"
           className="mb-s5 max-w-prose rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          Der Dateispeicher ist nicht verbunden (Einstellungen › Integrationen). Ablegen
          und Herunterladen gibt es erst dann — hier steht, was verzeichnet ist.
        </p>
      )}

      <nav aria-label="Kategorie" data-cse="kategorie-filter" className="mb-s4 flex flex-wrap gap-s2">
        <a href={basis} aria-current={kategorie === '' ? 'page' : undefined} className={pille(kategorie === '')}>
          Alle
        </a>
        {KATEGORIEN.map((k) => (
          <a key={k} href={filterLink(k)} data-kategorie={k}
             aria-current={kategorie === k ? 'page' : undefined} className={pille(kategorie === k)}>
            {KATEGORIE[k] ?? k}
          </a>
        ))}
      </nav>
      <form method="get" action={basis} data-cse="dokumente-suche"
            className="mb-s5 flex flex-wrap items-center gap-s3">
        {kategorie === '' ? null : <input type="hidden" name="kategorie" value={kategorie} />}
        <label htmlFor="q" className="text-sm text-text-muted">Suche in Titel, Beschreibung, Schlagworten</label>
        <input id="q" name="q" type="search" defaultValue={q} maxLength={100}
               className="min-h-11 min-w-[16rem] rounded-md border border-line bg-surface px-s3 text-sm text-text" />
        <Button type="submit" variante="secondary">Suchen</Button>
        {tag === '' ? null : (
          <span className="text-sm text-text-muted">
            Schlagwort: <code>{tag}</code>{' '}
            <a href={basis} className="underline">aufheben</a>
          </span>
        )}
      </form>

      {zeilen.length === 0 ? (
        <p data-cse="dokumente-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {q === '' && tag === '' && kategorie === ''
            ? 'Noch kein Dokument in dieser Gesellschaft. Ablegen geht über „Dokument ablegen" — der Dateityp wird dort aus den Bytes bestimmt, die Größe begrenzt und EXIF entfernt (DOC-06).'
            : 'Nichts gefunden in dieser Auswahl.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Dokumente dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'titel', kopf: 'Titel',
              zelle: (z) => (
                <Link href={`/portal/${mandant}/dokumente/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.titel}
                </Link>
              ) },
            { schluessel: 'kategorie', kopf: 'Kategorie', zelle: (z) => KATEGORIE[z.kategorie] ?? z.kategorie },
            { schluessel: 'bezug', kopf: 'Bezug', zelle: (z) => z.kunde ?? z.objekt ?? '—' },
            { schluessel: 'tags', kopf: 'Schlagworte',
              zelle: (z) => (z.tags === null || z.tags.length === 0 ? '—' : (
                <span className="flex flex-wrap gap-s1">
                  {z.tags.map((t) => (
                    <a key={t} href={`${basis}?tag=${encodeURIComponent(t)}`}
                       className="rounded-md bg-surface-3 px-s2 py-s1 text-xs text-text hover:text-brand">{t}</a>
                  ))}
                </span>
              )) },
            { schluessel: 'sichtbar', kopf: 'Sichtbar für',
              zelle: (z) => [z.sichtbar_fuer_kunde ? 'Kunde' : null, z.sichtbar_fuer_mitarbeiter ? 'Beschäftigte' : null]
                .filter((t) => t !== null).join(', ') || 'nur intern' },
            { schluessel: 'groesse', kopf: 'Größe', numerisch: true, zelle: (z) => formatiereBytes(z.groesse) },
            { schluessel: 'erstellt', kopf: 'Abgelegt', zelle: (z) => z.erstellt },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
