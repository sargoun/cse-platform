/**
 * Wer ist angemeldet, in welchen Gesellschaften arbeitet dieser Mensch, und in
 * welcher Sprache liest er? (EMP-12, EMP-14, EMP-15, D-09)
 *
 * **Eine Person, mehrere Beschaeftigungen — und die Sprache haengt an der
 * PERSON.** Fatima arbeitet in zwei Gesellschaften; sie hat zwei
 * Arbeitsverhaeltnisse, zwei Personalnummern und zwei Stundenkonten, aber
 * einen Namen und eine Sprache. `person.sprache` ist deshalb die einzige
 * Quelle der Portalsprache (SEITENKARTE §12) und wird an genau einer Stelle
 * geaendert, in `/portal/konto/profil`.
 *
 * **Was dieser Dienst nicht liefert: ein Entgelt.** `anstellung.stundensatz_intern`
 * und `tarifgruppe` sind `cse_app` gar nicht erst gegrantet (K-05,
 * Spaltenprivilegien statt maskierender Sichten) — ein `select a.*` scheiterte
 * hier mit „permission denied". Die Spaltenliste unten ist deshalb nicht
 * Vorsicht, sondern die einzige Form, in der diese Abfrage ueberhaupt laeuft;
 * `ANSTELLUNG_FELDER` schreibt das Ergebnis fest, damit ein Test es Feld fuer
 * Feld pruefen kann statt stichprobenartig nach `satz` zu suchen.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { istPortalSprache, type PortalSprache } from '../../../lib/i18n/texte.js';

/** Eine Beschaeftigung, so wie das Portal des Menschen sie zeigt. */
export interface EigeneAnstellung {
  readonly anstellungId: string;
  readonly mandantId: string;
  /** Der Slug der Gesellschaft — die Identitaetsfarbe haengt daran (DESIGN §1). */
  readonly mandantSlug: string;
  /** Ihr NAME, denn Farbe ist nie das einzige Signal (DESIGN §9). */
  readonly mandantName: string;
  readonly personalnummer: string | null;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly status: string;
  readonly arbeitszeitmodell: string | null;
}

/**
 * Die festgeschriebene Feldliste — der Gegenstand der K-05-Abnahme.
 *
 * Sie steht hier und nicht im Test, damit beide dasselbe meinen: der Test
 * vergleicht die Schluessel des gelieferten Objekts mit dieser Liste und
 * schlaegt an, sobald ein Feld dazukommt, das niemand geprueft hat.
 */
export const ANSTELLUNG_FELDER = [
  'anstellungId', 'mandantId', 'mandantSlug', 'mandantName', 'personalnummer',
  'eintritt', 'austritt', 'status', 'arbeitszeitmodell',
] as const;

interface AnstellungRoh {
  readonly anstellung_id: string;
  readonly mandant_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly personalnummer: string | null;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly status: string;
  readonly arbeitszeitmodell: string | null;
}

/**
 * Die Beschaeftigungen des angemeldeten Menschen — beide Gesellschaften.
 *
 * Im Personen-Scope liefert dieselbe Abfrage alle Anstellungen dieser Person,
 * im Mandanten-Scope nur die eine. Genau darin besteht der Unterschied, den
 * K-18 beschreibt — und weil `t_person` und die K-04-Decke beide zutreffen
 * muessen, kann hier nie eine fremde Zeile stehen.
 */
export async function leseEigeneAnstellungen(
  kontext: LeseKontext,
): Promise<readonly EigeneAnstellung[]> {
  const roh = await kontext.abfrage<AnstellungRoh>(
    `select a.id                                   as anstellung_id,
            a.mandant_id,
            m.slug                                 as mandant_slug,
            m.name                                 as mandant_name,
            a.personalnummer,
            to_char(a.eintritt, 'YYYY-MM-DD')      as eintritt,
            to_char(a.austritt, 'YYYY-MM-DD')      as austritt,
            a.status::text                         as status,
            a.arbeitszeitmodell
       from anstellung a
       join mandant m on m.id = a.mandant_id
      where a.geloescht_am is null
      order by m.sortierung, m.slug`,
  );
  return roh.map((z) => ({
    anstellungId: z.anstellung_id,
    mandantId: z.mandant_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
    personalnummer: z.personalnummer,
    eintritt: z.eintritt,
    austritt: z.austritt,
    status: z.status,
    arbeitszeitmodell: z.arbeitszeitmodell,
  }));
}

export interface EigenePerson {
  readonly personId: string;
  readonly name: string;
  readonly sprache: PortalSprache;
}

/**
 * Der angemeldete Mensch und seine Sprache.
 *
 * Ein unbekannter Wert in `person.sprache` faellt auf Deutsch zurueck und
 * nicht auf einen Fehler: die Spalte traegt zwar einen CHECK ueber genau die
 * vier Werte, aber ein Portal, das sich wegen einer Sprachangabe gar nicht
 * mehr oeffnet, ist der schlechtere Ausfall.
 */
export async function leseEigenePerson(
  kontext: LeseKontext,
): Promise<EigenePerson | null> {
  const [p] = await kontext.abfrage<{
    id: string; vorname: string; nachname: string; sprache: string;
  }>(
    `select p.id, p.vorname, p.nachname, p.sprache
       from person p
      where p.id = app.aktuelle_person() and p.geloescht_am is null`,
  );
  if (p === undefined) return null;
  return {
    personId: p.id,
    name: `${p.vorname} ${p.nachname}`,
    sprache: istPortalSprache(p.sprache) ? p.sprache : 'de',
  };
}
