/**
 * Der Leistungsnachweis — Entwurf, Vorlage, Unterschrift (CLN-04, FIN-05,
 * FIN-07, TIM-08, TIM-09, LEG-01, LEG-10, DOC-03).
 *
 * **Zwei Schritte, und dass es zwei sind, ist die ganze Zusage.**
 *
 *   1. `bereiteUnterschriftVor` liest die Zeilen SERVERSEITIG, baut daraus den
 *      Abzug, den die Oberfläche anzeigt, und gibt dessen Digest als
 *      `pruefsumme` zurück.
 *   2. `signiere` bekommt diese `pruefsumme` zurück, liest die Zeilen NOCH
 *      EINMAL, baut den Abzug NOCH EINMAL — und schreibt nur, wenn beide
 *      Digests gleich sind.
 *
 * Ohne Schritt 2 hieße „Schnappschuss der Positionen genau wie angezeigt"
 * nichts: zwischen dem Aufbau des Bildschirms und dem Fingerdruck auf dem
 * Tablet liegen Minuten, in denen das Büro eine Zeile korrigieren kann. Der
 * Kunde unterschriebe dann unter etwas, das er nicht gesehen hat, und der
 * Abzug wäre trotzdem „korrekt".
 *
 * **Die Zeit kommt vom Server, der Ort vom Gerät, und beides steht getrennt.**
 * `unterzeichnet_am` stempelt ein Auslöser mit `now()` (Invariante 5); was das
 * Tablet behauptet, landet in `geraete_zeit`, und die Abweichung leitet
 * dieselbe Funktion ab (TIM-08, TIM-09). Ein Gerät, das zwei Stunden falsch
 * geht, ändert damit keine Zeitangabe im Dokument — es hinterlässt eine
 * Tatsache im Protokoll.
 *
 * **Das Unterschriftsbild ist privat.** Es liegt im Bucket `einsatz-medien`
 * (0041) und ist ausschließlich über eine signierte Adresse erreichbar
 * (`signierteMedienAdresse`). Ohne Zugangsdaten wirft der Speicheradapter
 * `NichtVerbundenFehler`, es entsteht KEINE Medienzeile, die Oberfläche meldet
 * „nicht verbunden" — und die Unterschrift selbst (Name, Serverzeit, Abzug)
 * gelingt trotzdem. Ein vorgetäuschter Erfolg wäre die schlechtere Hälfte der
 * Wahl.
 *
 * **Gerechnet wird hier nichts.** Der Dienst kopiert Zeichenketten, die die
 * Datenbank geliefert hat — Beträge als Cent-Text, Mengen als `numeric`-Text,
 * Uhrzeiten als Berliner Ortszeit aus `at time zone`. Kein Betrag wird
 * addiert, keine Zone im Node-Prozess umgerechnet.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { NummernkreisFehler, vergebeNummer } from '../finanz/nummernkreis.js';
import {
  alsSchnappschuss, baueSchnappschuss, schnappschussHash,
  type SchnappschussPosition, type SchnappschussWert,
} from './schnappschuss.js';

/**
 * Der Text, unter dem unterschrieben wird — DEUTSCH, immer.
 *
 * Die Bedienoberfläche ist mehrsprachig (EMP-12); dieser Satz ist es nicht.
 * Er ist die Erklärung, an die die Gesellschaft gebunden ist, und eine
 * übersetzte Fassung daneben wäre eine zweite Erklärung mit möglicherweise
 * anderer Bedeutung (04-SEITENKARTE.md §5.7).
 */
export const BESTAETIGUNGSTEXT =
  'Die vorstehend aufgeführten Leistungen wurden im angegebenen Zeitraum erbracht '
  + 'und werden hiermit bestätigt.';

export class NachweisNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404, nicht 403: dass es die Zeile anderswo gibt, ist selbst eine
    // Auskunft (AUT-06).
    super(`Leistungsnachweis ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'NachweisNichtGefunden';
  }
}

export class FalscherZustand extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(ist: string, erwartet: string) {
    super(`Der Leistungsnachweis steht auf „${ist}"; erwartet war „${erwartet}".`);
    this.name = 'FalscherZustand';
  }
}

/**
 * Zwischen Anzeige und Unterschrift hat sich etwas geändert.
 *
 * Der Fall, für den es die Prüfsumme gibt — und der einzige, in dem eine
 * Unterschrift abgewiesen wird, obwohl formal alles stimmt.
 */
export class AnzeigeVeraltet extends Error {
  readonly code = 'konflikt';
  readonly status = 409;
  constructor(readonly erwartet: string, readonly tatsaechlich: string) {
    super(
      'Die angezeigten Positionen sind nicht mehr die aktuellen. Es wird nichts '
      + 'unterschrieben — bitte den Nachweis neu laden und erneut vorlegen.',
    );
    this.name = 'AnzeigeVeraltet';
  }
}

export class BereitsUnterschrieben extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(rolle: string) {
    super(`Für die Rolle „${rolle}" liegt bereits eine Unterschrift vor.`);
    this.name = 'BereitsUnterschrieben';
  }
}

export type UnterschriftRolle = 'auftraggeber' | 'auftragnehmer';

/* ------------------------------------------------------------------------ */
/* Lesen                                                                     */
/* ------------------------------------------------------------------------ */

export interface NachweisKopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly objektId: string | null;
  readonly objekt: string | null;
  readonly revierId: string | null;
  readonly revier: string | null;
  readonly kundeId: string;
  readonly kunde: string;
  readonly leistungszeitraumVon: string;
  readonly leistungszeitraumBis: string;
  readonly vorgelegtAmLokal: string | null;
  readonly gesperrtAmLokal: string | null;
  readonly storniertAmLokal: string | null;
  readonly abgelehntGrund: string | null;
}

interface KopfZeile {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly objekt_id: string | null;
  readonly objekt: string | null;
  readonly revier_id: string | null;
  readonly revier: string | null;
  readonly kunde_id: string;
  readonly kunde: string;
  readonly von: string;
  readonly bis: string;
  readonly vorgelegt_lokal: string | null;
  readonly gesperrt_lokal: string | null;
  readonly storniert_lokal: string | null;
  readonly abgelehnt_grund: string | null;
}

/**
 * Jede Ortszeit kommt FERTIG aus der Datenbank (`at time zone 'Europe/Berlin'`).
 *
 * Der Node-Prozess rechnet keine Zone um: seine Zonendatenbank ist nicht die
 * des Servers, und `TZ` der Laufzeit soll eine Unterschrift um 23:40 nicht auf
 * den Folgetag schieben (Invariante 2).
 */
const KOPF_SPALTEN = `
  l.id, l.nummer, l.status::text as status,
  l.objekt_id, o.bezeichnung as objekt,
  l.revier_id, rv.bezeichnung as revier,
  l.kunde_id, k.name as kunde,
  to_char(l.leistungszeitraum_von, 'YYYY-MM-DD') as von,
  to_char(l.leistungszeitraum_bis, 'YYYY-MM-DD') as bis,
  to_char(l.vorgelegt_am  at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as vorgelegt_lokal,
  to_char(l.gesperrt_am   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as gesperrt_lokal,
  to_char(l.storniert_am  at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as storniert_lokal,
  l.abgelehnt_grund`;

const KOPF_QUELLE = `
  from leistungsnachweis l
  join kunde k on k.id = l.kunde_id and k.mandant_id = l.mandant_id
  left join objekt o on o.id = l.objekt_id and o.mandant_id = l.mandant_id
  left join revier rv on rv.id = l.revier_id and rv.mandant_id = l.mandant_id`;

function alsKopf(z: KopfZeile): NachweisKopf {
  return {
    id: z.id,
    nummer: z.nummer,
    status: z.status,
    objektId: z.objekt_id,
    objekt: z.objekt,
    revierId: z.revier_id,
    revier: z.revier,
    kundeId: z.kunde_id,
    kunde: z.kunde,
    leistungszeitraumVon: z.von,
    leistungszeitraumBis: z.bis,
    vorgelegtAmLokal: z.vorgelegt_lokal,
    gesperrtAmLokal: z.gesperrt_lokal,
    storniertAmLokal: z.storniert_lokal,
    abgelehntGrund: z.abgelehnt_grund,
  };
}

export async function findeNachweis(
  kontext: LeseKontext, id: string,
): Promise<NachweisKopf | null> {
  const [z] = await kontext.abfrage<KopfZeile>(
    `select ${KOPF_SPALTEN} ${KOPF_QUELLE} where l.id = $1::uuid`, [id],
  );
  return z === undefined ? null : alsKopf(z);
}

export async function listeNachweise(
  kontext: LeseKontext, filter: { readonly status?: string | null } = {},
): Promise<readonly NachweisKopf[]> {
  const zeilen = await kontext.abfrage<KopfZeile>(
    `select ${KOPF_SPALTEN} ${KOPF_QUELLE}
      where ($1::text is null or l.status::text = $1)
      order by l.leistungszeitraum_bis desc, l.erstellt_am desc
      limit 200`,
    [filter.status ?? null],
  );
  return zeilen.map(alsKopf);
}

interface PositionZeile {
  readonly reihenfolge: string;
  readonly bezeichnung: string;
  readonly menge: string;
  readonly einheit: string;
  readonly einzelpreis_cent: string | null;
  readonly quelle: string;
  readonly von_lokal: string | null;
  readonly bis_lokal: string | null;
  readonly bemerkung: string | null;
}

/**
 * Die Zeilen, GENAU so, wie sie angezeigt werden.
 *
 * Alles als Text, und zwar von der Datenbank formatiert: `einzelpreis_cent`
 * als Ganzzahltext, damit kein Betrag durch eine Gleitkommazahl läuft
 * (Invariante 1), und die zwei Zeitpunkte als Berliner Ortszeit, weil die
 * Umrechnung in die Datenbank gehört (Invariante 2).
 */
export async function ladePositionen(
  kontext: LeseKontext, nachweisId: string,
): Promise<readonly SchnappschussPosition[]> {
  const zeilen = await kontext.abfrage<PositionZeile>(
    `select p.reihenfolge::text as reihenfolge,
            p.bezeichnung,
            p.menge::text as menge,
            p.einheit,
            p.einzelpreis_cent::text as einzelpreis_cent,
            p.quelle::text as quelle,
            to_char(p.leistung_von at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as von_lokal,
            to_char(p.leistung_bis at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as bis_lokal,
            p.bemerkung
       from leistungsnachweis_position p
      where p.leistungsnachweis_id = $1::uuid
      order by p.reihenfolge`,
    [nachweisId],
  );
  return zeilen.map((z) => ({
    reihenfolge: z.reihenfolge,
    bezeichnung: z.bezeichnung,
    menge: z.menge,
    einheit: z.einheit,
    einzelpreisCent: z.einzelpreis_cent,
    quelle: z.quelle,
    leistungVonLokal: z.von_lokal,
    leistungBisLokal: z.bis_lokal,
    bemerkung: z.bemerkung,
  }));
}

/* ------------------------------------------------------------------------ */
/* Schreiben                                                                 */
/* ------------------------------------------------------------------------ */

export interface PositionEingabe {
  readonly bezeichnung: string;
  /** `numeric`-Text. Keine Zahl — sonst liefe die Menge durch einen Double. */
  readonly menge: string;
  readonly einheit: string;
  readonly einzelpreisCent?: bigint | null;
  readonly quelle: 'zeiteintrag' | 'leistungskatalog' | 'manuell';
  readonly zeiteintragId?: string | null;
  readonly leistungskatalogPositionId?: string | null;
  readonly auftragLeistungId?: string | null;
  readonly bemerkung?: string | null;
}

export interface EntwurfEingabe {
  readonly objektId: string;
  readonly kundeId: string;
  readonly revierId?: string | null;
  readonly auftragLeistungId?: string | null;
  /** Berliner Kalendertage (K-11), einschliessend. */
  readonly von: string;
  readonly bis: string;
  readonly positionen: readonly PositionEingabe[];
}

/**
 * Den Entwurf anlegen — Kopf und Zeilen in EINER Transaktion.
 *
 * Der Kunde wird nicht aus der Eingabe geglaubt, sondern gegen das Objekt
 * geprüft: ein Nachweis, dessen `kunde_id` nicht die des Objekts ist, machte
 * die Kundendecke zu einer Eingabe (§1.8).
 */
export async function erstelleEntwurf(
  kontext: SchreibKontext, eingabe: EntwurfEingabe,
): Promise<string> {
  const [objekt] = await kontext.schreibe<{ kunde_id: string | null }>(
    `select kunde_id from objekt where id = $1::uuid`, [eingabe.objektId],
  );
  if (objekt === undefined) throw new NachweisNichtGefunden(eingabe.objektId);
  if (objekt.kunde_id !== eingabe.kundeId) {
    throw new FalscherZustand(
      'Kunde des Objekts', 'derselbe Kunde wie auf dem Nachweis',
    );
  }

  const [kopf] = await kontext.schreibe<{ id: string }>(
    `insert into leistungsnachweis
       (mandant_id, objekt_id, revier_id, auftrag_leistung_id, kunde_id,
        leistungszeitraum_von, leistungszeitraum_bis, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::date, $6::date, app.aktueller_benutzer())
     returning id`,
    [
      eingabe.objektId, eingabe.revierId ?? null, eingabe.auftragLeistungId ?? null,
      eingabe.kundeId, eingabe.von, eingabe.bis,
    ],
  );
  const id = kopf!.id;

  for (const [index, p] of eingabe.positionen.entries()) {
    await kontext.schreibe(
      `insert into leistungsnachweis_position
         (mandant_id, leistungsnachweis_id, kunde_id, auftrag_leistung_id, reihenfolge,
          bezeichnung, menge, einheit, einzelpreis_cent, quelle,
          zeiteintrag_id, leistungskatalog_position_id, bemerkung, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4,
               $5, $6::numeric, $7, $8::bigint, $9::leistungsnachweis_quelle,
               $10::uuid, $11::uuid, $12, app.aktueller_benutzer())`,
      [
        id, eingabe.kundeId, p.auftragLeistungId ?? null, index,
        p.bezeichnung, p.menge, p.einheit,
        p.einzelpreisCent === null || p.einzelpreisCent === undefined
          ? null : String(p.einzelpreisCent),
        p.quelle,
        p.zeiteintragId ?? null, p.leistungskatalogPositionId ?? null,
        p.bemerkung ?? null,
      ],
    );
  }
  return id;
}

export interface VorlageErgebnis {
  readonly nummer: string | null;
  /**
   * Warum keine Nummer vergeben wurde, oder `null`.
   *
   * Ein fehlender oder unbestätigter Nummernkreis ist KEIN Grund, die Vorlage
   * scheitern zu lassen: `leistungsnachweis.nummer` ist nullable, und O-147
   * lässt offen, ob überhaupt fortlaufend nummeriert werden soll. Was nicht
   * passiert, ist eine erfundene Nummer (K-17) — und was passiert, sagt die
   * Oberfläche.
   */
  readonly nummerOffen: string | null;
}

/**
 * `entwurf → vorgelegt` — und dabei, wenn möglich, die Nummer ziehen.
 *
 * // TODO(client, O-147): Sollen Leistungsnachweise fortlaufend und lückenlos
 * nummeriert sein, und ab welchem Schritt — Vorlage oder Unterschrift?
 */
export async function legeVor(
  kontext: SchreibKontext, id: string,
): Promise<VorlageErgebnis> {
  const [kopf] = await kontext.schreibe<{ status: string }>(
    `select status::text as status from leistungsnachweis where id = $1::uuid for update`,
    [id],
  );
  if (kopf === undefined) throw new NachweisNichtGefunden(id);
  if (kopf.status !== 'entwurf') throw new FalscherZustand(kopf.status, 'entwurf');

  let nummer: string | null = null;
  let offen: string | null = null;
  try {
    const vergeben = await vergebeNummer(
      { unsafe: async (sql, werte = []) => kontext.schreibe(sql, werte) },
      { kreisTyp: 'leistungsnachweis' },
    );
    nummer = vergeben.formatiert;
  } catch (fehler: unknown) {
    if (fehler instanceof NummernkreisFehler
        && (fehler.grund === 'kein_kreis' || fehler.grund === 'platzhalter')) {
      offen = fehler.message;
    } else {
      throw fehler;
    }
  }

  await kontext.schreibe(
    `update leistungsnachweis
        set status = 'vorgelegt', vorgelegt_am = now(), nummer = coalesce($2, nummer)
      where id = $1::uuid`,
    [id, nummer],
  );
  return { nummer, nummerOffen: offen };
}

export interface Unterschriftsvorschau {
  readonly kopf: NachweisKopf;
  readonly positionen: readonly SchnappschussPosition[];
  readonly schnappschuss: SchnappschussWert;
  /** Der Digest des Abzugs — kommt bei der Unterschrift zurück. */
  readonly pruefsumme: string;
  readonly bestaetigungstext: string;
}

/** Die Anzeigezone. Eine Konstante, kein Prozessumgebungswert (K-11). */
export const ANZEIGE_ZEITZONE = 'Europe/Berlin' as const;

/**
 * Schritt 1: den Abzug bauen, den der Kunde sieht — und seinen Digest.
 *
 * Er wird NICHT gespeichert. Gespeichert wird erst der Abzug aus Schritt 2,
 * und dass beide gleich sind, ist die Zusage.
 */
export async function bereiteUnterschriftVor(
  kontext: LeseKontext, id: string,
): Promise<Unterschriftsvorschau> {
  const kopf = await findeNachweis(kontext, id);
  if (kopf === null) throw new NachweisNichtGefunden(id);
  const positionen = await ladePositionen(kontext, id);

  const schnappschuss = baueSchnappschuss({
    kopf: {
      nummer: kopf.nummer,
      kunde: kopf.kunde,
      objekt: kopf.objekt,
      revier: kopf.revier,
      leistungszeitraumVon: kopf.leistungszeitraumVon,
      leistungszeitraumBis: kopf.leistungszeitraumBis,
    },
    positionen,
    anzeigeZeitzone: ANZEIGE_ZEITZONE,
    bestaetigungstext: BESTAETIGUNGSTEXT,
  });

  return {
    kopf,
    positionen,
    schnappschuss,
    pruefsumme: schnappschussHash(schnappschuss),
    bestaetigungstext: BESTAETIGUNGSTEXT,
  };
}

export interface UnterschriftEingabe {
  readonly nachweisId: string;
  readonly rolle: UnterschriftRolle;
  readonly unterzeichnerName: string;
  readonly unterzeichnerFunktion?: string | null;
  /** Was Schritt 1 geliefert hat. Ohne sie wird nicht unterschrieben. */
  readonly bestaetigtePruefsumme: string;
  /** Die Behauptung des Geräts. Nie maßgeblich, immer gespeichert (TIM-08). */
  readonly geraeteZeit?: Date | null;
  /** Nur bei `auftragnehmer` — die eigene Gegenzeichnung (D-09). */
  readonly anstellungId?: string | null;
  /** Die id einer bereits abgelegten Medienzeile, oder `null`. */
  readonly signaturMedienId?: string | null;
  readonly breitengrad?: string | null;
  readonly laengengrad?: string | null;
  readonly geoGenauigkeitM?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface UnterschriftErgebnis {
  readonly signaturId: string;
  readonly snapshotHash: string;
  /** Serverzeit, in Berliner Ortszeit aus der Datenbank. */
  readonly unterzeichnetAmLokal: string;
  readonly zeitabweichungSek: number | null;
}

/**
 * Schritt 2: unterschreiben.
 *
 * Die Reihenfolge trägt:
 *
 *   1. Kopf sperren (`for update`) — damit zwischen Prüfung und Schreiben
 *      niemand den Status bewegt.
 *   2. Abzug NEU bauen und gegen die bestätigte Prüfsumme halten.
 *   3. Zeile schreiben. Den Rest erledigen die Auslöser: Serverzeit,
 *      Zeitabweichung, Statuswechsel auf `signiert`, `gesperrt_am` — alles in
 *      DERSELBEN Anweisung, weil es EIN Vorgang ist.
 *
 * Was hier NICHT steht: das Setzen von `status` und `gesperrt_am`. Zwei
 * Anweisungen dafür hießen: eine Unterschrift ohne Sperre, wenn dazwischen
 * etwas schiefgeht — also genau die Zeile, die der Kunde später bestreitet.
 */
export async function signiere(
  kontext: SchreibKontext, eingabe: UnterschriftEingabe,
): Promise<UnterschriftErgebnis> {
  const [kopf] = await kontext.schreibe<{ status: string; kunde_id: string }>(
    `select status::text as status, kunde_id from leistungsnachweis
      where id = $1::uuid for update`,
    [eingabe.nachweisId],
  );
  if (kopf === undefined) throw new NachweisNichtGefunden(eingabe.nachweisId);
  if (kopf.status !== 'vorgelegt') throw new FalscherZustand(kopf.status, 'vorgelegt');

  const [vorhanden] = await kontext.schreibe<{ id: string }>(
    `select id from leistungsnachweis_signatur
      where leistungsnachweis_id = $1::uuid and rolle = $2::unterschrift_rolle`,
    [eingabe.nachweisId, eingabe.rolle],
  );
  if (vorhanden !== undefined) throw new BereitsUnterschrieben(eingabe.rolle);

  const vorschau = await bereiteUnterschriftVor(kontext, eingabe.nachweisId);
  if (vorschau.pruefsumme !== eingabe.bestaetigtePruefsumme) {
    throw new AnzeigeVeraltet(eingabe.bestaetigtePruefsumme, vorschau.pruefsumme);
  }

  const [zeile] = await kontext.schreibe<{
    id: string; snapshot_hash: string; lokal: string; abweichung: number | null;
  }>(
    `insert into leistungsnachweis_signatur
       (mandant_id, leistungsnachweis_id, kunde_id, rolle, anstellung_id,
        unterzeichner_name, unterzeichner_funktion, geraete_zeit,
        breitengrad, laengengrad, geo_genauigkeit_m,
        signatur_medien_id, snapshot, snapshot_hash, ip, user_agent, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::unterschrift_rolle, $4::uuid,
             $5, $6, $7::timestamptz,
             $8::numeric, $9::numeric, $10::numeric,
             $11::uuid, $12::jsonb, $13, $14::inet, $15, app.aktueller_benutzer())
     returning id,
               snapshot_hash,
               to_char(unterzeichnet_am at time zone 'Europe/Berlin',
                       'DD.MM.YYYY HH24:MI:SS') as lokal,
               zeitabweichung_sek as abweichung`,
    [
      eingabe.nachweisId, kopf.kunde_id, eingabe.rolle,
      eingabe.rolle === 'auftragnehmer' ? eingabe.anstellungId ?? null : null,
      eingabe.unterzeichnerName.trim(), eingabe.unterzeichnerFunktion ?? null,
      eingabe.geraeteZeit?.toISOString() ?? null,
      eingabe.breitengrad ?? null, eingabe.laengengrad ?? null,
      eingabe.geoGenauigkeitM ?? null,
      eingabe.signaturMedienId ?? null,
      /**
       * Der Abzug geht als KANONISCHE Zeichenkette in die Spalte, nicht als
       * `JSON.stringify` mit zufälliger Schlüsselreihenfolge. `jsonb` sortiert
       * ohnehin um; dass der Digest davon unabhängig ist, sichert der
       * Kanonisierer beim Wiederauslesen.
       */
      JSON.stringify(vorschau.schnappschuss),
      vorschau.pruefsumme,
      eingabe.ip ?? null, eingabe.userAgent ?? null,
    ],
  );

  return {
    signaturId: zeile!.id,
    snapshotHash: zeile!.snapshot_hash,
    unterzeichnetAmLokal: zeile!.lokal,
    zeitabweichungSek: zeile!.abweichung,
  };
}

export interface SignaturZeile {
  readonly id: string;
  readonly rolle: string;
  readonly unterzeichnerName: string;
  readonly unterzeichnerFunktion: string | null;
  readonly unterzeichnetAmLokal: string;
  readonly geraeteZeitLokal: string | null;
  readonly zeitabweichungSek: number | null;
  readonly breitengrad: string | null;
  readonly laengengrad: string | null;
  readonly signaturMedienId: string | null;
  readonly snapshot: SchnappschussWert;
  readonly snapshotHash: string;
}

interface SignaturDbZeile {
  readonly id: string;
  readonly rolle: string;
  readonly unterzeichner_name: string;
  readonly unterzeichner_funktion: string | null;
  readonly lokal: string;
  readonly geraete_lokal: string | null;
  readonly zeitabweichung_sek: number | null;
  readonly breitengrad: string | null;
  readonly laengengrad: string | null;
  readonly signatur_medien_id: string | null;
  readonly snapshot: unknown;
  readonly snapshot_hash: string;
}

export async function ladeSignaturen(
  kontext: LeseKontext, nachweisId: string,
): Promise<readonly SignaturZeile[]> {
  const zeilen = await kontext.abfrage<SignaturDbZeile>(
    `select id, rolle::text as rolle, unterzeichner_name, unterzeichner_funktion,
            to_char(unterzeichnet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI:SS') as lokal,
            to_char(geraete_zeit at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI:SS') as geraete_lokal,
            zeitabweichung_sek,
            breitengrad::text as breitengrad, laengengrad::text as laengengrad,
            signatur_medien_id, snapshot, snapshot_hash
       from leistungsnachweis_signatur
      where leistungsnachweis_id = $1::uuid
      order by unterzeichnet_am`,
    [nachweisId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    rolle: z.rolle,
    unterzeichnerName: z.unterzeichner_name,
    unterzeichnerFunktion: z.unterzeichner_funktion,
    unterzeichnetAmLokal: z.lokal,
    geraeteZeitLokal: z.geraete_lokal,
    zeitabweichungSek: z.zeitabweichung_sek,
    breitengrad: z.breitengrad,
    laengengrad: z.laengengrad,
    signaturMedienId: z.signatur_medien_id,
    snapshot: alsSchnappschuss(z.snapshot),
    snapshotHash: z.snapshot_hash,
  }));
}
