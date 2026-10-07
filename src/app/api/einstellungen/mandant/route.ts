import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { erwarteterUrsprung, istGleicherUrsprung } from '@/server/auth/ursprung';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import {
  AngabenFehler, bestaetigeAngaben, pruefeAngaben, setzeAngaben,
} from '@/server/services/mandant/angaben';
import { mitHinweis } from '@/server/rueckmeldung/hinweis-keks';
import { portalPfad, slugDesAktivenMandanten } from '@/server/auth/aktiver-slug';

/**
 * `POST /api/einstellungen/mandant` — die Angaben einer Gesellschaft pflegen
 * oder bestätigen (V-390, D-804, TEN-01, TEN-09).
 *
 * **`system.mandant_verwalten` mit zweitem Faktor, und die Datenbank fragt
 * beides noch einmal** (`app.mandant_angaben_setzen`, 0494). Das Tor hier ist
 * der erste Riegel, der eine saubere Antwort gibt; ein fehlendes Recht bleibt
 * das 404 aller Routen (AUT-06).
 *
 * `aktion=bestaetigen` setzt nur den Zeitpunkt der Bestätigung; jede andere
 * Absendung prüft und schreibt die Angaben. Der Handler bleibt dünn: prüfen,
 * den Dienst rufen, mit dem Satz auf die Seite zurück (D-599, V-277).
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, slug: string, hinweis: string): NextResponse {
  const url = new URL(portalPfad(slug, `/einstellungen/mandant`), erwarteterUrsprung(anfrage));
  return mitHinweis(NextResponse.redirect(url, 303), url, hinweis);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }
  const slug = await slugDesAktivenMandanten(sitzung);

  const daten = await anfrage.formData();
  const lies = (feld: string): string | null => {
    const wert = daten.get(feld);
    return typeof wert === 'string' ? wert : null;
  };
  const bestaetigen = lies('aktion') === 'bestaetigen';

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'system.mandant_verwalten', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (bestaetigen) {
          await bestaetigeAngaben(kontext);
          return zurueck(anfrage, slug,
            'Die Angaben sind bestätigt. Impressum, Profil und Rechnungen führen sie '
            + 'jetzt ohne den Hinweis „nicht bestätigt".');
        }
        const geaendert = await setzeAngaben(kontext, pruefeAngaben(lies));
        return zurueck(anfrage, slug, geaendert
          ? 'Die Angaben sind gespeichert und stehen im Protokoll. Sie gelten als nicht '
            + 'bestätigt, bis sie jemand bestätigt; festgeschriebene Rechnungen ändern sich nicht.'
          : 'Unverändert — es gab nichts zu speichern.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof AngabenFehler) {
      /* Die zweite Linie hinter `authorize` antwortet wie die erste (AUT-06). */
      if (fehler.grund === 'nicht_erlaubt' || fehler.grund === 'nicht_gefunden') {
        return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
      }
      return zurueck(anfrage, slug, fehler.message);
    }
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
