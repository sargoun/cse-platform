import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { RedaktionFehler, setzeReferenzStatus } from '@/server/services/inhalt/redaktion';
import { grundAufsFormular } from '../../formular-antwort';

/**
 * `POST /api/website/referenzen` — ein Projekt auf die Website stellen oder
 * zurückziehen (§5.21, PRO-05).
 *
 * **Die Kundenfreigabe wird DREIMAL geprüft, und das ist kein Übereifer.**
 * Der Dienst fragt sie ab und sagt, was fehlt; die Policy `t_referenz_pflege`
 * verlangt `referenz.kundenfreigabe_erfassen`; und `referenz_freigabe_belegt`
 * lässt eine Freigabe ohne Datum gar nicht erst in die Tabelle. Ein Kundenname
 * auf einer Website ohne dessen Zustimmung ist nichts, was man durch Löschen
 * ungeschehen macht — er steht dann im Cache einer Suchmaschine, und der
 * Kunde ruft an.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const id = String(daten.get('id') ?? '');
  const veroeffentlicht = String(daten.get('veroeffentlicht') ?? '') === '1';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'referenz.veroeffentlichen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeReferenzStatus(kontext, id, veroeffentlicht);
      }));
  } catch (fehler) {
    if (fehler instanceof RedaktionFehler) {
      /*
       * **Ein Formular bekommt seine Seite zurück, kein JSON (D-599, V-154).**
       * Beide Aufrufer (Liste und Veröffentlichungsblatt) sind Formulare ohne
       * JavaScript mit `zurueck`. Der Weg ist nicht konstruiert: wer die
       * Freigabe in einem zweiten Fenster zurücknimmt und im ersten auf
       * „Veröffentlichen" drückt, sah `{"fehler":"ohne_kundenfreigabe"}`.
       */
      const umleitung = grundAufsFormular(anfrage, {
        json: false,
        zurueck: typeof daten.get('zurueck') === 'string'
          ? daten.get('zurueck') as string : undefined,
        grund: fehler.grund,
      });
      if (umleitung !== null) return umleitung;
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: 400 });
    }
    /*
     * **`authorize` wirft, und der Wurf muss übersetzt werden.** Hier stand
     * nur der `RedaktionFehler` darüber — ein fehlendes Recht flog durch und
     * endete als **500**. Und dieser Fall war nicht hypothetisch:
     * `referenz.veroeffentlichen` hält NUR `super_admin`, während die
     * Referenzliste ihren Veröffentlichen-Knopf gegen `nurLesen` und die
     * Kundenfreigabe stellte, nie gegen das Recht. Ein `admin` sah den Knopf,
     * drückte ihn und bekam den Bildschirm „Da ist etwas schiefgegangen" —
     * für eine Handlung, die er einfach nicht darf. 500 heisst „hier ist
     * etwas"; 404 heisst nichts (AUT-06). Der Knopf ist inzwischen gegen
     * `haeltRechte('referenz.veroeffentlichen')` gestellt; dieser Riegel
     * steht trotzdem, denn ein POST kommt auch ohne Knopf.
     */
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
