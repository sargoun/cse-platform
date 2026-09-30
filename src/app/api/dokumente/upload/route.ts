import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { MimeFehler } from '@/server/storage/mime';
import { ExifFehler } from '@/server/storage/exif';
import { AblageFehler, BezugUnbekannt, legeAb } from '@/server/services/dokument/ablage';
import type { UploadFehlerGrund } from '@/lib/i18n/verwaltung/dokument-rueckweg';
import { alsAntwort } from '../../sicherheit/antwort';
import { grundAufsFormular } from '../../formular-antwort';

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
 *
 * **Eine Abweisung reist als GRUND, nie als Satz** (D-769, D-774). Hier stand
 * zu jedem Schlüssel ein Satz als `?meldung=` — und für jeden Fehler, den
 * `alsAntwort` annahm, ersetzte der Rückweg dessen Antwort durch
 * `?fehler=eingabe&meldung=…`: auch die Umleitung auf die Anmeldung oder den
 * Faktor-Schritt (D-766) und die byte-gleiche 404 eines fehlenden Rechts
 * (AUT-06). Jetzt kommen Anmeldung und Recht zuerst, und jede Fehlerklasse
 * der Ablage trägt ihren Grund.
 */
export const dynamic = 'force-dynamic';

/** Der Wegweiser, wenn kein `zurueck` mitkam. */
const HEIM = '/portal';

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert : '';
}

/**
 * Der Grund einer abgewiesenen Ablage — ein Schlüssel der Seite, oder `null`:
 * dann ist der Fehler keiner der Ablage. Der Typ hält Route und Satztabelle
 * beieinander: ein neuer Grund ohne Satz bricht die Übersetzung.
 */
function ablageGrund(fehler: unknown): UploadFehlerGrund | null {
  if (fehler instanceof NichtVerbundenFehler) return 'speicher';
  if (fehler instanceof MimeFehler) return `datei_${fehler.grund}`;
  /*
   * Metadaten, die sich nicht sicher entfernen lassen: TIFF, GIF, WebP, ein
   * verschlüsseltes PDF, ein Video ohne lesbaren Kopf. Kein Dienstfehler mit
   * `status`, also fiel er einst durch `alsAntwort` und endete als 500 —
   * dieselbe Lücke, die D-759 für die zweite Fassung geschlossen hat.
   */
  if (fehler instanceof ExifFehler) return 'datei_metadaten';
  if (fehler instanceof AblageFehler || fehler instanceof BezugUnbekannt) return fehler.grund;
  return null;
}

/** Der `code` eines Dienstfehlers ohne eigenen Grund (`status` und `code`), sonst `null`. */
function dienstCode(fehler: unknown): string | null {
  const { status, code } = fehler as { status?: unknown; code?: unknown };
  return typeof status === 'number' && typeof code === 'string' ? code : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
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
          /*
           * V-176 (OPS-11): der Auftrag, an dem das Dokument hängt — geprüft
           * wie Kunde und Objekt (Form, dann Sichtbarkeit unter RLS), und
           * zusätzlich vom Fremdschlüssel aus 0421 gehalten.
           */
          auftragId: feld(daten, 'auftrag'),
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
    /*
     * 1. Anmeldung und Recht ZUERST (D-766, AUT-06): ein fehlendes Recht ist
     *    die byte-gleiche 404, eine abgelaufene Sitzung die Anmeldung, ein
     *    fehlender Faktor der Faktor-Schritt — nie ein Rückweg aufs Formular.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: daten });
    if (autorisierung !== null) return autorisierung;

    const grund = ablageGrund(fehler);
    const zurueck = feld(daten, 'zurueck');
    if (zurueck !== '') {
      /*
       * 2. Das Formular bekommt seine Seite zurück, mit dem Grund — nicht als
       *    JSON auf einer weissen Seite: es hat kein JavaScript, und der
       *    Entwurf wäre sonst weg. Ein Dienstfehler ohne eigenen Grund reist
       *    mit seinem `code` (D-769 Nr. 3); die Seite hat dafür ihren
       *    allgemeinen Satz.
       */
      const schluessel = grund ?? dienstCode(fehler);
      if (schluessel !== null) {
        const rueckweg = grundAufsFormular(anfrage, { json: false, zurueck, grund: schluessel });
        if (rueckweg !== null) return rueckweg;
      }
      throw fehler;
    }
    /*
     * 3. Ohne `zurueck` antwortet die Route wie bisher: Speicher und Datei
     *    führen ins Portal, jetzt mit dem Grund und ohne Satz; ein
     *    Dienstfehler ist JSON mit Status (D-599).
     */
    if (grund !== null && !(fehler instanceof AblageFehler) && !(fehler instanceof BezugUnbekannt)) {
      return NextResponse.redirect(
        internesZiel(`${HEIM}?fehler=${encodeURIComponent(grund)}`, HEIM, anfrage), 303);
    }
    const antwort = alsAntwort(fehler, anfrage);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`/portal/${slug}/dokumente/${dokumentId}?abgelegt=1`, '/portal', anfrage),
    303);
}
