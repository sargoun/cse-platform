import 'server-only';
import { cent, formatiereGeld } from '../../services/finanz/geld.js';
import { kalkuliere } from '../../services/kalkulation/index.js';
import { ladeKalkulationsgrundlage } from '../../services/kalkulation/raumbuch.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF } from '../../services/kalkulation/tarif.js';
import type { HandleTresor } from './handles.js';
import type { Wertregister } from './register.js';
import type { GebundenerWert, Quelle, WerkzeugErgebnis } from './typen.js';

/**
 * `berechne_preis` — **reiner Code** (AGT-02, Invariante 6).
 *
 * **Das Werkzeug, das die Grenze markiert.** Ein Modell darf ein Angebot
 * formulieren; es darf seinen Preis nicht bilden. Der Unterschied ist nicht
 * akademisch: eine geratene Quadratmeterleistung verschiebt eine Kalkulation
 * über 486.000 € um zehn Prozent, und niemand sieht es — ein plausibler
 * falscher Preis liest sich wie ein plausibler richtiger.
 *
 * Deshalb ruft dieses Werkzeug `kalkuliere()`. **Dieselbe Funktion**, die die
 * Angebotsseite ruft, mit denselben Tests dahinter: die Halb-auf-Rundung, die
 * Zuschlagsreihenfolge (Wagnis auf die Zwischensumme, Gewinn auf Zwischensumme
 * plus Wagnis) und die Regel, dass die Summe die Summe der ANGEZEIGTEN Zeilen
 * ist. Eine zweite Implementierung „für den Agenten" wäre ein zweiter Preis.
 *
 * **Was es nicht annimmt**: keine Fläche, keinen Stundensatz, keinen
 * Frequenzfaktor. Es bekommt ein Objekthandle und einen Turnus aus einer
 * geschlossenen Liste — alles andere liest es selbst aus dem Raumbuch.
 *
 * **Was es zurückgibt**: gebundene Werte. Der Agent bekommt `z1` und „456,00 €",
 * nicht `45600`. Er kann den Token in einen Satz schreiben; er kann ihn nicht
 * verrechnen.
 *
 * **Und was es mitliefert, ist genauso wichtig**: die Fläche ohne Belagsart
 * und die Belagsarten ohne gültigen Leistungswert. Diese Flächen stecken in
 * KEINER Zeile des Preises. Ein Werkzeug, das nur die Summe herausgibt,
 * meldete einen vollständigen Preis für ein halbes Objekt.
 */

export interface PreisEingabe {
  /** Das Objekt — als Handle, nie als uuid aus einem Text. */
  readonly objekt: string;
  /** Aus der geschlossenen Liste der Turnusse; keine Zahl, kein Faktor. */
  readonly turnus: string;
  /** Das Gewerk für den Tarif. */
  readonly gewerk: 'reinigung' | 'security' | 'bau';
}

export interface PreisDaten {
  readonly nettoToken: string;
  readonly lohnToken: string;
  readonly flaecheToken: string;
  readonly stundenToken: string;
  /** Wahr, solange O-16 (Tarif) oder O-56 (Frequenz) offen sind. */
  readonly istPlatzhalter: boolean;
  readonly offeneFragen: readonly string[];
  /** Fläche in Räumen ohne Belagsart — NICHT im Preis enthalten. */
  readonly flaecheOhneBelagsartQm: string;
  /** Belagsarten ohne gültigen Leistungswert — ihre Fläche fehlt im Preis. */
  readonly ohneGueltigenLeistungswert: readonly string[];
  readonly zeilen: readonly { readonly bezeichnung: string; readonly anteilToken: string }[];
}

interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

const DIENST = 'services/kalkulation/index.kalkuliere';
const DIENST_VERSION = 'kalk-v1';

function milliAlsText(milli: bigint): string {
  const ganz = milli / 1000n;
  const rest = (milli < 0n ? -milli : milli) % 1000n;
  return `${String(ganz)},${String(rest).padStart(3, '0')}`;
}

export async function berechnePreis(
  db: Abfrage,
  tresor: HandleTresor,
  register: Wertregister,
  eingabe: PreisEingabe,
  /** Der Stichtag kommt vom Orchestrator aus der Datenbank (Invariante 5). */
  stichtag: Date,
  mandantId: string,
): Promise<WerkzeugErgebnis<PreisDaten>> {
  const start = performance.now();

  let objektId: string;
  try {
    objektId = tresor.loese(eingabe.objekt, 'objekt');
  } catch (fehler) {
    return {
      ok: false,
      fehler: {
        code: 'nicht_gefunden',
        nachricht: fehler instanceof Error ? fehler.message : 'Unbekanntes Handle.',
      },
    };
  }

  const grundlage = await ladeKalkulationsgrundlage(db, objektId, stichtag);
  if (grundlage.posten.length === 0) {
    /*
     * AGT-07 wörtlich: „when it cannot answer from the schema, it says so."
     * Ein Objekt ohne kalkulierbare Fläche ergibt keinen Preis von null — es
     * ergibt gar keinen.
     */
    return {
      ok: false,
      fehler: {
        code: 'kein_ergebnis',
        nachricht: 'Für dieses Objekt liegt keine Fläche mit gültigem Leistungswert vor. '
          + 'Ohne Raumbuch gibt es keinen Preis — auch keinen geschätzten.',
      },
    };
  }

  let frequenz;
  try {
    frequenz = PLATZHALTER_FREQUENZ.frequenz(eingabe.turnus);
  } catch (fehler) {
    return {
      ok: false,
      fehler: {
        code: 'ungueltige_eingabe',
        nachricht: fehler instanceof Error ? fehler.message : 'Unbekannter Turnus.',
      },
    };
  }

  const tarif = PLATZHALTER_TARIF.tarif(mandantId, eingabe.gewerk);
  const k = kalkuliere({
    posten: grundlage.posten,
    frequenz,
    tarif,
    flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
    ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
  });

  /**
   * **Die Herkunft ist `berechnet`, mit Dienstnamen und Eingabenhash.** Damit
   * lässt sich später sagen, welche Funktion in welcher Fassung diese Zahl
   * erzeugt hat — die Frage, die bei einem bestrittenen Angebot als erste
   * kommt.
   */
  const quelle: Quelle = {
    art: 'berechnet',
    dienst: DIENST,
    dienstVersion: DIENST_VERSION,
    eingabenHash: `${objektId}:${eingabe.turnus}:${eingabe.gewerk}:${stichtag.toISOString()}`,
  };

  const binde = (
    art: GebundenerWert['art'], anzeige: string,
    extra: Partial<GebundenerWert>,
  ): GebundenerWert => register.binde({ art, anzeige, quelle, ...extra });

  const netto = binde('geld', formatiereGeld(k.netto), { betragCent: k.netto });
  const lohn = binde('geld', formatiereGeld(k.lohnkosten), { betragCent: k.lohnkosten });
  const flaeche = binde('menge', `${milliAlsText(k.flaecheGesamt)} m²`, {
    wert: milliAlsText(k.flaecheGesamt), einheit: 'm²',
  });
  /* Sekunden je Periode als Stunden — gerechnet, nicht geschätzt. */
  const stundenMilli = (k.sekundenJePeriode * 1000n) / 3600n;
  const stunden = binde('dauer', `${milliAlsText(stundenMilli)} h`, {
    wert: milliAlsText(stundenMilli), einheit: 'h',
  });

  const zeilen = k.zeilen.map((z) => ({
    bezeichnung: z.bezeichnung,
    anteilToken: binde('geld', formatiereGeld(z.lohnkosten), {
      betragCent: cent(z.lohnkosten),
    }).token,
  }));

  return {
    ok: true,
    daten: {
      nettoToken: netto.token,
      lohnToken: lohn.token,
      flaecheToken: flaeche.token,
      stundenToken: stunden.token,
      istPlatzhalter: k.istPlatzhalter,
      offeneFragen: k.offeneFragen,
      flaecheOhneBelagsartQm: milliAlsText(k.flaecheOhneBelagsart),
      ohneGueltigenLeistungswert: k.ohneGueltigenLeistungswert,
      zeilen,
    },
    werte: register.alle(),
    dauerMs: Math.round(performance.now() - start),
  };
}
