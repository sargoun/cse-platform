/**
 * Der Diff in `freigabe.diff` — als JSON hin und zurueck (APR-02, D-472).
 *
 * `Diff` traegt Cent und Milli-Mengen als `bigint`; `jsonb` kennt keine.
 * Hier steht die EINE Abbildung: Betraege und Mengen werden ganze
 * JSON-Zahlen (sicher bis 2^53, das sind neunzig Billionen Euro), alles
 * andere bleibt, wie es ist. Zurueck wird GEPRUEFT, nicht gecastet — ein
 * Diff, der nicht die Form hat, ist ein Programmfehler beim Schreiber, und
 * der soll hier laut werden, nicht als NaN in einer Tabelle.
 *
 * Warum Zahlen und nicht Zeichenketten: `kanonisiere()` schreibt `bigint`
 * und ganze `number` gleich (`String(n)`). Der Vorschlag hasht also ueber
 * dieselben Bytes wie die Entscheidung, obwohl dazwischen ein
 * jsonb-Umweg liegt (`payload_hash` in `freigabe`, `nutzlast_hash` im
 * Schnappschuss). Zeichenketten haetten in Anfuehrungszeichen gestanden —
 * andere Bytes, andere Kette.
 */
import { cent, type Cent } from '../finanz/geld.js';
import { milliMenge, type MilliMenge } from '../finanz/menge.js';
import type { KanonischerWert } from '../finanz/kanonisch.js';
import {
  DiffFehler, type Diff, type FeldAenderung, type GeaendertesFeld, type Quelle,
  type QuellenArt, type UstGruppenDelta, type VergleichsPosition,
} from './diff.js';

const FELDER: readonly GeaendertesFeld[] = [
  'menge', 'einzelpreis', 'betrag', 'bezeichnung', 'herkunft', 'meta',
];
const QUELLEN: readonly QuellenArt[] = ['zeiteintrag', 'aufmass', 'vertrag', 'material'];

const GRENZE = BigInt(Number.MAX_SAFE_INTEGER);

function zahl(wert: bigint, name: string): number {
  if (wert > GRENZE || wert < -GRENZE) {
    throw new DiffFehler(`${name} passt nicht in eine JSON-Zahl: ${wert.toString()}`);
  }
  return Number(wert);
}

/** Ein JSON-Wert ohne `undefined`, ohne Funktionen, ohne Kommazahlen. */
export function alsKanonischerWert(wert: unknown, pfad = '$'): KanonischerWert {
  if (wert === null || typeof wert === 'boolean' || typeof wert === 'string'
      || typeof wert === 'bigint') {
    return wert;
  }
  if (typeof wert === 'number') {
    if (!Number.isSafeInteger(wert)) {
      throw new DiffFehler(`${pfad} ist keine ganze Zahl: ${String(wert)}`);
    }
    return wert;
  }
  if (Array.isArray(wert)) {
    return wert.map((w, i) => alsKanonischerWert(w, `${pfad}[${String(i)}]`));
  }
  if (typeof wert === 'object') {
    const aus: Record<string, KanonischerWert> = {};
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
      if (v === undefined) continue;
      aus[k] = alsKanonischerWert(v, `${pfad}.${k}`);
    }
    return aus;
  }
  throw new DiffFehler(`${pfad} ist nicht kanonisierbar (${typeof wert})`);
}

/**
 * Der Wert, wie er dem Treiber fuer eine `::jsonb`-Spalte uebergeben wird:
 * ein einfaches Objekt, `bigint` als ganze Zahl.
 *
 * **Ein OBJEKT, keine Zeichenkette — und das ist die Falle.** `postgres`
 * serialisiert jeden Parameter nach dem Typ, den der Server nennt; fuer
 * `jsonb` heisst das `JSON.stringify`. Eine bereits serialisierte
 * Zeichenkette wird damit ein zweites Mal kodiert und landet als JSON-STRING
 * in der Spalte: `jsonb_typeof` sagt `string`, `diffAusJson` findet kein
 * Objekt, und der Hash der Entscheidung laeuft ueber die Bytes eines
 * Zeichenkettenliterals statt ueber die Nutzlast. Genau so ist es dem Seed
 * und dem Entscheidungsdienst passiert; `tests/isolation/freigabe-bildschirm
 * .test.ts` §3 rechnet seither die gespeicherten Bytes nach.
 */
export function fuerJsonb(wert: KanonischerWert): unknown {
  return JSON.parse(JSON.stringify(wert, (_k, v: unknown) =>
    (typeof v === 'bigint' ? zahl(v, 'Wert') : v))) as unknown;
}

/* ── hin ──────────────────────────────────────────────────────────────── */

function positionZuJson(p: VergleichsPosition): KanonischerWert {
  return {
    objektId: p.objektId,
    leistungskatalogId: p.leistungskatalogId,
    bezeichnung: p.bezeichnung,
    menge: zahl(p.menge, 'menge'),
    einheit: p.einheit,
    einzelpreisCent: zahl(p.einzelpreisCent, 'einzelpreisCent'),
    betragCent: zahl(p.betragCent, 'betragCent'),
    herkunft: p.herkunft.map((q) => ({ art: q.art, id: q.id })),
    meta: { ...p.meta },
  };
}

export function diffZuJson(diff: Diff): KanonischerWert {
  return {
    unveraendert: [...diff.unveraendert],
    hinzugefuegt: diff.hinzugefuegt.map(positionZuJson),
    entfallen: diff.entfallen.map(positionZuJson),
    geaendert: diff.geaendert.map((a) => ({
      schluessel: a.schluessel,
      bezeichnung: a.bezeichnung,
      feld: a.feld,
      alt: a.alt,
      neu: a.neu,
      deltaCent: a.deltaCent === null ? null : zahl(a.deltaCent, 'deltaCent'),
    })),
    deltaNettoCent: zahl(diff.deltaNettoCent, 'deltaNettoCent'),
    deltaBruttoCent: zahl(diff.deltaBruttoCent, 'deltaBruttoCent'),
    deltaUstGruppen: diff.deltaUstGruppen.map((g) => ({
      steuersatzGruppeId: g.steuersatzGruppeId,
      deltaNettoCent: zahl(g.deltaNettoCent, 'deltaNettoCent'),
      deltaUstCent: zahl(g.deltaUstCent, 'deltaUstCent'),
    })),
  };
}

/* ── zurueck ──────────────────────────────────────────────────────────── */

type Objekt = Record<string, unknown>;

function objekt(wert: unknown, pfad: string): Objekt {
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) {
    throw new DiffFehler(`${pfad} ist kein Objekt`);
  }
  return wert as Objekt;
}

function liste(wert: unknown, pfad: string): readonly unknown[] {
  if (!Array.isArray(wert)) throw new DiffFehler(`${pfad} ist keine Liste`);
  return wert;
}

function text(wert: unknown, pfad: string): string {
  if (typeof wert !== 'string') throw new DiffFehler(`${pfad} ist kein Text`);
  return wert;
}

function textOderNull(wert: unknown, pfad: string): string | null {
  if (wert === null || wert === undefined) return null;
  return text(wert, pfad);
}

function ganz(wert: unknown, pfad: string): bigint {
  if (typeof wert === 'number' && Number.isSafeInteger(wert)) return BigInt(wert);
  if (typeof wert === 'string' && /^-?\d{1,18}$/u.test(wert)) return BigInt(wert);
  throw new DiffFehler(`${pfad} ist keine ganze Zahl: ${JSON.stringify(wert)}`);
}

function centAus(wert: unknown, pfad: string): Cent {
  return cent(ganz(wert, pfad));
}

function positionAusJson(wert: unknown, pfad: string): VergleichsPosition {
  const o = objekt(wert, pfad);
  const herkunft: Quelle[] = liste(o['herkunft'] ?? [], `${pfad}.herkunft`).map((q, i) => {
    const qo = objekt(q, `${pfad}.herkunft[${String(i)}]`);
    const art = text(qo['art'], `${pfad}.herkunft[${String(i)}].art`);
    if (!QUELLEN.includes(art as QuellenArt)) {
      throw new DiffFehler(`${pfad}.herkunft[${String(i)}].art unbekannt: ${art}`);
    }
    return { art: art as QuellenArt, id: text(qo['id'], `${pfad}.herkunft[${String(i)}].id`) };
  });
  const metaRoh = objekt(o['meta'] ?? {}, `${pfad}.meta`);
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(metaRoh)) meta[k] = text(v, `${pfad}.meta.${k}`);
  return {
    objektId: textOderNull(o['objektId'], `${pfad}.objektId`),
    leistungskatalogId: textOderNull(o['leistungskatalogId'], `${pfad}.leistungskatalogId`),
    bezeichnung: text(o['bezeichnung'], `${pfad}.bezeichnung`),
    menge: milliMenge(ganz(o['menge'], `${pfad}.menge`)) as MilliMenge,
    einheit: text(o['einheit'], `${pfad}.einheit`),
    einzelpreisCent: centAus(o['einzelpreisCent'], `${pfad}.einzelpreisCent`),
    betragCent: centAus(o['betragCent'], `${pfad}.betragCent`),
    herkunft,
    meta,
  };
}

function aenderungAusJson(wert: unknown, pfad: string): FeldAenderung {
  const o = objekt(wert, pfad);
  const feld = text(o['feld'], `${pfad}.feld`);
  if (!FELDER.includes(feld as GeaendertesFeld)) {
    throw new DiffFehler(`${pfad}.feld unbekannt: ${feld}`);
  }
  return {
    schluessel: text(o['schluessel'], `${pfad}.schluessel`),
    bezeichnung: text(o['bezeichnung'], `${pfad}.bezeichnung`),
    feld: feld as GeaendertesFeld,
    alt: text(o['alt'], `${pfad}.alt`),
    neu: text(o['neu'], `${pfad}.neu`),
    deltaCent: o['deltaCent'] === null || o['deltaCent'] === undefined
      ? null : centAus(o['deltaCent'], `${pfad}.deltaCent`),
  };
}

/**
 * `null` fuer „kein Diff" — die Vorgabe `'[]'` der Spalte und ein leeres
 * Objekt bedeuten dasselbe: es gab nichts zu vergleichen (Erstmalig).
 */
export function diffAusJson(wert: unknown): Diff | null {
  if (wert === null || wert === undefined) return null;
  if (Array.isArray(wert)) {
    if (wert.length === 0) return null;
    throw new DiffFehler('diff ist eine nicht-leere Liste — erwartet wird ein Objekt');
  }
  const o = objekt(wert, 'diff');
  if (Object.keys(o).length === 0) return null;
  const gruppen: UstGruppenDelta[] = liste(o['deltaUstGruppen'] ?? [], 'diff.deltaUstGruppen')
    .map((g, i) => {
      const go = objekt(g, `diff.deltaUstGruppen[${String(i)}]`);
      return {
        steuersatzGruppeId: text(go['steuersatzGruppeId'],
          `diff.deltaUstGruppen[${String(i)}].steuersatzGruppeId`),
        deltaNettoCent: centAus(go['deltaNettoCent'],
          `diff.deltaUstGruppen[${String(i)}].deltaNettoCent`),
        deltaUstCent: centAus(go['deltaUstCent'],
          `diff.deltaUstGruppen[${String(i)}].deltaUstCent`),
      };
    });
  return {
    unveraendert: liste(o['unveraendert'] ?? [], 'diff.unveraendert')
      .map((u, i) => text(u, `diff.unveraendert[${String(i)}]`)),
    hinzugefuegt: liste(o['hinzugefuegt'] ?? [], 'diff.hinzugefuegt')
      .map((p, i) => positionAusJson(p, `diff.hinzugefuegt[${String(i)}]`)),
    entfallen: liste(o['entfallen'] ?? [], 'diff.entfallen')
      .map((p, i) => positionAusJson(p, `diff.entfallen[${String(i)}]`)),
    geaendert: liste(o['geaendert'] ?? [], 'diff.geaendert')
      .map((a, i) => aenderungAusJson(a, `diff.geaendert[${String(i)}]`)),
    deltaNettoCent: centAus(o['deltaNettoCent'] ?? 0, 'diff.deltaNettoCent'),
    deltaBruttoCent: centAus(o['deltaBruttoCent'] ?? 0, 'diff.deltaBruttoCent'),
    deltaUstGruppen: gruppen,
  };
}
