import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Der lesende iCal-Zugang (CAL-03).
 *
 * **Warum ein Token und kein Kennwort.** Ein Kalenderprogramm holt den Feed
 * ohne Sitzung: es kann sich nicht anmelden, keinen zweiten Faktor führen und
 * kein Ablaufdatum verhandeln. Der Zugang ist deshalb ein langer Zufallswert
 * in der Adresse — und weil er das ist, gelten vier Regeln, die zusammen erst
 * einen Sinn ergeben:
 *
 *  1. **Nur lesen.** Über diesen Weg lässt sich nichts ändern.
 *  2. **Gespeichert wird der HASH.** Wer die Datenbank liest, bekommt keinen
 *     Kalenderzugang — derselbe Grund wie beim Kennwort.
 *  3. **Einmal zeigen.** Die Adresse gibt es bei der Ausgabe und nie wieder;
 *     der Weg zu einer neuen ist eine neue.
 *  4. **Widerrufbar, und der Widerruf wirkt sofort.**
 *
 * **256 Bit.** Der Token steht in Adressleisten, Serverprotokollen und
 * Kalender-Konfigurationsdateien; er ist das einzige Geheimnis auf diesem Weg,
 * und er wird nie gedreht, solange niemand ihn dreht. Kürzer wäre eine
 * Rechnung darüber, wie lange jemand raten darf.
 */

export interface Schreiber {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Leser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/** Nur Zeichen, die eine Adresse unverändert überstehen — kein `+`, kein `/`. */
export function neuerToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface FeedStand {
  readonly id: string;
  readonly bezeichnung: string;
  readonly erstelltAm: string;
  readonly letzterAbrufAm: string | null;
  readonly abrufe: number;
}

/** Die offenen Feeds dieses Menschen — ohne Token, den gibt es nicht mehr. */
export async function eigeneFeeds(db: Leser): Promise<readonly FeedStand[]> {
  return db.abfrage<FeedStand>(
    `select id::text as id, bezeichnung,
            erstellt_am::text as "erstelltAm",
            letzter_abruf_am::text as "letzterAbrufAm",
            abrufe
       from kalender_feed
      where widerrufen_am is null
      order by erstellt_am desc`);
}

/**
 * Legt einen Feed an und gibt den Token **genau hier** zurück.
 *
 * Er wird nicht gespeichert und nicht protokolliert; der Aufrufer zeigt ihn
 * einmal an. Wer ihn verliert, dreht ihn — das ist billiger als ein Token,
 * den man nachschlagen kann.
 */
export async function legeFeedAn(
  db: Schreiber, bezeichnung = 'Mein Kalender',
): Promise<{ readonly token: string; readonly id: string }> {
  const token = neuerToken();
  const [zeile] = await db.schreibe<{ id: string }>(
    `insert into kalender_feed (benutzer_id, token_hash, bezeichnung)
     values (app.aktueller_benutzer(), $1, $2)
     returning id::text as id`,
    [tokenHash(token), bezeichnung.trim() === '' ? 'Mein Kalender' : bezeichnung.trim()]);
  if (zeile === undefined) throw new Error('Der Kalenderzugang liess sich nicht anlegen.');
  return { token, id: zeile.id };
}

/**
 * Widerruft einen Feed. **Ein `update`, kein `delete`**: wer wissen will, ob
 * ein Zugang je bestand und wann er endete, findet die Zeile — und der
 * Eindeutigkeitsindex auf dem Hash verhindert, dass derselbe Token je wieder
 * vergeben wird.
 */
export async function widerrufeFeed(db: Schreiber, id: string): Promise<boolean> {
  const zeilen = await db.schreibe<{ id: string }>(
    `update kalender_feed set widerrufen_am = now()
      where id = $1::uuid and widerrufen_am is null
      returning id::text as id`, [id]);
  return zeilen.length === 1;
}

/** Ein Bereich, den dieser Zugang trägt — mit dem Portal aus seiner ROLLE. */
export interface FeedBereich {
  readonly mandantId: string;
  readonly slug: string;
  readonly portal: 'intern' | 'mitarbeiter' | 'kunde';
}

export interface FeedZugang {
  readonly benutzerId: string;
  /** `null` bei einem Konto ohne Personenakte — dann gibt es keinen Personen-Scope. */
  readonly personId: string | null;
  readonly bereiche: readonly FeedBereich[];
}

const PORTALE = new Set(['intern', 'mitarbeiter', 'kunde']);

/**
 * Löst einen Token auf — die einzige Stelle, an der das geschieht.
 *
 * Gibt zurück, WER liest und WAS er trägt, nie Termine: die liest der
 * Aufrufer danach in einer Sitzung, die er für genau diesen Menschen bindet.
 * Ein Definer, der gleich die Termine mitgäbe, wäre ein zweiter Lesepfad
 * neben RLS — und der erste, der bei einer Policy-Änderung vergessen wird.
 *
 * **Das Portal kommt mit, und es ist das echte** (0161). Vorher erfand die
 * Route `intern` für jeden Tokenträger; damit fiel `p_ma_decke` — die
 * restriktive Decke, die einem Arbeiter nur seine eigenen Schichten lässt —
 * auf der einzigen Route ohne Sitzung weg.
 */
export async function loeseTokenAuf(db: Leser, token: string): Promise<FeedZugang | null> {
  /*
   * Ein Token, der gar nicht die Form hat, geht nicht in die Abfrage: er
   * kann keine Zeile treffen, und ihn trotzdem zu suchen hiesse, jedem
   * Versuch eine Datenbankrunde zu schenken.
   */
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(token)) return null;
  const zeilen = await db.abfrage<{
    benutzer_id: string; person_id: string | null;
    mandant_id: string | null; slug: string | null; portal: string | null;
  }>(`select benutzer_id::text as benutzer_id, person_id::text as person_id,
             mandant_id::text as mandant_id, slug, portal
        from app.kalender_feed_aufloesen($1)`, [tokenHash(token)]);
  const erste = zeilen[0];
  if (erste === undefined) return null;

  return {
    benutzerId: erste.benutzer_id,
    personId: erste.person_id,
    /*
     * Ein unbekannter Portalwert wird verworfen und nicht gecastet —
     * dieselbe geschlossene Menge wie in `sitzungAufloesen`. Fail closed:
     * lieber ein Bereich weniger als eine Decke, die niemand definiert hat.
     */
    bereiche: zeilen
      .filter((z) => z.mandant_id !== null && z.slug !== null
                     && z.portal !== null && PORTALE.has(z.portal))
      .map((z) => ({
        mandantId: z.mandant_id!, slug: z.slug!,
        portal: z.portal as FeedBereich['portal'],
      })),
  };
}
