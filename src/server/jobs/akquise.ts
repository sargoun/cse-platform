/**
 * Der Akquiselauf — und was er heute tut: nichts, aber sichtbar (§12).
 *
 * **Warum ein Job, der nichts findet, trotzdem existiert.** Es ist keine
 * Recherchequelle verbunden (O-596), also findet dieser Lauf nichts. Er
 * könnte deshalb weggelassen werden — und genau das wäre der Fehler. Ohne ihn
 * steht die Akquiseliste leer da, und niemand kann der Liste ansehen, ob der
 * Markt still ist oder die Verbindung fehlt. Mit ihm steht jeden Morgen eine
 * Zeile in `akquise_lauf`: „übersprungen — keine Quelle verbunden (O-596)".
 *
 * Das ist die Umsetzung von zwei Regeln aus CLAUDE.md in einer Datei: keine
 * erfundene Integration, und keine Stille, wo eine Auskunft hingehört.
 *
 * **Er läuft je Mandant.** Anders als der Vergaberadar, der eine öffentliche
 * Bekanntmachung EINMAL einliest: eine Firmenliste gehört einer Gesellschaft,
 * ihre Bewertung richtet sich nach deren Gewerk, und die Reinigung hat an der
 * Liste der Security nichts zu suchen. Vier Gesellschaften sind hier wirklich
 * vier Läufe.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobAbfrage, type JobVerbindung } from './sitzung.js';
import {
  KeinRechercheur, QuelleNichtVerbundenFehler, quellen,
  type AkquiseQuelle, type Fund, type Rechercheur,
} from '../services/akquise/quelle.js';
import { nimmAuf } from '../services/akquise/ziel.js';

export interface LaufErgebnis {
  readonly laufId: string;
  readonly ergebnis: 'erfolg' | 'uebersprungen' | 'fehler';
  readonly meldung: string;
  readonly gefunden: number;
  readonly neu: number;
}

export interface AkquiseBefund {
  readonly quellen: number;
  readonly uebersprungen: number;
  readonly gefunden: number;
  readonly neu: number;
  readonly laeufe: readonly LaufErgebnis[];
}

/**
 * Welchen Rechercheur bekommt eine Quellenart?
 *
 * Heute: für jede Art denselben, und der wirft. Sobald ein Anbieter beauftragt
 * ist (O-596), tritt hier seine Implementierung an die Stelle — der Rest
 * dieser Datei ändert sich dadurch nicht.
 */
export function rechercheurFuer(quelle: AkquiseQuelle): Rechercheur {
  return new KeinRechercheur(quelle.art);
}

/**
 * Ein Lauf gegen EINE Quelle.
 *
 * **Er schreibt seine Zeile, bevor er etwas versucht, und schliesst sie
 * danach.** Ein Lauf, der erst am Ende protokolliert, hinterlässt bei einem
 * Absturz gar nichts — und ein Nachtlauf, der spurlos stirbt, ist der Ausfall,
 * der am längsten unbemerkt bleibt.
 */
export async function laufeQuelle(
  db: JobAbfrage,
  mandantId: string,
  quelle: AkquiseQuelle,
  rechercheur: Rechercheur,
  stichworte: readonly string[],
): Promise<LaufErgebnis> {
  const beginn = await db.abfrage<{ id: string }>(
    `insert into akquise_lauf (mandant_id, quelle_id, ergebnis, meldung)
     values ($1, $2, 'uebersprungen', 'läuft') returning id`,
    [mandantId, quelle.id],
  );
  const laufId = beginn[0]!.id;

  const abschluss = async (
    ergebnis: LaufErgebnis['ergebnis'], meldung: string, gefunden: number, neu: number,
  ): Promise<LaufErgebnis> => {
    await db.abfrage(
      `update akquise_lauf
          set beendet_am = now(), ergebnis = $2, meldung = $3, gefunden = $4, neu = $5
        where id = $1`,
      [laufId, ergebnis, meldung, gefunden, neu],
    );
    return { laufId, ergebnis, meldung, gefunden, neu };
  };

  if (!quelle.verbunden || !quelle.aktiv) {
    return abschluss(
      'uebersprungen',
      `Quelle nicht verbunden: ${quelle.hinweis ?? 'kein Zugang hinterlegt'} (O-596)`,
      0, 0,
    );
  }

  let funde: readonly Fund[];
  try {
    funde = await rechercheur.suche(quelle, stichworte);
  } catch (fehler) {
    if (fehler instanceof QuelleNichtVerbundenFehler) {
      return abschluss('uebersprungen', fehler.message, 0, 0);
    }
    return abschluss(
      'fehler', fehler instanceof Error ? fehler.message : 'Unbekannter Fehler', 0, 0,
    );
  }

  /*
   * **Die Funde werden geschrieben, bevor der Lauf „erfolg" meldet.**
   *
   * Der erste Entwurf zählte `funde.length` und gab `neu: 0` zurück, ohne eine
   * einzige Zeile anzulegen. Heute fiele das niemandem auf, weil keine Quelle
   * verbunden ist und dieser Zweig nie läuft — und genau deshalb wäre es ein
   * teurer Fehler: er schliefe bis zu dem Tag, an dem jemand eine Quelle
   * anschliesst, und meldete dann täglich Treffer in eine leere Liste.
   */
  let neu = 0;
  for (const fund of funde) {
    const aufnahme = await nimmAuf(
      { unsafe: (s, w) => db.abfrage(s, w) }, mandantId, { ...fund, quelleId: quelle.id },
    );
    if (aufnahme.zustand === 'neu') neu += 1;
  }

  return abschluss('erfolg', `${funde.length} Firmen abgefragt, ${neu} davon neu`,
                   funde.length, neu);
}

/** Der Lauf einer Gesellschaft über alle ihre aktiven Quellen. */
export async function laufeMandant(
  sql: JobVerbindung, mandantId: string, stichworte: readonly string[] = [],
): Promise<AkquiseBefund> {
  /*
   * `nurLesen: false` — dieser Lauf SCHREIBT: `akquise_lauf` (jede Zeile) und
   * `akquise_ziel` (jeden Fund). Die Angabe steht hier und nicht in einer
   * Vorgabe, damit neben dem Aufruf steht, was er schreibt.
   */
  return alsJobSitzung(sql, mandantId, async (db) => {
    const alle = await quellen({ unsafe: (s, w) => db.abfrage(s, w) }, mandantId);
    const aktive = alle.filter((q) => q.aktiv);

    const laeufe: LaufErgebnis[] = [];
    for (const q of aktive) {
      laeufe.push(await laufeQuelle(db, mandantId, q, rechercheurFuer(q), stichworte));
    }

    return {
      quellen: aktive.length,
      uebersprungen: laeufe.filter((l) => l.ergebnis === 'uebersprungen').length,
      gefunden: laeufe.reduce((s, l) => s + l.gefunden, 0),
      neu: laeufe.reduce((s, l) => s + l.neu, 0),
      laeufe,
    };
  }, { nurLesen: false });
}

export function registriereAkquise(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'akquise_recherche',
    bezeichnung: 'Akquise: Firmenrecherche je Gesellschaft (§12) — ohne verbundene Quelle '
      + 'ein protokollierter Leerlauf, kein stiller',
    /*
     * 05:10 UTC — nach dem Radarlauf (04:20) und vor dem Arbeitsbeginn. Die
     * Reihenfolge ist nicht beliebig: der Vergaberadar ist selbst eine der
     * vorgesehenen Quellenarten, und was er nachts einliest, soll dieser Lauf
     * bereits sehen können.
     */
    zeitplan: '10 5 * * *',
    bereich: 'je_mandant',
    versuche: 1,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      const mandantId = kontext.mandantId;
      if (mandantId === null || mandantId === undefined) {
        /*
         * Ein `je_mandant`-Lauf ohne Mandanten liest null Zeilen und meldete
         * „ok" — der stille Ausfall, den `alsJobSitzung` ebenfalls abweist.
         * Hier steht er noch einmal, damit der Fehler den Jobnamen trägt.
         */
        throw new Error('akquise_recherche ohne gebundene Gesellschaft aufgerufen');
      }
      const befund = await laufeMandant(sql, mandantId);
      return { ...befund, laeufe: befund.laeufe.length };
    },
  });
}
