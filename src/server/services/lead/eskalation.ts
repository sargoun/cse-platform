/**
 * Der stuendliche SLA-Waechter (REQ-06).
 *
 * **Er entscheidet nicht selbst, wann eskaliert wird** — das tut
 * `entscheideEskalation()`, rein und pruefbar. Diese Datei liest die faelligen
 * Leads, fragt die Entscheidung, schreibt das Ergebnis und legt eine
 * Aktivitaet an. Die Trennung ist der Grund, warum sich "hoechstens einmal je
 * Stunde" ohne laufende Uhr pruefen laesst.
 *
 * **Die Aktivitaet ist `richtung = 'intern'`.** Eine Eskalation geht an die
 * eigene Leitung und nicht an den Anfragenden — als `ausgehend` gebucht wuerde
 * sie `erste_reaktion_am` stempeln und damit genau die Uhr anhalten, deren
 * Ablauf sie meldet. Der Lead gaelte als beantwortet, und der Kunde haette
 * weiterhin nichts gehoert.
 */
import { entscheideEskalation, type EskalationsLage } from './sla.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface EskalationsBericht {
  readonly geprueft: number;
  readonly eskaliert: number;
  readonly leads: readonly string[];
}

interface Zeile {
  id: string;
  mandant_id: string;
  leadnummer: string;
  betreff: string;
  besitzer_benutzer_id: string;
  sla_frist_am: Date | string;
  erste_reaktion_am: Date | string | null;
  zuletzt_eskaliert_am: Date | string | null;
  eskalationsstufe: number;
  eskalation_benutzer_id: string | null;
}

const alsDatum = (w: Date | string | null): Date | null =>
  w === null ? null : (w instanceof Date ? w : new Date(w));

export async function eskaliereFaellige(
  db: Abfrage, mandantId: string, jetzt: Date,
): Promise<EskalationsBericht> {
  const zeilen = (await db.unsafe(
    `select l.id, l.mandant_id, l.leadnummer, l.betreff, l.besitzer_benutzer_id,
            l.sla_frist_am, l.erste_reaktion_am, l.zuletzt_eskaliert_am,
            l.eskalationsstufe,
            z.eskalation_benutzer_id
       from lead l
       left join formular_eingang e on e.id = l.formular_eingang_id
       left join formular_zustaendigkeit z
              on z.formular_definition_id = e.formular_definition_id
      where l.mandant_id = $1
        and l.sla_frist_am is not null
        and l.erste_reaktion_am is null
        and l.archiviert_am is null
        and l.sla_frist_am <= $2`,
    [mandantId, jetzt.toISOString()],
  )) as Zeile[];

  const eskaliert: string[] = [];

  for (const z of zeilen) {
    const lage: EskalationsLage = {
      slaFristAm: alsDatum(z.sla_frist_am),
      ersteReaktionAm: alsDatum(z.erste_reaktion_am),
      zuletztEskaliertAm: alsDatum(z.zuletzt_eskaliert_am),
      eskalationsstufe: z.eskalationsstufe,
    };
    const entscheidung = entscheideEskalation(lage, jetzt);
    if (!entscheidung.eskalieren) continue;

    /**
     * Das Zeitfenster gehoert der DATENBANK, nicht dieser Schleife.
     *
     * Zwei gleichzeitige Laeufe laesen beide `zuletzt_eskaliert_am` als alt und
     * schrieben beide — und der Empfaenger bekaeme zwei Mails. Die Bedingung
     * steht deshalb im UPDATE: wer als Zweiter kommt, trifft null Zeilen.
     */
    const getroffen = (await db.unsafe(
      `update lead
          set eskalationsstufe = eskalationsstufe + 1,
              zuletzt_eskaliert_am = $2
        where id = $1
          and erste_reaktion_am is null
          and (zuletzt_eskaliert_am is null or zuletzt_eskaliert_am <= $3)
        returning id`,
      [
        z.id, jetzt.toISOString(),
        new Date(jetzt.getTime() - 3_600_000).toISOString(),
      ],
    )) as { id: string }[];
    if (getroffen.length === 0) continue;

    await db.unsafe(
      `insert into lead_aktivitaet
         (mandant_id, lead_id, typ, richtung, zweck, betreff, inhalt, akteur_art)
       values ($1, $2, 'system', 'intern', 'intern', $3, $4, 'system')`,
      [
        z.mandant_id, z.id,
        `SLA überschritten — Stufe ${String(entscheidung.neueStufe)}`,
        `${entscheidung.grund}. Zuständig: ${z.eskalation_benutzer_id ?? z.besitzer_benutzer_id}.`,
      ],
    );
    eskaliert.push(z.id);
  }

  return { geprueft: zeilen.length, eskaliert: eskaliert.length, leads: eskaliert };
}
