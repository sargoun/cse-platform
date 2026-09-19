/**
 * Der Leistungsnachweis, wie die Kraft auf der Schicht ihn sieht (CLN-04,
 * EMP-13, K-05).
 *
 * **Warum eine eigene Leseform.** `listeNachweise` und `findeNachweis` in
 * `reinigung/leistungsnachweis.ts` verbinden den Kopf mit `kunde` als INNER
 * JOIN — der Kundenname steht im Dokument. Im Personen-Scope ist `kunde` fuer
 * die Kraft nicht lesbar (`t_mandant` verlangt `crm.lesen`), und der INNER JOIN
 * macht daraus nicht „ohne Namen", sondern NULL ZEILEN: die Liste waere leer,
 * ohne Fehler und ohne Meldung.
 *
 * Fuer das Unterschriftsblatt selbst holt `findeNachweis` den Namen ueber
 * `app.leistungsnachweis_kopf_schicht` (0304) — er steht im Abzug, den der
 * Kunde unterschreibt. Fuer die LISTE auf der Schicht braucht ihn niemand:
 * dort geht es um „habe ich den Nachweis schon vorgelegt", und das beantwortet
 * der Zustand.
 *
 * **Kein Preis.** `einzelpreis_cent` wird hier nicht gelesen und nicht gezeigt
 * (EMP-13, K-05) — und bei der Erfassung bleibt er NULL, weil offen ist, ob
 * eine Position bei Monatspauschale ueberhaupt einen Einzelpreis je Durchgang
 * traegt.
 *
 * // TODO(client, O-348): Traegt eine Position des Leistungsnachweises bei Monatspauschale einen Einzelpreis je Durchgang, oder bleibt er leer und die Rechnung stellt die Pauschale?
 */
import type { LeseKontext } from '../../kontext/index.js';

export interface SchichtNachweis {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly objektId: string | null;
  readonly von: string;
  readonly bis: string;
  readonly vorgelegtLokal: string | null;
  readonly gesperrtLokal: string | null;
  readonly storniert: boolean;
  /** Wie viele Positionen — die Zahl, an der ein leeres Blatt auffaellt. */
  readonly positionen: number;
  /** Welche Unterschriften schon vorliegen (`auftraggeber`, `auftragnehmer`). */
  readonly unterschriften: readonly string[];
}

export const SCHICHT_NACHWEIS_FELDER = [
  'id', 'nummer', 'status', 'objektId', 'von', 'bis', 'vorgelegtLokal',
  'gesperrtLokal', 'storniert', 'positionen', 'unterschriften',
] as const;

interface RohNachweis {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly objekt_id: string | null;
  readonly von: string;
  readonly bis: string;
  readonly vorgelegt_lokal: string | null;
  readonly gesperrt_lokal: string | null;
  readonly storniert: boolean;
  readonly positionen: number;
  readonly unterschriften: readonly string[] | null;
}

/**
 * Die Nachweise DIESES Objekts, die den Zeitraum dieser Schicht beruehren.
 *
 * Gefiltert wird auf UEBERSCHNEIDUNG und nicht auf Gleichheit: ein
 * Monatsnachweis deckt den Tag der Schicht mit ab, und wer nur auf
 * `von = bis = Schichttag` filtert, legt daneben einen zweiten an.
 *
 * Die Ortszeiten kommen fertig aus der Datenbank (Invariante 2).
 */
export async function listeSchichtNachweise(
  kontext: LeseKontext,
  bezug: { readonly objektId: string; readonly von: string; readonly bis: string },
): Promise<readonly SchichtNachweis[]> {
  const zeilen = await kontext.abfrage<RohNachweis>(
    `select l.id, l.nummer, l.status::text as status, l.objekt_id,
            to_char(l.leistungszeitraum_von, 'YYYY-MM-DD') as von,
            to_char(l.leistungszeitraum_bis, 'YYYY-MM-DD') as bis,
            to_char(l.vorgelegt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as vorgelegt_lokal,
            to_char(l.gesperrt_am  at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as gesperrt_lokal,
            (l.storniert_am is not null) as storniert,
            (select count(*) from leistungsnachweis_position p
              where p.leistungsnachweis_id = l.id)::int as positionen,
            (select array_agg(s.rolle::text order by s.rolle)
               from leistungsnachweis_signatur s
              where s.leistungsnachweis_id = l.id) as unterschriften
       from leistungsnachweis l
      where l.objekt_id = $1::uuid
        and l.leistungszeitraum_von <= $3::date
        and l.leistungszeitraum_bis >= $2::date
      order by l.leistungszeitraum_bis desc, l.erstellt_am desc
      limit 20`,
    [bezug.objektId, bezug.von, bezug.bis],
  );
  return zeilen.map((z) => ({
    id: z.id,
    nummer: z.nummer,
    status: z.status,
    objektId: z.objekt_id,
    von: z.von,
    bis: z.bis,
    vorgelegtLokal: z.vorgelegt_lokal,
    gesperrtLokal: z.gesperrt_lokal,
    storniert: z.storniert,
    positionen: Number(z.positionen),
    unterschriften: z.unterschriften ?? [],
  }));
}
