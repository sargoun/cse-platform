import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { securityGebucht } from '@/server/services/security/bewacherregister';
import {
  UebergabefensterFehler, pruefeUebergabeStunden, setzeUebergabefenster,
} from '@/server/services/security/uebergabefenster';

/**
 * `POST /api/security/uebergabefenster` — das Übergabefenster des Wachbuchs
 * einstellen (V-323, O-151, SEC-05, D-808).
 *
 * **`system.einstellung_verwalten`** — das Recht, das die Policy von
 * `mandant_einstellung` für jedes Schreiben verlangt (0033). Das Fenster
 * öffnet fremde Wachbucheinträge für eine ganze Belegschaft; wer es stellt,
 * stellt eine Betriebsregel (O-06), keine Ansicht.
 *
 * **Zurück auf das Wachbuch gehen nur Schlüssel** (V-275, D-769):
 * `?erfolg=fenster_gesetzt` oder `?fehler=fenster_ausserhalb`; die Seite
 * schlägt die Sätze nach. Der Slug kommt aus der SITZUNG, nie aus dem
 * Formular (Invariante 3). Die Anmeldung und ein fehlendes Recht gehen vor
 * jedem Rückweg (D-766).
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
  const roh = daten.get('stunden');
  let ziel = '/portal';
  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'system.einstellung_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        ziel = `/portal/${aktiv.slug}/security/wachbuch`;
        /* Nicht gebucht sieht aus wie nicht vorhanden (D-377, AUT-06). */
        if (!(await securityGebucht(kontext))) {
          throw new NichtGefundenFehler('Security ist in dieser Gesellschaft nicht gebucht');
        }
        await setzeUebergabefenster(
          kontext, pruefeUebergabeStunden(typeof roh === 'string' ? roh : ''));
      }));
  } catch (fehler) {
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof UebergabefensterFehler) {
      return zurueck(anfrage, ziel, 'fehler', 'fenster_ausserhalb');
    }
    throw fehler;
  }
  return zurueck(anfrage, ziel, 'erfolg', 'fenster_gesetzt');
}

/** 303 auf das Wachbuch mit genau EINEM Schlüssel — nie einem Satz (V-275, D-769). */
function zurueck(
  anfrage: NextRequest, ziel: string, name: 'erfolg' | 'fehler', schluessel: string,
): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set(name, schluessel);
  return NextResponse.redirect(adresse, 303);
}
