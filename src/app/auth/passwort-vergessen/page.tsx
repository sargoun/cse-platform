import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { KeinHostFehler, kanonischeBasis } from '@/lib/domains';
import {
  kennwortResetMail, legeKennwortTokenAn, resetGebremst,
} from '@/server/auth/kennwort-anmeldung';
import { db } from '@/server/db/pool';
import { EmailNichtVerbundenFehler, emailDienst } from '@/server/versand/email';
import { AuthSchale } from '../AuthSchale';
import { herkunft } from '../mitarbeiter/anmeldung';

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
    const kopf = await headers();
    const { ip } = await herkunft(kopf);

    /*
     * **Gebremst wird VOR dem Anlegen** (AUT-07, 0162). Ohne Bremse war
     * dieser oeffentliche Knopf zweierlei: jede Anforderung entwertete den
     * Link, den der Mensch gerade bekommen hat, und sobald ein E-Mail-Weg
     * angeschlossen ist, waere er ein Versandhebel auf eine fremde Adresse.
     *
     * Die Antwort bleibt dieselbe. „Gebremst" und „Adresse unbekannt" und
     * „Link unterwegs" sehen von aussen gleich aus — sonst waere die Bremse
     * das Werkzeug, mit dem man Konten aufzaehlt.
     */
    const token = await (db().begin(async (tx: postgres.TransactionSql) => (
      await resetGebremst(tx, email, ip) ? null
        : await legeKennwortTokenAn(tx, email, 'zuruecksetzen')
    )) as Promise<string | null>);

    if (token === null) {
      redirect('/auth/passwort-vergessen?gesendet=1');
    }

    /*
     * **Der Postausgang wird WIRKLICH gefragt.** Bisher entstand der Token und
     * niemand bat den Dienst, ihn zu verschicken -- auf der
     * Entwicklungsflaeche fiel das nicht auf, weil der Link daneben steht, und
     * in einem Bau ohne Anbieter auch nicht, weil dort ohnehin nichts ankommt.
     * Gebaut war damit alles ausser der Zeile, auf die es ankommt: ein
     * angeschlossener Anbieter haette hier nie etwas zu tun bekommen.
     *
     * `EmailNichtVerbundenFehler` ist der ERWARTETE Zustand, solange O-501
     * offen ist -- er wird gefangen, nicht durchgereicht. Die
     * Bestaetigungsseite sagt danach ausdruecklich, dass kein Postausgang
     * hinterlegt ist; sie behauptet nicht, eine Mail sei unterwegs.
     */
    /*
     * **Der Link muss ABSOLUT sein**, und der Text steht deshalb in
     * `kennwortResetMail` — eine reine Funktion, die ein Test lesen kann. Ein
     * `/auth/passwort-neu?token=…` ist im Browser ein Pfad und in einer E-Mail
     * ein Text, den niemand anklicken kann: das Postfach weiss nicht, zu
     * welchem Haus er gehoert.
     *
     * **Ein fehlender Host bricht den Weg NICHT ab.** `kanonischeBasis` wirft
     * lieber, als zu raten (`KeinHostFehler`) — richtig fuer eine Sitemap, hier
     * aber waere die Folge eine Fehlerseite genau dann, wenn eine Mail
     * herausgeht, und damit ein sichtbarer Unterschied zwischen „Adresse
     * bekannt“ und „Adresse unbekannt“. Ohne Basis geht also keine Nachricht
     * raus, die Antwort bleibt dieselbe, und die Bestaetigungsseite sagt
     * ohnehin, dass kein Postausgang hinterlegt ist.
     */
    const dienst = emailDienst(devFlaechenAn());
    let basis: string | null = null;
    try {
      basis = kanonischeBasis(kopf.get('host'));
    } catch (fehler) {
      if (!(fehler instanceof KeinHostFehler)) throw fehler;
    }
    if (basis !== null) {
      try {
        await dienst.sende({ an: email, ...kennwortResetMail(basis, token) });
      } catch (fehler) {
        if (!(fehler instanceof EmailNichtVerbundenFehler)) throw fehler;
      }
    }

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
