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
  EINLADUNG_COOKIE, EinladungFehler, LINK_NEU_COOKIE, istEinladbareRolle,
  ladeVerwaltungskontoEin, stelleLinkNeuAus, wechsleVerwaltungsrolle,
  type EinladungErgebnis, type LinkNeuErgebnis, type RollenwechselErgebnis,
} from '@/server/services/system/verwaltungskonto';
import type { VerwaltungskontoFehlerGrund }
  from '@/lib/i18n/verwaltung/einstellungen/verwaltungskonto';
import type { VerwaltungskontoPflegeStand }
  from '@/lib/i18n/verwaltung/einstellungen/verwaltungskonto-pflege';

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
 *
 * **Zwei weitere Aktionen am Benutzerblatt** (V-302, O-980, O-981, D-821):
 * `aktion=link_neu` stellt einen neuen Link aus (der alte verfällt),
 * `aktion=rolle` wechselt zwischen `admin` und `leitung`. Dasselbe Recht,
 * dieselbe doppelte Prüfung (0517); zurück aufs Blatt mit `?verwaltung=<stand>`,
 * der neue Link wie beim Einladen in einem Keks unter dem Pfad des Blatts.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

  const aktion = String(daten.get('aktion') ?? 'einladen');
  if (aktion === 'link_neu' || aktion === 'rolle') {
    const benutzerId = String(daten.get('benutzer') ?? '');
    if (!UUID.test(benutzerId)) {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    const blatt = `/portal/${mandantSlug}/einstellungen/benutzer/${benutzerId}`;
    /* Wie oben: genau ein Schlüssel zurück, und eine Abweisung nimmt einen alten Link mit weg. */
    const zumBlatt = (stand: VerwaltungskontoPflegeStand): NextResponse => {
      if (stand !== 'link_einladung' && stand !== 'link_kennwort') {
        keks.delete({ name: LINK_NEU_COOKIE, path: blatt });
      }
      const ziel = internesZiel(blatt, '/portal', anfrage);
      ziel.searchParams.set('verwaltung', stand);
      return NextResponse.redirect(ziel, 303);
    };
    const neueRolle = String(daten.get('rolle') ?? '');
    if (aktion === 'rolle' && !istEinladbareRolle(neueRolle)) {
      return zumBlatt('rolle_unzulaessig');
    }

    let pflege: LinkNeuErgebnis | RollenwechselErgebnis;
    try {
      pflege = await (db().begin(async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, async (kontext) => {
          await authorize(
            sitzung, { recht: 'system.verwaltungskonto_erstellen', schreibend: true },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          return istEinladbareRolle(neueRolle) && aktion === 'rolle'
            ? wechsleVerwaltungsrolle(kontext, benutzerId, neueRolle)
            : stelleLinkNeuAus(kontext, benutzerId);
        })) as Promise<LinkNeuErgebnis | RollenwechselErgebnis>);
    } catch (fehler) {
      const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: daten });
      if (autorisierung !== null) return autorisierung;
      if (fehler instanceof EinladungFehler) return zumBlatt(fehler.grund);
      throw fehler;
    }

    if (!pflege.ok) return zumBlatt(pflege.grund);
    if ('token' in pflege) {
      keks.set(LINK_NEU_COOKIE, pflege.token, {
        httpOnly: true, sameSite: 'lax', path: blatt, maxAge: 300,
        secure: process.env.NODE_ENV === 'production',
      });
      return zumBlatt(pflege.zweck === 'einladung' ? 'link_einladung' : 'link_kennwort');
    }
    return zumBlatt(pflege.grund);
  }

  /**
   * Zurück auf die Seite — mit genau einem Schlüssel. Eine Abweisung nimmt
   * einen Link aus einem früheren Versuch mit weg: sonst stünde er neben dem
   * Satz, der sagt, dass diesmal nichts ausgestellt wurde.
   *
   * **Mit dem Pfad, unter dem er gesetzt wurde.** `delete(name)` allein
   * schreibt einen Löschkeks ohne `Path`; der Browser legt ihn unter den Pfad
   * dieser Route, und der Keks unter dem Pfad der Seite bleibt stehen — so
   * löschte die Route ihn bis D-774 nie.
   */
  const zurSeite = (such: { readonly erfolg: 'eingeladen' } | {
    readonly fehler: VerwaltungskontoFehlerGrund;
  }): NextResponse => {
    if ('fehler' in such) keks.delete({ name: EINLADUNG_COOKIE, path: seite });
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
