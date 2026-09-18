/**
 * Die Bestaetigung einer Kalkulation — der Moment, in dem aus geschaetzten
 * Werten verantwortete werden.
 *
 * Bis hierhin steht ein Preis auf Platzhaltern: dem Stundenverrechnungssatz
 * und den Zuschlaegen (O-16) und dem Reinigungsrichtwert je Belagsart (O-17).
 * `kern.angebot_versand_pruefen` laesst ein solches Angebot nicht hinaus, und
 * das ist richtig — ein eingefrorener Preis auf vier unbeantworteten Fragen
 * sieht pruefbar aus und ist es nicht.
 *
 * Dieser Dienst ist der Ausweg, und er ist mit Absicht KEIN Schalter: er
 * verlangt die Zahlen. Wer bestaetigt, sagt „fuer dieses Angebot rechnen wir
 * so“, und die Kalkulation haelt fest, wer das wann gesagt hat. Was
 * gruppenweit gilt, bleibt offen (O-16) — und wird es so lange, bis der
 * Mandant es beantwortet, statt dass eine Vorgabe im Code es fuer ihn tut.
 */
import { addiere, basisPunkte, parseGeld, type Cent } from '../finanz/geld.js';
import type { MilliMenge } from '../finanz/menge.js';
import { kalkuliere, verteileNetto } from './index.js';
import type { Flaechenposten } from './richtzeit.js';
import { prozentInBasispunkteOderGrund } from '../finanz/prozent';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class KalkulationFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'eingefroren' | 'unvollstaendig' | 'keine_zahl') {
    super(nachricht);
    this.name = 'KalkulationFehler';
  }
}

/** Die erlaubten Basen — dieselben drei, die der Typ `gemeinkosten_basis` kennt. */
export const GEMEINKOSTEN_BASEN = ['lohn', 'selbstkosten', 'je_kostenart'] as const;

export interface Bestaetigung {
  /** Stundenverrechnungssatz als deutsche Eingabe, z. B. `"29,00"`. */
  readonly stundensatzEuro: string | null;
  readonly gemeinkostenBasis: string;
  /** Prozentsatz als deutsche Eingabe, z. B. `"15"` oder `"15,5"`. */
  readonly gemeinkostenProzent: string | null;
  readonly wagnisGewinnProzent: string | null;
  /**
   * Auch die Leistungswerte (O-17) bestaetigen — fuer DIESE Kalkulation.
   *
   * Getrennt, weil es eine ANDERE Aussage ist: der Stundensatz ist eine Zahl
   * dieses Angebots, der Reinigungsrichtwert eine Eigenschaft des Katalogs.
   *
   * Frueher schrieb diese Zusage in `belagsart` — in den GETEILTEN Katalog.
   * Damit bestaetigte sie nicht nur kuenftige Angebote, sondern raeumte
   * rueckwirkend jede andere Kalkulation auf derselben Belagsart aus
   * `kalkulation_platzhalter`: Preise, die auf dem Platzhalter gerechnet
   * worden waren, durften anschliessend hinaus, ohne dass jemand sie
   * angesehen hatte. Bestaetigt wird deshalb der Schnappschuss DIESER
   * Kalkulation (0027); der Katalog bleibt unberuehrt.
   */
  readonly leistungswerteBestaetigen: boolean;
  /**
   * Der Frequenzfaktor (O-56) als deutsche Eingabe, z. B. `"4,3333"`.
   *
   * `PLATZHALTER_FREQUENZ` raet ihn aus dem Turnus, und `kalkuliere` sagt das
   * auch. Frueher loeschte die Bestaetigung die Platzhalter-Raute trotzdem
   * mit — obwohl sie nach dem Faktor nie gefragt hatte. Wer bestaetigt, nennt
   * ihn jetzt; wer ihn weglaesst (`null`), laesst O-56 offen und das Angebot
   * bleibt in der Sperre. Kein Ersatzwert, keine stille Uebernahme.
   */
  readonly frequenzFaktor: string | null;
  readonly benutzerId: string;
}

/**
 * Ein Prozentsatz in Basispunkte — ganzzahlig, ohne Gleitkomma.
 *
 * `"15"` → 1500, `"15,5"` → 1550. Zwei Nachkommastellen sind die Grenze:
 * mehr traegt die Spalte nicht, und stillschweigend zu runden hiesse, einen
 * Zuschlag zu aendern, den jemand eingetippt hat.
 */
export function prozentInBasispunkte(eingabe: string): number {
  /**
   * Gerechnet wird in `finanz/prozent.ts`, damit der Sicherheitseinbehalt in
   * `auftrag/abschluss.ts` und dieser Zuschlag DIESELBE Umrechnung benutzen.
   * Hier bleibt die Grenze (1000 %) und der Name des Fehlers.
   */
  const ergebnis = prozentInBasispunkteOderGrund(eingabe, ZUSCHLAG_HOECHSTENS_BP);
  if (ergebnis.art === 'unlesbar') {
    throw new KalkulationFehler(
      `Kein Prozentsatz: ${JSON.stringify(eingabe)}`, 'keine_zahl');
  }
  if (ergebnis.art === 'ausserhalb') {
    throw new KalkulationFehler(`Zuschlag ausserhalb des Bereichs: ${eingabe}`, 'keine_zahl');
  }
  return ergebnis.bp;
}

/** 1000 % — die Grenze der Spalte, nicht eine kaufmaennische Aussage. */
const ZUSCHLAG_HOECHSTENS_BP = 100_000;

/**
 * Der Eurobetrag als ganze Cent — ueber die geprueft Geldfunktion, nie ueber `Number`.
 *
 * `parseGeld` nimmt negative Betraege an, und das ist dort richtig: eine
 * Gutschrift und ein Storno sind negatives Geld. Ein STUNDENSATZ ist es
 * nicht. `lohnkostenAusSekunden` multipliziert ohne Vorzeichenpruefung, ein
 * negativer Satz ergaebe negative Lohnkosten und darauf ein negatives
 * Angebot — eine Rechnung, die Geld verspricht. Die Schranke gehoert an
 * diesen Rand, nicht in `parseGeld`.
 *
 * Null ist ebenfalls draussen: ein Stundensatz von 0,00 € ist keine
 * Bestaetigung, sondern eine leere Eingabe mit einem Komma.
 */
export function stundensatzInCent(eingabe: string): Cent {
  let betrag: Cent;
  try {
    betrag = parseGeld(eingabe);
  } catch {
    throw new KalkulationFehler(
      `Kein Betrag: ${JSON.stringify(eingabe)}`, 'keine_zahl');
  }
  if ((betrag as bigint) <= 0n) {
    throw new KalkulationFehler(
      `Der Stundenverrechnungssatz muss groesser als null sein: ${JSON.stringify(eingabe)}`,
      'keine_zahl');
  }
  return betrag;
}

/**
 * Der Frequenzfaktor (O-56) in Milli — dieselbe Einheit wie `Frequenz.faktor`.
 *
 * `"4,3333"` → 4333. Vier Nachkommastellen, weil `frequenz_faktor` als
 * `numeric(10,4)` liegt; mehr traegt die Spalte nicht.
 */
export function frequenzFaktorInMilli(eingabe: string): bigint {
  const text = eingabe.trim().replace(/\s/gu, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/u.test(text)) {
    throw new KalkulationFehler(
      `Kein Frequenzfaktor: ${JSON.stringify(eingabe)}`, 'keine_zahl');
  }
  const [ganz = '0', bruch = ''] = text.split('.');
  const milli = BigInt(ganz) * 1000n + BigInt(bruch.padEnd(3, '0').slice(0, 3));
  if (milli <= 0n) {
    throw new KalkulationFehler(
      `Der Frequenzfaktor muss groesser als null sein: ${JSON.stringify(eingabe)}`,
      'keine_zahl');
  }
  return milli;
}

export async function bestaetigeKalkulation(
  db: Abfrage, angebotId: string, eingabe: Bestaetigung,
): Promise<{ readonly bestaetigt: boolean }> {
  if (!(GEMEINKOSTEN_BASEN as readonly string[]).includes(eingabe.gemeinkostenBasis)) {
    throw new KalkulationFehler(
      `Unbekannte Gemeinkostenbasis: ${eingabe.gemeinkostenBasis}`, 'unvollstaendig');
  }
  if (eingabe.stundensatzEuro === null || eingabe.gemeinkostenProzent === null
      || eingabe.wagnisGewinnProzent === null) {
    throw new KalkulationFehler(
      'Stundensatz, Gemeinkosten- und Wagnis-/Gewinnzuschlag muessen alle drei '
      + 'angegeben sein', 'unvollstaendig');
  }

  const satz = stundensatzInCent(eingabe.stundensatzEuro);
  const gk = prozentInBasispunkte(eingabe.gemeinkostenProzent);
  const wg = prozentInBasispunkte(eingabe.wagnisGewinnProzent);

  /**
   * `for update` — und die Pruefung auf `festgeschrieben` DANACH.
   *
   * Eine eingefrorene Kalkulation gehoert zu einem versendeten Angebot. Sie
   * nachtraeglich zu aendern hiesse, den Rechenweg eines abgegebenen Preises
   * umzuschreiben; der Unveraenderlichkeits-Ausloeser weist das ohnehin ab,
   * aber mit einem Fehler, der nichts erklaert.
   */
  const [kopf] = await db.abfrage<{ id: string; status: string }>(
    `select id, status::text as status from kalkulation
      where angebot_id = $1 for update`, [angebotId]);
  if (kopf === undefined) {
    throw new KalkulationFehler('Zu diesem Angebot gibt es keine Kalkulation', 'nicht_gefunden');
  }
  if (kopf.status === 'festgeschrieben') {
    throw new KalkulationFehler(
      'Diese Kalkulation ist festgeschrieben und wird nicht mehr geaendert', 'eingefroren');
  }

  const frequenzMilli = eingabe.frequenzFaktor === null
    ? null
    : frequenzFaktorInMilli(eingabe.frequenzFaktor);

  await db.abfrage(
    `update kalkulation
        set stundenverrechnungssatz_cent = $2,
            gemeinkosten_basis = $3::gemeinkosten_basis,
            gemeinkosten_bp = $4,
            wagnis_gewinn_bp = $5,
            ist_platzhalter = false,
            frequenz_ist_platzhalter = case when $7::boolean
                                            then false
                                            else frequenz_ist_platzhalter end,
            geaendert_von = $6
      where id = $1`,
    [kopf.id, String(satz), eingabe.gemeinkostenBasis, gk, wg, eingabe.benutzerId,
     frequenzMilli !== null]);

  if (eingabe.leistungswerteBestaetigen) {
    /**
     * Der SCHNAPPSCHUSS dieser Kalkulation — nicht `belagsart`.
     *
     * Der Katalog bleibt unberuehrt: eine Zusage fuer dieses Angebot ist
     * keine Zusage fuer jedes andere, und schon gar keine rueckwirkende.
     * Wer den Katalogwert gruppenweit festschreiben will, tut das als eigene
     * Handlung an der Belagsart — sichtbar, mit eigenem Recht.
     */
    await db.abfrage(
      `update kalkulation_position
          set leistungswert_ist_platzhalter = false
        where kalkulation_id = $1 and leistungswert_ist_platzhalter`,
      [kopf.id]);
  }

  /**
   * Und jetzt das Rechnen — der Teil, der vorher fehlte.
   *
   * Die Bestaetigung schrieb bisher nur die Tarifzahlen in den Kopf und
   * loeschte die Raute. Die Betraege in `kalkulation_position` und die Preise
   * in `angebotsposition` blieben stehen: gerechnet auf dem PLATZHALTER-Satz.
   * Die Seite meldete „bestaetigt“, die Sperre liess das Angebot hinaus, und
   * hinausgegangen waeren Cent, die aus dem geschaetzten Satz stammten. Ein
   * bestaetigter Preis, den niemand mit den bestaetigten Zahlen gerechnet
   * hat, ist die gefaehrlichste Sorte: er sieht geprueft aus.
   */
  await rechneKalkulationNeu(db, kopf.id, angebotId,
    { stundensatz: satz, gemeinkostenBp: gk, wagnisGewinnBp: wg }, frequenzMilli);

  return { bestaetigt: true };
}

/** Die Tarifzahlen, mit denen neu gerechnet wird. */
interface BestaetigterTarif {
  readonly stundensatz: Cent;
  readonly gemeinkostenBp: number;
  readonly wagnisGewinnBp: number;
}

/** Eine gespeicherte Lohnzeile, so wie sie zum Rechnen wieder gebraucht wird. */
interface GespeicherteZeile {
  readonly id: string;
  readonly position_nr: number;
  readonly bezeichnung: string;
  readonly belagsart_id: string | null;
  readonly flaeche_milli: string | null;
  readonly leistungswert_milli: string | null;
  readonly frequenz_faktor_milli: string | null;
  readonly leistungswert_ist_platzhalter: boolean;
}

/**
 * Rechnet die gespeicherte Kalkulation mit den bestaetigten Zahlen NEU.
 *
 * Gerechnet wird aus den SCHNAPPSCHUESSEN der Zeilen — Flaeche und
 * Leistungswert, wie sie zur Zeit der ersten Rechnung galten — und nicht aus
 * dem heutigen Raumbuch. Das ist der Unterschied zwischen „dieselbe Grundlage,
 * andere Tarifzahlen“ und „ein neues Angebot mit demselben Namen“: wer einen
 * Stundensatz bestaetigt, bestaetigt keinen zwischenzeitlich geaenderten
 * Raumbestand mit.
 *
 * Gerufen wird `kalkuliere` — dieselbe Funktion wie beim ersten Mal, mit
 * denselben Tests. Eine zweite Rechenfassung hier waere eine zweite Wahrheit
 * ueber den Preis.
 */
async function rechneKalkulationNeu(
  db: Abfrage, kalkulationId: string, angebotId: string,
  tarif: BestaetigterTarif, frequenzMilli: bigint | null,
): Promise<void> {
  const zeilen = await db.abfrage<GespeicherteZeile>(
    `select p.id, p.position_nr, p.bezeichnung, p.belagsart_id,
            p.operanden->>'flaeche_milli'          as flaeche_milli,
            p.operanden->>'leistungswert_milli'    as leistungswert_milli,
            p.operanden->>'frequenz_faktor_milli'  as frequenz_faktor_milli,
            p.leistungswert_ist_platzhalter
       from kalkulation_position p
      where p.kalkulation_id = $1 and p.kostenart = 'lohn'
      order by p.position_nr`, [kalkulationId]);
  if (zeilen.length === 0) return;

  const posten: Flaechenposten[] = [];
  for (const z of zeilen) {
    if (z.flaeche_milli === null || z.leistungswert_milli === null) {
      // Eine Lohnzeile ohne ihre Eingangsgroessen laesst sich nicht
      // nachrechnen. Lieber benannt abbrechen als die Haelfte neu bepreisen.
      throw new KalkulationFehler(
        `Der Kalkulationszeile ${z.position_nr} fehlen die Operanden — sie laesst `
        + 'sich nicht neu rechnen', 'unvollstaendig');
    }
    posten.push({
      belagsartId: z.belagsart_id ?? '',
      bezeichnung: z.bezeichnung,
      flaeche: BigInt(z.flaeche_milli) as MilliMenge,
      leistungswert: BigInt(z.leistungswert_milli) as MilliMenge,
      leistungswertIstPlatzhalter: z.leistungswert_ist_platzhalter,
    });
  }

  const faktor = frequenzMilli
    ?? BigInt(zeilen[0]?.frequenz_faktor_milli ?? '0');
  if (faktor <= 0n) {
    throw new KalkulationFehler(
      'Ohne Frequenzfaktor laesst sich die Kalkulation nicht rechnen', 'unvollstaendig');
  }

  const neu = kalkuliere({
    posten,
    frequenz: { faktor: faktor as MilliMenge, istPlatzhalter: frequenzMilli === null,
                offeneFragen: frequenzMilli === null ? ['O-56'] : [] },
    tarif: {
      stundensatz: tarif.stundensatz,
      gemeinkostenSatz: basisPunkte(tarif.gemeinkostenBp),
      // Wagnis und Gewinn liegen als EIN bestaetigter Satz vor
      // (`wagnis_gewinn_bp`). Er wirkt als Wagnis; der Gewinnsatz bleibt
      // null, damit nicht zweimal aufgeschlagen wird.
      wagnisSatz: basisPunkte(tarif.wagnisGewinnBp),
      gewinnSatz: basisPunkte(0),
      istPlatzhalter: false,
      offeneFragen: [],
    },
  });

  const preise = verteileNetto(neu.zeilen, neu.netto);

  for (const [i, z] of zeilen.entries()) {
    const zeile = neu.zeilen[i];
    const preis = preise[i];
    if (zeile === undefined || preis === undefined) continue;
    const stunden = (Number(zeile.sekundenJePeriode) / 3600).toFixed(3);

    await db.abfrage(
      `update kalkulation_position
          set menge = $2::numeric,
              einzelbetrag_cent = $3,
              betrag_cent = $4,
              frequenz_faktor = $5::numeric,
              stundensatz_cent = $3,
              operanden = operanden || $6::jsonb
        where id = $1`,
      [z.id, stunden, String(tarif.stundensatz), String(zeile.lohnkosten),
       (Number(faktor) / 1000).toFixed(4),
       {
         frequenz_faktor_milli: String(faktor),
         sekunden_je_durchgang: String(zeile.sekundenJeDurchgang),
         sekunden_je_periode: String(zeile.sekundenJePeriode),
         stundensatz_cent: String(tarif.stundensatz),
         lohnkosten_cent: String(zeile.lohnkosten),
         nettoanteil_cent: String(preis),
         nachgerechnet_am_bestaetigt: true,
       }]);

    await db.abfrage(
      `update angebotsposition set einzelpreis_cent = $3
        where angebot_id = $1 and position_nr = $2`,
      [angebotId, z.position_nr, String(preis)]);
  }

  /**
   * Die Zuschlaege als EIGENE Kalkulationszeilen — sonst widersprechen sich
   * zwei Summen im selben Datensatz.
   *
   * `kern.aktualisiere_kalkulation_summen` bildet
   * `kalkulation.angebotssumme_netto_cent` aus `kalkulation_position`. Stehen
   * dort nur Lohnzeilen, ist die Kalkulationssumme der reine Lohn, waehrend
   * `angebot.netto_cent` aus den verteilten Preisen den vollen Netto traegt.
   * Dieselbe Kalkulation nennt dann zwei Betraege, und beide sehen richtig
   * aus. Gemeinkosten und Wagnis/Gewinn bekommen deshalb je eine Zeile.
   */
  const zuschlaege: readonly (readonly [string, Cent, string, number])[] = [
    ['gemeinkosten', neu.gemeinkosten, 'Gemeinkosten', tarif.gemeinkostenBp],
    ['wagnis_gewinn', addiere(neu.wagnis, neu.gewinn), 'Wagnis und Gewinn',
     tarif.wagnisGewinnBp],
  ];
  /**
   * Geaendert wird eine vorhandene Zuschlagszeile, angelegt nur die fehlende.
   *
   * Loeschen und neu schreiben waere der kuerzere Weg und ist hier gesperrt:
   * `kalkulation_position` traegt `trg_kalkulation_position_kein_hard_delete`
   * und `cse_app` hat kein DELETE (Invariante 8). Das ist keine Huerde, die
   * es zu umgehen gaebe — eine Kalkulationszeile ist ein Beleg dafuer, wie
   * ein Preis entstand, und ein Beleg verschwindet nicht, weil sich der Preis
   * geaendert hat.
   */
  let nr = zeilen.length;
  for (const [art, betrag, bezeichnung, bp] of zuschlaege) {
    const [vorhanden] = await db.abfrage<{ id: string }>(
      `select id from kalkulation_position
        where kalkulation_id = $1 and kostenart = $2::kostenart
        order by position_nr limit 1`, [kalkulationId, art]);

    if (vorhanden !== undefined) {
      await db.abfrage(
        `update kalkulation_position
            set betrag_cent = $2, satz_bp = $3, basis_bezugsbetrag_cent = $4,
                operanden = operanden || $5::jsonb
          where id = $1`,
        [vorhanden.id, String(betrag), bp, String(neu.lohnkosten),
         { basis_cent: String(neu.lohnkosten), satz_bp: String(bp),
           betrag_cent: String(betrag) }]);
      continue;
    }

    // Ein Zuschlag von null bekommt keine neue Zeile — eine vorhandene wird
    // aber oben auf null gesetzt, statt stehen zu bleiben.
    if ((betrag as bigint) === 0n) continue;
    nr += 1;
    await db.abfrage(
      `insert into kalkulation_position
         (mandant_id, kalkulation_id, position_nr, kostenart, bezeichnung,
          menge, einheit, betrag_cent, satz_bp, basis_bezugsbetrag_cent,
          rechenansatz, operanden, berechnungsweg, sortierung)
       values (app.aktiver_mandant(), $1, $2, $3::kostenart, $4,
               1, 'psch', $5, $6, $7, $8, $9::jsonb, $10, $2)`,
      [kalkulationId, nr, art, bezeichnung, String(betrag), bp,
       String(neu.lohnkosten),
       `${bezeichnung} = Bezugsbetrag × ${(bp / 100).toFixed(2)} %`,
       { basis_cent: String(neu.lohnkosten), satz_bp: String(bp),
         betrag_cent: String(betrag) },
       `${bezeichnung} auf der bestaetigten Grundlage — siehe Kalkulationskopf`]);
  }
}
