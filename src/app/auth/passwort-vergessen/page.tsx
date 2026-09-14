import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { legeKennwortTokenAn } from '@/server/auth/kennwort-anmeldung';
import { db } from '@/server/db/pool';
import { emailDienst } from '@/server/versand/email';
import { AuthSchale } from '../AuthSchale';

/**
 * `/auth/passwort-vergessen` — Link anfordern.
 *
 * **Die Antwort ist immer dieselbe.** Ob es zu dieser Adresse ein Konto gibt,
 * steht weder auf dem Bildschirm noch in der Laufzeit — dieselbe Regel wie bei
 * der Mitarbeiteranmeldung und wie AUT-06 eine Ebene spaeter.
 *
 * **Ohne verbundenen Versand geht kein Link raus, und das steht hier so da.**
 * Ein Formular, das „Wir haben Ihnen eine E-Mail geschickt" sagt, wo nichts
 * verschickt wurde, ist die teuerste Art von Hoeflichkeit: die Verwaltung
 * sucht danach im Spam-Ordner statt im Portal.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Kennwort vergessen — CSE Gruppe' };

export default async function PasswortVergessen({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const geschickt = p['gesendet'] === '1';
  const devLink = typeof p['dev'] === 'string' && emailDienst(devFlaechenAn()).zeigtInhalt
    ? p['dev'] : null;
  const post = emailDienst(devFlaechenAn());

  async function anfordern(daten: FormData): Promise<void> {
    'use server';
    const email = String(daten.get('email') ?? '').trim();
    const token = await (db().begin(async (tx: postgres.TransactionSql) =>
      legeKennwortTokenAn(tx, email, 'zuruecksetzen')) as Promise<string>);

    /**
     * Auf der Entwicklungsflaeche wird der Link angezeigt statt verschickt —
     * genau wie der SMS-Code (`SmsDienst.zeigtCode`). In einem Produktionsbau
     * ist `devFlaechenAn()` falsch, und dann gibt es hier nichts zu sehen.
     */
    const anhang = devFlaechenAn() ? `&dev=${encodeURIComponent(token)}` : '';
    redirect(`/auth/passwort-vergessen?gesendet=1${anhang}`);
  }

  if (geschickt) {
    return (
      <AuthSchale
        titel="Prüfen Sie Ihr Postfach"
        unterzeile="Wenn es zu dieser Adresse ein Konto gibt, ist ein Link unterwegs.
                    Er gilt zwei Stunden und nur einmal."
        fuss={
          <p>
            <a href="/auth/login" className="underline underline-offset-4 hover:text-text">
              Zurück zur Anmeldung
            </a>
          </p>
        }
      >
        {!post.verbunden && (
          <Hinweis art="warnung" cse="versand-nicht-verbunden">
            <strong>E-Mail-Versand: nicht verbunden.</strong> Es ist kein Postausgang
            hinterlegt, also kommt gerade keine Nachricht an. Ihre Verwaltung kann das
            Kennwort im Portal zurücksetzen (Einstellungen → Benutzer).
          </Hinweis>
        )}
        {devLink !== null && (
          <Hinweis art="hinweis" cse="dev-link">
            <strong>Entwicklungsfläche.</strong> Statt einer E-Mail steht der Link hier:{' '}
            <a className="break-all underline underline-offset-4"
               href={`/auth/passwort-neu?token=${encodeURIComponent(devLink)}`}>
              Kennwort jetzt setzen
            </a>
          </Hinweis>
        )}
      </AuthSchale>
    );
  }

  return (
    <AuthSchale
      titel="Kennwort vergessen"
      unterzeile="Geben Sie Ihre geschäftliche E-Mail-Adresse ein. Wir schicken Ihnen einen
                  Link, mit dem Sie ein neues Kennwort setzen."
      fuss={
        <p>
          <a href="/auth/login" data-cse="zurueck-login"
             className="inline-flex min-h-11 items-center underline underline-offset-4
                        hover:text-text">
            Zurück zur Anmeldung
          </a>
        </p>
      }
    >
      <form action={anfordern} data-cse="passwort-vergessen" className="flex flex-col gap-s4">
        <FormField
          label="E-Mail"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          autoFocus
          hinweis="Ob zu dieser Adresse ein Konto gehört, sagt diese Seite bewusst nicht."
        />
        <Button type="submit" variante="primary" data-cse="link-anfordern">
          Link anfordern
        </Button>
      </form>
    </AuthSchale>
  );
}
