import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import {
  anbieter, meldeAnMitKennwort, sichererRueckweg, wegNachAnmeldung,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE, sitzungsKeksOptionen } from '@/server/auth/sitzung';
import { db } from '@/server/db/pool';
import { herkunft } from '../mitarbeiter/anmeldung';
import { AuthFehler, AuthSchale } from '../AuthSchale';

/**
 * `/auth/login` — E-Mail und Kennwort fuer Verwaltung, Leitung und Kunden
 * (AUT-01, AUT-02, AUT-07, AUT-08).
 *
 * **Der Gegenentwurf zu `/dev/anmelden`.** Dort wird ein Konto aus einer Liste
 * gewaehlt und eine Sitzung ohne jede Pruefung ausgestellt; hier entscheidet
 * `app.kennwort_anmelden` in der Datenbank, und der Kennwort-Hash verlaesst sie
 * dabei nicht. Solange diese Seite nicht existierte, war die Entwicklungsseite
 * der EINZIGE Eingang dieser drei Rollen — und jede Pruefung nahm sie, womit
 * die Anmeldung selbst ungeprueft blieb.
 *
 * **Ein Formular mit `action`, kein Klickskript.** Ohne JavaScript funktioniert
 * es genauso; der Sitzungstoken wird als `httpOnly`-Keks gesetzt und nie im
 * Browser zusammengebaut.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Anmelden — CSE Gruppe' };

const TEXTE: Record<string, string> = {
  falsch: 'E-Mail oder Kennwort stimmt nicht.',
  gesperrt: 'Dieses Konto ist gesperrt. Bitte wenden Sie sich an Ihre Verwaltung.',
  gebremst: 'Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
  fremd: 'Dieses Konto wird über den Identitätsanbieter angemeldet, nicht hier.',
  abgemeldet: '',
};

export default async function Login({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const fehlerSchluessel = typeof p['fehler'] === 'string' ? p['fehler'] : null;
  const ziel = sichererRueckweg(p['weiter']);
  const abgemeldet = p['abgemeldet'] === '1';
  const anbieterJetzt = anbieter();

  async function anmelden(daten: FormData): Promise<void> {
    'use server';
    const email = String(daten.get('email') ?? '').trim();
    const kennwort = String(daten.get('kennwort') ?? '');
    const weiter = String(daten.get('weiter') ?? '');
    const kopf = await headers();
    const { ip } = await herkunft(kopf);

    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      meldeAnMitKennwort(tx, email, kennwort, ip, kopf.get('user-agent'))
    ) as ReturnType<typeof meldeAnMitKennwort>);

    if (ergebnis.ergebnis !== 'ok' || ergebnis.token === null) {
      const ab = weiter === '' ? '' : `&weiter=${encodeURIComponent(weiter)}`;
      redirect(`/auth/login?fehler=${ergebnis.ergebnis}${ab}`);
    }

    (await cookies()).set(SITZUNG_COOKIE, ergebnis.token, sitzungsKeksOptionen());
    redirect(wegNachAnmeldung(ergebnis, weiter));
  }

  return (
    <AuthSchale
      titel="Anmelden"
      unterzeile="Mit Ihrer geschäftlichen E-Mail-Adresse und Ihrem Kennwort."
      fuss={
        <>
          <a href="/auth/passwort-vergessen" data-cse="zu-passwort-vergessen"
             className="inline-flex min-h-11 items-center underline underline-offset-4
                        hover:text-text">
            Kennwort vergessen
          </a>
          <p>
            Sie arbeiten im Einsatz und haben kein Kennwort?{' '}
            <a href="/auth/mitarbeiter" data-cse="zu-mitarbeiter"
               className="underline underline-offset-4 hover:text-text">
              Anmeldung für Mitarbeitende
            </a>{' '}
            — mit Mobilnummer und Einmalcode.
          </p>
          {devFlaechenAn() && (
            <p>
              <a href="/dev/anmelden" className="underline underline-offset-4 hover:text-text">
                Entwicklungsanmeldung — Konto wählen
              </a>
            </p>
          )}
        </>
      }
    >
      {abgemeldet && (
        <Hinweis art="erfolg" cse="abgemeldet">
          <strong>Sie sind abgemeldet.</strong> Die Sitzung wurde beendet.
        </Hinweis>
      )}

      {fehlerSchluessel !== null && (TEXTE[fehlerSchluessel] ?? '') !== '' && (
        <AuthFehler cse="anmeldung-fehler">{TEXTE[fehlerSchluessel]}</AuthFehler>
      )}

      {anbieterJetzt === 'demo' && (
        <Hinweis art="warnung" cse="anbieter-demo">
          <strong>Identitätsanbieter: nicht verbunden.</strong>{' '}
          Supabase Auth ist gesetzt, aber kein Projekt hinterlegt (offene Frage O-501: welches
          EU-Projekt, welcher Auftragsverarbeitungsvertrag). Bis dahin prüft die Plattform das
          Kennwort selbst — als bcrypt-Hash in der eigenen Datenbank, mit denselben Sperren
          (AUT-07) und demselben zweiten Faktor. Umgestellt wird je Konto, nicht durch einen Umbau.
        </Hinweis>
      )}

      <form action={anmelden} data-cse="anmeldung-kennwort" className="flex flex-col gap-s4">
        <input type="hidden" name="weiter" value={ziel ?? ''} />
        <FormField
          label="E-Mail"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          placeholder="name@cse-dienstleistungen.de"
        />
        <FormField
          label="Kennwort"
          name="kennwort"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variante="primary" data-cse="anmelden">Anmelden</Button>
      </form>
    </AuthSchale>
  );
}
