import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  KENNWORT_MIN, kennwortFehler, leseKennwortToken, loeseKennwortTokenEin,
} from '@/server/auth/kennwort-anmeldung';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../AuthSchale';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/auth/passwort-neu` — das neue Kennwort setzen, mit dem Token aus der Mail.
 *
 * **Der Token wird zweimal angefasst und nur einmal verbraucht.** Beim Laden
 * `app.kennwort_token_lesen` (nur lesen: sonst waere ein versehentlich
 * geoeffneter Link verbrannt), beim Absenden `app.kennwort_token_einloesen` —
 * und das prueft, verbraucht und setzt in EINER Anweisung mit `for update`.
 * Zwei getrennte Schritte liessen ein Fenster, in dem derselbe Link zweimal
 * gilt.
 *
 * **Jede andere offene Sitzung endet mit dem neuen Kennwort.** Wer es setzt,
 * weil ein fremder Zugriff im Raum steht, haette sonst genau nichts erreicht.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Neues Kennwort — CSE Gruppe' };

export default async function PasswortNeu({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const token = typeof p['token'] === 'string' ? p['token'] : '';
  const fehler = typeof p['fehler'] === 'string' ? p['fehler'] : null;

  const inhalt = token === '' ? null : await (db().begin(
    async (tx: postgres.TransactionSql) => leseKennwortToken(tx, token),
  ) as ReturnType<typeof leseKennwortToken>);

  if (inhalt === null) {
    return (
      <AuthSchale
        titel="Dieser Link gilt nicht mehr"
        unterzeile="Ein Link zum Zurücksetzen gilt zwei Stunden und nur ein einziges Mal.
                    Fordern Sie einen neuen an."
        fuss={
          <p>
            <a href="/auth/login" className="underline underline-offset-4 hover:text-text">
              Zurück zur Anmeldung
            </a>
          </p>
        }
      >
        <a href="/auth/passwort-vergessen" data-cse="neuer-link"
           className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-s5
                      text-base font-semibold text-white transition-colors duration-fast
                      ease-brand hover:bg-brand-hover">
          Neuen Link anfordern
        </a>
      </AuthSchale>
    );
  }

  async function setzen(daten: FormData): Promise<void> {
    'use server';
    const t = String(daten.get('token') ?? '');
    const eins = String(daten.get('kennwort') ?? '');
    const zwei = String(daten.get('kennwort2') ?? '');
    function zurueck(grund: string): never {
      redirect(`/auth/passwort-neu?token=${encodeURIComponent(t)}&fehler=${grund}`);
    }

    if (eins !== zwei) zurueck('ungleich');
    if (kennwortFehler(eins) !== null) zurueck('schwach');

    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      loeseKennwortTokenEin(tx, t, eins)) as ReturnType<typeof loeseKennwortTokenEin>);
    if (ergebnis === null) zurueck('abgelaufen');

    /**
     * **Eine Administration ist nach dem Kennwort noch nicht drin.**
     * `kern.benutzer_2fa_pflicht` (0007) laesst ihr Konto nicht `aktiv`
     * werden, solange kein zweiter Faktor hinterlegt ist — der Weg geht
     * deshalb mit DEMSELBEN Token weiter zum Einrichten, und erst das
     * schliesst die Einladung ab.
     */
    if (ergebnis.brauchtFaktor) {
      redirect(`/auth/zwei-faktor/einrichten?token=${encodeURIComponent(t)}`);
    }
    redirect('/auth/login?abgemeldet=1&gesetzt=1');
  }

  const TEXTE: Record<string, string> = {
    ungleich: 'Die beiden Eingaben stimmen nicht überein.',
    schwach: kennwortFehler('') ?? 'Dieses Kennwort ist zu kurz.',
    abgelaufen: 'Der Link ist inzwischen abgelaufen. Fordern Sie einen neuen an.',
  };

  const einladung = inhalt.zweck === 'einladung';

  return (
    <AuthSchale
      titel={einladung ? 'Willkommen — Kennwort festlegen' : 'Neues Kennwort setzen'}
      unterzeile={
        <>
          Für <strong className="text-text">{inhalt.email ?? inhalt.name}</strong>.
          {einladung
            ? ' Damit ist Ihr Zugang eingerichtet.'
            : ' Alle offenen Sitzungen dieses Kontos werden dabei beendet.'}
        </>
      }
    >
      {fehler !== null && (eigenerEintrag(TEXTE, fehler) ?? '') !== '' && (
        <AuthFehler cse="kennwort-fehler">{eigenerEintrag(TEXTE, fehler)}</AuthFehler>
      )}

      <form action={setzen} data-cse="passwort-neu" className="flex flex-col gap-s4">
        <input type="hidden" name="token" value={token} />
        <FormField
          label="Neues Kennwort"
          name="kennwort"
          type="password"
          autoComplete="new-password"
          minLength={KENNWORT_MIN}
          required
          autoFocus
          hinweis={`Mindestens ${String(KENNWORT_MIN)} Zeichen. Eine Folge von vier Wörtern `
            + 'ist sicherer und leichter zu merken als „Sommer2024!".'}
        />
        <FormField
          label="Noch einmal zur Bestätigung"
          name="kennwort2"
          type="password"
          autoComplete="new-password"
          minLength={KENNWORT_MIN}
          required
        />
        <Button type="submit" variante="primary" data-cse="kennwort-setzen">
          {einladung ? 'Zugang einrichten' : 'Kennwort setzen'}
        </Button>
      </form>

      <Hinweis art="hinweis" cse="kennwort-regeln">
        <strong>Keine Ziffern- und Sonderzeichenpflicht.</strong> Das BSI hat diese Regeln
        aus dem Grundschutz genommen, weil sie zu <span className="font-mono">Sommer2024!</span>{' '}
        führen. Was zählt, ist Länge — und dass es nirgendwo sonst benutzt wird.
      </Hinweis>
    </AuthSchale>
  );
}
