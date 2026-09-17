import 'server-only';

/**
 * Die Vorab-Prüfungen VOR der Rechnungsstellung — über alle Aufträge, nicht
 * je Rechnung (FIN-18, FIN-07, EMP-13).
 *
 * **Was hier NICHT passiert: sich Prüfungen ausdenken.** Die Seitenkarte nennt
 * für diese Route „completed order with no time recorded, **and the other
 * pre-invoice checks**" — und welche „anderen" das sind, steht in keinem
 * Dokument. Die eine benannte Prüfung ist FIN-18; zwei weitere sind aus
 * bestehenden, getesteten Zusagen abgeleitet und als solche gekennzeichnet
 * (FIN-07: eine Rechnungszeile ohne Herkunft entsteht nicht; und der
 * abgeschlossene Auftrag, für den nie eine Rechnung entstand). Alles darüber
 * hinaus ist eine offene Frage und steht als solche auf der Seite — nicht als
 * leere Rubrik und nicht als erfundene Regel.
 *
 * **`fin.auftrag_erfasste_minuten()` und nie die Sicht `zeiteintrag_auftrag`.**
 * Die Sicht läuft mit `security_invoker` (0051): eine Buchhaltung ohne
 * `zeit.lesen` bekäme dort null Minuten — also bei JEDEM Auftrag eine
 * Warnung. Eine Warnung, die immer kommt, wird nach dem dritten Mal ungelesen
 * weggeklickt, und dann ist die eine echte mit weg.
 *
 * Die Funktion gibt eine ZAHL zurück, keine Zeile: die Buchhaltung erfährt,
 * DASS Zeit fehlt, nicht von wem (EMP-13). Deshalb springt jede Zeile dieser
 * Liste in den AUFTRAG und nicht in die Zeiterfassung.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Die Regeln, die diese Seite prüft — als geschlossene Aufzählung, damit eine
 * Zeile ihre Regel NENNT und nicht nur eine Farbe trägt.
 */
export type Regel =
  /** FIN-18 — abgeschlossener Auftrag, keine einzige Minute erfasst. */
  | 'fin18_keine_zeit'
  /** Abgeschlossener Auftrag, für den nie eine Rechnung entstanden ist. */
  | 'auftrag_ohne_rechnung'
  /** FIN-07 — Entwurfszeile ohne wirksame Herkunft. */
  | 'entwurf_ohne_quelle';

export interface RegelText {
  readonly regel: Regel;
  readonly kurz: string;
  readonly fundstelle: string;
  readonly text: string;
  readonly stufe: 'fehler' | 'warnung';
}

export const REGELN: readonly RegelText[] = [
  {
    regel: 'fin18_keine_zeit',
    kurz: 'Abgeschlossener Auftrag ohne erfasste Zeit',
    fundstelle: 'FIN-18',
    text:
      'Der Auftrag ist abgeschlossen, aber es ist keine einzige Minute erfasst. '
      + 'Entweder fehlt die Zeiterfassung, oder die Leistung gehört zu einem '
      + 'anderen Auftrag. Festgeschrieben wird trotzdem nur mit protokollierter '
      + 'Begründung — und diese Liste ist der Ort, das VORHER zu klären.',
    stufe: 'warnung',
  },
  {
    regel: 'auftrag_ohne_rechnung',
    kurz: 'Abgeschlossener Auftrag ohne Rechnung',
    fundstelle: 'FIN-01, FIN-16',
    text:
      'Der Auftrag ist abgeschlossen und es existiert keine Rechnung dazu — '
      + 'auch kein Entwurf. Das ist keine Regelverletzung, sondern nicht '
      + 'abgerechnete Leistung.',
    stufe: 'warnung',
  },
  {
    regel: 'entwurf_ohne_quelle',
    kurz: 'Entwurfszeile ohne Herkunft',
    fundstelle: 'FIN-07',
    text:
      'Die Rechnungszeile nennt keine wirksame Herkunft — kein Zeiteintrag, kein '
      + 'Aufmass, keine Vertragsleistung, kein Material und keine Begründung von '
      + 'Hand. Die Festschreibung weist sie ab; hier steht sie, bevor jemand auf '
      + 'den Knopf drückt.',
    stufe: 'fehler',
  },
];

export function regelText(regel: Regel): RegelText {
  const r = REGELN.find((x) => x.regel === regel);
  /*
   * Kein Rückfall auf einen erfundenen Text: `Regel` ist eine geschlossene
   * Aufzählung, und ein `default` hier wäre die Stelle, an der ein vierter
   * Wert stillschweigend als „unbekannte Regel" durchginge.
   */
  if (r === undefined) throw new Error(`Unbekannte Vorabprüfungsregel: ${regel}`);
  return r;
}

export interface Befund {
  readonly regel: Regel;
  /** Wohin gesprungen wird — in den Auftrag, nie in die Zeiterfassung (EMP-13). */
  readonly zielArt: 'auftrag' | 'rechnung';
  readonly zielId: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly kunde: string | null;
  /** Der Berliner Kalendertag des Abschlusses bzw. des Entwurfs. */
  readonly datum: string | null;
  /** Ein Zusatz, den nur diese Regel kennt — etwa die Positionsnummer. */
  readonly zusatz: string | null;
}

export interface Vorabbefund {
  readonly befunde: readonly Befund[];
  readonly jeRegel: Readonly<Record<Regel, number>>;
  readonly gesamt: number;
}

/**
 * Alle drei Prüfungen in einem Durchgang.
 *
 * **Nicht in einer einzigen SQL-Anweisung**, und das ist eine Entscheidung:
 * die drei Prüfungen haben verschiedene Grundmengen (Aufträge, Aufträge,
 * Rechnungspositionen), und eine `union all` darüber wäre eine Abfrage, die
 * bei jeder vierten Prüfung umgeschrieben werden müsste. Drei Abfragen
 * nebeneinander lassen sich einzeln lesen und einzeln erklären.
 */
export async function offenePruefungen(db: Abfrage): Promise<Vorabbefund> {
  const ohneZeit = await db.abfrage<{
    id: string; auftragsnummer: string; bezeichnung: string;
    kunde: string | null; datum: string | null; minuten: string;
  }>(
    /*
     * `fin.auftrag_erfasste_minuten()` steht im SELECT und nicht im WHERE, und
     * gefiltert wird erst darum herum: als Bedingung im WHERE ruft Postgres
     * die Funktion je Kandidat ein zweites Mal, sobald der Planer die Zeile
     * auch ausgeben will. Hier läuft sie genau einmal je Auftrag.
     *
     * Ein STORNIERTER Auftrag oder einer ohne Abrechnungsart steht nicht
     * darin: FIN-18 fragt nach abgerechneter Leistung, und was nicht
     * abgerechnet wird, hat keine zu erfassende Zeit.
     */
    `with abgeschlossen as (
       select a.id::text as id, a.auftragsnummer, a.bezeichnung,
              k.name as kunde,
              to_char(coalesce(a.abgeschlossen_am,
                               (a.erstellt_am at time zone 'Europe/Berlin')::date),
                      'DD.MM.YYYY') as datum,
              fin.auftrag_erfasste_minuten(a.id)::text as minuten
         from auftrag a
         left join kunde k on k.mandant_id = a.mandant_id and k.id = a.kunde_id
        where a.status = 'abgeschlossen' or a.abgeschlossen_am is not null
     )
     select * from abgeschlossen
      where minuten::bigint = 0
      order by datum desc nulls last, auftragsnummer`);

  const ohneRechnung = await db.abfrage<{
    id: string; auftragsnummer: string; bezeichnung: string;
    kunde: string | null; datum: string | null;
  }>(
    /*
     * „Keine Rechnung" heisst: kein Beleg und kein Entwurf. Ein VERWORFENER
     * Entwurf zählt nicht — er ist der Satz, der bezeugt, dass hier keine
     * Rechnung entstanden ist, und genau dann gehört der Auftrag wieder in
     * diese Liste.
     */
    `select a.id::text as id, a.auftragsnummer, a.bezeichnung, k.name as kunde,
            to_char(a.abgeschlossen_am, 'DD.MM.YYYY') as datum
       from auftrag a
       left join kunde k on k.mandant_id = a.mandant_id and k.id = a.kunde_id
      where (a.status = 'abgeschlossen' or a.abgeschlossen_am is not null)
        and not exists (select 1 from rechnung r
                         where r.mandant_id = a.mandant_id
                           and r.auftrag_id = a.id
                           and r.status <> 'verworfen')
      order by a.abgeschlossen_am desc nulls last, a.auftragsnummer`);

  const ohneQuelle = await db.abfrage<{
    rechnung_id: string; nummer: string | null; bezeichnung: string;
    kunde: string | null; datum: string | null; position_nr: number;
    position_bezeichnung: string;
  }>(
    `select r.id::text as rechnung_id, r.nummer, r.kopftext as bezeichnung,
            k.name as kunde,
            to_char(r.rechnungsdatum, 'DD.MM.YYYY') as datum,
            p.position_nr, p.bezeichnung as position_bezeichnung
       from rechnungsposition p
       join rechnung r on r.mandant_id = p.mandant_id and r.id = p.rechnung_id
       left join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
      where r.status = 'entwurf'
        and not exists (select 1 from rechnungsposition_quelle q
                         where q.mandant_id = p.mandant_id
                           and q.rechnungsposition_id = p.id
                           and q.wirksam)
      order by r.rechnungsdatum desc nulls last, p.position_nr`);

  const befunde: Befund[] = [
    ...ohneQuelle.map((z): Befund => ({
      regel: 'entwurf_ohne_quelle',
      zielArt: 'rechnung',
      zielId: z.rechnung_id,
      nummer: z.nummer ?? 'Entwurf ohne Nummer',
      bezeichnung: z.bezeichnung ?? 'Rechnungsentwurf',
      kunde: z.kunde,
      datum: z.datum,
      zusatz: `Position ${String(z.position_nr)} — ${z.position_bezeichnung}`,
    })),
    ...ohneZeit.map((z): Befund => ({
      regel: 'fin18_keine_zeit',
      zielArt: 'auftrag',
      zielId: z.id,
      nummer: z.auftragsnummer,
      bezeichnung: z.bezeichnung,
      kunde: z.kunde,
      datum: z.datum,
      zusatz: 'keine erfasste Minute',
    })),
    ...ohneRechnung.map((z): Befund => ({
      regel: 'auftrag_ohne_rechnung',
      zielArt: 'auftrag',
      zielId: z.id,
      nummer: z.auftragsnummer,
      bezeichnung: z.bezeichnung,
      kunde: z.kunde,
      datum: z.datum,
      zusatz: null,
    })),
  ];

  return {
    befunde,
    jeRegel: {
      fin18_keine_zeit: ohneZeit.length,
      auftrag_ohne_rechnung: ohneRechnung.length,
      entwurf_ohne_quelle: ohneQuelle.length,
    },
    gesamt: befunde.length,
  };
}

/**
 * Was diese Seite NOCH NICHT prüft — ausgeschrieben, damit die Lücke benannt
 * ist und nicht als Vollständigkeit durchgeht.
 *
 * Dasselbe Muster wie `NICHT_GEPRUEFT` in `ustg14.ts`: eine Prüfliste, die
 * ihre eigenen Grenzen verschweigt, wird für vollständig gehalten.
 */
export interface NichtGeprueft {
  readonly frage: string;
  readonly grund: string;
}

export const NICHT_GEPRUEFT: readonly NichtGeprueft[] = [
  {
    frage: 'Welche Vorab-Prüfungen soll diese Liste ausser FIN-18 noch führen?',
    grund:
      'Die Seitenkarte nennt „and the other pre-invoice checks", ohne sie '
      + 'aufzuzählen. Die beiden zusätzlichen Prüfungen hier sind aus FIN-01/FIN-16 '
      + 'und FIN-07 abgeleitet und als solche benannt; welche weiteren die '
      + 'Buchhaltung braucht, ist offen (O-601).',
  },
  {
    frage: 'Ab welcher Überschreitung ist ein Auftrag „überfällig abzurechnen"?',
    grund:
      'Eine Frist zwischen Abschluss und Rechnungsstellung ist nirgends '
      + 'festgelegt. Eine hier zu setzen wäre eine Geschäftsregel, die sich diese '
      + 'Liste erfindet (O-602).',
  },
];

// TODO(client, O-601): Welche Vorab-Prüfungen soll `/finanzen/pruefungen` ausser FIN-18 führen — und welche davon blockiert die Festschreibung, welche warnt nur?
// TODO(client, O-602): Innerhalb welcher Frist nach Auftragsabschluss muss abgerechnet werden, damit die Liste einen Auftrag als überfällig zeigen darf?
