/**
 * Demodaten fuer die Reinigung — Revierzuschnitt, Leistungsnachweis,
 * Unterschrift und Beanstandung (CLN-01, CLN-04, CLN-05, OPS-11, FIN-07).
 *
 * **Die groesste Gesellschaft der Gruppe stand im Seed mit sechs LEEREN
 * Revieren da.** `seedOperations` legt Objekte und Raeume an, `seedDienstplan`
 * die Reviere — und niemand verband sie. Das sah nicht nach einer Luecke aus:
 * die Revierliste zeigte sechs Zeilen, jede mit einer Sollzeit im Kopf, und
 * daneben eine Summe der Raeume von null. Also stand auf jedem Revierblatt
 * „stimmt nicht ueberein" — die eine Aussage, die CLN-01 gerade NICHT machen
 * soll. Der Kopfwert war keine Kalkulation, sondern die Zahl, die
 * `seedDienstplan` beim Anlegen hineingeschrieben hat; 210, 180 und 480
 * Minuten, gesetzt und nicht gerechnet.
 *
 * **Deshalb laeuft der Zuschnitt ueber den ECHTEN Dienst** (`setzeRaeume`) und
 * nicht ueber ein `insert`. Der Dienst liest die Flaechen unter RLS, holt die
 * Leistungswerte ueber `app.leistungswerte_lesen()`, ruft die EINE getestete
 * Rechnung aus PR 25 auf, macht die Gegenprobe `Σ Raeume = Kopf` VOR dem
 * Schreiben und setzt den Kopfwert danach auf das Ergebnis. Ein Seed, der die
 * Zeilen selbst schriebe, haette sechs Reviere mit Raeumen und weiterhin einen
 * Kopfwert, den niemand gerechnet hat — dieselbe Luege, nur besser versteckt.
 *
 * **Eine Zuordnung steht unter Loeschsperre (§5.2), und das ist Absicht.**
 * `setzeRaeume` ist additiv und wirft `RaumNichtEntfernbar`, sobald ein heute
 * zugeordneter Raum in der neuen Menge fehlt. Dieser Seed greift deshalb
 * LESEND ZUERST: hat ein Revier schon Raeume, bleibt es unberuehrt. Ein
 * zweiter Lauf mit einem geaenderten Zuschnitt wuerde sonst abbrechen — und
 * zwar zu Recht.
 *
 * **Der Leistungsnachweis entsteht aus ERFASSTER ZEIT** und nicht aus
 * ausgedachten Zeilen: jede Position traegt `quelle = 'zeiteintrag'` und die
 * Kennung der Schicht, aus der sie stammt. Genau dieser dreispaltige Weg
 * (Mandant → Auftragsleistung → Zeiteintrag) ist es, den FIN-07 verlangt, und
 * er laesst sich nur pruefen, wenn im Bestand Zeilen stehen, die ihn gegangen
 * sind. Deshalb haengt diese Datei hinter `seedZeit`.
 *
 * **Unterschrieben wird ueber die zwei Schritte des Dienstes** — Vorschau mit
 * Pruefsumme, dann Unterschrift gegen dieselbe Pruefsumme. Der Abzug in
 * `leistungsnachweis_signatur.snapshot` ist danach das, was das Blatt zeigt;
 * die lebende Tabelle ist es nicht mehr. Das ist der Kern von CLN-04, und ein
 * Seed, der die Signaturzeile selbst schriebe, haette den Vergleich beider
 * Digests uebersprungen — also genau die Zusage, um die es geht.
 *
 * **Die Unterschrift gelingt OHNE Bildspeicher.** `signatur_medien_id` bleibt
 * NULL: ohne Zugangsdaten entsteht keine Medienzeile, und die Oberflaeche sagt
 * „nicht verbunden". Ein vorgetaeuschtes Unterschriftsbild waere die
 * schlechtere Haelfte der Wahl.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien. Ein
 * unterschriebener Nachweis ist unveraenderlich (§1.15) und eine Beanstandung
 * kennt keine harte Loeschung (Invariante 8): ein Fehlgriff im zweiten Lauf
 * bliebe fuer immer stehen.
 */
import type postgres from 'postgres';
import { alsPortalSitzung } from './sitzung.js';
import { setzeRaeume } from '../../services/reinigung/revier.js';
import {
  bereiteUnterschriftVor, erstelleEntwurf, legeVor, signiere,
  type PositionEingabe,
} from '../../services/reinigung/leistungsnachweis.js';
import {
  erstelleReklamation, schreibeAbstellung,
} from '../../services/reinigung/reklamation.js';
import {
  erfasseAbruf, storniereAbruf,
} from '../../services/reinigung/sonderleistung.js';
import { erfassePruefung } from '../../services/reinigung/qualitaet.js';
import { tagePlus } from '@/lib/datum/kalendertag';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface ReinigungErgebnis {
  /** Reviere, die einen Zuschnitt bekommen haben. */
  readonly reviere: number;
  readonly revierRaeume: number;
  /** Zuordnungen, deren Leistungswert selbst noch ein Platzhalter ist (O-17). */
  readonly aufPlatzhalter: number;
  readonly nachweise: number;
  readonly positionen: number;
  readonly unterschriften: number;
  readonly reklamationen: number;
  /** Warum keine Nachweisnummer gezogen wurde, oder `null` (O-147). */
  readonly nummerOffen: string | null;
}

const LEER: ReinigungErgebnis = {
  reviere: 0, revierRaeume: 0, aufPlatzhalter: 0,
  nachweise: 0, positionen: 0, unterschriften: 0, reklamationen: 0,
  nummerOffen: null,
};

/* -------------------------------------------------------------------------- */
/* Teil 1 — der Zuschnitt                                                     */
/* -------------------------------------------------------------------------- */

interface RevierZeile {
  readonly id: string;
  readonly kurzzeichen: string | null;
  readonly objekt_id: string;
  /** Hat die Zone schon Raeume? Dann wird sie NICHT neu geschnitten (§5.2). */
  readonly belegt: boolean;
}

interface RaumZeile {
  readonly id: string;
  readonly bezeichnung: string | null;
  readonly hat_glas: boolean;
}

/**
 * Nebenraeume — Lager und Technik.
 *
 * Sie stehen nicht im taeglichen Turnus: in ein Technikgeschoss geht die
 * Unterhaltsreinigung nicht, und ein Lager wird bei der Grundreinigung
 * mitgenommen. Das ist eine Aussage ueber DIESE Demodaten und keine
 * Geschaeftsregel — welcher Raum in welche Zone faellt, entscheidet am Objekt
 * die Objektleitung, nicht ein Seed.
 */
function istNebenraum(bezeichnung: string | null): boolean {
  return bezeichnung !== null && /\b(Lager|Technik)\b/u.test(bezeichnung);
}

/**
 * Der Zuschnitt je Zone, an den Kurzzeichen aus `dienstplan.ts`.
 *
 * Drei Zonen ueber DERSELBEN Flaeche, und das ist kein Versehen: 0065 §5.2
 * sagt ausdruecklich, dass ein Raum in zwei Revieren stehen darf —
 * Unterhaltsreinigung und Glasreinigung sind zwei Reviere ueber denselben
 * Raeumen (CLN-05). Verboten ist nur die doppelte Zeile im selben Revier.
 *
 * // TODO(client, O-349): Rechnet ein Glasreinigungsrevier seine Sollzeit auf
 * die GLASflaeche und mit welchem Leistungswert? `berechneRevierSollzeit`
 * rechnet heute fuer jede Zone auf die BODENflaeche und den Leistungswert der
 * Belagsart; die Glasflaeche reist als Schnappschuss mit
 * (`revier_raum.fenster_flaeche_qm`), geht aber in keine Zeit ein. Die
 * Demozone „Glasflaechen" traegt deshalb die Raeume, die Glas haben — ihre
 * Sollzeit ist bis zur Antwort die des Bodens und keine Glasreinigungszeit.
 */
function zuschnitt(kurzzeichen: string | null, raeume: readonly RaumZeile[]): readonly RaumZeile[] {
  switch (kurzzeichen) {
    // Unterhaltsreinigung: alles, was taeglich betreten wird.
    case 'BG': return raeume.filter((r) => !istNebenraum(r.bezeichnung));
    // Glasreinigung: die Raeume, die ueberhaupt Glas tragen.
    case 'GL': return raeume.filter((r) => r.hat_glas);
    // Grundreinigung in der Nacht: das ganze Raumbuch, Nebenraeume eingeschlossen.
    case 'NH': return raeume;
    default: return raeume;
  }
}

async function schneideReviere(
  sql: Sql, mandantId: string, planerId: string,
): Promise<{ reviere: number; raeume: number; platzhalter: number }> {
  const reviere = await sql<RevierZeile[]>`
    select r.id, r.kurzzeichen, r.objekt_id,
           exists (select 1 from revier_raum rr where rr.revier_id = r.id) as belegt
      from revier r
      join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
     where r.mandant_id = ${mandantId} and r.archiviert_am is null
     order by o.objektnummer, r.bezeichnung`;

  /**
   * Der Stichtag der Kalkulation ist JETZT.
   *
   * `setzeRaeume` leitet daraus den BERLINER Kalendertag ab und befragt damit
   * `app.leistungswerte_lesen()` — der Katalog ist zeitversioniert, und mit
   * welchem Wert gerechnet wurde, steht anschliessend als Schnappschuss in
   * `revier_raum`.
   */
  const stichtag = new Date();

  let bearbeitet = 0;
  let raeume = 0;
  let platzhalter = 0;

  for (const revier of reviere) {
    // LESEN ZUERST: eine Zuordnung laesst sich nicht loesen (§5.2), also
    // wird eine vorhandene auch nicht neu geschnitten.
    if (revier.belegt) continue;

    const alle = await sql<RaumZeile[]>`
      select r.id, r.bezeichnung,
             coalesce(r.fenster_flaeche_qm, 0) > 0 as hat_glas
        from raum r
       where r.objekt_id = ${revier.objekt_id}
         and r.archiviert_am is null
         and r.belagsart_id is not null
       order by r.sortierung, r.raumnummer nulls last`;
    const gewaehlt = zuschnitt(revier.kurzzeichen, alle);
    if (gewaehlt.length === 0) continue;

    const ergebnis = await alsPortalSitzung(sql, mandantId, planerId, (kontext) =>
      setzeRaeume(kontext, revier.id, gewaehlt.map((r) => r.id), stichtag));

    bearbeitet += 1;
    raeume += ergebnis.zeit.raeume.length;
    platzhalter += ergebnis.aufPlatzhalter.length;
  }

  return { reviere: bearbeitet, raeume, platzhalter };
}

/* -------------------------------------------------------------------------- */
/* Teil 2 — der Leistungsnachweis                                             */
/* -------------------------------------------------------------------------- */

interface DurchgangZeile {
  readonly id: string;
  readonly auftrag_leistung_id: string;
  /** Berliner Kalendertag (K-11), aus der Datenbank. */
  readonly kalendertag: string;
  readonly tag: string;
  readonly fenster: string;
  readonly netto: number | null;
}

/**
 * Die erfassten Durchgaenge einer Zone — die Quelle jeder Nachweiszeile.
 *
 * NUR Eintraege mit `auftrag_leistung_id`: der Fremdschluessel
 * `lnp_zeiteintrag_fk` ist dreispaltig (Mandant, Auftragsleistung,
 * Zeiteintrag), und ohne den mittleren Teil liesse sich die Stunde eines
 * anderen Auftrags unter diese Position haengen. Die Glasreinigung des Seeds
 * hat mit Absicht KEINEN Abrechnungsanker (siehe `auftrag.ts`) — sie taucht
 * hier deshalb nicht auf, und das ist richtig so: sie ist der Fall, den
 * `zeiteintrag_ohne_auftrag` melden muss (FIN-18).
 *
 * Jede Zeit kommt FERTIG formatiert aus der Datenbank. Der Node-Prozess
 * rechnet keine Zone um (Invariante 2, K-11).
 */
async function durchgaenge(
  sql: Sql, mandantId: string, revierId: string,
): Promise<readonly DurchgangZeile[]> {
  return sql<DurchgangZeile[]>`
    select z.id,
           z.auftrag_leistung_id,
           to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'YYYY-MM-DD')
             as kalendertag,
           to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY') as tag,
           to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI')
             || '–' || to_char(z.ende_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI')
             as fenster,
           z.dauer_netto_minuten as netto
      from zeiteintrag z
     where z.mandant_id = ${mandantId}
       and z.revier_id = ${revierId}
       and z.status = 'abgeschlossen'
       and z.ersetzt_am is null
       and z.ende_zeitpunkt is not null
       and z.auftrag_leistung_id is not null
     order by z.beginn_zeitpunkt`;
}

/**
 * Der Monat, in dem der aelteste erfasste Durchgang liegt.
 *
 * Nicht „der Vormonat": der Demobestand beginnt drei Wochen vor heute, und ein
 * Nachweis ueber den Kalendervormonat waere an jedem Tag nach dem 22. eines
 * Monats ein Blatt ohne eine einzige Zeile. Der Leistungszeitraum spannt
 * anschliessend vom ERSTEN bis zum LETZTEN aufgenommenen Durchgang und nicht
 * ueber den ganzen Monat — er behauptet damit keine Woche, fuer die es keine
 * Schicht gibt.
 */
function ersterMonat(zeilen: readonly DurchgangZeile[]): readonly DurchgangZeile[] {
  const erster = zeilen[0];
  if (erster === undefined) return [];
  const monat = erster.kalendertag.slice(0, 7);
  return zeilen.filter((z) => z.kalendertag.startsWith(monat));
}

/**
 * Eine Nachweiszeile je Durchgang — Menge 1, Einheit „Durchgang".
 *
 * **Hier wird nichts umgerechnet.** Aus 212 erfassten Minuten eine Menge in
 * Stunden zu machen hiesse, im Seed zu runden; was auf dem Blatt steht, ist
 * deshalb der Durchgang selbst, und die erfasste Dauer steht als ANGABE in der
 * Bemerkung — formatiert von der Datenbank, nicht addiert.
 *
 * // TODO(client, O-348): Traegt eine Nachweisposition bei monatlicher
 * Pauschale einen Einzelpreis je Durchgang, und wie wird er aus der Pauschale
 * bestimmt? `einzelpreis_cent` bleibt bis zur Antwort NULL — der Nachweis
 * belegt die LEISTUNG, der Preis steht am Auftrag (`auftrag_leistung`), und
 * ein aus der Monatspauschale geteilter Betrag waere eine erfundene Zahl auf
 * einem Dokument, das der Kunde unterschreibt.
 */
function alsPositionen(
  leistung: string, zeilen: readonly DurchgangZeile[],
): readonly PositionEingabe[] {
  return zeilen.map((z) => ({
    bezeichnung: `${leistung} — Durchgang vom ${z.tag}`,
    menge: '1.000',
    einheit: 'Durchgang',
    einzelpreisCent: null,
    quelle: 'zeiteintrag' as const,
    zeiteintragId: z.id,
    auftragLeistungId: z.auftrag_leistung_id,
    bemerkung: z.netto === null
      ? `Schicht ${z.fenster} Uhr`
      : `Schicht ${z.fenster} Uhr, ${String(z.netto)} Min. erfasst`,
  }));
}

interface NachweisErgebnis {
  readonly id: string;
  readonly positionen: number;
  readonly nummerOffen: string | null;
}

/**
 * Entwurf anlegen und vorlegen — in EINER Sitzung, wie im Portal.
 *
 * `legeVor` zieht die Nummer aus dem Kreis `leistungsnachweis` (bestaetigt,
 * siehe `index.ts`) und meldet, wenn keiner da oder keiner bestaetigt ist. Was
 * NICHT passiert, ist eine erfundene Nummer (K-17, O-147).
 */
async function legeNachweisAn(
  sql: Sql, mandantId: string, planerId: string,
  bezug: {
    objektId: string; kundeId: string; revierId: string; leistung: string;
  },
  zeilen: readonly DurchgangZeile[],
): Promise<NachweisErgebnis> {
  const positionen = alsPositionen(bezug.leistung, zeilen);
  return alsPortalSitzung(sql, mandantId, planerId, async (kontext) => {
    const id = await erstelleEntwurf(kontext, {
      objektId: bezug.objektId,
      kundeId: bezug.kundeId,
      revierId: bezug.revierId,
      von: zeilen[0]!.kalendertag,
      bis: zeilen[zeilen.length - 1]!.kalendertag,
      positionen,
    });
    const vorlage = await legeVor(kontext, id);
    return { id, positionen: positionen.length, nummerOffen: vorlage.nummerOffen };
  });
}

/**
 * Und die Unterschrift — die zwei Schritte, um die es in CLN-04 geht.
 *
 * In EINER eigenen Sitzung und damit in einer eigenen Transaktion: zwischen
 * Vorlage und Fingerdruck liegen im Betrieb Tage, und ein Seed, der beides in
 * denselben Vorgang legte, koennte den Fall gar nicht zeigen, fuer den es die
 * Pruefsumme gibt.
 *
 * Die GERAETEZEIT kommt aus der Datenbank und nicht aus `new Date()`: die
 * Serveruhr ist die Bezugsgroesse (Invariante 5), und eine Abweichung, die in
 * Wahrheit der Versatz zweier Prozessuhren ist, waere eine erfundene Messung.
 * Knapp zwei Minuten Vorlauf sind das, was ein Tablet nach ein paar Wochen
 * hat — kein Alarm, sondern eine Angabe, die DANEBEN steht (TIM-08).
 */
async function lassUnterschreiben(
  sql: Sql, mandantId: string, planerId: string, nachweisId: string,
): Promise<void> {
  const [geraet] = await sql<{ zeit: Date }[]>`
    select now() + interval '113 seconds' as zeit`;

  await alsPortalSitzung(sql, mandantId, planerId, async (kontext) => {
    const vorschau = await bereiteUnterschriftVor(kontext, nachweisId);
    return signiere(kontext, {
      nachweisId,
      rolle: 'auftraggeber',
      unterzeichnerName: 'Frau Özdemir',
      unterzeichnerFunktion: 'Objektverantwortliche, Berliner Hausverwaltung GmbH',
      bestaetigtePruefsumme: vorschau.pruefsumme,
      geraeteZeit: geraet?.zeit ?? null,
      // KEIN Unterschriftsbild: ohne Zugangsdaten gibt es keine Medienzeile,
      // und die Oberflaeche sagt „nicht verbunden" statt zu tun als ob.
      signaturMedienId: null,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Teil 3 — die Beanstandungen                                                */
/* -------------------------------------------------------------------------- */

/**
 * Zwei Beanstandungen, und die zweite ist die schwierigere.
 *
 * Die OFFENE bestreitet den UNTERSCHRIEBENEN Nachweis — der Fall, um den es in
 * OPS-11 geht: der Kunde hat quittiert und beschwert sich ueber denselben
 * Zeitraum. Ohne den Verweis waere das ein Vorgang, den niemand verknuepft,
 * und die Rechnungsfreigabe liefe daran vorbei (FIN-18).
 *
 * Die BEHOBENE traegt eine Abstellmassnahme, weil „behoben" ohne sie weder vom
 * Dienst (`MassnahmeFehlt`, 422) noch von der Datenbank
 * (`rk_behoben_hat_massnahme`) angenommen wird. Das ist kein Hindernis, um das
 * man herumseedet, sondern die Regel selbst: eine Massnahme fehlt nicht, sie
 * wurde vergessen.
 *
 * Und sie traegt die NACHARBEITSSCHICHT — den `einsatz`, nicht die Person. Wer
 * nacharbeitet, kann wechseln; dass an diesem Tag auf diesem Objekt
 * nachgearbeitet wurde, bleibt.
 *
 * **Keine Frist.** `faellig_am` schreibt der SLA-Dienst, und den gibt es
 * nicht, weil die Frist je Prioritaet unbeantwortet ist.
 * // TODO(client, O-14): Welche Reaktions- und Behebungsfrist gilt je
 * Prioritaet — Vertrags-SLA je Auftrag oder je Gesellschaft?
 */
async function seedReklamationen(
  sql: Sql, mandantId: string, planerId: string,
  bezug: {
    objektId: string; kundeId: string;
    revierUnterhalt: string; revierGrund: string;
    nachweisSigniert: string; nachweisOffen: string;
  },
): Promise<number> {
  await alsPortalSitzung(sql, mandantId, planerId, (kontext) =>
    erstelleReklamation(kontext, {
      objektId: bezug.objektId,
      kundeId: bezug.kundeId,
      revierId: bezug.revierUnterhalt,
      leistungsnachweisId: bezug.nachweisSigniert,
      quelle: 'kunde',
      prioritaet: 'hoch',
      beschreibung:
        'Treppenhaus A im 3. OG am Montagmorgen nicht gereinigt: Getränkeflecken '
        + 'vor dem Aufzug, Papierkörbe auf dem Podest nicht geleert. Der '
        + 'Leistungsnachweis für denselben Zeitraum ist bereits gegengezeichnet.',
      gemeldetVonName: 'Frau Özdemir, Objektverantwortliche',
    }));

  const behoben = await alsPortalSitzung(sql, mandantId, planerId, (kontext) =>
    erstelleReklamation(kontext, {
      objektId: bezug.objektId,
      kundeId: bezug.kundeId,
      revierId: bezug.revierGrund,
      leistungsnachweisId: bezug.nachweisOffen,
      quelle: 'eigenkontrolle',
      prioritaet: 'mittel',
      beschreibung:
        'Eigenkontrolle nach der Grundreinigung: Natursteinboden im Foyer '
        + 'streifig, an zwei Stellen Pflegefilmreste. Auffällig bei Streiflicht '
        + 'am Morgen.',
      gemeldetVonName: 'Objektleitung Kurfürstendamm',
    }));

  /**
   * Die Nacharbeitsschicht ist eine BEREITS GELAUFENE — sonst stuende eine
   * behobene Beanstandung mit einem Termin in der Zukunft da, und „behoben"
   * hiesse „vorgemerkt".
   */
  const [nacharbeit] = await sql<{ id: string }[]>`
    select e.id from einsatz e
     where e.mandant_id = ${mandantId}
       and e.revier_id = ${bezug.revierGrund}
       and e.plan_datum <= current_date
     order by e.plan_datum desc
     limit 1`;

  await alsPortalSitzung(sql, mandantId, planerId, (kontext) =>
    schreibeAbstellung(kontext, {
      id: behoben.id,
      status: 'behoben',
      ursache:
        'Pflegemittel überdosiert und zu kurze Einwirkzeit; die Maschine lief '
        + 'mit dem Pad der Unterhaltsreinigung statt mit dem Polierpad.',
      massnahme:
        'Foyer mit Grundreiniger nachgearbeitet und neu eingepflegt, Pad- und '
        + 'Dosiervorgabe in die Objektmappe aufgenommen, Einweisung des Teams '
        + 'am 06.00-Uhr-Antritt wiederholt.',
      nacharbeitEinsatzId: nacharbeit?.id ?? null,
      verantwortlichBenutzerId: planerId,
    }));

  return 2;
}

/* -------------------------------------------------------------------------- */

export async function seedReinigung(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<ReinigungErgebnis> {
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined) throw new Error('Bereich reinigung fehlt');

  /**
   * Der Planer traegt `reinigung.schreiben`, `nachweis.schreiben` und
   * `qualitaet.schreiben` — alle drei haengen an `admin` und `leitung` (0008).
   * Ohne ihn laeuft nichts, und der Seed steigt aus, statt als Eigentuemer an
   * jeder Policy vorbeizuschreiben.
   *
   * Unter mehreren Administrationen zuerst eine ohne Modulliste, dann die
   * E-Mail — nie die Reihenfolge der Tabelle (V-168).
   */
  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung', 'super_admin') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel, bm.module is not null, b.email limit 1`;
  if (planer === undefined) return LEER;

  const zuschnittLauf = await schneideReviere(sql, mandantId, planer.id);

  /**
   * Und darauf der Nachweis — NACH dem Zuschnitt, weil sein Kopf das Revier
   * nennt und das Revierblatt aus dem Nachweis heraus erreichbar sein soll.
   * Eine Abhaengigkeit, keine Reihenfolge nach Geschmack.
   */
  const [unterhalt] = await sql<{
    id: string; objekt_id: string; kunde_id: string | null; objekt: string;
  }[]>`
    select r.id, r.objekt_id, o.kunde_id, o.bezeichnung as objekt
      from revier r
      join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
     where r.mandant_id = ${mandantId} and r.archiviert_am is null
       and r.kurzzeichen = 'BG' and o.kunde_id is not null
     order by o.objektnummer limit 1`;

  /** Der Zuschnitt zaehlt auch dann, wenn kein Nachweis entstehen kann. */
  const nurZuschnitt: ReinigungErgebnis = {
    ...LEER,
    reviere: zuschnittLauf.reviere,
    revierRaeume: zuschnittLauf.raeume,
    aufPlatzhalter: zuschnittLauf.platzhalter,
  };
  if (unterhalt === undefined || unterhalt.kunde_id === null) return nurZuschnitt;

  const [grund] = await sql<{ id: string }[]>`
    select r.id from revier r
     where r.mandant_id = ${mandantId} and r.archiviert_am is null
       and r.kurzzeichen = 'NH'
       and r.objekt_id = ${unterhalt.objekt_id}
     limit 1`;
  if (grund === undefined) return nurZuschnitt;

  // LESEN ZUERST: ein unterschriebener Nachweis ist unveraenderlich, ein
  // zweiter Lauf duerfte ihn nicht verdoppeln.
  const [nachweisDa] = await sql<{ id: string }[]>`
    select id from leistungsnachweis
     where mandant_id = ${mandantId} and revier_id = ${unterhalt.id} limit 1`;
  if (nachweisDa !== undefined) return nurZuschnitt;

  const monatUnterhalt = ersterMonat(await durchgaenge(sql, mandantId, unterhalt.id));
  const monatGrund = ersterMonat(await durchgaenge(sql, mandantId, grund.id));
  if (monatUnterhalt.length === 0 || monatGrund.length === 0) {
    process.stdout.write(
      '  · Leistungsnachweise bleiben leer: keine erfasste Zeit mit '
      + 'Abrechnungsanker (FIN-07)\n');
    return nurZuschnitt;
  }

  const bezug = {
    objektId: unterhalt.objekt_id, kundeId: unterhalt.kunde_id,
  } as const;

  /**
   * Der UNTERSCHRIEBENE ist der monatliche Unterhaltsnachweis — der Fall, den
   * ein Kunde tatsaechlich gegenzeichnet.
   */
  const signiert = await legeNachweisAn(sql, mandantId, planer.id, {
    ...bezug, revierId: unterhalt.id, leistung: 'Unterhaltsreinigung Bürogeschosse',
  }, monatUnterhalt);
  await lassUnterschreiben(sql, mandantId, planer.id, signiert.id);

  /**
   * Und der OFFENE ist die Grundreinigung: vorgelegt, noch nicht quittiert —
   * das Blatt, auf dem das Unterschriftsformular samt Pruefsumme steht.
   */
  const offen = await legeNachweisAn(sql, mandantId, planer.id, {
    ...bezug, revierId: grund.id, leistung: 'Grundreinigung Nachtschicht',
  }, monatGrund);

  const reklamationen = await seedReklamationen(sql, mandantId, planer.id, {
    ...bezug,
    revierUnterhalt: unterhalt.id,
    revierGrund: grund.id,
    nachweisSigniert: signiert.id,
    nachweisOffen: offen.id,
  });

  return {
    reviere: zuschnittLauf.reviere,
    revierRaeume: zuschnittLauf.raeume,
    aufPlatzhalter: zuschnittLauf.platzhalter,
    nachweise: 2,
    positionen: signiert.positionen + offen.positionen,
    unterschriften: 1,
    reklamationen,
    nummerOffen: signiert.nummerOffen ?? offen.nummerOffen,
  };
}

/* ==========================================================================
 * Teil 4 — Sonderleistungen und Qualitaetspruefungen (CLN-05, OPS-11)
 *
 * **Beide Tabellen hatten im ganzen Seed null Zeilen**, und
 * `leistungskatalog_position` genau eine (das Platzhalterelement). Die Seiten
 * `/reinigung/sonderleistungen`, `/qualitaet/pruefungen` und
 * `/qualitaet/pruefungen/[id]` waren damit baubar, aber nicht belegbar: eine
 * leere Tabelle prueft keine Spalte, keinen Zustand und keinen Verweis.
 *
 * **Die Werte der Katalogzeilen sind PLATZHALTER und sagen es.** Welcher
 * Zeitwert fuer Glasreinigung gilt, ist eine Kalkulationsgrundlage und steht
 * in keinem Dokument dieser Plattform (O-17, dieselbe Lage wie bei den
 * Leistungswerten der Belagsarten). `ist_platzhalter` bleibt deshalb `true`,
 * die Oberflaeche schreibt „Zeitwert unbestaetigt", und kein Preis wird
 * erfunden: `standard_einzelpreis_cent` bleibt NULL, denn bepreist wird ueber
 * `auftrag_leistung` — den mit DIESEM Kunden vereinbarten Preis (0067).
 * ======================================================================= */

/** Die drei Sonderleistungen, die CLN-05 namentlich nennt. */
const SONDERKATALOG: readonly {
  readonly oz: string;
  readonly kurztext: string;
  readonly langtext: string;
  readonly einheit: string;
  /** PLATZHALTER (O-17) — als Text, damit kein Double dazwischenkommt. */
  readonly zeitwertMinuten: string;
}[] = [
  {
    oz: '90.10', kurztext: 'Glasreinigung', einheit: 'm²',
    langtext: 'Glasflächen innen und aussen, einschliesslich Rahmen und Bank.',
    zeitwertMinuten: '3.500',
  },
  {
    oz: '90.20', kurztext: 'Sonderreinigung', einheit: 'm²',
    langtext: 'Grund- oder Bauendreinigung nach Aufmass, einzeln beauftragt.',
    zeitwertMinuten: '6.000',
  },
  {
    oz: '90.30', kurztext: 'Warenräumung', einheit: 'Stunde',
    langtext: 'Räumung und Entsorgung nach Aufwand, mit Entsorgungsnachweis.',
    zeitwertMinuten: '60.000',
  },
];

/**
 * Die Katalogzeilen der Sonderleistungen — in den Katalog, der schon da ist.
 *
 * Kein neuer `leistungskatalog`: es gibt einen je Gesellschaft, und ein
 * zweiter waere eine zweite Antwort auf „welcher Katalog gilt".
 */
async function seedSonderkatalog(
  sql: Sql, mandantId: string,
): Promise<readonly { readonly id: string; readonly kurztext: string }[]> {
  const [katalog] = await sql<{ id: string }[]>`
    select id from leistungskatalog
     where mandant_id = ${mandantId} and status <> 'archiviert'
     order by version desc limit 1`;
  if (katalog === undefined) return [];

  const zeilen: { id: string; kurztext: string }[] = [];
  for (const [index, k] of SONDERKATALOG.entries()) {
    const [da] = await sql<{ id: string }[]>`
      select id from leistungskatalog_position
       where mandant_id = ${mandantId} and katalog_id = ${katalog.id} and oz = ${k.oz}
         and gueltig_bis is null limit 1`;
    if (da !== undefined) {
      zeilen.push({ id: da.id, kurztext: k.kurztext });
      continue;
    }
    const [neu] = await sql<{ id: string }[]>`
      insert into leistungskatalog_position
        (mandant_id, katalog_id, oz, kurztext, langtext, einheit, zeitwert_minuten,
         kostenart, ist_platzhalter, gueltig_ab, sortierung)
      values (${mandantId}, ${katalog.id}, ${k.oz}, ${k.kurztext}, ${k.langtext},
              ${k.einheit},
              ${k.zeitwertMinuten}::numeric, -- nicht-geld: Minuten je Einheit
              'lohn',
              /* PLATZHALTER: der Zeitwert ist nicht bestaetigt (O-17). */
              true, '2026-01-01', ${900 + index})
      returning id`;
    if (neu !== undefined) zeilen.push({ id: neu.id, kurztext: k.kurztext });
  }
  return zeilen;
}

/**
 * Einzelabrufe in vier Zustaenden — die, die die Seite unterscheiden muss.
 *
 * `angefragt` (noch keine Beauftragung), `beauftragt` (Termin steht aus),
 * `erbracht` (abrechenbar — genau das liest `einzelabruf.ts`) und `storniert`
 * (mit Grund und Urheber, NICHT geloescht, Invariante 8). `abgerechnet` fehlt
 * absichtlich: diesen Stempel setzt die Rechnungsuebernahme, und ein Seed, der
 * ihn selbst schreibt, behauptete eine Rechnung, die es nicht gibt.
 *
 * Der Abruf laeuft ueber den ECHTEN Dienst (`erfasseAbruf`) und damit unter
 * RLS — ein `insert` als Eigentuemer haette an jeder Policy vorbeigeschrieben
 * und im Seed nie gezeigt, ob der Schreibweg ueberhaupt gangbar ist.
 */
async function seedSonderleistungen(
  sql: Sql, mandantId: string, planerId: string, heute: string,
): Promise<number> {
  const katalog = await seedSonderkatalog(sql, mandantId);
  if (katalog.length === 0) return 0;

  const [objekt] = await sql<{ id: string; kunde_id: string }[]>`
    select o.id, o.kunde_id from objekt o
     where o.mandant_id = ${mandantId} and o.archiviert_am is null
       and o.kunde_id is not null
     order by o.objektnummer limit 1`;
  if (objekt === undefined) return 0;

  const [revier] = await sql<{ id: string }[]>`
    select id from revier
     where mandant_id = ${mandantId} and objekt_id = ${objekt.id}
       and archiviert_am is null
     order by sortierung limit 1`;

  /** Die Auftragszeile, aus der der PREIS kommt — nicht aus dem Katalog. */
  const [leistung] = await sql<{ id: string }[]>`
    select al.id from auftrag_leistung al
     join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
    where al.mandant_id = ${mandantId} and al.objekt_id = ${objekt.id}
      and a.status = 'aktiv'
    order by al.position_nr limit 1`;

  const abrufe: readonly {
    readonly katalog: number;
    readonly bezeichnung: string;
    readonly beauftragtVor: number;
    readonly fensterVon: number | null;
    readonly fensterBis: number | null;
    readonly menge: string | null;
    readonly einheit: string | null;
    readonly status: 'angefragt' | 'beauftragt' | 'geplant' | 'erbracht';
    readonly stornoGrund: string | null;
  }[] = [
    {
      katalog: 0, bezeichnung: 'Glasreinigung Treppenhaus, aussen',
      beauftragtVor: -18, fensterVon: -4, fensterBis: -3,
      menge: '184.500', einheit: 'm²', status: 'erbracht', stornoGrund: null,
    },
    {
      katalog: 1, bezeichnung: 'Sonderreinigung Kantine nach Wasserschaden',
      beauftragtVor: -6, fensterVon: 3, fensterBis: 4,
      menge: '96.000', einheit: 'm²', status: 'beauftragt', stornoGrund: null,
    },
    {
      katalog: 2, bezeichnung: 'Warenräumung Kellerarchiv',
      beauftragtVor: -2, fensterVon: null, fensterBis: null,
      menge: null, einheit: null, status: 'angefragt', stornoGrund: null,
    },
    {
      katalog: 0, bezeichnung: 'Glasreinigung Fassade Südseite',
      beauftragtVor: -25, fensterVon: -10, fensterBis: -9,
      menge: '240.000', einheit: 'm²', status: 'beauftragt',
      stornoGrund: 'Gerüst nicht gestellt — Kunde hat abbestellt',
    },
  ];

  let angelegt = 0;
  for (const a of abrufe) {
    const [da] = await sql<{ id: string }[]>`
      select id from sonderleistung
       where mandant_id = ${mandantId} and bezeichnung = ${a.bezeichnung} limit 1`;
    if (da !== undefined) continue;
    const position = katalog[a.katalog];
    if (position === undefined) continue;

    const id = await alsPortalSitzung(sql, mandantId, planerId, async (kontext) => {
      const { id: neu } = await erfasseAbruf(kontext, {
        objektId: objekt.id,
        kundeId: objekt.kunde_id,
        leistungskatalogPositionId: position.id,
        bezeichnung: a.bezeichnung,
        beauftragtAm: tagePlus(heute, a.beauftragtVor),
        revierId: revier?.id ?? null,
        auftragLeistungId: leistung?.id ?? null,
        beauftragtDurch: 'Objektverwaltung des Kunden',
        ausfuehrungVon: a.fensterVon === null ? null : tagePlus(heute, a.fensterVon),
        ausfuehrungBis: a.fensterBis === null ? null : tagePlus(heute, a.fensterBis),
        menge: a.menge,
        einheit: a.einheit,
        status: a.status,
      });
      if (a.stornoGrund !== null) {
        await storniereAbruf(kontext, { id: neu, grund: a.stornoGrund });
      }
      return neu;
    });
    if (id !== undefined) angelegt += 1;
  }
  return angelegt;
}

/**
 * Zwei Qualitaetspruefungen — eine mit Mangel und ueberfaelliger Frist, eine
 * ohne Befund im Zustand „nicht in Ordnung".
 *
 * **Ohne Skala kein Urteil.** Das Pruefverfahren ist der Platzhalter
 * `unbestimmt` (`max_punkte` NULL, `bestehensschwelle_prozent` NULL,
 * `ist_platzhalter` true); `erfassePruefung` laesst `bestanden` deshalb auf
 * NULL — nicht auf `false` (K-17, O-29). Die EINZELNEN Befunde tragen
 * trotzdem Punkte, damit nichts verloren geht, sobald der Kunde die Skala
 * nennt.
 *
 * **Die ueberfaellige Frist ist Absicht.** Sie ist der einzige Zustand, an
 * dem sich zeigen laesst, dass die Seite eine verstrichene Maengelfrist
 * farbig UND im Text markiert (DESIGN §9) — und dass daraus NICHTS von selbst
 * folgt (O-705).
 *
 * **Die Kriterien sind freier Text**, weil es keinen Kriterienkatalog gibt
 * (O-29). Eine Tabelle mit vorgegebenen Pruefkriterien anzulegen waere eine
 * erfundene Geschaeftsregel.
 */
async function seedQualitaetspruefungen(
  sql: Sql, mandantId: string, planerId: string, heute: string,
): Promise<number> {
  const [objekt] = await sql<{ id: string; kunde_id: string }[]>`
    select o.id, o.kunde_id from objekt o
     where o.mandant_id = ${mandantId} and o.archiviert_am is null
       and o.kunde_id is not null
     order by o.objektnummer limit 1`;
  if (objekt === undefined) return 0;

  const [revier] = await sql<{ id: string; objekt_id: string }[]>`
    select id, objekt_id from revier
     where mandant_id = ${mandantId} and objekt_id = ${objekt.id}
       and archiviert_am is null
     order by sortierung limit 1`;

  /** Die Revierraeume DIESES Reviers — ein fremder waere ein falscher Befund. */
  const revierRaeume = revier === undefined ? [] : await sql<{ id: string }[]>`
    select rr.id from revier_raum rr
     where rr.mandant_id = ${mandantId} and rr.revier_id = ${revier.id}
     order by rr.reihenfolge limit 3`;

  const [verfahren] = await sql<{ id: string }[]>`
    select id from pruefverfahren
     where mandant_id = ${mandantId} and archiviert_am is null
     order by ist_platzhalter, bezeichnung limit 1`;
  if (verfahren === undefined) return 0;

  const [pruefer] = await sql<{ id: string }[]>`
    select a.id from anstellung a
     join benutzer b on b.person_id = a.person_id
    where a.mandant_id = ${mandantId} and a.status = 'aktiv'
      and a.geloescht_am is null and b.id = ${planerId}
    limit 1`;

  const [schon] = await sql<{ n: string }[]>`
    select count(*)::text as n from qualitaetspruefung where mandant_id = ${mandantId}`;
  if (Number(schon?.n ?? '0') > 0) return 0;

  return alsPortalSitzung(sql, mandantId, planerId, async (kontext) => {
    let angelegt = 0;

    /* Erste Pruefung: mit Mangel und ÜBERFÄLLIGER Frist. */
    await erfassePruefung(kontext, {
      objektId: objekt.id,
      revierId: revier?.id ?? null,
      kundeId: objekt.kunde_id,
      pruefverfahrenId: verfahren.id,
      prueferAnstellungId: pruefer?.id ?? null,
      prueferExternName: pruefer === undefined ? 'Objektleitung (extern erfasst)' : null,
      mitKunde: true,
      bemerkung: 'Begehung mit der Objektverwaltung des Kunden, Rundgang EG bis 2. OG.',
      positionen: [
        {
          kriterium: 'Böden — Nassreinigung',
          ergebnis: 'io',
          punkte: '5.00',
          revierRaumId: revierRaeume[0]?.id ?? null,
        },
        {
          kriterium: 'Sanitärbereich — Becken und Armaturen',
          ergebnis: 'nio',
          punkte: '1.00',
          revierRaumId: revierRaeume[1]?.id ?? null,
          mangelBeschreibung:
            'Kalkränder an drei Armaturen, Spiegel nicht nachgezogen.',
          /* Die Frist ist VERSTRICHEN — der Zustand, den die Seite markieren
             muss und aus dem NICHTS von selbst folgt (O-705). */
          fristAm: tagePlus(heute, -5),
        },
        {
          kriterium: 'Sanitärbereich — Verbrauchsmaterial',
          ergebnis: 'nio',
          punkte: '2.00',
          revierRaumId: revierRaeume[1]?.id ?? null,
          mangelBeschreibung: 'Handtuchspender in Damen-WC leer.',
          fristAm: tagePlus(heute, 7),
        },
        {
          kriterium: 'Glasflächen innen',
          ergebnis: 'nicht_pruefbar',
          punkte: null,
          mangelBeschreibung: null,
        },
      ],
    });
    angelegt += 1;

    /* Zweite Pruefung: ohne Mangel — damit die Liste beide Faelle zeigt. */
    await erfassePruefung(kontext, {
      objektId: objekt.id,
      revierId: revier?.id ?? null,
      kundeId: objekt.kunde_id,
      pruefverfahrenId: verfahren.id,
      prueferAnstellungId: pruefer?.id ?? null,
      prueferExternName: pruefer === undefined ? 'Objektleitung (extern erfasst)' : null,
      mitKunde: false,
      bemerkung: 'Eigenkontrolle ohne Kunden, Stichprobe Treppenhaus.',
      positionen: [
        {
          kriterium: 'Treppenhaus — Handläufe',
          ergebnis: 'io',
          punkte: '5.00',
          revierRaumId: revierRaeume[0]?.id ?? null,
        },
        {
          kriterium: 'Abfallbehälter geleert',
          ergebnis: 'io',
          punkte: '5.00',
        },
      ],
    });
    angelegt += 1;

    return angelegt;
  });
}

/**
 * Sonderleistungen und Qualitaetspruefungen — der Nachtrag zu `seedReinigung`.
 *
 * Eine eigene Funktion und kein Anhaengsel: sie steigt einzeln aus, wenn
 * Objekt, Katalog oder Planer fehlen, und ein fehlender Abruf soll nicht den
 * Revierzuschnitt verhindern.
 */
export interface SonderErgebnis {
  readonly abrufe: number;
  readonly pruefungen: number;
}

export async function seedSonderUndQualitaet(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<SonderErgebnis> {
  const leer: SonderErgebnis = { abrufe: 0, pruefungen: 0 };
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined) return leer;

  /* Unter mehreren Administrationen zuerst eine ohne Modulliste, dann die
     E-Mail — nie die Reihenfolge der Tabelle (V-168). */
  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung', 'super_admin') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel, bm.module is not null, b.email limit 1`;
  if (planer === undefined) return leer;

  const [tag] = await sql<{ t: string }[]>`select app.berlin_heute()::text as t`;
  const heute = tag?.t ?? '2026-01-01';

  return {
    abrufe: await seedSonderleistungen(sql, mandantId, planer.id, heute),
    pruefungen: await seedQualitaetspruefungen(sql, mandantId, planer.id, heute),
  };
}
