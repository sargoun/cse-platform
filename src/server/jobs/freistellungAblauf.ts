/**
 * Der Hinweis vor dem Ablauf der EIGENEN Freistellungsbescheinigung als Job
 * (V-388, O-130, D-846): 60, 30 und 7 Tage vorher, an Buchhaltung und
 * Geschäftsführung der Gesellschaft, solange keine Nachfolgerin erfasst ist.
 *
 * **`uebergreifend`, wie die Ablaufwarnungen der Nachweise** (EMP-08): eine
 * Abfrage über alle Gesellschaften, gruppiert je Gesellschaft. Die Empfänger
 * löst `kern.kette_meldung_empfaenger` auf (0507) — dieselben Menschen, die
 * vom Bruch der Rechnungskette erfahren, und nur solche, die das Ziel
 * (`/finanzen/freistellungen`, `finanzen.lesen`) öffnen können.
 *
 * **Einmal je Stufe.** Das Gedächtnis ist `waechter_meldung` (0149) mit der
 * Bescheinigung als Gegenstand und der Stufe als Lage: erst die Quittung,
 * dann die Zustellung, und die Quittung zurück, wenn nichts ankam — dieselbe
 * Reihenfolge wie beim Kettenbruch, und wie dort in EINER Transaktion je
 * Gesellschaft (`meldeKettenbruch`): bricht die Zustellung ab, fällt die
 * Quittung mit, und der nächste Lauf meldet, statt „schon gemeldet" zu
 * zählen, was nie ankam.
 *
 * **Gelesen wird als `cse_job`** (`alsJobRolle`, nur lesend; 0531 gibt ihm
 * die Spalten der eigenen Bescheinigungen und keine fremde). Zugestellt wird
 * wie beim Kettenbruch über die Verbindung des Laufs (D-378).
 *
 * Die Plattform beantragt nichts beim Finanzamt (Invariante 7): sie erinnert.
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, type JobTransaktion, type JobVerbindung } from './sitzung.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto } from '../benachrichtigung/ablage.js';
import {
  ART_FREISTELLUNG_LAEUFT_AB, registriereWaechterArten,
} from '../services/waechter/benachrichtigung.js';
import { gibQuittungZurueck, quittiere } from '../services/waechter/dienstplan.js';
import {
  eigeneAblaeufe, type EigeneBescheinigung,
} from '../services/finanz/freistellung-ablauf.js';
import { tagDeutsch } from '../../lib/datum/kalendertag.js';

export interface AblaufBericht {
  readonly gesellschaften: number;
  readonly faellig: number;
  readonly zugestellt: number;
  readonly schonGemeldet: number;
  /** Fällige Hinweise in einer Gesellschaft, in der niemand die Buchhaltung liest. */
  readonly ohneEmpfaenger: number;
}

interface Zeile extends EigeneBescheinigung {
  readonly mandantId: string;
  readonly slug: string;
}

/** Meldet die fälligen Hinweise am Berliner Tag `heute` — aus der Datenbank. */
export async function meldeFreistellungsAblaeufe(
  sql: JobVerbindung, heute: string,
): Promise<AblaufBericht> {
  registriereWaechterArten();
  /*
   * Alle eigenen Bescheinigungen, die heute oder später noch gelten — auch
   * künftige: eine erfasste Nachfolgerin beendet den Hinweis. Abgelaufene und
   * fremde (Kunde, Lieferant) gehören nicht hierher.
   */
  const zeilen = await alsJobRolle(sql, (db) => db.abfrage<Zeile>(
    `select f.id::text as id, f.mandant_id::text as "mandantId", m.slug,
            f.bescheinigung_nummer as nummer,
            to_char(f.gueltig_von, 'YYYY-MM-DD') as "gueltigVon",
            to_char(f.gueltig_bis, 'YYYY-MM-DD') as "gueltigBis",
            to_char(f.widerrufen_am, 'YYYY-MM-DD') as "widerrufenAm",
            f.umfang::text as umfang, f.auftrag_id::text as "auftragId"
       from freistellungsbescheinigung f
       join mandant m on m.id = f.mandant_id
      where f.kunde_id is null and f.lieferant_id is null
        and m.archiviert_am is null
        and f.gueltig_bis >= $1::date
      order by f.mandant_id, f.gueltig_bis`, [heute]));

  const jeGesellschaft = new Map<string, Zeile[]>();
  for (const z of zeilen) {
    jeGesellschaft.set(z.mandantId, [...(jeGesellschaft.get(z.mandantId) ?? []), z]);
  }

  let faellig = 0;
  let zugestellt = 0;
  let schonGemeldet = 0;
  let ohneEmpfaenger = 0;
  for (const [mandantId, eigene] of jeGesellschaft) {
    const lagen = eigeneAblaeufe(eigene, heute);
    if (lagen.length === 0) continue;
    const slug = eigene[0]?.slug ?? '';
    /* Quittung und Zustellung einer Gesellschaft in EINER Transaktion (wie `meldeKettenbruch`). */
    const ergebnis = await sql.begin((tx) => meldeGesellschaft(tx, mandantId, slug, lagen));
    faellig += lagen.length;
    zugestellt += ergebnis.zugestellt;
    schonGemeldet += ergebnis.schonGemeldet;
    ohneEmpfaenger += ergebnis.ohneEmpfaenger;
  }
  return { gesellschaften: jeGesellschaft.size, faellig, zugestellt, schonGemeldet, ohneEmpfaenger };
}

/** Die fälligen Hinweise EINER Gesellschaft — in der Transaktion des Aufrufers. */
async function meldeGesellschaft(
  tx: JobTransaktion, mandantId: string, slug: string,
  lagen: ReturnType<typeof eigeneAblaeufe>,
): Promise<{ zugestellt: number; schonGemeldet: number; ohneEmpfaenger: number }> {
  const empfaenger = (await tx.unsafe(
    `select benutzer_id::text as benutzer_id from kern.kette_meldung_empfaenger($1::uuid)`,
    [mandantId],
  )) as readonly { benutzer_id: string }[];
  let zugestellt = 0;
  let schonGemeldet = 0;
  let ohneEmpfaenger = 0;
  for (const lage of lagen) {
    if (empfaenger.length === 0) { ohneEmpfaenger += 1; continue; }
    const benachrichtigung = erzeuge(ART_FREISTELLUNG_LAEUFT_AB, {
      mandantId, mandantSlug: slug,
      objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
      daten: { nummer: lage.nummer, bis: tagDeutsch(lage.gueltigBis), tage: lage.tage },
    });
    for (const { benutzer_id: benutzerId } of empfaenger) {
      const quittung = await quittiere(tx, {
        mandantId, waechter: 'freistellung_ablauf',
        objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
        empfaengerId: benutzerId, kennung: `stufe_${String(lage.stufe)}`,
      });
      if (quittung === null) { schonGemeldet += 1; continue; }
      const e = await stelleZuAnKonto(tx, [{
        benachrichtigung, benutzerId,
        objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
      }]);
      if (e.zugestellt === 0) { await gibQuittungZurueck(tx, quittung); continue; }
      zugestellt += e.zugestellt;
    }
  }
  return { zugestellt, schonGemeldet, ohneEmpfaenger };
}

export function registriereFreistellungAblauf(db: JobVerbindung): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'freistellung_ablauf',
    bezeichnung: 'Hinweis vor dem Ablauf der eigenen § 48b-Freistellungsbescheinigung (60/30/7 Tage)',
    // Nach den Ablaufwarnungen der Nachweise (02:05) — und vor dem Arbeitstag.
    zeitplan: '35 2 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /* Der Stichtag kommt aus der DATENBANK (Invariante 5). */
      const [zeile] = await alsJobRolle(db, (jd) => jd.abfrage<{ tag: string }>(
        `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as tag`));
      const heute = zeile?.tag ?? '';
      const bericht = await meldeFreistellungsAblaeufe(db, heute);
      return {
        stichtag: heute,
        gesellschaften: bericht.gesellschaften,
        faellig: bericht.faellig,
        zugestellt: bericht.zugestellt,
        schon_gemeldet: bericht.schonGemeldet,
        ohne_empfaenger: bericht.ohneEmpfaenger,
      };
    },
  });
}
