import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  KENNWORT_MIN, aendereKennwort, kennwortFehler,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE } from '@/server/auth/sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../AuthSchale';

/**
 * `/auth/kennwort-wechseln` — der ERZWUNGENE Wechsel, an der Sitzung
 * gebunden (AUT-07).
 *
 * **Warum es diese Seite gibt.** `muss_wechseln` schickte bisher auf
 * `/auth/passwort-neu?wechsel=1`. Jene Seite liest einen Einladungs- oder
 * Zurücksetzungstoken aus der Adresse; ohne Token zeichnete sie „Link
 * abgelaufen", und der Mensch stand vor einer Sackgasse, aus der nur die
 * Abmeldung führte. Wer zusätzlich 2FA führt, ging vorher durch den zweiten
 * Faktor und landete danach auf `/portal` — die Pflicht war stillschweigend
 * vergessen.
 *
 * **Hier gibt es keinen Token, und das ist der Punkt.** Der Mensch ist
 * angemeldet; er weist sich mit dem ALTEN Kennwort aus. `app.kennwort_aendern`
 * prüft es gegen den gespeicherten Hash, setzt das neue, löscht
 * `muss_wechseln` und beendet jede andere Sitzung — ein Wechsel, der die
 * anderen Sitzungen stehen liesse, wäre bei einem kompromittierten Kennwort
 * genau nichts.
 *
 * **Kein Überspringen.** Es gibt keinen Weg-Parameter und keinen
 * „später"-Knopf: ein erzwungener Wechsel, den man wegklicken kann, ist eine
 * Bitte.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Kennwort wechseln — CSE Gruppe' };

const FEHLER: Readonly<Record<string, string>> = {
  alt: 'Das bisherige Kennwort stimmt nicht.',
  gleich: 'Das neue Kennwort muss sich vom bisherigen unterscheiden.',
};

export default async function KennwortWechseln({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const roh = typeof p['fehler'] === 'string' ? p['fehler'] : null;

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) redirect('/auth/login');

  async function wechseln(daten: FormData): Promise<void> {
    'use server';
    const alt = String(daten.get('alt') ?? '');
    const neu = String(daten.get('neu') ?? '');

    const schwach = kennwortFehler(neu);
    if (schwach !== null) {
      redirect(`/auth/kennwort-wechseln?fehler=${encodeURIComponent(schwach)}`);
    }
    if (alt === neu) redirect('/auth/kennwort-wechseln?fehler=gleich');

    const aktuell = await aktuelleSitzung();
    if (aktuell === null) redirect('/auth/login');

    const ok = await (db().begin(async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, aktuell);
      return aendereKennwort(tx, alt, neu);
    }) as Promise<boolean>);

    if (!ok) redirect('/auth/kennwort-wechseln?fehler=alt');

    /*
     * `app.kennwort_aendern` beendet ALLE Sitzungen dieses Kontos, auch
     * diese. Das Cookie zeigt danach auf nichts mehr — es wird hier entfernt,
     * damit die Anmeldeseite nicht mit einem toten Token begrüsst.
     */
    (await cookies()).delete(SITZUNG_COOKIE);
    redirect('/auth/login?gewechselt=1');
  }

  return (
    <AuthSchale
      titel="Kennwort wechseln"
      unterzeile="Für dieses Konto ist ein Wechsel hinterlegt. Er gilt, bevor es
                  weitergeht — deshalb führt von hier kein anderer Weg als der
                  neue Schlüssel."
    >
      {roh !== null && (
        <AuthFehler cse="wechsel-fehler">{FEHLER[roh] ?? roh}</AuthFehler>
      )}

      <Hinweis art="hinweis" cse="wechsel-grund" className="mb-s4">
        Nach dem Wechsel enden alle offenen Sitzungen dieses Kontos — auch diese.
        Sie melden sich danach einmal neu an. Das ist Absicht: ein Wechsel, der
        die anderen Sitzungen stehen liesse, hülfe gegen ein bekannt gewordenes
        Kennwort nicht.
      </Hinweis>

      <form action={wechseln} data-cse="kennwort-wechseln" className="flex flex-col gap-s4">
        <FormField
          name="alt"
          label="Bisheriges Kennwort"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormField
          name="neu"
          label="Neues Kennwort"
          type="password"
          autoComplete="new-password"
          hinweis={`Mindestens ${String(KENNWORT_MIN)} Zeichen.`}
          required
        />
        <Button type="submit" variante="primary" data-cse="wechsel-speichern">
          Kennwort setzen
        </Button>
      </form>
    </AuthSchale>
  );
}
