import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  EIMER_REIHENFOLGE, EIMER_TEXT, ladeVerteilung, type VerteilungsZeile,
} from '@/server/services/freigabe/pruefdauer';

/**
 * `/portal/[mandant]/freigaben/pruefdauer` — wie lange geprüft wurde
 * (APR-08, `04-SEITENKARTE.md` §5.20).
 *
 * **Diese Seite nennt keinen Namen, und das ist ihr wichtigster Satz.**
 * APR-08 verlangt zweierlei: die Prüfdauer zu MESSEN, und „consistent
 * sub-3-second approvals" zu MARKIEREN. Das Erste ist eine Zahl über die
 * Gesellschaft; das Zweite ist eine Auswertung über einen namentlich
 * bekannten Beschäftigten, also Verhaltens- und Leistungskontrolle im Sinne
 * von § 87 Abs. 1 Nr. 6 BetrVG. Ob und wie sie zulässig ist, hängt an
 * **O-06** — und bis dahin gibt es sie hier nicht. Gemessen wird trotzdem:
 * die Zahl steht am Schnappschuss, unveränderlich, und lässt sich später
 * auswerten, wenn die Frage beantwortet ist.
 *
 * **Der Stapelanteil steht daneben, nicht darin.** Eine Stapelfreigabe ist
 * per Bauart schnell — wer fünfzig Routinezeilen genehmigt, verbringt mit
 * jeder Sekundenbruchteile. Ohne diese Spalte sähe ein Morgen mit einem
 * Stapel aus wie ein Haus, das durchwinkt. Ein Stapel ist kein Durchwinken,
 * und ein Durchwinken ist kein Stapel.
 */
export const dynamic = 'force-dynamic';

export default async function Pruefdauer(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben/pruefdauer`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) =>
      ladeVerteilung(kontext)))) as readonly VerteilungsZeile[];

  const gesamt = zeilen.reduce((summe, z) => summe + z.anzahl, 0);
  const geordnet = EIMER_REIHENFOLGE
    .map((e) => zeilen.find((z) => z.eimer === e))
    .filter((z): z is VerteilungsZeile => z !== undefined);

  return (
    <PortalRahmen
      titel="Prüfdauer"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Prüfdauer</h1>
        <Link
          href={`/portal/${mandant}/freigaben`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Zum Posteingang
        </Link>
      </div>

      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Wie lange zwischen dem Öffnen einer Freigabe und der Entscheidung
        verging — gemessen vom Server, nie aus einem Rumpf. Die Zahl steht am
        Schnappschuss und ist unveränderlich.
      </p>

      {/*
        * **Der ehrliche Satz der Seite.** Eine Auswertung je Person wäre die
        * naheliegende Fassung dieser Zahl — und genau die darf hier nicht
        * stehen, solange O-06 offen ist. Sie fehlt also NICHT versehentlich.
        */}
      <Hinweis art="hinweis" cse="pruefdauer-o06" className="mb-s6 max-w-prose">
        <strong>Ohne Personenbezug.</strong> APR-08 nennt auch das Markieren
        durchgängig sehr schneller Freigaben. Das wäre eine Auswertung über
        einen namentlich bekannten Menschen — Verhaltens- und
        Leistungskontrolle nach § 87 Abs. 1 Nr. 6 BetrVG. Solange{' '}
        <strong>O-06</strong> nicht beantwortet ist, wird sie nicht gebaut und
        nicht angezeigt. Gemessen und aufbewahrt wird weiter; ausgewertet wird
        erst, wenn feststeht, dass und wie es zulässig ist.
      </Hinweis>

      {gesamt === 0 ? (
        <p
          data-cse="pruefdauer-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Keine Zahlen — entweder wurde in dieser Gesellschaft noch nichts
          entschieden, oder dieses Konto hält das Recht
          „freigabe.pruefdauer_lesen" nicht. Die Seite unterscheidet das
          bewusst nicht: die Unterscheidung wäre selbst die Auskunft.
        </p>
      ) : (
        <>
          <p className="mb-s4 text-sm text-text-muted" data-cse="pruefdauer-gesamt"
             data-anzahl={String(gesamt)}>
            {gesamt} Entscheidungen
          </p>
          <DataTable
            beschriftung="Verteilung der Prüfdauer, ohne Personenbezug"
            zeilen={geordnet}
            schluessel={(z) => z.eimer}
            spalten={[
              {
                schluessel: 'spanne', kopf: 'Spanne',
                zelle: (z) => (
                  <span className="text-sm text-text" data-cse="pruefdauer-eimer"
                        data-eimer={z.eimer}>
                    {EIMER_TEXT[z.eimer] ?? z.eimer}
                  </span>
                ),
              },
              {
                schluessel: 'anzahl', kopf: 'Entscheidungen',
                zelle: (z) => <span className="text-sm text-text">{z.anzahl}</span>,
              },
              {
                schluessel: 'stapel', kopf: 'davon aus einem Stapel',
                zelle: (z) => (
                  <span className="text-sm text-text-muted" data-cse="pruefdauer-stapel">
                    {z.davonStapel}
                  </span>
                ),
              },
              {
                schluessel: 'anteil', kopf: 'Anteil',
                zelle: (z) => (
                  <span className="text-sm text-text-muted">
                    {Math.round((z.anzahl / gesamt) * 100)} %
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </PortalRahmen>
  );
}
