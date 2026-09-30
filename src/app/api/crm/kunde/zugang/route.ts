import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  EINLADUNG_COOKIE, ZugangFehler, entzieheZugang, ladeNeuEin, stelleZugangAus,
  type ZugangErgebnis,
} from '@/server/services/crm/kundenzugang';
import { zurueckMitSchluessel } from '@/app/api/crm/rueckweg';

/**
 * `POST /api/crm/kunde/zugang` — ausstellen, neu einladen, entziehen
 * (AUT-01, AUT-04, DOC-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Klartext des Einladungslinks geht in einen KEKS, nie in die Adresse.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Token in der URL steht im Browserverlauf, im Zugriffsprotokoll des
 * Servers und in jedem Proxy dazwischen. Der Keks lebt fünf Minuten, gilt nur
 * für DIESE Seite (`path`) und ist `httpOnly` — dasselbe Muster wie beim
 * Mitarbeiter-Anmeldecode (D-487). Gespeichert ist ausschliesslich der
 * SHA-256.
 *
 * **Beim Entziehen wird der Keks GELÖSCHT.** Sonst stünde nach einem Entzug
 * noch der Link des gerade entzogenen Zugangs auf dem Bildschirm — und er
 * wäre zu diesem Zeitpunkt schon entwertet, was aussieht wie ein Fehler.
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-772): `?fehler=<grund>`,
 * `?erfolg=<schluessel>`. Hier reisten der Satz des `ZugangFehler`, der
 * deutsche `grund`-Satz der Definer (0249) und — für jeden anderen
 * einzeiligen Fehler — dessen roher Text durch die Adresse. Dieser letzte
 * Zweig lief VOR der Übersetzung der Autorisierung: ein fehlendes Recht wurde
 * „Nicht gefunden" im Warnkasten statt der byte-gleichen 404 (AUT-06), eine
 * abgelaufene Sitzung ein Satz statt der Anmeldung (D-766). Jetzt übersetzt
 * `autorisierungsAntwort` zuerst; die Abweisungen der Definer bildet der
 * Dienst auf ihren Grund ab (`grundAusDatenbank`), und jeder andere Fehler
 * bleibt ein Fehler.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const was = String(daten.get('was') ?? '');
  if (!['ausstellen', 'neu_einladen', 'entziehen'].includes(was)) {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }
  const kundeId = String(daten.get('kundeId') ?? '');
  if (!UUID.test(kundeId)) {
    return NextResponse.json({ fehler: 'unbekannte_kennung' }, { status: 404 });
  }
  const mandantSlug = (daten.get('zurueck') as string | null)?.split('/')[2] ?? '';
  const seite = `/portal/${mandantSlug}/crm/kunden/${kundeId}/zugang`;

  let ergebnis: ZugangErgebnis;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext): Promise<ZugangErgebnis> => {
        await authorize(
          sitzung, { recht: 'system.benutzer_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'ausstellen') {
          return stelleZugangAus(kontext, {
            kundeId,
            email: String(daten.get('email') ?? ''),
            name: String(daten.get('name') ?? ''),
          });
        }

        const zugangId = String(daten.get('zugangId') ?? '');
        if (!UUID.test(zugangId)) {
          throw new ZugangFehler('Diesen Zugang gibt es nicht.', 'nicht_gefunden', 404);
        }

        if (was === 'neu_einladen') return ladeNeuEin(kontext, zugangId);
        return entzieheZugang(kontext, zugangId, String(daten.get('grund') ?? ''));
      })) as Promise<ZugangErgebnis>);
  } catch (fehler) {
    /* Die Anmeldung zuerst (D-766, D-769 Nr. 7) — ein fehlendes Recht bleibt 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    /* Auch die Abweisungen der Definer — als Grund, nie als ihr Text (D-769 Nr. 8). */
    if (fehler instanceof ZugangFehler) {
      return zurueckMitSchluessel(anfrage, seite, 'fehler', fehler.grund);
    }
    throw fehler;
  }

  const keks = await cookies();
  if (ergebnis.ok && ergebnis.token !== null) {
    keks.set(EINLADUNG_COOKIE, ergebnis.token, {
      httpOnly: true, sameSite: 'lax', path: seite, maxAge: 300,
      secure: process.env.NODE_ENV === 'production',
    });
  } else {
    keks.delete(EINLADUNG_COOKIE);
  }

  /*
   * Ein Schlüssel, und der Satz dazu steht auf der Seite (`ZUGANG_RUECKWEG`):
   * „ausgestellt" allein beantwortet die nächste Frage nicht — nämlich, was
   * jetzt zu tun ist —, und das sagt der Satz dort.
   */
  return ergebnis.ok
    ? zurueckMitSchluessel(anfrage, seite, 'erfolg', ergebnis.erfolg)
    : zurueckMitSchluessel(anfrage, seite, 'fehler', ergebnis.grund);
}
