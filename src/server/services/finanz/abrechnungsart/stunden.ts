/**
 * `stundenbasiert` — die Stundenlohnabrechnung (FIN-01, TIM-12, FIN-07).
 *
 * **Die Zeile ist die Summe erfasster MINUTEN, hier neu gerechnet.** Nicht aus
 * dem Stundenkonto uebernommen, nicht aus der Oberflaeche, nicht aus einem
 * Nachweis: gelesen wird `zeiteintrag`, und zwar nur, was freigegeben und noch
 * nicht abgerechnet ist. Eine uebernommene Zahl ist eine zweite Wahrheit neben
 * den Zeiteintraegen, und die zweite ist die, die bei der naechsten Korrektur
 * veraltet — waehrend die Rechnung, auf der sie steht, unveraenderlich ist.
 *
 * **Warum die Zeile Minuten fuehrt und nicht Stunden.** In Stunden mit drei
 * Nachkommastellen ist 100 Minuten `1,667`, und `1,667 × 25,00 €` ist 41,68 €,
 * waehrend `100 × 25,00 € / 60` 41,67 € ergibt. Ein Cent, jeden Monat, auf
 * einem Beleg, der sich nicht mehr aendern laesst. Die Zeile fuehrt deshalb
 * Minuten als Menge und den Stundensatz ueber `preis_basismenge = 60`
 * (BT-149/150) — dann ist sie exakt UND in sich nachrechenbar: wer
 * `menge / preis_basismenge × einzelpreis` rechnet, bekommt genau
 * `netto_cent`.
 *
 * **Gerundet wird EINMAL, am Ende.** Erst werden alle Minuten summiert, dann
 * einmal auf die vereinbarte Stufe gerundet, dann einmal in Cent umgerechnet.
 * Je Eintrag zu runden und danach zu summieren ergibt messbar etwas anderes.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: auf welche Stufe werden erfasste Minuten gerundet (minutengenau, 5,
 * 15), und wird je Eintrag oder je Rechnungszeile gerundet?
 */
import { type Cent } from '../geld.js';
import { type MilliMenge, milliMenge } from '../menge.js';
import { berechneNetto, type Abfrage } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type HerkunftVerweis,
  type RechnungspositionEntwurf,
  fehler,
  leistungszeitraum,
  loeseSteuergruppe,
  parameterGanzzahl,
  pruefeParameter,
  warnung,
} from './typen.js';

/** Eine Minute in Tausendsteln der Einheit „min". */
const MINUTE: MilliMenge = milliMenge(1000n);
/** Die Basismenge der Zeile: der Stundensatz gilt je 60 Minuten. */
const STUNDE_IN_MINUTEN: MilliMenge = milliMenge(60_000n);

interface ZeitZeile {
  readonly id: string;
  readonly auftrag_leistung_id: string;
  readonly bezeichnung: string;
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly netto_minuten: number;
}

/**
 * Die freigegebenen, noch nicht abgerechneten Minuten eines Auftrags im
 * Zeitraum.
 *
 * Vier Filter, und jeder einzelne verhindert eine falsche Rechnung:
 *  · `freigegeben_am is not null` — ungeprueft erfasste Zeit geht nicht in eine
 *    Rechnung (EMP-04, TIM-12).
 *  · `abgerechnet_am is null` — dieselbe Stunde nicht zweimal (FIN-07). Der
 *    zweite, staerkere Schutz ist `rechnungsposition_quelle` (PR 49); beide
 *    sind gewollt, keiner ersetzt den anderen.
 *  · `storniert_am is null and ersetzt_am is null` — eine korrigierte Erfassung
 *    ist eine NEUE Zeile; die alte mitzurechnen verdoppelte die Schicht.
 *  · `ende_zeitpunkt is not null` — eine laufende Schicht hat keine Dauer.
 *
 * `dauer_netto_minuten` und nicht brutto: die Pause ist nicht gearbeitet und
 * nicht abrechenbar — und es ist dieselbe Zahl, die `bucheFreigegebeneZeiten`
 * auf das Stundenkonto bucht, was Abnahme (2) verlangt.
 *
 * Das Zeitfenster ist BERLINER Wanduhr (K-11): `($1::date)::timestamp at time
 * zone …` — der nackte `($1::date) at time zone` waehlt die falsche
 * Ueberladung und schoebe das Fenster im Sommer um zwei Stunden, also genau um
 * die Nachtschicht.
 */
async function ladeMinuten(
  db: Abfrage, auftragId: string, auftragLeistungId: string | null,
  von: string, bis: string,
): Promise<readonly ZeitZeile[]> {
  return db.abfrage<ZeitZeile>(
    `select z.id, z.auftrag_leistung_id::text as auftrag_leistung_id,
            al.bezeichnung, al.steuersatz_bp,
            al.steuer_kennzeichen::text as steuer_kennzeichen,
            z.dauer_netto_minuten as netto_minuten
       from zeiteintrag z
       join auftrag_leistung al
         on al.mandant_id = z.mandant_id and al.id = z.auftrag_leistung_id
      where al.auftrag_id = $1
        and ($2::uuid is null or z.auftrag_leistung_id = $2::uuid)
        and z.freigegeben_am is not null
        and z.abgerechnet_am is null
        and z.storniert_am is null
        and z.ersetzt_am is null
        and z.ende_zeitpunkt is not null
        and z.dauer_netto_minuten is not null
        and z.beginn_zeitpunkt >= ($3::date)::timestamp at time zone 'Europe/Berlin'
        and z.beginn_zeitpunkt <  ($4::date + 1)::timestamp at time zone 'Europe/Berlin'
      order by al.position_nr, z.beginn_zeitpunkt`,
    [auftragId, auftragLeistungId, von, bis],
  );
}

/** Auf die vereinbarte Stufe aufgerundet — kaufmaennisch, halb auf. */
function rundeMinuten(minuten: number, stufe: number): number {
  if (stufe <= 1) return minuten;
  return Math.round(minuten / stufe) * stufe;
}

/**
 * `105` → `"1,75"`. Nur fuer den ANZEIGETEXT der Zeile — hier entsteht kein
 * Betrag, und `netto_cent` wird aus Minuten und Cent-Satz gerechnet, nicht
 * aus dieser Zeichenkette.
 *
 * **Die Division ist Gleitkomma, und das war hier als „ganze Arithmetik"
 * beschrieben — das stimmte nicht.** `/` auf `number` ist in JavaScript immer
 * Gleitkomma; ganzzahlig wird es erst durch `Math.round` und `Math.trunc`
 * darunter. Der Satz stand neben einem Betragsrechner, und die naechste
 * Person haette ihn als Freibrief gelesen.
 *
 * Richtig ist das Ergebnis trotzdem, und zwar beweisbar: `minuten * 100 / 60`
 * ist `minuten * 5 / 3`, der gebrochene Anteil also stets 0, 1/3 oder 2/3 —
 * nie 1/2. Der einzige Fall, in dem ein Rundungsfehler im letzten Bit die
 * Entscheidung kippen koennte, kann gar nicht auftreten. `minuten * 100` ist
 * ausserdem fuer jede Minutenzahl, die diese Plattform erzeugen kann, exakt
 * darstellbar.
 *
 * Wer hier einmal einen BETRAG rechnet, nimmt `bigint` — Invariante 1, und
 * dann traegt dieser Absatz nicht mehr.
 */
function stundenText(minuten: number): string {
  const hundertstel = Math.round((minuten * 100) / 60);
  const ganz = Math.trunc(hundertstel / 100);
  const rest = Math.abs(hundertstel % 100);
  return `${String(ganz)},${String(rest).padStart(2, '0')}`;
}

export const STUNDENBASIERT: Abrechnungsart = {
  schluessel: 'stundenbasiert',
  bezeichnung: 'Stundenlohn',
  istProvisorisch: true,
  // V-207: jeder Zeiteintrag sperrt sich selbst (quelle_zeiteintrag_uk, D-700).
  sperrtUeberBeleg: true,
  offeneParameter: [
    {
      schluessel: 'minuten_rundung',
      frage: 'Auf welche Stufe werden erfasste Minuten gerundet — minutengenau (1), '
        + 'auf 5 oder auf 15 Minuten?',
      werte: ['1', '5', '15'],
      offeneFrage: 'O-04',
    },
  ],

  async pruefe(db, eingabe): Promise<readonly AbrechnungsBefund[]> {
    const befunde = [...pruefeParameter(STUNDENBASIERT, eingabe.konfiguration)];
    if (eingabe.konfiguration.stundensatzCent === null) {
      befunde.push(fehler(
        'stundensatz_cent',
        'Der Vertrag führt keinen Stundensatz — eine Stundenlohnrechnung hat damit '
        + 'keinen Preis.',
      ));
    }
    const zeilen = await ladeMinuten(
      db, eingabe.konfiguration.auftragId, eingabe.konfiguration.auftragLeistungId,
      eingabe.periode.von, eingabe.periode.bis,
    );
    if (zeilen.length === 0) {
      befunde.push(warnung(
        'zeiteintrag',
        'Für diesen Zeitraum ist keine freigegebene, noch nicht abgerechnete Zeit '
        + 'erfasst. Eine Stundenlohnrechnung über null Minuten wäre keine (FIN-18).',
      ));
    }
    return befunde;
  },

  async positionen(db, eingabe): Promise<readonly RechnungspositionEntwurf[]> {
    const { konfiguration, periode } = eingabe;
    const stufe = parameterGanzzahl(konfiguration, 'minuten_rundung', 'O-04');
    const satz: Cent | null = konfiguration.stundensatzCent;
    if (satz === null) {
      throw new AbrechnungFehler(
        'Der Vertrag führt keinen Stundensatz (vertrag_abrechnung.stundensatz_cent).',
        'kein_preis',
      );
    }

    const zeilen = await ladeMinuten(
      db, konfiguration.auftragId, konfiguration.auftragLeistungId,
      periode.von, periode.bis,
    );
    if (zeilen.length === 0) {
      throw new AbrechnungFehler(
        `Für ${periode.von} bis ${periode.bis} ist keine freigegebene, noch nicht `
        + 'abgerechnete Zeit erfasst.',
        'nichts_abzurechnen',
      );
    }

    /**
     * Eine Zeile JE LEISTUNGSZEILE, nicht je Zeiteintrag: die Rechnung nennt
     * die handelsuebliche Bezeichnung der vereinbarten Leistung (§14 Abs. 4
     * Nr. 5 UStG), nicht die Schicht des einzelnen Menschen. Wer welche
     * Schicht geleistet hat, ist die Herkunft (FIN-07) — und geht den Kunden
     * nichts an (EMP-13).
     */
    const jeLeistung = new Map<string, ZeitZeile[]>();
    for (const z of zeilen) {
      const liste = jeLeistung.get(z.auftrag_leistung_id) ?? [];
      liste.push(z);
      jeLeistung.set(z.auftrag_leistung_id, liste);
    }

    const zeitraum = leistungszeitraum(konfiguration, periode);
    const mindestMinuten = konfiguration.mindestabnahmeStunden === null
      ? 0n
      : (konfiguration.mindestabnahmeStunden * 60n) / 1000n;

    const entwuerfe: RechnungspositionEntwurf[] = [];
    for (const [leistungId, eintraege] of jeLeistung) {
      const erste = eintraege[0]!;
      // Summieren, DANN runden — einmal, am Ende.
      const roh = eintraege.reduce((s, z) => s + Number(z.netto_minuten), 0);
      const gerundet = rundeMinuten(roh, stufe);
      const abzurechnen = BigInt(gerundet) < mindestMinuten ? mindestMinuten : BigInt(gerundet);
      if (abzurechnen === 0n) continue;

      const menge = milliMenge(abzurechnen * MINUTE);
      const netto = berechneNetto(menge, STUNDE_IN_MINUTEN, satz, 0);
      const steuergruppe = await loeseSteuergruppe(
        db, erste.steuer_kennzeichen, erste.steuersatz_bp, periode.bis,
      );

      const herkunft: HerkunftVerweis[] = eintraege.map((z) => ({
        art: 'zeiteintrag' as const,
        id: z.id,
        anteil: milliMenge(BigInt(z.netto_minuten) * MINUTE),
      }));

      entwuerfe.push({
        bezeichnung: erste.bezeichnung,
        beschreibung:
          `${String(gerundet)} Minuten (${stundenText(gerundet)} Std.) `
          + `aus ${String(eintraege.length)} Zeiteinträgen, `
          + `Rundung auf ${String(stufe)} Minuten — provisorisch (O-04)`,
        menge,
        einheit: 'min',
        preisBasismenge: STUNDE_IN_MINUTEN,
        einzelpreisCent: satz,
        nettoCent: netto,
        steuergruppe,
        abrechnungsart: STUNDENBASIERT.schluessel,
        vertragAbrechnungId: konfiguration.id,
        auftragLeistungId: leistungId,
        lvPositionId: null,
        leistungVon: zeitraum.von,
        leistungBis: zeitraum.bis,
        herkunft,
      });
    }
    return entwuerfe;
  },
};
