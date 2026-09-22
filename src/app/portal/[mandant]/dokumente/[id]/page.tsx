import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { formatiereBytes, KATEGORIE } from '../darstellung';
import { kennungOder404 } from '../../../kennung';

/**
 * `/portal/[mandant]/dokumente/[id]` — die Metadaten eines Dokuments
 * (DOC-05, DOC-07): Kategorie, Bezug, Pruefstand der Datei, Aufbewahrung.
 *
 * Kein Vorschaubild und kein Download, solange der Speicher nicht verbunden
 * ist: die Datei wird nur ueber eine signierte Adresse ausgegeben (DOC-03),
 * und eine Adresse, die niemand signieren kann, gibt es nicht. Das
 * Zugriffsprotokoll (SEC-A9) kommt mit der Ausgabe — es protokolliert
 * Zugriffe, die es geben kann.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface Dokument {
  readonly id: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly kategorie: string;
  readonly kunde: string | null;
  readonly kunde_id: string | null;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly tags: readonly string[] | null;
  readonly bucket: string;
  readonly mime_typ: string | null;
  readonly mime_verifiziert: boolean;
  readonly exif_entfernt: boolean;
  readonly groesse: string | null;
  readonly sichtbar_fuer_kunde: boolean;
  readonly sichtbar_fuer_mitarbeiter: boolean;
  readonly aufbewahrung_bis: string | null;
  readonly loeschsperre: boolean;
  readonly erstellt: string;
  readonly erstellt_von: string | null;
}

function Feld({ label, wert }: { readonly label: string; readonly wert: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}

export default async function Dokumentblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/dokumente/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: `…/crm/kunden/[id]` verlangt laut Manifest `crm.lesen`,
     `…/objekte/[id]` verlangt `objekt.lesen` — diese Seite verlangt keins
     von beiden. Wer das Dokument lesen, aber Kunde oder Objekt nicht oeffnen
     darf, bekam hinter dem Bezug ein 404; ein Verweis auf 404 verraet, was er
     nicht zeigen darf. Der Name bleibt als Text (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(
    zugang.sitzung, 'crm.lesen', 'objekt.lesen', 'dokument.kunde_freigeben');

  const [d] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Dokument>(
      `select d.id, d.titel, d.beschreibung, d.kategorie::text as kategorie,
              k.name as kunde, d.kunde_id, o.bezeichnung as objekt, d.objekt_id, d.tags,
              d.bucket, d.mime_typ, d.mime_verifiziert, d.exif_entfernt, d.groesse_bytes::text as groesse,
              d.sichtbar_fuer_kunde, d.sichtbar_fuer_mitarbeiter,
              to_char(d.aufbewahrung_bis, 'DD.MM.YYYY') as aufbewahrung_bis, d.loeschsperre,
              to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as erstellt,
              b.name as erstellt_von
         from dokument d
         left join kunde k on k.id = d.kunde_id
         left join objekt o on o.id = d.objekt_id
         left join benutzer b on b.id = d.erstellt_von
        where d.id = $1 and d.geloescht_am is null`, [id]))) as Promise<readonly Dokument[]>);
  if (d === undefined) notFound();
  const speicher = new SupabaseSpeicher();

  return (
    <PortalRahmen
      titel={d.titel}
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dokumente"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{d.titel}</h1>
      {d.beschreibung === null ? null : <p className="mb-s5 max-w-[72ch] text-base text-text-muted">{d.beschreibung}</p>}

      <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s4 text-h3 text-text">Einordnung</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Kategorie" wert={KATEGORIE[d.kategorie] ?? d.kategorie} />
            <Feld label="Kunde" wert={d.kunde === null || d.kunde_id === null ? '—' : darf['crm.lesen'] === true ? (
              <Link href={`/portal/${mandant}/crm/kunden/${d.kunde_id}`} className="underline-offset-2 hover:underline">{d.kunde}</Link>) : d.kunde} />
            <Feld label="Objekt" wert={d.objekt === null || d.objekt_id === null ? '—' : darf['objekt.lesen'] === true ? (
              <Link href={`/portal/${mandant}/objekte/${d.objekt_id}`} className="underline-offset-2 hover:underline">{d.objekt}</Link>) : d.objekt} />
            <Feld label="Schlagworte" wert={d.tags === null || d.tags.length === 0 ? '—' : d.tags.join(', ')} />
            <Feld label="Sichtbar für" wert={(
              <>
                {[d.sichtbar_fuer_kunde ? 'Kunde' : null,
                  d.sichtbar_fuer_mitarbeiter ? 'Beschäftigte' : null]
                  .filter((t) => t !== null).join(', ') || 'nur intern'}
                {/*
                  * Der Weg zur Kundenfreigabe — sie ist ein eigener Vorgang mit
                  * eigenem Recht (`dokument.kunde_freigeben`), und nicht
                  * dasselbe wie `dokument.schreiben`. Ohne die Rechtepruefung
                  * fuehrte der Verweis fuer eine Beschaeftigtenrolle auf 404
                  * und verriete damit, was er nicht zeigen darf (AUT-06).
                  */}
                {darf['dokument.kunde_freigeben'] === true && (
                  <Link
                    href={`/portal/${mandant}/dokumente/${d.id}/kundenfreigabe`}
                    data-cse="zur-kundenfreigabe"
                    className="ml-s3 text-text underline underline-offset-2 hover:text-brand"
                  >
                    Kundenfreigabe →
                  </Link>
                )}
              </>
            )} />
            <Feld label="Abgelegt" wert={`${d.erstellt}${d.erstellt_von === null ? '' : ` von ${d.erstellt_von}`}`} />
          </dl>
        </section>
        <section className="rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s4 text-h3 text-text">Datei und Aufbewahrung</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Typ" wert={d.mime_typ ?? '—'} />
            <Feld label="Typ geprüft" wert={d.mime_verifiziert ? 'aus den Bytes bestätigt' : 'nicht geprüft'} />
            <Feld label="EXIF" wert={d.exif_entfernt ? 'entfernt' : 'nicht entfernt'} />
            <Feld label="Größe" wert={formatiereBytes(d.groesse)} />
            <Feld label="Ablage" wert={<code className="text-xs">{d.bucket}</code>} />
            <Feld label="Aufbewahren bis" wert={d.aufbewahrung_bis ?? 'keine Frist hinterlegt'} />
            <Feld label="Löschsperre" wert={d.loeschsperre ? 'ja — kein Löschen möglich' : 'nein'} />
          </dl>
          {speicher.verbunden ? (
            <p className="mt-s4">
              <a
                href={`/api/dokumente/${d.id}/datei`}
                data-cse="datei-abrufen"
                className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm
                           font-semibold text-white hover:bg-brand-hover"
              >
                Datei abrufen
              </a>
            </p>
          ) : null}
          <p data-cse="download-hinweis" className="mt-s4 text-sm text-text-subtle">
            {speicher.verbunden
              ? 'Der Abruf führt auf eine signierte Adresse, die nach 15 Minuten verfällt (DOC-03), und wird im Zugriffsprotokoll des Dokuments vermerkt.'
              : 'Der Dateispeicher ist nicht verbunden — es gibt keine Adresse, die ausgegeben werden könnte (Einstellungen › Integrationen).'}
          </p>
        </section>
      </div>
    </PortalRahmen>
  );
}
