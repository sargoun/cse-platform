import type { NextRequest, NextResponse } from 'next/server';
import { stelleEin } from '@/server/services/personal/einstellung';
import { fuehrePersonalAus } from '../gemeinsam';

/**
 * `POST /api/personal/anstellungen` — einstellen (D-09, EMP-14, §5.12).
 *
 * **Eine Route und zwei Wege durch sie hindurch**, weil es EIN Vorgang ist:
 * die Beschäftigung entsteht, und der Mensch davor entweder auch oder eben
 * nicht. Zwei Routen (`…/personen` und `…/anstellungen`) wären zwei
 * Transaktionen — und dazwischen läge eine `person`-Zeile ohne Beschäftigung,
 * die von dieser Gesellschaft aus niemand mehr sieht (`t_person_lesen`, D-09)
 * und deshalb niemand mehr aufräumt.
 *
 * Welcher Weg, sagt `modus`. Der Dienst prüft beide Formen; diese Datei liest
 * nur Felder und reicht sie weiter (CLAUDE.md: autorisieren → Dienst → zurück).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  /* Das Ziel trägt die Kennung der neuen Zeile — sie entsteht erst im Dienst,
     und `ziel` läuft nach `handle`. */
  let neueId = '';
  return fuehrePersonalAus(anfrage, {
    recht: 'personal.schreiben',
    handle: async (kontext, rumpf) => {
      const feld = (name: string): string => rumpf.felder[name] ?? '';
      const neu = feld('modus') === 'neu';
      const ergebnis = await stelleEin(kontext, {
        mensch: neu
          ? {
            art: 'neu',
            vorname: feld('vorname'),
            nachname: feld('nachname'),
            telefon: feld('telefon') === '' ? null : feld('telefon'),
            sprache: feld('sprache') === '' ? 'de' : feld('sprache'),
          }
          : { art: 'bestehend', personId: feld('person') },
        personalnummer: feld('personalnummer'),
        eintritt: feld('eintritt'),
      });
      neueId = ergebnis.anstellungId;
    },
    ziel: (slug) => `/portal/${slug}/personal/anstellungen/${neueId}?eingestellt=1`,
  });
}
