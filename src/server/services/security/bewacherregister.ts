import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';
import { modulAktiv, type Modulbuchung } from '../../registry/modul.js';

/**
 * Das Bewacherregister — § 34a GewO, handerfasst (SEC-03, LEG-04, D-09).
 *
 * **Es gibt keine Schnittstelle zum Bewacherregister, und diese Datei tut
 * nicht so.** Kein Abgleich, kein „Status abrufen", keine simulierte Antwort.
 * `bewacher_eintrag.quelle` ist per Prüfbedingung auf `'manuell'`
 * festgenagelt, und `Bewacherlage.verbindung` führt `'nicht_verbunden'` als
 * Wert — beides ist Absicht: ein Bildschirm, der „registriert" zeigt, muss
 * sagen, ob das jemand abgefragt oder jemand abgetippt hat (CLAUDE.md, „No
 * fake integrations").
 *
 * **Nichts wird validiert, und das ist die schwerere Entscheidung.**
 * Bewacher-ID-Format, Prüfziffer, Pflichtfelder, Statusvokabular und die
 * Meldeereignisse sind offen. Eine Prüfziffernregel zu erfinden hiesse, eine
 * von der Behörde ausgestellte Kennung abzuweisen, weil sie nicht in ein
 * geratenes Muster passt — und das im Register, das über die Einsetzbarkeit
 * eines Menschen entscheidet. Das Feld nimmt deshalb, was die Behörde
 * ausgestellt hat (1 bis 32 Zeichen, so weit reicht die Prüfbedingung der
 * Tabelle), und die Oberfläche kennzeichnet den Stand als handerfasst.
 *
 * // TODO(client, O-40): Welches Format hat die Bewacher-ID (Länge, Prüfziffer, Behördenpräfix), welche Felder sind Pflicht, welches Statusvokabular gilt, und welche Ereignisse sind dem Register zu melden?
 *
 * ## `bewacher_eintrag` trägt KEIN `mandant_id`
 *
 * Der Eintrag hängt am MENSCHEN, nicht an der Gesellschaft (D-09): eine
 * Person mit zwei Anstellungen hat eine Bewacher-ID, nicht zwei. Die Liste
 * wird deshalb über `anstellung` auf den aktiven Mandanten eingegrenzt — und
 * dabei kommt **kein Entgeltfeld** mit. `stundensatz_intern` und `tarifgruppe`
 * sind für `cse_app` nicht einmal gegrantet (K-05); diese Datei fragt sie
 * ohnehin nicht.
 *
 * ## Zwei Rechte, nicht eines
 *
 * Die Route trägt `personal.bewacher_verwalten`. Die Lesepolitik `be_lesen`
 * verlangt aber `personal.nachweis_lesen` (oder die eigene Person), und
 * `be_schreiben`/`be_aendern` verlangen `personal.bewacher_verwalten`. Heute
 * sind beide Rechte an dieselben drei Rollen gebunden und nicht frei bindbar —
 * die Lücke ist also theoretisch, aber sie ist da, und eine leere Liste ohne
 * Auskunft wäre die Aussage „niemand hat einen Eintrag".
 */

export const BEWACHER_STATUS = [
  'beantragt', 'registriert', 'abgelehnt', 'erloschen', 'gesperrt', 'unbekannt',
] as const;
export type BewacherStatus = (typeof BEWACHER_STATUS)[number];

export const STATUS_TEXT: Readonly<Record<BewacherStatus, string>> = {
  beantragt: 'Beantragt',
  registriert: 'Registriert',
  abgelehnt: 'Abgelehnt',
  erloschen: 'Erloschen',
  gesperrt: 'Gesperrt',
  unbekannt: 'Unbekannt',
};

/**
 * Welche Status eine Einteilung ZULASSEN.
 *
 * Genau einer, und das steht nicht hier, sondern im Tor: `nachweislage`
 * rechnet `gueltigAmStichtag` aus `status === 'registriert'` und der
 * Gültigkeit gegen den Stichtag. Diese Liste ist die Anzeigeseite derselben
 * Bedingung — sie DARF nicht davon abweichen, deshalb steht der Grund hier.
 */
export const EINSETZBARE_STATUS: readonly BewacherStatus[] = ['registriert'];

/** Die Verbindung zum Register — ein Wert, kein Zustand, und immer derselbe. */
export const REGISTERVERBINDUNG = 'nicht_verbunden' as const;

/**
 * Der Vorlauf, ab dem eine ablaufende Bewacher-Erlaubnis auffällt —
 * **PLATZHALTER, nicht entschieden.**
 *
 * `bewacher_eintrag` trägt keine Warnstufen: anders als `qualifikation`, wo
 * `warnung_tage` die Schwellen als Daten führt (und `lageVon` sie ausliest),
 * gibt es hier keine Quelle. Sechzig Tage standen als blanke Zahl in der
 * Seite; das ist eine Geschäftsregel, die niemand getroffen hat — mit ihr
 * meldet der Bildschirm eine Frist, die die Behörde so nie gesetzt hat, und
 * ohne sie fiele der Ablauf gar nicht auf.
 *
 * Die Zahl steht deshalb hier, EINMAL, unter ihrem eigenen Namen und mit der
 * Frage daneben — und die Oberfläche kennzeichnet die Kachel als offen. Kommt
 * die Entscheidung, ist es eine Zeile; kommen Warnstufen wie bei
 * `qualifikation`, tritt diese Konstante ersatzlos zurück.
 */
// TODO(client, O-707): In welchem Vorlauf ist eine ablaufende Bewacher-Erlaubnis zu melden, und gehoert die Schwelle in den Eintrag (wie qualifikation.warnung_tage) oder gilt eine feste Frist fuer alle?
export const BEWACHER_VORWARNUNG_TAGE = 60;

export class EintragNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(was: string) {
    super(`Für ${was} gibt es in dieser Gesellschaft keinen Registereintrag.`);
    this.name = 'EintragNichtGefunden';
  }
}

export class BewacherEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'BewacherEingabeFehlt';
  }
}

export interface RegisterZeile {
  readonly personId: string;
  readonly name: string;
  readonly anstellungId: string;
  readonly personalnummer: string | null;
  readonly eintrittAm: string;
  /** `null` heisst: zu dieser Person ist KEIN Eintrag erfasst — die Lücke. */
  readonly eintragId: string | null;
  readonly bewacherId: string | null;
  readonly status: BewacherStatus | null;
  readonly registriertSeit: string | null;
  readonly gueltigBis: string | null;
  /** Tage bis zum Ablauf; negativ heisst „seit so vielen Tagen abgelaufen". */
  readonly restTage: number | null;
  readonly letztePruefungAm: string | null;
  readonly naechstePruefungAm: string | null;
  readonly registerauszugDokumentId: string | null;
  readonly bemerkung: string | null;
  /** Immer `'manuell'` — die Prüfbedingung der Tabelle lässt nichts anderes zu. */
  readonly quelle: string | null;
  /**
   * Deckt der Eintrag den Stichtag so, dass eine Einteilung zulässig ist?
   *
   * Dieselbe Bedingung wie im § 34a-Tor: Status `registriert` UND
   * (`gueltig_bis` leer ODER `gueltig_bis >= Stichtag`).
   */
  readonly einsetzbarAmStichtag: boolean;
}

interface RegisterRoh {
  person_id: string;
  name: string;
  anstellung_id: string;
  personalnummer: string | null;
  eintritt_am: string;
  eintrag_id: string | null;
  bewacher_id: string | null;
  status: string | null;
  registriert_seit: string | null;
  gueltig_bis: string | null;
  rest_tage: number | null;
  letzte_pruefung_am: string | null;
  naechste_pruefung_am: string | null;
  registerauszug_dokument_id: string | null;
  bemerkung: string | null;
  quelle: string | null;
  einsetzbar: boolean;
}

function alsZeile(z: RegisterRoh): RegisterZeile {
  return {
    personId: z.person_id,
    name: z.name,
    anstellungId: z.anstellung_id,
    personalnummer: z.personalnummer,
    eintrittAm: z.eintritt_am,
    eintragId: z.eintrag_id,
    bewacherId: z.bewacher_id,
    status: z.status === null
      ? null : (BEWACHER_STATUS.find((s) => s === z.status) ?? 'unbekannt'),
    registriertSeit: z.registriert_seit,
    gueltigBis: z.gueltig_bis,
    restTage: z.rest_tage === null ? null : Number(z.rest_tage),
    letztePruefungAm: z.letzte_pruefung_am,
    naechstePruefungAm: z.naechste_pruefung_am,
    registerauszugDokumentId: z.registerauszug_dokument_id,
    bemerkung: z.bemerkung,
    quelle: z.quelle,
    einsetzbarAmStichtag: z.einsetzbar,
  };
}

export interface RegisterAusschnitt {
  readonly zeilen: readonly RegisterZeile[];
  readonly geprueft: Readonly<Record<string, boolean>>;
  readonly stichtag: string;
  /** Immer `'nicht_verbunden'`. Die Oberfläche muss es sagen. */
  readonly verbindung: typeof REGISTERVERBINDUNG;
}

/**
 * Das Register über die Menschen mit lebender Anstellung im aktiven Mandanten.
 *
 * **Personen OHNE Eintrag stehen mit in der Liste**, und das ist der Punkt:
 * genau sie sind die Lücke, die SEC-03 sichtbar machen soll. Eine Liste, die
 * nur die erfassten Einträge zeigt, wäre am kürzesten, wenn niemand etwas
 * erfasst hat.
 *
 * **Sortiert nach Ablauf, nicht nach Name** — wie das Nachweisregister:
 * abgelaufen zuerst, dann die nahen Fristen, dann die ohne Eintrag, dann der
 * Rest. Die Reihenfolge ist die, in der jemand die Liste abarbeitet.
 *
 * **Die Restlaufzeit rechnet die DATENBANK.** `gueltig_bis` ist ein `date`,
 * und eine Differenz zweier Kalendertage in JavaScript ist eine
 * Zeitzonenfrage, die niemand sehen will (K-11).
 */
export async function leseRegister(
  kontext: LeseKontext, stichtag: string,
): Promise<RegisterAusschnitt> {
  const geprueft = await rechteImKontext(
    kontext, 'personal.nachweis_lesen', 'dokument.lesen',
  );
  const zeilen = await kontext.abfrage<RegisterRoh>(
    /*
     * `join anstellung` ist die Mandantengrenze dieser Liste, nicht die RLS
     * von `bewacher_eintrag`: die Tabelle traegt kein `mandant_id`, weil der
     * Eintrag am Menschen haengt (D-09). Ohne diesen Verbund stuenden hier
     * die Bewacher jeder Schwestergesellschaft.
     *
     * KEIN Entgeltfeld. `anstellung` traegt `stundensatz_intern` und
     * `tarifgruppe`; die beiden sind fuer `cse_app` nicht gegrantet (K-05),
     * und diese Abfrage nennt sie auch nicht.
     */
    `select p.id                                  as person_id,
            (p.vorname || ' ' || p.nachname)      as name,
            a.id                                  as anstellung_id,
            a.personalnummer,
            to_char(a.eintritt, 'YYYY-MM-DD')     as eintritt_am,
            b.id                                  as eintrag_id,
            b.bewacher_id,
            b.status::text                        as status,
            to_char(b.registriert_seit, 'YYYY-MM-DD')     as registriert_seit,
            to_char(b.gueltig_bis, 'YYYY-MM-DD')          as gueltig_bis,
            case when b.gueltig_bis is null then null
                 else (b.gueltig_bis - $1::date) end::int as rest_tage,
            to_char(b.letzte_pruefung_am, 'YYYY-MM-DD')   as letzte_pruefung_am,
            to_char(b.naechste_pruefung_am, 'YYYY-MM-DD') as naechste_pruefung_am,
            b.registerauszug_dokument_id,
            b.bemerkung,
            b.quelle,
            coalesce(
              b.status = 'registriert'
                and (b.gueltig_bis is null or b.gueltig_bis >= $1::date),
              false)                              as einsetzbar
       from anstellung a
       join person p on p.id = a.person_id
       left join bewacher_eintrag b
              on b.person_id = p.id and b.erloschen_am is null
      where a.mandant_id = app.aktiver_mandant()
        and a.geloescht_am is null
        -- „Lebend am Stichtag": anstellung.status kennt genau vier Werte
        -- (geplant | aktiv | ruhend | beendet, Pruefbedingung auf der
        -- Tabelle), und austritt ist die zweite Haelfte derselben Aussage.
        -- Eine beendete Anstellung gehoert nicht in ein Register darueber,
        -- wer heute eingeteilt werden darf.
        -- (Kommentar OHNE Backticks: sie beenden das Template-Literal.)
        and a.status <> 'beendet'
        and (a.austritt is null or a.austritt >= $1::date)
      order by
        -- abgelaufen zuerst, dann nahe Fristen, dann „kein Eintrag", dann der Rest
        case
          when b.id is null then 2
          when b.gueltig_bis is not null and b.gueltig_bis < $1::date then 0
          when b.status <> 'registriert' then 1
          when b.gueltig_bis is not null then 3
          else 4
        end,
        b.gueltig_bis asc nulls last,
        p.nachname, p.vorname
      limit 500`,
    [stichtag],
  );
  return {
    zeilen: zeilen.map(alsZeile),
    geprueft,
    stichtag,
    verbindung: REGISTERVERBINDUNG,
  };
}

/**
 * Ist das Security-Modul in dieser Gesellschaft überhaupt gebucht?
 *
 * **Warum das hier steht und nicht in der zentralen Sperre.** Die Modulsperre
 * in `app/portal/zugang.ts` prüft ausschliesslich den MODULTEIL der
 * Routenrechte. Diese Route trägt als einziges Recht
 * `personal.bewacher_verwalten`, und `personal` steht in `QUERSCHNITT` — also
 * greift die Sperre nicht. `/portal/bau/security/bewacherregister` wäre damit
 * für jede `admin`/`leitung` erreichbar, obwohl REALTIME Service kein Security
 * gebucht hat. Die Liste wäre dort leer (sie ist über `anstellung`
 * eingegrenzt), und ein leeres Bewacherregister in einer Baugesellschaft ist
 * eine Aussage, die niemand treffen wollte.
 *
 * Geprüft wird gegen `security.lesen` — dasselbe Vokabular, das `modulAktiv`
 * überall benutzt. Die Antwort ist `false` → die Seite gibt 404 (AUT-06:
 * nicht gebucht sieht aus wie nicht vorhanden, D-377).
 */
export async function securityGebucht(kontext: LeseKontext): Promise<boolean> {
  const [zeile] = await kontext.abfrage<{
    module: readonly string[] | null; gepflegt: boolean | null;
  }>(
    `select m.module, m.module_gepflegt as gepflegt
       from mandant m where m.id = app.aktiver_mandant()`,
  );
  const buchung: Modulbuchung = {
    module: zeile?.module ?? [],
    gepflegt: zeile?.gepflegt === true,
  };
  return modulAktiv(buchung, 'security.lesen');
}

export interface EintragEingabe {
  readonly personId: string;
  /**
   * Die Kennung, wie die Behörde sie ausgestellt hat.
   *
   * Es wird KEIN Format geprüft — siehe O-40 im Kopf dieser Datei. Was geprüft
   * wird, ist die Prüfbedingung der Tabelle (1 bis 32 Zeichen nach `btrim`),
   * und die geprüft der Dienst vorher, damit die Meldung ein Satz ist und
   * keine Bedingungsverletzung.
   */
  readonly bewacherId: string;
  readonly status: BewacherStatus;
  readonly registriertSeit?: string | null;
  readonly gueltigBis?: string | null;
  readonly letztePruefungAm?: string | null;
  readonly naechstePruefungAm?: string | null;
  readonly bemerkung?: string | null;
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

function pruefeFelder(e: EintragEingabe): {
  bewacherId: string;
  registriertSeit: string | null;
  gueltigBis: string | null;
  letzte: string | null;
  naechste: string | null;
} {
  const bewacherId = e.bewacherId.trim();
  if (bewacherId === '' || bewacherId.length > 32) {
    throw new BewacherEingabeFehlt(
      'Die Bewacher-ID hat 1 bis 32 Zeichen. Ein Format wird nicht geprüft — '
      + 'welches gilt, ist offen (O-40).');
  }
  if (!BEWACHER_STATUS.includes(e.status)) {
    throw new BewacherEingabeFehlt(
      `Der Status ist einer von: ${BEWACHER_STATUS.join(', ')}.`);
  }
  const felder: [string | null | undefined, string][] = [
    [e.registriertSeit, 'Registriert seit'],
    [e.gueltigBis, 'Gültig bis'],
    [e.letztePruefungAm, 'Letzte Prüfung'],
    [e.naechstePruefungAm, 'Nächste Prüfung'],
  ];
  const werte: (string | null)[] = [];
  for (const [wert, name] of felder) {
    const w = wert === undefined || wert === null || wert === '' ? null : wert;
    if (w !== null && !DATUM.test(w)) {
      throw new BewacherEingabeFehlt(`„${name}" ist ein Kalendertag.`);
    }
    werte.push(w);
  }
  const [registriertSeit, gueltigBis, letzte, naechste] = werte;
  if (registriertSeit != null && gueltigBis != null && gueltigBis < registriertSeit) {
    throw new BewacherEingabeFehlt(
      '„Gültig bis" liegt vor „Registriert seit" (bewacher_zeitraum).');
  }
  return {
    bewacherId,
    registriertSeit: registriertSeit ?? null,
    gueltigBis: gueltigBis ?? null,
    letzte: letzte ?? null,
    naechste: naechste ?? null,
  };
}

/**
 * Einen Eintrag erfassen.
 *
 * **Keine Frist wird abgeleitet.** `naechste_pruefung_am` bleibt leer, wenn
 * niemand sie einträgt: in welchem Abstand das Register nachzuprüfen ist,
 * steht in der GewO-Durchführung und nicht in dieser Anwendung (O-40). Eine
 * abgeleitete Frist wäre ein Versprechen über eine behördliche Pflicht.
 *
 * Die INSERT-Politik `be_schreiben` verlangt `personal.bewacher_verwalten` und
 * `app.person_sichtbar(person_id)` — eine Migration braucht es dafür nicht,
 * die Politik steht schon.
 */
export async function erfasseEintrag(
  kontext: SchreibKontext, e: EintragEingabe,
): Promise<{ readonly id: string }> {
  const f = pruefeFelder(e);
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into bewacher_eintrag
       (person_id, bewacher_id, status, registriert_seit, gueltig_bis,
        letzte_pruefung_am, naechste_pruefung_am, bemerkung, quelle, erstellt_von)
     values ($1::uuid, $2, $3::bewacher_status, $4::date, $5::date,
             $6::date, $7::date, $8, 'manuell', app.aktueller_benutzer())
     returning id`,
    [
      e.personId, f.bewacherId, e.status, f.registriertSeit, f.gueltigBis,
      f.letzte, f.naechste, e.bemerkung ?? null,
    ],
  );
  if (zeile === undefined) {
    throw new BewacherEingabeFehlt(
      'Der Eintrag wurde nicht angelegt — die Person ist in dieser Gesellschaft '
      + 'nicht sichtbar, oder die Sitzung darf hier nicht schreiben.');
  }
  return { id: zeile.id };
}

export interface AenderungEingabe extends EintragEingabe {
  readonly id: string;
}

/**
 * Einen Eintrag fortschreiben — **nie löschen**.
 *
 * `erloschen_am` bleibt hier unberührt: ein erloschener Eintrag ist Historie,
 * und der Teilindex `bewacher_eintrag_person_key` lässt neben ihm einen neuen
 * lebenden Eintrag zu. Das Erlöschen selbst ist ein eigener Vorgang und nicht
 * ein Nebeneffekt einer Feldänderung.
 */
export async function aktualisiereEintrag(
  kontext: SchreibKontext, e: AenderungEingabe,
): Promise<void> {
  const f = pruefeFelder(e);
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update bewacher_eintrag
        set bewacher_id         = $2,
            status              = $3::bewacher_status,
            registriert_seit    = $4::date,
            gueltig_bis         = $5::date,
            letzte_pruefung_am  = $6::date,
            naechste_pruefung_am= $7::date,
            bemerkung           = $8,
            geaendert_von       = app.aktueller_benutzer()
      where id = $1::uuid and erloschen_am is null
     returning id`,
    [
      e.id, f.bewacherId, e.status, f.registriertSeit, f.gueltigBis,
      f.letzte, f.naechste, e.bemerkung ?? null,
    ],
  );
  if (zeilen.length === 0) throw new EintragNichtGefunden(`den Eintrag ${e.id}`);
}
