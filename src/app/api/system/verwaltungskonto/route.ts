import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  EINLADUNG_COOKIE, EinladungFehler, istEinladbareRolle, ladeVerwaltungskontoEin,
  type EinladungErgebnis,
} from '@/server/services/system/verwaltungskonto';
import type { VerwaltungskontoFehlerGrund }
  from '@/lib/i18n/verwaltung/einstellungen/verwaltungskonto';

/**
 * `POST /api/system/verwaltungskonto` — ein Verwaltungskonto einladen
 * (AUT-04, D-610, 0372).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Klartext des Einladungslinks geht in einen KEKS, nie in die Adresse.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Token in der URL steht im Browserverlauf, im Zugriffsprotokoll des
 * Servers und in jedem Proxy dazwischen. Der Keks lebt fünf Minuten, gilt nur
 * für DIESE Seite (`path`) und ist `httpOnly` — dasselbe Muster wie beim
 * Kundenzugang (0249) und beim Mitarbeiter-Anmeldecode (D-487). Gespeichert
 * ist ausschliesslich der SHA-256.
 *
 * **Die Rechteprüfung steht zweifach**: hier über `authorize` und noch einmal
 * in `app.verwaltungskonto_einladen` selbst. Das ist kein Überfluss — eine
 * Route, die ihr Recht nur im eigenen Rumpf kennt, ist von aussen nicht
 * prüfbar (AUT-04), und die Definer-Funktion muss auch dann halten, wenn sie
 * einmal von woanders gerufen wird (Invariante 3).
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-774): der Erfolg als
 * `?erfolg=eingeladen`, eine Abweisung als `?fehler=<grund>`. Bis dahin
 * reiste beides als `?meldung=` — der Erfolg im selben Parameter wie ein
 * Fehler, dazu ein fester Satz, der Satz von `EinladungFehler`, die deutschen
 * Sätze der Datenbank und der rohe Text JEDES einzeiligen Fehlers. Der fing
 * auch den Wurf von `authorize` ab: ein fehlendes Recht wurde
 * `?meldung=Nicht gefunden` statt der byte-gleichen 404 (AUT-06), und ein
 * Verbindungsabbruch eine erfundene Abweisung. Jetzt kommen Anmeldung und
 * Recht zuerst, und ein unbekannter Fehler bleibt ein Fehler.
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
  const mandantSlug = (daten.get('zurueck') as string | null)?.split('/')[2] ?? '';
  const seite = `/portal/${mandantSlug}/einstellungen/benutzer/einladen`;
  const keks = await cookies();

  /**
   * Zurück auf die Seite — mit genau einem Schlüssel. Eine Abweisung nimmt
   * einen Link aus einem früheren Versuch mit weg: sonst stünde er neben dem
   * Satz, der sagt, dass diesmal nichts ausgestellt wurde.
   */
  const zurSeite = (such: { readonly erfolg: 'eingeladen' } | {
    readonly fehler: VerwaltungskontoFehlerGrund;
  }): NextResponse => {
    if ('fehler' in such) keks.delete(EINLADUNG_COOKIE);
    const ziel = internesZiel(seite, '/portal', anfrage);
    for (const [k, v] of Object.entries(such)) ziel.searchParams.set(k, v);
    return NextResponse.redirect(ziel, 303);
  };

  const rolle = String(daten.get('rolle') ?? '');
  if (!istEinladbareRolle(rolle)) return zurSeite({ fehler: 'rolle_unzulaessig' });

  let ergebnis: EinladungErgebnis;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'system.verwaltungskonto_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return ladeVerwaltungskontoEin(kontext, {
          mandantId: sitzung.aktiverMandantId as string,
          email: String(daten.get('email') ?? ''),
          name: String(daten.get('name') ?? ''),
          rolle,
        });
      })) as Promise<EinladungErgebnis>);
  } catch (fehler) {
    /* Anmeldung und Recht ZUERST (D-766, AUT-06): kein Wurf von `authorize` wird ein Satz. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: daten });
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof EinladungFehler) return zurSeite({ fehler: fehler.grund });
    throw fehler;
  }

  if (!ergebnis.ok) return zurSeite({ fehler: ergebnis.grund });
  keks.set(EINLADUNG_COOKIE, ergebnis.token, {
    httpOnly: true, sameSite: 'lax', path: seite, maxAge: 300,
    secure: process.env.NODE_ENV === 'production',
  });
  return zurSeite({ erfolg: ergebnis.grund });
}
