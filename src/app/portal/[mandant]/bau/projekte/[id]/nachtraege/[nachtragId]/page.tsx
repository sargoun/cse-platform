import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  NACHTRAG_WACHFRIST_TAGE, findeNachtrag, type NachtragZeile,
} from '@/server/services/bau/nachtrag';
import {
  ANORDNUNG_TEXT, NACHTRAG_PILLE, NACHTRAG_STATUS_TEXT,
} from '../../../../nachtrag-anzeige';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/nachtraege/[nachtragId]` — ein
 * Nachtrag mit **zwei getrennten Daten** (BAU-04, BAU-05).
 *
 * **Anmeldung und Einreichung stehen nebeneinander, jede mit ihrem eigenen
 * Formular und ihrem eigenen Recht.** Das ist die Zusage von BAU-04 und nicht
 * Layoutgeschmack:
 *
 *  - `angemeldet_am` ist die Ankündigung VOR Ausführungsbeginn (§ 2 Abs. 6
 *    Nr. 1 VOB/B). Sie entscheidet, ob es den Anspruch überhaupt gibt. Steht
 *    sie, wird sie nicht mehr verschoben — ein nachträglich vorverlegtes Datum
 *    wäre in einem auditierten Datensatz kein Versehen mehr.
 *  - `eingereicht_am` ist die Übergabe der Kalkulation. Sie entscheidet über
 *    die Fälligkeit, und sie ist der Übergang, an dem etwas das Haus verlässt:
 *    ohne genehmigte Freigabe mit benanntem Menschen gibt es ihn nicht
 *    (Invariante 7, und die Datenbank sagt es noch einmal).
 *
 * Wer beides in ein Feld legte, könnte im Streit nicht mehr belegen, dass
 * angekündigt wurde, bevor gebaut wurde.
 */
export const dynamic = 'force-dynamic';

export default async function NachtragDetail(
  { params }: {
    params: Promise<{ mandant: string; id: string; nachtragId: string }>;
  },
) {
  const { mandant, id, nachtragId } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/nachtraege/${nachtragId}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const nachtrag = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => findeNachtrag(kontext, nachtragId)),
  ) as Promise<NachtragZeile | null>);

  // AUT-06: ein fremder Nachtrag ist nicht vorhanden, nicht verboten.
  if (nachtrag === null) notFound();

  const heute = await berlinHeute();

  return (
    <PortalRahmen
      titel={`Nachtrag ${nachtrag.nummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">
            Nachtrag {nachtrag.nummer} · {nachtrag.titel}
          </h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {nachtrag.projekt_nummer} · {nachtrag.projekt}
          </p>
        </div>
        <span className="inline-flex items-center gap-s2">
          <StatusPill
            zustand={nachtrag.ueberfaellig
              ? 'Überfällig'
              : NACHTRAG_PILLE[nachtrag.status] ?? 'Offen'}
          />
          <span className="text-sm text-text-muted">
            {NACHTRAG_STATUS_TEXT[nachtrag.status] ?? nachtrag.status}
          </span>
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Die Anspruchsgrundlage — wörtlich, mit Fundstelle.                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="m-0 mb-s2 text-h3 text-text">Anspruchsgrundlage</h2>
        <p className="m-0 text-base text-text" data-cse="grundlage">
          {nachtrag.grundlage_fundstelle} — {nachtrag.grundlage}
          {nachtrag.grundlage_platzhalter && (
            <span className="ml-s2 text-sm text-warning" title="Unbestätigter Wert (O-23)">
              unbestätigter Wert
            </span>
          )}
        </p>
        <p className="m-0 mt-s3 max-w-prose whitespace-pre-line text-sm text-text-muted">
          {nachtrag.begruendung}
        </p>
        <p className="m-0 mt-s3 text-xs text-text-subtle">
          Angeordnet {ANORDNUNG_TEXT[nachtrag.anordnung_form] ?? nachtrag.anordnung_form}
          {nachtrag.angeordnet_von !== null && ` von ${nachtrag.angeordnet_von}`}
          {nachtrag.anordnung_form === 'muendlich'
            && ' — eine mündliche Anordnung ist die, die im Streit bestritten wird.'}
        </p>
        {nachtrag.ausgefuehrt_ohne_beauftragung && (
          <p className="m-0 mt-s3 text-sm text-warning" data-cse="ohne-beauftragung">
            Ausgeführt, ohne beauftragt zu sein — nach § 2 Abs. 8 VOB/B im
            Zweifel unentgeltlich.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-04: zwei Daten, zwei Spalten, zwei Rechte.                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6 grid gap-s4 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-s5" data-cse="anmeldung">
          <h2 className="m-0 mb-s2 text-h3 text-text">Angemeldet</h2>
          <p className="m-0 text-sm text-text-muted">
            Die Ankündigung vor Ausführungsbeginn (§ 2 Abs. 6 Nr. 1 VOB/B).
            Über sie entscheidet der Anspruch.
          </p>
          {nachtrag.angemeldet_lokal !== null ? (
            <>
              <p className="m-0 mt-s4 text-h2 tabular-nums text-text" data-cse="angemeldet-am">
                {nachtrag.angemeldet_lokal}
              </p>
              <p className="m-0 mt-s2 text-xs text-text-subtle">
                Write-once. Das Datum wird nicht verschoben.
              </p>
            </>
          ) : (
            <form
              action={`/api/bau/nachtraege/${nachtragId}/anmelden`}
              method="post"
              className="mt-s4"
              data-cse="anmeldung-formular"
            >
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="projekt" value={id} />
              <input type="hidden" name="zurueck" value={pfad} />
              <p className="m-0 mb-s3 text-sm text-warning">
                Noch nicht angekündigt. Ohne Ankündigung wird nichts eingereicht.
              </p>
              <label className="block">
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Tag der Ankündigung
                </span>
                <input
                  type="date"
                  name="angemeldet_am"
                  required
                  defaultValue={heute}
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
              <div className="mt-s4">
                <Button type="submit" variante="secondary">Ankündigung eintragen</Button>
              </div>
            </form>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface p-s5" data-cse="einreichung">
          <h2 className="m-0 mb-s2 text-h3 text-text">Eingereicht</h2>
          <p className="m-0 text-sm text-text-muted">
            Die Übergabe der Kalkulation an den Auftraggeber. Über sie
            entscheidet die Fälligkeit.
          </p>
          {nachtrag.eingereicht_lokal !== null ? (
            <>
              <p className="m-0 mt-s4 text-h2 tabular-nums text-text" data-cse="eingereicht-am">
                {nachtrag.eingereicht_lokal}
              </p>
              <p className="m-0 mt-s2 font-mono text-xs text-text-subtle">
                Freigabe {(nachtrag.freigabe_id ?? '').slice(0, 8)}…
              </p>
            </>
          ) : (
            <form
              action={`/api/bau/nachtraege/${nachtragId}/einreichen`}
              method="post"
              className="mt-s4"
              data-cse="einreichung-formular"
            >
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="projekt" value={id} />
              <input type="hidden" name="zurueck" value={pfad} />
              <p
                className={`m-0 mb-s3 text-sm ${nachtrag.ueberfaellig ? 'text-danger' : 'text-text-muted'}`}
                data-cse="offen-seit"
              >
                {nachtrag.offen_seit_tagen === null
                  ? 'Noch nicht eingereicht.'
                  : `Seit ${String(nachtrag.offen_seit_tagen)} Tagen angemeldet und nicht `
                    + `eingereicht (Wachfrist ${String(NACHTRAG_WACHFRIST_TAGE)} Tage).`}
              </p>
              <label className="block">
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Tag der Einreichung
                </span>
                <input
                  type="date"
                  name="eingereicht_am"
                  required
                  defaultValue={heute}
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
              <label className="mt-s3 block">
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Kennung der genehmigten Freigabe
                </span>
                <input
                  name="freigabe"
                  required
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 font-mono text-sm text-text"
                />
                <span className="mt-s1 block text-xs text-text-subtle">
                  Die Einreichung geht an den Auftraggeber und verlangt eine
                  menschliche Freigabe (Invariante 7). Ohne genehmigte Freigabe
                  mit benanntem Menschen wird nichts eingereicht — der
                  Freigabe-Posteingang ist ein eigener Vorgang.
                </span>
              </label>
              <div className="mt-s4">
                <Button type="submit" variante="primary">Einreichung eintragen</Button>
              </div>
            </form>
          )}
        </div>
      </section>

      <p className="text-sm">
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/nachtraege`}
          className="text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Zurück zu den Nachträgen
        </Link>
      </p>
    </PortalRahmen>
  );
}
