/**
 * Referenzen (PRO-05) — hinter einer Schnittstelle.
 *
 * Die echte Quelle haengt an `auftrag` und kommt mit PR 27. Bis dahin liest
 * `ReferenzAusTabelle` die gepflegten Zeilen. Beide erfuellen denselben
 * Vertrag, und beide geben **ausschliesslich** freigegebene Eintraege zurueck.
 *
 * Die Filterung steht an ZWEI Stellen — hier und in der RLS-Policy. Das ist
 * keine Doppelung aus Unsicherheit: ein Kundenname auf einer Website ohne
 * dessen Zustimmung ist ein Problem, das man nicht durch Loeschen ungeschehen
 * macht, und eine vergessene `where`-Bedingung im Code ist der wahrscheinlichste
 * Weg dorthin.
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface Referenz {
  readonly id: string;
  readonly titel: string;
  readonly kundeName: string | null;
  readonly beschreibung: string | null;
  readonly jahr: number | null;
  readonly bild: { readonly pfad: string; readonly alt: string; readonly platzhalter: boolean } | null;
}

export interface ReferenzQuelle {
  fuerMandant(mandantId: string): Promise<readonly Referenz[]>;
}

export class ReferenzAusTabelle implements ReferenzQuelle {
  constructor(private readonly db: Abfrage) {}

  async fuerMandant(mandantId: string): Promise<readonly Referenz[]> {
    const zeilen = (await this.db.unsafe(
      `select r.id, r.titel, r.kunde_name, r.beschreibung, r.jahr,
              m.pfad, m.alt_text, m.ist_platzhalter
         from referenz r left join medien m on m.id = r.medien_id
        where r.mandant_id = $1
          -- Auch hier, nicht nur in der Policy.
          and r.freigegeben_vom_kunden
          and r.status = 'veroeffentlicht'
          and r.geloescht_am is null
        order by r.sortierung, r.jahr desc nulls last`,
      [mandantId],
    )) as {
      id: string; titel: string; kunde_name: string | null; beschreibung: string | null;
      jahr: number | null; pfad: string | null; alt_text: string | null;
      ist_platzhalter: boolean | null;
    }[];

    return zeilen.map((z) => ({
      id: z.id,
      titel: z.titel,
      kundeName: z.kunde_name,
      beschreibung: z.beschreibung,
      jahr: z.jahr,
      bild: z.pfad === null ? null : {
        pfad: z.pfad, alt: z.alt_text ?? '', platzhalter: z.ist_platzhalter ?? true,
      },
    }));
  }
}

/**
 * // TODO(client): O-13 — die echte Quelle liest abgeschlossene `auftrag`-Zeilen
 * // mit Kundenfreigabe (PR 27). Der Vertrag steht; die Implementierung wartet
 * // auf das Auftragsmodell.
 */
