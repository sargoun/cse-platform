import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { grundAufsFormular } from '../../formular-antwort';
import { berlinFormularZeitpunkt } from '@/lib/datum/formularzeit';
import { erfasseZeitNach, NacherfassungFehler }
  from '@/server/services/zeit/nacherfassung';

/**
 * `POST /api/zeit/nacherfassung` — eine Arbeitszeit eintragen, zu der es kein
 * Gerätereignis gibt (V-066, V-067, TIM-09, TIM-11).
 *
 * **Warum das nicht `api/zeit/offline` ist.** Jener Weg macht aus einem
 * `offline_ereignis` einen Zeiteintrag — aus der Behauptung eines Telefons,
 * das ohne Netz war. Hier gibt es kein Ereignis: die Kraft hat gar nicht
 * gestempelt. Beides in eine Route zu legen hiesse, den Unterschied zu
 * verwischen, auf den es im Streit ankommt — ob eine Maschine oder ein Mensch
 * die Zeit behauptet hat.
 *
 * **`zeit.nacherfassung_pruefen` am Tor, `zeit.schreiben` in der Policy.** Das
 * erste ist die Entscheidung (TIM-09, dasselbe Recht wie die Seite), das
 * zweite der Schreibzugriff, den `t_mandant` ohnehin verlangt. Der Dienst
 * prüft das erste ein zweites Mal — eine Route ist kein Verlass, wenn der
 * Dienst auch von einem Job aus aufrufbar ist.
 *
 * **Die Zeiten kommen als BERLINER Wanduhrzeit** und werden über dieselbe
 * getestete Funktion aufgelöst wie beim Einwand (§7.2).
 *
 * **Eine Abweisung geht als GRUND zurück** (V-275, D-773, D-769):
 * `?fehler=<grund>` an das `zurueck` des Formulars, nie der Satz des Dienstes;
 * die Seite schlägt ihn in `NACHERFASSUNG_FEHLER_TEXTE` nach. Ein Aufruf ohne
 * `zurueck` ist ein Programm und bekommt `{ fehler, meldung }` mit Status
 * (D-599).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  /* Das Feld, wie das Formular es schickt — fehlt es, fragt ein Programm (D-599). */
  const zurueckFeld = daten.get('zurueck');
  const formularZurueck = typeof zurueckFeld === 'string' && zurueckFeld !== ''
    ? zurueckFeld : undefined;
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  const anstellung = wert('anstellung');
  if (anstellung === undefined) {
    return NextResponse.json({ fehler: 'keine_anstellung' }, { status: 400 });
  }
  const beginn = berlinFormularZeitpunkt(String(daten.get('beginn') ?? ''));
  if (beginn === null) {
    return NextResponse.json({ fehler: 'kein_beginn' }, { status: 400 });
  }
  const endeRoh = String(daten.get('ende') ?? '').trim();
  const ende = endeRoh === '' ? null : berlinFormularZeitpunkt(endeRoh);
  if (endeRoh !== '' && ende === null) {
    return NextResponse.json({ fehler: 'ende_unbrauchbar' }, { status: 400 });
  }
  const pauseRoh = wert('pause');
  const pause = pauseRoh === undefined ? undefined : Number(pauseRoh);

  let ziel = '/portal';
  try {
    ziel = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'zeit.nacherfassung_pruefen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /*
         * **Der Bereich des Ziels kommt aus der SITZUNG** (Invariante 3; V-275
         * Nachtrag, D-773): der Slug des aktiven Mandanten, wie in
         * `api/kalkulation`. Er stand vorher in `zurueck` — ein Programm schickt
         * keines und landete nach dem Speichern auf `/portal//…`. Gelesen wird
         * VOR dem Schreiben: fehlt der Slug, ist nichts geschrieben (404).
         */
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        const bereich = aktiv.slug;
        const neu = await erfasseZeitNach(kontext, {
          anstellungId: anstellung,
          beginn,
          ende,
          ...(pause === undefined ? {} : { pauseMinuten: pause }),
          ...(wert('objekt') === undefined ? {} : { objektId: wert('objekt') }),
          ...(wert('zuordnung') === undefined
            ? {} : { einsatzZuordnungId: wert('zuordnung') }),
          ...(wert('einwand') === undefined ? {} : { zeitEinwandId: wert('einwand') }),
          begruendung: String(daten.get('begruendung') ?? ''),
          benutzerId: sitzung.benutzerId,
        });
        /*
         * Auf den NEUEN Eintrag und nicht zurueck auf das Formular: wer eine
         * Zeit nacherfasst hat, will sehen, was entstanden ist — mit dem
         * Vermerk „nacherfasst" daran, der ihn ueberall begleitet.
         */
        return `/portal/${bereich}/zeiten/${neu.id}`;
      })) as Promise<string>);
  } catch (fehler) {
    /*
     * **Die Anmeldung zuerst** (D-766, D-769 Nr. 7): ein fehlendes Recht ist
     * die byte-gleiche 404 (AUT-06), ohne zweiten Faktor geht es auf den
     * Faktor-Schritt — keines davon wird ein Rückweg aufs Formular.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof NacherfassungFehler) {
      return grundAufsFormular(anfrage, {
        json: false, zurueck: formularZurueck, grund: fehler.grund,
      }) ?? NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
