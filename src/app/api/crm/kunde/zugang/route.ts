import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  EINLADUNG_COOKIE, ZugangFehler, entzieheZugang, ladeNeuEin, stelleZugangAus,
} from '@/server/services/crm/kundenzugang';

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
 */
export const dynamic = 'force-dynamic';

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

  let ergebnis: { ok: boolean; grund: string; token: string | null };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'system.benutzer_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'ausstellen') {
          const r = await stelleZugangAus(kontext, {
            kundeId,
            email: String(daten.get('email') ?? ''),
            name: String(daten.get('name') ?? ''),
          });
          return { ok: r.ok, grund: r.grund, token: r.token };
        }

        const zugangId = String(daten.get('zugangId') ?? '');
        if (!UUID.test(zugangId)) {
          throw new ZugangFehler('Diesen Zugang gibt es nicht.', 'nicht_gefunden', 404);
        }

        if (was === 'neu_einladen') {
          const r = await ladeNeuEin(kontext, zugangId);
          return { ok: r.ok, grund: r.grund, token: r.token };
        }

        const r = await entzieheZugang(
          kontext, zugangId, String(daten.get('grund') ?? ''));
        return {
          ok: r.ok,
          grund: r.ok
            ? `Der Zugang ist entzogen${r.sitzungen === 0 ? '' : `, ${
              r.sitzungen === 1 ? 'eine laufende Sitzung' : `${String(r.sitzungen)} laufende Sitzungen`
            } wurden beendet`}. Die Zeile bleibt stehen.`
            : r.grund,
          token: null,
        };
      })) as Promise<{ ok: boolean; grund: string; token: string | null }>);
  } catch (fehler) {
    if (fehler instanceof ZugangFehler) {
      return NextResponse.redirect(internesZiel(
        `${seite}?meldung=${encodeURIComponent(fehler.message)}`, '/portal', anfrage), 303);
    }
    /*
     * Die Definer-Funktionen werfen `insufficient_privilege` mit deutschem
     * Text (fehlendes Recht, fehlender zweiter Faktor, Gruppenansicht). Den
     * rohen Fehler weiterzuwerfen hiesse „Da ist etwas schiefgegangen" für
     * eine Lage, deren Grund die Datenbank gerade genannt hat.
     */
    const text = (fehler as { message?: string }).message ?? '';
    if (text !== '' && !text.includes('\n')) {
      return NextResponse.redirect(internesZiel(
        `${seite}?meldung=${encodeURIComponent(text)}`, '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
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
   * Die Definer antworten mit einem SCHLUESSEL (`ausgestellt`, `eingeladen`),
   * nicht mit einem Satz. Der Satz gehoert hierher: er steht auf dem
   * Bildschirm eines Menschen, und „ausgestellt" allein beantwortet die
   * naechste Frage nicht — naemlich, was jetzt zu tun ist.
   */
  const SATZ: Readonly<Record<string, string>> = {
    ausgestellt: 'Der Zugang ist ausgestellt. Der Einladungslink steht oben — einmal, '
      + 'und er wird von Hand übergeben.',
    eingeladen: 'Ein frischer Einladungslink steht oben. Der vorherige ist damit '
      + 'verfallen.',
  };
  const schluessel = ergebnis.ok ? 'erfolg' : 'meldung';
  const satz = ergebnis.ok ? SATZ[ergebnis.grund] ?? ergebnis.grund : ergebnis.grund;
  return NextResponse.redirect(internesZiel(
    `${seite}?${schluessel}=${encodeURIComponent(satz)}`, '/portal', anfrage), 303);
}
