import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../../../daten';
import { bereiteUnterschriftVor } from '@/server/services/reinigung/leistungsnachweis';
import type { SchnappschussPosition } from '@/server/services/reinigung/schnappschuss';

/**
 * `/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift` — der
 * Bildschirm, den der Kunde vor Ort sieht (CLN-04, TIM-08, LEG-10).
 *
 * **Die Prüfsumme reist mit und wird beim Abschicken verglichen.** Sie ist der
 * Digest genau der Zeilen, die hier stehen. Ändert das Büro in der Zwischenzeit
 * eine Zeile, weist der Dienst die Unterschrift ab, statt ein Dokument zu
 * erzeugen, das der Kunde so nie gesehen hat.
 *
 * **Die Gerätezeit füllt der Browser, die Serverzeit der Server.** Das Feld
 * unten ist eine BEHAUPTUNG des Tablets und wird getrennt gespeichert; welche
 * Zeit im Dokument steht, entscheidet `now()` in der Datenbank (Invariante 5).
 * Ohne JavaScript bleibt es leer — und die Unterschrift gelingt trotzdem, weil
 * die Gerätezeit nie das Tragende war.
 *
 * **Kein Canvas ohne Speicher.** Das Unterschriftsbild ist die Beigabe, nicht
 * der Beweis: Name, Serverzeit und Abzug tragen den Vorgang. Ist der
 * Bildspeicher nicht verbunden, sagt die Seite es und lässt unterschreiben,
 * statt einen Erfolg vorzutäuschen (CLAUDE.md: keine Schein-Integrationen).
 */
export const dynamic = 'force-dynamic';

function cent(text: string | null): string {
  if (text === null) return '—';
  const roh = text.startsWith('-') ? text.slice(1) : text;
  const ganz = roh.length > 2 ? roh.slice(0, -2) : '0';
  const rest = roh.padStart(3, '0').slice(-2);
  return `${text.startsWith('-') ? '-' : ''}${ganz},${rest} €`;
}

export default async function Unterschriftsblatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(
    `/portal/${mandant}/reinigung/leistungsnachweise/[id]/unterschrift`,
  );
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const vorschau = await mitLesekontext(sitzung, async (k) =>
    bereiteUnterschriftVor(k, id).catch(() => null));
  if (vorschau === null) notFound();

  const bereit = vorschau.kopf.status === 'vorgelegt';

  return (
    <PortalRahmen
      titel="Unterschrift"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/reinigung/leistungsnachweise/${id}`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Zum Nachweis
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">
        Leistungsnachweis {vorschau.kopf.nummer ?? ''}
      </h1>
      <p className="mb-s5 text-sm text-text-muted">
        {vorschau.kopf.kunde} · {vorschau.kopf.objekt ?? '—'} ·{' '}
        <span className="tabular-nums">
          {vorschau.kopf.leistungszeitraumVon} – {vorschau.kopf.leistungszeitraumBis}
        </span>
      </p>

      {!bereit && (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-sm text-danger">
          <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Dieser Nachweis steht auf „{vorschau.kopf.status}". Unterschrieben wird
          nur, was vorgelegt ist.
        </p>
      )}

      <DataTable<SchnappschussPosition>
        beschriftung="Positionen, die unterschrieben werden"
        zeilen={vorschau.positionen}
        schluessel={(p) => p.reihenfolge}
        spalten={[
          { schluessel: 'bezeichnung', kopf: 'Leistung', zelle: (p) => p.bezeichnung },
          {
            schluessel: 'menge',
            kopf: 'Menge',
            numerisch: true,
            zelle: (p) => p.menge.replace('.', ','),
          },
          { schluessel: 'einheit', kopf: 'Einheit', zelle: (p) => p.einheit },
          {
            schluessel: 'preis',
            kopf: 'Einzelpreis',
            numerisch: true,
            zelle: (p) => cent(p.einzelpreisCent),
          },
        ]}
      />

      <form
        method="post"
        action="/api/reinigung/leistungsnachweise"
        className="mt-s5 rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="nachweis" value={id} />
        <input type="hidden" name="rolle" value="auftraggeber" />
        {/* Der Digest genau dieser Zeilen. Ohne ihn wird nicht unterschrieben. */}
        <input type="hidden" name="pruefsumme" value={vorschau.pruefsumme} />
        <input
          type="hidden"
          name="zurueck"
          value={`/portal/${mandant}/reinigung/leistungsnachweise/${id}`}
        />
        {/*
          Die Behauptung des Geräts. Sie bleibt leer, wenn kein Skript läuft —
          und das ist in Ordnung: maßgeblich ist ohnehin die Serverzeit.
        */}
        <input type="hidden" name="geraete_zeit" value="" />

        <p className="mb-s4 max-w-prose text-base text-text">
          {vorschau.bestaetigungstext}
        </p>

        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <div>
            <label htmlFor="unterzeichner" className="mb-s2 block text-sm text-text">
              Name der unterzeichnenden Person
            </label>
            <input
              id="unterzeichner"
              name="unterzeichner"
              required
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
          <div>
            <label htmlFor="funktion" className="mb-s2 block text-sm text-text">
              Funktion (optional)
            </label>
            <input
              id="funktion"
              name="funktion"
              autoComplete="off"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
            />
          </div>
        </div>

        <p className="mt-s4 text-sm text-text-muted">
          <Icon name="uhr" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Zeitpunkt und Ort werden vom Server festgehalten. Die Uhrzeit des
          Geräts wird — falls übermittelt — daneben gespeichert, nie an ihrer
          Stelle.
        </p>
        <p className="mt-s2 text-sm text-text-muted">
          <Icon name="stift" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
          Unterschriftsbild: <strong className="text-warning">nicht verbunden</strong> —
          ohne Zugangsdaten für den Bildspeicher wird keines abgelegt. Name,
          Zeitpunkt und der Abzug der Positionen tragen den Nachweis auch ohne.
        </p>

        <div className="mt-s5 flex flex-wrap gap-s3">
          <Button type="submit" variante="primary" disabled={!bereit}>
            Unterschreiben
          </Button>
          <Link
            href={`/portal/${mandant}/reinigung/leistungsnachweise/${id}`}
            className="inline-flex min-h-11 items-center text-sm text-text-muted underline hover:text-text"
          >
            Abbrechen
          </Link>
        </div>
      </form>
    </PortalRahmen>
  );
}
