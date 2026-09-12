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
  await tx.unsafe(
    `update benutzer_sitzung
        set beendet_am = now(), ende_grund = 'abmeldung'
      where token_hash = $1 and beendet_am is null`,
    [tokenHash(token)],
  );
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
