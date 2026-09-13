import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { codeEinloesen } from '@/server/auth/mitarbeiter-anmeldung';
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
  const gescheitert = (await searchParams)['fehler'] === '1';

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
      if (personId === null) return null;
      return mitarbeiterSitzungAusstellen(tx, personId, ip, agent);
    }) as Promise<{ token: string; sitzungId: string } | null>);

    if (anmeldung === null) redirect('/auth/mitarbeiter/code?fehler=1');

    /*
     * Die Anmeldekekse verschwinden, sobald sie nichts mehr halten: eine
     * Telefonnummer, die nach der Anmeldung im Browser liegen bleibt, ist
     * gespeichert, ohne dass sie noch etwas tut.
     */
    k.delete(ANMELDUNG_TELEFON_COOKIE);
    k.delete(ANMELDUNG_DEV_COOKIE);
    k.set(SITZUNG_COOKIE, anmeldung.token, sitzungsKeksOptionen());

    redirect('/portal/mein');
  }

  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Code eingeben</h1>
      <p className="max-w-[60ch] text-base text-text-muted">
        Falls Ihre Nummer hinterlegt ist, haben wir einen sechsstelligen Code
        geschickt. Er gilt zehn Minuten.
      </p>

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
          pattern="[0-9]{6}"
          maxLength={6}
          required
          {...(gescheitert
            ? { fehler: 'Der Code stimmt nicht, ist abgelaufen oder wurde schon benutzt. Fordern Sie einen neuen an.' }
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
