import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { neuerToken, tokenHash } from '../../auth/sitzung.js';
import { anbieter } from '../../auth/kennwort-anmeldung.js';

/**
 * Ein Verwaltungskonto einladen (AUT-04, D-610, 0372).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der schwerste Befund der Mandantenbefragung — und der kleinste Bau.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die einzige Stelle, die in `benutzer` schrieb, war der SEED. Keine
 * Einladungsroute, kein Formular, keine API: ein neuer Admin liess sich nur
 * durch einen erneuten Seed-Lauf einsetzen, auf einer Produktionsdatenbank
 * also gar nicht. Und das Schema erwartete die Einladung die ganze Zeit —
 * `benutzer.status` steht auf `'eingeladen'` (0007), und die
 * Benutzerverwaltung zeigt diesen Zustand als Pille „Wartet", die nichts
 * erzeugen konnte.
 *
 * Gebaut war dagegen die ganze ANNAHMEhaelfte: `kern.kennwort_token` fuehrt
 * den Zweck `einladung` (0155), `/auth/einladung/[token]` leitet auf
 * `/auth/passwort-neu`, und `0249` benutzt exakt diese Kette fuer den
 * Kundenzugang. Diese Datei ist deshalb die Schwester von
 * `services/crm/kundenzugang.ts` — nicht ihr Gegenentwurf.
 *
 * **Der Einladungslink wird EINMAL angezeigt und von Hand uebergeben.**
 * Es ist kein EU-Mailanbieter verbunden (O-501), also wird hier kein Versand
 * vorgetaeuscht (CLAUDE.md „no fake integrations"). Der Klartext entsteht
 * hier, steht genau einmal auf dem Bildschirm, und gespeichert ist nur sein
 * SHA-256. **Nie ueber die Adresse** — ein Token in der URL steht in jedem
 * Zugriffsprotokoll und im Verlauf des Browsers.
 *
 * **Nur der Super-Admin (D-610).** Das Recht
 * `system.verwaltungskonto_erstellen` ist `nur_global`; `app.hat_recht`
 * wertet dafuer nur die globale Rolle aus (0169), sodass auch ein Admin in
 * seiner eigenen Gesellschaft `false` bekommt. Die Trennlinie aus D-610: was
 * bei Missbrauch die GRUPPE trifft, gehoert nach oben.
 */

/** Der kurzlebige Keks, in dem die Route den Klartext an die Seite reicht. */
export const EINLADUNG_COOKIE = 'cse_verwaltungseinladung';

/** Die Rollen, die ueber diesen Weg vergeben werden — eng, mit Absicht. */
export const EINLADBARE_ROLLEN = ['admin', 'leitung'] as const;
export type EinladbareRolle = (typeof EINLADBARE_ROLLEN)[number];

export function istEinladbareRolle(wert: string): wert is EinladbareRolle {
  return (EINLADBARE_ROLLEN as readonly string[]).includes(wert);
}

/**
 * Warum eine Einladung nicht ausgestellt wurde — als SCHLÜSSEL (D-769, D-774).
 *
 * `app.verwaltungskonto_einladen` (0372) gibt bei einer Abweisung einen
 * deutschen SATZ als `grund` zurück. Der reiste bis D-774 als `?meldung=` auf
 * die Seite und stand dort roh — deutsch auch unter englischer Sitzung, mit
 * den Backticks und den Umschreibungen der Migration („gueltige",
 * „Aendern"). Hier wird er EINMAL auf einen Schlüssel abgebildet; die Seite
 * hat den Satz in ihrer Sprache. Ein Satz, den diese Liste nicht kennt, wird
 * `nicht_ausgestellt` — der allgemeine Satz, nie der Text der Datenbank
 * (D-769 Nr. 8).
 */
export type EinladungGrund =
  | 'gesellschaft_fehlt' | 'email_ungueltig' | 'name_fehlt' | 'rolle_unzulaessig'
  | 'kundenkonto' | 'schon_eingetragen' | 'nicht_ausgestellt';

/** Warum der Vorgang gar nicht erst in die Datenbank kam oder dort abgewiesen wurde. */
export type EinladungFehlerGrund = 'anbieter_fremd' | 'nicht_erlaubt';

export class EinladungFehler extends Error {
  constructor(
    nachricht: string, readonly grund: EinladungFehlerGrund, readonly status = 400,
    optionen?: ErrorOptions,
  ) {
    super(nachricht, optionen);
    this.name = 'EinladungFehler';
  }
}

/**
 * Die Sätze aus 0372, Wort für Wort, wie die Datenbank sie liefert (die
 * Literale der Migration sind aneinandergefügt). `tests/isolation/
 * verwaltungskonto-einladung.test.ts` fragt die echte Funktion und hält fest,
 * dass jeder erreichbare Satz hier seinen Schlüssel findet.
 */
const DATENBANK_GRUENDE: ReadonlyMap<string, EinladungGrund> = new Map([
  ['Diese Gesellschaft gibt es nicht.', 'gesellschaft_fehlt'],
  ['Ohne gueltige E-Mail-Adresse gibt es kein Konto.', 'email_ungueltig'],
  ['Ein Konto braucht einen Namen — er steht in jeder Freigabe und in jedem '
    + 'Protokolleintrag.', 'name_fehlt'],
  ['Ueber diesen Weg werden nur `admin` und `leitung` eingeladen. Mitarbeiter- und '
    + 'Kundenzugaenge haben eigene Wege; ein Super-Admin entsteht nur ueber die Umgebung '
    + '(D-617).', 'rolle_unzulaessig'],
  ['Diese Adresse gehoert einem Kundenkonto. Ein Verwaltungszugang dafuer wuerde die '
    + 'Trennung der Portale aufheben (K-04).', 'kundenkonto'],
  ['Dieses Konto ist in dieser Gesellschaft schon eingetragen. Aendern Sie seine Rolle, '
    + 'statt es erneut einzuladen.', 'schon_eingetragen'],
]);

/** Der Schlüssel zu einem Satz der Datenbank — ein unbekannter wird `nicht_ausgestellt`. */
export function einladungsGrund(satz: string): EinladungGrund {
  return DATENBANK_GRUENDE.get(satz) ?? 'nicht_ausgestellt';
}

export type EinladungErgebnis =
  | {
    readonly ok: true;
    readonly grund: 'eingeladen';
    /** Der Klartext — genau einmal. */
    readonly token: string;
    readonly kontoId: string | null;
    readonly neuesKonto: boolean;
  }
  | {
    readonly ok: false;
    readonly grund: EinladungGrund;
    readonly token: null;
    readonly kontoId: string | null;
    readonly neuesKonto: boolean;
  };

/**
 * Dieselbe Sperre wie beim Kundenzugang: solange Supabase Auth nicht
 * angeschlossen ist, IST der hausinterne Weg der richtige — danach gehoert
 * das Anlegen in die Admin-API, und ein `insert` in `auth.users` erzeugte ein
 * Konto, mit dem sich niemand anmelden kann.
 */
function pruefeAnbieter(): void {
  if (anbieter() !== 'demo') {
    throw new EinladungFehler(
      'Supabase Auth ist als Anbieter aktiv. Ein Konto entsteht dort über die '
      + 'Admin-API und nicht in dieser Datenbank — ein hier angelegtes Konto könnte '
      + 'sich nicht anmelden. Der Weg dafür ist nicht gebaut (O-501, O-662).',
      'anbieter_fremd', 501);
  }
}

/** Was `app.verwaltungskonto_einladen` zurückgibt. */
interface EinladungZeile {
  readonly ok: boolean;
  readonly grund: string;
  readonly konto_id: string | null;
  readonly neues_konto: boolean;
}

/**
 * Konto, Mitgliedschaft und Einladungstoken in EINEM Vorgang.
 *
 * Alles Weitere steckt in `app.verwaltungskonto_einladen` (0372): Recht,
 * zweiter Faktor, Portaltrennung, Rollenwahl, Token, Protokoll. Diese
 * Funktion bildet den Klartext und gibt ihn zurueck.
 *
 * **`42501` wird `nicht_erlaubt`** — wie bei den Kontohandlungen
 * (`konto/verwaltung.ts`): die Definer-Funktion sagt „darf nicht" und nennt im
 * Satz, WELCHE Bedingung fehlte (Portal, Gruppenansicht, Recht, zweiter
 * Faktor). Die Route hat Recht und Faktor vorher schon geprüft; was danach
 * noch abweist, bekommt einen Satz ohne diese Auskunft (AUT-06). Der Satz der
 * Datenbank bleibt als `cause` am Fehler — fürs Protokoll, nie für den Schirm.
 * Jeder andere Datenbankfehler bleibt ein Fehler.
 */
export async function ladeVerwaltungskontoEin(
  kontext: SchreibKontext,
  eingabe: {
    readonly mandantId: string;
    readonly email: string;
    readonly name: string;
    readonly rolle: EinladbareRolle;
  },
): Promise<EinladungErgebnis> {
  pruefeAnbieter();
  const token = neuerToken();
  let zeilen: readonly EinladungZeile[];
  try {
    zeilen = await kontext.schreibe<EinladungZeile>(
      `select ok, grund, konto_id, neues_konto
         from app.verwaltungskonto_einladen($1::uuid, $2, $3, $4, $5)`,
      [eingabe.mandantId, eingabe.email, eingabe.name, eingabe.rolle, tokenHash(token)]);
  } catch (fehler: unknown) {
    if ((fehler as { code?: unknown }).code === '42501') {
      throw new EinladungFehler(
        'Die Datenbank hat die Einladung abgewiesen.', 'nicht_erlaubt', 403, { cause: fehler });
    }
    throw fehler;
  }

  const z = zeilen[0];
  if (z === undefined) {
    return { ok: false, grund: 'nicht_ausgestellt', token: null, kontoId: null, neuesKonto: false };
  }
  if (z.ok) {
    return { ok: true, grund: 'eingeladen', token, kontoId: z.konto_id, neuesKonto: z.neues_konto };
  }
  return {
    ok: false, grund: einladungsGrund(z.grund), token: null,
    kontoId: z.konto_id, neuesKonto: z.neues_konto,
  };
}
