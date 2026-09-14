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
  ELEKTRONISCHE_KANAELE, MENSCHLICHE_KANAELE, VERSANDART_TEXT,
  findeBehinderung, type BehinderungZeile,
} from '@/server/services/bau/behinderung';
import {
  BEHINDERUNG_GRUND_KURZ, BEHINDERUNG_PILLE, BEHINDERUNG_STATUS_TEXT,
} from '../../../../nachtrag-anzeige';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/behinderungen/[bid]` — die Anzeige mit
 * **dokumentiertem Absendedatum und Kanal** (BAU-06, LEG-01, Invariante 7).
 *
 * Drei Dinge stehen hier, und jedes hat einen Ausfall dahinter:
 *
 *  1. **Der Anzeigetext, wörtlich.** Er ist ab dem Versand eingefroren
 *     (`kern.behinderung_einfrieren`); was hier steht, ist was hinausging.
 *  2. **Absendedatum, Kanal, Empfänger und das archivierte Schreiben.** Der
 *     Kanal ist Beweisrecht: ein Einschreiben belegt den Zugang, ein
 *     Bauleiterprotokoll belegt ihn nicht.
 *  3. **Das Versandformular, das durch `server/agent/policy.ts` läuft.**
 *     `E-Mail` und `Portal` stehen als **nicht verbunden** da und lassen sich
 *     nicht wählen — es gibt in dieser Anwendung keinen Mailversand (O-116),
 *     und ein nachgebauter Erfolg wäre schlimmer als gar keiner. Brief,
 *     Einschreiben, Bote und Bauleiterprotokoll sind menschliche Kanäle: dort
 *     versendet ein Mensch, und hier wird dokumentiert, was er getan hat.
 */
export const dynamic = 'force-dynamic';

export default async function BehinderungDetail(
  { params }: {
    params: Promise<{ mandant: string; id: string; bid: string }>;
  },
) {
  const { mandant, id, bid } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/behinderungen/${bid}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const b = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => findeBehinderung(kontext, bid)),
  ) as Promise<BehinderungZeile | null>);

  // AUT-06: eine fremde Anzeige ist nicht vorhanden, nicht verboten.
  if (b === null) notFound();

  const heute = await berlinHeute();
  const abgesendet = b.angezeigt_lokal !== null;

  return (
    <PortalRahmen
      titel={`Behinderungsanzeige ${b.nummer}`}
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
          <h1 className="m-0 text-h1 text-text">Behinderungsanzeige {b.nummer}</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {b.projekt_nummer} · {b.projekt} · Beginn {b.beginn_lokal}
            {' · '}{BEHINDERUNG_GRUND_KURZ[b.grund_kategorie] ?? b.grund_kategorie}
          </p>
        </div>
        <span className="inline-flex items-center gap-s2">
          <StatusPill zustand={BEHINDERUNG_PILLE[b.status] ?? 'Entwurf'} />
          <span className="text-sm text-text-muted">
            {BEHINDERUNG_STATUS_TEXT[b.status] ?? b.status}
          </span>
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Das Schreiben, wörtlich.                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s2 text-h3 text-text">Anzeigetext</h2>
        <pre
          className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-s5 text-sm text-text"
          data-cse="anzeigetext"
        >
          {b.anzeigetext ?? 'Zu dieser Behinderung wurde noch kein Anzeigetext erzeugt.'}
        </pre>
        <p className="mt-s2 text-xs text-text-subtle">
          Erzeugt aus der Vorlage {b.vorlage_schluessel ?? '—'} (§ 6 Abs. 1 VOB/B).
          {abgesendet
            && ' Seit dem Versand unveränderlich — eine Korrektur ist eine neue Anzeige,'
              + ' kein UPDATE.'}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-06: das dokumentierte Absendedatum.                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Versand</h2>

        {abgesendet ? (
          <div className="rounded-lg border border-line bg-surface p-s5" data-cse="versand-beleg">
            <p className="m-0 text-h2 tabular-nums text-text" data-cse="angezeigt-am">
              {b.angezeigt_lokal}
            </p>
            <p className="m-0 mt-s2 text-sm text-text-muted">
              {b.versandart === null
                ? 'Kanal nicht festgehalten'
                : VERSANDART_TEXT[b.versandart] ?? b.versandart}
              {b.empfaenger !== null && ` · an ${b.empfaenger}`}
            </p>
            <p className="m-0 mt-s3 font-mono text-xs text-text-subtle">
              Archiviertes Schreiben {(b.versand_dokument_id ?? '—').slice(0, 8)}…
              {' · '}Freigabe {(b.freigabe_id ?? '—').slice(0, 8)}…
              {b.freigegeben_lokal !== null && ` · freigegeben ${b.freigegeben_lokal}`}
            </p>
            <p className="m-0 mt-s3 text-xs text-text-subtle">
              Das Absendedatum ist der Berliner Kalendertag des Servers — nicht
              das, was ein Browser mitschickt (Invariante 5). Das Schreiben
              liegt als PDF in einem privaten Speicher; erreichbar ist es nur
              über eine befristete Adresse.
            </p>
          </div>
        ) : (
          <form
            action={`/api/bau/behinderungen/${bid}/versenden`}
            method="post"
            className="rounded-lg border border-line bg-surface p-s5"
            data-cse="versand-formular"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="projekt" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <div className="grid gap-s4 md:grid-cols-2">
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Kanal
                </span>
                <select
                  name="versandart"
                  required
                  defaultValue=""
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                  data-cse="versandart"
                >
                  <option value="" disabled>Bitte wählen …</option>
                  {MENSCHLICHE_KANAELE.map((k) => (
                    <option key={k} value={k}>{VERSANDART_TEXT[k]}</option>
                  ))}
                  {/* Nicht verbunden — sichtbar, aber nicht wählbar. Ein
                      ausgeblendeter Kanal sieht aus, als gäbe es ihn nicht;
                      ein gesperrter sagt, warum. */}
                  {ELEKTRONISCHE_KANAELE.map((k) => (
                    <option key={k} value={k} disabled>
                      {VERSANDART_TEXT[k]} — nicht verbunden
                    </option>
                  ))}
                </select>
                <span className="mt-s1 block text-xs text-text-subtle">
                  Für E-Mail und Projektportal sind keine Zugangsdaten
                  konfiguriert. Es wird kein Versand vorgetäuscht.
                </span>
              </label>

              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Empfänger
                </span>
                <input
                  name="empfaenger"
                  required
                  placeholder="Bauherr Nord GmbH, z. Hd. Herrn Krause"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>

              <label className="md:col-span-2">
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Kennung der genehmigten Freigabe
                </span>
                <input
                  name="freigabe"
                  required
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 font-mono text-sm text-text"
                />
                <span className="mt-s1 block text-xs text-text-subtle">
                  Nichts verlässt das System ohne menschliche Freigabe
                  (Invariante 7). Die Freigabe wird an <em>diesen</em> Text und
                  <em> diesen</em> Empfänger gebunden: wer nach der Freigabe den
                  Text ändert, hat keine Freigabe mehr für das, was er sendet.
                </span>
              </label>
            </div>

            <p className="mt-s4 max-w-prose text-xs text-text-subtle">
              Mit dem Absenden entsteht das Schreiben als PDF im privaten
              Speicher, und erst danach das Absendedatum. Ist der Speicher nicht
              verbunden, geschieht <strong>nichts</strong> — kein Datum, kein
              Zustandswechsel, keine Zeile ohne die Datei, auf die sie sich
              beruft.
            </p>

            <div className="mt-s4">
              <Button type="submit" variante="primary">Versand dokumentieren</Button>
            </div>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* § 6 Abs. 3 VOB/B — der Wegfall ist ebenfalls anzuzeigen.            */}
      {/* ------------------------------------------------------------------ */}
      {abgesendet && (
        <section className="mb-s6">
          <h2 className="mb-s3 text-h3 text-text">Wegfall (§ 6 Abs. 3 VOB/B)</h2>
          {b.wegfall_lokal !== null ? (
            <p
              className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
              data-cse="wegfall"
            >
              Wegfall angezeigt am {b.wegfall_lokal}
              {b.ende_lokal !== null && ` · Behinderung beendet am ${b.ende_lokal}`}.
              Die Anzeige selbst bleibt unverändert — sie ist ein Beweisstück.
            </p>
          ) : (
            <form
              action={`/api/bau/behinderungen/${bid}/wegfall`}
              method="post"
              className="rounded-lg border border-line bg-surface p-s5"
              data-cse="wegfall-formular"
            >
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="projekt" value={id} />
              <input type="hidden" name="zurueck" value={pfad} />
              <div className="grid gap-s4 md:grid-cols-2">
                <label>
                  <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                    Ende der Behinderung
                  </span>
                  <input
                    type="date"
                    name="ende_am"
                    required
                    defaultValue={heute}
                    className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                  />
                </label>
                <label>
                  <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                    Wegfall angezeigt am
                  </span>
                  <input
                    type="date"
                    name="wegfall_angezeigt_am"
                    required
                    defaultValue={heute}
                    className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                  />
                </label>
              </div>
              <div className="mt-s4">
                <Button type="submit" variante="secondary">Wegfall festhalten</Button>
              </div>
            </form>
          )}
        </section>
      )}

      <p className="text-sm">
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/behinderungen`}
          className="text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Zurück zu den Behinderungsanzeigen
        </Link>
      </p>
    </PortalRahmen>
  );
}
