import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { KeineEigeneSchichtFehler, mandantDerZuordnung }
  from '@/server/services/mitarbeiter/stempeluhr';
import { sageSchichtAb, sageSchichtZu }
  from '@/server/services/dienstplan/einteilung';

/**
 * `POST /api/mein/schicht` — die Kraft sagt ihre eigene Einteilung zu oder ab
 * (V-049, V-050, D-622, EMP-02, Migration 0374).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Kein Recht wird geprueft, und das ist die Entscheidung — nicht ihr Fehlen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `dienstplan.schreiben` ist das Recht, den Plan zu MACHEN. Wer es einer
 * Reinigungskraft gaebe, gaebe ihr den Plan. Geprueft wird stattdessen das,
 * worauf es hier ankommt — und zwar in der DATENBANK, nicht hier:
 * `app.schicht_zusagen` und `app.schicht_absagen` (0374) bestehen darauf,
 * dass die Anfrage aus dem ARBEITERportal kommt (K-04) und dass die Einteilung
 * DIESER Person gehoert. Beides kann diese Route nicht umgehen, auch wenn sie
 * es wollte (Invariante 3).
 *
 * **Der Mandant kommt aus der EINTEILUNG, nie aus dem Formular** (K-02) —
 * dieselbe Begruendung und derselbe Helfer wie bei der Stempeluhr. Ein Mensch
 * mit zwei Beschaeftigungen sagt bei EINER Gesellschaft zu (D-09); welche,
 * sagt die Zeile.
 *
 * **Antwort ist eine Weiterleitung, keine JSON-Nutzlast.** Die Knoepfe stehen
 * in einem gewoehnlichen `<form method="post">` und funktionieren damit ohne
 * JavaScript — im Treppenhaus, auf einem alten Telefon, bei schlechtem Netz.
 *
 * **Kein Ausgang ist eine Ausnahme.** Acht Ergebnisse wandern als `?antwort=`
 * zurueck auf die Schichtseite, die sie in vier Sprachen beschriftet. Ein
 * `500` fuer „Sie haben schon zugesagt" waere eine Fehlermeldung fuer einen
 * normalen Vorgang.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const zuordnungId = String(daten.get('zuordnung') ?? '');
  const aktion = String(daten.get('aktion') ?? '');
  const grund = String(daten.get('grund') ?? '');
  if (!UUID.test(zuordnungId)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (aktion !== 'zusagen' && aktion !== 'absagen') {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }

  let antwort: string;
  try {
    antwort = await (db().begin(async (tx: postgres.TransactionSql) => {
      const mandantId = await withPersonScope(tx, sitzung, async (kontext) =>
        mandantDerZuordnung(kontext, zuordnungId));

      const imMandanten: Sitzung = {
        ...sitzung, ansicht: 'mandant', aktiverMandantId: mandantId, portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) => {
        const r = aktion === 'zusagen'
          ? await sageSchichtZu(kontext, zuordnungId)
          : await sageSchichtAb(kontext, zuordnungId, grund);
        return r.art;
      });
    }) as Promise<string>);
  } catch (fehler) {
    if (fehler instanceof KeineEigeneSchichtFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(
    `/portal/mein/schichten/${zuordnungId}?antwort=${antwort}`, '/portal', anfrage), 303);
}
