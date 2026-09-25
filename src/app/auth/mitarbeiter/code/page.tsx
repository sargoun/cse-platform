import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { Button } from '@/components/ui/Button';
import { AuthSchale } from '../../AuthSchale';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { codeEinloesen } from '@/server/auth/mitarbeiter-anmeldung';
import { smsDienst } from '@/server/auth/sms';
import { SITZUNG_COOKIE, mitarbeiterSitzungAusstellen, sitzungsKeksOptionen }
  from '@/server/auth/sitzung';
import {
  ANMELDUNG_DEV_COOKIE, ANMELDUNG_TELEFON_COOKIE, anmeldeKeksOptionen, herkunft,
} from '../anmeldung';

/**
 * `/auth/mitarbeiter/code` — der zweite Schritt (EMP-01, PR 20).
 *
 * **Ein Feld, nicht sechs.** 04-SEITENKARTE §2548 sagt es woertlich: das
 * Codefeld wird nie in sechs Einzelzeichen zerlegt. Sechs Felder lesen sich
 * mit einem Screenreader als sechs namenlose Eingaben, und Einfuegen aus der
 * SMS trifft dann nur das erste.
 *
 * **Ein einziger Fehlertext fuer jeden Fehlschlag.** „Code falsch",
 * „abgelaufen", „schon benutzt" und „Nummer unbekannt" sind vier Hinweise
 * fuer den, der raet, und null Hilfe fuer den, der sich vertippt hat — der
 * tippt einfach nochmal. `app.zugang_code_einloesen` (0114) unterscheidet sie
 * schon nicht; diese Seite tut es auch nicht.
 */
export const dynamic = 'force-dynamic';

/** Siehe den Titel des ersten Schritts — WCAG 2.4.2. */
export const metadata = { title: 'Code eingeben — CSE Gruppe' };

interface Props {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CodeEingabe({ searchParams }: Props) {
  const keks = await cookies();
  const telefon = keks.get(ANMELDUNG_TELEFON_COOKIE)?.value ?? '';
  /*
   * Ohne den Keks gibt es keine offene Anmeldung: zurueck zum ersten Schritt.
   * Diese Seite mit einer Nummer aus der URL zu fuettern, waere ein zweiter
   * Weg zum selben Ziel — und der zweite Weg ist der, den niemand prueft.
   */
  if (telefon === '') redirect('/auth/mitarbeiter?fehler=abgelaufen');

  const devCode = keks.get(ANMELDUNG_DEV_COOKIE)?.value ?? null;
  /**
   * **Zwei Fehlschlaege, zwei Saetze** (D-488).
   *
   * `code` ist der alte, absichtlich unbestimmte Fall: falsch, abgelaufen,
   * schon benutzt, Nummer unbekannt — vier Auskuenfte fuer den, der raet,
   * und null Hilfe fuer den, der sich vertippt hat.
   *
   * `konto` ist der andere, und er war bisher derselbe Satz: der Code war
   * RICHTIG, `app.zugang_code_einloesen` hat ihn eingeloest und verbraucht —
   * aber zu diesem Menschen gehoert kein benutzbares Konto (0115), und die
   * Sitzung bleibt aus. Wer das liest, hat den Code bereits gehabt; hier
   * verraet der eigene Satz also nichts, was der Leser nicht schon wusste.
   * Ihn zu verschweigen hat dagegen genau einen Effekt: die Mitarbeiterin
   * fordert einen neuen Code an, tippt wieder, scheitert wieder — bis die
   * Bremse haelt.
   */
  const fehlerRoh = (await searchParams)['fehler'];
  const fehler = fehlerRoh === 'konto' ? 'konto' : fehlerRoh === undefined ? null : 'code';
  /**
   * Weder Versand noch Anzeige (O-82 offen, keine Entwicklungsflaeche): dann
   * wurde im ersten Schritt KEIN Code angelegt (D-487), und „wir haben einen
   * Code geschickt" waere eine Luege. Der Code kommt von der Einsatzleitung.
   */
  const sms = smsDienst(devFlaechenAn());
  const ohneZustellung = !sms.verbunden && !sms.zeigtCode;

  async function einloesen(daten: FormData): Promise<void> {
    'use server';
    const k = await cookies();
    const nummer = k.get(ANMELDUNG_TELEFON_COOKIE)?.value ?? '';
    /*
     * **Ein Rueckwurf ohne ein Wort ist der schlimmste Fehlschlag, den diese
     * Seite haben kann.**
     *
     * Hier stand `redirect('/auth/mitarbeiter')` — ohne Grund, ohne Meldung.
     * Der Mensch tippt die Nummer, bekommt den Code, tippt den Code, drueckt
     * „Anmelden" — und steht wieder am Anfang. Kein Fehlerkasten, kein Satz,
     * nichts, woraus sich schliessen liesse, was zu tun waere. Genau so hat es
     * ein Nutzer berichtet, und genau so verhielt es sich: der Keks mit der
     * Nummer war nie im Browser angekommen (siehe `anmeldeKeksOptionen`),
     * also war `nummer` leer, und diese Zeile warf ihn stumm zurueck.
     *
     * Der Grund geht jetzt mit. Er ist bewusst UNSPEZIFISCH („abgelaufen"):
     * warum der Keks fehlt, weiss der Server nicht — abgelaufen, geloescht,
     * vom Browser verworfen, ein zweites Fenster. Was der Mensch braucht, ist
     * nicht die Ursache, sondern der naechste Schritt.
     */
    if (nummer === '') redirect('/auth/mitarbeiter?fehler=abgelaufen');

    const code = String(daten.get('code') ?? '').replace(/\s/gu, '');
    const { ip } = await herkunft(await headers());
    const agent = (await headers()).get('user-agent');

    /**
     * Einloesen und Sitzung ausstellen in EINER Transaktion.
     *
     * Ein verbrauchter Code ohne Sitzung waere die schlechteste Verbindung
     * aus beidem: der Code ist weg, die Anmeldung hat nicht stattgefunden,
     * und der Mensch vor dem Telefon darf von vorn anfangen — mit einer SMS,
     * die er nicht mehr bekommt, weil die Bremse aus 0114 mitzaehlt.
     */
    const anmeldung = await (db().begin(async (tx: postgres.TransactionSql) => {
      const personId = await codeEinloesen(tx, nummer, code, ip);
      if (personId === null) return { art: 'code' as const };
      const sitzung = await mitarbeiterSitzungAusstellen(tx, personId, ip, agent);
      /* Der Code war richtig — nur das Konto fehlt. Siehe oben, warum das ein
         eigener Satz ist und kein Orakel. */
      return sitzung === null ? { art: 'konto' as const } : { art: 'ok' as const, sitzung };
    }) as Promise<
      { art: 'ok'; sitzung: { token: string; sitzungId: string } } | { art: 'code' } | { art: 'konto' }
    >);

    if (anmeldung.art !== 'ok') redirect(`/auth/mitarbeiter/code?fehler=${anmeldung.art}`);

    /*
     * Die Anmeldekekse verschwinden, sobald sie nichts mehr halten: eine
     * Telefonnummer, die nach der Anmeldung im Browser liegen bleibt, ist
     * gespeichert, ohne dass sie noch etwas tut.
     *
     * **Mit dem PFAD, unter dem sie gesetzt wurden.** Hier stand
     * `k.delete(NAME)` ohne Pfad — und ein Keks auf `Path=/auth/mitarbeiter`
     * wird davon NICHT getroffen: der Browser loescht nur, was in Name, Pfad
     * und Domaene uebereinstimmt. Beide blieben also liegen, und der
     * Entwicklungskeks traegt den Einmalcode im KLARTEXT. Zehn Minuten lang,
     * nach einer Anmeldung, die ihn nicht mehr braucht.
     *
     * `maxAge: 0` mit denselben Optionen statt `delete`: so ist der
     * Loeschkeks in jedem Attribut die Kopie des gesetzten, und es gibt keine
     * zweite Stelle, an der jemand den Pfad nachziehen muesste.
     */
    const weg = { ...anmeldeKeksOptionen(), maxAge: 0 };
    k.set(ANMELDUNG_TELEFON_COOKIE, '', weg);
    k.set(ANMELDUNG_DEV_COOKIE, '', weg);
    k.set(SITZUNG_COOKIE, anmeldung.sitzung.token, sitzungsKeksOptionen());

    /*
     * `angemeldet=1` ist kein Schmuck: kommt der Browser hier ohne Sitzung an,
     * hat er den Keks nicht angenommen — ueber `http://` lehnt er einen
     * `__Host-`-Keks ab —, und das Portal kann es SAGEN, statt nur „Anmeldung
     * erforderlich" zu zeigen (D-488).
     */
    redirect('/portal/mein?angemeldet=1');
  }

  return (
    <AuthSchale
      titel="Code eingeben"
      schritt={2}
      schritte={2}
      unterzeile={
        <span data-cse="code-hinweis">
          {ohneZustellung
            ? 'Es wurde keine SMS versendet — es ist kein Gateway verbunden (O-82). Geben Sie den '
              + 'sechsstelligen Code ein, den Ihnen Ihre Einsatzleitung genannt hat. Er gilt zehn Minuten.'
            : 'Falls Ihre Nummer hinterlegt ist, haben wir einen sechsstelligen Code geschickt. '
              + 'Er gilt zehn Minuten.'}
        </span>
      }
    >

      {fehler !== null && (
        <Hinweis art="warnung" cse="code-fehler" className="max-w-[60ch]">
          {fehler === 'konto' ? (
            <>
              <strong>Der Code war richtig — das Konto fehlt.</strong> Zu dieser Mobilnummer gehört
              noch kein aktiver Portalzugang, deshalb kommt die Anmeldung nicht durch. Ein neuer Code
              ändert daran nichts; Ihre Einsatzleitung lässt das Konto anlegen oder entsperren.
            </>
          ) : (
            <>
              <strong>Die Anmeldung hat nicht geklappt.</strong> Der Code stimmt nicht, ist abgelaufen
              oder wurde schon benutzt. Ein Code gilt zehn Minuten und genau einmal.
            </>
          )}
        </Hinweis>
      )}

      {devCode !== null && (
        <p
          data-cse="dev-code"
          className="rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>Entwicklungsfläche — es wurde nichts versendet.</strong> Der
          Code lautet <code data-cse="dev-code-wert">{devCode}</code>.
        </p>
      )}

      <form action={einloesen} data-cse="anmeldung-code" className="flex flex-col gap-s4">
        <FormField
          label="Sechsstelliger Code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          /*
           * **Kein `pattern`, und `maxLength` grosszuegig.** Ein eingefuegter
           * Code bringt Leerzeichen mit; `pattern="[0-9]{6}"` haette das
           * Absenden stumm blockiert — kein Fehler, keine Bewegung, die Seite
           * bleibt stehen. Der Server nimmt die Ziffern (`nurZiffern`) und
           * sagt, was er davon haelt (D-488).
           */
          maxLength={20}
          required
          hinweis="Sechs Ziffern. Leerzeichen dürfen mitkommen."
          {...(fehler === 'code'
            ? { fehler: ohneZustellung
                ? 'Lassen Sie sich von Ihrer Einsatzleitung einen neuen Code ausstellen.'
                : 'Fordern Sie einen neuen Code an.' }
            : {})}
        />
        <Button type="submit" variante="primary" data-cse="code-einloesen">
          Anmelden
        </Button>
      </form>

      <form action="/auth/mitarbeiter" method="get">
        <Button type="submit" variante="ghost" data-cse="code-neu">
          Andere Nummer oder neuen Code
        </Button>
      </form>
    </AuthSchale>
  );
}
