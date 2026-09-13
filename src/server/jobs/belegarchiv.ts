/**
 * Der naechtliche Archivlauf fuer Ausgangsrechnungen (ACC-03, DOC-04, PR 59).
 *
 * **Warum ein Lauf und kein Schritt im Festschreiben.** Das Ablegen braucht
 * einen Netzaufruf in den Objektspeicher. Im Festschreiben liefe der
 * innerhalb der Transaktion, die den Nummernzaehler unter
 * `SELECT … FOR UPDATE` haelt — jede andere Rechnung derselben Gesellschaft
 * wartete dann auf einen Speicher, mit dem sie nichts zu tun hat. Und ein
 * Speicher, der langsam ist, machte aus einer Verzoegerung eine Sperre.
 *
 * **Was der Lauf schuldig bleibt, bleibt sichtbar.** Eine Rechnung, deren
 * PDF noch nicht liegt, steht mit ihren Buchungszeilen in
 * `buchungssatz_unvollstaendig`, und `app.export_sperre_pruefen` verweigert
 * den DATEV-Export fuer den Zeitraum. Ein ausgefallener Lauf blockiert damit
 * den Export statt eine luechenhafte Datei zu erzeugen — die laute Variante.
 *
 * **`versuche: 1`.** Anders als beim Postenabgleich ist ein zweiter Versuch
 * hier sinnvoll: der haeufigste Fehlgrund ist ein Speicher, der einen Moment
 * nicht antwortet, und der ist beim naechsten Versuch weg. Was NICHT weggeht
 * — kein Snapshot, keine Nummer — meldet der Lauf als Zahl und nicht als
 * Fehler; dafuer ist er nicht zustaendig.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobAbfrage, type JobVerbindung } from './sitzung.js';
import { SupabaseSpeicher, NichtVerbundenFehler } from '../storage/adapter.js';
import type { Speicher } from '../storage/adapter.js';
import { archiviereRechnungsbeleg, offeneArchivierungen, type ArchivKontext }
  from '../services/buchhaltung/belegarchiv.js';

export interface ArchivlaufBefund {
  readonly offen: number;
  readonly abgelegt: number;
  readonly ohneSnapshot: number;
  readonly fehler: number;
}

export function registriereBelegarchiv(
  sql: JobVerbindung,
  /** Einspritzbar, damit der Test ohne Supabase laeuft. */
  speicherFuer: () => Speicher = () => new SupabaseSpeicher(),
): JobDefinition {
  return registriere({
    schluessel: 'belegarchiv_ausgangsrechnung',
    bezeichnung: 'Ausgangsrechnungen als PDF archivieren (ACC-03)',
    /*
     * 03:50 — nach dem Kettenpruefer (03:20) und nach dem Postenabgleich
     * (03:40). Erst steht fest, dass die Belege unversehrt sind, dann was auf
     * ihnen offen ist, dann wird abgelegt. Umgekehrt legte der Lauf ein PDF
     * einer Rechnung ab, deren Kette in derselben Nacht als gerissen gemeldet
     * wird.
     */
    zeitplan: '50 3 * * *',
    bereich: 'je_mandant',
    versuche: 1,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error(
          'belegarchiv_ausgangsrechnung ist je_mandant und braucht einen Mandanten.');
      }
      const speicher = speicherFuer();
      const befund = await laufe(sql, kontext.mandantId, speicher);
      return { ...befund };
    },
  });
}

/** Der Lauf selbst — ohne Registrierung, damit der Test ihn direkt aufruft. */
export async function laufe(
  sql: JobVerbindung, mandantId: string, speicher: Speicher,
): Promise<ArchivlaufBefund> {
  /*
   * **Ohne verbundenen Speicher passiert gar nichts — und es wird gesagt.**
   * Ein Lauf, der bei fehlenden Zugangsdaten „0 abgelegt, 0 Fehler" meldet,
   * sieht aus wie ein Lauf ohne Arbeit. Er ist einer, der nicht arbeiten
   * KANN, und der Unterschied entscheidet, ob jemand nachsieht.
   */
  if (!speicher.verbunden) throw new NichtVerbundenFehler('Supabase Storage');

  const ids = await alsJobSitzung(
    sql, mandantId,
    async (db) => offeneArchivierungen(alsKontext(db, mandantId)),
    { nurLesen: true });

  let abgelegt = 0;
  let ohneSnapshot = 0;
  let fehler = 0;

  /*
   * **Eine Rechnung je Transaktion.** Ein Stapel in einer Transaktion waere
   * schneller und falsch: die Datei der dreissigsten Rechnung liegt dann
   * schon im Speicher, wenn die einunddreissigste die Transaktion
   * zurueckrollt — und ihre Zeilen sind weg, die Datei nicht. Getrennt
   * betrachtet ist jede Ablage fuer sich richtig oder gar nicht passiert.
   */
  for (const id of ids) {
    try {
      const ergebnis = await alsJobSitzung(
        sql, mandantId,
        async (db) => archiviereRechnungsbeleg(alsKontext(db, mandantId), speicher, id),
        { nurLesen: false });
      if (ergebnis.grund === 'archiviert') abgelegt += 1;
      else if (ergebnis.grund === 'kein_snapshot') ohneSnapshot += 1;
    } catch {
      /*
       * Eine gescheiterte Rechnung haelt die anderen nicht auf. Sie bleibt
       * offen, steht morgen wieder auf der Liste, und ihre Buchungszeilen
       * halten den Export solange gesperrt — sie verschwindet also nicht.
       */
      fehler += 1;
    }
  }

  return { offen: ids.length, abgelegt, ohneSnapshot, fehler };
}

/**
 * Die Job-Abfrage in der Form, die die Dienste erwarten.
 *
 * `JobAbfrage` kennt EINE Methode; `ArchivKontext` unterscheidet `abfrage`
 * von `schreibe`. Der Unterschied ist im Job keiner: die Sitzung ist bereits
 * als schreibend oder lesend gebunden (`nurLesen`), und zwar an der Stelle,
 * die es entscheidet — hier nachtraeglich zu trennen, taeuschte eine Grenze
 * vor, die eine Ebene tiefer schon gezogen ist.
 */
function alsKontext(db: JobAbfrage, mandantId: string): ArchivKontext {
  return {
    aktiverMandantId: mandantId,
    abfrage: db.abfrage.bind(db),
    schreibe: db.abfrage.bind(db),
  };
}
