import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { listeProjekte, type ProjektZeile } from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte` — die Bauprojekte (OPS-05, BAU-01).
 *
 * Ein Projekt IST ein Auftrag mit einer Bauerweiterung (03-GEWERKE §7.1), und
 * die Liste zeigt deshalb die zwei Dinge, die es zum Bauprojekt machen: die
 * **Vertragsgrundlage** — VOB/B oder BGB entscheidet ueber Nachtrag,
 * Behinderung, Abnahme und Gewaehrleistung — und die Frage, ob schon ein
 * Leistungsverzeichnis und Aufmasse daran haengen.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  // DESIGN §5 kennt „Abgenommen" nicht; 03-GEWERKE §3.5 hat die Zeile
  // beantragt. Bis sie dort steht, traegt die Pille das naechstliegende Wort
  // des geschlossenen Vokabulars und die Spalte daneben das genaue.
  abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

const ART_TEXT: Readonly<Record<string, string>> = {
  hochbau: 'Hochbau', ausbau: 'Ausbau', rueckbau: 'Rückbau',
};

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  vob_b: 'VOB/B', bgb: 'BGB',
};

export default async function Projektliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/projekte`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Der Knopf haengt an `bau.schreiben` — demselben Recht, das Route und RLS
   * verlangen. Wer ein Projekt nicht anlegen darf, soll auch nicht auf eine
   * Seite geschickt werden, die ihm das sagt.
   */
  const darf = await haeltRechte(sitzung, 'bau.schreiben');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeProjekte(kontext)),
  ) as Promise<readonly ProjektZeile[]>);

  return (
    <PortalRahmen
      titel="Bauprojekte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-center justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Bauprojekte</h1>
        {darf['bau.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/bau/projekte/neu`}
            data-cse="projekt-neu"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4
                       text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Neues Bauvorhaben
          </Link>
        )}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Bauprojekt angelegt. Ein Projekt entsteht aus einem Auftrag —
          es ist dessen bauliche Erweiterung, kein zweiter Vorgang daneben.
          {darf['bau.schreiben'] === true && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/bau/projekte/neu`}
                className="underline underline-offset-2 hover:text-text"
              >
                Das erste anlegen.
              </Link>
            </>
          )}
        </p>
      ) : (
        <DataTable
          beschriftung="Bauprojekte"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.nummer },
            {
              /**
               * Der Name führt auf das PROJEKT, nicht ins
               * Leistungsverzeichnis.
               *
               * Er führte auf `…/[id]/lv`, weil es die Projektseite nicht gab
               * — und damit sprang man von der Liste mitten in einen von
               * sechs Vorgängen, ohne Vertragsgrundlage, Termine und
               * Vertragssumme gesehen zu haben. Das LV ist von dort eine
               * Karte weiter.
               */
              schluessel: 'bezeichnung',
              kopf: 'Projekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde },
            { schluessel: 'art', kopf: 'Gewerk', zelle: (z) => ART_TEXT[z.art] ?? z.art },
            {
              schluessel: 'grundlage',
              kopf: 'Vertrag',
              zelle: (z) => GRUNDLAGE_TEXT[z.vertragsgrundlage] ?? z.vertragsgrundlage,
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} />,
            },
            {
              schluessel: 'frist',
              kopf: 'Soll-Ende',
              numerisch: true,
              zelle: (z) => z.soll_ende_lokal ?? '—',
            },
            {
              schluessel: 'aufmass',
              kopf: 'Aufmaße',
              numerisch: true,
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.id}/aufmass`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.aufmass_anzahl}
                </Link>
              ),
            },
            {
              /**
               * Die beiden Vorgänge des § 2 und des § 6 VOB/B (BAU-04,
               * BAU-06). Sie stehen als Wege und nicht als Zahlen: eine Zahl
               * hier verlangte je Projekt zwei weitere Abfragen, und was die
               * Bauleitung von dieser Liste aus sucht, ist der Weg dorthin.
               */
              schluessel: 'vorgaenge',
              kopf: '§ 2 / § 6 VOB/B',
              zelle: (z) => (
                <span className="inline-flex flex-wrap gap-s3">
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.id}/nachtraege`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    Nachträge
                  </Link>
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${z.id}/behinderungen`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    Behinderungen
                  </Link>
                </span>
              ),
            },
            {
              /**
               * Der Weg ins Bautagebuch (BAU-07). Ebenfalls ein WEG und keine
               * Zahl: „wie viele Tage sind erfasst" beantwortet nicht die
               * Frage, die man von dieser Liste aus stellt — und eine Zahl je
               * Projekt kostete eine weitere Abfrage je Zeile.
               */
              schluessel: 'bautagebuch',
              kopf: 'Bautagebuch',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${z.id}/bautagebuch`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  Tage
                </Link>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
