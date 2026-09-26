import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  aendereProjekt, archiviereProjekt, legeProjektAn, ProjektFehler,
} from '@/server/services/bau/projekt';

/**
 * `POST /api/bau/projekte` — ein Bauvorhaben anlegen, ändern oder archivieren
 * (V-003, OPS-05, BAU-01).
 *
 * **Warum diese Route fehlte und was daran teuer war.** Zwanzig gebaute
 * Projektseiten — Leistungsverzeichnis, Aufmass, Nachträge, Bautagebuch,
 * Behinderungsanzeige, Abnahme — hingen an einer Zeile, die ausschliesslich
 * im Seed entstand. Für ein neues Vorhaben war der gesamte Bauteil der
 * Plattform unerreichbar.
 *
 * **Drei Handlungen, eine Adresse, ein Recht** (`bau.schreiben`), wie bei
 * `api/objekt` und `api/reinigung/reviere`.
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
          { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'archivieren') {
          const id = wert('id');
          if (id === undefined) throw new ProjektFehler('Kein Projekt angegeben.', 'id_fehlt');
          await archiviereProjekt(kontext, id);
          return `/portal/${bereich}/bau/projekte`;
        }

        const felder = {
          bezeichnung: String(daten.get('bezeichnung') ?? ''),
          art: String(daten.get('art') ?? ''),
          vertragsgrundlage: String(daten.get('vertragsgrundlage') ?? ''),
          sollBeginn: wert('soll_beginn'),
          sollEnde: wert('soll_ende'),
          verantwortlichBenutzerId: wert('verantwortlich'),
          sicherheitseinbehaltBp: wert('einbehalt_bp'),
          auftragssummeNettoCent: wert('summe_cent'),
        };

        if (aktion === 'aendern') {
          const id = wert('id');
          if (id === undefined) throw new ProjektFehler('Kein Projekt angegeben.', 'id_fehlt');
          await aendereProjekt(kontext, {
            id, ...felder,
            status: wert('status'),
            istBeginn: wert('ist_beginn'),
            istEnde: wert('ist_ende'),
            gewaehrleistungBis: wert('gewaehrleistung_bis'),
          });
          return `/portal/${bereich}/bau/projekte/${id}`;
        }

        const auftragId = wert('auftrag');
        if (auftragId === undefined) {
          throw new ProjektFehler(
            'Ein Bauprojekt ist die Bauakte eines Auftrags — bitte den Auftrag wählen.',
            'auftrag_fehlt');
        }
        const neu = await legeProjektAn(kontext, { ...felder, auftragId });
        /*
         * Nach dem Anlegen auf das LEISTUNGSVERZEICHNIS: ein Vorhaben ohne LV
         * hat keine Position, gegen die ein Aufmass laufen koennte — der
         * naechste Schritt ist immer derselbe.
         */
        return `/portal/${bereich}/bau/projekte/${neu.id}/lv`;
      }));
  } catch (fehler) {
    if (fehler instanceof ProjektFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
