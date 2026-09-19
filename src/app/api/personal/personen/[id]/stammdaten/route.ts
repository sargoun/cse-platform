import { NextResponse, type NextRequest } from 'next/server';
import { schreibeStammdaten, type StammdatenEingabe }
  from '@/server/services/personal/stammdaten';
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
      /*
       * **Nicht mitgeschickt ist nicht dasselbe wie leer.** `undefined` laesst
       * die Spalte in Ruhe, `null` leert sie. Das vollstaendige Formular
       * schickt alle drei Felder (leer heisst dort also „leeren"); ein
       * Teil-POST ueber die Schnittstelle loescht die anderen zwei nicht mehr.
       */
      const text = (name: string): string | null | undefined => {
        const roh = rumpf.felder[name];
        if (roh === undefined) return undefined;
        const wert = roh.trim();
        return wert === '' ? null : wert;
      };
      /*
       * `exactOptionalPropertyTypes`: ein Schluessel mit dem Wert `undefined`
       * ist etwas anderes als ein FEHLENDER Schluessel. Genau darum geht es
       * hier, also wird der Schluessel weggelassen statt auf `undefined`
       * gesetzt.
       */
      const nimm = (name: keyof StammdatenEingabe & string): Partial<StammdatenEingabe> => {
        const wert = text(name);
        return wert === undefined ? {} : { [name]: wert };
      };
      await schreibeStammdaten(kontext, {
        personId: id,
        ...nimm('geburtsdatum'),
        ...nimm('geburtsort'),
        ...nimm('staatsangehoerigkeit'),
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/personen/${id}/stammdaten?gespeichert=1`,
  });
}
