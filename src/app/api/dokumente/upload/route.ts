import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { MimeFehler } from '@/server/storage/mime';
import { legeAb } from '@/server/services/dokument/ablage';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/dokumente/upload` — eine mitgebrachte Datei ablegen (DOC-01,
 * DOC-03, DOC-06, TIM-10, SEC-A6).
 *
 * **Warum ein `multipart`-POST und kein Upload-Ticket.** `05-API-KARTE.md`
 * §C skizziert zwei Adressen: ein signiertes Ticket in einen
 * Quarantäne-Bucket und danach ein „Registrieren". Gebaut ist der eine Weg,
 * den es hier schon fünfmal gibt (Vergabemappe, Belegarchiv, Mahnung,
 * Eingangsrechnung, Formulareingang) — und er ist der einzige, bei dem die
 * MIME-Prüfung wirklich an den BYTES stattfindet: wer den Browser direkt in
 * den Bucket schreiben lässt, prüft danach eine Datei, die schon liegt. Die
 * Abweichung steht hier, damit sie eine Entscheidung bleibt und keine Drift.
 *
 * **Der Bereich kommt aus der SITZUNG** (Invariante 3). Das Formularfeld
 * `mandant` gibt es nicht; der Rückweg wird aus dem Slug der aktiven
 * Gesellschaft gebaut.
 *
 * **Ohne Speicher passiert NICHTS, und die Antwort sagt es** — keine halbe
 * Zeile, keine erfundene Bestätigung (CLAUDE.md, „No fake integrations").
 */
export const dynamic = 'force-dynamic';

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert : '';
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const datei = daten.get('datei');
  const speicher = waehleSpeicher();

  let slug = '';
  let dokumentId = '';
  try {
    if (!(datei instanceof File) || datei.size === 0) {
      throw new MimeFehler('Es war keine Datei dabei.', 'leer');
    }
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(sitzung, { recht: 'dokument.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const abgelegt = await legeAb(kontext, speicher, {
          kategorie: feld(daten, 'kategorie'),
          titel: feld(daten, 'titel'),
          beschreibung: feld(daten, 'beschreibung'),
          tags: feld(daten, 'tags'),
          kundeId: feld(daten, 'kunde'),
          objektId: feld(daten, 'objekt'),
          sichtbarFuerMitarbeiter: feld(daten, 'fuer_mitarbeiter') !== '',
          dateiname: datei.name,
          daten: bytes,
          behaupteterTyp: datei.type,
        });
        return { slug: m?.slug ?? '', dokumentId: abgelegt.dokumentId };
      }))) as { slug: string; dokumentId: string };
    slug = ergebnis.slug;
    dokumentId = ergebnis.dokumentId;
  } catch (fehler) {
    const heim = '/portal';
    const zurueck = feld(daten, 'zurueck');
    const seite = zurueck === '' ? heim : zurueck;
    const mit = (schluessel: string, text: string): NextResponse => NextResponse.redirect(
      internesZiel(
        `${seite}${seite.includes('?') ? '&' : '?'}fehler=${schluessel}`
        + `&meldung=${encodeURIComponent(text)}`,
        heim, anfrage),
      303);

    if (fehler instanceof NichtVerbundenFehler) {
      return mit('speicher',
        'Der Dateispeicher ist nicht verbunden. Es wurde nichts abgelegt und nichts '
        + 'angelegt — eine Zeile ohne ihre Datei wäre kein Dokument, sondern eine '
        + 'Behauptung.');
    }
    if (fehler instanceof MimeFehler) return mit('datei', fehler.message);
    const antwort = alsAntwort(fehler);
    if (antwort !== null) {
      /* Ein Dienstfehler geht als Satz auf die Seite zurück, nicht als JSON auf
         eine weisse Seite: das Formular hat kein JavaScript, und der Entwurf
         wäre sonst weg. */
      const meldung = (fehler as { message?: string }).message ?? '';
      if (zurueck !== '' && meldung !== '') return mit('eingabe', meldung);
      return antwort;
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`/portal/${slug}/dokumente/${dokumentId}?abgelegt=1`, '/portal', anfrage),
    303);
}
