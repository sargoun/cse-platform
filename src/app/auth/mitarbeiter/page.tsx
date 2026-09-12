import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { codeAnfordern } from '@/server/auth/mitarbeiter-anmeldung';
import { smsDienst } from '@/server/auth/sms';
import {
  ANMELDUNG_DEV_COOKIE, ANMELDUNG_TELEFON_COOKIE, anmeldeKeksOptionen, herkunft,
} from './anmeldung';

/**
 * `/auth/mitarbeiter` — die Anmeldung fuer Beschaeftigte (EMP-01, PR 20).
 *
 * **Kein Passwortfeld, und zwar nicht nur unsichtbar, sondern gar keines.**
 * EMP-01 sagt „phone number + SMS code, no password". Ein verstecktes oder
 * deaktiviertes Feld waere trotzdem eines: Passwortverwalter fuellen es,
 * Browser bieten es an, und irgendwann fragt jemand, welches Kennwort denn
 * gemeint ist. `tests/e2e/anmeldung.spec.ts` zaehlt deshalb die
 * `input[type=password]` im DOM und verlangt null.
 *
 * **Die Antwort ist immer dieselbe.** Ob es die Nummer gibt, steht weder auf
 * dem Bildschirm noch in der Laufzeit: `app.zugang_code_anfordern` (0114)
 * entscheidet still, und diese Seite leitet in jedem Fall zur Codeeingabe
 * weiter. Wer Nummern durchprobiert, erfaehrt nichts — dieselbe Regel wie
 * AUT-06 (404 statt 403), eine Ebene frueher.
 */
export const dynamic = 'force-dynamic';

/**
 * Ein EIGENER Titel, nicht der des Wurzel-Layouts.
 *
 * `<title>` ist WCAG 2.4.2, und axe faellt darueber — aber der Grund steht
 * nicht in einer Regelnummer: wer mit einem Screenreader arbeitet, hoert den
 * Titel als Erstes, und „CSE Platform" auf jeder Seite sagt nur, dass man
 * irgendwo ist. Fuer eine Anmeldung ist das die schlechteste Stelle dafuer.
 */
export const metadata = { title: 'Anmeldung für Mitarbeitende — CSE Gruppe' };

export default async function MitarbeiterAnmeldung() {
  /**
   * **Ohne SMS-Gateway kann sich niemand anmelden, und das steht hier so da.**
   *
   * 01-ORDNERSTRUKTUR §11.3 schreibt diesen Fall ausdruecklich fest, statt ihn
   * jemanden entdecken zu lassen: ein nicht verbundener Adapter blockiert hier
   * ein ganzes Portal und nicht bloss eine Funktion. Der planerseitige
   * Check-in-Link (TIM-07) bleibt davon unberuehrt — er ist tokenisiert und
   * braucht keine Anmeldung, weshalb die Zeiterfassung nie an einem
   * SMS-Anbieter haengt.
   */
  const sms = smsDienst(devFlaechenAn());

  async function anfordern(daten: FormData): Promise<void> {
    'use server';
    const dienst = smsDienst(devFlaechenAn());
    const telefon = String(daten.get('telefon') ?? '');
    const { ip } = await herkunft(await headers());

    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      codeAnfordern(tx, telefon, dienst, ip)) as ReturnType<typeof codeAnfordern>);

    const keks = await cookies();
    /**
     * Die Nummer wandert in einen kurzlebigen `httpOnly`-Keks statt in die
     * URL. Eine Nummer in der Adresszeile steht im Verlauf, im Referer und im
     * Zugriffsprotokoll jedes Vermittlers dazwischen — und sie gehoert einem
     * Menschen, nicht einer Sitzung.
     *
     * Auch bei unbrauchbarer Eingabe wird er gesetzt: sonst waere das Ziel
     * der Weiterleitung die Auskunft, die diese Seite gerade nicht gibt.
     */
    keks.set(ANMELDUNG_TELEFON_COOKIE, telefon, anmeldeKeksOptionen());
    if (ergebnis.codeFuerEntwicklung === null) keks.delete(ANMELDUNG_DEV_COOKIE);
    else keks.set(ANMELDUNG_DEV_COOKIE, ergebnis.codeFuerEntwicklung, anmeldeKeksOptionen());

    redirect('/auth/mitarbeiter/code');
  }

  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-s5 p-s6">
      <h1 className="text-h1 text-text">Anmeldung für Mitarbeitende</h1>
      <p className="max-w-[60ch] text-base text-text-muted">
        Geben Sie Ihre Mobilnummer ein. Sie erhalten einen sechsstelligen Code
        per SMS. Ein Kennwort brauchen Sie nicht.
      </p>

      {!sms.verbunden && (
        <p
          data-cse="sms-nicht-verbunden"
          className="rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>SMS-Versand: nicht verbunden.</strong>{' '}
          Es ist kein Gateway hinterlegt (offene Frage O-82: welcher in der EU
          gehostete Anbieter mit Auftragsverarbeitungsvertrag, und ab welchem
          Monatsbetrag gilt ein harter Stopp).{' '}
          {sms.zeigtCode
            ? 'Auf dieser Entwicklungsfläche wird der Code stattdessen sichtbar angezeigt.'
            : 'Bis dahin kommt hier keine SMS an. Die Zeiterfassung läuft weiter über '
              + 'den Check-in-Link Ihrer Einsatzleitung, der ohne Anmeldung funktioniert.'}
        </p>
      )}

      <form action={anfordern} data-cse="anmeldung-telefon" className="flex flex-col gap-s4">
        <FormField
          label="Mobilnummer"
          name="telefon"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0170 1234567"
          hinweis="Deutsche Nummern mit 0 beginnend; ausländische mit + und Ländervorwahl."
        />
        <Button type="submit" variante="primary" data-cse="code-anfordern">
          Code anfordern
        </Button>
      </form>

      <p className="max-w-[60ch] text-sm text-text-subtle">
        Ihre Nummer wird ausschliesslich zur Anmeldung verwendet. Wenn sie
        hinterlegt ist, kommt gleich ein Code — ob sie es ist, sagt diese Seite
        bewusst nicht.
      </p>
    </main>
  );
}
