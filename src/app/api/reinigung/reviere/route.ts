import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { grundAufsFormular } from '../../formular-antwort';
import {
  aendereRevier, archiviereRevier, legeRevierAn, RevierFehler, setzeRevierBezug,
  setzeRevierLeistung,
} from '@/server/services/reinigung/revier';
import { LeistungsankerFehler } from '@/server/services/dienstplan/leistungsanker';

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
 * **Vier Handlungen, eine Adresse, ein Recht.** Anlegen, ändern, archivieren
 * und — seit V-352 — die Leistungszeile setzen (`aktion=leistung`). Alle vier
 * verlangen
 * `reinigung.schreiben` — dasselbe Recht, das die RLS von `revier` verlangt
 * und das `dienste.ts` für `reinigung/revier` führt. Welche gemeint ist,
 * entscheidet `aktion`; dieselbe Bauart wie `api/objekt` und `api/crm/kunde`.
 *
 * **Bei einem Fehler geht es ZURÜCK auf das Formular, mit dem Grund.** Die
 * Portalformulare laufen ohne JavaScript; eine JSON-Antwort wäre ein
 * Sackgassenbildschirm mit geschweiften Klammern. Der Grund reist als
 * Schlüssel (`?fehler=`, V-275), nie als Satz (D-769).
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
  /* Das Feld, wie das Formular es schickt — fehlt es, fragt ein Programm (D-599). */
  const zurueckFeld = daten.get('zurueck');
  const formularZurueck = typeof zurueckFeld === 'string' && zurueckFeld !== ''
    ? zurueckFeld : undefined;
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };
  const aktion = String(daten.get('aktion') ?? 'anlegen');

  let ziel = '/portal';
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
        /*
         * **Der Bereich des Ziels kommt aus der SITZUNG** (Invariante 3; V-275
         * Nachtrag, D-773): der Slug des aktiven Mandanten, wie in
         * `api/kalkulation`. Er stand vorher in `zurueck` — ein Programm schickt
         * keines und landete nach dem Speichern auf `/portal//…`. Gelesen wird
         * VOR dem Schreiben: fehlt der Slug, ist nichts geschrieben (404).
         */
        const [aktiv] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        const bereich = aktiv.slug;

        if (aktion === 'leistung') {
          const id = wert('id');
          if (id === undefined) throw new RevierFehler('Kein Revier angegeben.', 'id_fehlt');
          /*
           * Leer heisst „ohne" (lösen). Ein Wert, der keine Kennung ist, wird
           * abgewiesen, nicht still zu `null` (V-192). Welche Zeile es gibt,
           * prüft der Dienst.
           */
          const anker = wert('auftrag_leistung') ?? null;
          if (anker !== null && !UUID.test(anker)) {
            throw new LeistungsankerFehler('leistung_unbekannt');
          }
          const { sofortGeplant } = await setzeRevierLeistung(kontext, id, anker);
          return `/portal/${bereich}/reinigung/reviere/${id}?leistung=`
            + (sofortGeplant ? 'gesetzt' : 'nachtlauf');
        }

        if (aktion === 'bezug') {
          /*
           * Boden oder Glas (V-358, O-349). Trägt die Zone Räume, rechnet der
           * Dienst sie sofort neu; die Seite sagt, welcher Fall vorliegt.
           */
          const id = wert('id');
          if (id === undefined) throw new RevierFehler('Kein Revier angegeben.', 'id_fehlt');
          const { neuGerechnet } = await setzeRevierBezug(
            kontext, id, wert('bezugsgroesse') ?? '', new Date());
          return `/portal/${bereich}/reinigung/reviere/${id}?bezug=`
            + (neuGerechnet ? 'neu_gerechnet' : 'gesetzt');
        }

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
          /* Boden oder Glas (V-358); eine fremde Angabe weist der Dienst ab. */
          bezugsgroesse: wert('bezugsgroesse'),
        };

        if (aktion === 'aendern') {
          const id = wert('id');
          if (id === undefined) throw new RevierFehler('Kein Revier angegeben.', 'id_fehlt');
          await aendereRevier(
            kontext, { id, ...felder, aktivBis: wert('aktiv_bis') }, new Date());
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
    /*
     * **Die Anmeldung zuerst** (D-766, D-769 Nr. 7): ein fehlendes Recht ist
     * die byte-gleiche 404 (AUT-06), ohne zweiten Faktor geht es auf den
     * Faktor-Schritt — keines davon wird ein Rückweg aufs Formular.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    /*
     * **Eine Abweisung geht als GRUND zurück aufs Formular** (V-275, D-773,
     * D-769): `?fehler=<grund>`, nie der Satz des Dienstes; die Seite schlägt
     * ihn in der Sprache der Sitzung nach (`REVIER_FEHLER_TEXTE`). Ohne `zurueck`
     * fragt ein Programm und bekommt `{ fehler, meldung }` mit Status (D-599).
     */
    if (fehler instanceof LeistungsankerFehler) {
      return grundAufsFormular(anfrage, {
        json: false, zurueck: formularZurueck, grund: fehler.grund,
      }) ?? NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status });
    }
    if (fehler instanceof RevierFehler) {
      return grundAufsFormular(anfrage, {
        json: false, zurueck: formularZurueck, grund: fehler.grund,
      }) ?? NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
