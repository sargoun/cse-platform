import type { NextRequest, NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID, type Rumpf } from '../../uebergang';
import {
  AnforderungFehler, archiviereAnforderung, istAnforderungBereich, istAnforderungGeltung,
  legeAnforderungAn, type AnforderungHerkunft,
} from '@/server/services/security/anforderung';

/**
 * `POST /api/sicherheit/anforderungen` — einen verlangten Nachweis eintragen
 * oder archivieren (SEC-01, SEC-04, SEC-08, V-179).
 *
 * **Zwei Aktionen über EINE Adresse** (`aktion = anlegen | archivieren`):
 * dieselbe Sitzung, derselbe Ursprungscheck, dasselbe Recht — und beide
 * ändern dieselbe Tabelle. Zwei Adressen wären zwei Stellen, an denen
 * `security.schreiben` fehlen kann.
 *
 * **Das Gerüst ist `fuehreUebergangAus`**: Ursprung, genau ein aktiver
 * Mandant (Invariante 10), `authorize` in der gebundenen Transaktion,
 * `autorisierungsAntwort` für einen Auth-Wurf — und für ein Formular eine
 * SEITE mit dem Grund (`?fehler=`), nie eine weisse Seite mit JSON (D-599).
 *
 * **Woran die Anforderung hängt, sagt die Seite, von der sie kommt**
 * (`herkunft_art`, `herkunft_id`) — Posten oder Veranstaltung. Eine
 * Objektkennung nimmt diese Route nicht entgegen: der Dienst löst das Objekt
 * aus dem Posten bzw. der Veranstaltung auf (K-02). Der Rückweg wird aus
 * derselben, als UUID geprüften Kennung gebaut und nie aus einem Feld der
 * Anfrage übernommen.
 */
export const dynamic = 'force-dynamic';

function herkunftAus(r: Rumpf): AnforderungHerkunft {
  const art = r.felder['herkunft_art'];
  const id = r.felder['herkunft_id'] ?? '';
  if ((art !== 'posten' && art !== 'veranstaltung') || !UUID.test(id)) {
    throw new AnforderungFehler('nicht_gefunden', 'Ohne Posten oder Veranstaltung kein Bezug.');
  }
  return { art, id };
}

function feld(r: Rumpf, name: string): string | null {
  const wert = (r.felder[name] ?? '').trim();
  return wert === '' ? null : wert;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<{ herkunft: AnforderungHerkunft; aktion: string }>(anfrage, {
    recht: 'security.schreiben',
    handle: async (kontext, r) => {
      const herkunft = herkunftAus(r);
      if (r.felder['aktion'] === 'archivieren') {
        const id = r.felder['id'] ?? '';
        if (!UUID.test(id)) {
          throw new AnforderungFehler('nicht_gefunden', 'Diese Anforderung gibt es hier nicht.');
        }
        await archiviereAnforderung(kontext, id);
        return { herkunft, aktion: 'archiviert' };
      }

      const bereich = r.felder['bereich'];
      const geltung = r.felder['geltung'] ?? 'jeder';
      const qualifikation = feld(r, 'qualifikation');
      if (!istAnforderungBereich(bereich) || !istAnforderungGeltung(geltung)
        || qualifikation === null || !UUID.test(qualifikation)) {
        throw new AnforderungFehler('unvollstaendig', 'Qualifikation, Wirkung und Bereich fehlen.');
      }
      const anzahl = Number(feld(r, 'mindestanzahl') ?? '1');
      await legeAnforderungAn(kontext, {
        herkunft,
        bereich,
        qualifikationId: qualifikation,
        zwingend: r.felder['zwingend'] !== 'nein',
        geltung,
        mindestanzahl: Number.isFinite(anzahl) ? anzahl : Number.NaN,
        bewacherregisterPflicht: r.felder['register'] === 'ja',
        gueltigAb: feld(r, 'gueltig_ab'),
        rechtsgrundlage: feld(r, 'rechtsgrundlage'),
        bestaetigt: r.felder['bestaetigt'] === 'ja',
      });
      return { herkunft, aktion: 'angelegt' };
    },
    ziel: (slug, e) =>
      `/portal/${slug}/security/${e.herkunft.art === 'posten' ? 'posten' : 'veranstaltungen'}`
      + `/${e.herkunft.id}?anforderung=${e.aktion}`,
    grundVon: (fehler) => grundAus(fehler, AnforderungFehler),
  });
}
