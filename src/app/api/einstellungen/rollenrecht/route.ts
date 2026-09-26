import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import {
  MAX_AENDERUNGEN, RollenrechtFehler, setzeRollenrechte, type Aenderung,
} from '@/server/services/system/rollenrecht';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/einstellungen/rollenrecht` — eine Abweichung dieser Gesellschaft
 * an der Rechtematrix setzen (V-023, AUT-03).
 *
 * **Die ganze Matrix in EINEM Absenden.** Eine Rechtematrix wird als Ganzes
 * gelesen und als Ganzes entschieden; „`finanzen.lesen` entziehen,
 * `finanzen.exportieren` aber lassen" ist EINE Überlegung. Zwei Anfragen
 * daraus zu machen hiesse, dass zwischen ihnen ein Zustand steht, den niemand
 * gewollt hat — und dass die Selbstaussperrungsprüfung im Dienst ihn für
 * gültig hält.
 *
 * **Der zweite Faktor wird HIER verlangt und nicht nur unten.** `p_rb_aal2`
 * (0008) ist restriktiv und weist eine `aal1`-Sitzung ab — mit „new row
 * violates row-level security policy", also einem 500er an einer Stelle, an
 * der „zeig den zweiten Faktor" die Wahrheit ist. `authorize` mit
 * `erfordert2fa` sagt denselben Satz vorher und verständlich (AUT-02, K-15).
 *
 * **Die Felder heissen `r:<rechteschluessel>`** und tragen `unveraendert`,
 * `gewaehren` oder `entziehen`. Der Doppelpunkt ist kein Zufall: ein
 * Rechteschlüssel enthält einen Punkt (`finanzen.lesen`), und ein
 * Unterstrich-Präfix wäre von einem Modulnamen nicht zu unterscheiden.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FELD = /^r:([a-z][a-z0-9_]*\.[a-z0-9_.]+)$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const rolleId = String(daten.get('rolle') ?? '');
  if (!UUID.test(rolleId)) {
    return NextResponse.json({ fehler: 'unbekannte_rolle' }, { status: 400 });
  }

  /*
   * **Die Wünsche kommen aus den Feldnamen, nicht aus einer Liste daneben.**
   * Eine zweite Liste „welche Rechte stehen im Formular" wäre ein zweiter Ort
   * mit denselben Schlüsseln — und der erste, an dem nach einer
   * Katalogänderung etwas fehlt.
   */
  const aenderungen: Aenderung[] = [];
  for (const [name, wert] of daten.entries()) {
    const treffer = FELD.exec(name);
    if (treffer === null || typeof wert !== 'string') continue;
    if (wert === 'gewaehren' || wert === 'entziehen') {
      aenderungen.push({ recht: treffer[1]!, wunsch: wert });
    }
    if (aenderungen.length > MAX_AENDERUNGEN) break;
  }

  /*
   * D-562: diese Route liest ausschliesslich `formData` und wird von einem
   * Menschen bedient. Eine Abweisung kehrt auf die Seite zurück, die eine
   * Satztabelle dafür führt — nicht als JSON auf eine weisse Seite.
   */
  let slug = '';
  let rolleSchluessel = '';
  const seite = (): string =>
    `/portal/${slug}/einstellungen/rollen/${encodeURIComponent(rolleSchluessel)}`;

  try {
    const anzahl = await (db().begin((tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.rolle_verwalten', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;
        /*
         * Der Schlüssel der Rolle steht im RÜCKWEG, nicht die Kennung: die
         * Seite heisst `/einstellungen/rollen/[rolle]`, und `[rolle]` ist der
         * Schlüssel. Gelesen wird er in derselben Transaktion, damit auch der
         * Fehlerzweig ihn hat.
         */
        const [r] = await kontext.abfrage<{ schluessel: string }>(
          `select r.schluessel from rolle r
            where r.id = $1::uuid and r.archiviert_am is null
              and (r.mandant_id is null or r.mandant_id = app.aktiver_mandant())`,
          [rolleId]);
        if (r === undefined) {
          throw new RollenrechtFehler(
            'Diese Rolle gibt es nicht — oder sie gehört einer anderen Gesellschaft.',
            'unbekannte_rolle', 404);
        }
        rolleSchluessel = r.schluessel;
        return setzeRollenrechte(kontext, rolleId, aenderungen);
      })) as unknown as Promise<number>);

    return NextResponse.redirect(
      internesZiel(`${seite()}?gesetzt=${String(anzahl)}`, seite(), anfrage), 303);
  } catch (fehler) {
    if (fehler instanceof RollenrechtFehler) {
      const ziel = rolleSchluessel === ''
        ? `/portal/${slug}/einstellungen/rollen`
        : `${seite()}?fehler=${fehler.grund}`;
      return NextResponse.redirect(internesZiel(ziel, ziel, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
