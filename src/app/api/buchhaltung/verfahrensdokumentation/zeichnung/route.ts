import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { alleJobs } from '@/server/jobs/bootstrap';
import {
  auslieferungAusUmgebung, erstelleVerfahrensdokumentation,
} from '@/server/services/buchhaltung/verfahrensdokumentation';
import {
  ZeichnungFehler, fassungVon, zeichne,
} from '@/server/services/buchhaltung/verfahrensdokumentation-zeichnung';
import { WirtschaftsjahrFehler } from '@/server/services/buchhaltung/wirtschaftsjahr';

/**
 * `POST /api/buchhaltung/verfahrensdokumentation/zeichnung` — die
 * Verfahrensdokumentation in ihrer jetzigen Fassung zeichnen (V-316, O-188,
 * D-837).
 *
 * **Gezeichnet wird, was in DIESER Transaktion entsteht.** Die Route erzeugt
 * die Dokumentation neu und gibt ihren Hash und Schemastand an `zeichne` —
 * unter `repeatable read` (`SCHNAPPSCHUSS`): die Dokumentation entsteht aus
 * vielen Abfragen, und unter `read committed` könnte eine Änderung zwischen
 * zwei davon einen Hash über einen Stand ergeben, den es so nie gab. Das
 * Formular schickt Funktion, Bemerkung und den Hash, den der Mensch gesehen
 * hat (`fassung`); weicht er von der erzeugten Fassung ab, wird nichts
 * gezeichnet (`fassung_geaendert`). Gezeichnet wird nie der Hash aus dem
 * Formular, nur die erzeugte Fassung, die ihm gleicht.
 *
 * `buchhaltung_konfiguration.verwalten` prüft `authorize` (mit zweitem
 * Faktor) und noch einmal die Policy `t_vdz_zeichnen` (0526). Zurück geht nur
 * ein Schlüssel (V-275, D-769): `?zeichnung=<schlüssel>`. Ein fehlendes Recht
 * bleibt das 404 aller Routen (AUT-06).
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
  const funktion = daten.get('funktion');
  const bemerkung = daten.get('bemerkung');
  const gesehen = daten.get('fassung');
  let ziel = '/portal';

  try {
    const jobs = alleJobs(db());
    await db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'buchhaltung_konfiguration.verwalten', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv !== undefined) ziel = `/portal/${aktiv.slug}/buchhaltung/verfahrensdokumentation`;
        const doku = await erstelleVerfahrensdokumentation(
          kontext, { jobs, auslieferung: auslieferungAusUmgebung() });
        return zeichne(kontext, fassungVon(doku), {
          funktion: typeof funktion === 'string' ? funktion : '',
          bemerkung: typeof bemerkung === 'string' ? bemerkung : null,
          gesehen: typeof gesehen === 'string' ? gesehen : '',
        });
      }));
    return zurueck(anfrage, ziel, 'gezeichnet');
  } catch (fehler) {
    if (fehler instanceof ZeichnungFehler) return zurueck(anfrage, ziel, fehler.grund);
    if (fehler instanceof WirtschaftsjahrFehler) return zurueck(anfrage, ziel, 'wirtschaftsjahr');
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}

/** 303 auf die Verfahrensdokumentation mit genau EINEM Schlüssel (V-275, D-769). */
function zurueck(anfrage: NextRequest, ziel: string, schluessel: string): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set('zeichnung', schluessel);
  adresse.hash = 'zeichnung';
  return NextResponse.redirect(adresse, 303);
}
