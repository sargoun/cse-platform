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
  LeistungsortRegelFehler, pruefeLeistungsortArt, setzeLeistungsortRegel,
} from '@/server/services/finanz/leistungsort-regel';

/**
 * `POST /api/einstellungen/rechnungen` — die Regel zum Leistungsort setzen
 * (V-373, O-933, D-836).
 *
 * `system.einstellung_verwalten` prüft `authorize` und noch einmal die
 * Policy auf `mandant_einstellung` (0033). Gelesen und befolgt wird die Regel
 * beim Anlegen und Ändern eines Entwurfs (`leistungsort-regel.ts`).
 *
 * **Zurück geht nur ein Schlüssel** (V-275, D-769):
 * `?leistungsort=<schlüssel>` auf Einstellungen › Rechnungen. Ein fehlendes
 * Recht bleibt das 404 aller Routen (AUT-06).
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
  const roh = daten.get('art');
  let ziel = '/portal';

  try {
    const { geaendert } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.einstellung_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv !== undefined) ziel = `/portal/${aktiv.slug}/einstellungen/rechnungen`;
        const art = pruefeLeistungsortArt(typeof roh === 'string' ? roh : '');
        return setzeLeistungsortRegel(kontext, art);
      })) as Promise<{ readonly geaendert: boolean }>);
    return zurueck(anfrage, ziel, geaendert ? 'gesetzt' : 'unveraendert');
  } catch (fehler) {
    if (fehler instanceof LeistungsortRegelFehler) {
      return zurueck(anfrage, ziel, fehler.grund);
    }
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** 303 auf Einstellungen › Rechnungen mit genau EINEM Schlüssel (V-275, D-769). */
function zurueck(anfrage: NextRequest, ziel: string, schluessel: string): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set('leistungsort', schluessel);
  adresse.hash = 'leistungsort';
  return NextResponse.redirect(adresse, 303);
}
