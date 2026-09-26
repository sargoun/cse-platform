import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { CODE_GUELTIG_MINUTEN, codeHash, neuerCode } from '../../auth/mitarbeiter-anmeldung.js';

/**
 * Der Anmeldecode aus der Hand der Einsatzleitung (EMP-01, O-82, D-487).
 *
 * Solange kein SMS-Gateway verbunden ist, kommt bei einer Mitarbeiterin
 * kein Code an — und die Plattform taeuscht keinen Versand vor. Was es im
 * Betrieb ohnehin gibt, wird hier zum Weg: die Einsatzleitung nennt den
 * Code persoenlich. Derselbe Einmalcode wie per SMS, dieselbe Frist,
 * dieselbe Bremse; die Nummer bleibt in der Datenbank, zurueck kommen nur
 * die letzten drei Ziffern. Der Klartext entsteht hier, wird einmal gezeigt
 * und nirgends gespeichert — gespeichert ist sein Hash.
 */
/** Der kurzlebige Keks, in dem die Route den Klartext an die Zugangsseite reicht. */
export const ZUGANGSCODE_COOKIE = 'cse_zugangscode';

export type ZugangscodeGrund = 'keine_anstellung' | 'kein_zugang' | 'gesperrt' | 'bremse';

export type Zugangscode =
  | { readonly ok: true; readonly code: string; readonly gueltigMinuten: number; readonly telefonMaskiert: string | null }
  | { readonly ok: false; readonly grund: ZugangscodeGrund; readonly telefonMaskiert: string | null };

export const GRUND_TEXT: Readonly<Record<ZugangscodeGrund, string>> = {
  keine_anstellung: 'Diese Person ist in dieser Gesellschaft nicht beschäftigt.',
  kein_zugang: 'Für diese Person ist keine Mobilnummer als Zugang hinterlegt — ohne Nummer gibt es keinen Code.',
  gesperrt: 'Der Zugang dieser Person ist gesperrt.',
  bremse: 'Es sind schon drei Codes offen. Warten Sie, bis einer abgelaufen ist (zehn Minuten), oder lösen Sie einen ein.',
};

export async function stelleZugangscodeAus(
  kontext: SchreibKontext, personId: string,
): Promise<Zugangscode> {
  const code = neuerCode();
  const [z] = await kontext.schreibe<{ ok: boolean; grund: string; telefon_maskiert: string | null }>(
    `select ok, grund, telefon_maskiert
       from app.zugang_code_ausstellen($1::uuid, $2, now() + ($3 || ' minutes')::interval)`,
    [personId, codeHash(code), String(CODE_GUELTIG_MINUTEN)]);
  if (z === undefined) return { ok: false, grund: 'kein_zugang', telefonMaskiert: null };
  if (z.ok) return { ok: true, code, gueltigMinuten: CODE_GUELTIG_MINUTEN, telefonMaskiert: z.telefon_maskiert };
  const grund = (['keine_anstellung', 'kein_zugang', 'gesperrt', 'bremse'] as const)
    .find((g) => g === z.grund) ?? 'kein_zugang';
  return { ok: false, grund, telefonMaskiert: z.telefon_maskiert };
}

/**
 * Der Zugangsstand einer Person — damit „es passiert nichts" einen Namen
 * bekommt (D-488).
 *
 * Drei Zustaende fuehren am Telefon zum selben Bild, und keiner stand
 * irgendwo: kein Zugang (keine Nummer), kein benutzbares Konto (der Code
 * wird eingeloest, die Sitzung bleibt aus — 0115), drei offene Codes (die
 * Bremse haelt). Die Einsatzleitung liest sie jetzt ab, statt zu raten.
 */
export interface Zugangsstand {
  readonly hatAnstellung: boolean;
  readonly hatZugang: boolean;
  readonly gesperrt: boolean;
  /**
   * Seit wann und WARUM (0384).
   *
   * `gesperrt` allein war vollstaendig, solange sich kein Zugang sperren
   * liess — gesperrt wurde nichts. Seit es den Weg gibt (V-014), ist
   * „gesperrt: ja" ohne den Grund genau die Auskunft, die den Anruf erzeugt,
   * den diese Seite ersparen soll.
   */
  readonly gesperrtAm: Date | null;
  readonly sperrgrund: string | null;
  readonly telefonMaskiert: string | null;
  /** Ein Konto, mit dem die Anmeldung auch wirklich durchkommt (0115). */
  readonly hatKonto: boolean;
  readonly offeneCodes: number;
  readonly letzteAnmeldung: Date | null;
}

export async function leseZugangsstand(
  kontext: LeseKontext, personId: string,
): Promise<Zugangsstand> {
  const [z] = await kontext.abfrage<{
    hat_anstellung: boolean; hat_zugang: boolean; gesperrt: boolean;
    gesperrt_am: Date | null; sperrgrund: string | null;
    telefon_maskiert: string | null; hat_konto: boolean; offene_codes: number;
    letzte_anmeldung: Date | null;
  }>(`select hat_anstellung, hat_zugang, gesperrt, gesperrt_am, sperrgrund,
             telefon_maskiert, hat_konto, offene_codes, letzte_anmeldung
        from app.zugang_stand($1::uuid)`, [personId]);
  return {
    hatAnstellung: z?.hat_anstellung ?? false,
    hatZugang: z?.hat_zugang ?? false,
    gesperrt: z?.gesperrt ?? false,
    gesperrtAm: z?.gesperrt_am ?? null,
    sperrgrund: z?.sperrgrund ?? null,
    telefonMaskiert: z?.telefon_maskiert ?? null,
    hatKonto: z?.hat_konto ?? false,
    offeneCodes: z?.offene_codes ?? 0,
    letzteAnmeldung: z?.letzte_anmeldung ?? null,
  };
}
