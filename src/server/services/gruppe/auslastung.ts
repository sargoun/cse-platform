import type { LeseKontext } from '../../kontext/index.js';
import { montag, tagePlus } from '../../../lib/datum/kalendertag.js';
import { pruefeArbzg, type ArbzgBefund, type Schicht } from '../zeit/arbzg.js';

/**
 * Auslastung und ArbZG-Befunde ueber die Gruppe (REP-04, TIM-14, LEG-03).
 *
 * **Die Person ist der Schluessel, nicht die Anstellung (D-09).** Wer in zwei
 * Gesellschaften arbeitet, hat in jeder eine Anstellung und in jeder
 * Zeiteintraege — und das Arbeitszeitgesetz addiert sie. Genau das ist der
 * Grund, warum diese Sicht in der Gruppenansicht steht: kein Bereich sieht
 * die Stunden des anderen, die Gruppe sieht die Summe.
 *
 * **Minuten aus `dauer_netto_minuten`, nie neu gerechnet.** Die Dauer eines
 * Eintrags hat der Server beim Schreiben aus UTC-Instanten gebildet
 * (Invariante 2 und 5); hier wird summiert, nicht gemessen. Die ArbZG-Regeln
 * kommen aus `pruefeArbzg` — dieselbe Funktion wie im Bereich, mit den
 * Schichten aller Bereiche einer Person auf einmal.
 *
 * `zeiteintrag` steht in der Gruppenansicht unter `gruppe.zeit.lesen`
 * (Policy `t_gruppe`); ohne das Recht in einem Bereich fehlen dessen Stunden
 * still. Die Seite nennt deshalb, ueber welche Bereiche sie zaehlt.
 */
export const ZEIT_RECHT = 'gruppe.zeit.lesen';

export interface WochenSpalte {
  /** ISO-Woche, `2026-W37`. */
  readonly iso: string;
  /** Der Montag, `YYYY-MM-DD`. */
  readonly montag: string;
}

export interface PersonWochen {
  readonly personId: string;
  readonly name: string;
  /** Minuten je Woche, in der Reihenfolge von `wochen`. */
  readonly wochenMinuten: readonly number[];
  readonly gesamtMinuten: number;
  /** Die Bereiche, aus denen Eintraege stammen — Slugs, sortiert. */
  readonly bereiche: readonly string[];
}

export interface GruppenAuslastung {
  readonly wochen: readonly WochenSpalte[];
  readonly personen: readonly PersonWochen[];
  /** Erster Montag und letzter Sonntag des Fensters, `YYYY-MM-DD`. */
  readonly von: string;
  readonly bis: string;
}

const WOCHEN = 4;

interface WocheRoh { readonly iso: string; readonly montag: string }

interface SummeRoh {
  readonly person_id: string;
  readonly vorname: string;
  readonly nachname: string;
  readonly iso: string;
  readonly minuten: number;
  readonly slug: string;
}

export function formatiereStunden(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return `${String(h)}:${String(m).padStart(2, '0')} h`;
}

/** Stunden je Person und ISO-Woche ueber die letzten vier Wochen — die laufende zuletzt. */
export async function gruppenAuslastung(
  kontext: LeseKontext, heute: string,
): Promise<GruppenAuslastung> {
  const von = tagePlus(montag(heute), -7 * (WOCHEN - 1));
  const bis = tagePlus(montag(heute), 6);

  const wochen = await kontext.abfrage<WocheRoh>(
    `select to_char(w, 'IYYY-"W"IW') as iso, to_char(w, 'YYYY-MM-DD') as montag
       from generate_series($1::date, $2::date, interval '7 days') as w
      order by w`,
    [von, bis],
  );

  const summen = await kontext.abfrage<SummeRoh>(
    `select z.person_id, p.vorname, p.nachname, m.slug,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'IYYY-"W"IW') as iso,
            coalesce(sum(z.dauer_netto_minuten), 0)::int as minuten
       from zeiteintrag z
       join person p on p.id = z.person_id
       join mandant m on m.id = z.mandant_id
      where z.ende_zeitpunkt is not null
        and z.storniert_am is null and z.ersetzt_am is null
        and z.beginn_zeitpunkt >= ($1::date::timestamp at time zone 'Europe/Berlin')
        and z.beginn_zeitpunkt <  (($2::date + 1)::timestamp at time zone 'Europe/Berlin')
      group by z.person_id, p.vorname, p.nachname, m.slug, 5`,
    [von, bis],
  );

  const spalten = wochen.map((w) => w.iso);
  const personen = new Map<string, {
    name: string; minuten: number[]; bereiche: Set<string>;
  }>();
  for (const s of summen) {
    const eintrag = personen.get(s.person_id) ?? {
      name: `${s.nachname}, ${s.vorname}`, minuten: spalten.map(() => 0), bereiche: new Set<string>(),
    };
    const i = spalten.indexOf(s.iso);
    if (i >= 0) eintrag.minuten[i] = (eintrag.minuten[i] ?? 0) + s.minuten;
    eintrag.bereiche.add(s.slug);
    personen.set(s.person_id, eintrag);
  }

  const zeilen: PersonWochen[] = [...personen.entries()].map(([personId, e]) => ({
    personId,
    name: e.name,
    wochenMinuten: e.minuten,
    gesamtMinuten: e.minuten.reduce((a, b) => a + b, 0),
    bereiche: [...e.bereiche].sort(),
  }));
  // Wer in mehreren Bereichen arbeitet, steht oben: das ist die Sicht, die
  // kein Bereich fuer sich allein hat (D-09). Danach nach Stunden.
  zeilen.sort((a, b) =>
    b.bereiche.length - a.bereiche.length
    || b.gesamtMinuten - a.gesamtMinuten
    || a.name.localeCompare(b.name, 'de'));

  return { wochen, personen: zeilen, von, bis };
}

export interface GruppenArbzgBefund extends ArbzgBefund {
  readonly name: string;
  /** Die Bereiche der beteiligten Schichten — Slugs, sortiert. */
  readonly bereiche: readonly string[];
}

interface SchichtRoh {
  readonly id: string;
  readonly person_id: string;
  readonly vorname: string;
  readonly nachname: string;
  readonly mandant_id: string;
  readonly slug: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly pause_minuten: number | null;
}

const RUECKBLICK_TAGE = 14;
const SCHWERE_RANG: Readonly<Record<ArbzgBefund['schwere'], number>> = {
  verstoss: 0, warnung: 1, hinweis: 2,
};

/**
 * ArbZG-Befunde der letzten zwei Wochen — ueber alle Bereiche einer Person
 * zusammen. `pruefeArbzg` nimmt die Schichten GENAU EINER Person; deshalb wird
 * je Person gerufen, und `ueberMandanten` sagt je Befund, ob er erst durch die
 * Zusammenschau entstanden ist.
 */
export async function gruppenArbzgBefunde(
  kontext: LeseKontext, heute: string,
): Promise<readonly GruppenArbzgBefund[]> {
  const von = tagePlus(heute, -RUECKBLICK_TAGE);
  const roh = await kontext.abfrage<SchichtRoh>(
    `select z.id, z.person_id, p.vorname, p.nachname, z.mandant_id, m.slug,
            z.beginn_zeitpunkt as beginn, z.ende_zeitpunkt as ende, z.pause_minuten
       from zeiteintrag z
       join person p on p.id = z.person_id
       join mandant m on m.id = z.mandant_id
      where z.ende_zeitpunkt is not null
        and z.storniert_am is null and z.ersetzt_am is null
        and z.beginn_zeitpunkt >= ($1::date::timestamp at time zone 'Europe/Berlin')
        and z.beginn_zeitpunkt <  (($2::date + 1)::timestamp at time zone 'Europe/Berlin')
      order by z.person_id, z.beginn_zeitpunkt`,
    [von, heute],
  );

  const jePerson = new Map<string, { name: string; schichten: Schicht[]; slugVon: Map<string, string> }>();
  for (const z of roh) {
    const e = jePerson.get(z.person_id) ?? {
      name: `${z.nachname}, ${z.vorname}`, schichten: [], slugVon: new Map<string, string>(),
    };
    e.schichten.push({
      id: z.id, personId: z.person_id, mandantId: z.mandant_id,
      vonUtc: z.beginn, bisUtc: z.ende, pauseMinuten: z.pause_minuten,
    });
    e.slugVon.set(z.id, z.slug);
    jePerson.set(z.person_id, e);
  }

  const befunde: GruppenArbzgBefund[] = [];
  for (const e of jePerson.values()) {
    for (const b of pruefeArbzg(e.schichten)) {
      const bereiche = [...new Set(b.beteiligteSchichten.map((id) => e.slugVon.get(id) ?? '?'))].sort();
      befunde.push({ ...b, name: e.name, bereiche });
    }
  }
  befunde.sort((a, b) =>
    SCHWERE_RANG[a.schwere] - SCHWERE_RANG[b.schwere]
    || b.kalendertag.localeCompare(a.kalendertag)
    || a.name.localeCompare(b.name, 'de'));
  return befunde;
}
