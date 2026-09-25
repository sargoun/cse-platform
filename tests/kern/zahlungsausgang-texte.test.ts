import { describe, expect, it } from 'vitest';
import type { ZahlungFehler } from '../../src/server/services/finanz/zahlung/index.js';
import { EINGANGSRECHNUNGEN_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

/**
 * **Jede Abweisung des Zahlungsausgangs hat ihren eigenen Satz** (V-217,
 * Prüfung von V-216).
 *
 * Die Route `/api/finanzen/zahlungen` (aktion `ausgang`) führt jeden
 * `ZahlungFehler` mit `?fehler=<grund>` auf die Eingangsrechnung zurück, und
 * die Seite schlägt den Grund in `ausgangFehler` nach. Vorher sagte der
 * Eintrag `abgewiesen` „der Betrag muss größer als null sein" — derselbe
 * Grund kam aber auch, wenn eine Zeile von RLS abgewiesen wurde oder das
 * Guthaben nicht eröffnet werden konnte. Ein fehlender Eintrag fiele auf den
 * allgemeinen Satz zurück; hier steht, dass keiner fehlt.
 *
 * Der Satz aller Gründe ist als `Record` über die Vereinigung geschrieben:
 * kommt an `ZahlungFehler` ein Grund dazu, meldet der Übersetzer die Lücke.
 */
const GRUENDE: Readonly<Record<ZahlungFehler['grund'], true>> = {
  nicht_gefunden: true,
  kein_posten: true,
  schon_ausgeglichen: true,
  storniert: true,
  abgewiesen: true,
  betrag_nicht_positiv: true,
  bankkonto_fremd: true,
};

/** Was die Route selbst vergibt, bevor ein Dienst läuft. */
const ROUTENGRUENDE = ['unvollstaendig', 'datum', 'betrag'] as const;

describe('Zahlungsausgang: jeder Grund hat einen Satz', () => {
  for (const sprache of ['de', 'en'] as const) {
    const t = EINGANGSRECHNUNGEN_TEXTE[sprache];
    it(`${sprache}: jeder Grund der Route und des Dienstes, ausser „storniert"`, () => {
      const fehlend = [...Object.keys(GRUENDE), ...ROUTENGRUENDE]
        /* `storniert` wirft nur `storniereZahlung`, nie der Ausgang. */
        .filter((g) => g !== 'storniert')
        .filter((g) => eigenerEintrag(t.ausgangFehler, g) === undefined);
      expect(fehlend).toEqual([]);
    });

    it(`${sprache}: „abgewiesen" behauptet nicht mehr, der Betrag sei schuld`, () => {
      expect(t.ausgangFehler['abgewiesen']).not.toMatch(/null|zero/u);
      expect(t.ausgangFehler['betrag_nicht_positiv']).toMatch(/null|zero/u);
    });
  }
});
