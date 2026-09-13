import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { ladeGrundlagen, type GrundlageZeile } from '@/server/services/bau/nachtrag';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/nachtraege/neu` — einen Nachtrag
 * anmelden (BAU-04, BAU-05).
 *
 * **Die Anspruchsgrundlage ist eine Pflichtauswahl aus der Katalogtabelle —
 * nie Freitext und nie ein Vorgabewert.** Das Feld öffnet mit
 * „Bitte wählen"; es gibt keinen `defaultValue` und keine „erste Zeile", die
 * vorausgewählt wäre. Der Grund ist nicht Formstrenge: welcher Absatz des § 2
 * VOB/B einschlägig ist, ist die Rechtsfrage des ganzen Vorgangs, und eine
 * Vorbelegung wäre eine Rechtsfolge, die niemand gewählt hat. Solange O-23
 * offen ist, trägt jede Katalogzeile den Hinweis „unbestätigter Wert" (K-17,
 * §1.16).
 *
 * **Das Anmeldedatum steht hier, das Einreichungsdatum nicht.** Über den
 * Anspruch entscheidet die Ankündigung VOR Ausführungsbeginn (§ 2 Abs. 6
 * Nr. 1 VOB/B); die Einreichung der Kalkulation ist ein zweiter Vorgang mit
 * eigenem Recht, und sie steht auf der Detailseite.
 *
 * **Aus der BAU-05-Warnung kommt ein Titelvorschlag, nie eine Grundlage.**
 * `?titel=…&quelle=…` füllt das Titelfeld und merkt sich den Bezug, damit die
 * Warnung nach dem Anlegen verschwindet — die Grundlage wählt ein Mensch.
 *
 * Die Seite kommt ohne JavaScript aus: sie wird auf einem Telefon im Rohbau
 * benutzt.
 */
export const dynamic = 'force-dynamic';

export default async function NachtragAnmelden(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{
      titel?: string; quelle?: string;
      auftrag_leistung?: string; aufmass_zeile?: string;
    }>;
  },
) {
  const { mandant, id } = await params;
  const {
    titel = '', quelle = '', auftrag_leistung: auftragLeistung = '',
    aufmass_zeile: aufmassZeile = '',
  } = await searchParams;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/nachtraege/neu`;
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
      return { projekt, grundlagen: await ladeGrundlagen(kontext) };
    }),
  ) as Promise<{
    projekt: ProjektZeile; grundlagen: readonly GrundlageZeile[];
  } | null>);

  if (daten === null) notFound();

  // „Heute" kommt aus der DATENBANK, nie aus der Uhr des Node-Prozesses:
  // zwischen Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag der gestrige.
  const heute = await berlinHeute();

  return (
    <PortalRahmen
      titel="Nachtrag anmelden"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5">
        <h1 className="m-0 text-h1 text-text">Nachtrag anmelden</h1>
        <p className="m-0 mt-s1 text-sm text-text-muted">
          {daten.projekt.nummer} · {daten.projekt.bezeichnung} · {daten.projekt.kunde}
        </p>
      </div>

      {quelle !== '' && (
        <p
          className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
          data-cse="aus-warnung"
        >
          Dieser Nachtrag entsteht aus einer Warnung „außerhalb des
          Leistungsverzeichnisses". Titel und Bezug sind vorgeschlagen; die
          Anspruchsgrundlage wählen Sie — sie wird nie vorbelegt.
        </p>
      )}

      <form
        action="/api/bau/nachtraege"
        method="post"
        className="rounded-lg border border-line bg-surface p-s5"
        data-cse="nachtrag-formular"
      >
        <input type="hidden" name="projekt" value={id} />
        <input type="hidden" name="mandant" value={mandant} />
        {auftragLeistung !== '' && (
          <input type="hidden" name="auftrag_leistung" value={auftragLeistung} />
        )}
        {aufmassZeile !== '' && (
          <input type="hidden" name="aufmass_zeile" value={aufmassZeile} />
        )}

        <div className="grid gap-s4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Titel
            </span>
            <input
              name="titel"
              required
              defaultValue={titel}
              placeholder="Zusätzliche Bewehrung Achse C"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>

          {/* ---------------------------------------------------------------- */}
          {/* Die Pflichtauswahl (O-23, K-17) — ohne Vorgabewert.               */}
          {/* ---------------------------------------------------------------- */}
          <label className="md:col-span-2">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Anspruchsgrundlage (§ 2 VOB/B) — Pflichtauswahl
            </span>
            <select
              name="grundlage"
              required
              defaultValue=""
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              data-cse="grundlage"
            >
              {/* Kein vorausgewählter Absatz: die Rechtsfolge wählt ein Mensch. */}
              <option value="" disabled>Bitte wählen …</option>
              {daten.grundlagen.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.fundstelle} — {g.bezeichnung}
                  {g.ankuendigung_erforderlich ? ' · Ankündigung erforderlich' : ''}
                  {g.ist_platzhalter ? ' · unbestätigter Wert' : ''}
                </option>
              ))}
            </select>
            <span className="mt-s1 block text-xs text-text-subtle">
              Die Liste steht vollständig aus dem Gesetzestext und ist als
              unbestätigt gekennzeichnet, bis feststeht, welche Grundlagen die
              Gruppe tatsächlich verwendet (O-23). Ein Freitextfeld gibt es
              hier nicht.
            </span>
          </label>

          <label className="md:col-span-2">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Begründung
            </span>
            <textarea
              name="begruendung"
              required
              rows={4}
              placeholder="Was wurde angeordnet, von wem, und warum ist es nicht vom Vertrag gedeckt?"
              className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
            <span className="mt-s1 block text-xs text-text-subtle">
              Im Streit um § 2 VOB/B ist das Erste, wonach gefragt wird.
            </span>
          </label>

          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Angemeldet am (Ankündigung, § 2 Abs. 6 Nr. 1 VOB/B)
            </span>
            <input
              type="date"
              name="angemeldet_am"
              defaultValue={heute}
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
            <span className="mt-s1 block text-xs text-text-subtle">
              Das Datum lässt sich später nicht verschieben — es ist die Angabe,
              über die im Streit gestritten wird. Leer lassen, wenn noch nicht
              angekündigt wurde.
            </span>
          </label>

          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Form der Anordnung
            </span>
            <select
              name="anordnung_form"
              defaultValue="unbekannt"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            >
              <option value="unbekannt">nicht festgehalten</option>
              <option value="schriftlich">schriftlich</option>
              <option value="e_mail">per E-Mail</option>
              <option value="muendlich">mündlich (im Streit bestritten)</option>
            </select>
          </label>

          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Angeordnet von (Auftraggeberseite)
            </span>
            <input
              name="angeordnet_von"
              placeholder="Bauleiter AG, Name"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>

          <label className="flex items-start gap-s3">
            <input
              type="checkbox"
              name="ausgefuehrt_ohne_beauftragung"
              value="ja"
              className="mt-s2 size-4"
            />
            <span className="text-sm text-text">
              Bereits ausgeführt, ohne beauftragt zu sein
              <span className="mt-s1 block text-xs text-text-subtle">
                § 2 Abs. 8 VOB/B: im Zweifel unentgeltlich. Das Merkmal steht
                im Risikobericht, es sperrt nichts.
              </span>
            </span>
          </label>
        </div>

        <p className="mt-s4 max-w-prose text-xs text-text-subtle">
          Der Nachtrag wird hier <strong>nicht bepreist</strong>. Die
          Nachtragskalkulation ist ein eigener Vorgang; die Betragsspalten sind
          für diese Anwendung nicht einmal lesbar.
        </p>

        <div className="mt-s5 flex flex-wrap items-center gap-s3">
          <Button type="submit" variante="primary">Nachtrag anmelden</Button>
          <Link
            href={`/portal/${mandant}/bau/projekte/${id}/nachtraege`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Abbrechen
          </Link>
        </div>
      </form>
    </PortalRahmen>
  );
}
