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
  /** Der URL-Schluessel unter `/unternehmen/<bereich>/projekte/` (0170). */
  readonly slug: string;
  readonly titel: string;
  readonly kundeName: string | null;
  readonly beschreibung: string | null;
  readonly jahr: number | null;
  readonly bild: { readonly pfad: string; readonly alt: string; readonly platzhalter: boolean } | null;
}

/** Eine Referenz MIT der Gesellschaft, der sie gehoert — fuer die Gruppenliste. */
export interface ReferenzMitBereich extends Referenz {
  readonly bereichSlug: string;
  readonly bereichName: string;
}

export interface ReferenzQuelle {
  fuerMandant(mandantId: string): Promise<readonly Referenz[]>;
  /**
   * Eine einzelne Referenz unter ihrer KANONISCHEN Adresse (SEITENKARTE §2.2).
   *
   * `null` heisst „gibt es nicht ODER ist nicht freigegeben" — und zwar
   * absichtlich derselbe Rueckgabewert. Wer die beiden trennte, verriete mit
   * einem 403 statt eines 404, dass es die Referenz gibt und der Kunde ihrer
   * Veroeffentlichung nur nicht zugestimmt hat.
   */
  nachSlug(mandantId: string, slug: string): Promise<Referenz | null>;
  /**
   * Alle freigegebenen Referenzen ALLER Gesellschaften — die Gruppenliste
   * `/projekte`, deren Eintraege auf die Gesellschaftsadresse zeigen.
   *
   * **Eine eigene Methode und keine Schleife ueber `fuerMandant`.** Die Liste
   * ist nach Jahr sortiert, nicht nach Gesellschaft; vier Abfragen und ein
   * Zusammenfuegen im Code gaeben dieselbe Menge in einer anderen Reihenfolge,
   * und die Reihenfolge ist hier die Aussage.
   */
  fuerGruppe(grenze?: number): Promise<readonly ReferenzMitBereich[]>;
}

export class ReferenzAusTabelle implements ReferenzQuelle {
  constructor(private readonly db: Abfrage) {}

  async fuerMandant(mandantId: string): Promise<readonly Referenz[]> {
    const zeilen = (await this.db.unsafe(
      `select r.id, r.slug, r.titel, r.kunde_name, r.beschreibung, r.jahr,
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
      id: string; slug: string; titel: string; kunde_name: string | null;
      beschreibung: string | null;
      jahr: number | null; pfad: string | null; alt_text: string | null;
      ist_platzhalter: boolean | null;
    }[];

    return zeilen.map((z) => ({
      id: z.id,
      slug: z.slug,
      titel: z.titel,
      kundeName: z.kunde_name,
      beschreibung: z.beschreibung,
      jahr: z.jahr,
      bild: z.pfad === null ? null : {
        pfad: z.pfad, alt: z.alt_text ?? '', platzhalter: z.ist_platzhalter ?? true,
      },
    }));
  }

  /**
   * Eine Referenz unter ihrem Slug — mit denselben drei Bedingungen wie oben.
   *
   * **Die Bedingungen stehen hier noch einmal und nicht nur in der Policy.**
   * Dieselbe Begruendung wie bei `fuerMandant`: ein Kundenname auf einer
   * Website ohne dessen Zustimmung ist ein Problem, das man durch Loeschen
   * nicht ungeschehen macht — und eine vergessene `where`-Bedingung ist der
   * wahrscheinlichste Weg dorthin. Eine Detailseite ist dabei der
   * gefaehrlichere Fall: die Liste zeigt eine Zeile zu viel, die Detailseite
   * eine ganze Geschichte.
   */
  async nachSlug(mandantId: string, slug: string): Promise<Referenz | null> {
    const zeilen = (await this.db.unsafe(
      `select r.id, r.slug, r.titel, r.kunde_name, r.beschreibung, r.jahr,
              m.pfad, m.alt_text, m.ist_platzhalter
         from referenz r left join medien m on m.id = r.medien_id
        where r.mandant_id = $1 and r.slug = $2
          and r.freigegeben_vom_kunden
          and r.status = 'veroeffentlicht'
          and r.geloescht_am is null`,
      [mandantId, slug],
    )) as {
      id: string; slug: string; titel: string; kunde_name: string | null;
      beschreibung: string | null; jahr: number | null; pfad: string | null;
      alt_text: string | null; ist_platzhalter: boolean | null;
    }[];

    const z = zeilen[0];
    if (z === undefined) return null;
    return {
      id: z.id, slug: z.slug, titel: z.titel, kundeName: z.kunde_name,
      beschreibung: z.beschreibung, jahr: z.jahr,
      bild: z.pfad === null ? null : {
        pfad: z.pfad, alt: z.alt_text ?? '', platzhalter: z.ist_platzhalter ?? true,
      },
    };
  }

  /**
   * Die Gruppenliste — alle Gesellschaften, nach Jahr.
   *
   * **`mandant` wird mitgelesen, nicht nachgeschlagen.** Die Liste braucht je
   * Zeile den Bereichs-Slug fuer die kanonische Adresse und den Namen fuer das
   * Schild daneben; beides aus einer zweiten Abfrage zu holen hiesse, die
   * Zuordnung im Code noch einmal zu bauen — und beim naechsten Bereich
   * falsch.
   *
   * **`geloescht_am is null` steht auch auf `mandant`.** Eine stillgelegte
   * Gesellschaft hat keine oeffentliche Seite mehr; ihre Referenzen zeigten
   * sonst auf eine Adresse, die 404 antwortet.
   */
  async fuerGruppe(grenze = 24): Promise<readonly ReferenzMitBereich[]> {
    const zeilen = (await this.db.unsafe(
      `select r.id, r.slug, r.titel, r.kunde_name, r.beschreibung, r.jahr,
              m.pfad, m.alt_text, m.ist_platzhalter,
              b.slug as bereich_slug, b.name as bereich_name
         from referenz r
         join mandant b on b.id = r.mandant_id
         left join medien m on m.id = r.medien_id
        where r.freigegeben_vom_kunden
          and r.status = 'veroeffentlicht'
          and r.geloescht_am is null
          and b.geloescht_am is null
        order by r.jahr desc nulls last, r.sortierung, r.titel
        limit $1`,
      [grenze],
    )) as {
      id: string; slug: string; titel: string; kunde_name: string | null;
      beschreibung: string | null; jahr: number | null; pfad: string | null;
      alt_text: string | null; ist_platzhalter: boolean | null;
      bereich_slug: string; bereich_name: string;
    }[];

    return zeilen.map((z) => ({
      id: z.id, slug: z.slug, titel: z.titel, kundeName: z.kunde_name,
      beschreibung: z.beschreibung, jahr: z.jahr,
      bild: z.pfad === null ? null : {
        pfad: z.pfad, alt: z.alt_text ?? '', platzhalter: z.ist_platzhalter ?? true,
      },
      bereichSlug: z.bereich_slug,
      bereichName: z.bereich_name,
    }));
  }
}

/**
 * // TODO(client): O-13 — die echte Quelle liest abgeschlossene `auftrag`-Zeilen
 * // mit Kundenfreigabe (PR 27). Der Vertrag steht; die Implementierung wartet
 * // auf das Auftragsmodell.
 */
