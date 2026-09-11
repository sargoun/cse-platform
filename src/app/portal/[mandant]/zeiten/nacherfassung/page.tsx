import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import { ABLEHNUNG_GRUENDE, offeneAnsprueche, type OfflineWartend }
  from '@/server/services/zeit/offline';

/**
 * `/portal/[mandant]/zeiten/nacherfassung` — was ein Telefon ohne Netz
 * behauptet hat, und was ein Mensch daraus macht (TIM-09, TIM-11).
 *
 * **Ein Anspruch ist noch keine Zeit.** Die Warteschlange nimmt jede
 * Nachreichung an, auch ausserhalb des Schichtfensters — sonst gingen der
 * Kraft im Treppenhaus ihre Stunden verloren. Aber sie schreibt KEINEN
 * Zeiteintrag: ein Beginn, den eine unangemeldete App behauptet hat, ist keine
 * § 17-Aufzeichnung, die sich verteidigen lässt (Invariante 5). Erst ein
 * Mensch macht daraus einen Datensatz, mit Begründung und Korrekturspur.
 *
 * **Die Felder sind LEER, und das ist Absicht.** Die behauptete Zeit steht
 * daneben, nicht im Eingabefeld: vorbelegt trüge der übernommene Eintrag
 * `planer_entscheidung` und wäre von einer echten Entscheidung nicht mehr zu
 * unterscheiden. Dass ein Mensch beim Eintragen auf die Behauptung schaut, ist
 * in Ordnung; dass die Plattform sie für ihn einsetzt, nicht.
 *
 * **Beide Zeitpunkte stehen da.** Was das Gerät behauptet UND wann es ankam —
 * eine Liste mit nur einem von beiden nimmt der Planung genau die Auskunft,
 * wegen der sie entscheiden soll.
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: Readonly<Record<string, string>> = {
  checkin: 'Beginn', checkout: 'Ende', pause: 'Pause',
  foto: 'Foto', nacherfassung: 'Nacherfassung',
};

const GRUND_TEXT: Readonly<Record<string, string>> = {
  token_ungueltig: 'Marke ungültig',
  ausserhalb_fenster: 'Außerhalb des Schichtfensters',
  bereits_eingeloest: 'Bereits eingelöst',
  einsatz_storniert: 'Schicht storniert',
  zuordnung_entfernt: 'Einteilung zurückgenommen',
  unplausibel: 'Unplausibel',
  sonstiges: 'Sonstiges',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  empfangen: 'Empfangen',
  zugeordnet: 'Zugeordnet',
  manuelle_pruefung: 'Manuelle Prüfung',
};

function dauerText(sekunden: number): string {
  const abs = Math.abs(Math.trunc(sekunden));
  const stunden = Math.floor(abs / 3600);
  const minuten = Math.floor((abs % 3600) / 60);
  const teil = stunden > 0
    ? `${String(stunden)} h ${String(minuten)} min`
    : `${String(minuten)} min`;
  return sekunden < 0 ? `−${teil}` : teil;
}

export default async function Nacherfassung({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/nacherfassung`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const erledigt = typeof frage['erledigt'] === 'string' ? frage['erledigt'] : null;
  const fehler = typeof frage['fehler'] === 'string' ? frage['fehler'] : null;

  /**
   * KEIN Schnappschuss-Lesen: `offeneAnsprueche` verlangt einen
   * Schreibkontext, weil dieselbe Sitzung gleich darauf entscheidet. Eine
   * Liste aus einer Nur-Lese-Transaktion zeigte einen Anspruch, den ein
   * anderer Bildschirm in derselben Sekunde schon übernommen hat.
   */
  const zeilen = await (db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => offeneAnsprueche(kontext)),
  ) as Promise<readonly OfflineWartend[]>);

  const eingabe = 'mt-s1 w-full rounded-md border border-line bg-surface px-s3 py-s2 text-base text-text';
  const beschriftung = 'text-micro uppercase tracking-[0.08em] text-text-subtle';

  return (
    <PortalRahmen
      titel="Nacherfassung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Nacherfassung</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 offener Anspruch' : `${String(zeilen.length)} offene Ansprüche`}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/zeiten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Zeiten
        </Link>
        <Link
          href={`/portal/${mandant}/zeiten/korrekturen`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Korrekturbuch
        </Link>
      </nav>

      {erledigt !== null && (
        <p
          data-cse="anspruch-erledigt"
          className="mb-s5 rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          {erledigt === 'abgelehnt'
            ? 'Der Anspruch ist abgelehnt. Er bleibt mit seinem Grund stehen und ist im Lohnstreit vorlegbar (Invariante 8).'
            : 'Der Zeiteintrag ist angelegt — mit Korrekturspur: wer entschieden hat, wann und warum (TIM-11).'}
        </p>
      )}

      {fehler !== null && (
        <p
          data-cse="anspruch-fehler"
          className="mb-s5 rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger"
        >
          {fehler === 'begruendung_zu_kurz'
            ? 'Die Begründung ist zu kurz. Eine Entscheidung ohne Grund ist im Streit nichts wert — mindestens zehn Zeichen.'
            : fehler === 'bereits_entschieden'
              ? 'Über diesen Anspruch hat jemand anders bereits entschieden.'
              : `Der Anspruch wurde nicht übernommen: ${fehler}`}
        </p>
      )}

      <p className="mb-s5 max-w-prose rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
        Ein Anspruch ist noch keine Zeit. Was das Gerät ohne Netz aufgezeichnet
        hat, wird <strong className="text-text">angenommen</strong> — auch
        außerhalb des Schichtfensters, sonst gingen der Kraft ihre Stunden
        verloren —, aber es entsteht kein Zeiteintrag daraus, bis ein Mensch
        ihn anlegt. Die Felder unten sind deshalb leer: die behauptete Zeit
        steht daneben, damit sie gelesen und nicht übernommen wird.
      </p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine offenen Ansprüche. Das ist die Regel und nicht die Ausnahme:
          eine Nachreichung entsteht nur dort, wo das Netz gefehlt hat.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 xl:grid-cols-2">
          {zeilen.map((z) => (
            <li
              key={z.id}
              data-cse="anspruch"
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s2">
                <h2 className="m-0 text-h3 text-text">{ART_TEXT[z.art] ?? z.art}</h2>
                <span className="text-sm text-text-muted">
                  {STATUS_TEXT[z.status] ?? z.status}
                </span>
              </div>

              <dl className="m-0 mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                <div>
                  <dt className={beschriftung}>Behauptet</dt>
                  <dd className="m-0 mt-s1 text-base tabular-nums text-text">
                    {berlinAnzeige(z.behaupteteZeit)}
                  </dd>
                </div>
                <div>
                  <dt className={beschriftung}>Empfangen (Serveruhr)</dt>
                  <dd className="m-0 mt-s1 text-base tabular-nums text-text">
                    {berlinAnzeige(z.empfangenAm)}
                  </dd>
                </div>
                <div>
                  <dt className={beschriftung}>Verzögerung</dt>
                  <dd className="m-0 mt-s1 text-base tabular-nums text-text-muted">
                    {dauerText(z.verzoegerungSek)}
                  </dd>
                </div>
                <div>
                  <dt className={beschriftung}>Geräteabweichung</dt>
                  <dd className="m-0 mt-s1 text-base tabular-nums text-text-muted">
                    {dauerText(z.zeitabweichungSek)}
                    {/* Gespeichert, nie ausgewertet: LEG-10, O-06. */}
                  </dd>
                </div>
              </dl>

              <form
                method="post"
                action={`/api/offline-ereignis/${z.id}`}
                className="grid grid-cols-1 gap-s3"
              >
                <input type="hidden" name="zurueck" value={pfad} />

                <div className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
                  <div>
                    <label className={beschriftung} htmlFor={`beginn-${z.id}`}>
                      Beginn (Berliner Zeit)
                    </label>
                    <input
                      id={`beginn-${z.id}`}
                      name="beginn"
                      type="datetime-local"
                      className={eingabe}
                    />
                  </div>
                  <div>
                    <label className={beschriftung} htmlFor={`ende-${z.id}`}>
                      Ende (optional)
                    </label>
                    <input
                      id={`ende-${z.id}`}
                      name="ende"
                      type="datetime-local"
                      className={eingabe}
                    />
                  </div>
                </div>

                <div>
                  <label className={beschriftung} htmlFor={`grund-${z.id}`}>
                    Ablehnungsgrund (nur beim Ablehnen)
                  </label>
                  <select id={`grund-${z.id}`} name="grund" className={eingabe} defaultValue="">
                    <option value="">— bitte wählen —</option>
                    {ABLEHNUNG_GRUENDE.map((g) => (
                      <option key={g} value={g}>{GRUND_TEXT[g] ?? g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={beschriftung} htmlFor={`begruendung-${z.id}`}>
                    Begründung (mindestens zehn Zeichen)
                  </label>
                  <textarea
                    id={`begruendung-${z.id}`}
                    name="begruendung"
                    rows={2}
                    required
                    minLength={10}
                    className={eingabe}
                    placeholder="Was wurde geprüft, und woran?"
                  />
                </div>

                <div className="flex flex-wrap gap-s3">
                  <Button type="submit" name="aktion" value="uebernehmen" variante="primary">
                    Übernehmen
                  </Button>
                  <Button type="submit" name="aktion" value="ablehnen" variante="secondary">
                    Ablehnen
                  </Button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </PortalRahmen>
  );
}
