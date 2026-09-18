import 'server-only';
import type { LeseKontext } from '@/server/kontext/index';
import { cent, type Cent } from '@/server/services/finanz/geld';
import type { Risiko, VorgangTyp } from '@/server/services/freigabe/posteingang';
import type { FreigabeStatus } from '@/server/services/freigabe/laden';

/**
 * Der Kopf einer Freigabe für die zwei Fensterseiten — **ohne den Vermerk
 * „geöffnet"** (APR-05, APR-06, APR-08, K-13).
 *
 * **Warum nicht `oeffneFreigabe()`.** Das ist der eine Weg, eine Freigabe zu
 * PRÜFEN: es schreibt die `freigabe_ansicht`-Zeile mit
 * `geoeffnet_am_server`, und auf ihr misst APR-08 die Prüfdauer — der
 * Bericht, der Durchwinken aufdecken soll. Ein Einspruchsblatt, das als
 * Prüfvorgang zählt, verfälscht genau diesen Bericht: die Verteilung bekäme
 * Öffnungen dazu, die keine Prüfung waren, und die Zahl „so lange sieht
 * jemand eine Freigabe an" wäre danach kleiner, ohne dass sich das Verhalten
 * geändert hätte. Diese Seiten entscheiden nichts — sie halten eine gefallene
 * Entscheidung an oder drehen ihre Ausführung zurück.
 *
 * **Und auch nicht `ladeFreigabe()`.** Die Fensterseiten brauchen keinen
 * Diff, keine Feldnachweise und keinen Schnappschuss; drei Abfragen für vier
 * angezeigte Werte sind kein Gewinn. Was sie brauchen, ist der Kopf — und die
 * Antwort auf die Frage, ob diese Sitzung das Recht hält, das die ZEILE
 * fordert.
 */

export interface FensterKopf {
  readonly id: string;
  readonly titel: string | null;
  readonly zusammenfassung: string | null;
  readonly vorgangTyp: VorgangTyp | null;
  readonly aktion: string;
  readonly status: FreigabeStatus;
  readonly ausfuehrungStatus: string;
  /** APR-05: `verzoegerte_freigabe_bis` — nicht `verzoegert_bis`. */
  readonly verzoegertBis: Date | null;
  /** APR-06: `undo_bis`. */
  readonly undoBis: Date | null;
  readonly risiko: Risiko | null;
  readonly betragCent: Cent | null;
  readonly frist: Date | null;
  readonly freigegebenVonName: string | null;
  readonly freigegebenAm: Date | null;
  readonly begruendung: string | null;
  readonly stapelFaehig: boolean;
  /**
   * Das Recht, das DIESE Zeile fordert — `null` heisst: die Vorgabe
   * `freigabe.entscheiden`. Es steht hier, weil
   * `app.freigabe_einspruch`/`app.freigabe_ruecknahme` es zusätzlich zur
   * eigenen Befugnis prüfen.
   */
  readonly erforderlichesRecht: string | null;
  /**
   * Hält diese Sitzung dieses Recht? In DERSELBEN Transaktion gefragt wie
   * die Zeile gelesen wurde — zwei Transaktionen könnten eine Rechteänderung
   * dazwischen erwischen und einen Knopf zeigen, den die Datenbank abweist.
   */
  readonly haeltZeilenrecht: boolean;
}

interface Roh {
  readonly id: string;
  readonly titel: string | null;
  readonly zusammenfassung: string | null;
  readonly vorgang_typ: string | null;
  readonly aktion: string;
  readonly status: string;
  readonly ausfuehrung_status: string;
  readonly verzoegerte_freigabe_bis: Date | null;
  readonly undo_bis: Date | null;
  readonly risiko: string | null;
  readonly betrag_cent: string | null;
  readonly frist: Date | null;
  readonly freigegeben_von_name: string | null;
  readonly freigegeben_am: Date | null;
  readonly begruendung: string | null;
  readonly stapel_faehig: boolean;
  readonly erforderliches_recht: string | null;
  readonly haelt_zeilenrecht: boolean;
}

/**
 * `null` heisst „gibt es nicht ODER darf diese Sitzung nicht sehen" — nach
 * aussen dasselbe (AUT-06). `t_mandant` auf `freigabe` verlangt
 * `freigabe.lesen`; die beiden Routen sind auf `freigabe.einspruch_erheben`
 * bzw. `freigabe.rueckgaengig` bewacht, und das sind andere Rechte. Wer nur
 * sie hält, bekommt hier `null` — und die Seite antwortet mit 404 statt mit
 * einer leeren Maske, die aussieht, als wäre die Freigabe verschwunden.
 */
export async function leseFensterKopf(
  kontext: LeseKontext, id: string,
): Promise<FensterKopf | null> {
  const [z] = await kontext.abfrage<Roh>(
    `select f.id, f.titel, f.zusammenfassung, f.vorgang_typ::text as vorgang_typ, f.aktion,
            f.status::text as status, f.ausfuehrung_status::text as ausfuehrung_status,
            f.verzoegerte_freigabe_bis, f.undo_bis, f.risiko::text as risiko,
            f.betrag_cent::text as betrag_cent, f.frist,
            b.name as freigegeben_von_name, f.freigegeben_am, f.begruendung,
            f.stapel_faehig, f.erforderliches_recht,
            app.hat_recht(coalesce(f.erforderliches_recht, 'freigabe.entscheiden'),
                          app.aktiver_mandant()) as haelt_zeilenrecht
       from freigabe f
       left join benutzer b on b.id = f.freigegeben_von
      where f.id = $1::uuid`,
    [id]);
  if (z === undefined) return null;
  return {
    id: z.id,
    titel: z.titel,
    zusammenfassung: z.zusammenfassung,
    vorgangTyp: z.vorgang_typ as VorgangTyp | null,
    aktion: z.aktion,
    status: z.status as FreigabeStatus,
    ausfuehrungStatus: z.ausfuehrung_status,
    verzoegertBis: z.verzoegerte_freigabe_bis,
    undoBis: z.undo_bis,
    risiko: z.risiko as Risiko | null,
    betragCent: z.betrag_cent === null ? null : cent(BigInt(z.betrag_cent)),
    frist: z.frist,
    freigegebenVonName: z.freigegeben_von_name,
    freigegebenAm: z.freigegeben_am,
    begruendung: z.begruendung,
    stapelFaehig: z.stapel_faehig,
    erforderlichesRecht: z.erforderliches_recht,
    haeltZeilenrecht: z.haelt_zeilenrecht === true,
  };
}
