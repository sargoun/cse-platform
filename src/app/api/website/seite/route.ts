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
  aendereAbschnitt, RedaktionFehler, setzeSeitenStatus,
} from '@/server/services/inhalt/redaktion';

/**
 * `POST /api/website/seite` — einen Abschnitt ändern oder eine Seite
 * veröffentlichen (PUB-07, PUB-08).
 *
 * **Zwei Handlungen mit zwei verschiedenen Rechten**, und der Unterschied ist
 * kein Formalismus: einen Text schreiben darf, wer die Website pflegt
 * (`referenz.schreiben`); ihn auf die öffentliche Seite stellen darf, wer
 * veröffentlichen darf (`referenz.veroeffentlichen`). Ein Entwurf, den niemand
 * sieht, und ein Satz auf der Startseite der GmbH sind zwei verschiedene
 * Handlungen.
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
  const handlung = String(daten.get('handlung') ?? '');
  const id = String(daten.get('id') ?? '');

  if (!['abschnitt', 'status'].includes(handlung)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  const recht = handlung === 'status' ? 'referenz.veroeffentlichen' : 'referenz.schreiben';

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
          { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (handlung === 'status') {
          await setzeSeitenStatus(kontext, id, String(daten.get('veroeffentlicht') ?? '') === '1');
          return;
        }
        /*
         * Leere Felder werden zu `null` und nicht zu `''`. Eine Überschrift,
         * die aus einer leeren Zeichenkette besteht, rendert als leeres
         * `<h2>` — ein Element ohne Inhalt, das ein Screenreader ansagt und
         * niemand sieht.
         */
        const leerZuNull = (wert: FormDataEntryValue | null): string | null => {
          const t = String(wert ?? '').trim();
          return t === '' ? null : t;
        };
        await aendereAbschnitt(kontext, id, {
          ueberschrift: leerZuNull(daten.get('ueberschrift')),
          akzentWort: leerZuNull(daten.get('akzentWort')),
          text: leerZuNull(daten.get('text')),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof RedaktionFehler) {
      return NextResponse.json({ fehler: fehler.grund }, { status: 400 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
