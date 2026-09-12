import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withTenant, type LeseKontext, type Sitzung } from '@/server/kontext/index';

/**
 * Die Daten des Reinigungsbereichs (CLN-01, CLN-04).
 *
 * **Jede Zahl und jede Zeit kommt fertig aus der Datenbank.** Minuten als
 * `numeric`-Text (nie als `number` — `12.34` durch einen Double geschickt und
 * wieder ausgegeben ist der Weg, auf dem aus einer Sollzeit eine andere wird),
 * Zeitpunkte als Berliner Ortszeit aus `at time zone`. Der Node-Prozess
 * rechnet weder das eine noch das andere um (Invariante 2, K-16).
 */

/** Ein Revier in der Liste, mit der Zahl, die es zusammenhält. */
export interface RevierZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly objektId: string;
  readonly objekt: string;
  /**
   * Die BERECHNETE Zielzeit je Durchgang, `numeric(8,2)` als Text — die eine
   * Abweichung, die K-16(c) erlaubt. Jede GEMESSENE Dauer der Plattform ist
   * `integer`, und die Oberfläche sagt an jeder Stelle, welches von beidem
   * sie zeigt.
   */
  readonly sollzeitMinuten: string;
  /** Σ über `revier_raum` — muss gleich `sollzeitMinuten` sein. */
  readonly summeRaeume: string | null;
  readonly anzahlRaeume: number;
  readonly aktivAb: string;
  readonly aktivBis: string | null;
}

interface RevierDbZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly kurzzeichen: string | null;
  readonly objekt_id: string;
  readonly objekt: string;
  readonly sollzeit: string;
  readonly summe: string | null;
  readonly anzahl: string;
  readonly aktiv_ab: string;
  readonly aktiv_bis: string | null;
}

const REVIER_ABFRAGE = `
  select r.id, r.bezeichnung, r.kurzzeichen,
         r.objekt_id, o.bezeichnung as objekt,
         r.sollzeit_minuten::text as sollzeit,
         (select sum(rr.sollzeit_minuten)::text from revier_raum rr
           where rr.revier_id = r.id) as summe,
         (select count(*)::text from revier_raum rr where rr.revier_id = r.id) as anzahl,
         to_char(r.aktiv_ab, 'DD.MM.YYYY') as aktiv_ab,
         to_char(r.aktiv_bis, 'DD.MM.YYYY') as aktiv_bis
    from revier r
    join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
   where r.archiviert_am is null`;

function alsRevier(z: RevierDbZeile): RevierZeile {
  return {
    id: z.id,
    bezeichnung: z.bezeichnung,
    kurzzeichen: z.kurzzeichen,
    objektId: z.objekt_id,
    objekt: z.objekt,
    sollzeitMinuten: z.sollzeit,
    summeRaeume: z.summe,
    anzahlRaeume: Number(z.anzahl),
    aktivAb: z.aktiv_ab,
    aktivBis: z.aktiv_bis,
  };
}

/** Der Lesepfad — eine Transaktion, gebunden an die Sitzung (K-02). */
export async function mitLesekontext<T>(
  sitzung: Sitzung, fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  return db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, fn)) as Promise<T>;
}

export async function ladeReviere(kontext: LeseKontext): Promise<readonly RevierZeile[]> {
  const zeilen = await kontext.abfrage<RevierDbZeile>(
    `${REVIER_ABFRAGE} order by o.bezeichnung, r.sortierung, r.bezeichnung limit 300`,
  );
  return zeilen.map(alsRevier);
}

export async function findeRevier(
  kontext: LeseKontext, id: string,
): Promise<RevierZeile | null> {
  const [z] = await kontext.abfrage<RevierDbZeile>(
    `${REVIER_ABFRAGE} and r.id = $1::uuid`, [id],
  );
  return z === undefined ? null : alsRevier(z);
}

/** Ein Raum in der Zone, mit seinem Anteil an der Sollzeit. */
export interface RevierRaumZeile {
  readonly raumId: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly flaecheQm: string | null;
  readonly leistungswert: string | null;
  readonly sollzeitMinuten: string | null;
  readonly reihenfolge: number;
}

export async function ladeZugeordneteRaeume(
  kontext: LeseKontext, revierId: string,
): Promise<readonly RevierRaumZeile[]> {
  const zeilen = await kontext.abfrage<{
    raum_id: string; raumnummer: string | null; bezeichnung: string | null;
    etage: string | null; flaeche: string | null; lw: string | null;
    sollzeit: string | null; reihenfolge: number;
  }>(
    `select rr.raum_id, r.raumnummer, r.bezeichnung, r.etage,
            rr.flaeche_qm::text as flaeche,
            rr.leistungswert_qm_pro_stunde::text as lw,
            rr.sollzeit_minuten::text as sollzeit,
            rr.reihenfolge
       from revier_raum rr
       join raum r on r.id = rr.raum_id and r.mandant_id = rr.mandant_id
      where rr.revier_id = $1::uuid
      order by rr.reihenfolge`,
    [revierId],
  );
  return zeilen.map((z) => ({
    raumId: z.raum_id,
    raumnummer: z.raumnummer,
    bezeichnung: z.bezeichnung,
    etage: z.etage,
    flaecheQm: z.flaeche,
    leistungswert: z.lw,
    sollzeitMinuten: z.sollzeit,
    reihenfolge: z.reihenfolge,
  }));
}

export interface AuswahlRaum {
  readonly id: string;
  readonly nummer: string | null;
  readonly bezeichnung: string | null;
  readonly flaecheQm: string;
  /** Ohne Belagsart gibt es keinen Leistungswert und damit keine Sollzeit. */
  readonly hatBelagsart: boolean;
  readonly zugeordnet: boolean;
}

/**
 * Alle lebenden Räume eines Objekts — die Auswahlliste der Zuordnung.
 *
 * `zugeordnet` steht mit dabei, weil die Oberfläche sie VORAUSWÄHLEN und
 * sperren muss: eine Zuordnung lässt sich nicht mehr lösen (§5.2, Löschsperre),
 * und ein Häkchen, das man abwählen kann, ohne dass etwas passiert, ist eine
 * Lüge über die Wirkung eines Klicks.
 */
export async function ladeObjektRaeume(
  kontext: LeseKontext, objektId: string, revierId: string,
): Promise<readonly AuswahlRaum[]> {
  return kontext.abfrage<AuswahlRaum>(
    `select r.id, r.raumnummer as nummer, r.bezeichnung,
            r.flaeche_qm::text as "flaecheQm",
            r.belagsart_id is not null as "hatBelagsart",
            exists (select 1 from revier_raum rr
                     where rr.raum_id = r.id and rr.revier_id = $2::uuid) as zugeordnet
       from raum r
      where r.objekt_id = $1::uuid and r.archiviert_am is null
      order by r.sortierung, r.raumnummer nulls last
      limit 1000`,
    [objektId, revierId],
  );
}
