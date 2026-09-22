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
import { haeltRechte } from '@/app/portal/rechte';
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

/**
 * `unbekannt` steht hier ausgeschrieben, und das ist der Punkt.
 *
 * Die Richtung eines Stempels kommt aus dem Zweck der Marke (0090). Löst die
 * Marke nicht auf — widerrufen, Einteilung zurückgenommen, Hash unbekannt —,
 * dann kennt sie niemand: weder das Telefon, das nur einen Knopf hat, noch
 * der Server. Ein Kürzel wie „Stempel" verschwiege das; ein vorgegebenes
 * „Beginn" wäre die Falschaussage, wegen der diese Zeile existiert. Wer hier
 * entscheidet, soll lesen, was wirklich gilt.
 */
const ART_TEXT: Readonly<Record<string, string>> = {
  checkin: 'Beginn', checkout: 'Ende', pause: 'Pause',
  foto: 'Foto', nacherfassung: 'Nacherfassung',
  unbekannt: 'Richtung vom Gerät nicht feststellbar',
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
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'zeit.lesen');
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

      {/*
        * `/zeiten` und `/zeiten/korrekturen` verlangen `zeit.lesen` (Manifest); diese
        * Seite nur ihr Nacherfassungsrecht. Ohne das Recht fehlt die Leiste ganz
        * (AUT-06; D-581).
        */}
      {darf['zeit.lesen'] === true && (
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
      )}

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
          {zeilen.map((z) => {
            /**
             * Als `string` gelesen, nicht als `OfflineArt`.
             *
             * Hier stand, die Vereinigung in `services/zeit/offline.ts` kenne
             * `unbekannt` nicht — sie kennt ihn seit 0090, und ein Kommentar,
             * der eine Lücke beschreibt, die es nicht mehr gibt, verdeckt beim
             * nächsten Lesen die Lücke, die es dann gibt. Der Grund ist ein
             * anderer und bleibt: `offline_ereignis_art` ist ein Enum der
             * Datenbank, die Vereinigung daneben eine Abschrift davon. Wächst
             * das Enum und die Abschrift nicht mit, fällt hier ein Wert aus
             * der Anzeige, den `ART_TEXT[art] ?? art` sonst wenigstens roh
             * hinschreibt. Die Datenbank hat recht, nicht der Typ.
             */
            const art: string = z.art;
            return (
            <li
              key={z.id}
              data-cse="anspruch"
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s2">
                <h2 className="m-0 text-h3 text-text">{ART_TEXT[art] ?? art}</h2>
                <span className="text-sm text-text-muted">
                  {STATUS_TEXT[z.status] ?? z.status}
                </span>
              </div>

              {/*
                * Die Auskunft, die den Unterschied macht: hier steht KEIN
                * geratener Beginn. Wer entscheidet, muss wissen, dass die
                * Richtung offen ist — sonst trägt er einen Beginn ein, den
                * niemand behauptet hat.
                */}
              {art === 'unbekannt' && (
                <p
                  data-cse="richtung-unbekannt"
                  className="m-0 mb-s4 rounded-md border border-warning bg-warning-soft p-s3 text-sm text-warning"
                >
                  Das Gerät hat einen Stempel festgehalten, aber keine Richtung:
                  die Fläche hat einen Knopf, und die Marke, die Beginn oder
                  Ende bestimmt, hat beim Nachreichen nicht aufgelöst. Ob hier
                  eine Schicht beginnt oder endet, klären Sie am Dienstplan und
                  an den übrigen Einträgen dieser Kraft — nicht an dieser Zeile.
                </p>
              )}

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
                  <Button type="submit" name="aktion" value="uebernehmen" variante="secondary">
                    Übernehmen
                  </Button>
                  <Button type="submit" name="aktion" value="ablehnen" variante="ghost">
                    Ablehnen
                  </Button>
                </div>
              </form>
            </li>
            );
          })}
        </ul>
      )}
    </PortalRahmen>
  );
}
