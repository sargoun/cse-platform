import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  aendereVeranstaltung, archiviereVeranstaltung, legeVeranstaltungAn, VeranstaltungFehler,
} from '@/server/services/security/veranstaltung-anlegen';

/**
 * `POST /api/security/veranstaltungen` — eine Veranstaltung anlegen, ändern
 * oder archivieren (V-004, SEC-08).
 *
 * **Warum diese Route fehlte.** `einsatz_quelle` kennt `veranstaltung` als
 * einen von sechs Ursprüngen; eine Zeile entstand aber ausschliesslich im
 * Seed. Damit war das ganze Veranstaltungsgeschäft der Sicherheit — die
 * Liste, das Blatt, die kurzfristige Besetzung, die Nachweislage je
 * eingeteilter Person — für ein neues Event unerreichbar.
 *
 * **Anlegen und BESETZEN sind zwei Rechte.** Diese Adresse verlangt
 * `security.schreiben`; wer danach jemanden einteilt, braucht
 * `dienstplan.schreiben` auf `/veranstaltungen/[id]/besetzung`. Das ist keine
 * Umständlichkeit: eine Vertriebskraft erfasst den Auftrag, die Wachleitung
 * besetzt ihn.
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
  const zurueck = String(daten.get('zurueck') ?? '/portal');
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };
  const aktion = String(daten.get('aktion') ?? 'anlegen');
  const bereich = zurueck.split('/')[2] ?? '';

  let ziel = zurueck;
  try {
    ziel = await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'security.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'archivieren') {
          const id = wert('id');
          if (id === undefined) {
            throw new VeranstaltungFehler('Keine Veranstaltung angegeben.', 'id_fehlt');
          }
          await archiviereVeranstaltung(kontext, id);
          return `/portal/${bereich}/security/veranstaltungen`;
        }

        const felder = {
          kundeId: String(daten.get('kunde') ?? ''),
          bezeichnung: String(daten.get('bezeichnung') ?? ''),
          beginn: String(daten.get('beginn') ?? ''),
          ende: String(daten.get('ende') ?? ''),
          objektId: wert('objekt'),
          ortText: wert('ort_text'),
          anlass: wert('anlass'),
          erwarteteBesucher: wert('besucher'),
          sollBesetzung: wert('soll_besetzung'),
          leitungAnstellungId: wert('leitung'),
          auftragLeistungId: wert('leistung'),
          dienstanweisungId: wert('dienstanweisung'),
        };

        if (aktion === 'aendern') {
          const id = wert('id');
          if (id === undefined) {
            throw new VeranstaltungFehler('Keine Veranstaltung angegeben.', 'id_fehlt');
          }
          await aendereVeranstaltung(kontext, { id, ...felder });
          return `/portal/${bereich}/security/veranstaltungen/${id}`;
        }

        const neu = await legeVeranstaltungAn(kontext, felder);
        /*
         * Nach dem Anlegen auf das BLATT und nicht auf die Liste: der naechste
         * Schritt ist immer die Besetzung, und die steht dort.
         */
        return `/portal/${bereich}/security/veranstaltungen/${neu.id}`;
      }));
  } catch (fehler) {
    if (fehler instanceof VeranstaltungFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
