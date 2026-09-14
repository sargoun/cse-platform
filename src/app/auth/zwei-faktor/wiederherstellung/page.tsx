import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  alsRoute, hebeAufAal2, loeseWiederherstellungscodeEin, offeneWiederherstellungscodes,
  sichererRueckweg,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE } from '@/server/auth/sitzung';
import { bindeAnfrage } from '@/server/kontext';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../../AuthSchale';

/**
 * `/auth/zwei-faktor/wiederherstellung` — zwei Zustaende, eine Seite.
 *
 * **Frisch ausgegeben** (`?codes=…`): die zehn Codes werden EINMAL angezeigt.
 * Gespeichert ist nur ihr SHA-256; diese Anzeige ist die einzige Gelegenheit,
 * sie zu sichern. Deshalb stehen sie in der Adresszeile und nicht in einem
 * Keks — sie sind hier bereits gesetzt, der Weg zurueck ist ein Neuladen, und
 * ein Keks ueberlebte den Bildschirm laenger als noetig.
 *
 * **Einloesen** (ohne Parameter): ein Code statt des App-Codes. Er gilt genau
 * einmal; `app.wiederherstellungscode_einloesen` streicht ihn in derselben
 * Anweisung, die ihn prueft.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Wiederherstellungscodes — CSE Gruppe' };

export default async function Wiederherstellung({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const roh = typeof p['codes'] === 'string' ? p['codes'] : '';
  const codes = roh.split(' ').filter((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/u.test(c));
  const falsch = p['fehler'] === 'code';
  const ziel = sichererRueckweg(p['weiter']);

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) redirect('/auth/login');

  if (codes.length > 0) {
    return (
      <AuthSchale
        titel="Ihre Wiederherstellungscodes"
        unterzeile="Der zweite Faktor ist eingerichtet. Diese Codes sehen Sie jetzt — und
                    nur jetzt. Drucken Sie sie aus oder legen Sie sie in Ihren Passwortmanager."
      >
        <Card className="flex flex-col gap-s4">
          <ul data-cse="wiederherstellungscodes"
              className="grid grid-cols-1 gap-s2 sm:grid-cols-2">
            {codes.map((c) => (
              <li key={c}
                  className="select-all rounded-md border border-line bg-surface-3 px-s4 py-s3
                             text-center font-mono text-base tracking-wider text-text">
                {c}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted">
            Jeder Code gilt <strong>einmal</strong>. Sie ersetzen den Code aus der App,
            wenn das Telefon weg ist.
          </p>
        </Card>

        <Hinweis art="warnung" cse="codes-einmalig">
          <strong>Gespeichert ist nur ihre Prüfsumme.</strong> Wer diese Datenbank liest, kann
          sich damit nicht anmelden — aber es gibt hier auch niemanden, der sie Ihnen noch
          einmal zeigen könnte. Neue Codes gibt es nur als ganzen Satz, unter
          Konto → Sicherheit.
        </Hinweis>

        <a href={alsRoute(ziel ?? '/portal')} data-cse="codes-weiter"
           className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                      px-s5 text-base font-semibold text-white transition-colors duration-fast
                      ease-brand hover:bg-brand-hover">
          Ich habe sie gesichert — weiter
        </a>
      </AuthSchale>
    );
  }

  const offen = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    return offeneWiederherstellungscodes(tx);
  }) as Promise<number>);

  async function einloesen(daten: FormData): Promise<void> {
    'use server';
    const code = String(daten.get('code') ?? '');
    const weiter = String(daten.get('weiter') ?? '');
    const token = (await cookies()).get(SITZUNG_COOKIE)?.value ?? '';
    const aktuell = await aktuelleSitzung();
    if (aktuell === null || token === '') redirect('/auth/login');

    const ok = await (db().begin(async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, aktuell);
      return await loeseWiederherstellungscodeEin(tx, code) ? hebeAufAal2(tx, token) : false;
    }) as Promise<boolean>);

    if (!ok) {
      const ab = weiter === '' ? '' : `&weiter=${encodeURIComponent(weiter)}`;
      redirect(`/auth/zwei-faktor/wiederherstellung?fehler=code${ab}`);
    }
    redirect(alsRoute(sichererRueckweg(weiter) ?? '/portal'));
  }

  return (
    <AuthSchale
      titel="Mit einem Wiederherstellungscode anmelden"
      unterzeile="Geben Sie einen der Codes ein, die Sie beim Einrichten des zweiten
                  Faktors erhalten haben."
      fuss={
        <p>
          <a href="/auth/zwei-faktor/pruefen" data-cse="zurueck-zur-app"
             className="underline underline-offset-4 hover:text-text">
            Zurück zum Code aus der App
          </a>
        </p>
      }
    >
      {falsch && (
        <AuthFehler cse="wiederherstellung-fehler">
          Dieser Code stimmt nicht oder er wurde bereits benutzt.
        </AuthFehler>
      )}

      {offen === 0 && (
        <Hinweis art="warnung" cse="keine-codes">
          <strong>Für dieses Konto sind keine Codes mehr offen.</strong> Ihre Verwaltung kann
          den zweiten Faktor zurücksetzen (Recht <span className="font-mono">
          system.zwei_faktor_zuruecksetzen</span>); danach richten Sie ihn neu ein.
        </Hinweis>
      )}

      <form action={einloesen} data-cse="wiederherstellung-einloesen"
            className="flex flex-col gap-s4">
        <input type="hidden" name="weiter" value={ziel ?? ''} />
        <FormField
          label="Wiederherstellungscode"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          placeholder="ABCDE-FGHIJ"
          className="font-mono text-base tracking-wider"
          hinweis={offen > 0
            ? `Noch ${String(offen)} von zehn Codes offen. Jeder gilt einmal.`
            : 'Jeder Code gilt einmal.'}
        />
        <Button type="submit" variante="primary" data-cse="wiederherstellung-bestaetigen">
          Anmelden
        </Button>
      </form>
    </AuthSchale>
  );
}
