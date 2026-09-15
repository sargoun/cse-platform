import type postgres from 'postgres';
import { alleArten } from '../../benachrichtigung/bootstrap.js';
import { erzeuge } from '../../benachrichtigung/registry.js';
import { ART_NEUER_LEAD } from '../../services/lead/benachrichtigung.js';
import { stelleZu, stelleZuAnKonto } from '../../benachrichtigung/ablage.js';
import { meldeAblaufwarnungen } from '../../services/nachweis/ablauf.js';

/**
 * Ein paar echte Zeilen im Posteingang, damit NOT-01 vorführbar ist.
 *
 * **Sie entstehen auf dem ECHTEN Weg** — `erzeuge()` aus dem Register,
 * `stelleZuAnKonto()` in die Tabelle. Kein direktes `insert into
 * benachrichtigung` mit erfundenem Titel: dann prüfte der Bildschirm eine
 * Zeile, die kein Wächter je so geschrieben hätte, und NOT-03 (jede Meldung
 * führt zu ihrem Datensatz) bliebe ungeprüft. `erzeuge()` scheitert, wenn das
 * Ziel nicht auflösbar ist — genau das ist der Punkt.
 *
 * **Und sie sind als Demo erkennbar**, weil ihre Daten es sind: die Objekte,
 * auf die sie zeigen, stammen aus denselben Demodaten. Ein Wächter, der
 * nachts läuft, legt daneben seine eigenen an.
 *
 * Idempotent über `art + empfaenger_id`: ein zweiter Seed-Lauf legt nichts
 * nach.
 */

export interface BenachrichtigungErgebnis {
  readonly angelegt: number;
  readonly vorhanden: number;
  readonly ohneKonto: number;
  /** Ablaufwarnungen aus dem ECHTEN EMP-08-Weg, ohne Zugang zur Person. */
  readonly ohneEmpfaenger: number;
}

interface Konto { id: string; mandant_id: string; slug: string; name: string }

export async function seedBenachrichtigungen(
  sql: postgres.Sql,
): Promise<BenachrichtigungErgebnis> {
  alleArten();

  /** Je Gesellschaft ein internes Konto — der Empfänger. */
  const konten = await sql<Konto[]>`
    select b.id, bm.mandant_id, m.slug, b.name
      from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
      join rolle r on r.id = bm.rolle_id
      join mandant m on m.id = bm.mandant_id
     where b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
       and r.schluessel in ('admin','leitung')
     order by m.slug, b.name`;

  /** Höchstens EIN Konto je Gesellschaft — sonst bekommt dieselbe Meldung jeder. */
  const jeMandant = new Map<string, Konto>();
  for (const k of konten) if (!jeMandant.has(k.mandant_id)) jeMandant.set(k.mandant_id, k);

  let angelegt = 0;
  let vorhanden = 0;
  let ohneKonto = 0;

  for (const k of jeMandant.values()) {
    /**
     * Ein offener Lead mit Frist — die Art, die es in jeder Gesellschaft gibt
     * und die auf einen Datensatz zeigt, den die Demodaten wirklich tragen.
     */
    const [lead] = await sql<{ id: string; betreff: string; firma: string | null }[]>`
      select l.id, l.betreff, coalesce(f.name, l.firma_name) as firma
        from lead l
        left join kunde ku on ku.id = l.kunde_id
        left join firma f on f.id = ku.firma_id
       where l.mandant_id = ${k.mandant_id}
       order by l.erstellt_am desc
       limit 1`;
    if (lead === undefined) continue;

    const [schon] = await sql<{ n: string }[]>`
      select count(*) as n from benachrichtigung
       where empfaenger_id = ${k.id} and art = ${ART_NEUER_LEAD}`;
    if (Number(schon?.n ?? 0) > 0) { vorhanden += 1; continue; }

    const b = erzeuge(ART_NEUER_LEAD, {
      mandantId: k.mandant_id,
      mandantSlug: k.slug,
      objektTyp: 'lead',
      objektId: lead.id,
      daten: { betreff: lead.betreff, firma: lead.firma, slaFrist: null },
    });

    const bericht = await stelleZuAnKonto(
      { unsafe: (a, w) => sql.unsafe(a, (w ?? []) as never[]) },
      [{ benachrichtigung: b, benutzerId: k.id, objektTyp: 'lead', objektId: lead.id }],
    );
    angelegt += bericht.zugestellt;
    ohneKonto += bericht.ohneKonto;
  }

  /**
   * **Und der EMP-08-Weg, unverändert aus dem Nachtlauf.**
   *
   * `meldeAblaufwarnungen` ist derselbe Dienst, den
   * `jobs/nachweisWarnungen.ts` ruft — dieselben Stufen (60/30/7), dieselbe
   * Quittung in `nachweis_warnung`, die verhindert, dass eine Stufe zweimal
   * anschlägt. Hier wird er nur früher ausgeführt, damit die Demodaten nicht
   * bis zum ersten Nachtlauf warten.
   *
   * Die Quittung macht ihn idempotent: ein zweiter Seed-Lauf meldet nichts
   * nach. Ohne Zugang zur Person kommt keine Zeile an — und genau das wird
   * gezählt und gesagt, statt verschluckt (D-09, PR 20).
   */
  const db = { unsafe: (a: string, w?: readonly unknown[]) => sql.unsafe(a, (w ?? []) as never[]) };
  const [tag] = await sql<{ tag: string }[]>`
    select (now() at time zone 'Europe/Berlin')::date::text as tag`;
  const bericht = await meldeAblaufwarnungen(db, tag!.tag);
  const zustellung = await stelleZu(db, bericht.gemeldet.map((m) => ({
    benachrichtigung: m.benachrichtigung,
    personId: m.personId,
    objektTyp: 'nachweis',
    objektId: m.nachweisId,
  })));

  return {
    angelegt: angelegt + zustellung.zugestellt,
    vorhanden,
    ohneKonto,
    ohneEmpfaenger: zustellung.ohneEmpfaenger.length,
  };
}
