/**
 * Der Raumbuch-Import (OPS-04) — hochladen, PRUEFEN, dann uebernehmen.
 *
 * Die Vorschau ist nicht Hoeflichkeit, sie ist die Zusage: nichts beruehrt
 * das lebende Raumbuch, bevor ein Mensch gesehen hat, was passieren wird.
 * Ein Import, der direkt schreibt, macht aus einem vertauschten Spaltenkopf
 * tausend falsche Quadratmeter — und die tauchen erst im Angebotspreis
 * wieder auf, wo sie plausibel aussehen.
 *
 * Der Abgleich laeuft ueber den STABILEN Schluessel, wenn die Tabelle einen
 * mitbringt, sonst ueber (Etage, Raumnummer) — denselben natuerlichen
 * Schluessel, den das Raumbuch selbst benutzt (D-91). Damit ist ein zweiter
 * Import derselben Datei "unveraendert" und nicht "tausend neue Raeume".
 */
import { alsNumerisch, leseZahl, leseCsv, TabellenFehler } from './tabelle.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Aktion = 'anlegen' | 'aktualisieren' | 'unveraendert' | 'ignorieren';

/** Die Zielfelder, auf die eine Quellspalte zeigen kann. */
export const ZIELFELDER = [
  'raumnummer', 'bezeichnung', 'etage', 'nutzungsart',
  'flaeche_qm', 'fenster_flaeche_qm', 'belagsart_code', 'reinigungsklasse_code',
  'quell_schluessel',
] as const;
export type Zielfeld = (typeof ZIELFELDER)[number];

export type Zuordnung = Readonly<Partial<Record<Zielfeld, string>>>;

/**
 * Die Vorschlagszuordnung — geraten, aber sichtbar.
 *
 * Sie ist ein Vorschlag und keine Entscheidung: die Vorschau zeigt sie, ein
 * Mensch korrigiert sie. Ein Importeur, der die Spalten still zuordnet, ist
 * genau der, dessen Fehler niemand sieht.
 */
const SPALTENWORTE: Readonly<Record<Zielfeld, readonly string[]>> = {
  raumnummer: ['raumnummer', 'raumnr', 'nummer', 'nr', 'raum'],
  bezeichnung: ['bezeichnung', 'raumbezeichnung', 'name', 'beschreibung'],
  etage: ['etage', 'geschoss', 'stockwerk', 'ebene'],
  nutzungsart: ['nutzungsart', 'nutzung', 'raumart', 'funktion'],
  flaeche_qm: ['flaeche', 'flache', 'qm', 'm2', 'bodenflaeche'],
  fenster_flaeche_qm: ['glas', 'fenster', 'glasflaeche', 'fensterflaeche'],
  belagsart_code: ['belag', 'belagsart', 'bodenbelag', 'boden'],
  reinigungsklasse_code: ['reinigungsklasse', 'klasse', 'rk'],
  quell_schluessel: ['schluessel', 'quellschluessel', 'key', 'id'],
};

/** Vergleichsform eines Spaltennamens: klein, ohne Trenner, ohne Umlaute. */
function normal(text: string): string {
  return text.toLowerCase()
    .replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u')
    .replaceAll('ß', 'ss').replaceAll('²', '2')
    .replace(/[^a-z0-9]/gu, '');
}

export function schlageZuordnungVor(kopf: readonly string[]): Zuordnung {
  const vorschlag: Partial<Record<Zielfeld, string>> = {};
  const belegt = new Set<string>();
  for (const feld of ZIELFELDER) {
    const worte = SPALTENWORTE[feld].map(normal);
    // Erst die genaue Uebereinstimmung, dann die enthaltene: sonst nimmt
    // "Raumnummer" die Spalte "Raum" weg, und die Nummer landet nirgends.
    const genau = kopf.find((s) => !belegt.has(s) && worte.includes(normal(s)));
    const treffer = genau
      ?? kopf.find((s) => !belegt.has(s) && worte.some((w) => normal(s).includes(w)));
    if (treffer !== undefined) { vorschlag[feld] = treffer; belegt.add(treffer); }
  }
  return vorschlag;
}

export interface GepruefteZeile {
  readonly zeilennummer: number;
  readonly rohdaten: Readonly<Record<string, string>>;
  readonly quellSchluessel: string | null;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  /** In der Form, die numeric(12,3) erwartet — oder null. */
  readonly flaecheQm: string | null;
  readonly fensterFlaecheQm: string | null;
  readonly belagsartCode: string | null;
  readonly reinigungsklasseCode: string | null;
  readonly belagsartId: string | null;
  readonly reinigungsklasseId: string | null;
  readonly raumId: string | null;
  readonly istGueltig: boolean;
  readonly fehler: readonly string[];
  readonly aktion: Aktion;
}

export interface Vorschau {
  readonly kopf: readonly string[];
  readonly zuordnung: Zuordnung;
  readonly zeilen: readonly GepruefteZeile[];
  readonly gesamt: number;
  readonly gueltig: number;
  readonly fehlerhaft: number;
  readonly anlegen: number;
  readonly aktualisieren: number;
  readonly unveraendert: number;
}

interface RaumZeile {
  readonly id: string;
  readonly quell_schluessel: string | null;
  readonly etage: string | null;
  readonly raumnummer: string | null;
  readonly flaeche_qm: string;
  readonly fenster_flaeche_qm: string | null;
  readonly bezeichnung: string | null;
  readonly nutzungsart: string | null;
  readonly belagsart_id: string | null;
  readonly reinigungsklasse_id: string | null;
}

/**
 * Der natuerliche Schluessel einer Raumbuchzeile — mit einem Rueckfall, der
 * einen echten Fehler verhindert.
 *
 * (Etage, Raumnummer) ist der Schluessel des Raumbuchs (D-91). Nur: ein
 * echtes Raumbuch enthaelt Flur, Treppenhaus und Aufzugsvorraum OHNE
 * Tuernummer, und die liessen sich damit bei einem zweiten Import nicht
 * wiedererkennen — jeder Lauf legte den Flur erneut an, und die Flaeche des
 * Objekts wuechse bei jedem Import.
 *
 * Fuer eine Zeile ohne Nummer traegt deshalb die BEZEICHNUNG die Identitaet.
 * Das ist keine zweite Wahrheit neben D-91: der Eindeutigkeitsindex bleibt
 * (Etage, Raumnummer) und greift fuer nummerierte Raeume; hier geht es
 * darum, WIEDERZUERKENNEN, was die Datei zum zweiten Mal bringt.
 *
 * Hat eine Zeile weder Nummer noch Bezeichnung, ist sie nicht
 * wiedererkennbar — und die Vorschau sagt das, statt es zu verschweigen.
 */
const TRENNER = '\u241F';

function schluesselAus(
  etage: string | null, nummer: string | null, bezeichnung: string | null,
): string | null {
  const e = (etage ?? '').trim().toLowerCase();
  if (nummer !== null && nummer.trim() !== '') {
    return `${e}${TRENNER}${nummer.trim().toLowerCase()}`;
  }
  if (bezeichnung !== null && bezeichnung.trim() !== '') {
    return `${e}${TRENNER}~${bezeichnung.trim().toLowerCase()}`;
  }
  return null;
}

/**
 * Liest die Datei, gleicht gegen das lebende Raumbuch ab und sagt je Zeile,
 * was passieren WUERDE. Schreibt nichts.
 */
export async function pruefe(
  db: Abfrage, objektId: string, inhalt: string, zuordnungVorgabe?: Zuordnung,
): Promise<Vorschau> {
  const tabelle = leseCsv(inhalt);
  const zuordnung = zuordnungVorgabe ?? schlageZuordnungVor(tabelle.kopf);

  const bestand = await db.abfrage<RaumZeile>(
    `select id, quell_schluessel, etage, raumnummer, flaeche_qm::text,
            fenster_flaeche_qm::text, bezeichnung, nutzungsart,
            belagsart_id::text, reinigungsklasse_id::text
       from raum where objekt_id = $1 and archiviert_am is null`,
    [objektId],
  );
  const nachSchluessel = new Map<string, RaumZeile>();
  const nachNatur = new Map<string, RaumZeile>();
  for (const r of bestand) {
    if (r.quell_schluessel !== null) nachSchluessel.set(r.quell_schluessel, r);
    const natur = schluesselAus(r.etage, r.raumnummer, r.bezeichnung);
    if (natur !== null) nachNatur.set(natur, r);
  }

  const belaege = await db.abfrage<{ id: string; code: string }>(
    `select id, code from belagsart where gueltig_bis is null or gueltig_bis >= current_date`);
  const klassen = await db.abfrage<{ id: string; code: string }>(
    `select id, code from reinigungsklasse where archiviert_am is null`);
  const belagNach = new Map(belaege.map((b) => [b.code.toLowerCase(), b.id]));
  const klasseNach = new Map(klassen.map((k) => [k.code.toLowerCase(), k.id]));

  const wert = (satz: Readonly<Record<string, string>>, feld: Zielfeld): string | null => {
    const spalte = zuordnung[feld];
    if (spalte === undefined) return null;
    const roh = satz[spalte];
    return roh === undefined || roh === '' ? null : roh;
  };

  const gesehen = new Set<string>();
  const zeilen: GepruefteZeile[] = tabelle.zeilen.map((satz, i) => {
    const fehler: string[] = [];
    const raumnummer = wert(satz, 'raumnummer');
    const etage = wert(satz, 'etage');
    const quellSchluessel = wert(satz, 'quell_schluessel');

    const flaecheRoh = wert(satz, 'flaeche_qm');
    const flaecheBefund = flaecheRoh === null ? null : leseZahl(flaecheRoh);
    const flaecheMilli = flaecheBefund?.wert ?? null;
    if (flaecheRoh === null) {
      fehler.push('Keine Flaeche angegeben');
    } else if (flaecheMilli === null) {
      fehler.push(`Flaeche ist keine Zahl: ${flaecheRoh}`);
    } else if (flaecheMilli <= 0n) {
      fehler.push('Die Flaeche muss groesser als 0 sein');
    } else if (flaecheBefund?.mehrdeutig === true) {
      /**
       * 08-PR-PLAN §288 (3): `12.50` wird GEMELDET, nicht stumm umgedeutet.
       * Deutsch gelesen sind es 1250 m², englisch 12,50 — Faktor 100 auf einer
       * Flaeche, aus der ein Preis wird. Die Zeile bleibt uebernehmbar; was
       * sie nicht bleibt, ist unbemerkt.
       */
      fehler.push(`Flaeche mehrdeutig geschrieben: ${flaecheRoh} → `
        + `${flaecheBefund.deutung ?? ''} — bitte bestaetigen`);
    }

    const fensterRoh = wert(satz, 'fenster_flaeche_qm');
    const fensterBefund = fensterRoh === null ? null : leseZahl(fensterRoh);
    const fensterMilli = fensterBefund?.wert ?? null;
    if (fensterRoh !== null && fensterMilli === null) {
      fehler.push(`Glasflaeche ist keine Zahl: ${fensterRoh}`);
    } else if (fensterMilli !== null && fensterMilli < 0n) {
      /**
       * Negative Glasflaeche: sonst faellt sie erst in der Uebernahme auf, an
       * `raum_fensterflaeche_nicht_negativ` — und reisst dort die ganze
       * Transaktion mit, statt als EINE gemeldete Zeile stehen zu bleiben
       * (08-PR-PLAN §288 (4)).
       */
      fehler.push(`Glasflaeche ist negativ: ${fensterRoh}`);
    } else if (fensterBefund?.mehrdeutig === true) {
      fehler.push(`Glasflaeche mehrdeutig geschrieben: ${fensterRoh} → `
        + `${fensterBefund.deutung ?? ''} — bitte bestaetigen`);
    }

    const belagCode = wert(satz, 'belagsart_code');
    const belagId = belagCode === null ? null : belagNach.get(belagCode.toLowerCase()) ?? null;
    if (belagCode !== null && belagId === null) {
      /**
       * KEIN harter Fehler, sondern ein Hinweis.
       *
       * Die Zeile bleibt gueltig, der Raum entsteht ohne Belagsart — und die
       * Kalkulation weist ihn dann als "ohne Belagsart" aus, statt ihn zu
       * verschweigen. Ihn abzuweisen verloere die Flaeche ganz, und das ist
       * der schlechtere Ausgang.
       */
      fehler.push(`Belagsart im Katalog unbekannt: ${belagCode}`);
    }
    const klasseCode = wert(satz, 'reinigungsklasse_code');
    const klasseId = klasseCode === null ? null : klasseNach.get(klasseCode.toLowerCase()) ?? null;
    if (klasseCode !== null && klasseId === null) {
      // Wie bei der Belagsart ein HINWEIS, kein harter Fehler — aber gesagt:
      // eine still verworfene Reinigungsklasse aendert spaeter den Turnus,
      // und niemand weiss dann, dass in der Datei einer stand.
      fehler.push(`Reinigungsklasse im Katalog unbekannt: ${klasseCode}`);
    }

    const bezeichnung = wert(satz, 'bezeichnung');
    const natur = schluesselAus(etage, raumnummer, bezeichnung);
    if (quellSchluessel === null && natur === null) {
      // Kein harter Fehler: der Raum entsteht. Aber beim naechsten Import
      // entstuende er noch einmal, und DAS gehoert gesagt.
      fehler.push('Weder Raumnummer noch Bezeichnung — beim naechsten Import '
        + 'nicht wiedererkennbar');
    }

    // Doppelte Zeilen INNERHALB der Datei — sonst schluege erst der
    // Eindeutigkeitsindex zu, mitten in der Uebernahme.
    const eigen = quellSchluessel ?? natur;
    if (eigen !== null) {
      if (gesehen.has(eigen)) fehler.push('Diese Zeile kommt in der Datei zweimal vor');
      gesehen.add(eigen);
    }

    const treffer = quellSchluessel !== null
      ? nachSchluessel.get(quellSchluessel)
      : (natur === null ? undefined : nachNatur.get(natur));

    /**
     * HINWEISE machen eine Zeile nicht ungueltig, FEHLER schon.
     *
     * Beide stehen im selben Feld, weil die Vorschau beide zeigt — die
     * Unterscheidung liegt darin, ob die Zeile trotzdem uebernommen werden
     * kann. Eine unbekannte Belagsart und ein fehlender Wiedererkennungs-
     * schluessel kosten Information, nicht die Flaeche; eine fehlende Flaeche
     * kostet den Raum.
     */
    const HINWEISE = ['Belagsart im Katalog', 'Weder Raumnummer',
                     'Reinigungsklasse im Katalog',
                     'Flaeche mehrdeutig', 'Glasflaeche mehrdeutig'];
    const istGueltig = !fehler.some((f) => !HINWEISE.some((h) => f.startsWith(h)));
    const flaeche = flaecheMilli === null ? null : alsNumerisch(flaecheMilli);

    let aktion: Aktion = 'anlegen';
    if (!istGueltig) {
      aktion = 'ignorieren';
    } else if (treffer !== undefined) {
      /**
       * Verglichen wird JEDES Feld, das die Uebernahme schreibt.
       *
       * Fehlte eines, meldete die Vorschau `unveraendert`, die Uebernahme
       * uebersprunge die Zeile — und die Aenderung aus der Datei kaeme nie
       * an. Der Import saehe erfolgreich aus und haette nichts getan. Etage
       * und Raumnummer gehoeren dazu, weil ein Raum, den der Quellschluessel
       * wiedererkennt, umgezogen sein kann.
       */
      const gleich = treffer.flaeche_qm === flaeche
        && (treffer.fenster_flaeche_qm ?? null)
           === (fensterMilli === null ? null : alsNumerisch(fensterMilli))
        && (treffer.bezeichnung ?? null) === bezeichnung
        && (treffer.etage ?? null) === etage
        && (treffer.raumnummer ?? null) === raumnummer
        && (treffer.nutzungsart ?? null) === wert(satz, 'nutzungsart')
        && (treffer.belagsart_id ?? null) === belagId
        && (treffer.reinigungsklasse_id ?? null) === klasseId;
      aktion = gleich ? 'unveraendert' : 'aktualisieren';
    }

    return {
      zeilennummer: i + 1,
      rohdaten: satz,
      quellSchluessel,
      raumnummer,
      bezeichnung,
      etage,
      nutzungsart: wert(satz, 'nutzungsart'),
      flaecheQm: flaeche,
      fensterFlaecheQm: fensterMilli === null ? null : alsNumerisch(fensterMilli),
      belagsartCode: belagCode,
      reinigungsklasseCode: klasseCode,
      belagsartId: belagId,
      reinigungsklasseId: klasseId,
      raumId: treffer?.id ?? null,
      istGueltig,
      fehler,
      aktion,
    };
  });

  return {
    kopf: tabelle.kopf,
    zuordnung,
    zeilen,
    gesamt: zeilen.length,
    gueltig: zeilen.filter((z) => z.istGueltig).length,
    fehlerhaft: zeilen.filter((z) => !z.istGueltig).length,
    anlegen: zeilen.filter((z) => z.aktion === 'anlegen').length,
    aktualisieren: zeilen.filter((z) => z.aktion === 'aktualisieren').length,
    unveraendert: zeilen.filter((z) => z.aktion === 'unveraendert').length,
  };
}

/** Legt den Import samt Zwischenzeilen an — noch OHNE das Raumbuch zu beruehren. */
export async function legeImportAn(
  db: Abfrage, objektId: string, dateiname: string, inhalt: string,
  benutzerId?: string,
): Promise<{ readonly importId: string; readonly vorschau: Vorschau }> {
  const vorschau = await pruefe(db, objektId, inhalt);

  const [kopf] = await db.abfrage<{ id: string }>(
    /**
     * `geprueft` MIT Zeitpunkt und Person.
     *
     * Der Status allein sagt, dass geprueft wurde, und verschweigt, wann und
     * von wem — das Ereignis waere damit aufgezeichnet und unbelegt zugleich.
     * Der Zeitstempel-Ausloeser hilft hier nicht: er stempelt nur ein Feld,
     * das bereits gefuellt ist.
     */
    `insert into raumbuch_import (mandant_id, objekt_id, dateiname, spalten_zuordnung,
                                  zeilen_gesamt, zeilen_gueltig, zeilen_fehler, status,
                                  geprueft_am, geprueft_von)
     values (app.aktiver_mandant(), $1, $2, $3::jsonb, $4, $5, $6, 'geprueft',
             now(), $7)
     returning id`,
    /**
     * Das OBJEKT, nicht sein JSON-Text.
     *
     * `JSON.stringify` in einen `jsonb`-Parameter schreibt einen JSON-STRING
     * in die Spalte — `jsonb_typeof` ist dann `string` und nicht `object`,
     * und jeder spaetere `->>`-Zugriff greift ins Leere. Der Treiber
     * serialisiert selbst; ihm zuvorzukommen kodiert zweimal.
     */
    [objektId, dateiname, vorschau.zuordnung as never,
     vorschau.gesamt, vorschau.gueltig, vorschau.fehlerhaft, benutzerId ?? null],
  );
  if (kopf === undefined) throw new TabellenFehler('Der Import wurde nicht angelegt', 'format');

  for (const z of vorschau.zeilen) {
    await db.abfrage(
      `insert into raumbuch_import_zeile
         (mandant_id, import_id, zeilennummer, rohdaten, quell_schluessel, raumnummer,
          bezeichnung, etage, nutzungsart, flaeche_qm, fenster_flaeche_qm,
          belagsart_code, reinigungsklasse_code, belagsart_id, reinigungsklasse_id,
          ist_gueltig, fehler, aktion, raum_id)
       values (app.aktiver_mandant(), $1, $2, $3::jsonb, $4, $5, $6, $7, $8,
               $9::numeric, $10::numeric, $11, $12, $13, $14, $15, $16::text[],
               $17::raumbuch_zeile_aktion, $18)`,
      [kopf.id, z.zeilennummer, z.rohdaten as never, z.quellSchluessel, z.raumnummer,
       z.bezeichnung, z.etage, z.nutzungsart, z.flaecheQm, z.fensterFlaecheQm,
       z.belagsartCode, z.reinigungsklasseCode, z.belagsartId, z.reinigungsklasseId,
       z.istGueltig, z.fehler, z.aktion, z.raumId],
    );
  }
  return { importId: kopf.id, vorschau };
}

export interface Uebernahme {
  readonly angelegt: number;
  readonly aktualisiert: number;
  readonly unveraendert: number;
  readonly uebersprungen: number;
}

interface ZwischenZeile {
  readonly id: string;
  readonly zeilennummer: number;
  readonly aktion: Aktion;
  readonly raum_id: string | null;
  readonly quell_schluessel: string | null;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  readonly flaeche_qm: string | null;
  readonly fenster_flaeche_qm: string | null;
  readonly belagsart_id: string | null;
  readonly reinigungsklasse_id: string | null;
}

/** Der Vorher-Stand eines Raumes — dieselben Felder, die ueberschrieben werden. */
interface VorherZeile {
  readonly flaeche_qm: string | null;
  readonly fenster_flaeche_qm: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly raumnummer: string | null;
  readonly nutzungsart: string | null;
  readonly belagsart_id: string | null;
  readonly reinigungsklasse_id: string | null;
}

/**
 * Der Nachher-Stand, aus der Zwischenzeile — in DERSELBEN Form wie der
 * Vorher-Stand.
 *
 * Zwei Schnappschuesse mit verschiedenen Feldern liessen sich nicht
 * vergleichen, und ein Verlauf, den man nicht vergleichen kann, beantwortet
 * die einzige Frage nicht, die man ihm stellt: was hat sich geaendert?
 */
function standAus(z: ZwischenZeile): VorherZeile {
  return {
    flaeche_qm: z.flaeche_qm,
    fenster_flaeche_qm: z.fenster_flaeche_qm,
    bezeichnung: z.bezeichnung,
    etage: z.etage,
    raumnummer: z.raumnummer,
    nutzungsart: z.nutzungsart,
    belagsart_id: z.belagsart_id,
    reinigungsklasse_id: z.reinigungsklasse_id,
  };
}

/**
 * Die Uebernahme — der einzige Schritt, der das lebende Raumbuch aendert.
 *
 * Sie liest die ZWISCHENZEILEN, nicht die Datei: was der Mensch in der
 * Vorschau gesehen hat, ist das, was passiert. Die Datei ein zweites Mal zu
 * lesen liesse zwischen Vorschau und Uebernahme eine andere Wahrheit zu.
 */
export async function uebernimm(
  db: Abfrage, importId: string, benutzerId: string,
): Promise<Uebernahme> {
  /**
   * `for update` — die Kopfzeile wird GESPERRT, bevor ihr Status gelesen wird.
   *
   * Zwei gleichzeitige Uebernahmen desselben Imports sehen sonst beide einen
   * Status ungleich `uebernommen` und arbeiten beide die Zeilen ab. Fuer
   * Raeume MIT Nummer faengt der natuerliche Schluessel das ab; fuer Raeume
   * ohne Nummer gibt es keinen — und das Raumbuch haette jeden davon zweimal.
   * Die Sperre serialisiert die beiden, und der zweite sieht dann den Status,
   * den der erste hinterlassen hat.
   */
  const [kopf] = await db.abfrage<{ objekt_id: string; status: string }>(
    `select objekt_id::text, status::text from raumbuch_import where id = $1 for update`,
    [importId]);
  if (kopf === undefined) throw new TabellenFehler('Import nicht gefunden', 'format');
  if (kopf.status === 'uebernommen') {
    throw new TabellenFehler('Dieser Import ist bereits uebernommen', 'format');
  }

  const zeilen = await db.abfrage<ZwischenZeile>(
    `select id, zeilennummer, aktion::text as aktion, raum_id::text, quell_schluessel,
            raumnummer, bezeichnung, etage, nutzungsart, flaeche_qm::text,
            fenster_flaeche_qm::text, belagsart_id::text, reinigungsklasse_id::text
       from raumbuch_import_zeile
      where import_id = $1 order by zeilennummer`, [importId]);

  let angelegt = 0;
  let aktualisiert = 0;
  let unveraendert = 0;
  let uebersprungen = 0;

  for (const z of zeilen) {
    if (z.aktion === 'ignorieren') { uebersprungen += 1; continue; }
    if (z.aktion === 'unveraendert') { unveraendert += 1; continue; }

    if (z.aktion === 'anlegen') {
      const [neu] = await db.abfrage<{ id: string }>(
        `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, etage,
                           nutzungsart, flaeche_qm, fenster_flaeche_qm, belagsart_id,
                           reinigungsklasse_id, quell_schluessel, sortierung)
         values (app.aktiver_mandant(), $1, $2, $3, $4, $5, $6::numeric, $7::numeric,
                 $8, $9, $10, $11)
         returning id`,
        [kopf.objekt_id, z.raumnummer, z.bezeichnung, z.etage, z.nutzungsart,
         z.flaeche_qm, z.fenster_flaeche_qm, z.belagsart_id, z.reinigungsklasse_id,
         z.quell_schluessel, z.zeilennummer]);
      if (neu === undefined) throw new TabellenFehler('Raum nicht angelegt', 'format');
      angelegt += 1;
      await db.abfrage(
        `insert into raum_import_historie (mandant_id, raum_id, import_id, import_zeile_id,
                                           aktion, nachher)
         values (app.aktiver_mandant(), $1, $2, $3, 'anlegen', $4::jsonb)`,
        [neu.id, importId, z.id, standAus(z) as never]);
      await db.abfrage(
        `update raumbuch_import_zeile set raum_id = $2 where id = $1`, [z.id, neu.id]);
      continue;
    }

    /**
     * Der Schnappschuss traegt JEDES Feld, das gleich ueberschrieben wird —
     * und `for update` sperrt die Zeile, aus der er stammt.
     *
     * Ohne den vollen Vorher-Stand erklaert die Historie einen Teil der
     * Aenderungen nicht, und genau dafuer gibt es sie. Ohne die Sperre kann
     * zwischen Lesen und Schreiben ein anderer Import dieselbe Zeile
     * aendern; der Schnappschuss zeigte dann einen Zustand, den es zum
     * Zeitpunkt des Ueberschreibens nicht mehr gab.
     */
    const [vorher] = await db.abfrage<VorherZeile>(
      `select flaeche_qm::text, fenster_flaeche_qm::text, bezeichnung, etage, raumnummer,
              nutzungsart, belagsart_id::text, reinigungsklasse_id::text
         from raum where id = $1 for update`, [z.raum_id]);
    await db.abfrage(
      `update raum set bezeichnung = $2, nutzungsart = $3, flaeche_qm = $4::numeric,
                       fenster_flaeche_qm = $5::numeric, belagsart_id = $6,
                       reinigungsklasse_id = $7, etage = $8, raumnummer = $9
        where id = $1`,
      [z.raum_id, z.bezeichnung, z.nutzungsart, z.flaeche_qm, z.fenster_flaeche_qm,
       z.belagsart_id, z.reinigungsklasse_id, z.etage, z.raumnummer]);
    aktualisiert += 1;
    await db.abfrage(
      `insert into raum_import_historie (mandant_id, raum_id, import_id, import_zeile_id,
                                         aktion, vorher, nachher)
       values (app.aktiver_mandant(), $1, $2, $3, 'aktualisieren', $4::jsonb, $5::jsonb)`,
      [z.raum_id, importId, z.id,
       (vorher ?? null) as never, standAus(z) as never]);
  }

  await db.abfrage(
    `update raumbuch_import
        set status = 'uebernommen', uebernommen_am = now(), uebernommen_von = $2
      where id = $1`, [importId, benutzerId]);

  return { angelegt, aktualisiert, unveraendert, uebersprungen };
}
