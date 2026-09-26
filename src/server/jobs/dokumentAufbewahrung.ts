import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobAbfrage, type JobVerbindung } from './sitzung.js';
import { NichtVerbundenFehler } from '../storage/adapter.js';
import { waehleSpeicher } from '../storage/waehle.js';
import type { Speicher } from '../storage/adapter.js';
import { loescheDokument, LoeschungFehler } from '../services/dokument/loeschung.js';
import type { SchreibKontext } from '../kontext/index.js';

/**
 * Der Lauf, der eine abgelaufene Aufbewahrungsfrist auch einlöst (V-116,
 * DOC-07, LEG-01, § 147 AO, Art. 5 Abs. 1 lit. e DSGVO).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `services/dokument/loeschung.ts` ist der EINE Weg, auf dem ein Dokument
 * samt Datei verschwindet — gebaut, geprüft, und im ganzen Baum ohne
 * Aufrufer ausser dem Test. `/datenschutz/loeschkonzept` nennt derweil je
 * Klasse eine Frist und ihre Grundlage. Wer das liest, liest eine Zusage.
 * Eine Frist, die nur abläuft, ohne dass etwas geschieht, ist nach Art. 5
 * Abs. 1 lit. e DSGVO genau der Zustand, den man nicht haben darf — und vor
 * einer Aufsicht ist die Zusage schlimmer als das Schweigen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Dieser Lauf erfindet keine Frist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die meisten Fristen sind offen (O-25, O-46) — und genau deshalb darf er
 * gebaut werden: die Datenbank entscheidet, nicht er.
 * `kern.setze_aufbewahrung` (0009) setzt `loeschsperre = true`, solange eine
 * Kategorie keine oder nur eine Platzhalter-Regel hat. Solche Zeilen fallen
 * schon aus dem `using` der Policy heraus; der Lauf SIEHT sie nicht.
 * `04-SEITENKARTE.md` §5.16 sagt es wörtlich: „the purge job considers no
 * row". Dieser Lauf ist dieser purge job.
 *
 * Er rechnet auch nichts aus. Gelesen wird `aufbewahrung_bis`, gesetzt beim
 * Anlegen. Eine Frist, die der Nachtlauf selbst rechnet, änderte rückwirkend,
 * was gestern galt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Wie weit er heute wirklich reicht — zwei von neun Klassen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `loeschsperre := r.loeschsperre or r.ist_platzhalter`, und eine gesetzte
 * Sperre lässt sich nie wieder lösen (D-49). Von den neun Dokumentklassen
 * tragen deshalb sieben eine: die vier GoBD-Klassen (`rechnung`,
 * `buchhaltung`, `beleg`, `vertrag`) aus einer ENTSCHIEDENEN Regel und die
 * drei offenen (`mitarbeiter`, `projekt`, `unternehmen`) als Platzhalter.
 *
 * Ohne Sperre stehen genau zwei da: `angebot` und `kunde`, je sechs Jahre
 * nach § 257 HGB. **Das ist die ganze Menge, die dieser Lauf je anfassen
 * kann.** Wer „purge job" liest und an Rechnungen denkt, denkt falsch — und
 * das steht hier, damit niemand es aus dem Namen schliesst.
 *
 * Bei den vier GoBD-Klassen ist das eine offene Rechtsfrage und keine
 * Einstellung: § 147 AO nennt eine MINDESTfrist, Art. 5 Abs. 1 lit. e DSGVO
 * verlangt eine Obergrenze, und `08-PR-PLAN.md` PR 64 sagt „for the full ten
 * years" — die Tabelle sperrt dauerhaft. Eine der beiden Seiten muss
 * nachgeben, und das entscheidet nicht diese Datei.
 *
 * // TODO(client, O-894): Darf eine Rechnung, ein Buchungsbeleg oder ein Vertrag nach Ablauf der zehn Jahre gelöscht werden, oder bleibt die Aufbewahrung dauerhaft?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **`je_mandant` und NICHT `uebergreifend` — der Unterschied ist die Policy.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der erste Entwurf suchte mit `alsJobRolle` quer über alle Gesellschaften,
 * wie `bewerber_loeschung` es tut. Das geht dort, weil `bewerbung` dem Lauf
 * eine Lesepolicy mit `using (true)` gibt. **`dokument` tut das nicht:**
 * `j_dokument_lesen` (0139) hängt an `mandant_id = app.aktiver_mandant()`,
 * und ohne gebundenen Mandanten hätte die Suche schlicht null Zeilen
 * gefunden — jede Nacht, ohne ein rotes Zeichen.
 *
 * Gesucht wird deshalb INNERHALB der gebundenen Sitzung. Der Läufer gibt
 * den Mandanten (`aktiveMandanten`), die Policy sieht ihn, und was der Lauf
 * findet, ist genau das, was er auch anfassen darf.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **05:10 — und das ist kein beliebiger Zeitpunkt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nach dem Kettenprüfer (03:20), nach dem Postenabgleich (03:40), nach dem
 * Belegarchiv (03:50) und nach der Bewerberlöschung (04:00). Erst steht
 * fest, dass die Belege unversehrt sind, dann wird abgelegt, was abzulegen
 * ist — und erst danach wird gelöscht. Umgekehrt löschte dieser Lauf ein
 * Dokument, das das Belegarchiv in derselben Nacht noch gebraucht hätte.
 */
export interface AufbewahrungsBefund {
  readonly faellig: number;
  readonly geloescht: number;
  /**
   * Zurückgehalten: zwischen Finden und Löschen kam eine Löschsperre, ein
   * Buchungsbezug oder ein Mensch dazwischen.
   *
   * **Das ist kein Fehler und wird deshalb getrennt gezählt.** Eine Zeile,
   * die eine Buchung hält, SOLL bleiben — sie in denselben Topf wie einen
   * abgerissenen Speicher zu werfen, machte aus einer richtigen Entscheidung
   * ein rotes Zeichen, dem danach niemand mehr glaubt.
   */
  readonly zurueckgehalten: number;
  readonly fehler: number;
  /** Der Text des LETZTEN Fehlers — ein Zähler allein sagt nicht, woran. */
  readonly letzterFehler: string | null;
}

/** Wie viele Dokumente eine Gesellschaft je Nacht höchstens mitnimmt. */
const STAPEL = 500;

export function registriereDokumentAufbewahrung(
  sql: JobVerbindung,
  /** Einspritzbar, damit der Test ohne Supabase läuft. */
  speicherFuer: () => Speicher = () => waehleSpeicher(),
): JobDefinition {
  return registriere({
    schluessel: 'dokument_aufbewahrung',
    bezeichnung: 'Dokumente nach Ablauf der Aufbewahrungsfrist löschen (DOC-07, LEG-01)',
    zeitplan: '10 5 * * *',
    bereich: 'je_mandant',
    versuche: 1,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('dokument_aufbewahrung ist je_mandant und braucht einen Mandanten.');
      }
      return { ...(await laufe(sql, kontext.mandantId, speicherFuer())) };
    },
  });
}

/** Der Lauf selbst — ohne Registrierung, damit der Test ihn direkt aufruft. */
export async function laufe(
  sql: JobVerbindung, mandantId: string, speicher: Speicher,
): Promise<AufbewahrungsBefund> {
  /*
   * **Ohne verbundenen Speicher passiert gar nichts — und es wird gesagt.**
   * Ein Lauf, der bei fehlenden Zugangsdaten „0 gelöscht" meldet, sieht aus
   * wie ein Lauf ohne Arbeit. Er ist einer, der nicht arbeiten KANN.
   *
   * Und hier wiegt das doppelt: die Zeile ohne die Datei wäre ein Dokument,
   * das als gelöscht gilt und im Bucket liegt — genau der halbe Zustand, den
   * `loescheDokument` mit seiner Reihenfolge ausschliesst.
   */
  if (!speicher.verbunden) throw new NichtVerbundenFehler('Supabase Storage');

  /*
   * `loeschsperre` steht in der Bedingung, obwohl die Schreibpolicy sie
   * ohnehin verlangt: was hier schon herausfällt, wird nicht erst in einer
   * eigenen Transaktion versucht und als „zurückgehalten" gezählt. Die Zahl
   * soll die Zeilen nennen, bei denen sich zwischen Finden und Löschen etwas
   * geändert hat — nicht die, die von vornherein nicht gemeint waren.
   */
  const faellig = await alsJobSitzung(sql, mandantId, (db) => db.abfrage<{
    id: string; aufbewahrung_bis: string; kategorie: string;
  }>(
    `select id, aufbewahrung_bis::text as aufbewahrung_bis,
            kategorie::text as kategorie
       from dokument
      where geloescht_am is null
        and not loeschsperre
        and aufbewahrung_bis is not null
        and aufbewahrung_bis <= app.berlin_heute()
      order by aufbewahrung_bis, id
      limit ${String(STAPEL)}`), { nurLesen: true });

  let geloescht = 0;
  let zurueckgehalten = 0;
  let fehler = 0;
  let letzterFehler: string | null = null;

  for (const z of faellig) {
    /*
     * **Ein Dokument je Transaktion.** Ein Stapel in einer Transaktion wäre
     * schneller und falsch: die Datei des dreissigsten Dokuments ist dann
     * schon aus dem Speicher entfernt, wenn das einunddreissigste die
     * Transaktion zurückrollt — und seine Zeile stünde wieder da, während
     * die Datei fort ist. Getrennt betrachtet ist jede Löschung für sich
     * ganz geschehen oder gar nicht.
     */
    try {
      await alsJobSitzung(
        sql, mandantId,
        (db) => loescheDokument(alsKontext(db, mandantId), speicher, {
          dokumentId: z.id,
          grund: loeschgrund(z.kategorie, z.aufbewahrung_bis),
        }),
        { nurLesen: false });
      geloescht += 1;
    } catch (grund: unknown) {
      /*
       * **`nicht_gefunden` und `gesperrt` sind hier keine Fehler.**
       *
       * Zwischen dem Finden und dem Löschen liegt eine Lücke, und in ihr
       * kann ein Mensch eine Löschsperre setzen oder eine Buchung den Beleg
       * an sich binden. Die Policy und die beiden Auslöser weisen die Zeile
       * dann ab — sie bleibt stehen, und das ist die richtige Antwort.
       * Gezählt wird sie trotzdem: eine Zurückhaltung, die niemand sieht,
       * wird nie geprüft.
       */
      if (grund instanceof LoeschungFehler) {
        zurueckgehalten += 1;
        continue;
      }
      fehler += 1;
      letzterFehler = grund instanceof Error ? grund.message : String(grund);
    }
  }

  return { faellig: faellig.length, geloescht, zurueckgehalten, fehler, letzterFehler };
}

/**
 * Der Grund, der in `loeschgrund` stehen bleibt.
 *
 * **Er nennt die Frist und ihren Ablauf, nicht „Nachtlauf".** Wer in fünf
 * Jahren fragt, warum dieses Dokument fehlt, liest genau diese Zeile — und
 * „automatisch gelöscht" beantwortet die Frage nicht.
 */
export function loeschgrund(kategorie: string, bis: string): string {
  return `Aufbewahrungsfrist der Klasse „${kategorie}" am ${bis} abgelaufen `
    + '(job:dokument_aufbewahrung, DOC-07, § 147 AO).';
}

/**
 * Die Job-Abfrage in der Form, die der Dienst erwartet.
 *
 * `abfrage` und `schreibe` zeigen auf dieselbe Methode: die Sitzung ist
 * bereits als schreibend oder lesend gebunden (`nurLesen`), und zwar an der
 * Stelle, die es entscheidet. Hier nachträglich zu trennen täuschte eine
 * Grenze vor, die eine Ebene tiefer schon gezogen ist.
 */
function alsKontext(db: JobAbfrage, mandantId: string): SchreibKontext {
  return {
    scope: 'mandant',
    portal: 'intern',
    /*
     * Leer, und das ist die ehrliche Angabe: ein Nachtlauf ist kein Benutzer.
     * `alsJobSitzung` setzt `app.benutzer_id` ebenso leer, `geloescht_von`
     * bleibt damit NULL, und das Protokoll trägt `akteur_typ = 'system'`.
     */
    benutzerId: '',
    aktiverMandantId: mandantId,
    mandantIds: [mandantId],
    abfrage: db.abfrage.bind(db),
    schreibe: db.abfrage.bind(db),
  };
}
