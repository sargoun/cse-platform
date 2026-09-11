/**
 * `einzelabruf` — die einzeln beauftragte Leistung neben dem laufenden Vertrag
 * (FIN-01, CLN-05, OPS-05).
 *
 * Der Beleg ist `sonderleistung`: wer wann was beauftragt hat, mit Menge und
 * Einheit. Abgerechnet wird, was ERBRACHT ist — `angefragt`, `beauftragt` und
 * `geplant` sind Absichten, und eine Rechnung ueber eine Absicht ist eine
 * Rechnung ueber nichts.
 *
 * **Der Preis kommt aus der Vertragszeile, nicht aus dem Katalog.**
 * `auftrag_leistung.einzelpreis_cent` ist der mit DIESEM Kunden vereinbarte
 * Preis; `leistungskatalog_position` ist der Listenpreis. Die beiden gehen
 * regelmaessig auseinander, und die Rechnung schuldet den vereinbarten.
 *
 * **Was offen ist, ist die Mindestabnahme.** Ob ein einzelner Abruf eine
 * Mindestmenge oder eine Abrufpauschale traegt, steht nirgends — deshalb ein
 * Parameter ohne Vorgabewert, der ausdruecklich auch `null` sein darf: „keine
 * Mindestabnahme" ist eine ENTSCHEIDUNG und muss als solche im Vertrag stehen,
 * nicht als Abwesenheit einer Zeile.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: gibt es eine Mindestabrufmenge oder eine Abrufpauschale?
 */
import { mengeAusPostgres, milliMenge, type MilliMenge } from '../menge.js';
import { berechneNetto, type Abfrage } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type RechnungspositionEntwurf,
  centOderNull,
  fehler,
  leistungszeitraum,
  loeseEinheit,
  loeseSteuergruppe,
  pruefeParameter,
  warnung,
} from './typen.js';

interface AbrufZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly ausfuehrung_von: string | null;
  readonly ausfuehrung_bis: string | null;
  readonly beauftragt_am: string;
  readonly auftrag_leistung_id: string | null;
  readonly al_einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly steuersatz_bp: number | null;
  readonly steuer_kennzeichen: string | null;
}

/**
 * Die erbrachten, nicht stornierten Abrufe des Auftrags im Zeitraum.
 *
 * Datiert wird nach der AUSFUEHRUNG und ersatzweise nach der Beauftragung:
 * ein Abruf ohne Ausfuehrungsdatum ist im Regelfall am Tag der Beauftragung
 * erbracht worden, und ihn deshalb aus dem Zeitraum fallen zu lassen hiesse,
 * geleistete Arbeit stillschweigend nicht zu berechnen.
 */
async function ladeAbrufe(
  db: Abfrage, auftragId: string, auftragLeistungId: string | null,
  von: string, bis: string,
): Promise<readonly AbrufZeile[]> {
  return db.abfrage<AbrufZeile>(
    `select s.id, s.bezeichnung, s.menge::text, s.einheit,
            to_char(s.ausfuehrung_von, 'YYYY-MM-DD') as ausfuehrung_von,
            to_char(s.ausfuehrung_bis, 'YYYY-MM-DD') as ausfuehrung_bis,
            to_char(s.beauftragt_am, 'YYYY-MM-DD') as beauftragt_am,
            s.auftrag_leistung_id::text as auftrag_leistung_id,
            al.einheit as al_einheit, al.einzelpreis_cent::text,
            al.steuersatz_bp, al.steuer_kennzeichen::text as steuer_kennzeichen
       from sonderleistung s
       join auftrag_leistung al
         on al.mandant_id = s.mandant_id and al.id = s.auftrag_leistung_id
      where al.auftrag_id = $1
        and ($2::uuid is null or s.auftrag_leistung_id = $2::uuid)
        and s.status = 'erbracht'
        and s.storniert_am is null
        and coalesce(s.ausfuehrung_bis, s.ausfuehrung_von, s.beauftragt_am)
              between $3::date and $4::date
      order by coalesce(s.ausfuehrung_bis, s.ausfuehrung_von, s.beauftragt_am), s.bezeichnung`,
    [auftragId, auftragLeistungId, von, bis],
  );
}

/**
 * Die vereinbarte Mindestabrufmenge — `null` heisst ausdruecklich „keine".
 *
 * Fehlt der Schluessel ganz, wird nicht `null` unterstellt: dann hat niemand
 * entschieden, und das ist etwas anderes als „entschieden: keine".
 */
function mindestmenge(parameter: Readonly<Record<string, unknown>>): MilliMenge | null {
  const wert = parameter['mindestabrufmenge'];
  if (wert === null) return null;
  if (typeof wert === 'string' && wert.trim() !== '') return mengeAusPostgres(wert);
  throw new AbrechnungFehler(
    'Der Parameter „mindestabrufmenge" ist im Vertrag nicht hinterlegt. Er darf '
    + 'ausdrücklich `null` sein — „keine Mindestabnahme" ist eine Entscheidung und '
    + 'keine Auslassung (O-04).',
    'parameter_offen',
  );
}

export const EINZELABRUF: Abrechnungsart = {
  schluessel: 'einzelabruf',
  bezeichnung: 'Einzelabruf',
  istProvisorisch: true,
  offeneParameter: [
    {
      schluessel: 'mindestabrufmenge',
      frage: 'Gibt es eine Mindestabrufmenge (als Dezimalzeichenkette) oder ausdrücklich '
        + 'keine (null)?',
      werte: null,
      offeneFrage: 'O-04',
    },
  ],

  async pruefe(db, eingabe): Promise<readonly AbrechnungsBefund[]> {
    const { konfiguration, periode } = eingabe;
    const befunde = [...pruefeParameter(EINZELABRUF, konfiguration)];
    const abrufe = await ladeAbrufe(
      db, konfiguration.auftragId, konfiguration.auftragLeistungId, periode.von, periode.bis,
    );
    if (abrufe.length === 0) {
      befunde.push(warnung(
        'sonderleistung',
        `Im Zeitraum ${periode.von} bis ${periode.bis} ist kein erbrachter Einzelabruf `
        + 'erfasst.',
      ));
    }
    for (const a of abrufe) {
      if (a.einzelpreis_cent === null) {
        befunde.push(fehler(
          'auftrag_leistung.einzelpreis_cent',
          `Der Abruf „${a.bezeichnung}" hängt an einer Vertragszeile ohne vereinbarten `
          + 'Einzelpreis.',
        ));
      }
      if (a.menge === null) {
        befunde.push(fehler(
          'sonderleistung.menge',
          `Der Abruf „${a.bezeichnung}" trägt keine Menge — ohne sie hat die `
          + 'Rechnungszeile keine (§14 Abs. 4 Nr. 5 UStG).',
        ));
      }
    }
    return befunde;
  },

  async positionen(db, eingabe): Promise<readonly RechnungspositionEntwurf[]> {
    const { konfiguration, periode } = eingabe;
    const mindest = mindestmenge(konfiguration.parameter);
    const abrufe = await ladeAbrufe(
      db, konfiguration.auftragId, konfiguration.auftragLeistungId, periode.von, periode.bis,
    );
    if (abrufe.length === 0) {
      throw new AbrechnungFehler(
        `Im Zeitraum ${periode.von} bis ${periode.bis} ist kein erbrachter Einzelabruf erfasst.`,
        'nichts_abzurechnen',
      );
    }

    const zeitraum = leistungszeitraum(konfiguration, periode);
    const entwuerfe: RechnungspositionEntwurf[] = [];

    /**
     * EINE Zeile je Abruf, nicht eine Sammelzeile: jeder Abruf ist ein eigener
     * Auftrag mit eigenem Datum, und §14 Abs. 4 Nr. 5 UStG verlangt Umfang und
     * Art der Leistung. Zusammengefasst stuende auf der Rechnung „Sonder-
     * reinigung 4 Stk" und der Kunde koennte nicht erkennen, welche vier.
     */
    for (const abruf of abrufe) {
      const preis = centOderNull(abruf.einzelpreis_cent);
      if (preis === null) {
        throw new AbrechnungFehler(
          `Die Vertragszeile hinter dem Abruf „${abruf.bezeichnung}" führt keinen `
          + 'Einzelpreis.',
          'kein_preis',
        );
      }
      if (abruf.menge === null) {
        throw new AbrechnungFehler(
          `Der Abruf „${abruf.bezeichnung}" trägt keine Menge.`, 'keine_menge',
        );
      }
      if (abruf.steuersatz_bp === null || abruf.steuer_kennzeichen === null) {
        throw new AbrechnungFehler(
          `Die Vertragszeile hinter dem Abruf „${abruf.bezeichnung}" führt keinen `
          + 'Steuersatz.',
          'mehrdeutige_steuergruppe',
        );
      }

      const erfasst = mengeAusPostgres(abruf.menge);
      const menge = mindest !== null && erfasst < mindest ? mindest : erfasst;
      if (menge === 0n) {
        throw new AbrechnungFehler(
          `Der Abruf „${abruf.bezeichnung}" hat die Menge null.`, 'keine_menge',
        );
      }
      const einheit = await loeseEinheit(db, abruf.einheit ?? abruf.al_einheit);
      const steuergruppe = await loeseSteuergruppe(
        db, abruf.steuer_kennzeichen, abruf.steuersatz_bp, periode.bis,
      );
      const basis = milliMenge(1000n);
      const tag = abruf.ausfuehrung_bis ?? abruf.ausfuehrung_von ?? abruf.beauftragt_am;

      entwuerfe.push({
        bezeichnung: abruf.bezeichnung,
        beschreibung:
          `Einzelabruf vom ${tag}`
          + (mindest !== null && erfasst < mindest
            ? ` (Mindestabnahme nach Vertrag angewandt)`
            : '')
          + ' — provisorisch (O-04)',
        menge,
        einheit,
        preisBasismenge: basis,
        einzelpreisCent: preis,
        nettoCent: berechneNetto(menge, basis, preis, 0),
        steuergruppe,
        abrechnungsart: EINZELABRUF.schluessel,
        vertragAbrechnungId: konfiguration.id,
        auftragLeistungId: abruf.auftrag_leistung_id,
        lvPositionId: null,
        leistungVon: zeitraum.von === null ? null : tag,
        leistungBis: zeitraum.bis === null ? null : tag,
        herkunft: [
          { art: 'vertrag', id: abruf.auftrag_leistung_id ?? '', anteil: menge },
        ],
      });
    }
    return entwuerfe;
  },
};
