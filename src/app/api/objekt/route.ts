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
  aendereObjekt, archiviereObjekt, legeObjektAn, ObjektFehler,
} from '@/server/services/objekt/anlegen';

/**
 * `POST /api/objekt` — ein Objekt anlegen, ändern oder archivieren
 * (OPS-01, V-001, V-020).
 *
 * **Eine Route für drei Handlungen, wie bei `api/crm/kunde`.** Alle drei
 * verlangen dasselbe Recht `objekt.schreiben` und entstehen aus Formularen
 * derselben Fläche; drei Routen wären drei Stellen, an denen dieses Recht
 * steht — und die dritte ist die, die beim nächsten Umbau vergessen wird.
 * Welche Handlung gemeint ist, entscheidet das Feld `aktion`.
 *
 * **Bei einem Fehler geht es ZURÜCK auf das Formular, mit dem Grund.** Die
 * Portalformulare haben kein JavaScript; eine JSON-Antwort wäre hier
 * derselbe Fehler wie auf der öffentlichen Angebotsanfrage (D-599), nur dass
 * ihn ein Kollege sieht statt eines Kunden.
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
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };
  const aktion = String(daten.get('aktion') ?? 'anlegen');

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
          { recht: 'objekt.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const bereich = zurueck.split('/')[2] ?? '';

        if (aktion === 'archivieren') {
          const id = wert('id');
          if (id === undefined) {
            throw new ObjektFehler('Kein Objekt angegeben.', 'id_fehlt');
          }
          await archiviereObjekt(kontext, id);
          /* Nach dem Archivieren auf die LISTE: das Blatt daneben ist leer. */
          return `/portal/${bereich}/objekte`;
        }

        const felder = {
          bezeichnung: String(daten.get('bezeichnung') ?? ''),
          strasse: String(daten.get('strasse') ?? ''),
          plz: String(daten.get('plz') ?? ''),
          ort: String(daten.get('ort') ?? ''),
          hausnummer: wert('hausnummer'),
          adresszusatz: wert('adresszusatz'),
          land: wert('land'),
          kundeId: wert('kundeId'),
          gebaeudetyp: wert('gebaeudetyp'),
          etagenAnzahl: wert('etagenAnzahl'),
          zutrittHinweis: wert('zutrittHinweis'),
          bemerkung: wert('bemerkung'),
          /* V-170: als Text weitergereicht — geprüft wird im Dienst. */
          geoLat: wert('geoLat'),
          geoLon: wert('geoLon'),
        };

        if (aktion === 'aendern') {
          const id = wert('id');
          if (id === undefined) {
            throw new ObjektFehler('Kein Objekt angegeben.', 'id_fehlt');
          }
          await aendereObjekt(kontext, { id, ...felder });
          return `/portal/${bereich}/objekte/${id}`;
        }

        const neu = await legeObjektAn(kontext, {
          ...felder, objektnummer: wert('objektnummer'),
        });
        /*
         * Nach dem Anlegen auf das OBJEKT und nicht zurueck auf das leere
         * Formular: wer gerade ein Objekt angelegt hat, will als naechstes
         * sein Raumbuch fuellen — und nicht pruefen muessen, ob es geklappt
         * hat.
         */
        return `/portal/${bereich}/objekte/${neu.id}`;
      }));
  } catch (fehler) {
    if (fehler instanceof ObjektFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      /*
       * Der SCHLÜSSEL geht mit (V-170): die Seite übersetzt ihn in die Sprache
       * der Sitzung. Trägt der Grund eine Zahl (`einsaetze_offen`), reist die
       * ZAHL mit und die Seite bildet den Satz selbst (V-240) — vorher reiste
       * der deutsche Satz als `?meldung=` und stand so auch in der englischen
       * Oberfläche, und ein Warnkasten zeigte Text aus der Adresse (V-153).
       */
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}fehler=${encodeURIComponent(fehler.grund)}`
        + (fehler.anzahl === null ? '' : `&anzahl=${String(fehler.anzahl)}`),
        '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
