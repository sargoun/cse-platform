import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { db } from '@/server/db/pool';
import { Button } from '@/components/ui/Button';
import { AuthSchale } from '../AuthSchale';
import { FormField } from '@/components/ui/FormField';
import { codeAnfordern } from '@/server/auth/mitarbeiter-anmeldung';
import { smsDienst } from '@/server/auth/sms';
import { keksSicher } from '@/server/auth/sitzung';
import { GeraeteSprachwahl } from '@/components/sprache/GeraeteSprachwahl';
import { geraeteSprache, SPRACH_KEKS } from '@/lib/i18n/geraetesprache';
import type { PortalSprache } from '@/lib/i18n/texte';
import { ANMELDUNG_TEXTE } from '@/lib/i18n/vor-anmeldung';
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
 * Und er steht in der Sprache der Seite (V-200).
 */
export async function generateMetadata(): Promise<{ title: string }> {
  return { title: ANMELDUNG_TEXTE[await spracheDesGeraets()].seitentitel };
}

/**
 * **Die Sprache dieser Seite kommt vom GERÄT** (V-200, D-694, SEITENKARTE
 * §12): der Sprachkeks, dann `Accept-Language`, dann Deutsch. Vor der
 * Anmeldung gibt es keinen Menschen, dessen `person.sprache` gälte.
 */
async function spracheDesGeraets(): Promise<PortalSprache> {
  const keks = (await cookies()).get(SPRACH_KEKS)?.value;
  return geraeteSprache(keks, (await headers()).get('accept-language'));
}

export default async function MitarbeiterAnmeldung(
  { searchParams }: {
    readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  /*
   * **Warum hier ueberhaupt ein Fehler ankommen kann.** Der zweite Schritt
   * wirft hierher zurueck, wenn der Keks mit der Nummer fehlt — und das tat er
   * bisher STUMM. Wer das erlebt, hat gerade Nummer und Code eingetippt und
   * steht ohne ein Wort wieder am Anfang.
   */
  const suche: Record<string, string | string[] | undefined> =
    searchParams === undefined ? {} : await searchParams;
  const abgelaufen = suche['fehler'] === 'abgelaufen';
  const sprache = await spracheDesGeraets();
  const t = ANMELDUNG_TEXTE[sprache];
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
  /** Weder Versand noch Anzeige: der Code kommt von der Einsatzleitung (D-487). */
  const ohneZustellung = !sms.verbunden && !sms.zeigtCode;

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
    <AuthSchale
      titel={t.titel}
      schritt={1}
      schritte={2}
      unterzeile={ohneZustellung ? t.unterzeileOhneZustellung : t.unterzeileSms}
      sprache={sprache}
      beschriftung={t}
      sprachwahl={
        <GeraeteSprachwahl aktiv={sprache} zurueck="/auth/mitarbeiter" label={t.sprachwahl} />
      }
    >

      {/*
        * Die Kästen dieser Seite in 16 px (DESIGN §8): sie stehen auf einer
        * Fläche der Beschäftigten, und ihre Sätze sind Fliesstext (V-200).
        */}
      {abgelaufen && (
        <p
          data-cse="anmeldung-abgelaufen"
          className="rounded-md border border-warning bg-warning-soft p-s4 text-base text-warning"
        >
          <strong>{t.abgelaufenTitel}</strong>{' '}
          {t.abgelaufenText}
        </p>
      )}

      {!keksSicher() && (
        /*
         * **Was hier steht, ist eine Tatsache ueber DIESE Installation.**
         *
         * Auf einer Vorfuehrflaeche (`CSE_DEV_FLAECHEN=1`) laufen die
         * Anmeldekekse ohne `Secure`, damit die Anmeldung ueber
         * `http://192.168…` am Telefon ueberhaupt funktioniert. Das ist die
         * richtige Entscheidung fuer eine Demo und die falsche fuer den
         * Ernstfall — also steht sie auf dem Bildschirm und nicht nur in einer
         * Umgebungsvariablen, die niemand liest.
         */
        <p
          data-cse="keks-ohne-secure"
          className="rounded-md border border-line bg-surface p-s4 text-base text-text-muted"
        >
          <strong>{t.vorfuehrTitel}</strong>{' '}
          {t.vorfuehrText}
        </p>
      )}

      {!sms.verbunden && (
        <p
          data-cse="sms-nicht-verbunden"
          className="rounded-md border border-warning bg-warning-soft p-s4 text-base text-warning"
        >
          <strong>{t.smsTitel}</strong>{' '}
          {t.smsText}{' '}
          {sms.zeigtCode ? t.smsEntwicklung : t.smsOhne}
        </p>
      )}

      <form action={anfordern} data-cse="anmeldung-telefon" className="flex flex-col gap-s4">
        <FormField
          label={t.mobilnummer}
          name="telefon"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="0170 1234567"
          hinweis={t.mobilHinweis}
          /* Eine Nummer liest sich von links nach rechts — auch auf Arabisch. */
          dir="ltr"
        />
        <Button type="submit" variante="primary" data-cse="code-anfordern">
          {ohneZustellung ? t.weiterZurCodeeingabe : t.codeAnfordern}
        </Button>
      </form>

      <p className="max-w-[60ch] text-base text-text-subtle">
        {t.nummerNurZurAnmeldung}{' '}
        {ohneZustellung ? t.nummerOhneAuskunft : t.nummerMitSms}{' '}
        {t.datenschutzHinweis}
      </p>
      {/*
        * Verbindlich ist die deutsche Datenschutzerklärung (D-84); die
        * englische Website-Fassung sagt das selbst, Arabisch und Türkisch
        * haben keine und führen deshalb auf die deutsche (V-200).
        */}
      <a href={sprache === 'en' ? '/en/datenschutz' : '/datenschutz'}
         data-cse="anmeldung-datenschutz"
         className="inline-flex min-h-11 items-center self-start text-base text-text underline
                    underline-offset-4">
        {t.datenschutzLink}
      </a>
    </AuthSchale>
  );
}
