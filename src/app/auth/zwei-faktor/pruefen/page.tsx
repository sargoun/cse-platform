import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  alsRoute, hebeAufAal2, pruefeFaktor, sichererRueckweg,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE } from '@/server/auth/sitzung';
import { bindeAnfrage } from '@/server/kontext';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../../AuthSchale';

/**
 * `/auth/zwei-faktor/pruefen` — der zweite Schritt (AUT-02).
 *
 * **Die Sitzung steht schon.** Sie ist `aal1`, und `app.hat_recht` laesst mit
 * `aal1` genau die Rechte durch, die keinen zweiten Faktor verlangen. Diese
 * Seite hebt sie auf `aal2` — und zwar nur DIESE Sitzung, nicht alle offenen
 * desselben Kontos: der Faktor wurde hier vorgezeigt, nicht dort.
 *
 * Ohne Sitzung fuehrt der Weg zurueck an den Anfang statt in einen Fehler:
 * wer hier ohne erste Stufe landet, hat einen alten Link.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Zweiter Faktor — CSE Gruppe' };

export default async function FaktorPruefen({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const falsch = p['fehler'] === 'code';
  const ziel = sichererRueckweg(p['weiter']);

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) redirect('/auth/login');
  if (sitzung.aal === 'aal2') redirect(alsRoute(ziel ?? '/portal'));

  async function pruefen(daten: FormData): Promise<void> {
    'use server';
    const code = String(daten.get('code') ?? '');
    const weiter = String(daten.get('weiter') ?? '');
    const token = (await cookies()).get(SITZUNG_COOKIE)?.value ?? '';
    if (token === '') redirect('/auth/login');

    const aktuell = await aktuelleSitzung();
    if (aktuell === null) redirect('/auth/login');

    const ok = await (db().begin(async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, aktuell);
      const stimmt = await pruefeFaktor(tx, code, true);
      return stimmt ? hebeAufAal2(tx, token) : false;
    }) as Promise<boolean>);

    if (!ok) {
      const ab = weiter === '' ? '' : `&weiter=${encodeURIComponent(weiter)}`;
      redirect(`/auth/zwei-faktor/pruefen?fehler=code${ab}`);
    }
    redirect(alsRoute(sichererRueckweg(weiter) ?? '/portal'));
  }

  return (
    <AuthSchale
      titel="Zweiter Faktor"
      schritt={2}
      schritte={2}
      unterzeile="Öffnen Sie Ihre Authenticator-App und geben Sie den sechsstelligen Code ein,
                  der dort für die CSE Gruppe steht."
      fuss={
        <p>
          Kein Zugriff auf die App?{' '}
          <a href="/auth/zwei-faktor/wiederherstellung" data-cse="zu-wiederherstellung"
             className="underline underline-offset-4 hover:text-text">
            Mit einem Wiederherstellungscode anmelden
          </a>
        </p>
      }
    >
      {falsch && (
        <AuthFehler cse="faktor-fehler">
          Der Code stimmt nicht oder er ist abgelaufen. Ein Code gilt dreissig Sekunden
          und nur ein einziges Mal.
        </AuthFehler>
      )}

      <form action={pruefen} data-cse="faktor-pruefen" className="flex flex-col gap-s4">
        <input type="hidden" name="weiter" value={ziel ?? ''} />
        <FormField
          label="Sechsstelliger Code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className="font-mono text-h2 tracking-[0.4em]"
          hinweis="Nur Ziffern. Der Code wechselt alle dreissig Sekunden."
        />
        <Button type="submit" variante="primary" data-cse="faktor-bestaetigen">Bestätigen</Button>
      </form>
    </AuthSchale>
  );
}
