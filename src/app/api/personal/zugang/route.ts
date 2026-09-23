import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  ZugangFehler, aendereZugangsnummer, entsperreZugang, richteZugangEin, sperreZugang,
} from '@/server/services/personal/zugang';

/**
 * `POST /api/personal/zugang` — den Telefonzugang einer Mitarbeiterin
 * einrichten, umschreiben, sperren oder entsperren (V-014, EMP-01, EMP-14).
 *
 * **Ein Recht für alle vier, und das ist hier richtig.**
 * `personal.zugang_verwalten` deckt schon das Ausstellen des Anmeldecodes
 * (`/api/personal/zugang-code`), den Zugangsstand (`app.zugang_stand`) und
 * die Seite, auf der beides steht. Es ist dieselbe Personalstelle, die die
 * Nummer entgegennimmt und den verlorenen Zugang anhält — anders als bei der
 * Ausgabe, wo Erfassen und Entscheiden zwei verschiedene Handlungen sind.
 *
 * **Das Sperren ist der Notknopf und braucht deshalb keinen zweiten
 * Schlüssel.** Ein verlorenes Diensttelefon wird gemeldet, während jemand im
 * Treppenhaus steht; eine Sperre, die auf ein zweites Augenpaar wartet, ist
 * eine Sperre, die zu spät kommt. Ob umgekehrt das UMSCHREIBEN der Nummer
 * vier Augen braucht, ist offen (O-86) und wird hier nicht erfunden — die
 * Seite sagt, dass jede Änderung im Protokoll steht.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['einrichten', 'nummer_aendern', 'sperren', 'entsperren'] as const;
type Aktion = typeof AKTIONEN[number];

const RECHT = 'personal.zugang_verwalten';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function zurueck(anfrage: NextRequest, daten: FormData, hinweis: string | null): NextResponse {
  const roh = String(daten.get('zurueck') ?? '/portal');
  const ziel = new URL(internesZiel(roh, '/portal', anfrage));
  if (hinweis !== null) ziel.searchParams.set('fehler', hinweis);
  else ziel.searchParams.set('erledigt', '1');
  return NextResponse.redirect(ziel, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  const person = feld('person');

  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (!UUID.test(person)) {
    return NextResponse.json({ fehler: 'keine_kennung' }, { status: 400 });
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        switch (aktion) {
          case 'einrichten':
            await richteZugangEin(kontext, person, feld('telefon'));
            return;
          case 'nummer_aendern':
            await aendereZugangsnummer(kontext, person, feld('telefon'));
            return;
          case 'sperren':
            await sperreZugang(kontext, person, feld('grund'));
            return;
          case 'entsperren':
            await entsperreZugang(kontext, person);
            return;
        }
      })));
  } catch (fehler) {
    if (fehler instanceof ZugangFehler) return zurueck(anfrage, daten, fehler.grund);
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return zurueck(anfrage, daten, null);
}
