import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Der EINZELNE Planungskonflikt (TIM-05, TIM-06, TIM-14, SEC-04).
 *
 * **Warum es diese Datei gibt.** Der Konflikteingang
 * (`/portal/[mandant]/dienstplan/konflikte`) trug seine Abfrage in der Seite,
 * und die beiden Detailblaetter — Quittung und Uebersteuern — braeuchten sie
 * ein zweites und ein drittes Mal. Drei Fassungen derselben Abfrage sind zwei
 * zu viel: sobald eine davon `hinfaellig_am` vergisst, zeigt ein Blatt einen
 * Konflikt als offen, den die Liste schon nicht mehr fuehrt, und beides sieht
 * richtig aus.
 *
 * **Drei Rechte, nicht eines** — und das ist der Befund, der diese Datei
 * geprägt hat. Das Routenmanifest tort `…/quittung` auf
 * `dienstplan.konflikt_quittieren` und `…/uebersteuern` auf
 * `dienstplan.arbzg_uebersteuern`. Die POLICIES fragen etwas anderes:
 * `planungs_konflikt` ist fuer `cse_app` nur mit `dienstplan.lesen` lesbar
 * (`t_mandant`), `arbeitszeit_verstoss` nur mit `dienstplan.arbzg_lesen`. Eine
 * Sitzung, die das Tor passiert und `dienstplan.lesen` nicht haelt, bekommt
 * null Zeilen — von aussen ein 404 ohne Grund. Und ohne
 * `dienstplan.arbzg_lesen` bleibt der ArbZG-Kasten leer, weil der `left join`
 * nichts findet: ein leerer Kasten, der aussieht wie „kein Befund", wo
 * „nicht einsehbar" die Wahrheit ist.
 *
 * Deshalb liefert `leseKonflikt` `arbzgSichtbar` MIT und nicht bloss die
 * Spalten. Die Seite kann dann sagen, was los ist, statt zu schweigen.
 *
 * **K-06: ein fremder Mandant ist ein DASS.** `betrifft_fremden_mandant`
 * kommt mit; die andere Gesellschaft, ihr Objekt und ihr Kunde kommen nicht —
 * weder hier noch in `details`. Der Planer erfaehrt, dass die Person
 * anderweitig gebunden ist; alles Weitere geht ihn nichts an.
 */

export interface KonfliktBlatt {
  readonly id: string;
  readonly art: 'ueberschneidung' | 'qualifikation_entfallen' | 'arbzg' | 'aufzeichnungsfrist';
  readonly schwere: string;
  readonly status: 'offen' | 'quittiert' | 'behoben' | 'hinfaellig';
  readonly blockiert: boolean;
  /** NUR dass — nie welche Gesellschaft (K-06). */
  readonly fremd: boolean;
  readonly person: string;
  readonly personId: string;
  readonly einsatzId: string | null;
  readonly objekt: string | null;
  /** `DD.MM.YYYY HH24:MI`, Europe/Berlin — aus der Abfrage, nie aus dem Klienten. */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly dauerMinuten: number;
  readonly erkanntLokal: string;
  readonly erkanntDurch: string;
  readonly hinfaellig: boolean;
  readonly quittiertAmLokal: string | null;
  readonly quittiertVon: string | null;
  readonly quittierungBegruendung: string | null;
  /** Die Gegenschichten einer Ueberschneidung — fertig beschriftet, Berlin. */
  readonly gegenschichten: readonly string[];
  readonly arbeitszeitVerstossId: string | null;
  /**
   * Haelt die Sitzung `dienstplan.arbzg_lesen`?
   *
   * `false` heisst: der ArbZG-Block ist NICHT EINSEHBAR. Er ist nicht leer,
   * und die Seite darf ihn nicht als „kein Befund" darstellen.
   */
  readonly arbzgSichtbar: boolean;
  readonly verstoss: ArbzgBlatt | null;
}

export interface ArbzgBlatt {
  readonly id: string;
  readonly regel: string;
  readonly schwere: string;
  readonly status: 'offen' | 'quittiert' | 'behoben' | 'hinfaellig';
  readonly istMinuten: number;
  readonly grenzwertMinuten: number;
  /** Ist der Grenzwert eine UNTERgrenze? § 5 ArbZG verlangt 11 Stunden MINDESTENS. */
  readonly grenzwertIstMindestwert: boolean;
  readonly fremd: boolean;
  /**
   * Ist dieser Befund UEBERHOLT?
   *
   * `hinfaellig_am is not null` bei weiterhin `status = 'offen'` — so schreibt
   * es `app.arbzg_befund_ueberholen` (der Nachtlauf raeumt auf, laesst den
   * Status aber stehen, weil eine Quittierung ihre Begruendung behalten
   * soll). Der Status allein sagt hier also NICHT, ob der Befund noch
   * uebersteuerbar ist: `app.arbzg_befund_quittieren` aktualisiert nur
   * `where v.hinfaellig_am is null` und protokolliert danach bedingungslos.
   * Ohne dieses Feld endet ein ueberholter Befund als null geaenderte Zeilen,
   * ein Pruefprotokolleintrag ueber eine Uebersteuerung, die es nicht gibt,
   * und ein gruener Satz auf dem Bildschirm.
   */
  readonly hinfaellig: boolean;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly quittiertAmLokal: string | null;
  readonly quittiertVon: string | null;
  readonly quittierungBegruendung: string | null;
}

/**
 * Bei welchen Regeln der Grenzwert eine UNTERgrenze ist.
 *
 * Steht hier und nicht in zwei Seiten: „4,07 h statt höchstens 11,00 h" ist
 * bei einer Ruhezeit schlicht falsch herum, und eine Warnung, die ihren
 * eigenen Paragrafen verdreht, macht aus einem Befund eine Formulierung, der
 * niemand traut.
 */
const MINDESTWERT: ReadonlySet<string> = new Set(['ruhezeit_unter_11h']);

export function grenzwertIstMindestwert(regel: string): boolean {
  return MINDESTWERT.has(regel);
}

interface RohKonflikt {
  id: string;
  art: KonfliktBlatt['art'];
  schwere: string;
  status: KonfliktBlatt['status'];
  blockiert: boolean;
  fremd: boolean;
  person: string;
  person_id: string;
  einsatz_id: string | null;
  objekt: string | null;
  beginn_lokal: string;
  ende_lokal: string;
  dauer_minuten: number;
  erkannt_lokal: string;
  erkannt_durch: string;
  hinfaellig: boolean;
  quittiert_am_lokal: string | null;
  quittiert_von: string | null;
  quittierung_begruendung: string | null;
  gegenschichten: readonly string[];
  arbeitszeit_verstoss_id: string | null;
  arbzg_sichtbar: boolean;
  v_id: string | null;
  v_regel: string | null;
  v_schwere: string | null;
  v_status: ArbzgBlatt['status'] | null;
  v_ist_minuten: number | null;
  v_grenzwert_minuten: number | null;
  v_fremd: boolean | null;
  v_hinfaellig: boolean | null;
  v_beginn_lokal: string | null;
  v_ende_lokal: string | null;
  v_quittiert_am_lokal: string | null;
  v_quittiert_von: string | null;
  v_quittierung_begruendung: string | null;
}

/**
 * Ein Konflikt — oder `null`.
 *
 * `null` heisst nach aussen 404 und nie 403 (AUT-06): eine fremde Zeile ist
 * nicht vorhanden, nicht verboten. Die RLS hat hier schon entschieden, und
 * diese Funktion fragt nicht nach, warum.
 *
 * Die Dauer kommt als Differenz zweier INSTANTS aus der Datenbank
 * (Invariante 2) — nicht aus den formatierten Wanduhrzeiten daneben. In der
 * Rueckstellungsnacht sind 22:00 bis 06:00 neun Stunden, und wer sie aus
 * „22:00" und „06:00" rechnet, bekommt acht.
 */
export async function leseKonflikt(
  kontext: LeseKontext, id: string,
): Promise<KonfliktBlatt | null> {
  const [z] = await kontext.abfrage<RohKonflikt>(
    `select k.id, k.art::text as art, k.schwere::text as schwere, k.status::text as status,
            k.blockiert, k.betrifft_fremden_mandant as fremd,
            (p.vorname || ' ' || p.nachname) as person, k.person_id,
            k.einsatz_id, o.bezeichnung as objekt,
            to_char((k.zeitraum_beginn at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as beginn_lokal,
            to_char((k.zeitraum_ende   at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as ende_lokal,
            (extract(epoch from (k.zeitraum_ende - k.zeitraum_beginn)) / 60)::int
              as dauer_minuten,
            to_char((k.erkannt_am at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as erkannt_lokal,
            k.erkannt_durch::text as erkannt_durch,
            (k.hinfaellig_am is not null) as hinfaellig,
            to_char((k.quittiert_am at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as quittiert_am_lokal,
            qb.name as quittiert_von,
            k.quittierung_begruendung,
            coalesce((
              select array_agg(t.x)
                from jsonb_array_elements_text(
                       case when jsonb_typeof(k.details->'gegenschichten') = 'array'
                            then k.details->'gegenschichten'
                            else '[]'::jsonb end) as t(x)
            ), '{}'::text[]) as gegenschichten,
            k.arbeitszeit_verstoss_id,
            app.hat_recht('dienstplan.arbzg_lesen', app.aktiver_mandant()) as arbzg_sichtbar,
            v.id                        as v_id,
            v.regel::text               as v_regel,
            v.schwere::text             as v_schwere,
            v.status::text              as v_status,
            v.ist_minuten               as v_ist_minuten,
            v.grenzwert_minuten         as v_grenzwert_minuten,
            v.betrifft_fremden_mandant  as v_fremd,
            (v.hinfaellig_am is not null) as v_hinfaellig,
            to_char((v.zeitraum_beginn at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as v_beginn_lokal,
            to_char((v.zeitraum_ende   at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as v_ende_lokal,
            to_char((v.quittiert_am at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
              as v_quittiert_am_lokal,
            vqb.name                    as v_quittiert_von,
            v.quittierung_begruendung   as v_quittierung_begruendung
       from planungs_konflikt k
       join person p on p.id = k.person_id
       left join einsatz e on e.mandant_id = k.mandant_id and e.id = k.einsatz_id
       left join objekt  o on o.mandant_id = k.mandant_id and o.id = e.objekt_id
       left join benutzer qb on qb.id = k.quittiert_von
       left join arbeitszeit_verstoss v on v.id = k.arbeitszeit_verstoss_id
       left join benutzer vqb on vqb.id = v.quittiert_von
      where k.id = $1`,
    [id],
  );
  if (z === undefined) return null;

  const verstoss: ArbzgBlatt | null = z.v_id === null || z.v_regel === null
    ? null
    : {
      id: z.v_id,
      regel: z.v_regel,
      schwere: z.v_schwere ?? '',
      status: z.v_status ?? 'offen',
      istMinuten: Number(z.v_ist_minuten ?? 0),
      grenzwertMinuten: Number(z.v_grenzwert_minuten ?? 0),
      grenzwertIstMindestwert: grenzwertIstMindestwert(z.v_regel),
      fremd: z.v_fremd === true,
      hinfaellig: z.v_hinfaellig === true,
      beginnLokal: z.v_beginn_lokal ?? '',
      endeLokal: z.v_ende_lokal ?? '',
      quittiertAmLokal: z.v_quittiert_am_lokal,
      quittiertVon: z.v_quittiert_von,
      quittierungBegruendung: z.v_quittierung_begruendung,
    };

  return {
    id: z.id,
    art: z.art,
    schwere: z.schwere,
    status: z.status,
    blockiert: z.blockiert,
    fremd: z.fremd,
    person: z.person,
    personId: z.person_id,
    einsatzId: z.einsatz_id,
    objekt: z.objekt,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    dauerMinuten: Number(z.dauer_minuten),
    erkanntLokal: z.erkannt_lokal,
    erkanntDurch: z.erkannt_durch,
    hinfaellig: z.hinfaellig,
    quittiertAmLokal: z.quittiert_am_lokal,
    quittiertVon: z.quittiert_von,
    quittierungBegruendung: z.quittierung_begruendung,
    gegenschichten: z.gegenschichten,
    arbeitszeitVerstossId: z.arbeitszeit_verstoss_id,
    arbzgSichtbar: z.arbzg_sichtbar === true,
    verstoss,
  };
}

/**
 * Einen ArbZG-Befund uebersteuern — **ueber den Definer und nur so**.
 *
 * `arbeitszeit_verstoss` gewaehrt `cse_app` KEIN Tabellenrecht `UPDATE`: ein
 * direktes `update` bricht mit `permission denied for table
 * arbeitszeit_verstoss` ab, also mit einem 500er. (Nicht „still mit null
 * Zeilen" — das waere die andere, harmlosere Fehlerlage, und wer sie
 * annimmt, baut eine Zeilenzahl-Pruefung statt den richtigen Weg.) Die
 * Policies zaehlen UPDATE nur fuer `cse_definer`
 * (`verstoss_definer_update`) und `cse_job` (`t_job_frist`).
 *
 * Der Weg ist deshalb `app.arbzg_befund_quittieren` — und die Funktion prueft
 * `dienstplan.arbzg_lesen`, also das SCHWAECHERE Recht. Das staerkere,
 * `dienstplan.arbzg_uebersteuern`, setzt die Route mit `authorize()` durch;
 * die Datenbank ist hier die zweite Linie und ausdruecklich die schwaechere.
 * Bis eine Migration den Definer nachzieht, steht das als D-Zeile im Register
 * (siehe docs/DECISIONS.md) — verlassen darf sich niemand darauf.
 */
export class BefundNichtMehrAktuell extends Error {
  readonly code = 'nicht_mehr_aktuell';
  readonly status = 409;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'BefundNichtMehrAktuell';
  }
}

export async function uebersteuereBefund(
  kontext: {
    schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
    abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  },
  befundId: string, begruendung: string,
): Promise<void> {
  await kontext.schreibe(
    `select app.arbzg_befund_quittieren($1::uuid, $2)`,
    [befundId, begruendung.trim()],
  );

  /**
   * **Nachlesen, ob es wirklich geschehen ist** — und das ist kein Gürtel zum
   * Hosenträger.
   *
   * `app.arbzg_befund_quittieren` aktualisiert `where v.id = p_id and
   * v.hinfaellig_am is null` und protokolliert danach BEDINGUNGSLOS
   * `arbzg.befund_quittiert`. Ein ueberholter Befund traegt aber
   * `hinfaellig_am is not null` bei weiterhin `status = 'offen'` (so schreibt
   * es `app.arbzg_befund_ueberholen`, weil eine Quittierung ihre Begruendung
   * behalten soll). Ohne diese Nachlese endeten null geaenderte Zeilen als
   * gruener Satz „Der Befund ist übersteuert" — neben einem ArbZG-Block, der
   * weiter „offen" sagt, und einem Pruefprotokolleintrag, der eine
   * Uebersteuerung behauptet, die es nicht gibt.
   *
   * Erreichbar ist das nicht nur theoretisch: zwischen dem gerenderten
   * Formular und dem Absenden laeuft der Nachtlauf (`raeumeAuf` in
   * `arbzg/detektor.ts`), und ein nachgebauter POST braucht das Rennen gar
   * nicht.
   */
  const [danach] = await kontext.abfrage<{ status: string; hinfaellig: boolean }>(
    `select v.status::text as status, (v.hinfaellig_am is not null) as hinfaellig
       from arbeitszeit_verstoss v where v.id = $1::uuid`,
    [befundId],
  );
  if (danach === undefined || danach.status !== 'quittiert') {
    throw new BefundNichtMehrAktuell(
      danach?.hinfaellig === true
        ? 'Dieser Befund ist inzwischen überholt — der Nachtlauf hat ihn abgeräumt, '
          + 'weil die zugrunde liegende Einteilung sich geändert hat. Es gibt nichts '
          + 'mehr zu übersteuern.'
        : 'Die Übersteuerung wurde nicht geschrieben. Der Befund steht unverändert.',
    );
  }
}
