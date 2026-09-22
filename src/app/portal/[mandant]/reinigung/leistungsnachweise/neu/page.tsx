import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/reinigung/leistungsnachweise/neu` — der Bürofallback
 * (CLN-04).
 *
 * **Der Normalweg ist die Kraft vor Ort**, nicht dieses Formular: sie erzeugt
 * den Nachweis auf der Schicht, und der Kunde unterschreibt ihn dort. Dieses
 * Blatt gibt es für den Fall, dass das nicht ging — Gerät leer, Kunde nicht
 * da, Nachtrag am nächsten Morgen.
 *
 * **Beide Wege rufen DENSELBEN Dienst.** Zwei Chromes über einem Dienst sind
 * kein Problem; zwei Dienste über einem Dokument wären es — dann gäbe es zwei
 * Wahrheiten darüber, was ein Nachweis ist.
 *
 * **Die Menge reist als Text.** `21,5` wird zu `21.5`, und zwar in der Route;
 * durch `Number()` geschickt und wieder ausgegeben wäre sie eine
 * Gleitkommazahl, und das ist bei Mengen so falsch wie bei Beträgen
 * (Invariante 1, K-16).
 */
export const dynamic = 'force-dynamic';

const ZEILEN = [0, 1, 2, 3, 4];

export default async function NachweisAnlegen({
  params,
}: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const zugang = await portalZugang(
    `/portal/${mandant}/reinigung/leistungsnachweise/neu`,
  );
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: die Liste `…/reinigung/leistungsnachweise` verlangt laut Manifest
     `nachweis.lesen`, dieses Blatt nur `nachweis.schreiben` — wer nur anlegen
     darf, sah „Alle Leistungsnachweise" und bekam dahinter ein 404. Ein
     Verweis auf 404 verraet, was er nicht zeigen darf (Copilot-Runde auf
     PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'nachweis.lesen');

  return (
    <PortalRahmen
      titel="Neuer Leistungsnachweis"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['nachweis.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/reinigung/leistungsnachweise`, text: 'Alle Leistungsnachweise' } }
        : {})}
    >
      <h1 className="mb-s3 text-h1 text-text">Neuer Leistungsnachweis</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Bürofallback. Der Nachweis entsteht als Entwurf und trägt noch keine
        Nummer — die wird beim Vorlegen gezogen.
      </p>

      <form
        method="post"
        action="/api/reinigung/leistungsnachweise/entwurf"
        className="rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/reinigung/leistungsnachweise`}
        />

        <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
          <div>
            <label htmlFor="objekt" className="mb-s2 block text-sm text-text">Objekt-ID</label>
            <input
              id="objekt"
              name="objekt"
              required
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="kunde" className="mb-s2 block text-sm text-text">Kunden-ID</label>
            <input
              id="kunde"
              name="kunde"
              required
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="von" className="mb-s2 block text-sm text-text">
              Leistungszeitraum von (Berliner Kalendertag)
            </label>
            <input
              id="von"
              name="von"
              type="date"
              required
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="bis" className="mb-s2 block text-sm text-text">bis</label>
            <input
              id="bis"
              name="bis"
              type="date"
              required
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="revier" className="mb-s2 block text-sm text-text">
              Revier-ID (optional)
            </label>
            <input
              id="revier"
              name="revier"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="leistung" className="mb-s2 block text-sm text-text">
              Auftragsleistung-ID (optional, Abrechnungsanker)
            </label>
            <input
              id="leistung"
              name="leistung"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
        </div>

        <fieldset className="mt-s5 m-0 border-0 p-0">
          <legend className="mb-s3 text-h3 text-text">Positionen</legend>
          <p className="mb-s4 m-0 text-sm text-text-muted">
            Leere Zeilen werden verworfen. Eine Zeile ohne lesbare Menge wird
            ebenfalls verworfen — eine stillschweigend auf 1 gesetzte Menge wäre
            ein Wert, den niemand gesetzt hat.
          </p>
          {ZEILEN.map((i) => (
            <div key={i} className="mb-s3 grid grid-cols-1 gap-s3 md:grid-cols-[2fr_1fr_1fr]">
              <div>
                <label htmlFor={`bezeichnung-${String(i)}`} className="mb-s2 block text-sm text-text">
                  Leistung {i + 1}
                </label>
                <input
                  id={`bezeichnung-${String(i)}`}
                  name="bezeichnung"
                  autoComplete="off"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
                />
              </div>
              <div>
                <label htmlFor={`menge-${String(i)}`} className="mb-s2 block text-sm text-text">
                  Menge
                </label>
                <input
                  id={`menge-${String(i)}`}
                  name="menge"
                  inputMode="decimal"
                  autoComplete="off"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base tabular-nums text-text"
                />
              </div>
              <div>
                <label htmlFor={`einheit-${String(i)}`} className="mb-s2 block text-sm text-text">
                  Einheit
                </label>
                <input
                  id={`einheit-${String(i)}`}
                  name="einheit"
                  autoComplete="off"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
                />
              </div>
            </div>
          ))}
        </fieldset>

        <div className="mt-s5">
          <Button type="submit" variante="primary">Entwurf anlegen</Button>
        </div>
      </form>
    </PortalRahmen>
  );
}
