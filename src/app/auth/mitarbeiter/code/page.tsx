import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { codeEinloesen } from '@/server/auth/mitarbeiter-anmeldung';
import { smsDienst } from '@/server/auth/sms';
import { SITZUNG_COOKIE, mitarbeiterSitzungAusstellen, sitzungsKeksOptionen }
  from '@/server/auth/sitzung';
import { ANMELDUNG_DEV_COOKIE, ANMELDUNG_TELEFON_COOKIE, herkunft } from '../anmeldung';

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
  if (telefon === '') redirect('/auth/mitarbeiter');

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
    if (nummer === '') redirect('/auth/mitarbeiter');

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
      const personId = await codeEinloesen(tx, nummer, code);
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
     */
    k.delete(ANMELDUNG_TELEFON_COOKIE);
    k.delete(ANMELDUNG_DEV_COOKIE);
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
    <main className="mx-auto flex w-full max-w-form flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Code eingeben</h1>
      <p className="max-w-[60ch] text-base text-text-muted" data-cse="code-hinweis">
        {ohneZustellung
          ? 'Es wurde keine SMS versendet — es ist kein Gateway verbunden (O-82). Geben Sie den '
            + 'sechsstelligen Code ein, den Ihnen Ihre Einsatzleitung genannt hat. Er gilt zehn Minuten.'
          : 'Falls Ihre Nummer hinterlegt ist, haben wir einen sechsstelligen Code geschickt. '
            + 'Er gilt zehn Minuten.'}
      </p>

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
    </main>
  );
}
