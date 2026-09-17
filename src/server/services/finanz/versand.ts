import 'server-only';

/**
 * Das Versandprotokoll einer Rechnung — lesend (`05-FINANZEN.md` §9.6,
 * FIN-11, FIN-12, Invariante 7, K-12, SOC-07).
 *
 * **Dieser Dienst sendet nichts, und er kann es nicht.** Es ist nicht
 * entschieden, welcher EU-gehostete Transaktionsmailer unter welchem
 * Auftragsverarbeitungsvertrag ausliefert (O-36), und kein Peppol-Zugangspunkt
 * ist eingerichtet (O-22). Solange das so ist, gibt {@link versandwege} für
 * jeden Kanal `verbunden: false` zurück, die Oberfläche schreibt „Versand
 * nicht verbunden", und es gibt keinen Sendeknopf. Ein simulierter Erfolg
 * wäre die Auskunft, eine Rechnung sei draussen, die es nicht ist — entdeckt
 * wird das, wenn der Mahnlauf schon gelaufen ist.
 *
 * **Die Datei bleibt trotzdem erreichbar.** `/api/finanzen/rechnungen/[id]/
 * xrechnung.xml` und `/zugferd.pdf` liefern sie (Recht
 * `finanzen.herunterladen`); ein Mensch versendet sie von Hand. Das ist keine
 * Notlösung, sondern derselbe Weg, den die Plattform für die Vergabeportale
 * ausdrücklich vorsieht: Einreichung ist manuell by design.
 *
 * **Was der Dienst NICHT liest: `versand`** (die Tabelle aus 0012). Dorthin
 * schreiben Lead-Bestätigung und Mahnung, und sie trägt kein `rechnung_id`.
 * Das Versandprotokoll der Rechnung ist `rechnung_versand` (0181), weil ein
 * festgeschriebener Beleg keine Spalte bekommt, die sich noch ändert (K-12).
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Kanal =
  'peppol' | 'zre' | 'ozg_re' | 'email' | 'kundenportal' | 'post';

export type VersandStatus =
  'freigegeben' | 'gesendet' | 'fehlgeschlagen' | 'nicht_verbunden';

export type Artefakt = 'xrechnung' | 'zugferd' | 'pdf';

export const KANAL_TEXT: Readonly<Record<Kanal, string>> = {
  peppol: 'Peppol',
  zre: 'Zentrale Rechnungseingangsplattform des Bundes (ZRE)',
  ozg_re: 'OZG-Rechnungseingangsplattform (OZG-RE)',
  email: 'E-Mail',
  kundenportal: 'Kundenportal',
  post: 'Post',
};

export const ARTEFAKT_TEXT: Readonly<Record<Artefakt, string>> = {
  xrechnung: 'XRechnung (UBL, EN 16931)',
  zugferd: 'ZUGFeRD (PDF/A-3 mit CII)',
  pdf: 'PDF',
};

/**
 * Die Kanäle, für die diese Plattform überhaupt elektronisch ausliefern
 * könnte. `kundenportal` und `post` sind KEIN elektronischer Versand durch
 * die Plattform — das Portal zeigt das Dokument, und Papier kuvertiert ein
 * Mensch. Sie brauchen deshalb keine Verbindung und stehen hier nicht.
 */
export const ELEKTRONISCHE_KANAELE: readonly Kanal[] =
  ['peppol', 'zre', 'ozg_re', 'email'];

// ---------------------------------------------------------------------------
// Ist ein Weg verbunden?
// ---------------------------------------------------------------------------

export interface Versandweg {
  readonly kanal: Kanal;
  readonly text: string;
  readonly verbunden: boolean;
  /** Warum nicht — die offene Frage, nicht „Fehler". */
  readonly grund: string | null;
}

/**
 * Für jeden elektronischen Kanal: verbunden oder nicht, mit Grund.
 *
 * Gelesen wird `versand.<kanal>.verbunden` aus `mandant_einstellung` — und
 * **fehlt der Schlüssel, heisst das `false`**. Eine fehlende Einstellung ist
 * keine Erlaubnis; genau diesen Satz führt die Plattform schon in
 * `versand.ergebnis` („eine fehlende Regel ist keine Erlaubnis").
 *
 * Derselbe Schlüssel entscheidet in der Datenbank: der Auslöser
 * `rechnung_versand_2_kanal_verbunden` (0181) weist jede Zeile ab, die für
 * einen unverbundenen Kanal einen anderen Zustand als `nicht_verbunden`
 * behauptet. Zwei Stellen, EIN Schlüssel — die Oberfläche kann den Knopf
 * nicht anbieten, den die Datenbank abweist, und die Datenbank fällt nicht
 * auf eine Oberfläche herein, die es doch versucht.
 */
export async function versandwege(db: Abfrage): Promise<readonly Versandweg[]> {
  const zeilen = await db.abfrage<{ kanal: string; verbunden: boolean }>(
    `select k as kanal,
            coalesce(app.einstellung(app.aktiver_mandant(),
                                     'versand.' || k || '.verbunden'),
                     'false'::jsonb) = 'true'::jsonb as verbunden
       from unnest($1::text[]) as k`,
    [[...ELEKTRONISCHE_KANAELE]]);

  const gelesen = new Map(zeilen.map((z) => [z.kanal, z.verbunden]));
  return ELEKTRONISCHE_KANAELE.map((kanal) => {
    const verbunden = gelesen.get(kanal) === true;
    return {
      kanal,
      text: KANAL_TEXT[kanal],
      verbunden,
      grund: verbunden
        ? null
        : kanal === 'email'
          ? 'Kein EU-gehosteter Transaktionsmailer mit Auftragsverarbeitungsvertrag '
            + 'entschieden (O-36). Die Datei lässt sich herunterladen und von Hand '
            + 'versenden.'
          : 'Kein Zugangspunkt eingerichtet (O-22). Die Einreichung bei den '
            + 'Vergabe- und Rechnungseingangsplattformen ist manuell by design.',
    };
  });
}

/** Gibt es überhaupt einen verbundenen elektronischen Weg? */
export function irgendeinWegVerbunden(wege: readonly Versandweg[]): boolean {
  return wege.some((w) => w.verbunden);
}

// ---------------------------------------------------------------------------
// Das Protokoll
// ---------------------------------------------------------------------------

export interface VersandZeile {
  readonly id: string;
  readonly artefakt: Artefakt;
  readonly artefaktText: string;
  readonly kanal: Kanal;
  readonly kanalText: string;
  readonly empfaenger: string;
  readonly empfaengerName: string | null;
  readonly leitwegId: string | null;
  readonly status: VersandStatus;
  readonly fehlertext: string | null;
  readonly externeId: string | null;
  /** Wer freigegeben hat — Invariante 7 in einer Zeile. */
  readonly freigegebenVon: string | null;
  readonly freigegebenAm: string;
  readonly gesendetAm: string | null;
  readonly zugangAm: string | null;
  readonly zugangGrundlage: string | null;
  /** Der Nachweis, WELCHE Fassung hinausging. */
  readonly nutzlastSha256: string;
}

export async function versandprotokoll(
  db: Abfrage, rechnungId: string,
): Promise<readonly VersandZeile[]> {
  const zeilen = await db.abfrage<{
    id: string; artefakt: Artefakt; kanal: Kanal; empfaenger_text: string;
    empfaenger_name: string | null; leitweg_id: string | null;
    status: VersandStatus; fehlertext: string | null; externe_id: string | null;
    freigegeben_von: string | null; freigegeben_am: string;
    gesendet_am: string | null; zugang_am: string | null;
    zugang_grundlage: string | null; nutzlast_sha256: string;
  }>(
    `select v.id::text as id, v.artefakt, v.kanal::text as kanal,
            v.empfaenger_text, v.leitweg_id,
            nullif(btrim(concat_ws(' ', ap.vorname, ap.nachname)), '')
              as empfaenger_name,
            v.status::text as status, v.fehlertext, v.externe_id,
            bn.name as freigegeben_von,
            to_char(v.freigegeben_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as freigegeben_am,
            to_char(v.gesendet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as gesendet_am,
            to_char(v.zugang_am, 'DD.MM.YYYY') as zugang_am,
            v.zugang_grundlage, v.nutzlast_sha256
       from rechnung_versand v
       left join benutzer bn on bn.id = v.freigegeben_von
       left join ansprechpartner ap
         on ap.mandant_id = v.mandant_id and ap.id = v.empfaenger_ansprechpartner_id
      where v.rechnung_id = $1
      order by v.freigegeben_am desc`,
    [rechnungId]);

  return zeilen.map((z) => ({
    id: z.id,
    artefakt: z.artefakt,
    artefaktText: ARTEFAKT_TEXT[z.artefakt] ?? z.artefakt,
    kanal: z.kanal,
    kanalText: KANAL_TEXT[z.kanal] ?? z.kanal,
    empfaenger: z.empfaenger_text,
    empfaengerName: z.empfaenger_name,
    leitwegId: z.leitweg_id,
    status: z.status,
    fehlertext: z.fehlertext,
    externeId: z.externe_id,
    freigegebenVon: z.freigegeben_von,
    freigegebenAm: z.freigegeben_am,
    gesendetAm: z.gesendet_am,
    zugangAm: z.zugang_am,
    zugangGrundlage: z.zugang_grundlage,
    nutzlastSha256: z.nutzlast_sha256,
  }));
}

// ---------------------------------------------------------------------------
// Was der Empfänger erwartet
// ---------------------------------------------------------------------------

export interface Empfaengerlage {
  readonly kundeId: string;
  readonly kundeName: string;
  readonly leitwegId: string | null;
  readonly elektronischeAdresse: string | null;
  readonly istOeffentlicherAuftraggeber: boolean;
  readonly xrechnungPflicht: boolean;
  /**
   * Der Weg, den DIESER Käufer verlangt — oder `null`.
   *
   * `kunde.uebertragungsweg` gibt es in der Datenbank noch nicht (die Spalte
   * gehört `02-CRM-OPERATIONS.md` §2 und kommt mit dem CRM-Ausbau). Solange
   * sie fehlt, ist der Weg nicht hinterlegt — und ein Käufer mit
   * `xrechnung_pflicht` ohne hinterlegten Weg BLOCKIERT den Versand, statt
   * auf einen Kanal zurückzufallen (07-INTEGRATIONEN §12.1, ausdrücklich).
   */
  readonly uebertragungsweg: Kanal | null;
  readonly wegOffen: boolean;
}

export async function empfaengerlage(
  db: Abfrage, rechnungId: string,
): Promise<Empfaengerlage | null> {
  const [z] = await db.abfrage<{
    kunde_id: string; kunde_name: string; leitweg_id: string | null;
    elektronische_adresse: string | null;
    ist_oeffentlicher_auftraggeber: boolean; xrechnung_pflicht: boolean;
  }>(
    `select k.id::text as kunde_id, k.name as kunde_name, k.leitweg_id,
            k.elektronische_adresse, k.ist_oeffentlicher_auftraggeber,
            k.xrechnung_pflicht
       from rechnung r
       join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
      where r.id = $1`,
    [rechnungId]);
  if (z === undefined) return null;
  return {
    kundeId: z.kunde_id,
    kundeName: z.kunde_name,
    leitwegId: z.leitweg_id,
    elektronischeAdresse: z.elektronische_adresse,
    istOeffentlicherAuftraggeber: z.ist_oeffentlicher_auftraggeber,
    xrechnungPflicht: z.xrechnung_pflicht,
    uebertragungsweg: null,
    wegOffen: true,
  };
}

// TODO(client, O-603): Welcher EU-gehostete Transaktionsmailer liefert den Rechnungsversand aus, und unter welchem Auftragsverarbeitungsvertrag? Ohne Antwort bleibt `versand.email.verbunden` false und die Rechnung wird von Hand versendet. (Fortschreibung von O-36 auf den Rechnungsversand.)
