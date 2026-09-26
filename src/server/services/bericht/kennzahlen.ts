import 'server-only';
import { cent, NULL_CENT, type Cent } from '../finanz/geld.js';
import type { Zeitraum } from './zeitraum.js';

/**
 * Die sechs Berichte aus SPEC §5.23 (REP-01…REP-06) — als Abfragen, nicht als
 * Bildschirme.
 *
 * **Jede Zahl entsteht HIER und keine in einer Seite** (CLAUDE.md: „No
 * calculation in a component, ever"). Eine Seite, die selbst summiert, ist
 * eine Zahl ohne Test — und eine Zahl ohne Test steht irgendwann in einem
 * Angebot.
 *
 * **Geld bleibt `Cent`** (Invariante 1). Die Datenbank liefert `bigint` als
 * Zeichenkette; `cent(BigInt(...))` ist die einzige Stelle, an der sie wieder
 * zu Geld wird, und sie wirft bei allem, was keines ist.
 *
 * **Die Mandantengrenze steht NICHT in diesen Abfragen.** Sie kommt aus der
 * Sitzung: `withTenant` bindet `app.aktiver_mandant()`, RLS filtert. Ein
 * `where mandant_id = $1` hier wäre die zweite Wahrheit, gegen die Invariante
 * 3 geschrieben ist — und die erste, die jemand vergisst.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

const geld = (roh: unknown): Cent =>
  (roh === null || roh === undefined ? NULL_CENT : cent(BigInt(String(roh))));

const zahl = (roh: unknown): number => Number(roh ?? 0);

// ---------------------------------------------------------------------------
// REP-01 — Umsatz, Aufwand, Ergebnis
// ---------------------------------------------------------------------------

export interface UmsatzZeile {
  readonly zeitraum: Zeitraum;
  readonly erloeseCent: Cent;
  readonly rechnungen: number;
  readonly aufwandCent: Cent;
  readonly eingangsrechnungen: number;
  readonly ergebnisCent: Cent;
}

/**
 * Umsatz je Abschnitt — aus FESTGESCHRIEBENEN Rechnungen.
 *
 * **Entwürfe zählen nicht.** Ein Entwurf hat keine Nummer (Invariante 4), er
 * ist noch keine Forderung, und wer ihn mitzählt, meldet einen Umsatz, den er
 * zurücknehmen muss. Stornos zählen mit ihrem Vorzeichen: eine Reversierung
 * ist eine Buchung, kein Löschen.
 *
 * Das Datum ist `rechnungsdatum` und nicht `erstellt_am`: eine Rechnung, die
 * am 2. Januar für den Dezember geschrieben wird, gehört in den Dezember.
 *
 * `status = 'festgeschrieben'` und nicht `<> 'entwurf'`: `rechnung_status`
 * führt auch `verworfen`, und eine verworfene Rechnung ist kein Umsatz. Der
 * Unterschied ist genau eine Zeile und genau ein falscher Jahresumsatz.
 */
export async function umsatzReihe(
  db: Abfrage, abschnitte: readonly Zeitraum[],
): Promise<readonly UmsatzZeile[]> {
  const zeilen: UmsatzZeile[] = [];
  for (const z of abschnitte) {
    const [aus] = await db.abfrage<{ summe: string | null; anzahl: string }>(
      `select coalesce(sum(r.brutto_cent), 0)::text as summe, count(*)::text as anzahl
         from rechnung r
        where r.status = 'festgeschrieben'
          and r.rechnungsdatum between $1::date and $2::date`,
      [z.von, z.bis],
    );
    /**
     * **Aufwand zaehlt ab `freigegeben`.** `eingangsrechnung_status` kennt
     * keinen Entwurf: eine Eingangsrechnung ist eingegangen, in Pruefung,
     * freigegeben, gebucht oder abgelehnt. Eingegangen und in Pruefung sind
     * Behauptungen des Lieferanten, abgelehnt ist eine, der widersprochen
     * wurde — keine davon gehoert in eine Ergebniszahl.
     */
    const [ein] = await db.abfrage<{ summe: string | null; anzahl: string }>(
      `select coalesce(sum(e.brutto_cent), 0)::text as summe, count(*)::text as anzahl
         from eingangsrechnung e
        where e.status in ('freigegeben', 'gebucht')
          and e.rechnungsdatum between $1::date and $2::date`,
      [z.von, z.bis],
    );
    const erloese = geld(aus?.summe);
    const aufwand = geld(ein?.summe);
    zeilen.push({
      zeitraum: z,
      erloeseCent: erloese,
      rechnungen: zahl(aus?.anzahl),
      aufwandCent: aufwand,
      eingangsrechnungen: zahl(ein?.anzahl),
      ergebnisCent: cent(erloese - aufwand),
    });
  }
  return zeilen;
}

// ---------------------------------------------------------------------------
// REP-02 — Aufträge, Leads, Abschlussquote
// ---------------------------------------------------------------------------

export interface AuftragsZeile {
  readonly zeitraum: Zeitraum;
  readonly leads: number;
  readonly leadsGewonnen: number;
  readonly auftraege: number;
  readonly auftragswertCent: Cent;
  /** Basispunkte: 2500 = 25,00 %. Kein Float (K-16). */
  readonly quoteBp: number;
}

/**
 * Die Abschlussquote ist gewonnene Leads geteilt durch ENTSTANDENE Leads —
 * beide im selben Abschnitt.
 *
 * Das ist bewusst nicht „gewonnene im Zeitraum / alle offenen": ein Lead, der
 * im Januar entsteht und im März gewonnen wird, zählt als Lead im Januar und
 * als Gewinn im Januar. Die Kohorte bleibt beisammen, sonst misst die Quote
 * die Bearbeitungsgeschwindigkeit statt der Trefferquote.
 *
 * Bei null Leads ist die Quote `0` und nicht „unendlich": eine Division, die
 * niemand sieht, ist besser als ein `NaN` auf einem Bildschirm.
 */
export async function auftragsReihe(
  db: Abfrage, abschnitte: readonly Zeitraum[],
): Promise<readonly AuftragsZeile[]> {
  const zeilen: AuftragsZeile[] = [];
  for (const z of abschnitte) {
    const [l] = await db.abfrage<{ gesamt: string; gewonnen: string }>(
      `select count(*)::text as gesamt,
              count(*) filter (where l.status = 'gewonnen')::text as gewonnen
         from lead l
        where (l.erstellt_am at time zone 'Europe/Berlin')::date
              between $1::date and $2::date`,
      [z.von, z.bis],
    );
    const [a] = await db.abfrage<{ anzahl: string; wert: string | null }>(
      `select count(*)::text as anzahl,
              coalesce(sum(a.auftragswert_netto_cent), 0)::text as wert
         from auftrag a
        where a.status <> 'storniert'
          and (a.erstellt_am at time zone 'Europe/Berlin')::date
              between $1::date and $2::date`,
      [z.von, z.bis],
    );
    const gesamt = zahl(l?.gesamt);
    const gewonnen = zahl(l?.gewonnen);
    zeilen.push({
      zeitraum: z,
      leads: gesamt,
      leadsGewonnen: gewonnen,
      auftraege: zahl(a?.anzahl),
      auftragswertCent: geld(a?.wert),
      quoteBp: gesamt === 0 ? 0 : Math.round((gewonnen * 10000) / gesamt),
    });
  }
  return zeilen;
}

// ---------------------------------------------------------------------------
// REP-03 — Kanal bis zum unterschriebenen Auftrag
// ---------------------------------------------------------------------------

export interface AttributionsZeile {
  /** Der Kanal, wie er im Formulareingang steht — oder „ohne Angabe". */
  readonly kanal: string;
  readonly medium: string | null;
  readonly kampagne: string | null;
  readonly leads: number;
  readonly auftraege: number;
  readonly auftragswertCent: Cent;
  readonly quoteBp: number;
}

/**
 * **Die Kette, die REP-03 verlangt:** Formulareingang → Lead → Auftrag.
 *
 * Der Kanal steht in `formular_eingang` (UTM-Parameter, Verweisadresse), nicht
 * am Lead: ein Lead kann von Hand entstehen, und dann gibt es keinen Kanal —
 * das ist eine Antwort und keine Lücke. `lead.quelle` ist die gröbere Angabe
 * (Webformular, Radar, Empfehlung, Akquise, manuell) und bleibt der Rückfall.
 * Die Akquise stand bis V-139 unter „Manuell erfasst" — ein übernommenes
 * Akquiseziel ist aber ein eigener Kanal, und genau diese Frage stellt REP-03.
 *
 * **Die Aufträge kommen seit V-138 an.** `auftrag.lead_id` schrieb bis dahin
 * kein Weg; jede Zeile zeigte 0 Aufträge. Jetzt trägt das Angebot die Anfrage
 * (`legeAngebotAn`), der Auftrag erbt sie (`wandleInAuftrag`) oder bekommt
 * sie direkt (`/api/auftrag`).
 *
 * **Gezählt wird der Auftrag, nicht das Angebot.** „Channel to SIGNED order"
 * heisst unterschrieben; ein Angebot, das nie angenommen wurde, hat keinen
 * Kanal verdient.
 */
export async function attribution(
  db: Abfrage, zeitraum: Zeitraum,
): Promise<readonly AttributionsZeile[]> {
  const zeilen = await db.abfrage<{
    kanal: string; medium: string | null; kampagne: string | null;
    leads: string; auftraege: string; wert: string | null;
  }>(
    `with eingang as (
       select l.id as lead_id,
              coalesce(nullif(fe.utm_quelle, ''),
                       case l.quelle
                         when 'webformular' then 'Website (ohne UTM)'
                         when 'vergabe_radar' then 'Vergaberadar'
                         when 'empfehlung' then 'Empfehlung'
                         when 'akquise' then 'Akquise'
                         else 'Manuell erfasst'
                       end) as kanal,
              nullif(fe.utm_medium, '')   as medium,
              nullif(fe.utm_kampagne, '') as kampagne
         from lead l
         left join formular_eingang fe on fe.lead_id = l.id
        where (l.erstellt_am at time zone 'Europe/Berlin')::date
              between $1::date and $2::date
     )
     select e.kanal, e.medium, e.kampagne,
            count(*)::text as leads,
            count(a.id)::text as auftraege,
            coalesce(sum(a.auftragswert_netto_cent), 0)::text as wert
       from eingang e
       left join auftrag a
              on a.lead_id = e.lead_id and a.status <> 'storniert'
      group by e.kanal, e.medium, e.kampagne
      order by count(a.id) desc, count(*) desc, e.kanal`,
    [zeitraum.von, zeitraum.bis],
  );

  return zeilen.map((z) => {
    const leads = zahl(z.leads);
    const auftraege = zahl(z.auftraege);
    return {
      kanal: z.kanal,
      medium: z.medium,
      kampagne: z.kampagne,
      leads,
      auftraege,
      auftragswertCent: geld(z.wert),
      quoteBp: leads === 0 ? 0 : Math.round((auftraege * 10000) / leads),
    };
  });
}

// ---------------------------------------------------------------------------
// REP-04 — Stunden, Auslastung, Mehrarbeit
// ---------------------------------------------------------------------------

export interface MitarbeiterZeile {
  readonly personId: string;
  readonly name: string;
  readonly personalnummer: string | null;
  readonly wochenstundenSoll: number | null;
  readonly istMinuten: number;
  readonly sollMinuten: number | null;
  /** Basispunkte. `null`, wenn kein Soll hinterlegt ist — nicht `0`. */
  readonly auslastungBp: number | null;
  readonly mehrarbeitMinuten: number | null;
}

/**
 * Stunden je Mensch — aus FREIGEGEBENEN Zeiteinträgen.
 *
 * **Freigabe ist `freigegeben_am is not null`, kein Status** (§7.3, EMP-04).
 * `zeiteintrag_status` führt `laufend`, `abgeschlossen`, `offen_nacherfassung`
 * und `storniert` — die Freigabe ist ein Zeitpunkt daneben, weil sie eine
 * Handlung eines Menschen ist und kein Zustand des Eintrags. Ein Filter auf
 * einen Status `freigegeben` wäre zur Laufzeit ein Fehler: „invalid input
 * value for enum". Denselben Filter benutzen `stundenkonto.ts` und
 * `monatsanteil.ts`.
 *
 * **Nur freigegebene.** Ein laufender oder nacherfasster Eintrag ist eine
 * Behauptung; eine Auslastungszahl aus Behauptungen ändert sich noch und
 * steht neben Zahlen, die sich nicht mehr ändern.
 *
 * **Die Auslastung ist `null`, wenn kein Soll hinterlegt ist** — und nicht
 * `0` %. Ein Aushilfsvertrag ohne Wochenstunden ist kein Mensch, der nichts
 * arbeitet. `0` stünde in derselben Spalte wie eine echte Null und wäre von
 * ihr nicht zu unterscheiden.
 *
 * **Mehrarbeit ist nicht Überstunden im arbeitsrechtlichen Sinn.** Sie ist
 * die Differenz Ist − Soll über den Zeitraum; ob daraus ein Anspruch wird,
 * entscheidet der Arbeitsvertrag und nicht dieser Bericht. Die Seite sagt das.
 */
export async function mitarbeiterReihe(
  db: Abfrage, zeitraum: Zeitraum,
): Promise<readonly MitarbeiterZeile[]> {
  const zeilen = await db.abfrage<{
    person_id: string; name: string; personalnummer: string | null;
    wochenstunden: string | null; ist_minuten: string | null;
  }>(
    `select p.id as person_id,
            p.vorname || ' ' || p.nachname as name,
            max(a.personalnummer) as personalnummer,
            max(a.wochenstunden)::text as wochenstunden,
            coalesce(sum(z.dauer_netto_minuten), 0)::text as ist_minuten
       from person p
       join anstellung a on a.person_id = p.id and a.geloescht_am is null
       left join zeiteintrag z
              on z.person_id = p.id
             and z.freigegeben_am is not null
             and z.storniert_am is null
             and z.ersetzt_am is null
             and (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
                 between $1::date and $2::date
      group by p.id, p.vorname, p.nachname
      having coalesce(sum(z.dauer_netto_minuten), 0) > 0 or max(a.wochenstunden) is not null
      order by 2`,
    [zeitraum.von, zeitraum.bis],
  );

  const tage = kalendertage(zeitraum);
  return zeilen.map((z) => {
    const wochenstunden = z.wochenstunden === null ? null : Number(z.wochenstunden);
    const ist = zahl(z.ist_minuten);
    /*
     * Soll = Wochenstunden × (Kalendertage / 7). Eine grobe, aber ehrliche
     * Rechnung: Urlaub, Krankheit und Feiertage sind hier NICHT abgezogen —
     * dafuer braucht es den Abwesenheitskalender, und die Seite sagt es.
     */
    const soll = wochenstunden === null
      ? null : Math.round((wochenstunden * 60 * tage) / 7);
    return {
      personId: z.person_id,
      name: z.name,
      personalnummer: z.personalnummer,
      wochenstundenSoll: wochenstunden,
      istMinuten: ist,
      sollMinuten: soll,
      auslastungBp: soll === null || soll === 0 ? null : Math.round((ist * 10000) / soll),
      mehrarbeitMinuten: soll === null ? null : ist - soll,
    };
  });
}

/** Kalendertage im Zeitraum, einschliesslich beider Enden. */
export function kalendertage(z: Zeitraum): number {
  const von = Date.parse(`${z.von}T00:00:00Z`);
  const bis = Date.parse(`${z.bis}T00:00:00Z`);
  return Math.round((bis - von) / 86400000) + 1;
}

// ---------------------------------------------------------------------------
// REP-05 — Projekte: Status, Marge, Termintreue
// ---------------------------------------------------------------------------

export interface ProjektZeile {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly sollEnde: string | null;
  readonly istEnde: string | null;
  /** Positiv = zu spät, negativ = früher fertig, `null` = noch offen. */
  readonly verzugTage: number | null;
  readonly auftragssummeCent: Cent;
  readonly berechnetCent: Cent;
  readonly kostenCent: Cent;
  /** Basispunkte auf die Auftragssumme. `null` ohne Summe. */
  readonly margeBp: number | null;
}

/**
 * **Die Marge ist Auftragssumme minus erfasste Kosten** — und die Kosten sind
 * die Zeiteinträge zum internen Stundensatz plus die zugeordneten
 * Eingangsrechnungen.
 *
 * Sie ist damit eine Näherung, und die Seite sagt es: Material ohne
 * Rechnungsbezug, Gemeinkosten und Gerätestunden fehlen. Eine Marge, die so
 * tut, als wäre sie die Nachkalkulation, ist schlimmer als eine, die ihre
 * Grenzen nennt — sie wird in ein Angebot übernommen.
 *
 * TODO(client): O-502 — welche Kostenarten gehören in die Projektmarge:
 * nur Lohn und Fremdleistung (so wie hier), oder auch ein Gemeinkostensatz je
 * Gesellschaft, und wenn ja, welcher?
 */
export async function projektReihe(
  db: Abfrage, zeitraum: Zeitraum,
): Promise<readonly ProjektZeile[]> {
  const zeilen = await db.abfrage<{
    id: string; nummer: string; bezeichnung: string; status: string;
    soll_ende: string | null; ist_ende: string | null;
    auftragssumme: string | null; berechnet: string | null;
    lohn_cent: string | null; fremd_cent: string | null;
  }>(
    // Die vier geschuetzten Zahlen kommen aus app.projekt_kennzahlen (0157).
    // cse_app hat auf projekt SPALTENRECHTE: Nummer, Bezeichnung, Status und
    // Termine ja, auftragssumme_netto_cent nein (K-05, D-92). Ein direkter
    // Zugriff darauf weist Postgres mit "permission denied for table projekt"
    // ab -- die ganze Anweisung, nicht die Spalte.
    `with kz as (select * from app.projekt_kennzahlen($1::date, $2::date))
     select pr.id, pr.nummer, pr.bezeichnung, pr.status::text,
            pr.soll_ende::text, pr.ist_ende::text,
            kz.auftragssumme_cent::text as auftragssumme,
            kz.berechnet_cent::text as berechnet,
            kz.lohn_cent::text as lohn_cent,
            kz.fremd_cent::text as fremd_cent
       from projekt pr
       join kz on kz.projekt_id = pr.id
      where pr.archiviert_am is null
        and coalesce(pr.ist_beginn, pr.soll_beginn) <= $2::date
        and coalesce(pr.ist_ende, pr.soll_ende, $2::date) >= $1::date
      order by pr.nummer`,
    [zeitraum.von, zeitraum.bis],
  );

  return zeilen.map((z) => {
    const summe = geld(z.auftragssumme);
    const kosten = cent(geld(z.lohn_cent) + geld(z.fremd_cent));
    return {
      id: z.id,
      nummer: z.nummer,
      bezeichnung: z.bezeichnung,
      status: z.status,
      sollEnde: z.soll_ende,
      istEnde: z.ist_ende,
      verzugTage: verzug(z.soll_ende, z.ist_ende),
      auftragssummeCent: summe,
      berechnetCent: geld(z.berechnet),
      kostenCent: kosten,
      margeBp: summe === 0n ? null : Number(((summe - kosten) * 10000n) / summe),
    };
  });
}

/** Termintreue: Ist-Ende gegen Soll-Ende, in Tagen. `null` = noch offen. */
export function verzug(soll: string | null, ist: string | null): number | null {
  if (soll === null || ist === null) return null;
  return Math.round(
    (Date.parse(`${ist}T00:00:00Z`) - Date.parse(`${soll}T00:00:00Z`)) / 86400000,
  );
}

// ---------------------------------------------------------------------------
// REP-06 — Vergabepipeline
// ---------------------------------------------------------------------------

export interface PipelineStufe {
  readonly status: string;
  readonly bezeichnung: string;
  readonly anzahl: number;
  readonly zuschlagswertCent: Cent;
}

/** Die acht Zustände aus `ausschreibung_status`, in ihrer Reihenfolge. */
export const PIPELINE_STUFEN: readonly { readonly status: string; readonly bezeichnung: string }[] = [
  { status: 'neu', bezeichnung: 'Gefunden' },
  { status: 'geprueft', bezeichnung: 'Gesichtet' },
  { status: 'in_bearbeitung', bezeichnung: 'In Bearbeitung' },
  { status: 'eingereicht', bezeichnung: 'Eingereicht' },
  { status: 'zuschlag', bezeichnung: 'Zuschlag' },
  { status: 'nicht_beruecksichtigt', bezeichnung: 'Nicht berücksichtigt' },
  { status: 'verfahren_aufgehoben', bezeichnung: 'Verfahren aufgehoben' },
  { status: 'verworfen', bezeichnung: 'Verworfen' },
];

/**
 * **Jede Stufe erscheint, auch die leere.** Eine Pipeline, die nur zeigt, wo
 * etwas liegt, verschweigt genau die Stufe, an der nichts ankommt — und das
 * ist die interessante.
 */
export async function pipeline(
  db: Abfrage, zeitraum: Zeitraum,
): Promise<readonly PipelineStufe[]> {
  const zeilen = await db.abfrage<{ status: string; anzahl: string; wert: string | null }>(
    `select v.status::text, count(*)::text as anzahl,
            coalesce(sum(v.zuschlagswert_cent), 0)::text as wert
       from ausschreibung_vorgang v
      where v.geloescht_am is null
        and (v.erstellt_am at time zone 'Europe/Berlin')::date
            between $1::date and $2::date
      group by v.status`,
    [zeitraum.von, zeitraum.bis],
  );
  const nach = new Map(zeilen.map((z) => [z.status, z]));
  return PIPELINE_STUFEN.map((s) => {
    const z = nach.get(s.status);
    return {
      status: s.status,
      bezeichnung: s.bezeichnung,
      anzahl: zahl(z?.anzahl),
      zuschlagswertCent: geld(z?.wert),
    };
  });
}
