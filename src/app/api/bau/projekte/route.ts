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
          { recht: 'bau.schreiben', schreibend: true },
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
     * ihn in der Sprache der Sitzung nach (`PROJEKT_FEHLER_TEXTE`). Ohne `zurueck`
     * fragt ein Programm und bekommt `{ fehler, meldung }` mit Status (D-599).
     */
    if (fehler instanceof ProjektFehler) {
      return grundAufsFormular(anfrage, {
        json: false, zurueck: formularZurueck, grund: fehler.grund,
      }) ?? NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
