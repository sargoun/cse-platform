/**
 * Referenzen (PRO-05) — hinter einer Schnittstelle.
 *
 * `ReferenzAusTabelle` liest die gepflegten `referenz`-Zeilen und gibt
 * **ausschliesslich** freigegebene Eintraege zurueck. Eine Zeile entsteht seit
 * V-161 nur aus einem abgeschlossenen Auftrag mit geltender Kundenfreigabe
 * und haelt ihn fest (`referenz.auftrag_id`, 0410, D-654) — die Tabelle IST
 * damit die Quelle aus echten Auftraegen, die PR 27 angekuendigt hatte, mit
 * einer eigenen, oeffentlichen Formulierung und einer eigenen Freigabe je
 * Referenz (PRO-05 trennt beides; O-913). Eine Quelle, die Auftraege direkt
 * liest, gibt es deshalb nicht: sie veroeffentlichte die Bezeichnung aus der
 * Kundenakte, ueber die niemand einzeln entschieden hat.
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
   * **`archiviert_am is null` steht auch auf `mandant`.** Eine stillgelegte
   * Gesellschaft hat keine oeffentliche Seite mehr; ihre Referenzen zeigten
   * sonst auf eine Adresse, die 404 antwortet.
   *
   * Die Spalte heisst `archiviert_am` und nicht `geloescht_am` — `mandant`
   * wird nicht geloescht, sondern stillgelegt (Invariante 8). Der erste
   * Entwurf hier schrieb `geloescht_am`; die Abfrage waere zur Laufzeit an
   * „column does not exist" gescheitert, und zwar auf der Gruppenseite, die
   * kein Fall bis dahin gefahren ist.
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
          and b.archiviert_am is null
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
 * **Hier stand ein Merker, der nicht mehr stimmte** (V-161) — eine Frage an
 * den Auftraggeber mit der Nummer O-13: „die echte Quelle liest abgeschlossene
 * auftrag-Zeilen mit Kundenfreigabe (PR 27)". Zweimal daneben: O-13 ist die
 * FOTOGRAFIE (echtes
 * Bildmaterial), nicht die Herkunft einer Referenz — und die Frage war keine
 * an den Auftraggeber, sondern eine Bauaufgabe, die das Auftragsmodell
 * inzwischen erfüllt: `legeReferenzAn` verlangt den abgeschlossenen Auftrag,
 * und die Zeile hält ihn fest (0410). Offen beim Auftraggeber sind zwei
 * andere Fragen, jede mit ihrem Merker an der Stelle, die sie ändern würde:
 * O-913 (deckt die Freigabe am Auftrag die Referenz in ihrer veröffentlichten
 * Fassung?) in `inhalt/redaktion.ts` und O-914 (genügt ein laufender
 * Auftrag?) in `auftrag/kundenfreigabe.ts`.
 */
