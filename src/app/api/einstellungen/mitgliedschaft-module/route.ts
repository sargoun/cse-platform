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
  ModulZuweisungFehler, setzeMitgliedschaftModule, zuweisungAusFormular,
} from '@/server/services/system/mitgliedschaft-module';

/**
 * `POST /api/einstellungen/mitgliedschaft-module` — die Module einer
 * Administration in dieser Gesellschaft setzen (AUT-01, V-164, D-658).
 *
 * **`system.module_zuweisen` mit zweitem Faktor, und die Datenbank fragt
 * beides noch einmal.** `app.mitgliedschaft_module_setzen` (0416) prüft
 * Mandant, `aal2`, das Recht, die Rolle `admin` und ein fremdes Konto; das
 * Tor hier ist der erste Riegel, der eine saubere Antwort gibt, statt eine
 * Datenbankausnahme hochzureichen.
 *
 * **Ein Formular bekommt seine Seite zurück, kein JSON** (D-599): der Stand
 * oder der Grund reist als `?module=` auf das Benutzerblatt, und die Seite
 * sagt ihn in Worten. Ein fehlendes Recht bleibt das 404 aller Routen
 * (AUT-06, D-656).
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
  const mitgliedschaftId = String(daten.get('mitgliedschaft') ?? '');
  const module = zuweisungAusFormular(
    String(daten.get('umfang') ?? ''),
    daten.getAll('modul').filter((m): m is string => typeof m === 'string'));
  const rueckweg = (stand: string): NextResponse => {
    const ziel = internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage);
    ziel.searchParams.set('module', stand);
    return NextResponse.redirect(ziel, 303);
  };

  try {
    const { geaendert } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.module_zuweisen', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return setzeMitgliedschaftModule(kontext, { mitgliedschaftId, module });
      })) as Promise<{ readonly geaendert: boolean }>);
    return rueckweg(geaendert ? 'module_gesetzt' : 'module_unveraendert');
  } catch (fehler) {
    if (fehler instanceof ModulZuweisungFehler) {
      /*
       * `nicht_erlaubt` ist die zweite Linie hinter `authorize` — dieselbe
       * Antwort wie dort, nicht ein Satz über das, was fehlt (AUT-06).
       */
      if (fehler.grund === 'nicht_erlaubt') {
        return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
      }
      return rueckweg(fehler.grund);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
