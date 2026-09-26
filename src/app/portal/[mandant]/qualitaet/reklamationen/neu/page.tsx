import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../../../reinigung/daten';
import { listeNachweise } from '@/server/services/reinigung/leistungsnachweis';

/**
 * `/portal/[mandant]/qualitaet/reklamationen/neu` — die Aufnahme (OPS-11).
 *
 * **Der Nachweis wird AUSGEWÄHLT, nicht eingetippt.** Die Liste zeigt nur
 * vorgelegte und unterschriebene Nachweise: eine Beschwerde bestreitet ein
 * Dokument, das der Kunde gesehen hat, nicht einen Entwurf aus dem Büro. Der
 * Dienst prüft zusätzlich, dass Nachweis und Objekt zusammengehören — sonst
 * blockierte die Rechnungsfreigabe den falschen Vorgang.
 *
 * **Keine Frist wird gesetzt.** `faellig_am` bleibt leer, solange O-14 offen
 * ist; die Priorität sortiert die Liste und steuert sonst nichts.
 */
export const dynamic = 'force-dynamic';

export default async function ReklamationAufnehmen({
  params,
}: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/qualitaet/reklamationen/neu`);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const nachweise = (await mitLesekontext(sitzung, async (k) => listeNachweise(k)))
    .filter((n) => n.status === 'vorgelegt' || n.status === 'signiert');

  return (
    <PortalRahmen
      titel="Beanstandung aufnehmen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/qualitaet/reklamationen`, text: 'Alle Reklamationen' }}
    >
      <h1 className="mb-s5 text-h1 text-text">Beanstandung aufnehmen</h1>

      <form
        method="post"
        action="/api/qualitaet/reklamationen"
        className="rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/qualitaet/reklamationen`}
        />

        <div className="grid grid-cols-1 gap-s4 md:grid-cols-2">
          <div>
            <label htmlFor="nachweis" className="mb-s2 block text-sm text-text">
              Bestrittener Leistungsnachweis (optional)
            </label>
            <select
              id="nachweis"
              name="nachweis"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            >
              <option value="">keiner</option>
              {nachweise.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nummer ?? 'ohne Nummer'} · {n.objekt ?? '—'} ·{' '}
                  {n.leistungszeitraumVon} – {n.leistungszeitraumBis}
                </option>
              ))}
            </select>
            <p className="mt-s2 m-0 text-sm text-text-muted">
              Objekt und Kunde übernimmt das Formular aus dem gewählten Nachweis;
              ohne Nachweis sind beide einzutragen.
            </p>
          </div>
          <div>
            <label htmlFor="objekt" className="mb-s2 block text-sm text-text">
              Objekt-ID
            </label>
            <input
              id="objekt"
              name="objekt"
              required
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="kunde" className="mb-s2 block text-sm text-text">
              Kunden-ID (optional)
            </label>
            <input
              id="kunde"
              name="kunde"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="quelle" className="mb-s2 block text-sm text-text">Quelle</label>
            <select
              id="quelle"
              name="quelle"
              defaultValue="kunde"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            >
              <option value="kunde">Kunde</option>
              <option value="eigenkontrolle">Eigenkontrolle</option>
              <option value="qualitaetspruefung">Qualitätsprüfung</option>
              <option value="mitarbeiter">Mitarbeitende</option>
            </select>
          </div>
          <div>
            <label htmlFor="prioritaet" className="mb-s2 block text-sm text-text">
              Priorität — sortiert, steuert nichts (O-14)
            </label>
            <select
              id="prioritaet"
              name="prioritaet"
              defaultValue="mittel"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            >
              <option value="niedrig">Niedrig</option>
              <option value="mittel">Mittel</option>
              <option value="hoch">Hoch</option>
            </select>
          </div>
          <div>
            <label htmlFor="gemeldet_von" className="mb-s2 block text-sm text-text">
              Gemeldet von (Name auf Kundenseite)
            </label>
            <input
              id="gemeldet_von"
              name="gemeldet_von"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
        </div>

        <div className="mt-s4">
          <label htmlFor="beschreibung" className="mb-s2 block text-sm text-text">
            Was wird beanstandet?
          </label>
          <textarea
            id="beschreibung"
            name="beschreibung"
            rows={4}
            required
            className="w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
          />
        </div>

        <p className="mt-s4 m-0 text-sm text-text-muted">
          Der Eingangszeitpunkt wird vom Server gesetzt und lässt sich danach
          nicht mehr ändern — an ihm hängt jede Frist, die später läuft.
        </p>

        <div className="mt-s5">
          <Button type="submit" variante="primary">Aufnehmen</Button>
        </div>
      </form>
    </PortalRahmen>
  );
}
