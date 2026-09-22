import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  aendereLieferant, archiviereLieferant, legeLieferantAn, LieferantFehler,
  setzeLieferantStatus, type LieferantStatus,
} from '@/server/services/finanz/lieferant';

/**
 * `POST /api/finanzen/lieferanten` — Lieferantenstammdaten anlegen, ändern,
 * sperren, archivieren (V-006, FIN-14, ACC-05).
 *
 * **Eine Route für vier Handlungen, weil es EIN Recht ist.** `eingang.
 * schreiben` deckt alle vier; `t_mandant` auf `lieferant` (0123) prüft es bei
 * jeder. Vier Routen mit demselben Tor wären vier Stellen, an denen es
 * irgendwann auseinanderliefe — anders als bei `/api/konto/verwaltung`, wo
 * die Handlungen tatsächlich an zwei verschiedenen Rechten hängen.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['anlegen', 'aendern', 'sperren', 'entsperren', 'archivieren'] as const;
type Aktion = typeof AKTIONEN[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : undefined;
  };
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  const id = feld('id');

  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (aktion !== 'anlegen' && (id === undefined || !UUID.test(id))) {
    return NextResponse.json({ fehler: 'keine_kennung' }, { status: 400 });
  }

  const eingabe = {
    name: feld('name') ?? '',
    strasse: feld('strasse'),
    hausnummer: feld('hausnummer'),
    plz: feld('plz'),
    ort: feld('ort'),
    land: feld('land'),
    email: feld('email'),
    telefon: feld('telefon'),
    ustId: feld('ust_id'),
    steuernummer: feld('steuernummer'),
    iban: feld('iban'),
    bic: feld('bic'),
    zahlungszielTage: feld('zahlungsziel'),
    leistungsart: feld('leistungsart'),
    istBauleistenderBis: feld('bauleistender_bis'),
  };

  let neueId: string | null = null;
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
          { recht: 'eingang.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        switch (aktion) {
          case 'anlegen': {
            const neu = await legeLieferantAn(kontext, eingabe);
            return neu.id;
          }
          case 'aendern':
            await aendereLieferant(kontext, id!, eingabe);
            return null;
          case 'sperren':
          case 'entsperren':
            await setzeLieferantStatus(
              kontext, id!,
              (aktion === 'sperren' ? 'gesperrt' : 'aktiv') as LieferantStatus);
            return null;
          case 'archivieren':
            await archiviereLieferant(kontext, id!);
            return null;
        }
      })) as Promise<string | null>);
  } catch (fehler) {
    if (fehler instanceof LieferantFehler) {
      /*
       * **Zurueck auf das Formular, nicht als JSON.** Die Portalformulare
       * laufen ohne JavaScript. Eine falsche IBAN ist die haeufigste Eingabe
       * hier, und eine weisse Seite mit geschweiften Klammern verliert dabei
       * alles, was schon getippt war — der Weg fuehrt deshalb zurueck, mit
       * dem Grund in der Adresse.
       */
      const weg = typeof daten.get('fehlerweg') === 'string'
        ? String(daten.get('fehlerweg')) : null;
      if (weg !== null && weg !== '') {
        const ziel = new URL(internesZiel(weg, '/portal', anfrage));
        ziel.searchParams.set('fehler', fehler.grund);
        return NextResponse.redirect(ziel, 303);
      }
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  const roh = String(daten.get('zurueck') ?? '/portal');
  const ziel = neueId === null ? roh : roh.replace('__ID__', neueId);
  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
