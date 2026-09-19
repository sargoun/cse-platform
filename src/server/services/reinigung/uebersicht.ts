import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';
import { listeNachweise, type NachweisKopf } from './leistungsnachweis.js';
import { listeTurnusse, type TurnusZeile } from './turnus.js';

/**
 * Der Modulkopf der Reinigung — drei Fragen, drei Antworten (CLN-01, CLN-02,
 * CLN-04).
 *
 * **Die Seite beantwortet: was läuft heute, was ist noch nicht unterschrieben,
 * und läuft der Generator.** Die dritte ist die unauffällige und die
 * wichtigste: eine Serie, deren `generiert_bis` in der Vergangenheit liegt,
 * erzeugt keine Schichten mehr — und ein leerer Dienstplan sieht aus wie ein
 * ruhiger Tag.
 *
 * **Warum jede Kachel ihr eigenes Recht mitführt.** Die Route ist auf
 * `reinigung.lesen` bewacht (Routenmanifest). Die Kacheln lesen aber
 * `einsatz`/`planungsserie` (`dienstplan.lesen`) und `leistungsnachweis`
 * (`nachweis.lesen`). RLS filtert still: ohne das zweite Recht stünde hier
 * dreimal eine Null, und „0 offene Nachweise" ist eine Entwarnung, die
 * niemand geprüft hat. Jede Kachel ist deshalb `null`, wenn ihr Recht fehlt —
 * `null` heisst „nicht geprüft", `0` heisst „geprüft, nichts offen". Die
 * Oberfläche muss die beiden unterscheiden, und nur so kann sie es.
 *
 * Die Gegenprobe zur naheliegenden Abkürzung: `dienstplan.lesen` ins
 * Routenmanifest zu schreiben wäre die andere Lösung — sie würde aber eine
 * Reinigungsleitung ohne Dienstplanrecht vom ganzen Modulkopf aussperren
 * (404, AUT-06), statt ihr drei von vier Auskünften zu geben.
 */

/** Die Rechte, die der Kopf ausser `reinigung.lesen` gern hätte. */
export const KOPF_FREMDRECHTE = [
  'dienstplan.lesen', 'nachweis.lesen', 'objekt.lesen', 'katalog.lesen',
] as const;

export interface HeuteSchicht {
  readonly id: string;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly objekt: string;
  readonly revier: string | null;
  readonly besetzt: number;
  readonly soll: number;
  readonly status: string;
}

export interface ReinigungKopf {
  /** Der Berliner Kalendertag, auf den sich „heute" bezieht. */
  readonly heute: string;
  readonly geprueft: Readonly<Record<string, boolean>>;
  readonly reviere: number;
  /** `null` heisst: `dienstplan.lesen` fehlt. */
  readonly schichtenHeute: readonly HeuteSchicht[] | null;
  /** `null` heisst: `nachweis.lesen` fehlt. */
  readonly offeneNachweise: readonly NachweisKopf[] | null;
  readonly turnusse: readonly TurnusZeile[];
  /**
   * Turnusse, deren Serie stehen geblieben ist — `generiert_bis` liegt vor
   * heute, oder es gibt eine Serie und `generiert_bis` ist NULL.
   *
   * `null` heisst: ohne `dienstplan.lesen` nicht feststellbar.
   */
  readonly stehendeSerien: readonly TurnusZeile[] | null;
  /**
   * Turnusse ohne Serie — der Generator hat sie noch nie gesehen.
   *
   * `null` heisst: ohne `dienstplan.lesen` nicht feststellbar. Eine Liste
   * aller Turnusse waere hier der Fehlalarm zur Entwarnung nebenan.
   */
  readonly ohneSerie: readonly TurnusZeile[] | null;
}

/**
 * Die Zustände, in denen ein Leistungsnachweis noch Arbeit macht.
 *
 * `entwurf` und `vorgelegt` — und ausdrücklich nicht `abgelehnt`: ein
 * abgelehnter Nachweis ist ein Streitfall und gehört in die Reklamationen,
 * nicht in eine Kachel „noch zu unterschreiben".
 */
export const OFFENE_NACHWEIS_STATUS = ['entwurf', 'vorgelegt'] as const;

export async function ladeReinigungKopf(
  kontext: LeseKontext, heute: string,
): Promise<ReinigungKopf> {
  const geprueft = await rechteImKontext(kontext, ...KOPF_FREMDRECHTE);

  const [revierZahl] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl from revier where archiviert_am is null`,
  );

  /*
   * Die Schichten des BERLINER Kalendertages, über die Überschneidung und
   * nicht über `plan_datum`: eine Nachtreinigung, die um 22:00 des Vortags
   * beginnt, läuft heute — und fehlte bei `plan_datum = heute` lautlos.
   *
   * **WELCHE Schicht eine Reinigungsschicht ist.** `quelle = 'turnus'` allein
   * war zu eng: `einsatz_quelle` kennt ausserdem `sonderleistung` und
   * `manuell`, und eine so entstandene Reinigungsschicht fiel lautlos heraus —
   * die Seite schrieb dann „Für heute steht keine Reinigungsschicht im Plan",
   * also genau die stille Entwarnung, gegen die sie gebaut ist. Heute fällt
   * das nicht auf, weil es für solche Einsätze noch keinen Anlegeweg gibt;
   * beim ersten fällt es einmal auf, und zwar falsch.
   *
   * `revier_id is not null` ist die Tatsache, an der es hängt: ein Revier
   * gehört zur Reinigung. Die beiden Quellen daneben fangen die Schicht, die
   * noch kein Revier trägt. Posten- und Veranstaltungsschichten der Sicherheit
   * tragen kein Revier und bleiben draussen.
   */
  const schichtenHeute = geprueft['dienstplan.lesen'] === true
    ? await kontext.abfrage<HeuteSchicht>(
      `select e.id,
              to_char(e.beginn_lokal, 'HH24:MI') as "beginnLokal",
              to_char(e.ende_lokal, 'HH24:MI')   as "endeLokal",
              coalesce(o.bezeichnung, '—')       as objekt,
              r.bezeichnung                      as revier,
              e.besetzt_anzahl::int              as besetzt,
              e.soll_besetzung::int              as soll,
              e.status::text                     as status
         from einsatz e
         left join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
         left join revier r on r.mandant_id = e.mandant_id and r.id = e.revier_id
        -- Reinigungsschicht: Revier ODER eine Reinigungsquelle. Begruendung
        -- im Kommentar ueber dieser Abfrage.
        where (e.revier_id is not null
               or e.quelle in ('turnus', 'sonderleistung'))
          and e.storniert_am is null
          and e.ende_zeitpunkt   > ($1::date::timestamp)       at time zone 'Europe/Berlin'
          and e.beginn_zeitpunkt < (($1::date + 1)::timestamp) at time zone 'Europe/Berlin'
        order by e.beginn_zeitpunkt, o.bezeichnung nulls last
        limit 100`,
      [heute],
    )
    : null;

  const offeneNachweise = geprueft['nachweis.lesen'] === true
    ? await listeNachweise(kontext, { status: OFFENE_NACHWEIS_STATUS })
    : null;

  const { zeilen: turnusse } = await listeTurnusse(kontext);
  const lebend = turnusse.filter((t) => !t.archiviert);
  const planbar = geprueft['dienstplan.lesen'] === true;

  return {
    heute,
    geprueft,
    reviere: Number(revierZahl?.anzahl ?? '0'),
    schichtenHeute,
    offeneNachweise,
    turnusse,
    stehendeSerien: planbar
      ? lebend.filter((t) => t.planungsserieId !== null
        && (t.generiertBis === null || t.generiertBis < heute))
      : null,
    ohneSerie: planbar ? lebend.filter((t) => t.planungsserieId === null) : null,
  };
}
