/**
 * **Ein Treffer des Vergaberadars wird zum Lead** (V-139, CRM-07, RAD-07,
 * D-633).
 *
 * CRM-07 nennt vier Leadquellen: Website-Formular, Vergaberadar, manuelle
 * Erfassung und Empfehlung. `lead_quelle` kannte alle vier seit `0017`, und
 * der CHECK `lead_herkunft_stimmig` verlangte für `vergabe_radar` eine
 * `ausschreibung_id` — aber keine Zeile Code schrieb sie. Die Auswertung
 * beschriftete „Vergaberadar", und der Wert konnte nie auftreten.
 *
 * **Die Bekanntmachung bleibt, was sie ist.** Der Vorgang des Radars
 * (`ausschreibung_vorgang`: geprüft, in Bearbeitung, verworfen, Mappe) und der
 * Lead sind zwei Dinge: der eine führt die Vergabe, der andere den Vertrieb.
 * Diese Übernahme ändert am Vorgang nichts.
 *
 * **Nichts wird erfunden.** Betreff und Beschreibung stehen in der
 * Bekanntmachung; der Auftraggeber ebenfalls, und wo er fehlt, nennt ihn der
 * Mensch. Der geschätzte Wert wandert NUR in Euro: eine Fremdwährung wird
 * nicht umgerechnet (O-47), und ein Betrag ohne Währung ist kein
 * Euro-Betrag.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { CrmFehler } from './anlegen.js';
import { istKennung } from './lead-kette.js';

export interface Bekanntmachung {
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly vergabestelleName: string | null;
  readonly vergabestelleOrt: string | null;
  readonly quellId: string;
  readonly wertCent: bigint | null;
  readonly waehrung: string | null;
}

export interface LeadAusBekanntmachung {
  readonly betreff: string;
  readonly firmaName: string;
  readonly bedarf: string;
  readonly geschaetzterWertCent: bigint | null;
}

/** Wie viel der Beschreibung in den Lead wandert — der Rest steht im Radar. */
export const BEDARF_HOECHSTENS = 2000;

/**
 * Die Felder des Leads aus der Bekanntmachung — rein, ohne Datenbank.
 *
 * Getrennt und exportiert, damit die Regeln ohne Datenbank prüfbar sind:
 * welcher Name der Auftraggeber ist, was mit einem Wert in Fremdwährung
 * geschieht, wie lang die Zusammenfassung wird.
 */
export function leadAusBekanntmachung(
  b: Bekanntmachung, auftraggeber?: string | null,
): LeadAusBekanntmachung {
  const betreff = b.titel.trim();
  if (betreff === '') {
    throw new CrmFehler('Die Bekanntmachung hat keinen Titel.', 'ohne_titel');
  }
  const name = (auftraggeber ?? '').trim() !== ''
    ? (auftraggeber ?? '').trim()
    : (b.vergabestelleName ?? '').trim();
  if (name === '') {
    throw new CrmFehler(
      'Die Bekanntmachung nennt keine Vergabestelle. Bitte tragen Sie den Auftraggeber '
      + 'ein — ein Lead ohne Namen ist eine Notiz.', 'ohne_auftraggeber');
  }
  const beschreibung = (b.beschreibung ?? '').trim();
  const gekuerzt = beschreibung.length > BEDARF_HOECHSTENS
    ? `${beschreibung.slice(0, BEDARF_HOECHSTENS).trimEnd()} …`
    : beschreibung;
  const bedarf = [
    gekuerzt === '' ? null : gekuerzt,
    `Bekanntmachung ${b.quellId}`
      + `${(b.vergabestelleOrt ?? '').trim() === '' ? '' : `, ${(b.vergabestelleOrt ?? '').trim()}`}.`,
  ].filter((t): t is string => t !== null).join('\n\n');
  return {
    betreff,
    firmaName: name,
    bedarf,
    geschaetzterWertCent: b.waehrung === 'EUR' ? b.wertCent : null,
  };
}

/**
 * Die Übernahme. `crm.schreiben` für den Lead (die Route prüft es, die
 * Policy auf `lead` noch einmal), `radar.lesen` für die Bekanntmachung — ohne
 * das Recht sieht die Sitzung sie nicht und bekommt „nicht gefunden".
 *
 * **Einmal je Gesellschaft.** Zuerst gelesen, damit der Mensch einen Satz
 * bekommt; danach hält `lead_ausschreibung_uk` (0400) den gleichzeitigen
 * zweiten Klick.
 */
export async function uebernimmAusschreibungAlsLead(
  kontext: SchreibKontext, ausschreibungId: string,
  eingabe: { readonly auftraggeber?: string | undefined; readonly besitzerBenutzerId: string },
): Promise<{ readonly id: string; readonly leadnummer: string }> {
  if (!istKennung(ausschreibungId)) {
    throw new CrmFehler('Diese Bekanntmachung gibt es nicht.', 'ausschreibung_unbekannt', 404);
  }
  const [a] = await kontext.abfrage<{
    titel: string; beschreibung: string | null; vergabestelle_name: string | null;
    vergabestelle_ort: string | null; quell_id: string; wert: string | null;
    waehrung: string | null;
  }>(
    `select titel, beschreibung, vergabestelle_name, vergabestelle_ort, quell_id,
            wert_geschaetzt_cent::text as wert, waehrung
       from ausschreibung where id = $1::uuid`, [ausschreibungId]);
  if (a === undefined) {
    throw new CrmFehler('Diese Bekanntmachung gibt es nicht.', 'ausschreibung_unbekannt', 404);
  }
  const [schon] = await kontext.abfrage<{ leadnummer: string }>(
    `select leadnummer from lead
      where mandant_id = app.aktiver_mandant() and ausschreibung_id = $1::uuid`,
    [ausschreibungId]);
  if (schon !== undefined) {
    throw new CrmFehler(
      `Diese Bekanntmachung ist schon als Lead ${schon.leadnummer} übernommen.`,
      'schon_uebernommen');
  }

  const felder = leadAusBekanntmachung({
    titel: a.titel, beschreibung: a.beschreibung, vergabestelleName: a.vergabestelle_name,
    vergabestelleOrt: a.vergabestelle_ort, quellId: a.quell_id,
    wertCent: a.wert === null ? null : BigInt(a.wert), waehrung: a.waehrung,
  }, eingabe.auftraggeber);

  let neu: { id: string; leadnummer: string } | undefined;
  try {
    [neu] = await kontext.schreibe<{ id: string; leadnummer: string }>(
      `insert into lead
         (mandant_id, leadnummer, quelle, ausschreibung_id, firma_name, betreff,
          bedarf_zusammenfassung, geschaetzter_wert_cent, besitzer_benutzer_id,
          akteur_art, erstellt_von)
       values (app.aktiver_mandant(),
               'L-' || upper(replace(gen_random_uuid()::text, '-', ''))::text,
               'vergabe_radar', $1::uuid, $2, $3, $4, $5::bigint, $6::uuid, 'mensch',
               app.aktueller_benutzer())
       returning id::text as id, leadnummer`,
      [ausschreibungId, felder.firmaName, felder.betreff, felder.bedarf,
        felder.geschaetzterWertCent === null ? null : felder.geschaetzterWertCent.toString(),
        eingabe.besitzerBenutzerId]);
  } catch (fehler) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23505' && f.constraint_name === 'lead_ausschreibung_uk') {
      throw new CrmFehler('Diese Bekanntmachung ist schon als Lead übernommen.',
        'schon_uebernommen');
    }
    throw fehler;
  }
  if (neu === undefined) {
    throw new CrmFehler(
      'Der Lead wurde nicht angelegt — fehlt `crm.schreiben`?', 'kein_schreibrecht', 403);
  }

  /*
   * `intern`, nicht `ausgehend`: eine ausgehende Zeile stoppte die
   * Reaktionsuhr (0017). Und einen Ansprechpartner hat der Lead noch nicht —
   * die Vergabestelle spricht man über die Plattform an, nicht per Mail aus
   * dem CRM (D-07).
   */
  await kontext.schreibe(
    `insert into lead_aktivitaet
       (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
        akteur_art, benutzer_id, rechtsgrundlage_snapshot)
     values (app.aktiver_mandant(), $1::uuid, 'system', 'intern', 'intern', 'portal',
             'Aus dem Vergaberadar übernommen', $2, 'mensch', app.aktueller_benutzer(),
             'keine')`,
    [neu.id, `Bekanntmachung ${a.quell_id}: ${felder.betreff}`]);

  return neu;
}
