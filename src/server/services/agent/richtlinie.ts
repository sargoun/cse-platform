import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import { AKTIONEN, type Aktion, type Richtlinie } from '../../agent/policy.js';

/**
 * Die Richtlinien des Ausgangs-Gates als DATEN — lesen und setzen (AGT-03,
 * APR-01, Invariante 7).
 *
 * **`server/agent/policy.ts` entscheidet, dieser Dienst liest.** `gate()`
 * bekommt die Zeile uebergeben und faellt ohne sie zu. Bis hierher las genau
 * eine Stelle die Tabelle selbst (`services/bau/nachtrag.ts`), und die
 * uebrigen Aufrufer uebergaben bewusst `null` — also „immer Freigabe".
 *
 * **Und daran aendert dieser Dienst nichts.** Das ist die wichtigste Zeile
 * dieser Datei. `ladeRichtlinien` hier einzuziehen und in
 * `api/anfrage/route.ts`, `api/finanzen/mahnungen/route.ts` und
 * `api/bau/behinderungen/[id]/versenden/route.ts` zu verwenden, verwandelte
 * „immer Freigabe" in „`auto_erlaubt` entscheidet" — eine
 * Invariante-7-Entscheidung mit eigenen Tests, keine Aufraeumung. Die drei
 * Stellen sagen in ihrem Kommentar ausdruecklich, dass sie nicht laden; sie
 * bleiben, wie sie sind, bis jemand die Entscheidung trifft.
 *
 * **Der vollstaendige Konfigurationsraum sind die acht `AKTIONEN`.** Eine
 * Aktion ohne Zeile ist `nicht_hinterlegt`, und das heisst nach Invariante 7
 * „Freigabe noetig" — nicht „egal". Der Bildschirm zeigt deshalb alle acht,
 * auch die fuenf ohne Zeile; eine leere Zelle sah wie eine offene Frage aus
 * und war eine geschlossene Tuer.
 */

/** Was das Gate fuer eine Aktion tut — abgeleitet, nicht gespeichert. */
export type Wirkung =
  /** Keine Zeile: fail-closed, jede Nachricht braucht eine Freigabe. */
  | 'nicht_hinterlegt'
  /** Zeile vorhanden, aber `ist_aktiv = false`: wie keine Zeile. */
  | 'abgeschaltet'
  /** Zeile aktiv, `auto_erlaubt = false`: Freigabe noetig. */
  | 'freigabe'
  /** Zeile aktiv und `auto_erlaubt` — aber im Code gesperrt (siehe unten). */
  | 'im_code_gesperrt'
  /** Zeile aktiv, `auto_erlaubt`, kein Limit: geht automatisch hinaus. */
  | 'automatisch'
  /** Wie `automatisch`, aber nur bis zum Betragslimit. */
  | 'automatisch_bis_limit';

/**
 * Die drei Aktionen, die `gate()` IM CODE sperrt — unabhaengig von jeder
 * Zeile in dieser Tabelle.
 *
 * Ein Angebot ist ein bindendes Vertragsangebot (§ 145 BGB), ein Nachtrag
 * eine Willenserklaerung mit Preisfolge (§ 2 Abs. 6 VOB/B), eine
 * Behinderungsanzeige eine anspruchswahrende Rechtserklaerung (§ 6 Abs. 1
 * VOB/B). Alle drei stehen als eigene Aktionen im Register, damit eine
 * Richtlinie „Mails duerfen automatisch raus" sie nicht mitmeint — und alle
 * drei haben zusaetzlich einen Zweig in `gate()`, weil eine Schwelle dazu
 * einlaedt, sie zu erhoehen, bis sie nichts mehr bedeutet.
 *
 * **Diese Liste ist eine ANZEIGE, keine zweite Entscheidung.** Gesperrt wird
 * in `policy.ts`; hier steht sie, damit der Bildschirm nicht „automatisch"
 * behauptet, wo das Gate abweist. `tests/kern/agent-richtlinie.test.ts` haelt
 * beide gegeneinander.
 */
export const IM_CODE_GESPERRT: readonly Aktion[] =
  ['angebot_senden', 'nachtrag_einreichen', 'behinderung_senden'];

/** Was die Aktion ist, in einem Satz — deutsch, fuer den Bildschirm. */
export const AKTION_TEXT: Readonly<Record<Aktion, string>> = {
  email_senden: 'E-Mail an einen Kontakt',
  angebot_senden: 'Angebot versenden',
  social_veroeffentlichen: 'Beitrag veröffentlichen',
  bewerbung_antworten: 'Antwort an eine Bewerbung',
  mahnung_senden: 'Mahnung versenden',
  rechnung_senden: 'Rechnung versenden',
  nachtrag_einreichen: 'Nachtrag einreichen (§ 2 Abs. 6 VOB/B)',
  behinderung_senden: 'Behinderungsanzeige (§ 6 Abs. 1 VOB/B)',
};

/** Warum die Aktion eine EIGENE ist und nicht unter `email_senden` fällt. */
export const AKTION_GRUND: Readonly<Partial<Record<Aktion, string>>> = {
  angebot_senden:
    'Ein Angebot ist ein bindendes Vertragsangebot nach § 145 BGB. Es geht nie '
    + 'automatisch hinaus — unabhängig von Betrag und Richtlinie.',
  nachtrag_einreichen:
    'Die Einreichung eines Nachtrags ist eine Willenserklärung gegenüber dem '
    + 'Auftraggeber mit unmittelbarer Preisfolge (§ 2 Abs. 6 VOB/B) — kein '
    + 'Anschreiben. Unter „E-Mail" wäre sie von einer Regel „Mails dürfen '
    + 'automatisch raus" mitgemeint.',
  behinderung_senden:
    'Die Behinderungsanzeige geht überwiegend NICHT per Mail hinaus, sondern per '
    + 'Einschreiben oder Bote — der Kanal ist Beweisrecht —, und sie ist eine '
    + 'anspruchswahrende Rechtserklärung nach § 6 Abs. 1 VOB/B.',
};

/**
 * Was die Wirkung in Worten heisst — deutsch, und immer der SATZ, nicht nur
 * ein Wort.
 *
 * DESIGN §9: die Farbe traegt die Bedeutung nie allein. Und hier traegt sie
 * sie besonders schlecht: „nicht hinterlegt" und „abgeschaltet" sehen beide
 * nach Untaetigkeit aus und bedeuten dasselbe Ergebnis — Freigabe noetig —,
 * was niemand errät, der nur eine graue Pille sieht.
 */
export const WIRKUNG_TEXT: Readonly<Record<Wirkung, string>> = {
  nicht_hinterlegt: 'nicht hinterlegt — Freigabe nötig',
  abgeschaltet: 'abgeschaltet — Freigabe nötig',
  freigabe: 'Freigabe nötig',
  im_code_gesperrt: 'nie automatisch — im Code gesperrt',
  automatisch: 'geht automatisch hinaus',
  automatisch_bis_limit: 'automatisch bis zum Limit',
};

export class RichtlinieFehler extends Error {
  constructor(
    readonly grund: 'unbekannte_aktion' | 'ungueltig' | 'im_code_gesperrt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'RichtlinieFehler';
  }
}

export interface RichtlinienZeile {
  readonly aktion: Aktion;
  readonly text: string;
  readonly grund: string | null;
  /** `null`: fuer diese Aktion gibt es keine Zeile. */
  readonly id: string | null;
  readonly autoErlaubt: boolean;
  readonly maxBetragCent: Cent | null;
  readonly istAktiv: boolean;
  readonly begruendung: string | null;
  readonly geaendertAm: string | null;
  readonly geaendertVon: string | null;
  readonly imCodeGesperrt: boolean;
  readonly wirkung: Wirkung;
}

interface Roh {
  readonly id: string;
  readonly aktion: string;
  readonly auto_erlaubt: boolean;
  readonly max_betrag_cent: string | null;
  readonly ist_aktiv: boolean;
  readonly begruendung: string | null;
  readonly geaendert_am: string | null;
  readonly geaendert_von: string | null;
}

/** Was das Gate aus einer Zeile (oder ihrem Fehlen) machen WIRD. */
export function wirkungVon(
  aktion: Aktion, zeile: Roh | undefined,
): Wirkung {
  if (zeile === undefined) return 'nicht_hinterlegt';
  if (!zeile.ist_aktiv) return 'abgeschaltet';
  if (!zeile.auto_erlaubt) return 'freigabe';
  if (IM_CODE_GESPERRT.includes(aktion)) return 'im_code_gesperrt';
  return zeile.max_betrag_cent === null ? 'automatisch' : 'automatisch_bis_limit';
}

/**
 * Alle acht Aktionen mit ihrer Zeile — oder ohne.
 *
 * **Die Reihenfolge ist die von `AKTIONEN`** und nicht die der Tabelle: der
 * Konfigurationsraum ist vollstaendig und stabil, damit dieselbe Zeile
 * morgen an derselben Stelle steht.
 */
export async function ladeRichtlinien(
  kontext: LeseKontext,
): Promise<readonly RichtlinienZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select r.id, r.aktion, r.auto_erlaubt, r.max_betrag_cent::text as max_betrag_cent,
            r.ist_aktiv, r.begruendung,
            to_char(r.geaendert_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as geaendert_am,
            b.name as geaendert_von
       from agent_richtlinie r
       left join benutzer b on b.id = r.geaendert_von
      where r.mandant_id = $1::uuid`,
    [kontext.aktiverMandantId]);
  const jeAktion = new Map(roh.map((r) => [r.aktion, r]));

  return AKTIONEN.map((aktion): RichtlinienZeile => {
    const z = jeAktion.get(aktion);
    return {
      aktion,
      text: AKTION_TEXT[aktion],
      grund: AKTION_GRUND[aktion] ?? null,
      id: z?.id ?? null,
      autoErlaubt: z?.auto_erlaubt ?? false,
      maxBetragCent: z?.max_betrag_cent === undefined || z.max_betrag_cent === null
        ? null : cent(BigInt(z.max_betrag_cent)),
      istAktiv: z?.ist_aktiv ?? false,
      begruendung: z?.begruendung ?? null,
      geaendertAm: z?.geaendert_am ?? null,
      geaendertVon: z?.geaendert_von ?? null,
      imCodeGesperrt: IM_CODE_GESPERRT.includes(aktion),
      wirkung: wirkungVon(aktion, z),
    };
  });
}

/**
 * Eine Richtlinie im Gate-Format — fuer einen Aufrufer, der `gate()` ruft.
 *
 * Getrennt von `ladeRichtlinien`, weil die Bildschirmform acht Zeilen mit
 * Text und Begruendung ist und das Gate genau eine ohne. Wer entscheidet,
 * bekommt das kleinere Stueck.
 */
export async function findeRichtlinie(
  kontext: LeseKontext, aktion: Aktion,
): Promise<Richtlinie | null> {
  const [z] = await kontext.abfrage<Roh>(
    `select r.id, r.aktion, r.auto_erlaubt, r.max_betrag_cent::text as max_betrag_cent,
            r.ist_aktiv, r.begruendung, null::text as geaendert_am,
            null::text as geaendert_von
       from agent_richtlinie r
      where r.mandant_id = $1::uuid and r.aktion = $2`,
    [kontext.aktiverMandantId, aktion]);
  if (z === undefined) return null;
  return {
    mandantId: kontext.aktiverMandantId ?? '',
    aktion,
    autoErlaubt: z.auto_erlaubt,
    maxBetragCent: z.max_betrag_cent === null ? null : BigInt(z.max_betrag_cent),
    ist_aktiv: z.ist_aktiv,
  };
}

export interface RichtlinieEingabe {
  readonly aktion: Aktion;
  readonly autoErlaubt: boolean;
  /** `null` = kein Limit. Ganze Cent (Invariante 1). */
  readonly maxBetragCent: Cent | null;
  readonly istAktiv: boolean;
  readonly begruendung: string | null;
}

/**
 * Setzt die Richtlinie einer Aktion — anlegen oder ueberschreiben.
 *
 * **Warum `on conflict` und keine datierte Fassung.** `mahnstufe` loest eine
 * Fassung ab und behaelt die alte, weil eine versendete Mahnung sich auf die
 * Stufe beruft, wie sie GALT — der geforderte Betrag muss herleitbar
 * bleiben. Eine Richtlinie traegt keinen Betrag in ein Dokument; sie
 * entscheidet nur, ob im Augenblick des Versands ein Mensch gefragt wird.
 * Was damals galt, steht deshalb im Protokoll (`0203` gibt der Tabelle
 * endlich ihren Audit-Trigger) und nicht in einer zweiten Zeile.
 *
 * **`angebot_senden` mit `auto_erlaubt` weist die Datenbank ab**
 * (`agent_richtlinie_kein_auto_angebot`, 0012). Die beiden anderen im Code
 * gesperrten Aktionen tragen diesen `CHECK` nicht, und das ist kein
 * Versehen: sie sind ueber `gate()` gesperrt, und eine gespeicherte `true`
 * waere dort wirkungslos — sie saehe aber auf dem Bildschirm wie eine
 * Erlaubnis aus. Deshalb weist DIESER Dienst sie ab, mit dem Satz, warum.
 */
export async function setzeRichtlinie(
  kontext: SchreibKontext, e: RichtlinieEingabe,
): Promise<void> {
  if (!AKTIONEN.includes(e.aktion)) {
    throw new RichtlinieFehler('unbekannte_aktion',
      `„${e.aktion}" ist keine Aktion des Ausgangs-Gates.`);
  }
  if (e.autoErlaubt && IM_CODE_GESPERRT.includes(e.aktion)) {
    throw new RichtlinieFehler('im_code_gesperrt',
      `${AKTION_TEXT[e.aktion]} geht nie automatisch hinaus — die Sperre steht im `
      + 'Code (server/agent/policy.ts) und nicht in dieser Tabelle. Eine hier '
      + 'gespeicherte Erlaubnis wäre wirkungslos und sähe auf dem Bildschirm wie '
      + 'eine aus.');
  }
  if (e.maxBetragCent !== null && e.maxBetragCent < 0n) {
    throw new RichtlinieFehler('ungueltig', 'Ein Betragslimit ist nie negativ.');
  }

  await kontext.schreibe(
    `insert into agent_richtlinie
       (mandant_id, aktion, auto_erlaubt, max_betrag_cent, ist_aktiv, begruendung,
        erstellt_von, geaendert_von)
     values ($1::uuid, $2, $3, $4::bigint, $5, $6, $7::uuid, $7::uuid)
     on conflict (mandant_id, aktion) do update
        set auto_erlaubt    = excluded.auto_erlaubt,
            max_betrag_cent = excluded.max_betrag_cent,
            ist_aktiv       = excluded.ist_aktiv,
            begruendung     = excluded.begruendung,
            geaendert_von   = excluded.geaendert_von`,
    [kontext.aktiverMandantId, e.aktion, e.autoErlaubt,
      e.maxBetragCent === null ? null : String(e.maxBetragCent),
      e.istAktiv, e.begruendung, kontext.benutzerId]);

  await kontext.schreibe(
    `select app.protokolliere('agent.richtlinie_gesetzt', 'agent_richtlinie', $1,
                              null, $2::jsonb, app.aktiver_mandant())`,
    [e.aktion, {
      aktion: e.aktion, autoErlaubt: e.autoErlaubt, istAktiv: e.istAktiv,
      maxBetragCent: e.maxBetragCent === null ? null : String(e.maxBetragCent),
    }]);
}
