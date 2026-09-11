/**
 * Demodaten fuer das Stundenkonto (EMP-04, EMP-15).
 *
 * **Der Dienst aus PR 37 hatte keinen einzigen Aufrufer.** Er bucht, sperrt,
 * traegt vor und rechnet gegen sein Journal — nur fuehrte kein Weg zu ihm: kein
 * Seed, kein Job, kein Bildschirm. Eine Buchhaltung, die nie gebucht hat, sieht
 * in der Demo aus wie ein fehlendes Modul, und in den Tests sieht sie aus wie
 * ein gruenes Feld.
 *
 * **Freigegeben wird hier mit Ansage.** Auf das Konto flieszt nur Zeit, die
 * jemand freigegeben hat (§ 7.3) — den Bildschirm dafuer baut PR 47
 * (`zeiten/freigabe`, Phase 6, O-39). Bis dahin setzt dieser Seed die Freigabe
 * fuer ABGESCHLOSSENE Eintraege, die mindestens zwei Tage zurueckliegen, und
 * sagt genau das: es ist eine Demo-Annahme ueber die Vergangenheit, keine
 * Abkuerzung um ein Tor herum. Was juenger ist, bleibt offen — und zeigt damit
 * den Normalfall, in dem ein Monat noch nicht abschlussreif ist.
 *
 * **Gebucht wird durch den ECHTEN Dienst**, unter einer `cse_app`-Sitzung mit
 * gebundenem Mandanten: `eroeffneKonto` und `bucheFreigegebeneZeiten` laufen
 * damit durch Policies, Rechte und den Summenausloeser. Ein Seed, der die
 * Zeilen selbst schriebe, erzeugte Konten, die es im Betrieb nie gaebe.
 *
 * **Gesperrt wird NICHT.** Der Monatsabschluss ist unumkehrbar und stempelt
 * jeden Zeiteintrag des Monats; ein Seed, der ihn mitbraechte, lieferte eine
 * Demodatenbank aus, in der sich die Korrekturspur nicht mehr vorfuehren
 * laesst. Den Abschluss ausloesen kann man auf
 * `personal/stundenkonten/abschluss` — und dort steht auch, was er bedeutet.
 */
import type postgres from 'postgres';
import { alsPortalSitzung } from './sitzung.js';
import { bucheFreigegebeneZeiten, eroeffneKonto }
  from '../../services/zeit/stundenkonto.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface KontoErgebnis {
  readonly freigegeben: number;
  readonly konten: number;
  readonly buchungen: number;
  readonly minuten: number;
}

/** Wie weit zurueck Konten angelegt werden. Drei Monate decken den Vortrag. */
const MONATE_ZURUECK = 3;

function leer(): KontoErgebnis {
  return { freigegeben: 0, konten: 0, buchungen: 0, minuten: 0 };
}

export async function seedKonten(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<KontoErgebnis> {
  // Die Schleife laeuft ueber ALLE Bereiche — und seit `seedSecurity` hat das
  // Folgen: Fatima traegt zwei Beschaeftigungen und bekommt zwei getrennte
  // Konten, eines je Gesellschaft. Getrennt ist dabei keine Darstellungsfrage:
  // ein Stundenkonto haengt an der `anstellung`, und eine Summe ueber beide
  // waere eine Zahl, die es in keiner Lohnabrechnung gibt (D-09, EMP-15).
  let freigegeben = 0;
  let konten = 0;
  let buchungen = 0;
  let minuten = 0;

  for (const mandantId of ids.values()) {
    const ergebnis = await seedKontenEinesBereichs(sql, mandantId);
    freigegeben += ergebnis.freigegeben;
    konten += ergebnis.konten;
    buchungen += ergebnis.buchungen;
    minuten += ergebnis.minuten;
  }
  return { freigegeben, konten, buchungen, minuten };
}

async function seedKontenEinesBereichs(
  sql: Sql, mandantId: string,
): Promise<KontoErgebnis> {
  const [verantwortlich] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel limit 1`;
  if (verantwortlich === undefined) return leer();

  /**
   * Die Freigabe. `status = 'abgeschlossen'` und mindestens zwei Tage her:
   * ein laufender Eintrag hat kein Ende, und ein gestern beendeter ist der
   * Fall, den die Planung noch ansieht.
   *
   * `freigegeben_von` gehoert dazu — die Tabelle verlangt beides oder keines
   * (`z_freigabe_paarweise`), weil eine Freigabe ohne Freigebenden im Streit
   * wertlos ist.
   */
  const befreit = await sql<{ id: string }[]>`
    update zeiteintrag
       set freigegeben_am = now(), freigegeben_von = ${verantwortlich.id}
     where mandant_id = ${mandantId}
       and status = 'abgeschlossen'
       and freigegeben_am is null
       and storniert_am is null and ersetzt_am is null
       and ende_zeitpunkt < now() - interval '2 days'
    returning id`;

  /**
   * Die Monate, in denen ueberhaupt etwas liegt — aus der Datenbank und nicht
   * aus `new Date()`: der Monat eines Anteils ist der BERLINER Monat, und der
   * Node-Prozess laeuft in UTC (Invariante 2).
   */
  const monate = await sql<{ anstellung_id: string; jahr: number; monat: number }[]>`
    select m.anstellung_id,
           extract(year  from m.monat)::int as jahr,
           extract(month from m.monat)::int as monat
      from zeiteintrag_monatsanteil m
     where m.mandant_id = ${mandantId}
       and m.monat >= date_trunc('month',
             (now() at time zone 'Europe/Berlin')::date
             - make_interval(months => ${MONATE_ZURUECK - 1}))
     group by 1, 2, 3
     order by 2, 3, 1`;
  if (monate.length === 0) return { ...leer(), freigegeben: befreit.length };

  let konten = 0;
  let buchungen = 0;
  let minuten = 0;

  for (const m of monate) {
    const ergebnis = await alsPortalSitzung(
      sql, mandantId, verantwortlich.id, async (kontext) => {
        // Die Sollzeit bleibt 0 — „nicht hinterlegt" (O-18). Ein Demowert
        // hier waere die eine Zahl, aus der spaeter Ueberstunden werden.
        await eroeffneKonto(kontext, {
          anstellungId: m.anstellung_id, jahr: Number(m.jahr), monat: Number(m.monat),
        });
        return bucheFreigegebeneZeiten(kontext, {
          anstellungId: m.anstellung_id, jahr: Number(m.jahr), monat: Number(m.monat),
        });
      });
    konten += 1;
    buchungen += ergebnis.gebucht;
    minuten += ergebnis.minuten;
  }

  return { freigegeben: befreit.length, konten, buchungen, minuten };
}
