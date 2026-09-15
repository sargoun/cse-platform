import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { rechtepruefer } from '@/server/auth/zugang';
import { db } from '@/server/db/pool';
import { type SchreibKontext, withTenant } from '@/server/kontext/index';
import { SocialFehler } from '@/server/services/social/dienst';

/**
 * Das Gerüst der vier schreibenden Social-Routen.
 *
 * **Warum ein Gerüst und keine vier Kopien.** Ursprungsprüfung, Sitzung,
 * genau ein aktiver Mandant, `authorize`, Transaktion, Fehlerbild — das ist
 * bei allen vieren dasselbe, und vier Kopien sind vier Stellen, an denen
 * eines davon beim nächsten Umbau fehlt. Was sich unterscheidet, ist die
 * Handlung; die steht im Aufrufer.
 *
 * **`SocialFehler` ist 409, nicht 500.** Ein Beitrag, der im falschen Zustand
 * ist, ist kein Programmfehler — ein Mensch soll den Satz lesen und wissen,
 * was fehlt.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface Rumpf {
  readonly felder: Readonly<Record<string, string>>;
  readonly alle: (name: string) => readonly string[];
  readonly json: boolean;
}

export async function liesRumpf(anfrage: NextRequest): Promise<Rumpf> {
  const typ = anfrage.headers.get('content-type') ?? '';
  if (typ.includes('application/json')) {
    const roh = (await anfrage.json().catch(() => ({}))) as Record<string, unknown>;
    const felder: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) {
      if (typeof v === 'string') felder[k] = v;
    }
    return {
      felder,
      alle: (name) => {
        const w = roh[name];
        return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : [];
      },
      json: true,
    };
  }
  const daten = await anfrage.formData();
  const felder: Record<string, string> = {};
  for (const [k, v] of daten.entries()) {
    if (typeof v === 'string' && !(k in felder)) felder[k] = v;
  }
  return {
    felder,
    alle: (name) => daten.getAll(name).filter((x): x is string => typeof x === 'string'),
    json: false,
  };
}

export interface Lauf {
  readonly recht: string;
  readonly handle: (kontext: SchreibKontext, rumpf: Rumpf) => Promise<string>;
  /** Wohin ein Formular danach zeigt — `slug` ist der Bereich. */
  readonly ziel: (slug: string, ergebnis: string) => string;
}

export async function fuehreSocialAus(
  anfrage: NextRequest, lauf: Lauf,
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const rumpf = await liesRumpf(anfrage);

  try {
    const { ergebnis, slug } = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: lauf.recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const e = await lauf.handle(kontext, rumpf);
        return { ergebnis: e, slug: m?.slug ?? '' };
      }))) as { ergebnis: string; slug: string };

    if (rumpf.json) return NextResponse.json({ ergebnis }, { status: 200 });
    return NextResponse.redirect(
      new URL(lauf.ziel(slug, ergebnis), anfrage.nextUrl.origin), 303);
  } catch (fehler: unknown) {
    if (fehler instanceof SocialFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'unbekannt' ? 404 : 409 });
    }
    throw fehler;
  }
}
