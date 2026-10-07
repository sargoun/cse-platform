/**
 * Krankheit im Urlaub (V-319, O-138, D-853, § 9 BUrlG) — was ohne Datenbank
 * entschieden wird.
 *
 * Was die Datenbank hält — die Gutschrift auf dem Urlaubskonto, ihre
 * Stornierung, die Stornierung des Urlaubs danach, die Decken, Art. 9 und
 * die Rechte —, steht in `tests/isolation/krankheit-im-urlaub.test.ts`. Hier:
 *
 *  1. Die Zahl: die Arbeitstage des Urlaubs, die in die Krankheit fallen —
 *     ohne Wochenenden und Feiertage, nur im Urlaub, mit den halben Tagen
 *     des Urlaubs genau so, wie sie abgezogen wurden.
 *  2. Die Gegenprobe: Gutschrift plus die Kosten der Teile davor und danach
 *     ergeben wieder genau den Urlaub.
 *  3. Die Verdrahtung: Voreinstellung, Funktion, Rechte, Route, Katalog.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import { rechneTage } from '../../src/server/services/abwesenheit/tage.js';
import {
  gutschriftTage, KrankheitImUrlaubFehler, type Urlaubszeitraum,
} from '../../src/server/services/abwesenheit/krankheit-im-urlaub.js';

/** Montag, 5. Oktober, bis Freitag, 16. Oktober 2026 — zehn Arbeitstage. */
const ZWEI_WOCHEN: Urlaubszeitraum = {
  von: '2026-10-05', bis: '2026-10-16', vonHalbtags: false, bisHalbtags: false,
};

describe('(1) die Arbeitstage des Urlaubs, die in die Krankheit fallen', () => {
  it('Mittwoch bis Freitag mitten im Urlaub: drei', () => {
    expect(rechneTage(ZWEI_WOCHEN)).toBe(milliMenge(10_000n));
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-07', bis: '2026-10-09' }))
      .toBe(milliMenge(3_000n));
  });

  it('das Wochenende in der Krankheit gibt nichts zurück — es hat nichts gekostet', () => {
    // Donnerstag bis Dienstag: Do, Fr, Mo, Di.
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-08', bis: '2026-10-13' }))
      .toBe(milliMenge(4_000n));
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-10', bis: '2026-10-11' }))
      .toBe(milliMenge(0n));
  });

  it('nur im Urlaub: eine Krankheit über sein Ende hinaus zählt bis zum letzten Urlaubstag', () => {
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-14', bis: '2026-10-23' }))
      .toBe(milliMenge(3_000n));
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-09-28', bis: '2026-10-06' }))
      .toBe(milliMenge(2_000n));
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-19', bis: '2026-10-23' }))
      .toBe(milliMenge(0n));
  });

  it('der Feiertag im Urlaub (3. Oktober fällt 2026 auf einen Samstag — der 25. Dezember nicht)', () => {
    const weihnachten: Urlaubszeitraum = {
      von: '2026-12-21', bis: '2026-12-31', vonHalbtags: false, bisHalbtags: false,
    };
    // 21.–24. (Mo–Do), 25. Feiertag, 28.–31. (Mo–Do): acht Arbeitstage.
    expect(rechneTage(weihnachten)).toBe(milliMenge(8_000n));
    // Krank 24. bis 28.: Do 24., Fr 25. (Feiertag), Mo 28. — zwei Tage zurück.
    expect(gutschriftTage(weihnachten, { von: '2026-12-24', bis: '2026-12-28' }))
      .toBe(milliMenge(2_000n));
  });

  it('der halbe Tag am Rand des Urlaubs kommt halb zurück — wie er abgezogen wurde', () => {
    const halb: Urlaubszeitraum = { ...ZWEI_WOCHEN, vonHalbtags: true, bisHalbtags: true };
    expect(rechneTage(halb)).toBe(milliMenge(9_000n));
    expect(gutschriftTage(halb, { von: '2026-10-16', bis: '2026-10-16' })).toBe(milliMenge(500n));
    expect(gutschriftTage(halb, { von: '2026-10-05', bis: '2026-10-06' })).toBe(milliMenge(1_500n));
    expect(gutschriftTage(halb, { von: '2026-10-01', bis: '2026-10-31' })).toBe(milliMenge(9_000n));
  });

  it('eine andere Arbeitswoche gilt für Urlaub und Gutschrift gleich', () => {
    // Montag bis Samstag: der Samstag kostet, also kommt er zurück.
    const sechs = [1, 2, 3, 4, 5, 6] as const;
    expect(gutschriftTage(ZWEI_WOCHEN, { von: '2026-10-08', bis: '2026-10-13' }, sechs))
      .toBe(milliMenge(5_000n));
  });
});

describe('(2) die Gegenprobe — Gutschrift plus Rest ist der Urlaub', () => {
  const faelle: readonly [Urlaubszeitraum, string, string][] = [
    [ZWEI_WOCHEN, '2026-10-07', '2026-10-09'],
    [{ ...ZWEI_WOCHEN, vonHalbtags: true }, '2026-10-05', '2026-10-05'],
    [{ ...ZWEI_WOCHEN, bisHalbtags: true }, '2026-10-12', '2026-10-16'],
    [{ ...ZWEI_WOCHEN, vonHalbtags: true, bisHalbtags: true }, '2026-10-06', '2026-10-15'],
  ];
  it.each(faelle)('%o krank %s bis %s', (urlaub, von, bis) => {
    const rest = (von > urlaub.von
      ? rechneTage({ von: urlaub.von, bis: tagVor(von), vonHalbtags: urlaub.vonHalbtags }) : 0n)
      + (bis < urlaub.bis
        ? rechneTage({ von: tagNach(bis), bis: urlaub.bis, bisHalbtags: urlaub.bisHalbtags }) : 0n);
    expect(gutschriftTage(urlaub, { von, bis }) + rest).toBe(rechneTage(urlaub));
  });
});

function tagVor(tag: string): string {
  const d = new Date(`${tag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function tagNach(tag: string): string {
  const d = new Date(`${tag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('(3) Verdrahtung', () => {
  it('der Dienst sagt die Voreinstellung und geht über die eine Funktion', () => {
    const dienst = readFileSync('src/server/services/abwesenheit/krankheit-im-urlaub.ts', 'utf8');
    expect(dienst).toContain('// TODO(client, O-138): Voreinstellung');
    expect(dienst).toContain('app.krankheit_im_urlaub_erfassen(');
    // Ohne Bescheinigung keine Gutschrift — der Grund steht als eigener Schlüssel da.
    expect(new KrankheitImUrlaubFehler('au_fehlt').status).toBe(400);
    expect(new KrankheitImUrlaubFehler('schon_erfasst').status).toBe(409);
  });

  it('die Migration: zwei Rechte, Definer, kein direkter Weg für cse_app, Art. 9', () => {
    const m = readFileSync('drizzle/0537_krankheit_im_urlaub.sql', 'utf8');
    expect(m).toContain("app.hat_recht('zeit.abwesenheit_melden', v_mandant)");
    expect(m).toContain("app.hat_recht('zeit.abwesenheit_genehmigen', v_mandant)");
    expect(m).toContain('owner to cse_definer');
    expect(m).toContain("current_user in ('cse_app', 'cse_anon', 'cse_checkin', 'cse_job')");
    expect(m).toContain('-- TODO(client, O-138): Voreinstellung');
    // Die zwei Spalten bekommt cse_app nicht zu lesen: kein grant select nennt sie.
    expect(m).not.toMatch(/grant select[^;]*unterbrochener_urlaub_id/u);
  });

  it('Route, Seite und Katalog', () => {
    const manifest = readFileSync('src/server/auth/route-manifest.ts', 'utf8');
    expect(manifest).toContain("pfad: 'api/antraege/[id]/krankheit-im-urlaub'");
    const route = readFileSync('src/app/api/antraege/[id]/krankheit-im-urlaub/route.ts', 'utf8');
    expect(route).toContain("recht: 'zeit.abwesenheit_genehmigen'");
    expect(route).toContain("recht: 'zeit.abwesenheit_melden'");
    const seite = readFileSync('src/app/portal/[mandant]/personal/antraege/[id]/page.tsx', 'utf8');
    expect(seite).toContain('action={`/api/antraege/${id}/krankheit-im-urlaub`}');
    const katalog = readFileSync('src/server/services/stammdaten/abwesenheitsart.ts', 'utf8');
    expect(katalog).toContain('unterbricht_urlaub = $12::boolean');
  });
});
