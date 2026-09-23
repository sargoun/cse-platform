import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  KANAELE, NachrichtFehler, ZWECKE, schreibeAnKontakt, type Kanal, type Zweck,
} from '@/server/services/crm/nachricht-an-kontakt';
import { RechtsgrundlageFehlt, FreigabeErforderlich } from '@/server/agent/policy';

/**
 * `POST /api/crm/nachrichten` — eine Nachricht an einen Kontakt (V-101,
 * CRM-08, Invariante 7, D-627).
 *
 * Der Endpunkt, den das Kontaktblatt seit je als „nicht gebaut" benannte.
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, zurück. Die Reihenfolge
 * — UWG-Tor, Versender, Freigabe, `gate()`, Versand — steht im Dienst und
 * nirgends sonst.
 *
 * **`crm.kommunikation_versenden`** — das Recht steht seit `0008` im Katalog,
 * an super_admin, admin und leitung gebunden, und wurde bis hierher von keiner
 * Route benutzt.
 *
 * **Formularweg, also Rücksprung mit `?fehler=`** (D-562): eine JSON-Antwort
 * wäre eine weisse Seite mit einem Fehlerobjekt darauf, und der geschriebene
 * Text wäre weg.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'crm.kommunikation_versenden';
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const zurueckWeg = feld('zurueck');
  const zurueck = (schluessel: string | null): NextResponse => {
    const ziel = new URL(internesZiel(
      zurueckWeg === '' ? '/portal' : zurueckWeg, '/portal', anfrage));
    if (schluessel === null) ziel.searchParams.set('gesendet', '1');
    else ziel.searchParams.set('fehler', schluessel);
    ziel.hash = 'senden';
    return NextResponse.redirect(ziel, 303);
  };

  const kontakt = feld('ansprechpartner');
  const kanal = feld('kanal') as Kanal;
  const zweck = feld('zweck') as Zweck;
  if (!UUID.test(kontakt) || !KANAELE.includes(kanal) || !ZWECKE.includes(zweck)) {
    return zurueck('ungueltig');
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await schreibeAnKontakt(kontext, {
          ansprechpartnerId: kontakt,
          kanal,
          zweck,
          betreff: feld('betreff') === '' ? null : feld('betreff'),
          text: feld('text'),
        });
      }));
  } catch (fehler: unknown) {
    if (fehler instanceof NachrichtFehler) return zurueck(fehler.grund);
    if (fehler instanceof RechtsgrundlageFehlt) return zurueck('keine_grundlage');
    if (fehler instanceof FreigabeErforderlich) return zurueck('freigabe');
    throw fehler;
  }

  return zurueck(null);
}
