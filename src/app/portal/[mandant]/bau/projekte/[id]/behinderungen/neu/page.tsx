import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { ladeVorlagen, type VorlageZeile } from '@/server/services/bau/behinderung';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/behinderungen/neu` — eine
 * Behinderungsanzeige aus der Vorlage (BAU-06, § 6 Abs. 1 VOB/B).
 *
 * **Der Text entsteht aus einer VORLAGE, nicht in einem Textfeld.** BAU-06
 * verlangt das, und der Grund steht in der Vorlage selbst: § 6 Abs. 1 VOB/B
 * nennt die Angaben, die eine wirksame Anzeige enthalten muss — die hindernden
 * Umstände, ihren Beginn und die voraussichtlichen Auswirkungen. Wer frei
 * schreibt, lässt irgendwann eine davon weg, und die Anzeige ist unwirksam,
 * ohne dass es jemandem auffällt.
 *
 * Der Wortlaut der Vorlage steht unten auf dieser Seite. Solange O-23 offen
 * ist, trägt sie den Hinweis „unbestätigter Wert": bestätigt ist der
 * Gesetzestext, nicht der Briefkopf der Gruppe.
 *
 * **Hier entsteht kein Absendedatum.** Der Entwurf wird geschrieben; abgesendet
 * wird er auf der Detailseite, nach der Freigabe und nach dem archivierten
 * Schreiben.
 */
export const dynamic = 'force-dynamic';

export default async function BehinderungAnlegen(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/behinderungen/neu`;
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
      return { projekt, vorlagen: await ladeVorlagen(kontext) };
    }),
  ) as Promise<{
    projekt: ProjektZeile; vorlagen: readonly VorlageZeile[];
  } | null>);

  if (daten === null) notFound();

  const heute = await berlinHeute();
  const erste = daten.vorlagen[0];

  return (
    <PortalRahmen
      titel="Behinderung anzeigen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5">
        <h1 className="m-0 text-h1 text-text">Behinderung anzeigen</h1>
        <p className="m-0 mt-s1 text-sm text-text-muted">
          {daten.projekt.nummer} · {daten.projekt.bezeichnung} · {daten.projekt.kunde}
        </p>
      </div>

      {daten.vorlagen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-warning">
          Für diesen Bereich ist keine Vorlage hinterlegt. BAU-06 verlangt, dass
          die Anzeige aus einer Vorlage entsteht — freien Text gibt es hier
          nicht. Eine Vorlage wird in den Einstellungen gepflegt.
        </p>
      ) : (
        <form
          action="/api/bau/behinderungen"
          method="post"
          className="rounded-lg border border-line bg-surface p-s5"
          data-cse="behinderung-formular"
        >
          <input type="hidden" name="projekt" value={id} />
          <input type="hidden" name="mandant" value={mandant} />

          <div className="grid gap-s4 md:grid-cols-2">
            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Vorlage (§ 6 Abs. 1 VOB/B)
              </span>
              <select
                name="vorlage"
                required
                defaultValue={erste?.schluessel ?? ''}
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                data-cse="vorlage"
              >
                {daten.vorlagen.map((v) => (
                  <option key={v.id} value={v.schluessel}>
                    {v.bezeichnung} ({v.fundstelle})
                    {v.ist_platzhalter ? ' · unbestätigter Wert' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Risikosphäre (§ 6 Abs. 2 VOB/B) — Pflichtauswahl
              </span>
              <select
                name="grund_kategorie"
                required
                defaultValue=""
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              >
                {/* Keine Vorbelegung: die Zuordnung entscheidet über den
                    Schadensersatzanspruch. */}
                <option value="" disabled>Bitte wählen …</option>
                <option value="risikobereich_ag">
                  Umstand aus dem Risikobereich des Auftraggebers (§ 6 Abs. 2 Nr. 1 a)
                </option>
                <option value="streik_aussperrung">
                  Streik oder Aussperrung (§ 6 Abs. 2 Nr. 1 b)
                </option>
                <option value="hoehere_gewalt">
                  Höhere Gewalt oder andere unabwendbare Umstände (§ 6 Abs. 2 Nr. 1 c)
                </option>
              </select>
            </label>

            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Hindernde Umstände
              </span>
              <textarea
                name="ursache"
                required
                rows={3}
                placeholder="Der Baugrund ist seit dem 3. September nicht übergeben; die Fundamentarbeiten können nicht beginnen."
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
              <span className="mt-s1 block text-xs text-text-subtle">
                Pflicht nach § 6 Abs. 1 VOB/B — ohne sie ist die Anzeige unwirksam.
              </span>
            </label>

            <label>
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Beginn der Behinderung
              </span>
              <input
                type="date"
                name="beginn_am"
                required
                defaultValue={heute}
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>

            <label>
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Voraussichtliche Auswirkung in Tagen
              </span>
              <input
                name="auswirkung_tage"
                inputMode="numeric"
                pattern="\d{1,4}"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
              <span className="mt-s1 block text-xs text-text-subtle">
                Optional. Eine Bauzeitverlängerung wird daraus nicht abgeleitet.
              </span>
            </label>

            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Voraussichtliche Auswirkung (Text für das Schreiben)
              </span>
              <input
                name="auswirkung"
                placeholder="Verschiebung des Rohbaufertigstellungstermins um voraussichtlich 12 Werktage"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
              <span className="mt-s1 block text-xs text-text-subtle">
                Bleibt das Feld leer, schreibt die Anzeige „noch nicht
                abschließend bezifferbar" — nie eine geratene Zahl.
              </span>
            </label>

            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Absender (Unterzeichner des Schreibens)
              </span>
              <input
                name="absender"
                required
                placeholder="Bauleitung, Name"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>
          </div>

          <p className="mt-s4 max-w-prose text-xs text-text-subtle">
            Es entsteht ein <strong>Entwurf</strong>. Ein Absendedatum wird
            hier nicht gesetzt: eine Behinderungsanzeige wirkt, wenn sie beim
            Auftraggeber ist, nicht wenn sie geschrieben wurde.
          </p>

          <div className="mt-s5 flex flex-wrap items-center gap-s3">
            <Button type="submit" variante="primary">Anzeige entwerfen</Button>
            <Link
              href={`/portal/${mandant}/bau/projekte/${id}/behinderungen`}
              className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
              Abbrechen
            </Link>
          </div>
        </form>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Der Wortlaut, den die Anzeige bekommt — sichtbar VOR dem Anlegen.    */}
      {/* ------------------------------------------------------------------ */}
      {daten.vorlagen.map((v) => (
        <section key={v.id} className="mt-s6" data-cse="vorlagentext">
          <h2 className="mb-s2 text-h3 text-text">
            Wortlaut: {v.bezeichnung}
            {v.ist_platzhalter && (
              <span className="ml-s2 text-sm text-warning" title="Unbestätigter Wert (O-23)">
                unbestätigter Wert
              </span>
            )}
          </h2>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {v.betreff}
            {'\n\n'}
            {v.rumpf}
          </pre>
        </section>
      ))}
    </PortalRahmen>
  );
}
