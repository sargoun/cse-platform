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
  GENESIS, verifyChain, type Bruchgrund, type KettenSatz,
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
  readonly grund: Bruchgrund | 'kopf_weicht_ab' | 'ohne_kettenglied';
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
         r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text
    from rechnung_hash h
    join rechnung_snapshot s on s.rechnung_id = h.rechnung_id
    join rechnung r on r.id = h.rechnung_id
   where h.nummernkreis_id = $1
   order by h.kette_position`;

/**
 * Prueft jeden Rechnungskreis des aktiven Mandanten.
 *
 * Die Kreise werden in `vorgaenger`-Ordnung gelaufen und der Uebergang
 * ausdruecklich mitgeprueft (§5.7 Schritt 3b): der erste Satz eines
 * Nachfolgekreises traegt als `vorheriger_hash` den `genesis_hash`, und der
 * ist der letzte Hash des Vorgaengers. Ohne diese Pruefung liesse sich ein
 * ganzes Geschaeftsjahr entfernen, und das Folgejahr verifizierte sauber
 * weiter — der wertvollste Manipulationsfall, unsichtbar gemacht.
 */
export async function pruefeKette(db: Abfrage): Promise<KettenBefund> {
  const kreise = await db.abfrage<KreisZeile>(
    `select id::text as id, bezeichnung, genesis_hash, letzter_hash
       from nummernkreis
      where mandant_id = app.aktiver_mandant()
        and kreis_typ = 'ausgangsrechnung'
      order by jahr, geoeffnet_am, id`,
  );

  const befunde: KreisBefund[] = [];
  let erster: KettenBruch | null = null;
  let gesamt = 0;

  for (const kreis of kreise) {
    const glieder = await db.abfrage<GliedZeile>(GLIEDER_SQL, [kreis.id]);

    /**
     * Schritt 1 — Lueckenlosigkeit. Eine fehlende Position heisst, dass eine
     * Zeile UNTERHALB der Anwendungsschicht entfernt wurde; danach hat jeder
     * weitere Vergleich keinen Aussagewert mehr, also wird hier abgebrochen.
     */
    const positionen = glieder.map((g) => Number(g.kette_position));
    const luecke = positionen.findIndex((p, i) => p !== i + 1);
    if (luecke >= 0) {
      const bruch: KettenBruch = {
        nummer: glieder[luecke]?.nummer ?? '—',
        rechnungId: glieder[luecke]?.rechnung_id ?? '',
        nummernkreis: kreis.bezeichnung,
        position: positionen[luecke] ?? luecke + 1,
        grund: 'position_luecke',
        erwartet: String(luecke + 1),
        gefunden: String(positionen[luecke] ?? '—'),
      };
      befunde.push({
        nummernkreisId: kreis.id, bezeichnung: kreis.bezeichnung,
        geprueft: luecke, bruch,
      });
      erster ??= bruch;
      gesamt += luecke;
      continue;
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
      const bruch: KettenBruch = {
        nummer: glied?.nummer ?? '—',
        rechnungId: glied?.rechnung_id ?? '',
        nummernkreis: kreis.bezeichnung,
        position: pruefung.ersterBruch.position,
        grund: pruefung.ersterBruch.grund,
        erwartet: pruefung.ersterBruch.erwartet,
        gefunden: pruefung.ersterBruch.gefunden,
      };
      befunde.push({
        nummernkreisId: kreis.id, bezeichnung: kreis.bezeichnung,
        geprueft: pruefung.geprueft, bruch,
      });
      erster ??= bruch;
      gesamt += pruefung.geprueft;
      continue;
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
      const bruch: KettenBruch = {
        nummer: abweichend.nummer,
        rechnungId: abweichend.rechnung_id,
        nummernkreis: kreis.bezeichnung,
        position: Number(abweichend.kette_position),
        grund: 'kopf_weicht_ab',
        erwartet: `${abweichend.nutzlast_nummer ?? '—'} / ${abweichend.nutzlast_brutto ?? '—'}`,
        gefunden: `${abweichend.nummer} / ${abweichend.brutto_cent}`,
      };
      befunde.push({
        nummernkreisId: kreis.id, bezeichnung: kreis.bezeichnung,
        geprueft: glieder.length, bruch,
      });
      erster ??= bruch;
      gesamt += glieder.length;
      continue;
    }

    befunde.push({
      nummernkreisId: kreis.id, bezeichnung: kreis.bezeichnung,
      geprueft: glieder.length, bruch: null,
    });
    gesamt += glieder.length;
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
