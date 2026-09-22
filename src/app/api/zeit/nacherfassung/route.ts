import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
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
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const zurueck = String(daten.get('zurueck') ?? '/portal');
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

  let neueId = '';
  try {
    neueId = await (db().begin(async (tx: postgres.TransactionSql) =>
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
        return neu.id;
      })) as Promise<string>);
  } catch (fehler) {
    if (fehler instanceof NacherfassungFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }

  /*
   * Auf den NEUEN Eintrag und nicht zurueck auf das Formular: wer eine Zeit
   * nacherfasst hat, will sehen, was entstanden ist — mit dem Vermerk
   * „nacherfasst" daran, der ihn ueberall begleitet.
   */
  const bereich = zurueck.split('/')[2] ?? '';
  return NextResponse.redirect(internesZiel(
    `/portal/${bereich}/zeiten/${neueId}`, '/portal', anfrage), 303);
}
