import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  alsRoute, faktorGebremst, hebeAufAal2, pruefeFaktor, sichererRueckweg,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE } from '@/server/auth/sitzung';
import { bindeAnfrage } from '@/server/kontext';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../../AuthSchale';
import { Hinweis } from '@/components/ui/Hinweis';
import { devFlaechenAn } from '@/lib/dev-flaechen';

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
  const gebremst = p['fehler'] === 'gebremst';
  const wechsel = p['wechsel'] === '1';
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

    /*
     * **Auch die zweite Stufe wird gebremst** (AUT-02, 0162).
     *
     * Ein falscher Code gab vorher nur `false` zurueck: kein Zaehler, keine
     * Sperre. Wer eine `aal1`-Sitzung in die Hand bekommt, durfte damit
     * unbegrenzt raten -- und sechs Ziffern sind keine Huerde, wenn jeder
     * Versuch kostenlos ist und alle dreissig Sekunden ein neues Fenster
     * aufgeht. Gebremst wird der WEG, nicht das Konto: der Ratende hat die
     * Sitzung schon, ein gesperrtes Konto naehme ihm nichts und dem Menschen
     * alles.
     */
    const stand = await (db().begin(async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, aktuell);
      const stimmt = await pruefeFaktor(tx, code, true);
      const gebremst = await faktorGebremst(tx, aktuell.benutzerId, stimmt);
      if (gebremst) return 'gebremst' as const;
      if (!stimmt) return 'falsch' as const;
      return await hebeAufAal2(tx, token) ? 'ok' as const : 'falsch' as const;
    }) as Promise<'ok' | 'falsch' | 'gebremst'>);

    if (stand !== 'ok') {
      const ab = weiter === '' ? '' : `&weiter=${encodeURIComponent(weiter)}`;
      redirect(`/auth/zwei-faktor/pruefen?fehler=${stand === 'gebremst' ? 'gebremst' : 'code'}${ab}`);
    }
    /*
     * **Die Pflicht zum Kennwortwechsel ueberlebt die zweite Stufe.** Sie
     * kommt als `?wechsel=1` mit (siehe `wegNachAnmeldung`); ohne diese Zeile
     * fuehrte der Erfolgsweg ins Portal und die Pflicht war vergessen.
     */
    if (wechsel) redirect('/auth/kennwort-wechseln');
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

      {gebremst && (
        <AuthFehler cse="faktor-gebremst">
          Zu viele Fehlversuche. Dieser Weg ist für kurze Zeit gesperrt — auch ein
          richtiger Code wird jetzt abgewiesen. Warten Sie einige Minuten, oder melden
          Sie sich mit einem Wiederherstellungscode an.
        </AuthFehler>
      )}

      {/*
        * Vorführbetrieb (V-136): die Konten aus dem Seed tragen einen
        * Platzhalter-Faktor, zu dem es keinen Code gibt — sie erfüllen AUT-02
        * als Konten, eine echte Authenticator-App steht nicht dahinter. Statt
        * einer Seite, an der jeder Code scheitert, der Weg, der funktioniert.
        * Ohne `CSE_DEV_FLAECHEN` steht hier nichts.
        */}
      {devFlaechenAn() && (
        <Hinweis art="hinweis" cse="faktor-vorfuehrung">
          <strong>Vorführbetrieb:</strong> Die Konten aus den Demodaten haben keinen
          echten zweiten Faktor. Melden Sie sich über{' '}
          <a href="/dev/anmelden" className="underline underline-offset-4">/dev/anmelden</a>{' '}
          an — dort entsteht die Sitzung mit beiden Stufen.
        </Hinweis>
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
