import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  aendereRevier, archiviereRevier, legeRevierAn, RevierFehler,
} from '@/server/services/reinigung/revier';

/**
 * `POST /api/reinigung/reviere` — eine Zone anlegen, ändern oder archivieren
 * (V-002, CLN-01, CLN-02, OPS-02).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum diese Route fehlte und was daran teuer war.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `revier` war lesbar, zuschneidbar (`api/reinigung/reviere/[id]/raeume`) und
 * berechenbar — nur **entstehen** konnte keine Zone. `reinigung/reviere/neu`
 * war ein Platzhalter, und die Fehlermeldung `RaumNichtEntfernbar` verwies
 * ihrerseits auf zwei Wege („neu anlegen", „archivieren"), die es beide nicht
 * gab. Damit war der gesamte Reinigungsdienstplan für neue Flächen zu: ein
 * Turnus hängt an einem Revier, ein Einsatz am Turnus, ein Leistungsnachweis
 * am Einsatz.
 *
 * **Drei Handlungen, eine Adresse, ein Recht.** Alle drei verlangen
 * `reinigung.schreiben` — dasselbe Recht, das die RLS von `revier` verlangt
 * und das `dienste.ts` für `reinigung/revier` führt. Welche gemeint ist,
 * entscheidet `aktion`; dieselbe Bauart wie `api/objekt` und `api/crm/kunde`.
 *
 * **Bei einem Fehler geht es ZURÜCK auf das Formular, mit dem Grund.** Die
 * Portalformulare laufen ohne JavaScript; eine JSON-Antwort wäre ein
 * Sackgassenbildschirm mit geschweiften Klammern.
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
  /*
   * Der Bereich kommt aus dem Rueckweg und nicht aus einem eigenen Feld: er
   * ist eine ANZEIGEadresse, kein Mandant. Der Mandant steht in der Sitzung
   * (K-02) und wurde oben schon geprueft.
   */
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
          { recht: 'reinigung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'archivieren') {
          const id = wert('id');
          if (id === undefined) throw new RevierFehler('Kein Revier angegeben.', 'id_fehlt');
          await archiviereRevier(kontext, id);
          /* Auf die LISTE: das Blatt der archivierten Zone ist jetzt leer. */
          return `/portal/${bereich}/reinigung/reviere`;
        }

        const felder = {
          bezeichnung: String(daten.get('bezeichnung') ?? ''),
          sollzeitMinuten: String(daten.get('sollzeit') ?? ''),
          kurzzeichen: wert('kurzzeichen'),
          beschreibung: wert('beschreibung'),
          aktivAb: wert('aktiv_ab'),
        };

        if (aktion === 'aendern') {
          const id = wert('id');
          if (id === undefined) throw new RevierFehler('Kein Revier angegeben.', 'id_fehlt');
          await aendereRevier(kontext, { id, ...felder, aktivBis: wert('aktiv_bis') });
          return `/portal/${bereich}/reinigung/reviere/${id}`;
        }

        const objektId = wert('objekt');
        if (objektId === undefined) {
          throw new RevierFehler(
            'Ein Revier gehört zu einem Objekt — bitte eines auswählen.', 'objekt_fehlt');
        }
        const neu = await legeRevierAn(kontext, { ...felder, objektId });
        /*
         * Nach dem Anlegen auf das RAUMBUCH der Zone und nicht auf die Liste:
         * eine Zone ohne Raeume hat eine handgesetzte Sollzeit und keine
         * gerechnete — der naechste Schritt ist immer derselbe.
         */
        return `/portal/${bereich}/reinigung/reviere/${neu.id}/raeume`;
      }));
  } catch (fehler) {
    if (fehler instanceof RevierFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
