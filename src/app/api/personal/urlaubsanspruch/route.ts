import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { MengeFehler, mengeAusEingabe } from '@/server/services/finanz/menge';
import {
  eroeffneUrlaubskonto, setzeAnspruch,
  UrlaubsanspruchOffenFehler, UrlaubsjahrAbgeschlossenFehler,
} from '@/server/services/zeit/urlaubskonto';

/**
 * `POST /api/personal/urlaubsanspruch` — die Urlaubstage aus dem
 * Arbeitsvertrag nachtragen (V-117, V-118, EMP-05, § 3 BUrlG).
 *
 * **Der Befund kam von einer Sperrklinke, nicht von einem Menschen.**
 * `tests/kern/dienst-verdrahtung.test.ts` fragt, ob jede schreibende
 * Dienstfunktion einen Aufrufer hat; `eroeffneUrlaubskonto` hatte ausser
 * Tests keinen und `setzeAnspruch` überhaupt keinen. Beide sind seit `0061`
 * fertig — der Anspruch, gegen den jeder Urlaubsantrag rechnet, liess sich
 * nirgends eintragen.
 *
 * **Die Plattform LEITET den Anspruch nicht her.** Wie viele Urlaubstage eine
 * Anstellung hat, steht im Arbeitsvertrag; die zwanzig Werktage des § 3 BUrlG
 * sind das gesetzliche MINDESTMASS und fast nie die vereinbarte Zahl. Eine
 * hergeleitete Zahl sähe aus wie eine vereinbarte und würde zur Grundlage
 * eines Restanspruchs, den niemand zugesagt hat (O-18). Ein Mensch trägt sie
 * ein, und dass er es war, steht in `geaendert_von`.
 *
 * **Das Konto wird mit angelegt, wenn es fehlt.** Der Nachtlauf
 * `urlaubskonten_jahr` öffnet es; wer den Vertrag am Tag der Einstellung
 * einträgt, ist schneller als der Lauf. `eroeffneUrlaubskonto` ist idempotent
 * — zweimal geöffnet ist einmal geöffnet.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const anstellungId = text('anstellung');
  const jahrRoh = text('jahr');
  const anspruchRoh = text('anspruch');
  const uebertragRoh = text('uebertrag');
  const verfaelltAm = text('verfaellt_am');
  const zusatzRoh = text('zusatz');

  if (anstellungId === null || !UUID.test(anstellungId)) {
    return NextResponse.json({ fehler: 'keine_anstellung' }, { status: 400 });
  }
  if (jahrRoh === null || !/^\d{4}$/u.test(jahrRoh)) {
    return NextResponse.json({ fehler: 'kein_jahr' }, { status: 400 });
  }
  if (anspruchRoh === null) {
    return NextResponse.json({ fehler: 'kein_anspruch' }, { status: 400 });
  }
  if (verfaelltAm !== null && !DATUM.test(verfaelltAm)) {
    return NextResponse.json({ fehler: 'kein_datum' }, { status: 400 });
  }
  const jahr = Number(jahrRoh);

  const fehlerweg = text('fehlerweg');
  const zurueckAuf = (grund: string): NextResponse | null => {
    if (fehlerweg === null) return null;
    const ziel = new URL(internesZiel(fehlerweg, '/portal', anfrage));
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'zeit.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /*
         * Erst oeffnen, dann setzen. `eroeffneUrlaubskonto` ist idempotent;
         * `setzeAnspruch` wirft ohne Konto. Die Reihenfolge macht den Weg
         * unabhaengig davon, ob der Nachtlauf schon durch war.
         */
        await eroeffneUrlaubskonto(kontext, { anstellungId, jahr });
        await setzeAnspruch(kontext, {
          anstellungId,
          jahr,
          anspruchTage: mengeAusEingabe(anspruchRoh),
          ...(uebertragRoh === null ? {} : { uebertragTage: mengeAusEingabe(uebertragRoh) }),
          uebertragVerfaelltAm: verfaelltAm,
          ...(zusatzRoh === null ? {} : { zusatzTage: mengeAusEingabe(zusatzRoh) }),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof MengeFehler) {
      return zurueckAuf('menge_unlesbar')
        ?? NextResponse.json({ fehler: 'menge_unlesbar', meldung: fehler.message },
                             { status: 400 });
    }
    if (fehler instanceof UrlaubsjahrAbgeschlossenFehler) {
      return zurueckAuf('jahr_abgeschlossen')
        ?? NextResponse.json({ fehler: 'jahr_abgeschlossen' }, { status: 409 });
    }
    if (fehler instanceof UrlaubsanspruchOffenFehler) {
      return zurueckAuf('kein_konto')
        ?? NextResponse.json({ fehler: 'kein_konto' }, { status: 404 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
