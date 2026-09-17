import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';

/**
 * `/werbewiderspruch/[token]` — der Ein-Klick-Widerspruch aus einer
 * ausgehenden Werbenachricht (§ 7 Abs. 3 Nr. 4 UWG, CRM-08, LEG-08,
 * `04-SEITENKARTE.md` §2.4).
 *
 * **Die Seite ist bewusst arm.** Sie nennt keinen Namen, keine Adresse und
 * keine Firma, BEVOR etwas passiert ist: der Link ist ein Trägergeheimnis, und
 * eine Seite, die aus ihm Personendaten macht, gibt sie an jeden weiter, der
 * ihn in einem Browserverlauf, einem Mailarchiv oder einem Proxyprotokoll
 * findet.
 *
 * **Ein POST, kein GET.** Ein Widerspruch, den ein GET auslöst, wird von einem
 * Mailscanner, einem Linkprüfer und jedem Vorschaubilddienst ausgelöst — also
 * von einer Maschine im Namen eines Menschen, der nichts gedrückt hat. Deshalb
 * zeigt diese Seite einen Knopf und stempelt nichts. Gestempelt wird in
 * `POST /api/werbewiderspruch` über `app.werbewiderspruch_einloesen` (0222),
 * bedingt und idempotent (K-09).
 *
 * **Der GET verrät nichts.** Für JEDEN formgültigen Token erscheint dieselbe
 * Seite — auch für einen erfundenen. Ob es den Token gibt, sagt erst der POST,
 * und der braucht eine Handlung. Ein 404 für einen unbekannten Token wäre ein
 * Orakel für jeden, der raten will.
 *
 * **Der zweite Klick ist kein Fehler**, sondern „ist bereits erfasst" (§2.4).
 * Eine Fehlerseite auf einem gesetzlichen Pflichtweg wäre ein Widerspruch, der
 * nicht ankam — und der Empfänger hat den Beweis in der Hand, dass er geklickt
 * hat.
 *
 * **Vertragliche Post läuft weiter**, und das steht dabei: ein
 * Werbewiderspruch stoppt Werbung. Rechnungen, Leistungsnachweise und
 * Mahnungen desselben Vertrages kommen weiter — wer das anders will, braucht
 * den Widerspruch nach Art. 21 DSGVO, und das ist ein anderer Weg.
 */
export const dynamic = 'force-dynamic';

/**
 * `noindex, nofollow` — und `robots.txt` sperrt `/werbewiderspruch/`
 * zusätzlich (`AUSGESCHLOSSEN`). Die Adresse TRÄGT das Geheimnis: sie in einen
 * Index zu bekommen hiesse, den Widerspruch eines Fremden erklärbar zu machen.
 */
export const metadata: Metadata = {
  title: 'Werbewiderspruch',
  robots: { index: false, follow: false },
};

/**
 * Die FORM eines Tokens, nicht seine Gültigkeit.
 *
 * `neuerToken()` in `services/datenschutz/werbewiderspruch.ts` erzeugt 32
 * Byte als base64url — 43 Zeichen. Geprüft wird hier nur das Alphabet und eine
 * grosszügige Länge: was gar kein Token sein KANN, ist 404 (die Form ist
 * verletzt), alles andere geht an den Handler. Eine engere Prüfung wäre eine
 * zweite Definition des Tokenformats neben der, die ihn ausgibt — und die
 * beiden liefen beim ersten Wechsel der Länge auseinander.
 */
const TOKEN_FORM = /^[A-Za-z0-9_-]{20,200}$/u;

const STAENDE = new Set(['erfasst', 'bereits', 'unbekannt']);

/**
 * **Der Hinweistext nach § 7 Abs. 3 Nr. 4 UWG — ein PLATZHALTER.**
 *
 * Was hier steht, ist Rechtstext: das Gesetz verlangt einen „klaren und
 * deutlichen" Hinweis, und welche Formulierung das erfüllt, sagt eine
 * anwaltliche Prüfung und nicht diese Datei. Ihn zu erfinden verstiesse gegen
 * „Never invent a business rule" — an genau der Stelle, an der ein falscher
 * Satz eine Abmahnung kostet. Er steht deshalb sichtbar als „vorläufig" auf
 * dem Bildschirm, statt geprüft auszusehen.
 *
 * // TODO(client, O-34): Geprüfter Wortlaut des Hinweises nach § 7 Abs. 3 Nr. 4 UWG und die Ausgangsmatrix (welcher Zweck auf welchem Kanal bei welcher Rechtsgrundlage).
 */
const UWG_HINWEIS = 'Sie erhalten Werbung von uns, weil eine Geschäftsbeziehung '
  + 'oder eine Einwilligung vorliegt. Der Verwendung Ihrer Adresse für Werbung '
  + 'können Sie jederzeit widersprechen, ohne dass andere Kosten als die '
  + 'Übermittlungskosten entstehen.';

export default async function Seite(
  { params, searchParams }: {
    params: Promise<{ token: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { token } = await params;
  // Eine Adresse, die gar kein Token sein kann, ist 404 — nicht weil sie
  // unbekannt ist, sondern weil sie die Form verletzt (AUT-06).
  if (!TOKEN_FORM.test(token)) notFound();

  const suche = await searchParams;
  const roh = typeof suche['stand'] === 'string' ? suche['stand'] : null;
  const stand = roh !== null && STAENDE.has(roh) ? roh : null;

  return (
    <main className="mx-auto w-full max-w-content px-s4 py-s6" data-cse="werbewiderspruch">
      <h1 className="mb-s4 mt-0 text-h1 text-text">Keine Werbung mehr</h1>

      {stand === 'erfasst' && (
        <Hinweis art="erfolg" cse="widerspruch-erfasst" className="mb-s5 max-w-prose">
          <strong>Ihr Widerspruch ist erfasst.</strong>{' '}
          Werbung an diese Adresse wird gestoppt. Vertragliche Post —
          Rechnungen, Leistungsnachweise, Mahnungen — erreicht Sie weiter; dafür
          ist ein Widerspruch nach Art. 21 DSGVO nötig, und den nehmen wir über
          das Datenschutzformular entgegen.
        </Hinweis>
      )}

      {stand === 'bereits' && (
        <Hinweis art="hinweis" cse="widerspruch-bereits" className="mb-s5 max-w-prose">
          <strong>Ist bereits erfasst.</strong>{' '}
          Für diesen Link ist nichts weiter zu tun — Werbung an diese Adresse
          ist gestoppt. Ein zweiter Klick ändert daran nichts und ist kein
          Fehler.
        </Hinweis>
      )}

      {stand === 'unbekannt' && (
        <Hinweis art="hinweis" cse="widerspruch-unbekannt" className="mb-s5 max-w-prose">
          <strong>Zu diesem Link liegt kein Vorgang vor.</strong>{' '}
          Möglicherweise ist er nicht vollständig übernommen worden. Wenn Sie
          keine Werbung mehr erhalten möchten, genügt eine Nachricht an die im
          Impressum genannte Adresse — der Widerspruch gilt dann genauso.
        </Hinweis>
      )}

      {stand === null && (
        <>
          <p className="m-0 mb-s5 max-w-prose text-base text-text">
            Mit einem Klick widersprechen Sie der Verwendung Ihrer Adresse für
            Werbung. Wir halten dann den Zeitpunkt und den Weg fest, über den der
            Widerspruch kam — mehr nicht, und nur als Nachweis.
          </p>

          {/*
            * **Ein Formular, kein Verweis.** Der Klick ändert Zustand; ein
            * GET, das das täte, würde von einem Mailscanner ausgelöst.
            */}
          <form method="post" action="/api/werbewiderspruch" className="mb-s6">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variante="primary" data-cse="widersprechen">
              Keine Werbung mehr an mich
            </Button>
          </form>

          <p className="m-0 mb-s5 max-w-prose text-sm text-text-muted">
            Vertragliche Post läuft weiter: Rechnungen, Leistungsnachweise und
            Mahnungen erreichen Sie auch nach diesem Widerspruch. Wenn Sie der
            Verarbeitung insgesamt widersprechen möchten (Art. 21 DSGVO), nutzen
            Sie bitte das Datenschutzformular.
          </p>
        </>
      )}

      <section data-cse="uwg-hinweis"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 className="mt-0 text-h2 text-text">Hinweis nach § 7 UWG</h2>
        <p className="m-0 text-sm text-text">{UWG_HINWEIS}</p>
        <p className="m-0 mt-s3 text-xs text-warning" data-cse="platzhalter">
          Vorläufiger Wortlaut — die anwaltliche Prüfung steht aus (offen O-34).
        </p>
      </section>
    </main>
  );
}
