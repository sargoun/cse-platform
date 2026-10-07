import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  SicherheitskontaktFehler, setzeSicherheitskontakt,
} from '@/server/services/inhalt/sicherheitskontakt';

/**
 * `POST /api/einstellungen/sicherheitskontakt` — den Sicherheitskontakt der
 * Plattform für `/.well-known/security.txt` eintragen (V-392, O-35, D-809).
 *
 * **`system.einstellung_verwalten` mit zweitem Faktor, und die Datenbank
 * verlangt dazu eine Super-Administration** (`app.sicherheitskontakt_setzen`,
 * 0503): die Angabe gilt für die ganze Plattform, nicht für eine
 * Gesellschaft. Leer heißt „kein Postfach" — die Datei antwortet wieder 404.
 *
 * **Zurück geht nur ein Schlüssel** (V-275, D-769):
 * `?sicherheitskontakt=<schlüssel>` auf Einstellungen › Betrieb. Ein
 * fehlendes Recht bleibt das 404 aller Routen (AUT-06).
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert : '';
  };
  let ziel = '/portal';

  try {
    const { geaendert } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.einstellung_verwalten', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv !== undefined) ziel = `/portal/${aktiv.slug}/einstellungen/betrieb`;
        return setzeSicherheitskontakt(kontext, {
          kontakt: feld('kontakt'), richtlinie: feld('richtlinie'),
        });
      })) as Promise<{ readonly geaendert: boolean }>);
    return zurueck(anfrage, ziel, geaendert ? 'gesetzt' : 'unveraendert');
  } catch (fehler) {
    if (fehler instanceof SicherheitskontaktFehler) {
      if (fehler.grund === 'nicht_erlaubt') {
        return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
      }
      return zurueck(anfrage, ziel, fehler.grund);
    }
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** 303 auf Einstellungen › Betrieb mit genau EINEM Schlüssel (V-275, D-769). */
function zurueck(anfrage: NextRequest, ziel: string, schluessel: string): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set('sicherheitskontakt', schluessel);
  adresse.hash = 'sicherheitskontakt';
  return NextResponse.redirect(adresse, 303);
}
