/**
 * Personendubletten finden und zusammenfuehren (D-09, LEG-09, Invariante 8,
 * Invariante 9, 01-KERN §6.13).
 *
 * **Warum eine Dublette teuer ist.** D-09 traegt die ganze Personalseite der
 * Plattform: der Mensch gehoert keiner Gesellschaft, die Beschaeftigung schon.
 * Zwei `person`-Zeilen fuer einen Menschen heben das auf — die
 * ArbZG-Belastung aggregiert nach Invariante 9 je PERSON ueber alle
 * Gesellschaften, und bei zwei Zeilen aggregiert sie zweimal die Haelfte.
 * Genau die Grenze, wegen der die Aggregation existiert, wird dann nie
 * erreicht.
 *
 * **Warum das Zusammenfuehren keine Zeilen umhaengt.** 50 Tabellen haben einen
 * Fremdschluessel auf `person`, die Zeitdomaene traegt `person_id`
 * denormalisiert in zusammengesetzten Fremdschluesseln ohne
 * `on update cascade`, und ein Teil der Kindzeilen ist eingefroren
 * (`zeiteintrag`, `wachbuch_eintrag`, `da_kenntnisnahme`, `checkin_token`,
 * `aufmass_signatur`, `leistungsnachweis_signatur`). Die Geschichte laesst
 * sich nicht umschreiben — sie soll es auch nicht. Deshalb der Zeiger
 * (`person.zusammengefuehrt_in_person_id`) und der Aufloeser
 * (`app.person_kanonisch`, `app.person_identitaeten`).
 *
 * **Die Suche schlaegt nichts vor.** Sie stellt Kandidaten NEBENEINANDER und
 * laesst einen Menschen entscheiden. Eine Heuristik, die „sehr wahrscheinlich
 * dieselbe Person" behauptet, wird geklickt — und eine falsch
 * zusammengefuehrte Personalakte ist mit dem Zeigermodell absichtlich nicht
 * mit einem Klick rueckgaengig zu machen (O-611).
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export interface DublettenKandidat {
  readonly personId: string;
  readonly name: string;
  readonly nachname: string;
  readonly vorname: string;
  readonly telefon: string | null;
  /** Beschaeftigungen in DIESER Gesellschaft (D-09). */
  readonly anstellungen: number;
  readonly aktiveAnstellungen: number;
  /** `null` = ohne `personal.nachweis_lesen` nicht pruefbar. */
  readonly nachweise: number | null;
  readonly hatZugang: boolean;
  /** Gesetzt, wenn diese Zeile schon auf eine fuehrende zeigt. */
  readonly zusammengefuehrtIn: string | null;
  readonly erstelltAm: Date;
}

export class ZusammenfuehrenFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ZusammenfuehrenFehler';
  }
}

export class BestaetigungFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor() {
    super(
      'Die getippte Bestätigung stimmt nicht. Eine Zusammenführung ist nicht '
      + 'mit einem Klick rückgängig zu machen — deshalb wird sie getippt.',
    );
    this.name = 'BestaetigungFehlt';
  }
}

/**
 * Kandidaten zu einem Suchbegriff — Nachname, Vorname oder Geburtsjahr.
 *
 * **Das Geburtsdatum kommt hier NICHT vor**, obwohl es das beste
 * Unterscheidungsmerkmal waere: es ist `cse_app` als Spalte entzogen (0190,
 * SEC-03). Wer es zum Vergleich braucht, oeffnet die Stammdatenseite der
 * beiden Menschen — mit eigenem Recht und je einer Auditzeile. Das ist
 * langsamer und richtig: ein Dublettenabgleich ist kein Grund, jedem
 * Bearbeiter jedes Geburtsdatum zu zeigen.
 */
export async function sucheKandidaten(
  kontext: LeseKontext, suche: string,
): Promise<readonly DublettenKandidat[]> {
  const begriff = suche.trim();
  if (begriff.length < 2) return [];

  const [rechte] = await kontext.abfrage<{ nachweis: boolean }>(
    `select app.hat_recht('personal.nachweis_lesen', app.aktiver_mandant()) as nachweis`,
  );
  const darfNachweise = rechte?.nachweis === true;

  const roh = await kontext.abfrage<{
    person_id: string; vorname: string; nachname: string; telefon: string | null;
    anstellungen: number; aktive: number; nachweise: number;
    hat_zugang: boolean; zusammengefuehrt_in: string | null; erstellt_am: Date;
  }>(
    `select p.id                                    as person_id,
            p.vorname, p.nachname, p.telefon,
            count(a.id)::int                        as anstellungen,
            count(a.id) filter (where a.status = 'aktiv')::int as aktive,
            (select count(*) from nachweis n
              where n.person_id = p.id and n.widerrufen_am is null)::int as nachweise,
            exists (select 1 from mitarbeiter_zugang mz
                     where mz.person_id = p.id)     as hat_zugang,
            p.zusammengefuehrt_in_person_id         as zusammengefuehrt_in,
            p.erstellt_am
       from person p
       join anstellung a on a.person_id = p.id and a.geloescht_am is null
      where p.geloescht_am is null
        and (p.nachname ilike '%' || $1 || '%' or p.vorname ilike '%' || $1 || '%')
      group by p.id, p.vorname, p.nachname, p.telefon,
               p.zusammengefuehrt_in_person_id, p.erstellt_am
      order by lower(p.nachname), lower(p.vorname)
      limit 50`,
    [begriff],
  );

  return roh.map((z) => ({
    personId: z.person_id,
    name: `${z.vorname} ${z.nachname}`,
    vorname: z.vorname,
    nachname: z.nachname,
    telefon: z.telefon,
    anstellungen: Number(z.anstellungen),
    aktiveAnstellungen: Number(z.aktive),
    nachweise: darfNachweise ? Number(z.nachweise) : null,
    hatZugang: z.hat_zugang,
    zusammengefuehrtIn: z.zusammengefuehrt_in,
    erstelltAm: z.erstellt_am,
  }));
}

export interface ZusammenfuehrenEingabe {
  /** Die veraltete Zeile — sie bleibt und zeigt danach auf die fuehrende. */
  readonly dublettePersonId: string;
  readonly fuehrendPersonId: string;
  readonly grund: string;
  /** Muss dem Nachnamen der fuehrenden Zeile entsprechen. */
  readonly bestaetigung: string;
}

/**
 * Fuehrt zwei Zeilen zusammen — in EINER Transaktion, ueber die
 * Definer-Funktion.
 *
 * **Die getippte Bestaetigung ist der Nachname der fuehrenden Zeile.** Nicht
 * ein „Ja, ich bin sicher"-Kaestchen: das wird angehakt. Wer den Namen tippt,
 * hat die fuehrende Zeile gelesen — und genau die Verwechslung „falsche Zeile
 * als fuehrend gewaehlt" ist der Fehler, der hier teuer ist.
 */
export async function fuehreZusammen(
  kontext: SchreibKontext, eingabe: ZusammenfuehrenEingabe,
): Promise<void> {
  if (eingabe.dublettePersonId === eingabe.fuehrendPersonId) {
    throw new ZusammenfuehrenFehler('Ein Mensch ist keine Dublette von sich selbst.');
  }
  if (eingabe.grund.trim() === '') {
    throw new ZusammenfuehrenFehler(
      'Eine Zusammenführung ohne Begründung ist kein Vorgang, sondern ein Klick.');
  }

  const [fuehrend] = await kontext.abfrage<{ nachname: string }>(
    `select nachname from person where id = $1::uuid and geloescht_am is null`,
    [eingabe.fuehrendPersonId],
  );
  if (fuehrend === undefined) {
    throw new ZusammenfuehrenFehler(
      'Die führende Zeile ist in dieser Gesellschaft nicht sichtbar.');
  }
  if (eingabe.bestaetigung.trim().toLowerCase() !== fuehrend.nachname.trim().toLowerCase()) {
    throw new BestaetigungFehlt();
  }

  /*
   * Recht, Mandant, Zyklusfreiheit und Protokoll stecken in der
   * Definer-Funktion (0194) — nicht hier. Ein Dienst, der den Zeiger selbst
   * setzte, koennte es nicht: `cse_app` hat auf der Spalte kein UPDATE, und
   * das ist die Zusage.
   */
  await kontext.schreibe(
    `select app.person_zusammenfuehren($1::uuid, $2::uuid, $3::text)`,
    [eingabe.dublettePersonId, eingabe.fuehrendPersonId, eingabe.grund.trim()],
  );
}
