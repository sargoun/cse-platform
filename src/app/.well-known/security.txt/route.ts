import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { einstellungLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import {
  SCHLUESSEL_KONTAKT, SCHLUESSEL_RICHTLINIE, sicherheitTxt,
} from '@/server/services/inhalt/sicherheit-txt';

/**
 * `/.well-known/security.txt` (RFC 9116, neben SEC-A7).
 *
 * **Sie antwortet 404, solange kein Postfach benannt ist — und das ist der
 * Kern der Route, nicht ihr Mangel.** `04-SEITENKARTE.md` §2.5: „a contact
 * address nobody reads is worse than no file at all." Eine ausgedachte
 * Adresse waere die vorgetaeuschte Anbindung, die CLAUDE.md ausschliesst; ein
 * 404 sagt die Wahrheit — es gibt diesen Weg noch nicht.
 *
 * **Bewusst offen** (siehe `route-manifest.ts`): eine `.well-known`-Datei
 * hinter einer Anmeldung erfuellt ihren Zweck nicht. Sie enthaelt nur, was
 * ohnehin veroeffentlicht werden soll — eine Kontaktadresse und ein
 * Ablaufdatum.
 *
 * `force-dynamic`, wie bei `robots` und `llms.txt`: `Expires` ist nach §2.5.5
 * Pflicht und wird bei jedem Abruf aus der Serveruhr gesetzt. Eine beim Build
 * eingefrorene Datei laeuft irgendwann ab und wird dann von Werkzeugen
 * verworfen.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const basis = await basisAusAnfrage();

  const { kontakt, richtlinie } = await oeffentlichLesen(async (k) => ({
    kontakt: await einstellungLesen(k, SCHLUESSEL_KONTAKT),
    richtlinie: await einstellungLesen(k, SCHLUESSEL_RICHTLINIE),
  }));

  const text = sicherheitTxt(
    typeof kontakt === 'string' && kontakt !== ''
      ? { kontakt, richtlinie: typeof richtlinie === 'string' ? richtlinie : null }
      : null,
    basis,
    new Date(),
  );

  if (text === null) {
    /*
     * 404 und kein leerer 200: eine leere Datei mit Status 200 ist fuer ein
     * Pruefwerkzeug eine GUELTIGE security.txt ohne Pflichtfelder — also ein
     * Befund, der nach Nachlaessigkeit aussieht, wo eine offene
     * Kundenentscheidung steht (O-35).
     */
    return new Response('', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(text, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
