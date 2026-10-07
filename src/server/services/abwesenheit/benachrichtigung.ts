import 'server-only';
import { erzeuge, sicherRegistriert, type ArtDefinition }
  from '../../benachrichtigung/registry.js';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * „Abwesenheit zurückgenommen" — die Meldung an die Personalstelle, wenn ein
 * Mensch seine eigene, noch unentschiedene Abwesenheit zurücknimmt (V-353,
 * O-895, D-795).
 *
 * **Warum es sie geben muss.** Die Rücknahme bleibt möglich, auch wenn die
 * Tage schon in einem Lohnexport standen: der Export ist ein Lesevorgang ohne
 * gespeicherten Lauf, und berichtigt wird im Lohnsystem. Das geht nur, wenn
 * die Personalstelle davon ERFÄHRT — bis hierher stand die Rücknahme allein
 * im Protokoll, und dort sieht niemand nach.
 *
 * **Deutsch.** Die Empfänger sind die Verwaltung (`zeit.abwesenheit_genehmigen`);
 * das interne Portal ist deutsch, und seine Begriffe tragen juristische
 * Bedeutung (`benachrichtigung-sprachen.test.ts` §5).
 *
 * **Keine Abwesenheitsart im Text.** Ob jemand krank war, ist ein
 * Gesundheitsdatum (Art. 9 DSGVO, 0073); die Meldung nennt Person und
 * Zeitraum, die Art steht nur für den, der sie lesen darf, auf dem Blatt.
 *
 * **Nicht sammelbar.** Eine Berichtigung im Lohnsystem hat eine Frist — den
 * nächsten Abrechnungslauf.
 *
 * **Zusammengesetzter Schlüssel** — ein Literal der Form `<modul>.<etwas>`
 * läse der Rechtekatalog-Scanner sonst als Rechteschlüssel (K-19, D-493).
 */
const PERSONAL = 'personal';

export const ART_ABWESENHEIT_ZURUECKGENOMMEN = `${PERSONAL}.abwesenheit_zurueckgenommen`;

function zurueckgenommen(): ArtDefinition {
  return ({
    schluessel: ART_ABWESENHEIT_ZURUECKGENOMMEN,
    titel: (k) => `Abwesenheit zurückgenommen: ${String(k.daten['person'] ?? 'unbekannt')}`,
    text: (k) => {
      const von = String(k.daten['von'] ?? '');
      const bis = String(k.daten['bis'] ?? '');
      const zeitraum = von === bis ? `am ${von}` : `vom ${von} bis ${bis}`;
      return `${String(k.daten['person'] ?? 'Ein Mensch')} hat die eigene Abwesenheit `
        + `${zeitraum} zurückgenommen. Standen diese Tage schon in einem Lohnexport, `
        + 'ist der Monat im Lohnsystem zu berichtigen.';
    },
    ziel: (k) => (typeof k.mandantSlug === 'string' && k.mandantSlug !== '' && k.objektId !== ''
      ? `/portal/${k.mandantSlug}/personal/abwesenheiten/${k.objektId}` : null),
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

/** Idempotent wie die übrigen Register (D-493): der Bootstrap läuft mehrfach. */
export function registriereAbwesenheitArten(): readonly ArtDefinition[] {
  return sicherRegistriert([zurueckgenommen()]);
}

/**
 * Die eigene Rücknahme bei der Personalstelle melden — in DERSELBEN
 * Transaktion wie die Stornierung (`storniereAbwesenheit`), damit es keine
 * Rücknahme ohne Meldung gibt und keine Meldung ohne Rücknahme.
 *
 * Gelesen wird im Mandanten-Scope der Arbeiterin: der eigene Name
 * (`t_person_lesen`, eigene Person) und der Zeitraum (`p_ma_decke`, eigene
 * Abwesenheit). Zugestellt wird über `app.abwesenheit_ruecknahme_melden`
 * (0500) — `cse_app` hat auf `benachrichtigung` kein INSERT, und der Definer
 * lässt nur diese eine Art für die eigene, gerade stornierte Abwesenheit zu.
 *
 * Gibt zurück, wie viele Konten die Meldung bekommen haben; null heisst:
 * niemand in der Gesellschaft entscheidet Abwesenheiten im Portal.
 */
export async function meldeRuecknahme(kontext: SchreibKontext, id: string): Promise<number> {
  registriereAbwesenheitArten();
  const [z] = await kontext.abfrage<{
    von: string; bis: string; person: string | null; slug: string | null;
  }>(
    `select to_char(a.von, 'DD.MM.YYYY') as von, to_char(a.bis, 'DD.MM.YYYY') as bis,
            (select p.vorname || ' ' || p.nachname from person p
              where p.id = app.aktuelle_person()) as person,
            (select m.slug from mandant m where m.id = a.mandant_id) as slug
       from abwesenheit a
      where a.id = $1::uuid`, [id]);
  // Ohne Slug kein Ziel, und ohne Ziel keine Meldung (NOT-03) — statt eines 500ers.
  if (z === undefined || z.slug === null) return 0;
  const b = erzeuge(ART_ABWESENHEIT_ZURUECKGENOMMEN, {
    mandantId: kontext.aktiverMandantId,
    mandantSlug: z.slug,
    objektTyp: 'abwesenheit',
    objektId: id,
    daten: { person: z.person ?? 'Ein Mensch', von: z.von, bis: z.bis },
  });
  const [r] = await kontext.schreibe<{ anzahl: number }>(
    `select app.abwesenheit_ruecknahme_melden($1::uuid, $2, $3, $4) as anzahl`,
    [id, b.titel, b.text, b.ziel]);
  return Number(r?.anzahl ?? 0);
}
