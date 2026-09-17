import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { withEingang } from '@/server/kontext/eingang';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import {
  WiderspruchFehler, erfasseOhneToken, loeseEin, mandantFuerToken,
} from '@/server/services/datenschutz/werbewiderspruch';

/**
 * `POST /api/werbewiderspruch` — der öffentliche Widerspruch gegen Werbung
 * (CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG).
 *
 * **Kein Konto, keine Anmeldung, kein Ursprungstest** — genau wie
 * `/api/datenschutz/anfrage`. Wer der Werbung widerspricht, ist per Definition
 * jemand, der mit dieser Plattform nichts zu tun haben will; ein
 * `istGleicherUrsprung`-Riegel sperrte den Weg für jeden, der den Link aus
 * einem E-Mail-Programm heraus öffnet — und das ist der Regelfall.
 *
 * **Zwei Wege, ein Ziel.** Mit Token: der Ein-Klick-Weg aus der Nachricht, und
 * der Token sagt selbst, welche Gesellschaft gemeint ist. Ohne Token: auf
 * E-Mail-Adresse, und die Gesellschaft steht im Formular — die vier sind
 * verschiedene juristische Personen, jede für ihre Werbung selbst
 * verantwortlich (dieselbe Begründung wie bei `/datenschutz/anfrage`).
 *
 * **Geschrieben wird über den EINGANGSPRINZIPAL**, der `formular.schreiben`
 * hält und kein Leserecht. Der Renderer daneben läuft mit
 * `app.readonly = 'on'` und könnte nichts speichern: eine Übernahme der
 * Leseoberfläche liefert damit keinen Schreibpfad (03-AUTH §14.3).
 *
 * **Die Antwort verrät nichts.** `erfasst`, `bereits`, `unbekannt` und
 * „Formular entgegengenommen" — nie, wie viele Kontakte zu einer Adresse
 * gefunden wurden. „Zu dieser Adresse haben wir 3 Kontakte" wäre eine Auskunft
 * über einen fremden Datenbestand an jeden, der eine Adresse errät.
 */
export const dynamic = 'force-dynamic';

function ziel(anfrage: NextRequest, stand: string, token: string): NextResponse {
  const weg = token === ''
    ? `/werbewiderspruch?stand=${stand}`
    : `/werbewiderspruch/${encodeURIComponent(token)}?stand=${stand}`;
  return NextResponse.redirect(new URL(weg, anfrage.url), 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  let daten: FormData;
  try {
    daten = await anfrage.formData();
  } catch {
    return NextResponse.json({ ok: false, stand: 'unlesbar' }, { status: 400 });
  }

  const token = String(daten.get('token') ?? '');
  const email = String(daten.get('email') ?? '');
  const bereich = String(daten.get('bereich') ?? '');

  /*
   * Der Weg mit Token: die Gesellschaft kommt aus dem Token, nicht aus einem
   * Parameter der Adresse. Der Leseschritt laeuft ueber den Renderer
   * (`withOeffentlich`), weil er ohne Sitzung funktioniert — und er erfaehrt
   * nur, was der Inhaber des Tokens ohnehin weiss.
   */
  if (token !== '') {
    const mandantId = await (db().begin((tx: postgres.TransactionSql) =>
      withOeffentlich(tx, (kontext) => mandantFuerToken(kontext, token)),
    ) as Promise<string | null>);
    if (mandantId === null) return ziel(anfrage, 'unbekannt', token);

    const ergebnis = await (db().begin((tx: postgres.TransactionSql) =>
      withEingang(tx, mandantId, (kontext) => loeseEin(kontext, token)),
    ) as Promise<{ zustand: string }>);
    return ziel(anfrage, ergebnis.zustand, token);
  }

  /* Der tokenlose Weg: Gesellschaft aus dem Formular, Adresse aus dem Feld. */
  const [gesellschaft] = await (db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<{ id: string }>(
      `select id from mandant where slug = $1 and archiviert_am is null`, [bereich],
    ))) as Promise<readonly { id: string }[]>);
  if (gesellschaft === undefined) return ziel(anfrage, 'ohne_gesellschaft', '');

  try {
    await db().begin((tx: postgres.TransactionSql) =>
      withEingang(tx, gesellschaft.id, (kontext) =>
        erfasseOhneToken(kontext, email)));
  } catch (fehler) {
    if (fehler instanceof WiderspruchFehler) {
      return ziel(anfrage, 'email_ungueltig', '');
    }
    throw fehler;
  }
  return ziel(anfrage, 'entgegengenommen', '');
}
