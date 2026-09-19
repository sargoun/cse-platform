import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/lib/design/icons';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { kundenUebersicht, type Kundenuebersicht }
  from '@/server/services/kundenportal/uebersicht';
import { DOKUMENTE_ERREICHBAR } from '@/server/services/kundenportal/dokument';
import { findeRoute, leserechte } from '@/server/registry/routen';
import { AnmeldungNoetig } from '../Anmeldung';
import { kundePortal, KundenRahmen } from './rahmen';
import { KeinZugang, Kopfzeile } from './bausteine';

/**
 * `/portal/kunde` — das Kundenportal (AUT-01, DSH-03, DSH-04,
 * 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Warum diese Seite eine Sprungliste traegt und nicht nur einen Willkommenssatz
 * ===========================================================================
 *
 * Die Kunden-Tab-Leiste (`registry/tableiste.ts`) fuehrt genau FUENF Ziele —
 * Uebersicht, Auftraege, Rechnungen, Nachweise, Nachrichten — und sie hat kein
 * `Mehr` (§11.2 nennt die beiden Leisten ohne `Mehr` beim Namen; die
 * Kundenleiste steht dort nicht, hat aber trotzdem keines). Gebaut sind aber
 * ZEHN Bildschirme: dazu Angebote, Objekte, Bauprojekte, Zahlungen,
 * Reklamationen und Dokumente. Sechs davon waeren ohne diese Seite mit keinem
 * einzigen Klick erreichbar — man kaeme nur hin, indem man die Adresse
 * eintippt. Ein Bildschirm, den niemand oeffnen kann, ist genauso gut nicht
 * gebaut.
 *
 * Die dauerhafte Loesung ist ein `KUNDEN_NAVIGATION`-Register neben
 * `GRUPPEN_NAVIGATION` plus ein `Mehr` in der Kundenleiste — beides liegt in
 * `src/server/registry/`, das zentral gepflegt wird; die Eintraege dafuer
 * gehen als Text mit diesem Stapel. Bis sie stehen, ist DIESE Seite der Weg,
 * und sie ist ohnehin der richtige: eine Uebersicht, die zeigt, was es gibt,
 * ist besser als ein Menuepunkt, der nur sagt, dass es etwas gibt.
 *
 * **Jede Karte prueft ihr Recht.** Ein Verweis, dessen Ziel diese Sitzung
 * nicht oeffnen darf, verraet die Existenz dessen, was er nicht zeigen darf
 * (AUT-06, D-581) — und dahinter stuende ein 404. Die Rechte kommen aus
 * `kundePortal`, also aus derselben gebundenen Transaktion wie die Zahlen,
 * und ueber `app.sichtbare_mandanten()`, weil es im Kunden-Scope keinen
 * aktiven Mandanten gibt (K-20).
 *
 * **Die Zahlen sind Zustaende, keine Kennzahlen** — die Begruendung steht in
 * `services/kundenportal/uebersicht.ts`.
 */
export const dynamic = 'force-dynamic';

interface Ziel {
  readonly pfad: '/portal/kunde/rechnungen' | '/portal/kunde/zahlungen'
  | '/portal/kunde/nachweise' | '/portal/kunde/projekte'
  | '/portal/kunde/reklamationen' | '/portal/kunde/nachrichten'
  | '/portal/kunde/auftraege' | '/portal/kunde/angebote'
  | '/portal/kunde/objekte' | '/portal/kunde/dokumente';
  readonly titel: string;
  readonly icon: IconName;
  readonly zahl: (u: Kundenuebersicht) => string;
  readonly satz: (u: Kundenuebersicht) => string;
}

/**
 * Die Rechte einer Karte kommen aus dem MANIFEST, nicht aus dieser Datei.
 *
 * Hier stand je Karte genau EIN Schluessel — abgeschrieben. Zwei Ziele
 * verlangen aber zwei: `/portal/kunde/rechnungen` fuehrt
 * `["finanzen.lesen","finanzen.herunterladen"]`, `/portal/kunde/nachweise`
 * fuehrt `["nachweis.lesen","bau.lesen"]`, und `pruefeZugang` verknuepft die
 * Leserechte einer Route mit UND (`zugang.ts`: fehlt EINES, `kein_recht` →
 * `notFound()`). Eine Anmeldung ohne das zweite Recht saehe die Karte und
 * bekaeme dahinter 404 — genau das, was der Kopfkommentar dieser Datei
 * ausschliesst.
 *
 * Abschreiben waere dieselbe Wette noch einmal: die Rechtevergabe ist das,
 * was sich zuerst aendert. `leserechte(findeRoute(pfad))` liest die Liste da,
 * wo `portalZugang` sie auch liest — eine Quelle, zwei Leser, kein Drift.
 */
function rechteFuer(pfad: string): readonly string[] {
  const route = findeRoute(pfad);
  return route === undefined ? [] : leserechte(route);
}

/**
 * Die ZEHN Ziele des Kundenportals.
 *
 * Es waren sechs, solange `auftraege`, `angebote`, `objekte` und `dokumente`
 * in der Auffangroute endeten — ein Verweis auf „dieses Modul wird noch
 * gebaut" ist die teuerste Art, eine Luecke zu zeigen. Die vier sind gebaut
 * und stehen deshalb jetzt hier.
 *
 * **`dokumente` steht darin, obwohl die Liste dahinter heute leer ist**, und
 * das ist eine bewusste Entscheidung gegen das Weglassen: die Seite ERKLAERT
 * ihre Leere (O-671), und die Karte tut es auch. Ein Bildschirm, der sagt
 * „dieser Weg ist noch nicht geoeffnet, so bekommen Sie die Unterlage
 * heute", ist besser als ein Menuepunkt, den es nicht gibt und nach dem
 * jemand sucht.
 */
const ZIELE: readonly Ziel[] = [
  {
    pfad: '/portal/kunde/auftraege', titel: 'Aufträge',
    icon: 'auftrag',
    zahl: (u) => String(u.auftraegeAktiv),
    satz: (u) => u.auftraege === u.auftraegeAktiv
      ? 'laufende Aufträge'
      : `laufend, ${u.auftraege} insgesamt`,
  },
  {
    pfad: '/portal/kunde/angebote', titel: 'Angebote',
    icon: 'angebot',
    zahl: (u) => String(u.angeboteOffen),
    satz: (u) => u.angebote === 0
      ? 'kein Angebot versendet'
      : `zur Entscheidung, ${u.angebote} insgesamt`,
  },
  {
    pfad: '/portal/kunde/objekte', titel: 'Objekte',
    icon: 'objekt',
    zahl: (u) => String(u.objekte),
    satz: () => 'Liegenschaften mit Raumbuch',
  },
  {
    pfad: '/portal/kunde/rechnungen', titel: 'Rechnungen',
    icon: 'rechnung',
    zahl: (u) => String(u.rechnungen),
    satz: (u) => u.rechnungen === 1 ? 'ein Beleg' : 'Belege, als PDF und XRechnung',
  },
  {
    pfad: '/portal/kunde/zahlungen', titel: 'Zahlungen',
    icon: 'euro',
    zahl: (u) => formatiereGeld(cent(BigInt(u.offenCent))),
    satz: (u) => u.ueberfaelligeposten === 0
      ? 'offen, nichts überfällig'
      : `offen, davon ${u.ueberfaelligeposten} überfällig`,
  },
  {
    pfad: '/portal/kunde/nachweise', titel: 'Nachweise',
    icon: 'dokument',
    zahl: (u) => String(u.nachweise),
    satz: (u) => u.nachweiseOhneGegenzeichnung === 0
      ? 'alle gegengezeichnet'
      : `davon ${u.nachweiseOhneGegenzeichnung} ohne Ihre Unterschrift`,
  },
  {
    pfad: '/portal/kunde/projekte', titel: 'Bauprojekte',
    icon: 'aufmass',
    zahl: (u) => String(u.projekte),
    satz: () => 'laufende und abgeschlossene Projekte',
  },
  {
    pfad: '/portal/kunde/reklamationen', titel: 'Reklamationen',
    icon: 'qualitaet',
    zahl: (u) => String(u.reklamationenOffen),
    satz: () => 'noch nicht abgeschlossen',
  },
  {
    pfad: '/portal/kunde/nachrichten', titel: 'Nachrichten',
    icon: 'mail',
    zahl: (u) => String(u.nachrichten),
    satz: (u) => u.nachrichtenUngelesen === 0
      ? 'alle gelesen'
      : `davon ${u.nachrichtenUngelesen} ungelesen`,
  },
  {
    pfad: '/portal/kunde/dokumente', titel: 'Dokumente',
    icon: 'dokument',
    zahl: (u) => String(u.dokumente),
    /*
     * Solange der Weg nicht geoeffnet ist, sagt die Karte das — statt „0
     * freigegeben" zu behaupten, was eine Tatsachenbehauptung waere und
     * falsch (K-18). `DOKUMENTE_ERREICHBAR` ist die eine Stelle, die sich
     * aendert, wenn O-671 beantwortet ist.
     */
    satz: () => DOKUMENTE_ERREICHBAR ? 'für Sie freigegeben' : 'Weg noch nicht geöffnet (O-671)',
  },
];

export default async function Kundenportal() {
  const ergebnis = await kundePortal('/portal/kunde', async (kontext) => {
    /*
     * Der Stichtag ist ein Berliner KALENDERTAG aus der Datenbank
     * (`app.berlin_heute()`), nicht `new Date()` im Node-Prozess: der laeuft
     * in UTC, und am 1. eines Monats um 00:30 Berliner Zeit waere „heute" der
     * Vortag — also ein Posten mehr oder weniger als ueberfaellig (K-11).
     */
    const [heute] = await kontext.abfrage<{ tag: string }>(
      `select app.berlin_heute()::text as tag`);
    return kundenUebersicht(kontext, heute?.tag ?? '2026-01-01');
  }, ZIELE.flatMap((z) => rechteFuer(z.pfad)));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Übersicht" aktiverTab="uebersicht">
        <Kopfzeile titel="Übersicht" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  /*
   * `every`, nicht `some`: eine Route verlangt ALLE ihre Leserechte
   * (`zugang.ts`). Eine leere Liste — eine Route, die kein Modulrecht fuehrt
   * — ergibt `true`, und das ist richtig: dann entscheidet die Route auf
   * andere Weise, nicht ueber ein Recht.
   */
  const sichtbar = ZIELE.filter(
    (z) => rechteFuer(z.pfad).every((r) => basis.rechte[r] === true));

  return (
    <KundenRahmen basis={basis} titel="Übersicht" aktiverTab="uebersicht">
      <Kopfzeile titel="Übersicht" />

      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Ihre Aufträge, Rechnungen und Nachweise. Alle Beträge in Euro, alle
        Zeitpunkte in Berliner Ortszeit. Das Portal ist lesend — antworten,
        melden und gegenzeichnen läuft weiterhin über Ihre Ansprechpartnerin.
      </p>

      {sichtbar.length === 0 ? (
        <p data-cse="leer" className="m-0 rounded-lg border border-line bg-surface p-s5 text-base text-text-muted">
          Für diese Anmeldung ist kein Bereich freigegeben. Ihre
          Ansprechpartnerin in der Verwaltung kann die Rechte erweitern.
        </p>
      ) : (
        <ul
          data-cse="kunden-ziele"
          className="m-0 grid list-none grid-cols-1 gap-s4 p-0 sm:grid-cols-2 xl:grid-cols-3"
        >
          {sichtbar.map((z) => (
            <li key={z.pfad}>
              <Link
                href={z.pfad}
                data-cse="kunden-ziel"
                data-ziel={z.titel}
                className="block rounded-lg border border-line bg-surface p-s5 no-underline transition-colors duration-fast hover:bg-surface-2"
              >
                <span className="flex items-center gap-s3 text-h3 text-text">
                  <Icon name={z.icon} groesse="md" />
                  {z.titel}
                </span>
                <span className="mt-s3 block cse-zahl text-h2 text-text">
                  {z.zahl(daten)}
                </span>
                <span className="mt-s1 block text-sm text-text-muted">
                  {z.satz(daten)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </KundenRahmen>
  );
}
