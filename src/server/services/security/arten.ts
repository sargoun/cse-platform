/**
 * Die Voreinstellung der Posten- und Schluesselarten (O-148, D-783).
 *
 * Beide Kataloge (`postenart` 0069, `schluesselart` 0079) wurden leer
 * ausgeliefert, und es gab keinen Dienst, der eine Zeile anlegt — die Posten-
 * und Schluesselmaske sagten „keine Arten hinterlegt". Seit D-783 gibt es die
 * Voreinstellung eines Berliner Sicherheitsdienstes, die ein leerer Katalog mit
 * einem Knopf uebernimmt: unbestaetigt (`ist_platzhalter`, §1.16), bis die
 * Gesellschaft bestaetigt, ergaenzt oder archiviert. Die Uebersetzungen gelten
 * dem Mitarbeiterportal (EMP-12); das Deutsche ist die Bezeichnung.
 *
 * Idempotent: ein Schluessel, der schon steht — auch archiviert —, wird nicht
 * noch einmal angelegt. Jede Zeile steht im Pruefprotokoll.
 */
import type { SchreibKontext } from '../../kontext/index.js';

export interface ArtVoreinstellung {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly uebersetzungen: Readonly<Record<'en' | 'ar' | 'tr', string>>;
  readonly sortierung: number;
}

// TODO(client, O-148): Voreinstellung — diese Posten- und Schluesselarten; die Gesellschaft bestaetigt, ergaenzt oder archiviert.
export const POSTENART_VOREINSTELLUNG: readonly ArtVoreinstellung[] = [
  { schluessel: 'objektschutz', bezeichnung: 'Objektschutz', sortierung: 10,
    uebersetzungen: { en: 'Static guarding', ar: 'حماية المواقع', tr: 'Tesis koruma' } },
  { schluessel: 'empfang', bezeichnung: 'Empfang und Pforte', sortierung: 20,
    uebersetzungen: { en: 'Reception and gate', ar: 'الاستقبال والبوابة', tr: 'Resepsiyon ve kapı' } },
  { schluessel: 'revier', bezeichnung: 'Revier- und Streifendienst', sortierung: 30,
    uebersetzungen: { en: 'Mobile patrol', ar: 'الدوريات', tr: 'Devriye hizmeti' } },
  { schluessel: 'veranstaltung', bezeichnung: 'Veranstaltungsschutz', sortierung: 40,
    uebersetzungen: { en: 'Event security', ar: 'تأمين الفعاليات', tr: 'Etkinlik güvenliği' } },
  { schluessel: 'baustelle', bezeichnung: 'Baustellenbewachung', sortierung: 50,
    uebersetzungen: { en: 'Construction site guarding', ar: 'حراسة مواقع البناء', tr: 'Şantiye bekçiliği' } },
  { schluessel: 'intervention', bezeichnung: 'Alarmverfolgung und Intervention', sortierung: 60,
    uebersetzungen: { en: 'Alarm response', ar: 'الاستجابة للإنذارات', tr: 'Alarm müdahale' } },
];

export const SCHLUESSELART_VOREINSTELLUNG: readonly ArtVoreinstellung[] = [
  { schluessel: 'mechanisch', bezeichnung: 'Mechanischer Schlüssel', sortierung: 10,
    uebersetzungen: { en: 'Mechanical key', ar: 'مفتاح ميكانيكي', tr: 'Mekanik anahtar' } },
  { schluessel: 'general', bezeichnung: 'Generalschlüssel', sortierung: 20,
    uebersetzungen: { en: 'Master key', ar: 'المفتاح الرئيسي', tr: 'Ana anahtar' } },
  { schluessel: 'gruppe', bezeichnung: 'Gruppenschlüssel', sortierung: 30,
    uebersetzungen: { en: 'Group key', ar: 'مفتاح المجموعة', tr: 'Grup anahtarı' } },
  { schluessel: 'transponder', bezeichnung: 'Transponder', sortierung: 40,
    uebersetzungen: { en: 'Transponder', ar: 'مفتاح إلكتروني (ترانسبوندر)', tr: 'Transponder' } },
  { schluessel: 'chipkarte', bezeichnung: 'Chipkarte', sortierung: 50,
    uebersetzungen: { en: 'Chip card', ar: 'بطاقة إلكترونية', tr: 'Çipli kart' } },
];

async function uebernimmArten(
  kontext: SchreibKontext, tabelle: 'postenart' | 'schluesselart',
  arten: readonly ArtVoreinstellung[],
): Promise<number> {
  const da = await kontext.abfrage<{ schluessel: string }>(
    `select schluessel from ${tabelle} where mandant_id = app.aktiver_mandant()`);
  const vorhanden = new Set(da.map((z) => z.schluessel));
  let angelegt = 0;
  for (const a of arten) {
    if (vorhanden.has(a.schluessel)) continue;
    const zeilen = await kontext.schreibe<{ id: string }>(
      `insert into ${tabelle}
         (mandant_id, schluessel, bezeichnung, bezeichnung_i18n, sortierung, ist_platzhalter,
          erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3::jsonb, $4::smallint, true, 'mensch', $5::uuid)
       returning id`,
      [a.schluessel, a.bezeichnung, JSON.stringify(a.uebersetzungen), a.sortierung,
        kontext.benutzerId]);
    const id = zeilen[0]?.id;
    if (id === undefined) {
      throw new Error(`Die ${tabelle}-Zeile „${a.schluessel}" wurde nicht angelegt — Rechte?`);
    }
    await kontext.schreibe(
      `select app.protokolliere($1, $2, $3, null, $4::jsonb, app.aktiver_mandant())`,
      [`security.${tabelle}_angelegt`, tabelle, id,
        JSON.stringify({ schluessel: a.schluessel, bezeichnung: a.bezeichnung,
          ist_platzhalter: true, voreinstellung: 'O-148' })]);
    angelegt += 1;
  }
  return angelegt;
}

/** Legt die Postenarten der Voreinstellung an, die noch fehlen; gibt ihre Zahl zurueck. */
export function uebernimmPostenartVoreinstellung(kontext: SchreibKontext): Promise<number> {
  return uebernimmArten(kontext, 'postenart', POSTENART_VOREINSTELLUNG);
}

/** Legt die Schluesselarten der Voreinstellung an, die noch fehlen; gibt ihre Zahl zurueck. */
export function uebernimmSchluesselartVoreinstellung(kontext: SchreibKontext): Promise<number> {
  return uebernimmArten(kontext, 'schluesselart', SCHLUESSELART_VOREINSTELLUNG);
}
