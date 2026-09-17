/**
 * Die Richtlinien des Ausgangs-Gates als Konfiguration (AGT-03, APR-01,
 * Invariante 7).
 *
 * **Was hier geprueft wird, ist eine Zusicherung und keine Formatierung:**
 * der Bildschirm darf nie „geht automatisch hinaus" behaupten, wo `gate()`
 * abweist. Beide Stellen sind unabhaengig voneinander geschrieben — die
 * Sperre steht in `server/agent/policy.ts`, die Anzeige in
 * `services/agent/richtlinie.ts` —, und genau deshalb muessen sie
 * gegeneinander gehalten werden. Liefen sie auseinander, saehe eine
 * Administration eine Erlaubnis, die es nicht gibt, und liesse sich darauf
 * ein.
 */
import { describe, expect, it } from 'vitest';
import {
  AKTIONEN, gate, nutzlastHash, type Aktion, type Nutzlast, type Richtlinie,
} from '../../src/server/agent/policy.js';
import {
  AKTION_TEXT, IM_CODE_GESPERRT, WIRKUNG_TEXT, wirkungVon,
} from '../../src/server/services/agent/richtlinie.js';

/** Eine Zeile, wie `ladeRichtlinien` sie aus der Datenbank liest. */
function zeile(o: {
  auto?: boolean; aktiv?: boolean; limit?: string | null;
}): Parameters<typeof wirkungVon>[1] {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    aktion: 'email_senden',
    auto_erlaubt: o.auto ?? false,
    max_betrag_cent: o.limit ?? null,
    ist_aktiv: o.aktiv ?? true,
    begruendung: null,
    geaendert_am: null,
    geaendert_von: null,
  };
}

function nutzlast(aktion: Aktion): Nutzlast {
  return { aktion, mandantId: 'm1', inhalt: { a: 1 } };
}

function richtlinie(aktion: Aktion, o: {
  auto: boolean; limit?: bigint | null; aktiv?: boolean;
}): Richtlinie {
  return {
    mandantId: 'm1', aktion, autoErlaubt: o.auto,
    maxBetragCent: o.limit ?? null, ist_aktiv: o.aktiv ?? true,
  };
}

describe('wirkungVon', () => {
  it('keine Zeile heisst „Freigabe nötig", nicht „egal"', () => {
    expect(wirkungVon('email_senden', undefined)).toBe('nicht_hinterlegt');
    /* Der Text traegt die Bedeutung, nicht die Farbe (DESIGN §9). */
    expect(WIRKUNG_TEXT.nicht_hinterlegt).toContain('Freigabe nötig');
  });

  it('eine abgeschaltete Zeile wirkt wie keine — und sagt es', () => {
    expect(wirkungVon('email_senden', zeile({ auto: true, aktiv: false })))
      .toBe('abgeschaltet');
    expect(WIRKUNG_TEXT.abgeschaltet).toContain('Freigabe nötig');
  });

  it('auto_erlaubt = false heisst Freigabe, mit und ohne Limit', () => {
    expect(wirkungVon('email_senden', zeile({ auto: false }))).toBe('freigabe');
    expect(wirkungVon('email_senden', zeile({ auto: false, limit: '5000' })))
      .toBe('freigabe');
  });

  it('ohne Limit automatisch, mit Limit automatisch bis zum Limit', () => {
    expect(wirkungVon('email_senden', zeile({ auto: true }))).toBe('automatisch');
    expect(wirkungVon('email_senden', zeile({ auto: true, limit: '5000' })))
      .toBe('automatisch_bis_limit');
  });

  it('die im Code gesperrten Aktionen bleiben gesperrt, auch mit auto_erlaubt', () => {
    for (const a of IM_CODE_GESPERRT) {
      expect(wirkungVon(a, zeile({ auto: true })), a).toBe('im_code_gesperrt');
      expect(wirkungVon(a, zeile({ auto: true, limit: '999999999' })), a)
        .toBe('im_code_gesperrt');
    }
  });
});

describe('IM_CODE_GESPERRT gegen gate()', () => {
  /**
   * **Der eigentliche Test dieser Datei.** Fuer JEDE Aktion wird `gate()` mit
   * der grosszuegigsten denkbaren Richtlinie gefragt — aktiv, `auto_erlaubt`,
   * kein Limit, kein Empfaenger ohne Rechtsgrundlage. Was dann trotzdem
   * abgewiesen wird, MUSS in `IM_CODE_GESPERRT` stehen, und was durchgeht,
   * darf nicht darin stehen. Eine vierte Sperre im Code ohne Eintrag hier
   * liesse die Seite „automatisch" anzeigen, wo abgewiesen wird; ein Eintrag
   * ohne Sperre liesse sie „nie automatisch" behaupten, wo gesendet wird.
   */
  it('genau die Aktionen, die gate() bei bester Richtlinie abweist', () => {
    const abgewiesen = AKTIONEN.filter((a) => {
      const ergebnis = gate(nutzlast(a), null, richtlinie(a, { auto: true }));
      return !ergebnis.erlaubt;
    });
    expect([...abgewiesen].sort()).toEqual([...IM_CODE_GESPERRT].sort());
  });

  it('jede der acht Aktionen hat einen deutschen Satz', () => {
    for (const a of AKTIONEN) {
      expect(AKTION_TEXT[a], a).toBeTruthy();
      expect(AKTION_TEXT[a].length, a).toBeGreaterThan(5);
    }
  });

  it('das Register ist der vollstaendige Konfigurationsraum — keine Aktion fehlt', () => {
    /*
     * `AKTIONEN` fehlte einmal `nachtrag_einreichen`, obwohl der Typ es
     * fuehrte: die Aktion war damit von jeder registerbasierten Einstellung
     * ausgenommen, und die Luecke war unsichtbar. Ein Typ, der mehr kennt als
     * sein Register, macht genau das.
     */
    expect(new Set(AKTIONEN).size).toBe(AKTIONEN.length);
    expect(Object.keys(AKTION_TEXT).sort()).toEqual([...AKTIONEN].sort());
  });
});

describe('das Gate bleibt fail-closed', () => {
  it('ohne Richtlinie und ohne Freigabe geht nichts hinaus', () => {
    for (const a of AKTIONEN) {
      expect(gate(nutzlast(a), null, null).erlaubt, a).toBe(false);
    }
  });

  it('eine abgeschaltete Richtlinie ist keine Erlaubnis', () => {
    const ergebnis = gate(nutzlast('email_senden'), null,
      richtlinie('email_senden', { auto: true, aktiv: false }));
    expect(ergebnis.erlaubt).toBe(false);
  });

  it('das Betragslimit greift oberhalb, nicht darunter', () => {
    const gross: Nutzlast = {
      aktion: 'rechnung_senden', mandantId: 'm1', betragCent: 5001n, inhalt: {},
    };
    const klein: Nutzlast = { ...gross, betragCent: 5000n };
    expect(gate(gross, null, richtlinie('rechnung_senden',
      { auto: true, limit: 5000n })).erlaubt).toBe(false);
    expect(gate(klein, null, richtlinie('rechnung_senden',
      { auto: true, limit: 5000n })).erlaubt).toBe(true);
  });

  it('der Hash bindet die Freigabe an den Inhalt', () => {
    const a: Nutzlast = { aktion: 'email_senden', mandantId: 'm1', inhalt: { text: 'A' } };
    const b: Nutzlast = { ...a, inhalt: { text: 'B' } };
    expect(nutzlastHash(a)).not.toBe(nutzlastHash(b));
  });
});
