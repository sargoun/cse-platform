/**
 * Kann die Rechnung dieses Käufers überhaupt zugestellt werden? — ein reines
 * Prädikat (FIN-11, LEG-05, 07-INTEGRATIONEN §12.1, O-22).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ein Pflichtkäufer ohne Übertragungsweg SPERRT den Versand.** Er fällt
 * nicht auf E-Mail zurück.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das ist die teuerste Zeile dieser Datei, und sie steht wörtlich so in
 * `07-INTEGRATIONEN.md` §12.1: „a buyer with `xrechnung_pflicht` and no
 * `uebertragungsweg` **blocks** FIN-11 dispatch instead of defaulting".
 *
 * Der Grund: eine XRechnung, die statt an OZG-RE per E-Mail hinausgeht, gilt
 * als **nicht zugestellt**. Die Zahlungsfrist läuft trotzdem, der Mahnlauf
 * mahnt einen Beleg an, der nie angekommen ist — und niemand sieht es, weil
 * der Versand „erfolgreich" war. Ein Vorgabekanal wäre hier keine
 * Bequemlichkeit, sondern ein Beleg mit falschem Empfänger.
 *
 * Die Sperre steht deshalb NICHT als `CHECK` auf `kunde` (0245 begründet das:
 * sie hätte die Pflege genau der Angabe verhindert, die sie erzwingen will),
 * sondern hier — geprüft, und auf dem Steuerblatt des Kunden angezeigt.
 *
 * // TODO(client, O-22): Welche Leitweg-ID, welcher Übertragungsweg (OZG-RE,
 * ZRE, Landesportal, Peppol, E-Mail) und welches Format gilt je öffentlichem
 * Auftraggeber? Bis zur Antwort bleiben beide Spalten leer, und der Versand
 * eines Pflichtkäufers ist gesperrt statt geraten.
 */

/** Die Werte des Enums `uebertragungsweg` (0181). */
export const WEGE = ['peppol', 'zre', 'ozg_re', 'email', 'kundenportal', 'post'] as const;
export type Uebertragungsweg = (typeof WEGE)[number];

/** Die Werte des Enums `rechnungsformat` (0245). */
export const FORMATE = ['xrechnung_ubl', 'zugferd', 'pdf'] as const;
export type Rechnungsformat = (typeof FORMATE)[number];

/**
 * Welche Wege sind ANGESCHLOSSEN?
 *
 * Keiner der drei Portalwege. `07-INTEGRATIONEN.md` §12.1 beschreibt die
 * Häfen; gebaut ist kein Anschluss, und es gibt für keinen Zugangsdaten. Die
 * Oberfläche schreibt an jedem „nicht verbunden" und täuscht keinen Versand
 * vor.
 *
 * `email`, `kundenportal` und `post` sind keine E-Rechnungshäfen: sie
 * brauchen keinen Anschluss, weil ein Mensch sie bedient. Sie gelten
 * deshalb als verbunden — nicht weil etwas angeschlossen wäre, sondern weil
 * nichts anzuschliessen ist.
 */
export const WEG_VERBUNDEN: Readonly<Record<Uebertragungsweg, boolean>> = {
  peppol: false,
  zre: false,
  ozg_re: false,
  email: true,
  kundenportal: true,
  post: true,
};

export const WEG_TEXT: Readonly<Record<Uebertragungsweg, string>> = {
  peppol: 'Peppol (Access Point)',
  zre: 'ZRE — Zentrale Rechnungseingangsplattform des Bundes',
  ozg_re: 'OZG-RE — Onlinezugangsgesetz-Rechnungseingang',
  email: 'E-Mail an die Rechnungsadresse',
  kundenportal: 'Kundenportal dieser Plattform',
  post: 'Papier, per Post',
};

export const FORMAT_TEXT: Readonly<Record<Rechnungsformat, string>> = {
  xrechnung_ubl: 'XRechnung (UBL, EN 16931)',
  zugferd: 'ZUGFeRD (PDF/A-3 mit eingebetteter CII)',
  pdf: 'PDF ohne strukturierte Daten',
};

/** Eine fehlende Pflichtangabe — dieselbe Form wie im XRechnung-Prüfstand. */
export interface FehlendeAngabe {
  /** `BT-10`, `BT-49` … — die Nummer, die im Prüfbericht des Empfängers steht. */
  readonly bt: string;
  /** Die Regel, die sie verlangt. */
  readonly regel: string;
  /** Wo der Wert gepflegt wird, in der Sprache des Portals. */
  readonly feld: string;
  readonly text: string;
}

/** Der Zustand eines Käufers, so wie das Prädikat ihn braucht. */
export interface KaeuferLage {
  readonly xrechnungPflicht: boolean;
  readonly istOeffentlicherAuftraggeber: boolean;
  readonly leitwegId: string | null;
  readonly kaeuferReferenz: string | null;
  readonly elektronischeAdresse: string | null;
  readonly elektronischeAdresseSchema: string | null;
  readonly uebertragungsweg: Uebertragungsweg | null;
  readonly rechnungsformat: Rechnungsformat | null;
  readonly rechnungEmail: string | null;
}

export type VersandArt = 'gesperrt' | 'offen' | 'bereit' | 'nicht_verbunden';

export interface VersandLage {
  readonly art: VersandArt;
  /** Der Satz für den Bildschirm. Immer gesetzt. */
  readonly text: string;
  /** Die Pflichtangaben, die fehlen — leer, wenn keine fehlt. */
  readonly fehlend: readonly FehlendeAngabe[];
}

/**
 * Die Pflichtangaben einer XRechnung, soweit sie am KUNDEN hängen.
 *
 * Nicht die der Rechnung — die prüft `finanz/xrechnung/index.ts` am Beleg.
 * Hier stehen die Felder, die auf dem Kundenstamm gepflegt werden und ohne
 * die jede Rechnung an diesen Käufer abgewiesen wird. Sie einzeln zu nennen
 * ist der Punkt: „Pflichtangaben fehlen" schickt jemanden fünfmal in
 * dieselbe Maske.
 */
export function fehlendeKaeuferangaben(lage: KaeuferLage): readonly FehlendeAngabe[] {
  const fehlt: FehlendeAngabe[] = [];
  const pflicht = lage.xrechnungPflicht || lage.istOeffentlicherAuftraggeber;
  if (!pflicht) return fehlt;

  if (lage.leitwegId === null || lage.leitwegId.trim() === '') {
    fehlt.push({
      bt: 'BT-10', regel: 'BR-DE-15', feld: 'Leitweg-ID',
      text: 'Die Leitweg-ID ist bei einem öffentlichen Auftraggeber die Adresse, '
        + 'unter der die Rechnung überhaupt zugeordnet wird. Ohne sie weist die '
        + 'Eingangsplattform ab.',
    });
  }
  if (lage.elektronischeAdresse === null || lage.elektronischeAdresse.trim() === '') {
    fehlt.push({
      bt: 'BT-49', regel: 'BR-62', feld: 'Elektronische Adresse des Käufers',
      text: 'EN 16931 verlangt die elektronische Adresse des Erwerbers samt ihrem '
        + 'Schema (BT-49-1).',
    });
  } else if (lage.elektronischeAdresseSchema === null
    || lage.elektronischeAdresseSchema.trim() === '') {
    fehlt.push({
      bt: 'BT-49-1', regel: 'BR-62', feld: 'Schema der elektronischen Adresse',
      text: 'Eine elektronische Adresse ohne Schema ist nicht auflösbar — '
        + '`0204` (Leitweg-ID), `EM` (E-Mail), `0088` (GLN).',
    });
  }
  if (lage.uebertragungsweg === null) {
    fehlt.push({
      bt: '—', regel: '07-INTEGRATIONEN §12.1', feld: 'Übertragungsweg',
      text: 'Es ist kein Zustellweg verabredet. Er wird NICHT geraten: eine '
        + 'XRechnung auf dem falschen Kanal gilt als nicht zugestellt, während die '
        + 'Zahlungsfrist läuft (offen, O-22).',
    });
  }
  if (lage.rechnungsformat === null) {
    fehlt.push({
      bt: '—', regel: '05-FINANZEN §906', feld: 'Rechnungsformat',
      text: 'Es ist kein Format verabredet. „Nicht verabredet" heisst nicht „PDF" '
        + '(offen, O-22).',
    });
  }
  return fehlt;
}

/**
 * Darf an diesen Käufer versendet werden — und wenn nicht, warum?
 *
 * Vier Antworten, und keine davon ist „vermutlich":
 *
 *  - `gesperrt`        — Pflichtkäufer, und eine Pflichtangabe fehlt.
 *  - `nicht_verbunden` — alles gepflegt, aber der verabredete Hafen hat
 *                        keinen Anschluss. Der Beleg entsteht, der Versand
 *                        nicht.
 *  - `offen`           — kein Pflichtkäufer und kein Weg verabredet. Kein
 *                        Fehler, aber auch keine Zusage.
 *  - `bereit`          — der Weg steht und ist bedienbar.
 */
export function versandLage(lage: KaeuferLage): VersandLage {
  const fehlend = fehlendeKaeuferangaben(lage);
  const pflicht = lage.xrechnungPflicht || lage.istOeffentlicherAuftraggeber;

  if (pflicht && fehlend.length > 0) {
    return {
      art: 'gesperrt',
      text: `Dieser Käufer verlangt eine XRechnung, und ${
        fehlend.length === 1 ? 'eine Pflichtangabe fehlt' : `${String(fehlend.length)} Pflichtangaben fehlen`
      }. Der Versand ist gesperrt — er fällt nicht auf einen anderen Kanal zurück.`,
      fehlend,
    };
  }

  if (lage.uebertragungsweg === null) {
    return {
      art: 'offen',
      text: 'Es ist kein Zustellweg verabredet. Dieser Käufer verlangt keine '
        + 'XRechnung, also ist das kein Mangel — aber es ist auch keine Zusage: '
        + 'wohin die Rechnung geht, entscheidet bis dahin ein Mensch.',
      fehlend,
    };
  }

  if (!WEG_VERBUNDEN[lage.uebertragungsweg]) {
    return {
      art: 'nicht_verbunden',
      text: `Verabredet ist ${WEG_TEXT[lage.uebertragungsweg]}. Dieser Hafen ist `
        + 'NICHT verbunden (O-22): das Dokument entsteht und ist herunterladbar, '
        + 'die Übermittlung erfolgt bis auf Weiteres von Hand.',
      fehlend,
    };
  }

  if (lage.uebertragungsweg === 'email'
    && (lage.rechnungEmail === null || lage.rechnungEmail.trim() === '')) {
    return {
      art: 'gesperrt',
      text: 'Verabredet ist E-Mail, aber an diesem Kunden steht keine '
        + 'Rechnungsadresse. Ohne Adresse gibt es keinen Versand.',
      fehlend: [...fehlend, {
        bt: 'BT-43', regel: 'BR-DE-1', feld: 'Rechnung an (E-Mail)',
        text: 'Der Zustellweg ist E-Mail; die Adresse dafür fehlt am Kundenstamm.',
      }],
    };
  }

  return {
    art: 'bereit',
    text: `Verabredet ist ${WEG_TEXT[lage.uebertragungsweg]}${
      lage.rechnungsformat === null ? '' : ` im Format ${FORMAT_TEXT[lage.rechnungsformat]}`
    }.`,
    fehlend,
  };
}
