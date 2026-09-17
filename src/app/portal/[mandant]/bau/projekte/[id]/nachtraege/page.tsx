import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  NACHTRAG_WACHFRIST_TAGE, listeNachtraege, type NachtragZeile,
} from '@/server/services/bau/nachtrag';
import { ladeAusserhalbLv, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { NACHTRAG_PILLE, NACHTRAG_STATUS_TEXT } from '../../../nachtrag-anzeige';
import { AusserhalbLvWarnungen } from '../../../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/bau/projekte/[id]/nachtraege` — die Nachträge eines
 * Projekts (BAU-04, BAU-05).
 *
 * **Zwei Datumsspalten, nicht eine.** „Angemeldet" ist die Ankündigung vor
 * Ausführungsbeginn (§ 2 Abs. 6 Nr. 1 VOB/B) und entscheidet über den
 * Anspruch; „Eingereicht" ist die Übergabe der Kalkulation und entscheidet
 * über die Fälligkeit. Eine Spalte mit einem Zustand daneben würde im Streit
 * genau die Frage nicht beantworten, um die gestritten wird.
 *
 * **Die BAU-05-Warnungen stehen oben, nicht unten.** Sie sind der Grund,
 * warum diese Seite geöffnet wird: eine Position, die gemessen oder gebucht
 * ist und in keinem Leistungsverzeichnis steht, ist nach § 2 Abs. 8 VOB/B im
 * Zweifel unentgeltlich.
 */
export const dynamic = 'force-dynamic';

export default async function NachtraegeJeProjekt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/nachtraege`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      return {
        projekt,
        nachtraege: await listeNachtraege(kontext, { projektId: id }),
        warnungen: await ladeAusserhalbLv(kontext, { projektId: id }),
      };
    }),
  ) as Promise<{
    projekt: ProjektZeile;
    nachtraege: readonly NachtragZeile[];
    warnungen: readonly AusserhalbLvWarnung[];
  } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();

  const ueberfaellig = daten.nachtraege.filter((n) => n.ueberfaellig);

  return (
    <PortalRahmen
      titel="Nachträge"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">Nachträge</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung}
          </p>
        </div>
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/nachtraege/neu`}
          className="rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Nachtrag anmelden
        </Link>
      </div>

      <AusserhalbLvWarnungen
        warnungen={daten.warnungen}
        mandant={mandant}
        projektId={id}
      />

      {ueberfaellig.length > 0 && (
        <p
          className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-danger"
          data-cse="nachtrag-ueberfaellig"
        >
          {ueberfaellig.length === 1
            ? 'Ein Nachtrag ist '
            : `${String(ueberfaellig.length)} Nachträge sind `}
          seit mehr als {NACHTRAG_WACHFRIST_TAGE} Tagen angemeldet und nicht
          eingereicht. Solange die Kalkulation fehlt, wird nichts fällig.
        </p>
      )}

      {daten.nachtraege.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Zu diesem Projekt ist kein Nachtrag angemeldet.
        </p>
      ) : (
        <DataTable
          beschriftung="Nachträge dieses Projekts"
          zeilen={daten.nachtraege}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.nummer },
            {
              schluessel: 'titel',
              kopf: 'Titel',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/bau/projekte/${id}/nachtraege/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.titel}
                </Link>
              ),
            },
            {
              schluessel: 'grundlage',
              kopf: 'Grundlage (§ 2 VOB/B)',
              zelle: (z) => (
                <span>
                  {z.grundlage_fundstelle}
                  <span className="block text-xs text-text-subtle">{z.grundlage}</span>
                  {z.grundlage_platzhalter && (
                    <span className="text-xs text-warning" title="Unbestätigter Wert (O-23)">
                      unbestätigter Wert
                    </span>
                  )}
                </span>
              ),
            },
            {
              // BAU-04: getrennt angezeigt, nicht in einer Spalte vereint.
              schluessel: 'angemeldet',
              kopf: 'Angemeldet',
              zelle: (z) => (
                <span data-cse="angemeldet-am">
                  {z.angemeldet_lokal ?? (
                    <span className="text-warning">nicht angekündigt</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'eingereicht',
              kopf: 'Eingereicht',
              zelle: (z) => (
                <span data-cse="eingereicht-am">
                  {z.eingereicht_lokal ?? (
                    <span className={z.ueberfaellig ? 'text-danger' : 'text-text-muted'}>
                      {z.offen_seit_tagen === null
                        ? '—'
                        : `offen seit ${String(z.offen_seit_tagen)} Tagen`}
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill
                    zustand={z.ueberfaellig
                      ? 'Überfällig'
                      : NACHTRAG_PILLE[z.status] ?? 'Offen'}
                  />
                  {/* §9: das WORT trägt die rechtliche Bedeutung, nicht die Farbe. */}
                  <span className="text-xs text-text-muted">
                    {NACHTRAG_STATUS_TEXT[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 text-sm">
        <Link
          href={`/portal/${mandant}/bau/projekte`}
          className="text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Zurück zu den Projekten
        </Link>
      </p>
    </PortalRahmen>
  );
}
