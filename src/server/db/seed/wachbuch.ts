/**
 * Demodaten fuer das Wachbuch (SEC-05, TIM-08, TIM-09, LEG-01).
 *
 * **Ohne diese Datei stand `wachbuch_eintrag` ueber alle vier Gesellschaften
 * auf null Zeilen.** Das ist nicht dasselbe wie „noch nichts passiert": das
 * Buch ist der Nachweis, den die SSE Security im Streitfall vorlegt, und ein
 * Bildschirm, der es leer zeigt, beweist nichts — weder dass die Kette haelt,
 * noch dass eine Richtigstellung beide Seiten stehen laesst, noch dass die
 * angezeigte Uhrzeit die des Servers ist. Drei Zusagen aus PR 41, die nur
 * gegen echte Zeilen ueberhaupt nachpruefbar sind.
 *
 * **Geschrieben wird ueber den ECHTEN Dienst** (`schreibeEintrag`,
 * `korrigiereEintrag`) und nicht ueber ein `insert`. Das ist hier mehr als
 * Ordnungsliebe: der Dienst loest den URHEBER aus der Sitzung auf und lehnt
 * ab, wer in dieser Gesellschaft keine Beschaeftigung hat (`KeinUrheber`,
 * 422, §10.5). Ein Seed, der die Zeilen selbst schriebe, haette genau diese
 * Sperre uebersprungen — und das Fehlen der Beschaeftigung waere erst im
 * Browser aufgefallen, als Fehler auf einem Bildschirm, der nach einer
 * kaputten Seite aussieht. Deshalb haengt diese Datei an Teil 1: erst der
 * Mensch und seine Anstellung, dann das Buch.
 *
 * **Die Zeit kommt aus der Datenbank.** `kern.wachbuch_eintrag_vorbereiten`
 * ueberschreibt `erfasst_am` mit `now()` — immer, ohne Ausnahme (Invariante 5,
 * TIM-08). Dieser Seed schickt keinen Zeitpunkt mit; was er mitschickt, ist
 * die BEHAUPTUNG eines Geraets, und die steht in `geraete_zeit` daneben.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien. Ein
 * zweiter Lauf darf das Buch nicht verdoppeln: eine Wachbuchseite ist nicht
 * loeschbar (Invariante 8, §1.14), ein Fehlgriff bliebe also fuer immer
 * stehen.
 */
import type postgres from 'postgres';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  korrigiereEintrag, schreibeEintrag,
} from '../../services/security/wachbuch.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface WachbuchErgebnis {
  /** Zeilen im Buch — die Richtigstellung ist eine eigene. */
  readonly eintraege: number;
  /** Davon als falsch gekennzeichnet. Sie bleiben LESBAR stehen. */
  readonly storniert: number;
}

const LEER: WachbuchErgebnis = { eintraege: 0, storniert: 0 };

/**
 * Die Sitzung einer Wache — dieselbe wie im Portal, plus `app.person_id`.
 *
 * `alsPortalSitzung` bindet Mandant, Benutzer, Portal und `app.readonly`,
 * aber keine Person: die Dienste, die es bisher aufrufen (Einteilung,
 * Stundenkonto), fragen nach dem BENUTZER. Das Wachbuch fragt nach dem
 * MENSCHEN — `app.aktuelle_person()` —, weil ein Eintrag seinen Urheber als
 * Beschaeftigung traegt und nicht als Anmeldung (§10.5).
 *
 * Gesetzt wird die fehlende Angabe INNERHALB der schon gebundenen
 * Transaktion, statt den Sitzungsaufbau ein zweites Mal abzuschreiben.
 * `set_config(..., true)` ist transaktionslokal — dieselbe Zusage wie in
 * `kontext/index.ts`: keine Sitzungsgroesse ueberlebt ihre Transaktion.
 */
async function alsWache<T>(
  sql: Sql, mandantId: string, benutzerId: string, personId: string,
  fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsPortalSitzung(sql, mandantId, benutzerId, async (kontext) => {
    await kontext.schreibe(`select set_config('app.person_id', $1, true)`, [personId]);
    return fn(kontext);
  });
}

interface Wache {
  readonly benutzer_id: string;
  readonly person_id: string;
}

/**
 * Wer das Buch fuehrt — die WACHLEITUNG, nicht die Wache am Posten.
 *
 * Das ist keine Bequemlichkeit, sondern die Rechtelage: `wachbuch.schreiben`
 * haelt auch `mitarbeiter`, `wachbuch.lesen` aber nicht (03-AUTH §12.7, und
 * die Policies `t_mandant`/`t_person` in 0070 bauen genau darauf auf). Eine
 * Richtigstellung LIEST den alten Eintrag, bevor sie ihn storniert — aus
 * einer Mitarbeitersitzung im Mandantenumfang kaeme dabei „null Zeilen"
 * zurueck, also `EintragNichtGefunden` fuer eine Seite, die es gibt. Die
 * Wache schreibt ihre Seiten und liest sie im eigenen Portal; korrigieren
 * kann im Mandantenumfang die Leitung.
 */
async function wachleitung(sql: Sql, mandantId: string): Promise<Wache | undefined> {
  const [zeile] = await sql<Wache[]>`
    select b.id as benutzer_id, b.person_id
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
      join rolle r on r.id = bm.rolle_id
     where r.schluessel in ('leitung', 'super_admin')
       and b.status = 'aktiv' and bm.entzogen_am is null
       and b.person_id is not null
       -- Die Beschaeftigung IN DIESER Gesellschaft ist die Bedingung, an der
       -- schreibeEintrag sonst scheitert. Sie hier mitzupruefen heisst: der
       -- Seed sagt vor dem ersten Eintrag, dass die Anstellung fehlt, statt
       -- mitten im Schreiben mit KeinUrheber (422) abzubrechen.
       -- (Kommentar ohne Backticks: einer beendet hier die Zeichenkette.)
       and exists (select 1 from anstellung a
                    where a.person_id = b.person_id and a.mandant_id = ${mandantId}
                      and a.status = 'aktiv' and a.geloescht_am is null)
     order by b.email
     limit 1`;
  return zeile;
}

/**
 * Die vier Seiten einer Nacht am Objektschutz Kurfürstendamm.
 *
 * Sie sind bewusst keine Stichworte: eine Wachbuchseite ist die Aufzeichnung,
 * die ein Gericht liest, und „Test 1" in einer Demo bringt niemandem bei, wie
 * eine brauchbare aussieht. Der Hergang steht im Text, die Bewertung nicht.
 */
export async function seedWachbuch(
  sql: Sql, mandantId: string, postenId: string | null, objektId: string | null,
): Promise<WachbuchErgebnis> {
  if (postenId === null || objektId === null) return LEER;

  const [da] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from wachbuch_eintrag
     where mandant_id = ${mandantId} and objekt_id = ${objektId}`;
  if (Number(da?.anzahl ?? '0') > 0) return LEER;

  const wache = await wachleitung(sql, mandantId);
  if (wache === undefined) {
    process.stdout.write(
      '  · Wachbuch bleibt leer: keine Leitung mit Beschäftigung in dieser '
      + 'Gesellschaft (§10.5)\n');
    return LEER;
  }

  const bezug = { objektId, postenId } as const;

  /**
   * Die Uhr des Geraets, gelesen KURZ BEVOR geschrieben wird.
   *
   * Sie geht knapp drei Minuten vor — ein gewoehnlicher, unauffaelliger
   * Wert, wie ihn ein Diensttelefon nach ein paar Wochen hat. Genau darum
   * geht es: die Abweichung ist kein Alarm, sondern eine Angabe, die
   * DANEBEN steht (TIM-08). Ohne eine einzige Zeile mit `geraete_zeit`
   * zeigte das Blatt das Feld nie, und niemand saehe, dass die angezeigte
   * Uhrzeit die des Servers ist und nicht die des Telefons.
   *
   * Der Wert kommt aus der Datenbank und nicht aus `new Date()`: der
   * Node-Prozess laeuft in UTC, die Serveruhr ist die Bezugsgroesse, und
   * eine Abweichung, die in Wahrheit der Versatz zweier Uhren ist, waere
   * eine erfundene Messung.
   */
  const [geraet] = await sql<{ zeit: string }[]>`
    select (now() + interval '174 seconds')::text as zeit`;

  await alsWache(sql, mandantId, wache.benutzer_id, wache.person_id,
    (k) => schreibeEintrag(k, {
      ...bezug,
      art: 'rundgang',
      betreff: 'Rundgang 1 — Tiefgarage, Foyer, Treppenhäuser A und B',
      eintragstext:
        'Streifenplan vollständig abgegangen: Tiefgarage Ebene −1 und −2, Foyer, '
        + 'Treppenhäuser A und B, Dachausstieg. Flucht- und Rettungswege frei, '
        + 'Brandschutztüren geschlossen, Aufzug 2 außer Betrieb (Wartungsschild '
        + 'der Haustechnik hängt). Keine besonderen Vorkommnisse.',
      geraeteZeit: geraet?.zeit ?? null,
    }));

  const vorkommnis = await alsWache(sql, mandantId, wache.benutzer_id, wache.person_id,
    (k) => schreibeEintrag(k, {
      ...bezug,
      art: 'vorkommnis',
      betreff: 'Nebeneingang Uhlandstraße unverschlossen vorgefunden',
      eintragstext:
        'Bei Rundgang 2 stand der Nebeneingang zur Uhlandstraße unverschlossen '
        + 'offen. Tür geschlossen und verriegelt, Riegel und Schließblech ohne '
        + 'erkennbare Beschädigung. Niemand angetroffen, nichts entwendet '
        + 'gemeldet. Haustechnik über die Rufbereitschaft verständigt.',
    }));

  /**
   * Die Übergabe kommt NACHGETRAGEN ins Buch (TIM-09).
   *
   * Sie entstand in der Tiefgarage, wo das Diensttelefon kein Netz hat, und
   * erreichte die Plattform erst oben. `nachgetragen` ist ausdruecklich NICHT
   * dasselbe wie eine Uhrenabweichung: wer beides in eine Spalte legte,
   * koennte eine um 05:50 verfasste und um 06:10 uebertragene Seite nicht
   * mehr von einer um 06:10 verfassten unterscheiden. Zwei Angaben, zwei
   * Spalten, und diese Demo zeigt beide je einmal.
   */
  await alsWache(sql, mandantId, wache.benutzer_id, wache.person_id,
    (k) => schreibeEintrag(k, {
      ...bezug,
      art: 'uebergabe',
      betreff: 'Übergabe an den Tagdienst',
      eintragstext:
        'Schlüsselbund OS-1 vollzählig übergeben, Funkgerät geladen, '
        + 'Besucherliste abgezeichnet. Offener Punkt für den Tagdienst: '
        + 'Türschließer am Lieferanteneingang schließt nicht selbsttätig; die '
        + 'Haustechnik kommt im Laufe des Vormittags. Aufzug 2 weiterhin außer '
        + 'Betrieb.',
      nachgetragen: true,
    }));

  /**
   * Und die RICHTIGSTELLUNG — der Vorgang, der das Wachbuch zu einem
   * Wachbuch macht.
   *
   * Beide Seiten bleiben stehen: die falsche als storniert, mit Grund, und
   * die neue mit dem Verweis auf sie. Ein Buch, aus dem sich die falsche
   * Seite entfernen laesst, beweist nichts — erst das Nebeneinander von
   * Irrtum und Berichtigung tut es. Der Dienst macht daraus ZWEI Vorgaenge in
   * EINER Transaktion; dieser Seed ruft ihn genau deshalb auf, statt zwei
   * Zeilen selbst zu schreiben.
   *
   * Die Art erbt der Ersatz vom Original: die Richtigstellung eines
   * Vorkommnisses ist ein Vorkommnis.
   */
  await alsWache(sql, mandantId, wache.benutzer_id, wache.person_id,
    (k) => korrigiereEintrag(k, {
      eintragId: vorkommnis,
      grund: 'Tür verwechselt — es war der Lieferanteneingang zum Innenhof.',
      betreff: 'Lieferanteneingang zum Innenhof unverschlossen vorgefunden',
      eintragstext:
        'Richtigstellung zum vorstehenden Eintrag: unverschlossen offen stand der '
        + 'Lieferanteneingang zum Innenhof, nicht der Nebeneingang zur '
        + 'Uhlandstraße. Der übrige Hergang bleibt unverändert — Tür geschlossen '
        + 'und verriegelt, keine Beschädigung, niemand angetroffen, Haustechnik '
        + 'über die Rufbereitschaft verständigt.',
    }));

  return { eintraege: 4, storniert: 1 };
}
