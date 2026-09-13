import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { devFlaechenAn } from '../../lib/dev-flaechen.js';
import type { Portal, Scope, Sitzung, Transaktion } from '../kontext/index.js';

/**
 * Die Sitzung — aus einem Cookie, aufgeloest von der Datenbank.
 *
 * **Was hier PRODUKTIONSCODE ist und was nicht.** Das Aufloesen ist es:
 * `app.sitzung_aufloesen()` prueft Ablauf, Leerlauf, Sperre und
 * Dienstkonto-Ausschluss in einer Anweisung und gibt zurueck, WER gebunden
 * wird und in WELCHES Portal er gehoert. Diese Funktion bleibt, wenn PR 20 die
 * echte Anmeldung bringt.
 *
 * Das AUSSTELLEN einer Sitzung ist es nicht — es steht hier hinter
 * `CSE_DEV_FLAECHEN` und wird von PR 20 durch Telefon + SMS ersetzt.
 *
 * **Im Cookie steht der Token, in der Datenbank sein Hash.** Wer die
 * Datenbank liest, kann damit keine Sitzung uebernehmen: `token_hash` ist ein
 * SHA-256 und nicht umkehrbar. Der `CHECK` auf der Spalte verlangt genau 64
 * Hex-Zeichen, also faellt ein versehentlich im Klartext geschriebener Token
 * schon an der Tabelle auf.
 */
export const SITZUNG_COOKIE = 'cse_sitzung';

/** Zwoelf Stunden — so lange lebt die Zeile in `benutzer_sitzung` auch. */
export const SITZUNG_MAX_ALTER_SEK = 12 * 60 * 60;

/**
 * Die Attribute des Sitzungskekses — an EINER Stelle.
 *
 * Sie standen dreimal: in der Entwicklungsanmeldung, in der Codeeingabe und
 * in der Abmeldung, und nur die Codeeingabe setzte `secure`. Ein Keks ohne
 * `secure` wird auch ueber `http://` mitgeschickt — auf einem Telefon im
 * Baustellen-WLAN reicht dann ein Netz, das die erste Anfrage unverschluesselt
 * abfaengt, und die Sitzung ist weg. `secure` haengt an `NODE_ENV`, weil
 * `http://localhost` und das Telefon im selben Netz (D-414, `allowedDevOrigins`)
 * sonst gar keinen Keks mehr bekaemen.
 *
 * `sameSite: 'lax'` bleibt: ein fremdes Formular schickt ihn nicht mit, und
 * `ursprung.ts` steht als zweite Linie davor.
 */
export function sitzungsKeksOptionen(
  umgebung: { readonly NODE_ENV?: string | undefined } = process.env,
): {
  httpOnly: true; sameSite: 'lax'; path: '/'; maxAge: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SITZUNG_MAX_ALTER_SEK,
    secure: umgebung.NODE_ENV === 'production',
  };
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Ein Token mit 256 Bit Entropie. Kuerzer ist ratbar, laenger bringt nichts. */
export function neuerToken(): string {
  return randomBytes(32).toString('hex');
}

interface AufloesungZeile {
  benutzer_id: string;
  person_id: string | null;
  aktiver_mandant_id: string | null;
  ansicht: string;
  aal: string;
  portal: string;
  sitzung_id: string;
}

const SCOPES = new Set<Scope>(['mandant', 'gruppe', 'person', 'kunde']);
const PORTALE = new Set<Portal>(['intern', 'mitarbeiter', 'kunde']);

/**
 * Loest einen Cookie-Token in eine Sitzung auf — oder in `null`.
 *
 * `null` heisst: kein gueltiger Token. Nicht "kein Recht" und nicht "Fehler" —
 * der Aufrufer schickt dann zur Anmeldung. Ein Werfen waere hier falsch, weil
 * ein abgelaufenes Cookie der Normalfall ist und kein Zwischenfall.
 */
export async function sitzungAufloesen(
  tx: Transaktion, token: string | undefined,
): Promise<Sitzung | null> {
  if (token === undefined || token === '') return null;
  const zeilen = (await tx.unsafe(
    `select * from app.sitzung_aufloesen($1)`, [tokenHash(token)],
  )) as AufloesungZeile[];
  const z = zeilen[0];
  if (z === undefined) return null;

  /**
   * Die Werte werden gegen die geschlossenen Mengen geprueft, nicht gecastet.
   *
   * Ein unbekanntes `portal` — etwa weil jemand eine Rolle mit einem neuen
   * Portalwert anlegt — waere sonst ein `Portal`, das der Typ zusichert und
   * das die K-04-Decke nicht kennt. Fail closed: lieber keine Sitzung als
   * eine, deren Decke niemand definiert hat.
   */
  const ansicht = z.ansicht as Scope;
  const portal = z.portal as Portal;
  if (!SCOPES.has(ansicht) || !PORTALE.has(portal)) return null;
  if (z.aal !== 'aal1' && z.aal !== 'aal2') return null;

  return {
    benutzerId: z.benutzer_id,
    personId: z.person_id,
    aktiverMandantId: z.aktiver_mandant_id,
    ansicht,
    aal: z.aal,
    portal,
    sitzungId: z.sitzung_id,
  };
}

export class DevAnmeldungAusFehler extends Error {
  constructor() {
    super(
      'Sitzungen lassen sich ohne CSE_DEV_FLAECHEN=1 nicht ausstellen. Die echte '
      + 'Anmeldung (Telefon + SMS) kommt mit PR 20; bis dahin gehört das '
      + 'Ausstellen in kein Deployment.',
    );
    this.name = 'DevAnmeldungAusFehler';
  }
}

export interface DevAnmeldung {
  readonly token: string;
  readonly sitzungId: string;
}

/**
 * Stellt eine Sitzung aus — NUR auf den Entwicklungsflaechen.
 *
 * PR 20 ersetzt genau diese Funktion durch Telefon + Einmalcode. Alles
 * danach — Aufloesen, Binden, Decke, Rechte — bleibt unveraendert, weil es
 * schon jetzt die echten Zeilen benutzt und nicht eine Abkuerzung daneben.
 *
 * `aal2`, weil Rechte mit `erfordert_2fa` sonst still leer blieben und ein
 * Bildschirm ohne Zahlen aussaehe wie ein Modul, das es nicht gibt.
 */
/**
 * Eine Sitzung beenden — der Gegenweg zur Anmeldung.
 *
 * **Es gab ihn nicht.** `sitzung_ende_grund` fuehrt `'abmeldung'` seit 0007,
 * `beendet_am` und `ende_grund` stehen in der Tabelle, und
 * `sitzung_ende_stimmig` haelt beide zusammen — nur schrieb sie niemand. Wer
 * sich angemeldet hatte, blieb es zwoelf Stunden lang, und ein geteilter
 * Rechner trug die fremde Sitzung weiter. Den Keks allein zu loeschen waere
 * keine Abmeldung, sondern ein Verstecken: die Zeile blieb offen, und wer den
 * Token noch hat, ist weiter angemeldet.
 *
 * Nur die EIGENE, noch offene Sitzung: der Aufrufer weist sie durch Besitz des
 * Tokens aus, und `beendet_am is null` macht den zweiten Aufruf wirkungslos
 * statt fehlerhaft.
 */
export async function beendeSitzung(tx: Transaktion, token: string): Promise<void> {
  /**
   * Ueber die Funktion aus `0115`, nicht mit einem eigenen UPDATE.
   *
   * Das direkte UPDATE stand hier und lief nur, solange die Anwendung als
   * Eigentuemer verband. Unter `cse_app` greift `t_sitzung_eigene_schreiben`:
   * `benutzer_id = app.aktueller_benutzer()`. Beim Abmelden ueber
   * `/api/abmelden` ist aber genau kein Benutzer gebunden — der Aufrufer weist
   * sich durch den BESITZ des Tokens aus. Die Anweisung traf dann null Zeilen,
   * meldete keinen Fehler, und die Sitzung blieb offen: eine Abmeldung, die
   * wie eine aussieht und keine ist.
   */
  await tx.unsafe(`select app.sitzung_beenden($1)`, [tokenHash(token)]);
}

/**
 * Die Sitzung nach einer echten Anmeldung mit Telefon und Einmalcode (EMP-01).
 *
 * **Der Gegenentwurf zu `devSitzungAusstellen` unten** — und der Unterschied
 * ist nicht die Herkunft der Person, sondern WER schreibt. Hier schreibt
 * `app.mitarbeiter_sitzung_ausstellen` (0115) unter dem Eigentuemer, weil der
 * Anmeldende noch niemand ist und die Policies auf `benutzer_sitzung` an
 * `app.aktueller_benutzer()` haengen. Dort schreibt die Anwendung selbst, was
 * nur auf einer Entwicklungsadresse als Eigentuemer funktioniert.
 *
 * `null` heisst: zu diesem Menschen gehoert kein benutzbares Konto. Der
 * Aufrufer behandelt das wie einen falschen Code — ein eigener Satz dafuer
 * waere die Auskunft „diese Person gibt es, sie darf nur nicht".
 */
export async function mitarbeiterSitzungAusstellen(
  tx: Transaktion,
  personId: string,
  ip: string | null = null,
  userAgent: string | null = null,
): Promise<{ token: string; sitzungId: string } | null> {
  const token = neuerToken();
  const zeilen = (await tx.unsafe(
    `select app.mitarbeiter_sitzung_ausstellen($1, $2, $3, $4) as sitzung_id`,
    [personId, tokenHash(token), ip, userAgent],
  )) as { sitzung_id: string | null }[];

  const sitzungId = zeilen[0]?.sitzung_id ?? null;
  return sitzungId === null ? null : { token, sitzungId };
}

export async function devSitzungAusstellen(
  tx: Transaktion,
  benutzerId: string,
  mandantId: string | null,
  ansicht: Scope = 'mandant',
): Promise<DevAnmeldung> {
  if (!devFlaechenAn()) throw new DevAnmeldungAusFehler();

  const token = neuerToken();
  // `ansicht = 'mandant'` verlangt laut CHECK einen aktiven Mandanten, jede
  // andere Ansicht verlangt KEINEN. Die Tabelle haelt das fest; hier wird es
  // nur nicht verletzt.
  const gebunden = ansicht === 'mandant' ? mandantId : null;
  /**
   * Zwei Angaben, die einander widersprechen, gehoeren hier abgefangen und
   * nicht an die Datenbank weitergereicht.
   *
   * `sitzung_ansicht_stimmig` (0007) verlangt `(ansicht = 'mandant') =
   * (aktiver_mandant_id is not null)`. Wer beides falsch zusammensetzt,
   * bekam bisher einen rohen `23514` — im Browser „Application error" mit
   * einem Digest, aus dem niemand etwas lesen kann, und im Log eine
   * Fehlerzeile ueber eine Tabelle statt ueber die Ursache. Genau so ist die
   * Gruppen-Administration steckengeblieben: sie ist in keiner Gesellschaft
   * Mitglied, und das Formular schickte trotzdem `mandant`.
   */
  if (ansicht === 'mandant' && gebunden === null) {
    throw new Error(
      'Sitzung mit ansicht="mandant" ohne Mandanten: ein Konto ohne '
      + 'Mitgliedschaft gehoert in die Gruppenansicht ("gruppe").',
    );
  }
  const zeilen = (await tx.unsafe(
    `insert into benutzer_sitzung
       (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am)
     values ($1, $2, $3, $4::sitzung_ansicht, 'aal2', now() + interval '12 hours')
     returning id`,
    [benutzerId, tokenHash(token), gebunden, ansicht],
  )) as { id: string }[];

  return { token, sitzungId: zeilen[0]!.id };
}
