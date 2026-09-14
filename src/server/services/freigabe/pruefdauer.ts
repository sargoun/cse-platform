import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import type { Risiko } from './posteingang.js';

/**
 * Die Verteilung der Prüfdauer (APR-08, §4.9).
 *
 * **Die Zahlen kommen aus einer Definer-Funktion, nicht aus einem `select`.**
 * `freigabe_snapshot.pruefdauer_sek` ist `cse_app` entzogen (K-05, § 87 Abs. 1
 * Nr. 6 BetrVG): ein `grant` gälte jeder Sitzung, denn sie sind alle
 * `cse_app`. `app.freigabe_pruefdauer_verteilung()` prüft das Recht erneut
 * und gibt ohne es KEINE Zeilen zurück — nicht eine Ausnahme, denn eine
 * Ausnahme wäre selbst die Auskunft.
 *
 * **Und sie kennt keine Person.** Die Gruppierung ist die Zeitspanne, nicht
 * der Mensch; es gibt keinen Parameter, mit dem sich das ändern liesse. Die
 * personenbezogene Auswertung, die APR-08 darüber hinaus nennt, bleibt bis
 * zur Antwort auf O-06 aus.
 */

export interface VerteilungsZeile {
  readonly eimer: string;
  readonly anzahl: number;
  readonly davonStapel: number;
}

/** Von schnell nach langsam — „unbekannt" steht am Ende, nicht im Verlauf. */
export const EIMER_REIHENFOLGE: readonly string[] = [
  'unter_3s', 'unter_10s', 'unter_60s', 'ab_60s', 'unbekannt',
];

export const EIMER_TEXT: Readonly<Record<string, string>> = {
  unter_3s: 'unter 3 Sekunden',
  unter_10s: '3 bis 10 Sekunden',
  unter_60s: '10 bis 60 Sekunden',
  ab_60s: 'ab einer Minute',
  unbekannt: 'nicht gemessen',
};

interface Roh { eimer: string; anzahl: string; davon_stapel: string }

export async function ladeVerteilung(kontext: LeseKontext): Promise<readonly VerteilungsZeile[]> {
  const zeilen = await kontext.abfrage<Roh>(
    `select eimer, anzahl::text as anzahl, davon_stapel::text as davon_stapel
       from app.freigabe_pruefdauer_verteilung()`);
  return zeilen.map((z) => ({
    eimer: z.eimer, anzahl: Number(z.anzahl), davonStapel: Number(z.davon_stapel),
  }));
}

/**
 * Was gerade in einem Fenster steht (APR-05, APR-06) — die Liste hinter
 * `/portal/[mandant]/freigaben/laufend`.
 *
 * **Warum das eine eigene Seite ist und nicht ein Abschnitt im Posteingang.**
 * Der Posteingang zeigt, was auf eine ENTSCHEIDUNG wartet. Diese hier sind
 * entschieden — sie warten auf die Uhr. Beides in eine Liste zu werfen hiesse,
 * die Frage „was muss ich heute noch ansehen" mit „was geht gleich hinaus" zu
 * vermischen; die zweite Frage stellt sich seltener und dringender.
 */
export interface LaufendeZeile {
  readonly id: string;
  readonly titel: string | null;
  readonly art: 'einspruch' | 'ruecknahme';
  readonly laeuftBis: Date;
  readonly risiko: Risiko;
}

export async function ladeLaufende(kontext: LeseKontext): Promise<readonly LaufendeZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; titel: string | null; art: string; laeuft_bis: Date; risiko: string;
  }>(
    `select id, titel, 'einspruch' as art, verzoegerte_freigabe_bis as laeuft_bis,
            risiko::text as risiko
       from freigabe
      where verzoegerte_freigabe_bis is not null and verzoegerte_freigabe_bis > now()
     union all
     select id, titel, 'ruecknahme' as art, undo_bis as laeuft_bis, risiko::text as risiko
       from freigabe
      where undo_bis is not null and undo_bis > now()
      order by laeuft_bis`);
  return zeilen.map((z) => ({
    id: z.id, titel: z.titel,
    art: z.art === 'ruecknahme' ? 'ruecknahme' : 'einspruch',
    laeuftBis: z.laeuft_bis, risiko: z.risiko as Risiko,
  }));
}

/**
 * Die Geschichte: was entschieden wurde, mit dem Beweis daneben (APR-07,
 * SEC-A9, LEG-01).
 *
 * **Der Schnappschuss ist der Punkt, nicht die Zeile.** Eine Liste
 * entschiedener Freigaben ohne ihre Kettennummer und ihren Hash wäre ein
 * Protokoll, dem man glauben muss. Mit beidem ist sie nachprüfbar: dieselbe
 * Formel, dieselben Bytes, dasselbe Ergebnis — `tests/kern/freigabe-kette`
 * rechnet es nach.
 */
export interface ErledigtZeile {
  readonly id: string;
  readonly titel: string | null;
  readonly status: string;
  readonly entschiedenAm: Date | null;
  readonly entschiedenVon: string | null;
  readonly ketteNr: string | null;
  readonly hash: string | null;
  readonly ausfuehrungStatus: string;
}

export async function ladeErledigte(
  kontext: LeseKontext, grenze = 200,
): Promise<readonly ErledigtZeile[]> {
  return kontext.abfrage<ErledigtZeile>(
    `select f.id, f.titel, f.status::text as status,
            f.freigegeben_am as "entschiedenAm", b.name as "entschiedenVon",
            s.kette_nr::text as "ketteNr", s.hash,
            f.ausfuehrung_status::text as "ausfuehrungStatus"
       from freigabe f
       left join benutzer b on b.id = f.freigegeben_von
       left join freigabe_snapshot s on s.freigabe_id = f.id
      where f.status <> 'offen'
      order by f.freigegeben_am desc nulls last, f.erstellt_am desc
      limit $1`, [grenze]);
}
