import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  CrmFehler, legeKontaktAn, legeKundeAn, type KundeTyp, type Rechtsgrundlage,
} from '@/server/services/crm/anlegen';
import {
  aendereKontakt, aendereKunde, archiviereKunde, scheideKontaktAus,
  setzeHauptkontakt,
  setzeKundeStatus, type KundeStatus,
} from '@/server/services/crm/aendern';

/**
 * `POST /api/crm/kunde` — einen Kunden oder einen Ansprechpartner anlegen
 * (CRM-01, CRM-03, OPS-01).
 *
 * **Bei einem Fehler geht es ZURÜCK auf das Formular, mit dem Grund.** Die
 * Formulare im Portal haben kein JavaScript; eine JSON-Antwort wäre hier
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
          { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /*
         * **Die Handlung steht im Feld `aktion`, nicht in der Adresse**
         * (V-017…V-019). Dieselbe Begruendung wie bei `api/objekt`: alle
         * Zweige verlangen `crm.schreiben` und entstehen aus Formularen
         * derselben Flaeche; fuenf Routen waeren fuenf Stellen, an denen
         * dieses Recht steht, und die fuenfte ist die, die beim naechsten
         * Umbau vergessen wird.
         *
         * Ohne `aktion` bleibt es beim alten Verhalten — ANLEGEN. Die
         * bestehenden Formulare schicken das Feld nicht, und eine Route, die
         * ihre Aufrufer beim Umbau bricht, ist ein Umbau zu viel.
         */
        const aktion = String(daten.get('aktion') ?? 'anlegen');
        const bereichVon = (): string => zurueck.split('/')[2] ?? '';

        if (aktion === 'kunde_aendern') {
          const id = wert('id');
          if (id === undefined) throw new CrmFehler('Kein Kunde angegeben.', 'id_fehlt');
          await aendereKunde(kontext, {
            id,
            name: String(daten.get('name') ?? ''),
            typ: String(daten.get('typ') ?? 'firma') as KundeTyp,
            rechtsform: wert('rechtsform'),
            ustId: wert('ustId'),
            steuernummer: wert('steuernummer'),
            strasse: wert('strasse'),
            hausnummer: wert('hausnummer'),
            plz: wert('plz'),
            ort: wert('ort'),
            land: wert('land'),
            emailZentral: wert('emailZentral'),
            telefonZentral: wert('telefonZentral'),
            webseite: wert('webseite'),
            notiz: wert('notiz'),
          });
          return `/portal/${bereichVon()}/crm/kunden/${id}`;
        }

        if (aktion === 'kunde_status') {
          const id = wert('id');
          if (id === undefined) throw new CrmFehler('Kein Kunde angegeben.', 'id_fehlt');
          await setzeKundeStatus(kontext, id, String(daten.get('status') ?? '') as KundeStatus);
          return `/portal/${bereichVon()}/crm/kunden/${id}`;
        }

        if (aktion === 'kunde_archivieren') {
          const id = wert('id');
          if (id === undefined) throw new CrmFehler('Kein Kunde angegeben.', 'id_fehlt');
          await archiviereKunde(kontext, id);
          /* Danach auf die LISTE: das Blatt daneben ist leer. */
          return `/portal/${bereichVon()}/crm/kunden`;
        }

        if (aktion === 'kontakt_aendern') {
          const id = wert('id');
          if (id === undefined) throw new CrmFehler('Kein Kontakt angegeben.', 'id_fehlt');
          await aendereKontakt(kontext, {
            id,
            nachname: String(daten.get('nachname') ?? ''),
            vorname: wert('vorname'),
            anrede: wert('anrede'),
            titel: wert('titel'),
            position: wert('position'),
            abteilung: wert('abteilung'),
            email: wert('email'),
            telefon: wert('telefon'),
            mobil: wert('mobil'),
          });
          return zurueck;
        }

        if (aktion === 'kontakt_ausgeschieden') {
          const id = wert('id');
          if (id === undefined) throw new CrmFehler('Kein Kontakt angegeben.', 'id_fehlt');
          await scheideKontaktAus(kontext, id);
          return zurueck;
        }

        /*
         * **Der Hauptkontakt** (V-097) — eine Eigenschaft des KUNDEN, nicht
         * des Kontakts, und deshalb mit BEIDEN Kennungen. Es kann nur einer
         * sein (`ansprechpartner_hauptkontakt_uk`); der Dienst löscht deshalb
         * zuerst den alten und setzt dann den neuen, in derselben
         * Transaktion.
         */
        if (aktion === 'hauptkontakt') {
          const id = wert('id');
          const kunde = wert('kundeId');
          if (id === undefined || kunde === undefined) {
            throw new CrmFehler('Kunde oder Kontakt fehlt.', 'id_fehlt');
          }
          await setzeHauptkontakt(kontext, kunde, id);
          return zurueck;
        }

        const kundeId = wert('kundeId');
        if (kundeId !== undefined) {
          /* Ein Ansprechpartner zu einem bestehenden Kunden. */
          await legeKontaktAn(kontext, {
            kundeId,
            nachname: String(daten.get('nachname') ?? ''),
            vorname: wert('vorname'),
            anrede: wert('anrede'),
            position: wert('position'),
            email: wert('email'),
            telefon: wert('telefon'),
            istHauptkontakt: String(daten.get('hauptkontakt') ?? '') === '1',
            rechtsgrundlage: String(daten.get('rechtsgrundlage') ?? 'keine') as Rechtsgrundlage,
            grundlageQuelle: wert('grundlageQuelle'),
            einwilligungKanaele: daten.getAll('kanal').map(String),
          });
          return zurueck;
        }

        const neu = await legeKundeAn(kontext, {
          name: String(daten.get('name') ?? ''),
          typ: String(daten.get('typ') ?? 'firma') as KundeTyp,
          strasse: wert('strasse'),
          hausnummer: wert('hausnummer'),
          plz: wert('plz'),
          ort: wert('ort'),
          emailZentral: wert('emailZentral'),
          telefonZentral: wert('telefonZentral'),
          webseite: wert('webseite'),
          ustId: wert('ustId'),
          rechtsgrundlage: String(daten.get('rechtsgrundlage') ?? 'keine') as Rechtsgrundlage,
          grundlageQuelle: wert('grundlageQuelle'),
        });
        /*
         * Nach dem Anlegen auf den KUNDEN und nicht zurueck auf das leere
         * Formular: wer gerade einen Kunden angelegt hat, will als naechstes
         * einen Ansprechpartner eintragen — und nicht pruefen muessen, ob es
         * geklappt hat.
         */
        const bereich = zurueck.split('/')[2] ?? '';
        return `/portal/${bereich}/crm/kunden/${neu.id}`;
      }));
  } catch (fehler) {
    if (fehler instanceof CrmFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
