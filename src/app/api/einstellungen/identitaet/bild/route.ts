import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  MarkenbildFehler, entferneMarkenbild, istMarkenbildArt, setzeMarkenbild,
} from '@/server/services/mandant/markenbild';

/**
 * `POST /api/einstellungen/identitaet/bild` — Logo, Avatar oder Titelbild
 * setzen oder die Zuordnung wegnehmen (V-100, D-628).
 *
 * Dasselbe Recht wie die übrige Identität (`system.identitaet_verwalten`),
 * derselbe Rücksprung mit `?hinweis=` — ein Formular bekommt eine Seite mit
 * einem Satz, keine JSON-Antwort. Der Handler prüft, ruft den Dienst und
 * antwortet; welche Datei angenommen wird, entscheidet `setzeMarkenbild`.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, hinweis: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/einstellungen/identitaet`, erwarteterUrsprung(anfrage));
  url.searchParams.set('hinweis', hinweis);
  url.hash = 'bilder';
  return NextResponse.redirect(url, 303);
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
  const art = String(daten.get('art') ?? '');
  const aktion = String(daten.get('aktion') ?? 'setzen');
  if (!istMarkenbildArt(art) || (aktion !== 'setzen' && aktion !== 'entfernen')) {
    return zurueck(anfrage, 'Diese Bildart oder Handlung gibt es nicht.');
  }
  const datei = daten.get('datei');
  const alt = daten.get('alt');

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'system.identitaet_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (aktion === 'entfernen') {
          await entferneMarkenbild(kontext, art);
          return zurueck(anfrage,
            'Die Zuordnung ist entfernt. Die Datei selbst bleibt abgelegt — nichts wird gelöscht.');
        }
        if (!(datei instanceof File)) {
          throw new MarkenbildFehler('leer', 'Es wurde keine Datei mitgeschickt.');
        }
        await setzeMarkenbild(kontext, waehleSpeicher(), {
          art,
          daten: new Uint8Array(await datei.arrayBuffer()),
          alt: typeof alt === 'string' ? alt : null,
        });
        return zurueck(anfrage, 'Das Bild ist gespeichert.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /* Der Aufrufer ist ein Formular, also bekommt er eine SEITE mit dem Satz. */
    if (fehler instanceof MarkenbildFehler) return zurueck(anfrage, fehler.message);
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
}
