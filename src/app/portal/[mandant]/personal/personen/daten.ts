/**
 * Die Abfragen der Personenseiten (D-09, EMP-14, SEC-02).
 *
 * **Eine Person ist kein Beschäftigungsdatensatz.** Diese Datei liest den
 * MENSCHEN und daneben, was er in DIESEM Bereich ist. Beides getrennt zu
 * halten ist die halbe Invariante 9: Tatsachen über den Menschen (Sprache,
 * Telefon, Nachweise) hängen an `person_id`, alles Kostenwirksame an
 * `anstellung_id`.
 *
 * **Kein Geburtsdatum, nirgends — und seit `0190` auch keines mehr möglich.**
 * Die Seitenkarte führt es unter `personen/[id]/stammdaten` mit dem eigenen
 * Recht `personal.stammdaten_lesen` (SEC-03, LEG-09). Bis `0190` war die
 * Spalte der Anwendungsrolle trotzdem lesbar, das Recht bewachte also eine Tür
 * neben einer offenen Wand; jetzt ist `geburtsdatum` — mit `geburtsort` und
 * `staatsangehoerigkeit` — aus dem SELECT-Grant für `cse_app` genommen, und
 * ein `select geburtsdatum` hier scheitert mit „permission denied". Der eine
 * Lesepfad ist `app.person_stammdaten_lesen`, und er protokolliert.
 *
 * **Kein Entgelt, nirgends** (K-05): `anstellung.stundensatz_intern` ist
 * `cse_app` als Spaltenrecht entzogen; diese Abfragen fragen ihn nicht, und
 * sie könnten es auch nicht.
 */
import type { LeseKontext } from '@/server/kontext/index';

export interface PersonZeile {
  readonly personId: string;
  readonly name: string;
  readonly sprache: string;
  readonly telefon: string | null;
  /** Beschäftigungen in DIESEM Bereich — nie die der Schwestergesellschaft. */
  readonly anstellungen: number;
  readonly aktiveAnstellungen: number;
  readonly nachweise: number;
  readonly nachweiseAbgelaufen: number;
}

const SPRACHE_TEXT: Readonly<Record<string, string>> = {
  de: 'Deutsch', en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch',
};

export function spracheText(schluessel: string): string {
  return SPRACHE_TEXT[schluessel] ?? schluessel;
}

interface PersonRoh {
  person_id: string;
  name: string;
  sprache: string;
  telefon: string | null;
  anstellungen: number;
  aktive_anstellungen: number;
  nachweise: number;
  nachweise_abgelaufen: number;
}

const alsZeile = (z: PersonRoh): PersonZeile => ({
  personId: z.person_id,
  name: z.name,
  sprache: z.sprache,
  telefon: z.telefon,
  anstellungen: Number(z.anstellungen),
  aktiveAnstellungen: Number(z.aktive_anstellungen),
  nachweise: Number(z.nachweise),
  nachweiseAbgelaufen: Number(z.nachweise_abgelaufen),
});

/**
 * Der Einstieg über `anstellung` und nicht über `person`.
 *
 * `person` trägt keinen Mandanten — der Mensch gehört keiner Gesellschaft
 * (D-09). Sichtbar ist er hier, weil er in diesem Bereich beschäftigt ist; die
 * Zeile entsteht deshalb aus der Beschäftigung und wird auf den Menschen
 * verdichtet. `distinct` ist Pflicht: zwei Beschäftigungen sind EIN Mensch.
 */
const SPALTEN = `
         p.id                                   as person_id,
         (p.vorname || ' ' || p.nachname)        as name,
         p.sprache, p.telefon,
         count(a.id)::int                        as anstellungen,
         count(a.id) filter (where a.status = 'aktiv')::int as aktive_anstellungen,
         (select count(*) from nachweis n
           where n.person_id = p.id and n.widerrufen_am is null)::int as nachweise,
         (select count(*) from nachweis n
           where n.person_id = p.id and n.widerrufen_am is null
             and n.gueltig_bis is not null
             and n.gueltig_bis < $1::date)::int  as nachweise_abgelaufen`;

export async function lesePersonen(
  kontext: LeseKontext, stichtag: string,
): Promise<readonly PersonZeile[]> {
  const zeilen = await kontext.abfrage<PersonRoh>(
    `select ${SPALTEN}
       from person p
       join anstellung a on a.person_id = p.id and a.geloescht_am is null
      where p.geloescht_am is null
      group by p.id, p.vorname, p.nachname, p.sprache, p.telefon
      order by p.nachname, p.vorname`,
    [stichtag],
  );
  return zeilen.map(alsZeile);
}

export async function lesePerson(
  kontext: LeseKontext, stichtag: string, personId: string,
): Promise<PersonZeile | null> {
  const [z] = await kontext.abfrage<PersonRoh>(
    `select ${SPALTEN}
       from person p
       join anstellung a on a.person_id = p.id and a.geloescht_am is null
      where p.geloescht_am is null and p.id = $2::uuid
      group by p.id, p.vorname, p.nachname, p.sprache, p.telefon`,
    [stichtag, personId],
  );
  return z === undefined ? null : alsZeile(z);
}

export interface AnstellungZeile {
  readonly anstellungId: string;
  readonly personalnummer: string | null;
  readonly eintritt: string;
  readonly austritt: string | null;
  readonly status: string;
  readonly arbeitszeitmodell: string | null;
  readonly wochenstunden: string | null;
}

/**
 * Die Beschäftigungen dieses Menschen — **in diesem Bereich**.
 *
 * Die Seitenkarte nennt an dieser Stelle „die Liste der Beschäftigungen nach
 * Gesellschaftsnamen". Das geht heute NICHT: `anstellung` trägt RLS auf den
 * aktiven Mandanten, und eine Definer-Funktion, die die Wand überschreitet,
 * wäre die zweite Durchlässigkeit — K-06 lässt ausdrücklich genau eine zu (die
 * ArbZG-Belastung), und ob die Personalstelle der einen Gesellschaft erfahren
 * darf, dass jemand auch bei der Schwester arbeitet, ist eine Rechtsfrage und
 * keine technische.
 *
 * // TODO(client, O-220): Darf die Personalstelle einer Gesellschaft sehen,
 * dass ein Mensch zusaetzlich bei einer Schwestergesellschaft der Gruppe
 * beschaeftigt ist — und wenn ja, nur der Name der Gesellschaft oder mehr?
 */
export async function leseAnstellungen(
  kontext: LeseKontext, personId: string,
): Promise<readonly AnstellungZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; personalnummer: string | null; eintritt: string; austritt: string | null;
    status: string; arbeitszeitmodell: string | null; wochenstunden: string | null;
  }>(
    `select a.id, a.personalnummer,
            to_char(a.eintritt, 'YYYY-MM-DD') as eintritt,
            to_char(a.austritt, 'YYYY-MM-DD') as austritt,
            a.status::text as status, a.arbeitszeitmodell,
            a.wochenstunden::text as wochenstunden
       from anstellung a
      where a.person_id = $1::uuid and a.geloescht_am is null
      order by a.eintritt desc`,
    [personId],
  );
  return zeilen.map((z) => ({
    anstellungId: z.id,
    personalnummer: z.personalnummer,
    eintritt: z.eintritt,
    austritt: z.austritt,
    status: z.status,
    arbeitszeitmodell: z.arbeitszeitmodell,
    wochenstunden: z.wochenstunden,
  }));
}
