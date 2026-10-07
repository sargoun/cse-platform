import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { istBicGueltig, istIbanGueltig, normalisiereIban } from '../finanz/zahlung/iban.js';

/**
 * Die Angaben einer Gesellschaft pflegen und bestätigen (V-390, D-804,
 * TEN-01, TEN-02, TEN-09, LEG-01).
 *
 * **Warum es diesen Dienst gibt.** Register, Steuernummern, Anschrift, Bank
 * und Rechtsform stehen auf jeder Rechnung und im Impressum — und kamen bis
 * D-804 nur aus dem Seed oder per SQL. `cse_app` liest `mandant`, schreibt
 * aber nicht; geschrieben wird über `app.mandant_angaben_setzen` (0494), mit
 * `system.mandant_verwalten` und zweitem Faktor, und jede Änderung steht im
 * Protokoll (`trg_mandant_audit`).
 *
 * **Eine geänderte Angabe ist eine unbestätigte.** Ändert sich etwas, ist
 * `angaben_bestaetigt_am` wieder leer, und Impressum, Profil und
 * Einstellungsseiten sagen „nicht bestätigt" (O-353), bis jemand mit
 * demselben Recht bestätigt (`app.mandant_angaben_bestaetigen`, Serveruhr).
 *
 * **Die Regeln stehen zweimal, mit Absicht.** `pruefeAngaben` sagt sie vorher
 * in Worten; die CHECKs aus 0001 und 0120 sind die letzte Linie und werden in
 * `uebersetze` auf denselben Grund abgebildet. Was die Datenbank abweist, ist
 * nie ein roher Fehlertext auf dem Bildschirm.
 *
 * **Die Rechtsform der CSE Operations (O-01) bleibt ein Betreiberdatum.** Das
 * Formular kennt drei Zustände für „eigene Rechtseinheit": ja, nein und
 * „nicht eingetragen". Der dritte ist kein Fehler; er ist der Stand, bis der
 * Betreiber es weiss, und bis dahin stellt die Gesellschaft keine Rechnung
 * unter eigener Nummer.
 */

export interface MandantAngaben {
  readonly firma: string;
  readonly rechtsform: string | null;
  /** `null` = nicht eingetragen (O-01). */
  readonly istRechtseinheit: boolean | null;
  readonly eigenerNummernkreis: boolean;
  readonly handelsregisterGericht: string | null;
  readonly handelsregisterNummer: string | null;
  readonly geschaeftsfuehrer: readonly string[];
  readonly ustId: string | null;
  readonly steuernummer: string | null;
  readonly finanzamt: string | null;
  readonly betriebsnummer: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string;
  readonly telefon: string | null;
  readonly email: string | null;
  readonly web: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
  readonly bank: string | null;
  readonly rechnungKontaktName: string | null;
  readonly elektronischeAdresse: string | null;
  readonly elektronischeAdresseSchema: string | null;
}

export type AngabenGrund =
  | 'firma_fehlt' | 'zu_lang' | 'rechtseinheit' | 'ust_id' | 'plz' | 'land' | 'iban' | 'bic'
  | 'email' | 'web' | 'eadresse_paar' | 'eadresse_schema' | 'kreis_ohne_rechtseinheit'
  | 'ustg14_unvollstaendig' | 'nicht_erlaubt' | 'nicht_gefunden';

/** Der Satz zu jedem Grund — das Formular bekommt ihn zurück, nie einen Datenbanktext. */
export const ANGABEN_SAETZE: Readonly<Record<AngabenGrund, string>> = {
  firma_fehlt: 'Die Firma fehlt — sie ist der Name, unter dem die Gesellschaft im Register steht.',
  zu_lang: 'Eine Angabe ist länger als 200 Zeichen.',
  rechtseinheit: '„Eigene Rechtseinheit" kennt nur ja, nein oder „nicht eingetragen".',
  ust_id: 'Die USt-IdNr. hat die Form DE und neun Ziffern, zum Beispiel DE123456789.',
  plz: 'Die Postleitzahl hat fünf Ziffern.',
  land: 'Das Land steht als Kürzel aus zwei Buchstaben da, zum Beispiel DE.',
  iban: 'Die IBAN ist nicht gültig — die Prüfziffer stimmt nicht oder die Form passt nicht.',
  bic: 'Die BIC hat acht oder elf Zeichen, zum Beispiel BYLADEM1001.',
  email: 'Die E-Mail-Adresse ist nicht lesbar.',
  web: 'Die Webadresse beginnt mit https:// oder http://.',
  eadresse_paar: 'Elektronische Adresse und ihr Schema stehen zusammen oder gar nicht.',
  eadresse_schema: 'Das Schema der elektronischen Adresse ist ein EAS-Code — vier Ziffern (9930 USt-IdNr., 0204 Leitweg-ID) oder EM.',
  kreis_ohne_rechtseinheit: 'Einen eigenen Rechnungsnummernkreis führt nur eine eigene Rechtseinheit (TEN-02).',
  ustg14_unvollstaendig: 'Ein eigener Rechnungsnummernkreis verlangt Straße, Postleitzahl, Ort und eine Steuernummer oder USt-IdNr. (§ 14 Abs. 4 UStG).',
  nicht_erlaubt: 'Nicht gefunden.',
  nicht_gefunden: 'Diese Gesellschaft gibt es hier nicht.',
};

export class AngabenFehler extends Error {
  constructor(readonly grund: AngabenGrund) {
    super(ANGABEN_SAETZE[grund]);
    this.name = 'AngabenFehler';
  }
}

const HOECHSTENS = 200;

function text(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;
  const t = wert.trim();
  if (t.length > HOECHSTENS) throw new AngabenFehler('zu_lang');
  return t === '' ? null : t;
}

/**
 * Prüft und normalisiert die Angaben aus dem Formular — rein, ohne Datenbank.
 *
 * `lies` gibt den Wert eines Formularfelds oder `null`. Leere Felder werden
 * `null`; die USt-IdNr. wird groß und ohne Leerzeichen geschrieben, die IBAN
 * ohne Leerzeichen, die Geschäftsführung je Zeile (oder durch Komma getrennt)
 * eine Person.
 */
export function pruefeAngaben(lies: (feld: string) => string | null): MandantAngaben {
  const firma = text(lies('firma'));
  if (firma === null) throw new AngabenFehler('firma_fehlt');

  const rechtseinheitRoh = (lies('istRechtseinheit') ?? 'offen').trim();
  if (!['ja', 'nein', 'offen'].includes(rechtseinheitRoh)) throw new AngabenFehler('rechtseinheit');
  const istRechtseinheit = rechtseinheitRoh === 'offen' ? null : rechtseinheitRoh === 'ja';
  const eigenerNummernkreis = lies('eigenerNummernkreis') === 'ja';

  const ustRoh = text(lies('ustId'));
  const ustId = ustRoh === null ? null : ustRoh.replace(/\s+/gu, '').toUpperCase();
  if (ustId !== null && !/^DE[0-9]{9}$/u.test(ustId)) throw new AngabenFehler('ust_id');

  const plz = text(lies('plz'));
  if (plz !== null && !/^[0-9]{5}$/u.test(plz)) throw new AngabenFehler('plz');

  const land = (text(lies('land')) ?? 'DE').toUpperCase();
  if (!/^[A-Z]{2}$/u.test(land)) throw new AngabenFehler('land');

  const ibanRoh = text(lies('iban'));
  const iban = ibanRoh === null ? null : normalisiereIban(ibanRoh);
  if (iban !== null && !istIbanGueltig(iban)) throw new AngabenFehler('iban');

  const bicRoh = text(lies('bic'));
  const bic = bicRoh === null ? null : bicRoh.replace(/\s+/gu, '').toUpperCase();
  if (bic !== null && !istBicGueltig(bic)) throw new AngabenFehler('bic');

  const email = text(lies('email'));
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AngabenFehler('email');

  const web = text(lies('web'));
  if (web !== null && !/^https?:\/\/\S+$/u.test(web)) throw new AngabenFehler('web');

  const elektronischeAdresse = text(lies('elektronischeAdresse'));
  const schemaRoh = text(lies('elektronischeAdresseSchema'));
  const elektronischeAdresseSchema = schemaRoh === null ? null : schemaRoh.toUpperCase();
  if ((elektronischeAdresse === null) !== (elektronischeAdresseSchema === null)) {
    throw new AngabenFehler('eadresse_paar');
  }
  if (elektronischeAdresseSchema !== null && !/^(?:EM|[0-9]{4})$/u.test(elektronischeAdresseSchema)) {
    throw new AngabenFehler('eadresse_schema');
  }

  const strasse = text(lies('strasse'));
  const ort = text(lies('ort'));
  const steuernummer = text(lies('steuernummer'));
  if (eigenerNummernkreis && istRechtseinheit !== true) {
    throw new AngabenFehler('kreis_ohne_rechtseinheit');
  }
  if (eigenerNummernkreis
      && (strasse === null || plz === null || ort === null
          || (ustId === null && steuernummer === null))) {
    throw new AngabenFehler('ustg14_unvollstaendig');
  }

  const geschaeftsfuehrer = (lies('geschaeftsfuehrer') ?? '')
    .split(/[\n,]/u)
    .map((n) => text(n))
    .filter((n): n is string => n !== null);

  return {
    firma,
    rechtsform: text(lies('rechtsform')),
    istRechtseinheit,
    eigenerNummernkreis,
    handelsregisterGericht: text(lies('handelsregisterGericht')),
    handelsregisterNummer: text(lies('handelsregisterNummer')),
    geschaeftsfuehrer,
    ustId,
    steuernummer,
    finanzamt: text(lies('finanzamt')),
    betriebsnummer: text(lies('betriebsnummer')),
    strasse,
    plz,
    ort,
    land,
    telefon: text(lies('telefon')),
    email,
    web,
    iban,
    bic,
    bank: text(lies('bank')),
    rechnungKontaktName: text(lies('rechnungKontaktName')),
    elektronischeAdresse,
    elektronischeAdresseSchema,
  };
}

/**
 * Die Datenbank sagt, warum — dieser Satz sagt es dem Bildschirm.
 *
 * `42501` ist „darf nicht" und wird wie ein fehlendes Recht beantwortet: 404,
 * nicht 403 (AUT-06). Ein verletzter CHECK bekommt den Grund, den
 * `pruefeAngaben` schon vorher nennt — die Datenbank hält dieselbe Regel nur
 * ein zweites Mal.
 */
function uebersetze(fehler: unknown): never {
  const f = fehler as { code?: string; constraint_name?: string; constraint?: string; detail?: string };
  const regel = f.constraint_name ?? f.constraint ?? '';
  if (f.code === '42501') throw new AngabenFehler('nicht_erlaubt');
  if (f.code === 'P0002') throw new AngabenFehler('nicht_gefunden');
  if (f.code === '22023' && f.detail === 'firma_fehlt') throw new AngabenFehler('firma_fehlt');
  if (f.code === '23514') {
    if (regel === 'mandant_kreis_nur_rechtseinheit') throw new AngabenFehler('kreis_ohne_rechtseinheit');
    if (regel === 'mandant_ustg14_vollstaendig') throw new AngabenFehler('ustg14_unvollstaendig');
    if (regel === 'mandant_eadresse_paarweise') throw new AngabenFehler('eadresse_paar');
    if (regel.includes('ust_id')) throw new AngabenFehler('ust_id');
    if (regel.includes('plz')) throw new AngabenFehler('plz');
  }
  if (f.code === '22001') throw new AngabenFehler('land');
  throw fehler;
}

/** Schreibt die Angaben der aktiven Gesellschaft; `true`, wenn sich etwas geändert hat. */
export async function setzeAngaben(kontext: SchreibKontext, angaben: MandantAngaben): Promise<boolean> {
  const nutzlast = {
    firma: angaben.firma,
    rechtsform: angaben.rechtsform,
    ist_rechtseinheit: angaben.istRechtseinheit,
    eigener_nummernkreis: angaben.eigenerNummernkreis,
    handelsregister_gericht: angaben.handelsregisterGericht,
    handelsregister_nummer: angaben.handelsregisterNummer,
    geschaeftsfuehrer: angaben.geschaeftsfuehrer,
    ust_id: angaben.ustId,
    steuernummer: angaben.steuernummer,
    finanzamt: angaben.finanzamt,
    betriebsnummer: angaben.betriebsnummer,
    strasse: angaben.strasse,
    plz: angaben.plz,
    ort: angaben.ort,
    land: angaben.land,
    telefon: angaben.telefon,
    email: angaben.email,
    web: angaben.web,
    iban: angaben.iban,
    bic: angaben.bic,
    bank: angaben.bank,
    rechnung_kontakt_name: angaben.rechnungKontaktName,
    elektronische_adresse: angaben.elektronischeAdresse,
    elektronische_adresse_schema: angaben.elektronischeAdresseSchema,
  };
  try {
    const [z] = await kontext.schreibe<{ geaendert: boolean }>(
      `select app.mandant_angaben_setzen($1::jsonb) as geaendert`, [JSON.stringify(nutzlast)]);
    return z?.geaendert === true;
  } catch (fehler) {
    return uebersetze(fehler);
  }
}

/** Bestätigt die Angaben der aktiven Gesellschaft — Zeitpunkt aus der Serveruhr. */
export async function bestaetigeAngaben(kontext: SchreibKontext): Promise<void> {
  try {
    await kontext.schreibe(`select app.mandant_angaben_bestaetigen() as am`);
  } catch (fehler) {
    uebersetze(fehler);
  }
}
