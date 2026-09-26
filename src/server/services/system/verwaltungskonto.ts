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

export class EinladungFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'EinladungFehler';
  }
}

export interface EinladungErgebnis {
  readonly ok: boolean;
  readonly grund: string;
  /** Der Klartext — genau einmal, nur bei `ok`. */
  readonly token: string | null;
  readonly kontoId: string | null;
  readonly neuesKonto: boolean;
}

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

/**
 * Konto, Mitgliedschaft und Einladungstoken in EINEM Vorgang.
 *
 * Alles Weitere steckt in `app.verwaltungskonto_einladen` (0372): Recht,
 * zweiter Faktor, Portaltrennung, Rollenwahl, Token, Protokoll. Diese
 * Funktion bildet den Klartext und gibt ihn zurueck.
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
  const [z] = await kontext.schreibe<{
    ok: boolean; grund: string; konto_id: string | null; neues_konto: boolean;
  }>(
    `select ok, grund, konto_id, neues_konto
       from app.verwaltungskonto_einladen($1::uuid, $2, $3, $4, $5)`,
    [eingabe.mandantId, eingabe.email, eingabe.name, eingabe.rolle, tokenHash(token)]);

  if (z === undefined) {
    return {
      ok: false, token: null, kontoId: null, neuesKonto: false,
      grund: 'Die Einladung wurde nicht ausgestellt.',
    };
  }
  return {
    ok: z.ok,
    grund: z.grund,
    token: z.ok ? token : null,
    kontoId: z.konto_id,
    neuesKonto: z.neues_konto,
  };
}
