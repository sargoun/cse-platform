import 'server-only';

/**
 * Die Kontierung eines Geschäftsvorfalls (ACC-01, `05-FINANZEN.md` §9.3).
 *
 * Dünn mit Absicht: die Vorrangregel steht in `app.konto_aufloesen` (0126),
 * damit sie an **einer** Stelle steht und nicht in fünf Abfragen, die
 * auseinanderlaufen. Dieses Modul übersetzt nur zwischen SQL-Zeile und
 * Typ — und sagt, was ein `null`-Konto bedeutet.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type SchluesselTyp =
  | 'erloes_leistung' | 'aufwand_kategorie' | 'debitor_kunde' | 'kreditor_lieferant'
  | 'geldkonto' | 'steuer_gruppe' | 'bauabzugsteuer_verbindlichkeit'
  | 'skonto_aufwand' | 'skonto_ertrag' | 'mahngebuehr_ertrag' | 'zins_ertrag'
  | 'durchlaufender_posten';

export interface KontoFrage {
  readonly mandantId: string;
  readonly typ: SchluesselTyp;
  /** Der Tag, an dem die Zuordnung gelten muss — das Belegdatum, nicht heute. */
  readonly datum: string;
  readonly leistungskatalogPositionId?: string | null;
  readonly erloeskontoSchluessel?: string | null;
  readonly steuersatzGruppeId?: string | null;
  readonly kundeId?: string | null;
  readonly lieferantId?: string | null;
  readonly bankkontoId?: string | null;
  readonly kasseId?: string | null;
}

export interface Kontierung {
  /** `null` heisst: keine bestätigte Zuordnung. Dann steht der Grund daneben. */
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly buSchluessel: string | null;
  readonly mappingId: string | null;
  readonly istPlatzhalter: boolean;
  readonly pruefhinweis: string | null;
}

interface KontierungRoh {
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly bu_schluessel: string | null;
  readonly mapping_id: string | null;
  readonly ist_platzhalter: boolean;
  readonly pruefhinweis: string | null;
}

/**
 * **Der Aufrufer bekommt immer eine Antwort, nie eine Ausnahme.**
 *
 * Die Auflösung läuft innerhalb der Festschreibung einer Rechnung. Eine
 * fehlende Zuordnung darf den Beleg nicht verhindern — sie muss eine
 * Buchungszeile ohne Konto und mit Hinweis erzeugen, die in der Arbeitsliste
 * steht und den Monatsabschluss blockiert (D-424). Genau deshalb wirft weder
 * die SQL-Funktion noch diese hier.
 */
export async function kontiere(db: Abfrage, frage: KontoFrage): Promise<Kontierung> {
  const [zeile] = await db.abfrage<KontierungRoh>(
    `select (t).konto, (t).gegenkonto, (t).bu_schluessel, (t).mapping_id,
            (t).ist_platzhalter, (t).pruefhinweis
       from (select app.konto_aufloesen($1, $2::konto_schluessel_typ, $3::date,
                                        $4, $5, $6, $7, $8, $9, $10) as t) s`,
    [frage.mandantId, frage.typ, frage.datum,
      frage.leistungskatalogPositionId ?? null,
      frage.erloeskontoSchluessel ?? null,
      frage.steuersatzGruppeId ?? null,
      frage.kundeId ?? null,
      frage.lieferantId ?? null,
      frage.bankkontoId ?? null,
      frage.kasseId ?? null]);

  if (zeile === undefined) {
    return {
      konto: null, gegenkonto: null, buSchluessel: null, mappingId: null,
      istPlatzhalter: true, pruefhinweis: `Kontenzuordnung fehlt (${frage.typ})`,
    };
  }
  return {
    konto: zeile.konto,
    gegenkonto: zeile.gegenkonto,
    buSchluessel: zeile.bu_schluessel,
    mappingId: zeile.mapping_id,
    istPlatzhalter: zeile.ist_platzhalter,
    pruefhinweis: zeile.pruefhinweis,
  };
}
