import 'server-only';
import { anteilInBasisPunkten, basisPunkte, cent, type Cent } from './geld.js';
import { bucheAusgabe as bucheAusgabeSatz } from '../buchhaltung/buchungssatz.js';
import type { BuchungErgebnis } from '../buchhaltung/buchungssatz.js';
import { istAusgabeStatus, type Zahlungsmittel } from './ausgabe.js';

/**
 * **Eine Ausgabe entsteht, wird freigegeben, abgelehnt oder gebucht** (V-011,
 * FIN-14, FIN-17, ACC-01, ACC-03, REP-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0180` baut die Tabelle vollständig: vier Zustände, ein Übergangsauslöser,
 * die Belegpflicht ab `freigegeben`, die Unveränderlichkeit ab `gebucht`, die
 * Steueraufteilung je Satzgruppe und das Spaltenrecht auf `anstellung_id`.
 * `services/finanz/ausgabe.ts` liest das alles und zeigt es auf zwei Seiten.
 *
 * **Und schreiben konnte es niemand.** Eine Tankquittung, eine Parkgebühr,
 * eine Materialrechnung aus dem Baumarkt — im Betrieb der häufigste Beleg
 * überhaupt — liess sich nicht erfassen. Nicht weil etwas fehlte, sondern
 * weil zwischen Tabelle und Oberfläche kein Dienst stand.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Steuer wird gerechnet — von einer geprüften Funktion.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Erfasser gibt den NETTOBETRAG je Steuersatzgruppe. Den Steuerbetrag
 * rechnet `anteilInBasisPunkten` (geprüft in `tests/kern/geld.test.ts`), und
 * die Kopfsummen sind die Summen der Zeilen. Invariante 6 verlangt genau das:
 * jede Zahl durch eine geprüfte Funktion, nie aus einem Modell und nie aus
 * einem Bruttobetrag zurückgerechnet — ein aus Brutto hergeleiteter Satz wäre
 * ein Mischsatz, und Invariante 1 verbietet ihn.
 *
 * **Satz und Kategorie werden EINGEFROREN, nicht verwiesen.** Eine spätere
 * Satzpflege darf einen erfassten Beleg nicht rückwirkend ändern (dieselbe
 * Regel wie auf der Eingangsrechnung, 0123).
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class AusgabeFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unvollstaendig' | 'nicht_gefunden' | 'abgewiesen' | 'kein_beleg'
      | 'kein_uebergang' | 'grund_fehlt',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'AusgabeFehler';
  }
}

export interface SteuerEingabe {
  /** Der Schlüssel der Steuersatzgruppe, z. B. `ust_19`. */
  readonly gruppe: string;
  readonly nettoCent: Cent;
}

export interface AusgabeErfassen {
  readonly kategorieId: string;
  readonly bezeichnung: string;
  /** Berliner Kalendertag (§1.8). */
  readonly ausgabedatum: string;
  readonly zahlungsmittel: Zahlungsmittel;
  readonly kasseId?: string | null;
  readonly belegId?: string | null;
  readonly auftragId?: string | null;
  readonly projektId?: string | null;
  readonly objektId?: string | null;
  readonly anstellungId?: string | null;
  readonly weiterberechenbar?: boolean;
  readonly steuer: readonly SteuerEingabe[];
}

interface GruppeRoh {
  readonly id: string;
  readonly satz_bp: number;
  readonly kategorie: string;
}

/**
 * Was aus der Eingabe wird — je Gruppe eingefroren, mit gerechneter Steuer.
 *
 * Getrennt und exportiert, damit die Rechnung selbst prüfbar ist, ohne eine
 * Datenbank anzufassen: der Teil, der Geld bewegt, gehört unter eine
 * Kernprüfung und nicht nur unter eine Isolationsprüfung.
 */
export interface SteuerZeileFest {
  readonly gruppeId: string;
  readonly satzBp: number;
  readonly kategorie: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
}

export function friereSteuerEin(
  eingaben: readonly SteuerEingabe[],
  gruppen: ReadonlyMap<string, GruppeRoh>,
): readonly SteuerZeileFest[] {
  return eingaben.map((e) => {
    const g = gruppen.get(e.gruppe);
    if (g === undefined) {
      throw new AusgabeFehler(
        `Die Steuersatzgruppe „${e.gruppe}" gibt es nicht.`, 'unvollstaendig');
    }
    return {
      gruppeId: g.id,
      satzBp: g.satz_bp,
      kategorie: g.kategorie,
      nettoCent: e.nettoCent,
      steuerCent: anteilInBasisPunkten(e.nettoCent, basisPunkte(g.satz_bp)),
    };
  });
}

/** Die Kopfsummen — die Summe der Zeilen und nichts anderes. */
export function kopfsummen(zeilen: readonly SteuerZeileFest[]): {
  readonly nettoCent: Cent; readonly steuerCent: Cent; readonly bruttoCent: Cent;
} {
  const netto = zeilen.reduce((s, z) => s + z.nettoCent, 0n);
  const steuer = zeilen.reduce((s, z) => s + z.steuerCent, 0n);
  return { nettoCent: cent(netto), steuerCent: cent(steuer), bruttoCent: cent(netto + steuer) };
}

export async function erfasseAusgabe(db: Abfrage, e: AusgabeErfassen): Promise<string> {
  if (e.bezeichnung.trim() === '') {
    throw new AusgabeFehler('Eine Ausgabe braucht eine Bezeichnung.', 'unvollstaendig');
  }
  if (e.steuer.length === 0) {
    throw new AusgabeFehler(
      'Ohne Aufteilung je Steuersatzgruppe entsteht keine Ausgabe — aus einem '
      + 'Bruttobetrag allein lässt sich kein Satz mehr ableiten (Invariante 1).',
      'unvollstaendig');
  }
  if (e.zahlungsmittel === 'bar' && (e.kasseId ?? null) === null) {
    throw new AusgabeFehler(
      'Bar heisst: aus einer Kasse. Ohne Kasse gäbe es keinen fortgeschriebenen '
      + 'Bestand und damit keine Kassensturzfähigkeit (GoBD).', 'unvollstaendig');
  }

  const roh = await db.abfrage<GruppeRoh & { schluessel: string }>(
    `select id, schluessel, satz_bp, kategorie::text as kategorie
       from steuersatz_gruppe where schluessel = any($1::text[])`,
    [e.steuer.map((s) => s.gruppe)]);
  const gruppen = new Map(roh.map((g) => [g.schluessel, g]));
  const zeilen = friereSteuerEin(e.steuer, gruppen);
  const summe = kopfsummen(zeilen);

  const [kopf] = await db.abfrage<{ id: string }>(
    `insert into ausgabe
       (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
        netto_cent, steuer_cent, brutto_cent,
        zahlungsmittel, kasse_id, beleg_id,
        auftrag_id, projekt_id, objekt_id, anstellung_id, weiterberechenbar,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3::date,
             $4::bigint, $5::bigint, $6::bigint,
             $7::zahlungsmittel, $8::uuid, $9::uuid,
             $10::uuid, $11::uuid, $12::uuid, $13::uuid, coalesce($14, false),
             'mensch', app.aktueller_benutzer())
     returning id`,
    [e.kategorieId, e.bezeichnung.trim(), e.ausgabedatum,
      summe.nettoCent.toString(), summe.steuerCent.toString(), summe.bruttoCent.toString(),
      e.zahlungsmittel, e.kasseId ?? null, e.belegId ?? null,
      e.auftragId ?? null, e.projektId ?? null, e.objektId ?? null,
      e.anstellungId ?? null, e.weiterberechenbar ?? false]);
  if (kopf === undefined) {
    throw new AusgabeFehler('Die Ausgabe wurde nicht erfasst.', 'abgewiesen');
  }

  for (const z of zeilen) {
    await db.abfrage(
      `insert into ausgabe_steuer
         (mandant_id, ausgabe_id, steuersatz_gruppe_id, satz_bp, kategorie,
          netto_cent, steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, $4::en16931_steuerkategorie,
               $5::bigint, $6::bigint, 'mensch', app.aktueller_benutzer())`,
      [kopf.id, z.gruppeId, z.satzBp, z.kategorie,
        z.nettoCent.toString(), z.steuerCent.toString()]);
  }
  return kopf.id;
}

/**
 * Den Zustand setzen — bedingt, nie blind (K-09).
 *
 * `where status = $3` und nicht „lesen, prüfen, schreiben": zwischen dem
 * Lesen und dem Schreiben kann ein zweiter Mensch denselben Knopf gedrückt
 * haben. Null Zeilen heissen dann „war schon", und das ist eine Antwort —
 * keine Ausnahme und kein zweiter Übergang.
 */
async function setzeStatus(
  db: Abfrage, id: string, von: string, nach: string,
  zusatz: { readonly grund?: string } = {},
): Promise<void> {
  const grund = zusatz.grund ?? null;
  const zeilen = await db.abfrage<{ id: string }>(
    nach === 'freigegeben'
      ? `update ausgabe
            set status = 'freigegeben', freigegeben_von = app.aktueller_benutzer(),
                geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
          where id = $1::uuid and mandant_id = app.aktiver_mandant() and status = $2::ausgabe_status
          returning id`
      : nach === 'abgelehnt'
        ? `update ausgabe
              set status = 'abgelehnt', abgelehnt_grund = $3,
                  geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
            where id = $1::uuid and mandant_id = app.aktiver_mandant() and status = $2::ausgabe_status
            returning id`
        : `update ausgabe
              set status = 'gebucht',
                  geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
            where id = $1::uuid and mandant_id = app.aktiver_mandant() and status = $2::ausgabe_status
            returning id`,
    nach === 'abgelehnt' ? [id, von, grund] : [id, von]);

  if (zeilen.length === 0) {
    throw new AusgabeFehler(
      `Diese Ausgabe steht nicht auf „${von}" — der Übergang nach „${nach}" gilt nicht `
      + 'mehr. Wahrscheinlich hat jemand anderes sie inzwischen entschieden.',
      'kein_uebergang', 409);
  }
}

/**
 * Freigeben — und ohne Beleg geht es nicht.
 *
 * Die Datenbank hält es ohnehin (`ausgabe_beleg_ab_freigabe`, ACC-03). Hier
 * steht es trotzdem noch einmal, weil der Mensch am Formular einen SATZ
 * braucht und keine Constraint-Meldung: „keine Buchung ohne Beleg" ist eine
 * Regel, die man erklärt, nicht eine, an der man scheitert.
 */
export async function gibAusgabeFrei(db: Abfrage, id: string): Promise<void> {
  const [z] = await db.abfrage<{ beleg_id: string | null; status: string }>(
    `select beleg_id, status::text as status from ausgabe
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id]);
  if (z === undefined) {
    throw new AusgabeFehler('Diese Ausgabe ist nicht erreichbar.', 'nicht_gefunden', 404);
  }
  if (z.beleg_id === null) {
    throw new AusgabeFehler(
      'Ohne Beleg keine Freigabe (ACC-03). Hängen Sie die Quittung an, dann geht es '
      + 'weiter — ob es Ausgaben gibt, für die belegfrei gebucht werden darf, ist '
      + 'nicht entschieden (O-185).', 'kein_beleg');
  }
  await setzeStatus(db, id, 'erfasst', 'freigegeben');
}

/** Ablehnen — mit Grund, nie durch Löschen (Invariante 8). */
export async function lehneAusgabeAb(
  db: Abfrage, id: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 3) {
    throw new AusgabeFehler(
      'Eine Ablehnung ohne Grund ist keine Auskunft — mindestens drei Zeichen.',
      'grund_fehlt');
  }
  const [z] = await db.abfrage<{ status: string }>(
    `select status::text as status from ausgabe
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`, [id]);
  if (z === undefined || !istAusgabeStatus(z.status)) {
    throw new AusgabeFehler('Diese Ausgabe ist nicht erreichbar.', 'nicht_gefunden', 404);
  }
  if (z.status !== 'erfasst' && z.status !== 'freigegeben') {
    throw new AusgabeFehler(
      `Eine Ausgabe im Zustand „${z.status}" wechselt nicht mehr (ACC-06). `
      + 'Korrigiert wird durch eine Gegenbuchung.', 'kein_uebergang', 409);
  }
  await setzeStatus(db, id, z.status, 'abgelehnt', { grund: grund.trim() });
}

/**
 * Buchen — der unumkehrbare Schritt, Zustand und Buchungssatz in EINER
 * Transaktion.
 *
 * Dieselbe Reihenfolge wie auf der Kreditorenseite (0131, D-427): erst der
 * Zustand, dann die Buchung. Ein Nachlauf hinterliesse gebuchte Ausgaben, die
 * in keiner Buchhaltung stehen — und niemand merkt, wenn ein Nachlauf nicht
 * mehr läuft.
 */
export async function bucheAusgabe(db: Abfrage, id: string): Promise<BuchungErgebnis> {
  await setzeStatus(db, id, 'freigegeben', 'gebucht');
  return bucheAusgabeSatz(db, id);
}
