import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  ANHAENGE_SICHTBAR, findeKundennachricht, ladeFaden,
} from '@/server/services/kundenportal/nachricht';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { kundePortal, KundenRahmen } from '../../rahmen';
import {
  Feld, Felder, Gesellschaft, KeinZugang, Kopfzeile, Offen, Zurueck,
} from '../../bausteine';

/**
 * `/portal/kunde/nachrichten/[id]` — eine Nachricht mit ihrem Faden
 * (NOT-03, AUT-06, 0255).
 *
 * **Der Faden steht mit auf der Seite, nicht daneben.** Ein Vorgang ist die
 * Frage UND die Antwort; sie auf zwei Adressen zu verteilen heisst, dem
 * Kunden das Sortieren im Kopf zu ueberlassen — dasselbe Argument, mit dem
 * `0231` den Faden ueberhaupt eingefuehrt hat. Was der Kunde davon nicht
 * sehen darf, haelt die Decke fern: ein interner Vermerk im selben Faden
 * traegt `richtung = 'intern'` und kommt in keiner dieser Abfragen vor.
 *
 * **Eine fremde Nachricht gibt 404, nie 403** (AUT-06, SEC-A3): `t_kunde` und
 * `p_kunde_decke` (0255) liefern null Zeilen, und „nicht da" ist byte-gleich
 * mit „nicht erlaubt". Ein eigener Code hier bestaetigte die Existenz eines
 * Vorgangs bei einem anderen Kunden.
 *
 * **Der Absender wird nicht aufgeloest** — es steht die Gesellschaft, nie ein
 * Mitarbeitername (04-SEITENKARTE §8 schliesst dem Kunden das ganze
 * `personal`-Modul aus).
 */
export const dynamic = 'force-dynamic';

export default async function Kundennachricht(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roh } = await params;
  const id = kennungOder404(roh);

  const ergebnis = await kundePortal(`/portal/kunde/nachrichten/${id}`,
    async (kontext) => {
      const nachricht = await findeKundennachricht(kontext, id);
      if (nachricht === null) return null;
      return { nachricht, faden: await ladeFaden(kontext, nachricht.threadId, nachricht.id) };
    });

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Nachricht" aktiverTab="nachrichten">
        <Kopfzeile titel="Nachricht" />
        <KeinZugang />
      </KundenRahmen>
    );
  }
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { nachricht, faden } = ergebnis.daten;
  const titel = nachricht.betreff ?? 'Nachricht ohne Betreff';

  return (
    <KundenRahmen basis={basis} titel={titel} aktiverTab="nachrichten">
      <Zurueck ziel="/portal/kunde/nachrichten" text="Alle Nachrichten" />

      <Kopfzeile titel={titel}>
        <StatusPill zustand={nachricht.gelesen ? 'Inaktiv' : 'Wartet'} />
      </Kopfzeile>

      <Card className="mb-s5">
        <Felder>
          <Feld label="Gesellschaft">
            <Gesellschaft slug={nachricht.mandantSlug} name={nachricht.mandantName} />
          </Feld>
          <Feld label="Richtung">
            {nachricht.richtung === 'eingehend' ? 'Von Ihnen' : 'An Sie'}
          </Feld>
          <Feld label="Zeitpunkt (Berlin)">
            <span className="cse-zahl">{nachricht.zeitpunktLokal}</span>
          </Feld>
          <Feld label="Weg">
            {nachricht.kanal === 'portal' ? 'Portal' : nachricht.kanal === 'email'
              ? 'E-Mail' : 'SMS'}
          </Feld>
        </Felder>

        {/*
          * `whitespace-pre-line`: der Koerper ist Klartext mit Absaetzen, und
          * ohne diese Klasse steht ein Brief als ein einziger Block da. Kein
          * HTML — der Text kommt aus der Datenbank und wird als Text
          * gerendert (React maskiert ihn), nicht als Markup.
          */}
        <p className="mt-s5 mb-0 max-w-prose whitespace-pre-line text-base text-text">
          {nachricht.koerper}
        </p>
      </Card>

      {nachricht.anhaenge > 0 && (
        <div className="mb-s5">
          <h2 className="mb-s3 text-h3 text-text">
            Anlagen <span className="cse-zahl text-text-muted">({nachricht.anhaenge})</span>
          </h2>
          {ANHAENGE_SICHTBAR ? null : (
            <Offen
              nummer="O-671"
              was="Die Anlagen liegen nicht im Portal"
              weg="Die Dateien haben Sie auf dem bisherigen Weg erhalten; ob
                Anlagen im Portal zum Herunterladen stehen, ist noch nicht
                entschieden."
            />
          )}
        </div>
      )}

      {faden.length > 0 && (
        <>
          <h2 className="mb-s3 text-h3 text-text">Vorgang</h2>
          <ul className="m-0 mb-s5 flex list-none flex-col gap-s3 p-0">
            {faden.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/portal/kunde/nachrichten/${n.id}`}
                  data-cse="faden-eintrag"
                  className="block rounded-lg border border-line bg-surface p-s4 no-underline transition-colors duration-fast hover:bg-surface-2"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-s2">
                    <span className="text-base text-text">
                      {n.betreff ?? 'ohne Betreff'}
                    </span>
                    <span className="cse-zahl text-sm text-text-muted">
                      {n.zeitpunktLokal}
                    </span>
                  </span>
                  <span className="mt-s2 block text-sm text-text-muted">
                    {n.richtung === 'eingehend' ? 'Von Ihnen' : 'An Sie'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <Offen
        nummer="O-74"
        was="Antworten läuft über Ihre Ansprechpartnerin"
        weg="Das Portal ist lesend; ob ein Kundenzugang im Portal schreiben darf,
          ist noch nicht entschieden."
      />
    </KundenRahmen>
  );
}
