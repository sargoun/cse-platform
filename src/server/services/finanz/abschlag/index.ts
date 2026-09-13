import 'server-only';
import { addiere, cent, type Cent } from '../geld.js';

/**
 * Abschlags- und Schlussrechnung: der Abzug der vorher gestellten Abschläge
 * (FIN-08, VOB/B §16).
 *
 * **Der Abzug wird JE STEUERGRUPPE gerechnet, nie aus einer Bruttosumme.**
 * Das ist keine Sorgfaltsübung: eine Schlussrechnung weist die Umsatzsteuer
 * nach §14 Abs. 4 Nr. 8 UStG je Satz aus, und die abgezogenen Abschläge müssen
 * in derselben Aufteilung dastehen. Wer vom Brutto abzieht, hat einen Betrag,
 * der stimmt, und eine Steueraufteilung, die es nicht tut — und die
 * Voranmeldung zieht aus der falschen.
 *
 * **Und er wird SUMMIERT, nicht neu gerundet.** Jeder Abschlag hat seine
 * Steuer beim Festschreiben schon auf ganze Cent gerundet; diese Zahlen sind
 * unveränderlich. Eine zweite Rundung auf die Summe ergäbe einen Abzug, der um
 * Cent von dem abweicht, was die Abschlagsrechnungen ausweisen — und der
 * Kunde, der nachrechnet, hat recht.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class AbschlagFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund:
      | 'nicht_gefunden'
      | 'keine_schlussrechnung'
      | 'kein_entwurf'
      | 'kein_auftrag'
      | 'abschlag_offen'
      | 'abschlag_storniert',
    /** Die Rechnungsnummern, um die es geht — für die Meldung an den Menschen. */
    readonly nummern: readonly string[] = [],
  ) {
    super(nachricht);
    this.name = 'AbschlagFehler';
  }
}

// ---------------------------------------------------------------------------
// Der Stand: welche Abschläge gibt es, und was ist mit ihnen
// ---------------------------------------------------------------------------

export interface AbschlagStand {
  readonly rechnungId: string;
  readonly nummer: string;
  readonly rechnungsdatum: string;
  readonly bruttoCent: Cent;
  /** Von einer Schlussrechnung bereits abgezogen — dann steht hier deren Id. */
  readonly verrechnetVon: string | null;
  /** Durch einen Storno aufgehoben. */
  readonly storniert: boolean;
}

interface StandZeile {
  id: string;
  nummer: string;
  rechnungsdatum: string;
  brutto_cent: string;
  verrechnet_von: string | null;
  storniert: boolean;
}

/**
 * Alle festgeschriebenen Abschläge und Anzahlungen eines Auftrags, mit ihrem
 * Verrechnungs- und Stornostand.
 *
 * **`storniert` kommt aus `rechnung_beziehung`, nicht aus einem Status.** Es
 * gibt keinen Zustand `storniert` auf `rechnung` — eine Stornierung ist ein
 * eigener Beleg mit eigener Nummer, der zurückverweist (Invariante 4, K-12).
 * Wer nach einem Status suchte, fände nie einen und zöge stornierte Abschläge
 * mit ab.
 */
export async function abschlaegeZumAuftrag(
  db: Abfrage, auftragId: string,
): Promise<readonly AbschlagStand[]> {
  const zeilen = await db.abfrage<StandZeile>(
    `select r.id, r.nummer, r.rechnungsdatum::text as rechnungsdatum,
            r.brutto_cent::text as brutto_cent,
            (select b.schluss_rechnung_id from abschlagsrechnung_bezug b
              where b.abschlag_rechnung_id = r.id and b.wirksam limit 1) as verrechnet_von,
            exists (select 1 from rechnung_beziehung bz
                     where bz.zu_rechnung_id = r.id and bz.art = 'storno') as storniert
       from rechnung r
      where r.auftrag_id = $1
        and r.status = 'festgeschrieben'
        and r.rechnungsart in ('abschlag', 'anzahlung')
      order by r.rechnungsdatum, r.nummer`,
    [auftragId],
  );

  return zeilen.map((z) => ({
    rechnungId: z.id,
    nummer: z.nummer,
    rechnungsdatum: z.rechnungsdatum,
    bruttoCent: cent(BigInt(z.brutto_cent)),
    verrechnetVon: z.verrechnet_von,
    storniert: z.storniert,
  }));
}

// ---------------------------------------------------------------------------
// Der Abzug selbst
// ---------------------------------------------------------------------------

export interface AbzugZeile {
  readonly abschlagRechnungId: string;
  readonly steuersatzGruppeId: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
}

export interface Verrechnung {
  readonly zeilen: readonly AbzugZeile[];
  readonly abzugNettoCent: Cent;
  readonly abzugSteuerCent: Cent;
  readonly abzugBruttoCent: Cent;
  /** Die Nummern der abgezogenen Belege, in der Reihenfolge ihres Datums. */
  readonly nummern: readonly string[];
}

/**
 * Fasst Abzugszeilen zu den drei Kopfsummen zusammen — je Steuergruppe, dann
 * über alle.
 *
 * Rein, damit die Rundungsaussage ohne Datenbank prüfbar ist:
 * `tests/kern/abschlag.test.ts` fährt hier den Drittel-Fall durch — drei
 * Abschläge über einen Betrag, der sich nicht glatt dritteln lässt, deren
 * Abzug in der Summe auf den Cent dem entsprechen muss, was die drei Belege
 * ausweisen. Es wird summiert, nicht gerundet; genau das ist die Zusage.
 */
export function fasseAbzugZusammen(
  zeilen: readonly AbzugZeile[], nummern: readonly string[] = [],
): Verrechnung {
  const netto = addiere(...zeilen.map((z) => z.nettoCent));
  const steuer = addiere(...zeilen.map((z) => z.steuerCent));
  return {
    zeilen,
    abzugNettoCent: netto,
    abzugSteuerCent: steuer,
    abzugBruttoCent: addiere(netto, steuer),
    nummern,
  };
}

/** Die Summen je Steuergruppe — die Form, in der sie auf dem Beleg stehen. */
export function jeSteuergruppe(
  zeilen: readonly AbzugZeile[],
): ReadonlyMap<string, { netto: Cent; steuer: Cent }> {
  const map = new Map<string, { netto: Cent; steuer: Cent }>();
  for (const z of zeilen) {
    const da = map.get(z.steuersatzGruppeId) ?? { netto: cent(0n), steuer: cent(0n) };
    map.set(z.steuersatzGruppeId, {
      netto: addiere(da.netto, z.nettoCent),
      steuer: addiere(da.steuer, z.steuerCent),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Der Weg über die Datenbank
// ---------------------------------------------------------------------------

interface KopfZeile {
  rechnungsart: string;
  status: string;
  auftrag_id: string | null;
}

async function ladeKopf(db: Abfrage, rechnungId: string): Promise<KopfZeile> {
  const [k] = await db.abfrage<KopfZeile>(
    `select rechnungsart::text as rechnungsart, status::text as status, auftrag_id
       from rechnung where id = $1`,
    [rechnungId],
  );
  if (k === undefined) {
    throw new AbschlagFehler(`Rechnung ${rechnungId} gibt es nicht.`, 'nicht_gefunden');
  }
  return k;
}

/**
 * Berechnet den Abzug einer Schlussrechnung — ohne etwas zu schreiben.
 *
 * **Ein stornierter Abschlag hält an.** Er wird nicht stillschweigend
 * übersprungen: seine Stornierung ist ein eigener Beleg, und ob die
 * Schlussrechnung ihn deshalb gar nicht, oder den Storno mit, oder einen
 * Ersatzabschlag abziehen muss, ist eine kaufmännische Entscheidung. Die
 * Plattform nennt die Nummer und hört auf — das ist die einzige Antwort, die
 * nicht falsch sein kann.
 */
export async function berechneVerrechnung(
  db: Abfrage, schlussRechnungId: string,
): Promise<Verrechnung> {
  const kopf = await ladeKopf(db, schlussRechnungId);
  if (kopf.rechnungsart !== 'schluss') {
    throw new AbschlagFehler(
      'Abschläge werden nur von einer Schlussrechnung abgezogen, nicht von '
      + `einer Rechnung der Art „${kopf.rechnungsart}".`,
      'keine_schlussrechnung',
    );
  }
  if (kopf.auftrag_id === null) {
    throw new AbschlagFehler(
      'Diese Schlussrechnung hängt an keinem Auftrag. Welche Abschläge zu ihr '
      + 'gehören, lässt sich damit nicht beantworten — und geraten wird hier '
      + 'nichts.',
      'kein_auftrag',
    );
  }

  const stand = await abschlaegeZumAuftrag(db, kopf.auftrag_id);
  const storniert = stand.filter((a) => a.storniert);
  if (storniert.length > 0) {
    throw new AbschlagFehler(
      `Zu diesem Auftrag ist ein Abschlag storniert (${storniert.map((a) => a.nummer).join(', ')}). `
      + 'Ob er gar nicht, mit dem Storno zusammen oder durch einen Ersatz '
      + 'abgezogen wird, entscheidet die Buchhaltung — nicht die Plattform.',
      'abschlag_storniert',
      storniert.map((a) => a.nummer),
    );
  }

  /**
   * **Ein Abschlag, den eine ANDERE Schlussrechnung schon abzieht, hält an.**
   *
   * Der erste Entwurf filterte ihn still heraus. Die zweite Schlussrechnung
   * bekam dann einen Abzug von 0,00 €, sah vollständig aus und verlangte den
   * ganzen Auftragswert ein zweites Mal — der Knopf tat scheinbar etwas, und
   * was er tat, war nichts. Genau die Sorte Fehlschlag, die niemand bemerkt,
   * bis der Kunde anruft.
   *
   * Zu einem Auftrag gehört eine Schlussrechnung. Gibt es zwei, ist das eine
   * Frage an die Buchhaltung und keine, die ein Filter beantwortet.
   */
  const anderswo = stand.filter(
    (a) => a.verrechnetVon !== null && a.verrechnetVon !== schlussRechnungId,
  );
  if (anderswo.length > 0) {
    throw new AbschlagFehler(
      `${anderswo.map((a) => a.nummer).join(', ')} `
      + `${anderswo.length === 1 ? 'wird' : 'werden'} bereits von einer anderen `
      + 'Schlussrechnung abgezogen. Zu einem Auftrag gehört eine Schlussrechnung — '
      + 'welche der beiden gilt, entscheidet die Buchhaltung.',
      'abschlag_offen',
      anderswo.map((a) => a.nummer),
    );
  }

  const abzuziehen = stand.filter(
    (a) => a.verrechnetVon === null || a.verrechnetVon === schlussRechnungId,
  );
  if (abzuziehen.length === 0) return fasseAbzugZusammen([], []);

  /*
   * Die Steuerzeilen der Abschläge, nicht ihre Kopfsummen: der Abzug muss die
   * Aufteilung tragen, die der abgezogene Beleg ausweist.
   */
  const zeilen = await db.abfrage<{
    rechnung_id: string; steuersatz_gruppe_id: string;
    netto_cent: string; steuer_cent: string;
  }>(
    `select rechnung_id, steuersatz_gruppe_id,
            netto_cent::text as netto_cent, steuer_cent::text as steuer_cent
       from rechnung_steuer
      where rechnung_id = any($1::uuid[])
        and (netto_cent <> 0 or steuer_cent <> 0)
      order by rechnung_id, steuersatz_gruppe_id`,
    [abzuziehen.map((a) => a.rechnungId)],
  );

  return fasseAbzugZusammen(
    zeilen.map((z) => ({
      abschlagRechnungId: z.rechnung_id,
      steuersatzGruppeId: z.steuersatz_gruppe_id,
      nettoCent: cent(BigInt(z.netto_cent)),
      steuerCent: cent(BigInt(z.steuer_cent)),
    })),
    abzuziehen.map((a) => a.nummer),
  );
}

/**
 * Schreibt den Abzug an die Schlussrechnung — die Bezugszeilen und den
 * Kopfbetrag.
 *
 * Nur an einem ENTWURF. Nach dem Festschreiben ist der Beleg unveränderlich
 * (Invariante 4), und ein Abzug, der sich danach noch änderte, wäre eine
 * stille Änderung an einer Rechnung, die der Kunde schon hat.
 */
export async function schreibeVerrechnung(
  db: Abfrage, schlussRechnungId: string,
): Promise<Verrechnung> {
  const kopf = await ladeKopf(db, schlussRechnungId);
  if (kopf.status !== 'entwurf') {
    throw new AbschlagFehler(
      'Der Abzug wird an einem Entwurf geschrieben. Diese Rechnung ist '
      + `„${kopf.status}" — nach dem Festschreiben ist sie unveränderlich `
      + '(Invariante 4).',
      'kein_entwurf',
    );
  }

  const verrechnung = await berechneVerrechnung(db, schlussRechnungId);

  for (const z of verrechnung.zeilen) {
    await db.abfrage(
      /*
       * Der Urheberblock gehoert dazu und ist nicht Zierat: `arb_akteur_stimmig`
       * verlangt bei `erstellt_von_art = 'mensch'` auch ein `erstellt_von`.
       * Ohne diese beiden Spalten weist die Tabelle jede Zeile ab — und der
       * Abzug ist genau die Stelle, an der spaeter jemand fragt, wer ihn
       * gesetzt hat.
       */
      `insert into abschlagsrechnung_bezug
         (mandant_id, schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id,
          abzug_netto_cent, abzug_steuer_cent, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3, $4::bigint, $5::bigint,
               'mensch', app.aktueller_benutzer())
       on conflict (schluss_rechnung_id, abschlag_rechnung_id, steuersatz_gruppe_id)
         do update set abzug_netto_cent = excluded.abzug_netto_cent,
                       abzug_steuer_cent = excluded.abzug_steuer_cent,
                       wirksam = true`,
      [schlussRechnungId, z.abschlagRechnungId, z.steuersatzGruppeId,
       z.nettoCent.toString(), z.steuerCent.toString()],
    );
  }

  /*
   * Zeilen, die es nicht mehr gibt, werden auf `wirksam = false` gesetzt und
   * nicht gelöscht (Invariante 8): ein Abschlag, der aus dem Abzug fällt, ist
   * eine Änderung, die jemand nachvollziehen können muss.
   */
  await db.abfrage(
    `update abschlagsrechnung_bezug
        set wirksam = false
      where schluss_rechnung_id = $1 and wirksam
        and not (abschlag_rechnung_id = any($2::uuid[]))`,
    [schlussRechnungId, [...new Set(verrechnung.zeilen.map((z) => z.abschlagRechnungId))]],
  );

  await db.abfrage(
    `update rechnung
        set abzug_brutto_cent = $2::bigint,
            zahlbetrag_cent = brutto_cent - $2::bigint
      where id = $1`,
    [schlussRechnungId, verrechnung.abzugBruttoCent.toString()],
  );

  return verrechnung;
}

/**
 * Die Vorflugprüfung: welche Abschläge dieses Auftrags stehen noch offen?
 *
 * FIN-08 sagt „finalization blocked otherwise", und das ist der Grund: eine
 * Schlussrechnung, die einen gestellten Abschlag nicht abzieht, verlangt Geld
 * zweimal. Das fällt beim Kunden auf, nicht bei uns — und es fällt auf einem
 * Beleg auf, der nicht mehr geändert werden kann.
 *
 * **Zwei Sorten offen, und sie sind nicht dasselbe.** Ein Abschlag, der
 * NIRGENDS abgezogen ist, gehört auf diese Schlussrechnung. Einer, den eine
 * ANDERE Schlussrechnung schon abgezogen hat, gehört nicht hierher — dann gibt
 * es zwei Schlussrechnungen zu einem Auftrag, und das ist ein anderer Fehler
 * mit einer anderen Antwort. Beide halten an; nur der Satz dazu ist ein
 * anderer.
 */
export interface OffenerAbschlag {
  readonly nummer: string;
  /** `null`: nirgends abgezogen. Sonst die Id der fremden Schlussrechnung. */
  readonly verrechnetVon: string | null;
}

export async function offeneAbschlaege(
  db: Abfrage, schlussRechnungId: string,
): Promise<readonly OffenerAbschlag[]> {
  const kopf = await ladeKopf(db, schlussRechnungId);
  if (kopf.rechnungsart !== 'schluss' || kopf.auftrag_id === null) return [];

  const stand = await abschlaegeZumAuftrag(db, kopf.auftrag_id);
  return stand
    .filter((a) => a.verrechnetVon !== schlussRechnungId)
    .map((a) => ({ nummer: a.nummer, verrechnetVon: a.verrechnetVon }));
}

/**
 * Dieselbe Prüfung als Satz — der, der im Pflichtfeldbericht steht.
 *
 * `null`, wenn nichts offen ist. Sonst ein Text, der die NUMMERN nennt: „es
 * fehlt etwas" ist keine Auskunft, mit der jemand arbeiten kann, und wer die
 * Rechnung gerade festschreiben wollte, braucht sie jetzt.
 */
export function offeneAbschlaegeSatz(offen: readonly OffenerAbschlag[]): string | null {
  if (offen.length === 0) return null;

  const nirgends = offen.filter((o) => o.verrechnetVon === null).map((o) => o.nummer);
  const anderswo = offen.filter((o) => o.verrechnetVon !== null).map((o) => o.nummer);

  const teile: string[] = [];
  if (nirgends.length > 0) {
    teile.push(
      `${nirgends.length === 1 ? 'Der Abschlag' : 'Die Abschläge'} `
      + `${nirgends.join(', ')} ${nirgends.length === 1 ? 'ist' : 'sind'} noch nicht `
      + 'abgezogen. Eine Schlussrechnung, die einen gestellten Abschlag nicht '
      + 'abzieht, verlangt das Geld zweimal.',
    );
  }
  if (anderswo.length > 0) {
    teile.push(
      `${anderswo.join(', ')} ${anderswo.length === 1 ? 'wird' : 'werden'} bereits von `
      + 'einer anderen Schlussrechnung abgezogen. Zu einem Auftrag gehört eine '
      + 'Schlussrechnung — welche der beiden gilt, entscheidet die Buchhaltung.',
    );
  }
  return teile.join(' ');
}
