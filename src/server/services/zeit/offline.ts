/**
 * Die Offline-Warteschlange (TIM-09, TIM-11, K-08 Registerzeile 4, K-09).
 *
 * Ein Telefon im Funkloch merkt sich, was jemand getippt hat, und schickt es
 * nach. Was dabei ankommt, ist eine BEHAUPTUNG — und dieser Dienst ist im Kern
 * die Weigerung, sie fuer eine Messung zu halten.
 *
 * **Der Dienst rechnet keine Zeit.** Der Eingangszeitpunkt entsteht in der
 * Datenbank (`empfangen_am`, Invariante 5), die Verspaetung leitet
 * `kern.offline_feldzeit()` daraus ab. Was hier zurueckkommt, ist gelesen,
 * nicht gerechnet — sonst gaebe es zwei Zahlen fuer eine Tatsache.
 *
 * **Die Wiedergabe laeuft ueber DENSELBEN Prinzipal wie der Check-in.**
 * `cse_checkin`, dieselbe Marke, dieselben Pruefungen — nur spaeter (K-08).
 * Ein zweiter, laxerer Weg waere kein zweiter Weg, sondern ein Umgehungsweg,
 * und er waere der bequemere.
 */
import type { SchreibKontext, Transaktion } from '../../kontext/index.js';
import { withCheckin } from '../../kontext/checkin.js';
import { tokenHash } from './checkin.js';

/**
 * `unbekannt` ist die ehrliche Antwort eines Geraets ohne Netz.
 *
 * Die Stempelflaeche ist EIN Knopf, und welches Bein er meint, entscheidet
 * die Marke — `token_zweck` traegt `checkin` oder `checkout`, und der Server
 * liest es an ihr ab. Ein Telefon im Funkloch kann die Marke nicht aufloesen
 * und WEISS die Richtung damit nicht. Es behauptete sie trotzdem: jeder
 * gemerkte Stempel reiste als `checkin`, also stand ein im Treppenhaus
 * getipptes Schichtende der Planung als Beginn in der Nacherfassung.
 *
 * Der dritte Wert sagt stattdessen, was der Fall ist. Aufloesen tut ihn der
 * Server an der Marke; bleibt sie unaufloesbar, bleibt es `unbekannt`, und
 * der Mensch, der die Nachreichung entscheidet, liest genau das — statt
 * einer Richtung, die niemand geprueft hat.
 */
export type OfflineArt =
  'checkin' | 'checkout' | 'unbekannt' | 'pause' | 'foto' | 'nacherfassung';

export const ABLEHNUNG_GRUENDE = [
  'token_ungueltig', 'ausserhalb_fenster', 'bereits_eingeloest',
  'einsatz_storniert', 'zuordnung_entfernt', 'unplausibel', 'sonstiges',
] as const;
export type AblehnungGrund = (typeof ABLEHNUNG_GRUENDE)[number];

/** Das Medium, das ein `foto`-Ereignis begleitet — schon abgelegt, schon bereinigt. */
export interface OfflineMedium {
  readonly art: 'foto' | 'video';
  readonly bucket: string;
  readonly pfad: string;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly sha256: string;
  readonly breite?: number | null;
  readonly hoehe?: number | null;
  readonly dauerSek?: number | null;
  readonly aufgenommenAmGeraet?: string | null;
  readonly beschreibung?: string | null;
}

export interface OfflineEreignis {
  /** Die vom GERAET gepraegte UUID. Sie traegt die Doppelerkennung (K-09). */
  readonly clientEreignisId: string;
  readonly art: OfflineArt;
  /** Die Behauptung. Nie fuer sich genommen ein massgeblicher Zeitpunkt. */
  readonly behaupteteZeit: Date;
  /** Die Geraeteuhr bei der Uebertragung — die Abweichung leitet die DB ab. */
  readonly geraeteZeit?: Date | null;
  /** Die pseudonyme Installationskennung, falls die Gesellschaft sie zulaesst. */
  readonly geraetId?: string | null;
  readonly geo?: { lat: number; lon: number; genauigkeitM?: number } | null;
  readonly medium?: OfflineMedium | null;
}

export interface OfflineAnnahme {
  readonly clientEreignisId: string;
  /**
   * Die id des aufgeschriebenen Vorgangs — in `offline_ereignis`, wenn die
   * Marke aufgeloest hat, sonst in `zeit_intern.offline_eingang`. **Welche der
   * beiden es war, sagt die Antwort nicht**: eine Antwort, die das
   * unterscheidet, beantwortet jedem Durchprobierenden genau die Frage, die er
   * stellt (AUT-06).
   */
  readonly vorgangId: string;
  readonly status: 'empfangen';
}

interface AnnahmeZeile {
  ereignis_kennung: string;
  vorgang_id: string;
  ergebnis: string;
}

/**
 * Der Rumpf, den die Route der Datenbank uebergibt.
 *
 * `user_agent` reist IM Ereignis und wird von der ROUTE aus dem Kopf der
 * Anfrage gesetzt, nicht aus dem Rumpf uebernommen — genau wie die IP. Ein
 * viertes Funktionsargument waere eine andere Signatur als die, die K-08 nennt,
 * und dort ist die Stelligkeit Teil der Zusage.
 *
 * `roh` ist der byte-treue Rumpf des Ereignisses: `jsonb` ordnet Schluessel um,
 * verwirft Doppelte und normalisiert Zahlen, taugt also nicht als Beweis. Die
 * Route reicht durch, was sie empfangen hat.
 */
function alsNutzlast(
  ereignisse: readonly OfflineEreignis[],
  rohJeEreignis: readonly string[],
  userAgent: string | null,
): unknown {
  return ereignisse.map((e, i) => ({
    client_ereignis_id: e.clientEreignisId,
    art: e.art,
    behauptete_zeit: e.behaupteteZeit.toISOString(),
    /**
     * Fehlt die Geraeteuhr, wird hier KEINE eingesetzt. `null` laesst die
     * Datenbank auf `now()` zurueckfallen — die Serveruhr, die ohnehin die
     * einzige massgebliche ist (Invariante 5). Sie hier aus der Prozessuhr zu
     * fuellen erfaende eine Geraetezeit, die nie gemessen wurde, und die
     * abgeleitete `zeitabweichung_sek` waere dann glatt null: eine Abweichung,
     * die es nicht gab, statt einer, die niemand gemessen hat.
     */
    geraete_zeit: e.geraeteZeit?.toISOString() ?? null,
    geraet_id: e.geraetId ?? null,
    user_agent: userAgent,
    roh: rohJeEreignis[i] ?? JSON.stringify(e),
    ...(e.geo == null ? {} : {
      geo: {
        lat: e.geo.lat, lon: e.geo.lon,
        genauigkeit_m: e.geo.genauigkeitM ?? null,
        status: 'erfasst',
      },
    }),
    ...(e.medium == null ? {} : {
      medium: {
        art: e.medium.art,
        bucket: e.medium.bucket,
        pfad: e.medium.pfad,
        mime_typ: e.medium.mimeTyp,
        groesse_bytes: e.medium.groesseBytes,
        sha256: e.medium.sha256,
        breite: e.medium.breite ?? null,
        hoehe: e.medium.hoehe ?? null,
        dauer_sek: e.medium.dauerSek ?? null,
        exif_entfernt: true,
        aufgenommen_am_geraet: e.medium.aufgenommenAmGeraet ?? null,
        beschreibung: e.medium.beschreibung ?? null,
      },
    }),
  }));
}

/** Die Person hinter der Einteilung hat kein `benutzer`-Konto (nur beim Medium). */
export class KeinBenutzerkontoFuerMediumFehler extends Error {
  readonly code = 'kein_benutzerkonto' as const;
  readonly status = 409 as const;
  constructor() {
    super('Für diese Person besteht noch kein Zugang.');
    this.name = 'KeinBenutzerkontoFuerMediumFehler';
  }
}

/**
 * Nimmt die Warteschlange eines Geraets entgegen — in EINER Transaktion.
 *
 * Der Aufrufer oeffnet die Transaktion; dieser Dienst bindet den
 * K-08-Prinzipal und ruft die eine Funktion. Er liest keine Tabelle: er
 * koennte es nicht, `cse_checkin` haelt kein Tabellenrecht.
 */
export async function nimmClaimAn(
  tx: Transaktion,
  eingabe: {
    readonly token: string;
    readonly ereignisse: readonly OfflineEreignis[];
    readonly rohJeEreignis?: readonly string[];
    /**
     * Die Adresse der Anfrage — PFLICHT wie beim Check-in (`loeseCheckinEin`);
     * `withCheckin` bindet sie fuer `zeit.offline_empfangen` (SEC-A9, V-235).
     */
    readonly ip: string | null;
    readonly userAgent?: string | null;
  },
): Promise<readonly OfflineAnnahme[]> {
  let zeilen: readonly AnnahmeZeile[];
  try {
    zeilen = await withCheckin(tx, eingabe.ip, async (k) =>
      k.rufe<AnnahmeZeile>(
        `select ereignis_kennung, vorgang_id, ergebnis
           from app.offline_ereignis_annehmen($1, $2::jsonb, $3::inet)`,
        [
          tokenHash(eingabe.token),
          /**
           * Das OBJEKT, nicht `JSON.stringify(objekt)`. Der Treiber
           * serialisiert selbst; eine bereits erzeugte Zeichenkette wird ein
           * ZWEITES Mal kodiert und landet als jsonb-Zeichenkette statt als
           * jsonb-Array — `jsonb_array_elements` wirft dann, und im
           * gutmuetigeren Fall (einem Objekt) faende die Funktion schlicht
           * kein Ereignis. Genau dieser Fehler stand schon einmal im
           * Check-in-Dienst.
           */
          alsNutzlast(eingabe.ereignisse, eingabe.rohJeEreignis ?? [],
            eingabe.userAgent ?? null),
          eingabe.ip,
        ],
      ));
  } catch (fehler: unknown) {
    if ((fehler as { code?: string } | null)?.code === 'P0003') {
      throw new KeinBenutzerkontoFuerMediumFehler();
    }
    throw fehler instanceof Error ? fehler : new Error(String(fehler));
  }

  return zeilen.map((z) => ({
    clientEreignisId: z.ereignis_kennung,
    vorgangId: z.vorgang_id,
    status: 'empfangen' as const,
  }));
}

/**
 * Darf diese Marke ueberhaupt vorgelegt werden? (0095, K-08 Registerzeile 5)
 *
 * **Sie wird gelesen, nicht verbraucht** — und sie wird gelesen, BEVOR die
 * Medienroute 100 MiB in den Bucket legt. Dort stand der Schreibvorgang
 * vorher vor der einzigen Pruefung, die den Aufrufer betrifft, und die
 * Kompensation im `catch` lief nie: eine Marke, die nicht aufloest, laesst
 * `app.offline_ereignis_annehmen` nicht werfen, sondern in den Vorbereich
 * schreiben und Erfolg melden (§5.13, AUT-06). Das Objekt blieb ohne Zeile
 * liegen — von aussen gefuellt, von innen nicht mehr loeschbar.
 *
 * Die Antwort ist EIN Bit und nennt weder Mandant noch Person noch
 * Einteilung: dieselben drei Bedingungen wie das Tor in
 * `app.offline_ereignis_annehmen`, und ausdruecklich nicht mehr. Waere sie
 * strenger — Fenster, `eingeloest_am` —, wiese die Route Aufnahmen ab, die
 * die Warteschlange danach annimmt.
 */
export async function markePraesentierbar(
  tx: Transaktion,
  token: string,
): Promise<boolean> {
  /* Keine Herkunft: die Funktion liest nur und schreibt keine Protokollzeile. */
  const zeilen = await withCheckin(tx, null, async (k) =>
    k.rufe<{ ok: boolean }>(
      `select app.checkin_marke_praesentierbar($1) as ok`,
      [tokenHash(token)],
    ));
  return zeilen[0]?.ok === true;
}

// ---------------------------------------------------------------------------
// Die Warteschlange der Planung — Entscheidungen mit Sitzung dahinter.
// ---------------------------------------------------------------------------

export interface OfflineWartend {
  readonly id: string;
  readonly art: OfflineArt;
  /** Was das Geraet behauptet hat. */
  readonly behaupteteZeit: Date;
  /** Wann es WIRKLICH ankam — die Serveruhr (Invariante 5). */
  readonly empfangenAm: Date;
  /** `empfangen_am` minus Behauptung, vorzeichenbehaftet. */
  readonly verzoegerungSek: number;
  /** Geraet minus Server, vorzeichenbehaftet. Gespeichert, nie ausgewertet. */
  readonly zeitabweichungSek: number;
  readonly status: string;
  readonly personId: string | null;
  readonly einsatzZuordnungId: string | null;
}

interface WartendZeile {
  id: string;
  art: OfflineArt;
  behauptete_zeit: Date;
  empfangen_am: Date;
  verzoegerung_sek: number;
  zeitabweichung_sek: number;
  status: string;
  person_id: string | null;
  einsatz_zuordnung_id: string | null;
}

/**
 * Die offenen Ansprueche dieser Gesellschaft.
 *
 * **Beide Zeitpunkte kommen mit, und keiner ueberschreibt den anderen.** Das
 * ist die Zusage aus Abnahmekriterium (1): die Planung sieht, was behauptet
 * wurde UND wann es ankam. Eine Liste, die nur einen von beiden zeigt, nimmt
 * ihr genau die Information, wegen der sie entscheiden soll.
 */
export async function offeneAnsprueche(
  kontext: SchreibKontext,
): Promise<readonly OfflineWartend[]> {
  const zeilen = await kontext.abfrage<WartendZeile>(
    `select id, art, behauptete_zeit, empfangen_am, verzoegerung_sek,
            zeitabweichung_sek, status::text as status, person_id, einsatz_zuordnung_id
       from offline_ereignis
      where status in ('empfangen','zugeordnet','manuelle_pruefung')
      order by empfangen_am`,
  );
  return zeilen.map((z) => ({
    id: z.id,
    art: z.art,
    behaupteteZeit: z.behauptete_zeit,
    empfangenAm: z.empfangen_am,
    verzoegerungSek: z.verzoegerung_sek,
    zeitabweichungSek: z.zeitabweichung_sek,
    status: z.status,
    personId: z.person_id,
    einsatzZuordnungId: z.einsatz_zuordnung_id,
  }));
}

/**
 * Ein Mensch macht aus der Behauptung einen Datensatz (TIM-09, TIM-11).
 *
 * **`beginn` ist ein Argument und hat keinen Vorgabewert.** Ihn aus
 * `behauptete_zeit` vorzubelegen waere bequem und genau die Waesche, die §1.8
 * verbietet: die Behauptung des Geraets truege danach
 * `quelle_beginn = 'planer_entscheidung'` und waere von einer echten
 * Entscheidung nicht mehr zu unterscheiden. Dass ein Mensch beim Eintragen auf
 * die Behauptung schaut, ist in Ordnung; dass die Plattform sie fuer ihn
 * einsetzt, nicht.
 */
export async function uebernimmAnspruch(
  kontext: SchreibKontext,
  ereignisId: string,
  beginn: Date,
  ende: Date | null,
  begruendung: string,
): Promise<string> {
  const zeilen = await kontext.schreibe<{ zeiteintrag_id: string }>(
    `select app.offline_uebernehmen($1::uuid, $2::timestamptz, $3::timestamptz, $4)
              as zeiteintrag_id`,
    [ereignisId, beginn.toISOString(), ende?.toISOString() ?? null, begruendung],
  );
  const id = zeilen[0]?.zeiteintrag_id;
  if (id === undefined || id === null) {
    throw new Error('app.offline_uebernehmen hat keinen Zeiteintrag geliefert.');
  }
  return id;
}

/**
 * Die andere Haelfte der Entscheidung. Sie loescht nichts: die Behauptung
 * bleibt mit ihrem Grund daneben stehen und ist im Lohnstreit vorlegbar
 * (LEG-02, Invariante 8).
 */
export async function lehneAnspruchAb(
  kontext: SchreibKontext,
  ereignisId: string,
  grund: AblehnungGrund,
  begruendung: string,
): Promise<void> {
  await kontext.schreibe(
    `select app.offline_ablehnen($1::uuid, $2::ablehnung_grund, $3)`,
    [ereignisId, grund, begruendung],
  );
}
