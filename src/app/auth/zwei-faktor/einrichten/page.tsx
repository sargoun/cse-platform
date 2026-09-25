import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type postgres from 'postgres';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { qrSvg } from '@/lib/qr';
import { anfrageAdresse } from '@/server/auth/adresse';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import {
  bestaetigeFaktorMitToken, gibWiederherstellungscodesAus, hebeAufAal2, pruefeFaktor,
  leseKennwortToken, richteFaktorEin, richteFaktorMitTokenEin, sichererRueckweg,
} from '@/server/auth/kennwort-anmeldung';
import { SITZUNG_COOKIE } from '@/server/auth/sitzung';
import { bindeAnfrage } from '@/server/kontext';
import { db } from '@/server/db/pool';
import { AuthFehler, AuthSchale } from '../../AuthSchale';

/**
 * `/auth/zwei-faktor/einrichten` — Enrolment, erzwungen vor allem anderen
 * (AUT-02).
 *
 * **Das Geheimnis entsteht bei jedem Aufruf neu und wird sofort abgelegt.**
 * Es in der Seite zu halten und erst beim Absenden zu speichern hiesse, es
 * durch ein verstecktes Feld zu schicken — durch den Browser, durch jedes
 * Protokoll dazwischen. `app.faktor_anlegen` legt es unbestaetigt ab; erst der
 * richtige Code bestaetigt es. Ein abgebrochener Versuch hinterlaesst deshalb
 * nichts Benutzbares.
 *
 * **Der QR-Code wird hier gerechnet** (`src/lib/qr.ts`), nicht von einem Dienst
 * geladen. Ein Bild von aussen traegt das Geheimnis in der Adresszeile dorthin.
 *
 * **Die Wiederherstellungscodes kommen mit der Bestaetigung, nicht davor.**
 * Vorher waeren es Codes fuer einen Faktor, den es vielleicht nie gibt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Zweiten Faktor einrichten — CSE Gruppe' };

const CODES_ANZAHL = 10;

export default async function FaktorEinrichten({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const falsch = p['fehler'] === 'code';
  const ziel = sichererRueckweg(p['weiter']);

  /**
   * **Zwei Ausweise, eine Seite.**
   *
   * Im Regelfall ist es die Sitzung: das Konto ist angemeldet (`aal1`) und
   * holt den zweiten Faktor nach. Bei einer EINLADUNG gibt es aber keine —
   * das Konto ist noch nicht `aktiv`, und `app.sitzung_aufloesen` gibt fuer
   * ein nicht aktives Konto null Zeilen. Dann weist der Einladungstoken aus,
   * und derselbe Abschluss aktiviert das Konto (`0155`).
   *
   * Eine zweite Seite dafuer waere ein zweiter Ablauf, von dem genau einer
   * gepflegt wird — und der Bildschirm ist in beiden Faellen derselbe.
   */
  const einladung = typeof p['token'] === 'string' && p['token'] !== '' ? p['token'] : null;

  const sitzung = einladung === null ? await aktuelleSitzung() : null;
  if (einladung === null && sitzung === null) redirect('/auth/login');

  const einrichtung = await (db().begin(async (tx: postgres.TransactionSql) => {
    if (einladung !== null) {
      const inhalt = await leseKennwortToken(tx, einladung);
      if (inhalt === null) return null;
      return richteFaktorMitTokenEin(tx, einladung, inhalt.email ?? inhalt.name);
    }
    await bindeAnfrage(tx, sitzung!);
    const konto = (await tx.unsafe(
      `select coalesce(b.email, b.name) as kennung from benutzer b where b.id = $1::uuid`,
      [sitzung!.benutzerId],
    )) as { kennung: string }[];
    return richteFaktorEin(tx, konto[0]?.kennung ?? 'Konto');
  }) as ReturnType<typeof richteFaktorEin>);

  // `null` heisst: es gibt schon einen bestaetigten Faktor — oder der
  // Einladungslink gilt nicht mehr. Beide Male ist diese Seite die falsche.
  if (einrichtung === null) redirect(einladung === null ? '/auth/zwei-faktor/pruefen' : '/auth/login');

  async function bestaetigen(daten: FormData): Promise<void> {
    'use server';
    const code = String(daten.get('code') ?? '');
    const weiter = String(daten.get('weiter') ?? '');
    const einladungstoken = String(daten.get('token') ?? '');

    if (einladungstoken !== '') {
      /* SEC-A9 (V-167): die Adresse fuer `auth.zweiter_faktor_eingerichtet` — ohne Sitzung. */
      const ip = anfrageAdresse(await headers());
      const wer = await (db().begin(async (tx: postgres.TransactionSql) =>
        bestaetigeFaktorMitToken(tx, einladungstoken, code, ip)) as Promise<string | null>);
      if (wer === null) {
        redirect(`/auth/zwei-faktor/einrichten?fehler=code&token=${encodeURIComponent(einladungstoken)}`);
      }
      /**
       * **Keine Wiederherstellungscodes an dieser Stelle.** Sie werden ueber
       * `app.wiederherstellungscodes_setzen` an das GEBUNDENE Konto
       * geschrieben, und gebunden ist hier keines — der Ausweis war der
       * Token. Der Eingeladene meldet sich jetzt zum ersten Mal an; die
       * Codes holt er unter Konto → Sicherheit.
       */
      redirect('/auth/login?eingerichtet=1');
    }

    const token = (await cookies()).get(SITZUNG_COOKIE)?.value ?? '';
    const aktuell = await aktuelleSitzung();
    if (aktuell === null || token === '') redirect('/auth/login');

    const codes = await (db().begin(async (tx: postgres.TransactionSql) => {
      await bindeAnfrage(tx, aktuell);
      // `false`: beim Einrichten ist der Faktor noch unbestaetigt — genau
      // dieser Aufruf bestaetigt ihn.
      if (!await pruefeFaktor(tx, code, false)) return null;
      await hebeAufAal2(tx, token);
      return gibWiederherstellungscodesAus(tx, CODES_ANZAHL);
    }) as Promise<readonly string[] | null>);

    if (codes === null) {
      const ab = weiter === '' ? '' : `&weiter=${encodeURIComponent(weiter)}`;
      redirect(`/auth/zwei-faktor/einrichten?fehler=code${ab}`);
    }
    const q = new URLSearchParams({ codes: codes.join(' ') });
    const sicher = sichererRueckweg(weiter);
    if (sicher !== null) q.set('weiter', sicher);
    redirect(`/auth/zwei-faktor/wiederherstellung?${q.toString()}`);
  }

  const gruppen = einrichtung.geheimnis.match(/.{1,4}/gu) ?? [];

  return (
    <AuthSchale
      titel="Zweiten Faktor einrichten"
      schritt={2}
      schritte={2}
      unterzeile={einladung === null
        ? 'Ihre Rolle verlangt eine zweite Stufe bei der Anmeldung. Das ist einmalig '
          + 'eingerichtet und dauert eine Minute.'
        : 'Ihr Kennwort steht. Ihre Rolle verlangt noch eine zweite Stufe — damit ist Ihr '
          + 'Zugang eingerichtet.'}
    >
      {falsch && (
        <AuthFehler cse="einrichten-fehler">
          Der Code stimmt nicht. Prüfen Sie, ob die Uhrzeit auf Ihrem Telefon automatisch
          gestellt wird — eine falsch gehende Uhr ist die häufigste Ursache.
        </AuthFehler>
      )}

      <Card className="flex flex-col gap-s4">
        <h2 className="text-h2 text-text">1. Code scannen</h2>
        <p className="text-sm text-text-muted">
          Öffnen Sie eine Authenticator-App — etwa Aegis, 2FAS, Google Authenticator oder
          den Passwortmanager, den Sie ohnehin nutzen — und scannen Sie dieses Bild.
        </p>
        <div
          data-cse="faktor-qr"
          className="mx-auto w-full max-w-[240px] rounded-md border border-line bg-white p-s4"
          /*
           * Das SVG ist im eigenen Haus gerechnet und enthaelt nur `rect` und
           * `path` — kein Skript, kein Verweis nach aussen. Deshalb ist es hier
           * unbedenklich; ein `<img src>` mit `data:`-URI waere fuer die Kamera
           * unschaerfer und fuer den Screenreader stumm.
           */
          dangerouslySetInnerHTML={{ __html: qrSvg(einrichtung.adresse) }}
          aria-hidden="true"
        />
        <details className="text-sm text-text-muted">
          <summary className="min-h-11 cursor-pointer select-none py-s2 underline
                              underline-offset-4">
            Kamera geht nicht? Schlüssel von Hand eingeben
          </summary>
          <p className="pt-s3">Tippen Sie diesen Schlüssel in Ihre App ein:</p>
          <p data-cse="faktor-geheimnis"
             className="mt-s2 select-all break-all rounded-md border border-line bg-surface-3
                        p-s4 font-mono text-base tracking-wider text-text">
            {gruppen.join(' ')}
          </p>
          <p className="pt-s2 text-xs text-text-subtle">
            Typ: zeitbasiert (TOTP) · 6 Stellen · 30 Sekunden · SHA-1
          </p>
        </details>
      </Card>

      <Card className="flex flex-col gap-s4">
        <h2 className="text-h2 text-text">2. Einmal bestätigen</h2>
        <form action={bestaetigen} data-cse="faktor-einrichten" className="flex flex-col gap-s4">
          <input type="hidden" name="weiter" value={ziel ?? ''} />
          <input type="hidden" name="token" value={einladung ?? ''} />
          <FormField
            label="Code aus der App"
            name="code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            required
            className="font-mono text-h2 tracking-[0.4em]"
          />
          <Button type="submit" variante="primary" data-cse="faktor-abschliessen">
            Einrichten abschliessen
          </Button>
        </form>
      </Card>

      <Hinweis art="hinweis" cse="faktor-warum">
        <strong>Warum diese Stufe.</strong> Dieses Konto kommt an Lohn-, Zeit- und
        Finanzdaten dreier Gesellschaften. Ein Kennwort allein schützt sie nicht, wenn es
        einmal woanders auftaucht.
      </Hinweis>
    </AuthSchale>
  );
}
