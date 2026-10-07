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
  ModulbuchungFehler, bucheModule, gewerkeAusFormular,
} from '@/server/services/system/mandant-module';

/**
 * `POST /api/einstellungen/module` — die gebuchten Gewerke der aktiven
 * Gesellschaft eintragen (V-298, O-355, D-809).
 *
 * **`system.module_zuweisen` mit zweitem Faktor, und die Datenbank fragt
 * mehr.** `app.mandant_module_buchen` (0502) verlangt dazu eine
 * Super-Administration: das Recht ist an eine Administration bindbar, und
 * eine Gesellschaft bucht ihre Gewerke nicht selbst (O-355).
 *
 * **Zurück gehen nur Schlüssel** (V-275, D-769): `?erfolg=gebucht`,
 * `?erfolg=unveraendert` oder `?fehler=<grund>` auf Einstellungen › Module;
 * die Seite schlägt die Sätze nach. Der Slug kommt aus der SITZUNG, nie aus
 * dem Formular (Invariante 3). Ein fehlendes Recht bleibt das 404 aller
 * Routen (AUT-06).
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
  const roh = daten.getAll('gewerk').filter((g): g is string => typeof g === 'string');
  let ziel = '/portal';

  try {
    const { geaendert } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.module_zuweisen', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich !== undefined) ziel = `/portal/${bereich.slug}/einstellungen/module`;
        return bucheModule(kontext, gewerkeAusFormular(roh));
      })) as Promise<{ readonly geaendert: boolean }>);
    return zurueck(anfrage, ziel, 'erfolg', geaendert ? 'gebucht' : 'unveraendert');
  } catch (fehler) {
    if (fehler instanceof ModulbuchungFehler) {
      /* Die zweite Linie hinter `authorize` antwortet wie diese (AUT-06). */
      if (fehler.grund === 'nicht_erlaubt') {
        return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
      }
      return zurueck(anfrage, ziel, 'fehler', fehler.grund);
    }
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** 303 auf Einstellungen › Module mit genau EINEM Schlüssel — nie einem Satz. */
function zurueck(
  anfrage: NextRequest, ziel: string, name: 'erfolg' | 'fehler', schluessel: string,
): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set(name, schluessel);
  return NextResponse.redirect(adresse, 303);
}
