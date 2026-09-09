import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { bereicheLesen, einstellungLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import { sitemapEintraege } from '@/server/services/inhalt/sitemap';
import { llmsTxt, type LlmsSeite } from '@/server/services/inhalt/llms';
import { OEFFENTLICHE_ROUTEN } from '@/server/services/inhalt/routen';

/**
 * `/llms.txt` (PUB-12) — aus derselben NAP-Quelle wie Impressum und JSON-LD.
 *
 * Bewusst offen (siehe `route-manifest.ts`): eine Datei fuer Sprachmodelle
 * hinter einer Anmeldung waere sinnlos. Sie enthaelt nur, was ohnehin
 * oeffentlich steht.
 */
export const dynamic = 'force-dynamic';

const TITEL = new Map(OEFFENTLICHE_ROUTEN.map((r) => [r.pfad, r.titel]));

export async function GET(): Promise<Response> {
  const basis = await basisAusAnfrage();

  const { bereiche, seiten, name } = await oeffentlichLesen(async (kontext) => ({
    bereiche: await bereicheLesen(kontext),
    seiten: await sitemapEintraege({ unsafe: (s, w) => kontext.abfrage(s, w) }),
    name: await einstellungLesen(kontext, 'website.gruppenname'),
  }));

  const erste = bereiche[0];
  if (erste === undefined) {
    return new Response('', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const alsQuelle = (b: typeof erste) => ({
    firma: b.firma, strasse: b.strasse, plz: b.plz, ort: b.ort, land: b.land,
    telefon: b.telefon, email: b.email,
  });

  const seitenListe: readonly LlmsSeite[] = seiten
    .filter((s) => s.pfad !== '/')
    .map((s) => ({ pfad: s.pfad, titel: TITEL.get(s.pfad) ?? s.pfad }));

  const text = llmsTxt(
    typeof name === 'string' && name !== '' ? name : erste.firma,
    // Kein Gruppen-NAP, solange O-206 offen ist — siehe `llmsTxt`.
    null,
    bereiche.map((b) => ({
      slug: b.slug, mandant: alsQuelle(b), kurzbeschreibung: b.kurzbeschreibung,
    })),
    seitenListe,
    basis,
  );

  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
