/**
 * Demodaten fuer den Vertrieb — vom Raumbuch zum versendeten Angebot und in
 * den Auftrag (OPS-07, OPS-08, OPS-09).
 *
 * **Ohne diese Datei hat die Plattform kein einziges Angebot.** Das war nicht
 * bloss eine Luecke im Schaufenster: die Angebotsliste, das Kundenportal und
 * der Weg „Angebot → Auftrag“ zeigten je eine leere Tabelle. Leere Tabellen
 * sehen aus wie fertige Bildschirme, an denen heute zufaellig nichts anliegt —
 * und niemand prueft an ihnen, ob die Kette dahinter traegt.
 *
 * **Die Kette laeuft ueber die ECHTEN Dienste**, wie der Besetzungslauf der
 * Security und der Revierzuschnitt der Reinigung:
 * `ladeKalkulationsgrundlage` → `kalkuliere` → `legeAngebotAn` →
 * `uebernimmKalkulation` → `bestaetigeKalkulation` → `versendeAngebot` →
 * `wandleInAuftrag`. Ein Seed, der `angebot`-Zeilen direkt schriebe, haette
 * eine Angebotsnummer ohne Nummernkreis, Steuerzeilen ohne Gruppierung und
 * eine Kalkulation, die nie gerechnet hat — und alles daran saehe richtig aus.
 *
 * **Der Versand ist die Stelle, an der die Sperre sitzt.**
 * `kern.angebot_versand_pruefen` laesst kein Angebot hinaus, dessen
 * Kalkulation auf unbeantworteten Fragen steht (O-16 Tarif, O-56
 * Frequenzfaktor, O-17 Leistungswert je Zeile). Der Seed umgeht das nicht: er
 * geht durch `bestaetigeKalkulation`, also durch denselben Dienst wie ein
 * Mensch — und er bestaetigt mit GENAU den Platzhalterzahlen, mit denen
 * gerechnet wurde (29,00 € · 15 % · 8 %). Damit sagt diese Bestaetigung, was
 * sie ist: „fuer DIESES Demoangebot rechnen wir so“. Sie beantwortet O-16
 * nicht, sie schreibt keinen Katalogwert um, und `kalkulation.bemerkung`
 * traegt die offenen Fragen weiter, mit denen gerechnet wurde.
 *
 * **Ein zweites Angebot bleibt ENTWURF, und das ist der Pruefstein.** Ein
 * Entwurf traegt keine Nummer — sie entsteht erst beim Versand, aus dem
 * Nummernkreis — und der Kunde darf ihn nicht sehen (AUT-01, `t_kunde`
 * verlangt `status <> 'entwurf'`). Eine Zusage dieser Art laesst sich nur
 * pruefen, wenn im Bestand ein Entwurf steht, den jemand sehen KOENNTE.
 *
 * **Der Seed hoert vor der ersten Rechnung auf.** Der Angebotskreis ist
 * bestaetigt, der Rechnungskreis nicht (O-134) — deshalb entsteht hier ein
 * Auftrag und keine Rechnung.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien. Ein
 * versendetes Angebot ist unveraenderlich, und eine zweite Angebotsnummer aus
 * demselben Kreis waere eine verbrauchte Nummer ohne Beleg.
 */
import type postgres from 'postgres';
import { alsPortalSitzung } from './sitzung.js';
import { berlinHeute, type Abfrage as TagAbfrage }
  from '../../services/dienstplan/generator.js';
import { ladeKalkulationsgrundlage } from '../../services/kalkulation/raumbuch.js';
import { kalkuliere } from '../../services/kalkulation/index.js';
import { PLATZHALTER_FREQUENZ, PLATZHALTER_TARIF }
  from '../../services/kalkulation/tarif.js';
import { bestaetigeKalkulation } from '../../services/kalkulation/bestaetigung.js';
import {
  legeAngebotAn, uebernimmKalkulation, versendeAngebot, wandleInAuftrag,
} from '../../services/angebot/index.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface VertriebErgebnis {
  readonly angebote: number;
  readonly positionen: number;
  /** Die gezogene Nummer des versendeten Angebots, oder `null`. */
  readonly angebotsnummer: string | null;
  readonly auftragsnummer: string | null;
  /** Angebote, die mit Absicht Entwurf geblieben sind. */
  readonly entwuerfe: number;
  /** Die offenen Fragen, mit denen gerechnet wurde — wortwoertlich aus der Kalkulation. */
  readonly offeneFragen: readonly string[];
}

const LEER: VertriebErgebnis = {
  angebote: 0, positionen: 0, angebotsnummer: null, auftragsnummer: null,
  entwuerfe: 0, offeneFragen: [],
};

/**
 * Die zwei Angebote — und der Unterschied zwischen ihnen ist die Aussage.
 *
 * Beide rechnen auf DASSELBE Raumbuch und unterscheiden sich im Turnus. Das
 * ist der Alltag einer Gebaeudereinigung: dieselbe Flaeche, einmal taeglich
 * betreut und einmal im Quartal grundgereinigt. Und es macht den Vergleich
 * lesbar — zwei Preise, dieselbe Grundlage, der Faktor dazwischen ist der
 * Turnus.
 */
const VERSENDET = {
  titel: 'Unterhaltsreinigung Bürohaus Kurfürstendamm — Rahmenvertrag 2026',
  turnus: '5_pro_woche',
  turnusLabel: '5× wöchentlich, montags bis freitags',
  einleitung:
    'Sehr geehrte Damen und Herren, für die Unterhaltsreinigung Ihres Objektes '
    + 'unterbreiten wir Ihnen das folgende Angebot. Die Mengen stammen aus dem '
    + 'gemeinsam aufgenommenen Raumbuch; der Rechenweg je Position steht im Langtext.',
} as const;

const ENTWURF = {
  titel: 'Grundreinigung Bürohaus Kurfürstendamm — Treppenhäuser und Tiefgarage',
  turnus: '1_pro_quartal',
  turnusLabel: 'vierteljährlich',
  einleitung:
    'Ergänzend zur laufenden Unterhaltsreinigung bieten wir die vierteljährliche '
    + 'Grundreinigung an. Dieses Angebot ist noch in Arbeit und wurde nicht versendet.',
} as const;

/**
 * Die Bestaetigung — mit den Zahlen, mit denen GERECHNET wurde.
 *
 * Das ist der ganze Punkt. `PLATZHALTER_TARIF` liefert 2900 Cent, 1500 und
 * 300 + 500 Basispunkte; hier stehen dieselben Werte in der Schreibweise der
 * Eingabemaske. Eine andere Zahl an dieser Stelle waere eine stille
 * Preisentscheidung — und zwar eine, die im Demobestand wie eine bestaetigte
 * Kalkulation aussaehe.
 *
 * // TODO(client, O-16): Stundenverrechnungssaetze je Gewerk sowie
 * Gemeinkosten-, Wagnis- und Gewinnzuschlag je Gesellschaft. Die Bestaetigung
 * hier gilt AUSSCHLIESSLICH dem Demoangebot dieses Seeds; gruppenweit bleibt
 * die Frage offen, und `PLATZHALTER_TARIF` traegt sie weiter.
 */
const DEMOBESTAETIGUNG = {
  stundensatzEuro: '29,00',
  gemeinkostenBasis: 'lohn',
  gemeinkostenProzent: '15',
  wagnisGewinnProzent: '8',
  /**
   * // TODO(client, O-56): Wie wird ein Turnus in einen Frequenzfaktor je
   * Abrechnungsmonat umgerechnet (4,33 Wochen, Kalendertage, Vertragstage)?
   * 21,667 ist der Platzhalterfaktor fuer `5_pro_woche` — derselbe, mit dem
   * `kalkuliere` gerechnet hat, sonst rechnete die Bestaetigung den Preis um.
   */
  frequenzFaktor: '21,667',
  /**
   * // TODO(client, O-17): Welche Reinigungsrichtwerte (m²/h) gelten je
   * Belagsart? Bestaetigt wird der SCHNAPPSCHUSS dieser Kalkulation, nicht der
   * geteilte Katalog — `belagsart.ist_platzhalter` bleibt unberuehrt, und jede
   * andere Kalkulation bleibt in der Sperre.
   */
  leistungswerteBestaetigen: true,
} as const;

interface ObjektZeile {
  readonly id: string;
  readonly kunde_id: string;
  readonly bezeichnung: string;
}

export async function seedVertrieb(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<VertriebErgebnis> {
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined) throw new Error('Bereich reinigung fehlt');

  /**
   * Ein Objekt mit BEPREISBAREM Raumbuch — nicht irgendeines.
   *
   * `uebernimmKalkulation` weist ein Angebot ueber Flaeche ab, die niemand
   * bepreisen konnte (D-97): ein Raum ohne Belagsart oder eine Belagsart ohne
   * am Stichtag gueltigen Leistungswert. Ein Seed, der das erste Objekt
   * nimmt, laeuft deshalb je nach Reihenfolge der Objektnummern in einen
   * Fehler, der nach einem kaputten Dienst aussieht und keiner ist.
   */
  const [objekt] = await sql<ObjektZeile[]>`
    select o.id, o.kunde_id, o.bezeichnung
      from objekt o
     where o.mandant_id = ${mandantId} and o.archiviert_am is null
       and o.kunde_id is not null
       and exists (select 1 from raum r
                    where r.objekt_id = o.id and r.archiviert_am is null
                      and r.belagsart_id is not null)
     order by o.objektnummer limit 1`;
  if (objekt === undefined) return LEER;

  /**
   * Der Freigeber wird ueber sein RECHT gesucht, nicht ueber seine Rolle.
   *
   * `versendeAngebot` schreibt ihn als `freigegeben_von` und `versendet_von`
   * in die Zeile — Invariante 7 verlangt einen benannten Menschen. Welche
   * Rolle `angebot.versenden` traegt, entscheidet der Rechtekatalog und nicht
   * dieser Seed; eine fest verdrahtete Rolle waere beim naechsten
   * Katalogschnitt still falsch.
   */
  const [freigeber] = await sql<{ id: string }[]>`
    select b.id
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
      join rolle r on r.id = bm.rolle_id
      join rolle_berechtigung rb on rb.rolle_id = r.id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'angebot.versenden'
       and b.status = 'aktiv' and bm.entzogen_am is null
     order by b.email limit 1`;
  if (freigeber === undefined) return LEER;

  // LESEN ZUERST: ein versendetes Angebot ist unveraenderlich, und der
  // Nummernkreis vergibt beim zweiten Lauf eine zweite Nummer, der dann kein
  // zweites Angebot gegenuebersteht.
  const [schonDa] = await sql<{ id: string }[]>`
    select id from angebot
     where mandant_id = ${mandantId} and titel = ${VERSENDET.titel} limit 1`;
  if (schonDa !== undefined) return LEER;

  const heute = await berlinHeute(sql as unknown as TagAbfrage);
  // Der Erste des laufenden Monats — als Zeichenkette aus dem BERLINER
  // Kalendertag geschnitten. Node rechnet hier keine Zone um (Invariante 2).
  const monatsanfang = `${heute.slice(0, 7)}-01`;

  return alsPortalSitzung(sql, mandantId, freigeber.id, async (kontext) => {
    /**
     * Dieselbe Schicht wie in `/api/angebot`: `abfrage` fuer die Dienste,
     * `unsafe` fuer `vergebeNummer`. Der Nummernkreis zieht seine Zeile mit
     * `SELECT … FOR UPDATE` und braucht dafuer den Treiberzugang; beide Wege
     * laufen durch DIESELBE Transaktion, sonst sperrte die Nummernvergabe
     * gegen den eigenen Versand.
     */
    const db = {
      abfrage: kontext.abfrage.bind(kontext),
      unsafe: async (s: string, w: readonly unknown[] = []): Promise<readonly unknown[]> =>
        kontext.schreibe<unknown>(s, w),
    };

    const stichtag = new Date();
    const grundlage = await ladeKalkulationsgrundlage(db, objekt.id, stichtag);
    const tarif = PLATZHALTER_TARIF.tarif(mandantId, 'reinigung');

    /* ------------------------------------------------------------------ */
    /* 1 — das Angebot, das hinausgeht                                     */
    /* ------------------------------------------------------------------ */

    const frequenz = PLATZHALTER_FREQUENZ.frequenz(VERSENDET.turnus);
    const kalkulation = kalkuliere({
      posten: grundlage.posten,
      frequenz,
      tarif,
      flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
      // Beide Luecken gehen MIT: `uebernimmKalkulation` weist ein Angebot
      // ueber nicht bepreisbare Flaeche ab, statt sie zu verschweigen (D-97).
      ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
    });
    if (kalkulation.zeilen.length === 0) return LEER;

    const angebotId = await legeAngebotAn(db, {
      kundeId: objekt.kunde_id,
      titel: VERSENDET.titel,
      objektId: objekt.id,
      einleitungstext: VERSENDET.einleitung,
      /**
       * `gueltigBis` bleibt LEER.
       *
       * // TODO(client, O-350): Wie lange ist ein Angebot bindend, und wird
       * `gueltig_bis` beim Versand aus dieser Frist gesetzt? Ein geratenes
       * Datum stuende auf einem Dokument, das der Kunde als Zusage liest —
       * und der Ablaufbericht (`angebot_ablauf_idx`) mahnte danach zu einem
       * Termin, den niemand vereinbart hat.
       */
    });
    const positionen = await uebernimmKalkulation(db, angebotId, kalkulation, {
      objektId: objekt.id,
      turnusLabel: VERSENDET.turnusLabel,
      tarif,
      frequenz,
    });

    /**
     * Und jetzt die Bestaetigung — VOR dem Versand und ueber den Dienst.
     *
     * Sie rechnet die gespeicherten Zeilen mit den bestaetigten Zahlen neu.
     * Weil hier dieselben Zahlen stehen, mit denen `kalkuliere` gerechnet
     * hat, aendert sich kein Cent — und genau das ist die Probe: eine
     * Bestaetigung, die den Preis verschoebe, waere eine andere Kalkulation
     * unter derselben Ueberschrift.
     */
    await bestaetigeKalkulation(db, angebotId, {
      ...DEMOBESTAETIGUNG,
      benutzerId: freigeber.id,
    });

    const versand = await versendeAngebot(db, angebotId, freigeber.id);

    /**
     * OPS-09 — und der Auftragswert wird NICHT neu gerechnet.
     *
     * `wandleInAuftrag` uebernimmt `angebot.netto_cent`, also die Summe der
     * Positionen, die der Kunde gelesen hat. Eine zweite Rechnung hier waere
     * eine zweite Wahrheit ueber denselben Betrag, und die Abweichung faende
     * niemand, weil beide plausibel aussehen.
     */
    const auftrag = await wandleInAuftrag(db, angebotId, {
      art: 'rahmenvertrag',
      verantwortlichBenutzerId: freigeber.id,
      startDatum: monatsanfang,
    });

    /* ------------------------------------------------------------------ */
    /* 2 — das Angebot, das Entwurf bleibt                                 */
    /* ------------------------------------------------------------------ */

    /**
     * Der Entwurf bekommt KEINE Bestaetigung und KEINEN Versand.
     *
     * Damit traegt er keine Angebotsnummer: ein Entwurf hat keine, und sie
     * entsteht erst in demselben UPDATE, das `versendet_am` setzt (FIN-03).
     * Und er steht dem Kundenportal nicht zur Verfuegung: `t_kunde`
     * und die Portaldecke verlangen beide `status <> 'entwurf'`. Beides ist
     * eine Zusage, die sich nur an einem vorhandenen Entwurf pruefen laesst.
     */
    const entwurfFrequenz = PLATZHALTER_FREQUENZ.frequenz(ENTWURF.turnus);
    const entwurfKalkulation = kalkuliere({
      posten: grundlage.posten,
      frequenz: entwurfFrequenz,
      tarif,
      flaecheOhneBelagsart: grundlage.flaecheOhneBelagsart,
      ohneGueltigenLeistungswert: grundlage.ohneGueltigenLeistungswert,
    });
    const entwurfId = await legeAngebotAn(db, {
      kundeId: objekt.kunde_id,
      titel: ENTWURF.titel,
      objektId: objekt.id,
      einleitungstext: ENTWURF.einleitung,
    });
    const entwurfPositionen = await uebernimmKalkulation(db, entwurfId, entwurfKalkulation, {
      objektId: objekt.id,
      turnusLabel: ENTWURF.turnusLabel,
      tarif,
      frequenz: entwurfFrequenz,
    });

    return {
      angebote: 2,
      positionen: positionen + entwurfPositionen,
      angebotsnummer: versand.angebotsnummer,
      auftragsnummer: auftrag.auftragsnummer,
      entwuerfe: 1,
      offeneFragen: kalkulation.offeneFragen,
    };
  });
}
