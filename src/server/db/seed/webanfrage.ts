import type postgres from 'postgres';
import { withEingang } from '../../kontext/eingang.js';
import { nimmAn } from '../../services/lead/annahme.js';
import { Felder } from '../../../lib/formular/schema.js';
import { FORMULAR_SCHLUESSEL } from '../../../lib/formular/bereiche.js';

/**
 * **Eine Anfrage über das Angebotsformular — abgeschickt, nicht eingefügt**
 * (V-271, D-764).
 *
 * Der Antwortentwurf des Akquise-Agenten dankt für eine Anfrage, und belegt
 * ist eine Anfrage nur durch einen `formular_eingang`. Bis V-271 antwortete
 * der Entwurf deshalb auf jeden offenen Lead — im Seed auf den Lead aus dem
 * Vergaberadar (Bau) und auf die von Hand erfassten der Reinigung. Seit er
 * nur noch auf eine echte Einsendung antwortet, hätte die Vorführfläche
 * keinen einzigen Fall, an dem er zu sehen ist.
 *
 * **Warum über `nimmAn` und nicht mit `insert`.** `seed/operations.ts` sagt
 * es für die von Hand erfassten Leads: einen `formular_eingang` zu ERFINDEN
 * hiesse, eine Anfrage zu behaupten, die niemand gestellt hat — „wer einen
 * Webformular-Lead sehen will, schickt das Angebotsformular ab". Genau das
 * geschieht hier: dieselbe Funktion, die `POST /api/anfrage` ruft, als
 * Eingangsprinzipal (`withEingang`), gegen das veröffentlichte Formular der
 * Reinigung, mit seiner Prüfung, seinem SLA und seiner Eingangsaktivität.
 * Die Bestätigungsmail der Route geht hier nicht hinaus — sie ginge ohnehin
 * nicht (`gate()` ohne Richtlinie).
 *
 * **Nur auf der Vorführfläche** (`CSE_DEV_FLAECHEN`) und wiederholbar: steht
 * die Einsendung dieser Firma schon, geschieht nichts. Die Kontaktdaten sind
 * erfunden und tragen die reservierte Domain `example`.
 */

export interface WebanfrageErgebnis {
  readonly leadnummer: string | null;
  readonly neu: boolean;
  readonly uebersprungen: boolean;
}

const FIRMA = 'Hausverwaltung Spreebogen GmbH';

export async function seedWebanfrage(
  sql: postgres.Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<WebanfrageErgebnis> {
  const mandantId = ids.get('reinigung');
  const schluessel = FORMULAR_SCHLUESSEL['reinigung'];
  if (!demodaten || mandantId === undefined || schluessel === undefined) {
    return { leadnummer: null, neu: false, uebersprungen: true };
  }

  const [schon] = await sql<{ leadnummer: string }[]>`
    select leadnummer from lead
     where mandant_id = ${mandantId} and quelle = 'webformular' and firma_name = ${FIRMA}
     limit 1`;
  if (schon !== undefined) return { leadnummer: schon.leadnummer, neu: false, uebersprungen: false };

  const [formular] = await sql<{
    id: string; felder: unknown; datenschutz_hinweis_version: string;
  }[]>`
    select id, felder, datenschutz_hinweis_version from formular_definition
     where mandant_id = ${mandantId} and schluessel = ${schluessel}
       and veroeffentlicht_am is not null and zurueckgezogen_am is null
     order by version desc limit 1`;
  if (formular === undefined) return { leadnummer: null, neu: false, uebersprungen: true };
  const felder = Felder.parse(formular.felder);

  /* Der gewünschte Start in vier Wochen — nach dem Berliner Kalender der Datenbank. */
  const [tag] = await sql<{ start: string }[]>`
    select (app.berlin_heute() + 28)::text as start`;

  const ergebnis = await sql.begin((tx) => withEingang(tx, mandantId, async (kontext) => {
    const [z] = await kontext.abfrage<{ sla_stunden: number | null; besitzer: string }>(
      `select sla_stunden, besitzer from app.formular_zustaendigkeit($1)`, [formular.id]);
    if (z === undefined) return null;
    return nimmAn({ unsafe: (q: string, w?: readonly unknown[]) => kontext.schreibe(q, w) }, {
      id: formular.id,
      mandantId,
      schluessel,
      felder,
      datenschutzHinweisVersion: formular.datenschutz_hinweis_version,
      slaStunden: z.sla_stunden,
      standardBesitzerBenutzerId: z.besitzer,
    }, {
      werte: {
        gebaeudetyp: 'buero',
        flaeche_qm: '640',
        anzahl_objekte: '1',
        frequenz: 'drei_woechentlich',
        wunsch_start: tag?.start ?? '',
        firma: FIRMA,
        name: 'Karin Weber',
        email: 'k.weber@hausverwaltung-spreebogen.example',
        telefon: '+49 30 000 000',
        nachricht: 'Bürohaus mit vier Etagen, Reinigung abends ab 18 Uhr.',
        datenschutz_hinweis: 'on',
      },
      attribution: {},
    });
  }));
  return ergebnis === null
    ? { leadnummer: null, neu: false, uebersprungen: true }
    : { leadnummer: ergebnis.leadnummer, neu: true, uebersprungen: false };
}
