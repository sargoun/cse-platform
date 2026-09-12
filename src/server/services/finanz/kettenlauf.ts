/**
 * Der naechtliche Kettenlauf (FIN-06, LEG-01) — `05-FINANZEN.md` §5.7.
 *
 * SPEC §14 fuehrt die Wache „Invoice hash chain broken → nightly → alert
 * immediately". Damit eine solche Meldung etwas wert ist, muss sie **die
 * erste kaputte Rechnungsnummer nennen** — nicht „die Kette ist gebrochen",
 * und erst recht keine Liste aus fuenfhundert Folgefehlern. Alles nach dem
 * ersten Bruch ist Folge, und eine Liste aus Folgen verdeckt die Ursache.
 *
 * **Der Lauf rechnet unabhaengig nach.** Geschrieben wurden die Digests in
 * SQL (`fin.rechnung_kette_schreiben`), geprueft werden sie hier mit
 * `verifyChain` — zwei Implementierungen desselben Digests, mit Absicht
 * (§5.7). Waere es dieselbe, pruefte der Lauf, ob eine Funktion mit sich
 * selbst uebereinstimmt.
 *
 * **Er repariert NIE.** Ein Pruefer, der repariert, kann anschliessend nicht
 * mehr bezeugen, dass nichts geaendert wurde — und `cse_job` haelt auf
 * `rechnung_hash` ohnehin kein Schreibrecht.
 */
import {
  GENESIS, kettenKopf, verifyChain, type Bruchgrund, type KettenSatz,
} from './hash-chain.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface KettenBruch {
  /** Die Rechnungsnummer — das, was in der Meldung stehen muss. */
  readonly nummer: string;
  readonly rechnungId: string;
  readonly nummernkreis: string;
  readonly position: number;
  readonly grund:
    | Bruchgrund
    | 'kopf_weicht_ab'
    | 'ohne_kettenglied'
    /** Der Genesis dieses Kreises ist nicht der Kettenkopf des Vorgaengers. */
    | 'kreisuebergang_gebrochen'
    /** `nummernkreis.letzter_hash` ist nicht der Hash des letzten Gliedes. */
    | 'kettenkopf_weicht_ab';
  readonly erwartet: string;
  readonly gefunden: string;
}

export interface KreisBefund {
  readonly nummernkreisId: string;
  readonly bezeichnung: string;
  readonly geprueft: number;
  readonly bruch: KettenBruch | null;
}

export interface KettenBefund {
  readonly ok: boolean;
  readonly geprueft: number;
  readonly kreise: readonly KreisBefund[];
  /** Der erste Bruch ueber alle Kreise, in Kreis- und Positionsreihenfolge. */
  readonly ersterBruch: KettenBruch | null;
}

interface KreisZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly genesis_hash: string | null;
  readonly letzter_hash: string | null;
  readonly vorgaenger_nummernkreis_id: string | null;
}

interface GliedZeile {
  readonly rechnung_id: string;
  readonly nummer: string;
  readonly kette_position: string;
  readonly vorheriger_hash: string;
  readonly nutzlast_sha256: string;
  readonly hash: string;
  readonly nutzlast_bytes: Uint8Array;
  readonly nutzlast_nummer: string | null;
  readonly nutzlast_netto: string | null;
  readonly nutzlast_steuer: string | null;
  readonly nutzlast_brutto: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  /**
   * Der Kettenkopf DIESES Kreises, aus derselben Anweisung wie die Glieder.
   *
   * Er stand vorher nur in der Kreisabfrage ganz oben — also aus einem
   * aelteren Snapshot als die Glieder. Solange `letzter_hash` gelesen und nie
   * benutzt wurde, war das folgenlos; seit Schritt 3a ihn vergleicht, meldete
   * eine Festschreibung, die zwischen beide Abfragen faellt,
   * `kettenkopf_weicht_ab` auf einer unversehrten Kette — als
   * `kritisch`-Benachrichtigung nach NOT-01/NOT-03. Reinigung und
   * Objektschutz fakturieren auch nachts; der Lauf faellt mitten hinein.
   */
  readonly letzter_hash: string | null;
}

/**
 * Ein Kreis, seine Glieder in `kette_position`-Ordnung.
 *
 * `join`, nicht `left join`, auf `rechnung_snapshot`: ein Kettenglied ohne
 * Snapshot gibt es nicht (der aufgeschobene Ausloeser in `0077` laesst die
 * Transaktion sonst nicht durch). Faellt hier trotzdem eine Zeile weg, ist
 * das die Luecke, die Schritt 1 unten findet.
 */
const GLIEDER_SQL = `
  select h.rechnung_id::text as rechnung_id, r.nummer, h.kette_position::text,
         h.vorheriger_hash, h.nutzlast_sha256, h.hash, s.nutzlast_bytes,
         s.nutzlast ->> 'nummer' as nutzlast_nummer,
         s.nutzlast ->> 'netto_gesamt_cent' as nutzlast_netto,
         s.nutzlast ->> 'steuer_gesamt_cent' as nutzlast_steuer,
         s.nutzlast ->> 'brutto_cent' as nutzlast_brutto,
         r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
         n.letzter_hash
    from rechnung_hash h
    join rechnung_snapshot s on s.rechnung_id = h.rechnung_id
    join rechnung r on r.id = h.rechnung_id
    join nummernkreis n on n.id = h.nummernkreis_id
   where h.nummernkreis_id = $1
   order by h.kette_position`;

/**
 * Der Uebergang von einem Kreis zum naechsten — Schritt 3b des §5.7.
 *
 * Der Lauf pruefte ihn nicht. Er gab `kreis.genesis_hash` bloss als
 * Startwert in `verifyChain` und glaubte ihm damit aufs Wort; `letzter_hash`
 * wurde gelesen und nie benutzt. Jeder Kreis verifizierte gegen SICH SELBST,
 * und die Kette zerfiel in so viele unabhaengige Linien, wie es
 * Geschaeftsjahre gibt.
 *
 * Was das gekostet haette: genau den Fall, fuer den die Kopie des Kettenkopfs
 * beim Eroeffnen ueberhaupt gemacht wird (0077, §5.4). Wer ein ganzes
 * Geschaeftsjahr entfernt oder neu schreibt und dabei den `genesis_hash` des
 * Folgekreises mitzieht, bekommt von diesem Lauf ein sauberes „keine
 * Abweichung" — der wertvollste Manipulationsfall, und der einzige, den die
 * Verkettung innerhalb eines Kreises nicht sieht.
 *
 * Massgeblich ist der NACHGERECHNETE Kopf des Vorgaengers, nicht dessen
 * gespeicherter `letzter_hash`: sonst verglichen zwei gespeicherte Werte
 * einander, und wer beide setzt, kaeme durch. Der gespeicherte Wert dient nur
 * als Rueckfall, wenn der Vorgaenger in diesem Lauf nicht nachgerechnet wurde
 * (andere Reihenfolge, abgebrochener Kreis).
 */
function uebergangsBruch(
  kreis: KreisZeile,
  koepfe: ReadonlyMap<string, string>,
  kreise: ReadonlyMap<string, KreisZeile>,
  kopfBrueche: ReadonlySet<string>,
): { grund: 'kreisuebergang_gebrochen'; erwartet: string; gefunden: string } | null {
  if (kreis.vorgaenger_nummernkreis_id === null) {
    /**
     * KEIN Bruch — und hier stand einer.
     *
     * Gemeldet wurde, sobald ein Kreis OHNE benannten Vorgaenger einen
     * `genesis_hash` trug. Diese Meldung konnte ausschliesslich falsch sein:
     * `vorgaenger_nummernkreis_id` wird in diesem Repo von keiner Zeile
     * geschrieben, und die einzige Anleitung zum Eroeffnen eines
     * Nachfolgekreises — der Hinweistext in `0077` — nennt nur „letzter_hash
     * wird als genesis_hash uebernommen". Wer den Nachfolger genau so
     * eroeffnet, wie ihm gesagt wird, bekaeme ab dem 2. Januar JEDE Nacht
     * eine `kritisch`-Meldung nach NOT-01/NOT-03, die eine unversehrte
     * Rechnung des neuen Jahres beim Namen nennt.
     *
     * §5.7 Schritt 3b prueft den Uebergang ausdruecklich nur fuer einen
     * Kreis, „whose `vorgaenger_nummernkreis_id` is set". Ein Genesis ohne
     * benannten Vorgaenger ist ein Datenbefund fuer die
     * Nummernkreisverwaltung — kein Kettenbruch, und diese Funktion erfindet
     * die Regel nicht, die einen daraus machte.
     */
    return null;
  }

  const vorgaenger = kreise.get(kreis.vorgaenger_nummernkreis_id);
  if (vorgaenger === undefined) {
    // Der Vorgaenger liegt ausserhalb dieser Abfrage — anderer Kreistyp,
    // andere Gesellschaft. Das ist selbst ein Befund, aber keiner, den dieser
    // Lauf ohne eine zweite Abfrage benennen koennte; er gehoert nicht in eine
    // Meldung, die eine Rechnungsnummer verspricht.
    return null;
  }

  if (kopfBrueche.has(vorgaenger.id)) {
    /**
     * Der Vorgaenger hat in DIESEM Lauf `kettenkopf_weicht_ab` gemeldet: sein
     * gespeicherter Kopf und sein nachgerechneter gehen auseinander. Dass der
     * Genesis hier am einen und nicht am anderen haengt, ist die FOLGE davon
     * und keine zweite Tatsache.
     *
     * Ohne diese Zeile erzeugte EIN Eingriff — die letzten Glieder eines
     * Geschaeftsjahres entfernt — zwei Meldungen, und die lautere von beiden
     * nannte die erste Rechnung des FOLGEJAHRES, die nachweislich unversehrt
     * ist. Der Dateikopf verspricht das Gegenteil: die erste kaputte Nummer,
     * keine Folgefehler.
     */
    return null;
  }

  // Derselbe Rueckfall wie beim Schreiber (0077, Schritt 8): ein Vorgaenger,
  // der nie eine Rechnung getragen hat, reicht seinen eigenen Genesis durch.
  const genesis = kreis.genesis_hash ?? GENESIS;
  const erwartet = koepfe.get(vorgaenger.id)
    ?? vorgaenger.letzter_hash ?? vorgaenger.genesis_hash ?? GENESIS;

  return genesis === erwartet
    ? null
    : { grund: 'kreisuebergang_gebrochen', erwartet, gefunden: genesis };
}

/** Was die Schritte 1 bis 4 ueber EINEN Kreis sagen. */
interface InhaltsBefund {
  readonly geprueft: number;
  readonly bruch: KettenBruch | null;
  /** Der nachgerechnete Kettenkopf — null, solange Schritt 1 oder 2/3 abbrach. */
  readonly kopf: string | null;
  /** Schritt 3a hat gemeldet; dieser Bruch wird zurueckgestellt (siehe dort). */
  readonly kopfBruch: boolean;
}

/**
 * Die Schritte 1 bis 4 fuer einen Kreis — der INHALT, ohne den Uebergang.
 *
 * Herausgeloest, weil der Uebergang (Schritt 0) diese Pruefung frueher per
 * `continue` uebersprungen hat: hatte er etwas zu melden, lief der Kreis durch
 * KEINEN der vier Schritte, `geprueft` blieb 0, und ein echter Bruch im
 * laufenden Geschaeftsjahr stand hinter der Uebergangsmeldung und kam nie
 * heraus. Der Uebergang ist eine ZUSAETZLICHE Aussage ueber den Kreis, kein
 * Ersatz fuer die Pruefung seines Inhalts.
 */
function pruefeKreisInhalt(
  kreis: KreisZeile, glieder: readonly GliedZeile[],
): InhaltsBefund {
  /**
   * Schritt 1 — Lueckenlosigkeit. Eine fehlende Position heisst, dass eine
   * Zeile UNTERHALB der Anwendungsschicht entfernt wurde; danach hat jeder
   * weitere Vergleich keinen Aussagewert mehr, also wird hier abgebrochen.
   */
  const positionen = glieder.map((g) => Number(g.kette_position));
  const luecke = positionen.findIndex((p, i) => p !== i + 1);
  if (luecke >= 0) {
    return {
      geprueft: luecke, kopf: null, kopfBruch: false,
      bruch: {
        nummer: glieder[luecke]?.nummer ?? '—',
        rechnungId: glieder[luecke]?.rechnung_id ?? '',
        nummernkreis: kreis.bezeichnung,
        position: positionen[luecke] ?? luecke + 1,
        grund: 'position_luecke',
        erwartet: String(luecke + 1),
        gefunden: String(positionen[luecke] ?? '—'),
      },
    };
  }

  /**
   * Schritte 2 und 3 — Nutzlast und Verkettung, durch die unabhaengige
   * TypeScript-Fassung. `genesis` ist der Kettenkopf des Vorgaengerkreises;
   * fehlt er, ist es der allererste Kreis dieser Gesellschaft und der
   * Vorgaenger sind 64 Nullen.
   */
  const saetze: KettenSatz[] = glieder.map((g) => ({
    position: Number(g.kette_position),
    nutzlastBytes: g.nutzlast_bytes,
    vorherigerHash: g.vorheriger_hash,
    hash: g.hash,
    nutzlastSha256: g.nutzlast_sha256,
  }));

  const pruefung = verifyChain(saetze, kreis.genesis_hash ?? GENESIS);
  if (!pruefung.ok) {
    const glied = glieder[pruefung.ersterBruch.position - 1];
    return {
      geprueft: pruefung.geprueft, kopf: null, kopfBruch: false,
      bruch: {
        nummer: glied?.nummer ?? '—',
        rechnungId: glied?.rechnung_id ?? '',
        nummernkreis: kreis.bezeichnung,
        position: pruefung.ersterBruch.position,
        grund: pruefung.ersterBruch.grund,
        erwartet: pruefung.ersterBruch.erwartet,
        gefunden: pruefung.ersterBruch.gefunden,
      },
    };
  }

  /**
   * Schritt 3a — der Kettenkopf. `nummernkreis.letzter_hash` muss der Hash
   * des letzten Gliedes sein; er ist der Wert, an dem der NAECHSTE Kreis
   * haengt, und wird vom Aufrufer fuer dessen Uebergang gemerkt.
   *
   * Das ist die Gegenrichtung zur Lueckenpruefung: werden die LETZTEN
   * Glieder eines Kreises entfernt, bleiben die verbliebenen lueckenlos und
   * verketten sauber — nur der Kopf zeigt dann auf ein Glied, das es nicht
   * mehr gibt. Ohne diesen Vergleich waere das Abschneiden eines
   * Jahresendes die eine Manipulation, die durch jeden Schritt kommt.
   *
   * Der gespeicherte Kopf kommt aus DERSELBEN Anweisung wie die Glieder
   * (`GLIEDER_SQL`, `n.letzter_hash`) — siehe dort, warum der Wert aus der
   * Kreisabfrage ganz oben dafuer der falsche ist.
   */
  const gerechneterKopf = kettenKopf(saetze, kreis.genesis_hash ?? GENESIS);
  const erstes = glieder[0];
  const gespeicherterKopf =
    (erstes === undefined ? kreis.letzter_hash : erstes.letzter_hash)
    ?? kreis.genesis_hash ?? GENESIS;
  if (gespeicherterKopf !== gerechneterKopf) {
    const letztes = glieder.at(-1);
    return {
      geprueft: glieder.length, kopf: gerechneterKopf, kopfBruch: true,
      bruch: {
        nummer: letztes?.nummer ?? '—',
        rechnungId: letztes?.rechnung_id ?? '',
        nummernkreis: kreis.bezeichnung,
        position: glieder.length,
        grund: 'kettenkopf_weicht_ab',
        erwartet: gerechneterKopf,
        gefunden: gespeicherterKopf,
      },
    };
  }

  /**
   * Schritt 4 — Stimmigkeit. Nummer und die drei Summen auf der Zeile
   * gegen die im Snapshot. Das faengt eine Aenderung, die AN DEN AUSLOESERN
   * VORBEI in die Zeile gelangt ist: der Hash bliebe dann gueltig, denn er
   * bezeugt den Snapshot, nicht die Zeile.
   */
  const abweichend = glieder.find((g) =>
    g.nutzlast_nummer !== g.nummer
    || g.nutzlast_netto !== g.netto_gesamt_cent
    || g.nutzlast_steuer !== g.steuer_gesamt_cent
    || g.nutzlast_brutto !== g.brutto_cent);

  if (abweichend !== undefined) {
    return {
      geprueft: glieder.length, kopf: gerechneterKopf, kopfBruch: false,
      bruch: {
        nummer: abweichend.nummer,
        rechnungId: abweichend.rechnung_id,
        nummernkreis: kreis.bezeichnung,
        position: Number(abweichend.kette_position),
        grund: 'kopf_weicht_ab',
        erwartet: `${abweichend.nutzlast_nummer ?? '—'} / ${abweichend.nutzlast_brutto ?? '—'}`,
        gefunden: `${abweichend.nummer} / ${abweichend.brutto_cent}`,
      },
    };
  }

  return { geprueft: glieder.length, kopf: gerechneterKopf, kopfBruch: false, bruch: null };
}

/**
 * Prueft jeden Rechnungskreis des aktiven Mandanten.
 *
 * Die Kreise werden in Eroeffnungsordnung gelaufen — also in
 * Vorgaengerordnung — und der Uebergang wird ausdruecklich mitgeprueft (§5.7
 * Schritt 3b): der `genesis_hash` eines Nachfolgekreises ist der letzte Hash
 * des Vorgaengers, und `letzter_hash` ist der Hash des letzten Gliedes.
 * Dieser Satz stand hier, bevor irgendetwas davon geprueft wurde; siehe
 * `uebergangsBruch` und Schritt 3a.
 */
export async function pruefeKette(db: Abfrage): Promise<KettenBefund> {
  const kreise = await db.abfrage<KreisZeile>(
    `select id::text as id, bezeichnung, genesis_hash, letzter_hash,
            vorgaenger_nummernkreis_id::text as vorgaenger_nummernkreis_id
       from nummernkreis
      where mandant_id = app.aktiver_mandant()
        and kreis_typ = 'ausgangsrechnung'
      order by jahr, geoeffnet_am, id`,
  );

  const befunde: KreisBefund[] = [];
  let erster: KettenBruch | null = null;
  let gesamt = 0;

  /**
   * Der NACHGERECHNETE Kettenkopf je Kreis, fuer den Uebergang zum
   * Nachfolger. Die Ordnung oben (`jahr`, dann `geoeffnet_am`) laeuft die
   * Kreise in derselben Richtung, in der sie eroeffnet wurden — der
   * Vorgaenger ist also in aller Regel schon gerechnet, wenn sein Nachfolger
   * an die Reihe kommt.
   */
  const koepfe = new Map<string, string>();
  const kreisJeId = new Map(kreise.map((k) => [k.id, k]));
  /**
   * Die Kreise, deren Kopf in DIESEM Lauf abgewichen ist. `uebergangsBruch`
   * liest es, damit ein abgeschnittenes Jahresende nicht zweimal gemeldet
   * wird — einmal richtig und einmal auf der unversehrten Folgerechnung.
   */
  const kopfBrueche = new Set<string>();
  /** Zurueckgestellt — siehe Schritt 3a. */
  let kopfBruch: KettenBruch | null = null;

  for (const kreis of kreise) {
    const glieder = await db.abfrage<GliedZeile>(GLIEDER_SQL, [kreis.id]);

    /**
     * Schritt 0 — der Uebergang vom Vorgaengerkreis. Er steht VOR allem
     * anderen, weil er die frueheste Stelle der Linie beschreibt: haengt
     * dieser Kreis am falschen Kopf, bricht die Linie schon vor seinem ersten
     * Glied.
     *
     * Er BEENDET die Pruefung dieses Kreises aber nicht mehr. Hier stand
     * `continue`, und damit wurde aus einer zusaetzlichen Aussage ein Ersatz
     * fuer alle vier Schritte — ein echter Bruch im laufenden Jahr blieb
     * hinter der Uebergangsmeldung unsichtbar und `geprueft` zaehlte 0.
     */
    const uebergang = uebergangsBruch(kreis, koepfe, kreisJeId, kopfBrueche);
    const uebergangBruch: KettenBruch | null = uebergang === null ? null : {
      nummer: glieder[0]?.nummer ?? '—',
      rechnungId: glieder[0]?.rechnung_id ?? '',
      nummernkreis: kreis.bezeichnung,
      position: 1,
      grund: uebergang.grund,
      erwartet: uebergang.erwartet,
      gefunden: uebergang.gefunden,
    };

    const inhalt = pruefeKreisInhalt(kreis, glieder);
    if (inhalt.kopf !== null) koepfe.set(kreis.id, inhalt.kopf);
    if (inhalt.kopfBruch) kopfBrueche.add(kreis.id);

    befunde.push({
      nummernkreisId: kreis.id, bezeichnung: kreis.bezeichnung,
      geprueft: inhalt.geprueft, bruch: uebergangBruch ?? inhalt.bruch,
    });
    gesamt += inhalt.geprueft;

    /**
     * Ein Uebergangsbruch, der bis hierher kommt, ist KEINE Folge eines
     * anderen: `uebergangsBruch` hat den Fall schon verworfen, in dem der
     * Vorgaenger selbst einen Kopfbruch gemeldet hat. Er nennt damit genau
     * die Rechnung, an der die Linie reisst — die erste dieses Kreises — und
     * liegt vor jedem Glied des Kreises.
     */
    if (uebergangBruch !== null) erster ??= uebergangBruch;
    if (inhalt.bruch !== null) {
      if (inhalt.kopfBruch) kopfBruch ??= inhalt.bruch;
      else erster ??= inhalt.bruch;
    }
  }

  /**
   * Und die Gegenrichtung: eine festgeschriebene Rechnung OHNE Kettenglied.
   * Sie kann durch den aufgeschobenen Ausloeser nicht entstehen — aber genau
   * deshalb ist ihr Auftauchen die interessanteste Meldung des Laufs.
   */
  const ohne = await db.abfrage<{ id: string; nummer: string }>(
    `select r.id::text as id, r.nummer from rechnung r
      where r.mandant_id = app.aktiver_mandant()
        and r.status = 'festgeschrieben'
        and not exists (select 1 from rechnung_hash h where h.rechnung_id = r.id)
      order by r.nummer_laufend
      limit 1`,
  );
  const fehlend = ohne[0];
  if (fehlend !== undefined) {
    const bruch: KettenBruch = {
      nummer: fehlend.nummer,
      rechnungId: fehlend.id,
      nummernkreis: '—',
      position: 0,
      grund: 'ohne_kettenglied',
      erwartet: 'ein Kettenglied',
      gefunden: 'keines',
    };
    erster ??= bruch;
  }

  // Und erst jetzt der zurueckgestellte Kopfbruch (Schritt 3a): er bleibt ein
  // Bruch, aber er ist die unschaerfere Lesart derselben Tatsache.
  erster ??= kopfBruch;

  return {
    ok: erster === null,
    geprueft: gesamt,
    kreise: befunde,
    ersterBruch: erster,
  };
}

/** Eine Zeile fuer `audit_log` und die Benachrichtigung (NOT-01, NOT-03). */
export function meldung(befund: KettenBefund): string {
  if (befund.ok) {
    return `Hashkette geprüft: ${String(befund.geprueft)} Rechnungen, keine Abweichung.`;
  }
  const b = befund.ersterBruch;
  if (b === null) return 'Hashkette: Befund ohne benannten Bruch.';
  return `Hashkette gebrochen bei Rechnung ${b.nummer} `
    + `(Kreis ${b.nummernkreis}, Position ${String(b.position)}): ${b.grund}. `
    + `Erwartet ${b.erwartet}, gefunden ${b.gefunden}.`;
}
