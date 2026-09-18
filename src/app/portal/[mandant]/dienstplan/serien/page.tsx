import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { lesbareRegel } from '@/lib/datum/regeltext';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import {
  listeSerien, type SerienListeZeile,
} from '@/server/services/dienstplan/serienliste';

/**
 * `/portal/[mandant]/dienstplan/serien` — TIM-02, TIM-03, CLN-02.
 *
 * Die Liste beantwortet die Frage, die im Plan selbst nicht steht: **woher
 * kommen diese Schichten?** Ein Dienstplan ohne diesen Weg ist eine
 * Behauptung; mit ihm ist er eine Ableitung, die jemand nachsehen kann.
 *
 * `generiert_bis` steht mit in der Liste, weil eine Serie, die stehen
 * geblieben ist, sonst aussieht wie eine Serie ohne Termine. Der Unterschied
 * ist der zwischen „nichts zu tun" und „der Generator laeuft nicht".
 */
export const dynamic = 'force-dynamic';

/**
 * Die Zeile kommt aus dem Dienst, nicht aus dieser Datei.
 *
 * Die Abfrage stand hier inline. Mit `/reinigung/turnus` daneben waere sie
 * eine ZWEITE Wahrheit ueber „wie viele Termine hat diese Serie" und „bis
 * wann ist geplant" geworden — die beiden Zahlen, die beide Seiten gross
 * anzeigen. Sie liegt jetzt in `services/dienstplan/serienliste.ts`, und der
 * turnus-verankerte Blick der Reinigung benutzt dieselben Bausteine.
 */
type SerienZeile = SerienListeZeile;

export default async function Serienliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const angelegt = typeof suche['angelegt'] === 'string' ? suche['angelegt'] : null;
  const erzeugt = typeof suche['erzeugt'] === 'string' ? Number(suche['erzeugt']) : null;
  const bestandSchon = suche['bestand'] === '1';
  const uebersprungen = typeof suche['uebersprungen'] === 'string' ? suche['uebersprungen'] : null;
  const pfad = `/portal/${mandant}/dienstplan/serien`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      listeSerien(kontext))) as Promise<readonly SerienZeile[]>);

  return (
    <PortalRahmen
      titel="Serien"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Serien</h1>
        <div className="flex flex-wrap gap-s2">
          <Link
            href={`/portal/${mandant}/dienstplan/serien/neu`}
            data-cse="serie-neu"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Neue Serie
          </Link>
          <Link
            href={`/portal/${mandant}/dienstplan/woche`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted hover:border-line-strong hover:text-text"
          >
            Zum Dienstplan
          </Link>
        </div>
      </div>

      {angelegt !== null ? (
        <p data-cse="serie-angelegt" className="mb-s5 max-w-prose rounded-lg border border-success bg-success-soft p-s5 text-sm text-success">
          <strong>{bestandSchon ? 'Serie bestand schon — der Generator lief.' : 'Serie angelegt.'}</strong>{' '}
          {erzeugt === null || Number.isNaN(erzeugt) ? '' : `${String(erzeugt)} Schicht(en) erzeugt.`}
          {uebersprungen !== null ? ` Übersprungen: ${uebersprungen}.` : ''}
        </p>
      ) : null}

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Eine Serie beschreibt, wann eine Leistung wiederkehrt. Der nächtliche
        Generator schreibt daraus acht Wochen im Voraus Schichten — er legt keine
        an, die schon begonnen hat, und er löscht keine, sondern storniert sie
        mit Grund.
      </p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Serie angelegt. Ohne Serie entstehen keine Schichten — legen Sie eine an.
        </p>
      ) : (
        <DataTable
          beschriftung="Serien dieser Gesellschaft mit Regel, Zeitfenster und Generatorstand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Serie',
              /*
                Der Name fuehrt auf das Blatt der Serie.

                Ohne diesen Verweis war `/dienstplan/serien/[id]` gebaut, im
                Routenregister eingetragen und fuer niemanden erreichbar — und
                genau dort steht, was diese Liste nicht zeigt: `generiert_bis`
                gross, die materialisierten Schichten und die
                Einzeltermin-Ausnahmen.
              */
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/dienstplan/serien/${z.id}`}
                    data-cse="zur-serie"
                    className="block text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.bezeichnung}
                  </Link>
                  <span className="block text-micro text-text-muted">
                    {z.objekt}{z.revier !== null ? ` · ${z.revier}` : ''}
                  </span>
                </span>
              ),
            },
            { schluessel: 'regel', kopf: 'Regel', zelle: (z) => lesbareRegel(z.rrule) },
            {
              schluessel: 'zeit',
              kopf: 'Zeitfenster',
              zelle: (z) => `${z.beginn_lokal} · ${stundenAusMinuten(z.dauer_minuten)}`,
            },
            {
              schluessel: 'feiertag',
              kopf: 'Am Feiertag',
              zelle: (z) => (z.feiertagsregel === 'ausfall' ? 'fällt aus' : 'findet statt'),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Gültig',
              zelle: (z) => (z.gueltig_bis === null
                ? `ab ${z.gueltig_ab}`
                : `${z.gueltig_ab} bis ${z.gueltig_bis}`),
            },
            {
              schluessel: 'stand',
              kopf: 'Geplant bis',
              zelle: (z) => (z.generiert_bis === null
                ? <span className="text-warning">noch nie gelaufen</span>
                : <span className="tabular-nums">{z.generiert_bis}</span>),
            },
            {
              schluessel: 'einsaetze', kopf: 'Schichten', numerisch: true,
              zelle: (z) => String(z.einsaetze),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={z.archiviert ? 'Archiviert' : 'Aktiv'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
