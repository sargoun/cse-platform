import { NextResponse, type NextRequest } from 'next/server';
import { schreibeStammdaten } from '@/server/services/personal/stammdaten';
import { fuehrePersonalAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/personal/personen/[id]/stammdaten` — Geburtsdatum, Geburtsort,
 * Staatsangehoerigkeit (SEC-03, LEG-09, 01-KERN §6.13/§11).
 *
 * **Geschrieben mit `personal.schreiben`, gelesen mit
 * `personal.stammdaten_lesen`.** Das ist kein Versehen: `GRANT UPDATE` und
 * `GRANT SELECT` sind getrennte Rechte, und eine Spalte darf schreibbar und
 * unlesbar sein. Das Personalformular nimmt ein Geburtsdatum auf, ohne es
 * zurueckzulesen; wer das Ergebnis sehen will, geht ueber
 * `app.person_stammdaten_lesen` und hinterlaesst dabei seine Auditzeile.
 *
 * Die Policy `t_person_personalpflege` (0190) verlangt zusaetzlich eine
 * Beschaeftigung in der AKTIVEN Gesellschaft: `person` traegt keinen Mandanten
 * (D-09), und ohne diesen Zweig pflegte jede Gesellschaft die Stammdaten jedes
 * Menschen, den sie irgendwo sieht.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await kontextParam.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  return fuehrePersonalAus(anfrage, {
    recht: 'personal.schreiben',
    handle: async (kontext, rumpf) => {
      const text = (name: string): string | null => {
        const wert = (rumpf.felder[name] ?? '').trim();
        return wert === '' ? null : wert;
      };
      await schreibeStammdaten(kontext, {
        personId: id,
        geburtsdatum: text('geburtsdatum'),
        geburtsort: text('geburtsort'),
        staatsangehoerigkeit: text('staatsangehoerigkeit'),
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/personen/${id}/stammdaten?gespeichert=1`,
  });
}
