/**
 * **Ein Grund aus der Adresse wird ein Satz — ein unbekannter ein allgemeiner,
 * nie er selbst** (V-250, D-741).
 *
 * Sechzehn Seiten zeigten einen Grund, den sie nicht kannten, so, wie er in der
 * Adresse stand: `eigenerEintrag(t.fehler, fehler) ?? fehler` (KI-Budget,
 * Lieferant, Raum, Zugang, Urlaubskonten, Sprachmodelle), `FEHLER[roh] ?? roh`
 * (Kennwortwechsel), `` `Der Anspruch wurde nicht übernommen: ${fehler}` ``,
 * „Der Modellaufruf endete mit „RATE_LIMITED"", und die Zahlungsseite zeigte
 * nach jeder erfassten Zahlung das Wort `erfasst`. Jetzt schlägt jede Seite
 * einen Grund nach und fällt sonst auf einen eigenen Satz zurück.
 *
 * **Hart, ohne Bestand.** Kein Rückfall auf die Adresse, nirgends. Was eine
 * Seite als SOLCHES zeigt — ein Suchwort, eine vorbelegte Eingabe, eine
 * Anzahl, die weitergereichte Meldung einer Route (`?meldung=`, D-599) —, ist
 * kein Rückfall und steht nicht unter dieser Wache.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rohAusDerAdresse, type AdressBefund } from './hilfen/adressparameter.js';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('Gründe aus der Adresse', () => {
  const dateien = [...baum(join(WURZEL, 'src/app')), ...baum(join(WURZEL, 'src/components'))];
  const heute: readonly AdressBefund[] = rohAusDerAdresse(
    dateien.map((d) => [d, readFileSync(d, 'utf8')] as const),
    (d) => (existsSync(d) ? readFileSync(d, 'utf8') : null), WURZEL);
  const zeile = (b: AdressBefund): string =>
    `${relative(WURZEL, b.datei)}:${String(b.zeile)} ?${b.parameter} ${b.ausdruck}`;

  it('die Prüfung liest überhaupt Adressen', () => {
    expect(dateien.length).toBeGreaterThan(500);
    // Suchwörter, vorbelegte Eingaben, Anzahlen: die Wache sieht die Adresse.
    expect(heute.filter((b) => b.art === 'direkt').length).toBeGreaterThan(20);
  });

  it('kein Grund aus der Adresse steht roh als Rückfall auf dem Schirm — nirgends', () => {
    const rueckfall = heute.filter((b) => b.art === 'rueckfall').map(zeile);
    expect(rueckfall, 'einen allgemeinen Satz der Seite statt des Grunds zeigen').toEqual([]);
  });

  it('die Gegenprobe: jede Form des Rückfalls wird gefunden, ein Satz nicht', () => {
    const SEITE = '/x/src/app/a/page.tsx';
    const kopf = 'export default async function S({ searchParams }: { searchParams: Promise<Record<string, string>> }) {\n'
      + '  const suche = await searchParams;\n';
    const pruefe = (rumpf: string): readonly string[] =>
      rohAusDerAdresse([[SEITE, `${kopf}${rumpf}\n}`]], () => null, '/x').map((b) => `${b.art}:${b.parameter}`);

    // Der Rückfall, wie er auf den sechzehn Seiten stand.
    expect(pruefe("  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;\n"
      + '  return <p>{eigenerEintrag(T, fehler) ?? fehler}</p>;')).toEqual(['rueckfall:fehler']);
    expect(pruefe("  const roh = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;\n"
      + '  return <p>{FEHLER[roh] ?? roh}</p>;')).toEqual(['rueckfall:fehler']);
    expect(pruefe("  const f = suche['fehler'];\n"
      + '  return <p>{eigenerEintrag(T, f) ?? `Nicht gespeichert: ${f}`}</p>;')).toEqual(['rueckfall:fehler']);
    expect(pruefe("  const f = suche['fehler'];\n"
      + "  return <p>{f === 'zu_kurz' ? 'Zu kurz.' : `Nicht übernommen: ${f}`}</p>;"))
      .toEqual(['rueckfall:fehler']);
    // Als eigener Ast (Turnus): die Datei kennt Gründe für `fehler` und zeigt einen roh.
    expect(pruefe("  const f = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;\n"
      + '  const anker = f === null ? undefined : eigenerEintrag(T, f);\n'
      + '  return <p>{anker !== undefined ? <>{anker}</> : <>{f}</>}</p>;')).toEqual(['rueckfall:fehler']);
    // Über einen Helfer derselben Datei, über das Muster, über `?? meldung`.
    expect(pruefe("  const einWert = (name: string) => typeof suche[name] === 'string' ? suche[name] : null;\n"
      + "  const grund = einWert('grund');\n"
      + '  return <p>{eigenerEintrag(T, grund) ?? grund}</p>;')).toEqual(['rueckfall:grund']);
    expect(pruefe("  const { fehler, meldung } = suche;\n"
      + '  return <p>{eigenerEintrag(T, fehler) ?? meldung ?? T.sonst}</p>;')).toEqual(['rueckfall:meldung']);
    // Über eine Funktion einer anderen Datei, die auf ihr Argument zurückfällt.
    const mitImport = new Map<string, string>([
      [SEITE, `import { satz } from './satz';\n${kopf}  return <p>{satz(suche['grund'])}</p>;\n}`],
      ['/x/src/app/a/satz.ts', 'export function satz(g: string) { return T[g] ?? g; }'],
    ]);
    expect(rohAusDerAdresse([[SEITE, mitImport.get(SEITE) ?? '']], (d) => mitImport.get(d) ?? null, '/x')
      .map((b) => `${b.art}:${b.parameter}`)).toEqual(['rueckfall:grund']);
    // Ein Baustein, dem die Seite ihre Adresse als `suche` gibt.
    const baustein = '/x/src/components/B.tsx';
    const b = "export function B({ suche }: { suche: Record<string, string> }) {\n"
      + "  return <p>{GRUND[suche['grund']] ?? suche['grund']}</p>;\n}";
    expect(rohAusDerAdresse([[baustein, b]], () => null, '/x').map((x) => `${x.art}:${x.parameter}`))
      .toEqual(['rueckfall:grund']);

    // Ein Satz der Seite, eine Meldung als solche, ein geprüfter Wert: kein Rückfall.
    expect(pruefe("  const f = suche['fehler'];\n"
      + "  return <p>{eigenerEintrag(T, f) ?? 'Nicht gespeichert.'}</p>;")).toEqual([]);
    expect(pruefe("  return <p>{suche['meldung'] ?? suche['erfolg']}</p>;"))
      .toEqual(['direkt:meldung', 'direkt:erfolg']);
    expect(pruefe("  const q = (suche['q'] ?? '').trim();\n"
      + "  return <p>{q === '' ? null : `Treffer für ${q}`}</p>;")).toEqual(['direkt:q']);
    expect(pruefe("  const roh = suche['monat'] ?? '';\n"
      + "  const m = /^\\d{4}-\\d{2}$/u.test(roh) ? roh : '2026-01';\n"
      + '  return <p>{MONAT[m] ?? m}</p>;')).toEqual([]);
    expect(pruefe("  const r = suche['reiter'] ?? null;\n"
      + "  const aktiv = r !== null && REITER.includes(r) ? r : 'uebersicht';\n"
      + '  return <p>{T[aktiv] ?? aktiv}</p>;')).toEqual([]);
    // Eine Anzahl, mit '0' verglichen, ist kein Grund.
    expect(pruefe("  const n = suche['gesetzt'];\n"
      + "  return <p>{n === '0' ? 'Nichts geändert.' : `${n} Zellen`}</p>;")).toEqual(['direkt:gesetzt']);
  });
});
