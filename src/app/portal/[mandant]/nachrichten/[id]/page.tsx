import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladeFaden, versandwege, type Faden } from '@/server/services/kern/nachricht';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../../unterseite';
import { kennungOder404 } from '../../../kennung';

/**
 * `/portal/[mandant]/nachrichten/[id]` — EIN Faden in Zeitfolge (EMP-11,
 * CRM-03, CRM-08, LEG-08).
 *
 * **`[id]` ist die `thread_id`, nicht die Kennung einer Nachricht.** Das muss
 * die Route festlegen: mit beiden Deutungen zeigten zwei Adressen denselben
 * Faden, und `rel=canonical` gibt es im Portal nicht.
 *
 * **Der UWG-Nachweis steht an der Zeile.** Bei einer ausgehenden Nachricht
 * sind `rechtsgrundlage` und `zweck` mitgeschrieben, und wo ein Agent schrieb,
 * steht die `freigabe_id` daneben (Invariante 7). Genau das fragt eine
 * Abmahnung — nicht, ob gesendet wurde, sondern warum es erlaubt war.
 *
 * **Öffnen stempelt per POST, nie per GET** (D-504). Ein Vorauslader würde
 * sonst den Posteingang von allein leeren. Deshalb steht hier ein Knopf „Als
 * gelesen markieren" und kein Effekt beim Rendern.
 *
 * **Anhänge stehen als Namen, nicht als Adressen.** Eine signierte URL
 * entsteht beim Klick und hat eine Frist; eine beim Rendern erzeugte stünde
 * bis zu ihrem Ablauf im Seitenquelltext (DOC-03).
 */
export const dynamic = 'force-dynamic';

const RICHTUNG_TEXT: Readonly<Record<string, string>> = {
  intern: 'intern', eingehend: 'eingehend', ausgehend: 'ausgehend',
};
const KANAL_TEXT: Readonly<Record<string, string>> = {
  portal: 'Portal', email: 'E-Mail', sms: 'SMS',
};
const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Einwilligung', bestandskunde: 'Bestandskunde',
  anfrage: 'eigene Anfrage', keine: 'keine',
};
const ZWECK_TEXT: Readonly<Record<string, string>> = {
  vertraglich: 'vertraglich', transaktional: 'transaktional',
  werbung: 'Werbung', intern: 'intern',
};
const ZUSTELL_TEXT: Readonly<Record<string, string>> = {
  ausstehend: 'noch nicht hinaus', gesendet: 'gesendet', zugestellt: 'zugestellt',
  fehlgeschlagen: 'fehlgeschlagen', unterdrueckt: 'unterdrückt',
};

function zeitpunkt(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
  }).format(d);
}

export default async function FadenSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id: roh } = await params;
  const threadId = kennungOder404(roh);
  const suche = await searchParams;
  const getan = typeof suche['getan'] === 'string' ? suche['getan'] : null;

  const tor = await mandantTor(`/portal/${mandant}/nachrichten/${threadId}`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => {
        const faden = await ladeFaden(kontext, threadId);
        if (faden === null) return null;
        /*
         * **Drei Rechte, drei verschiedene Fragen** (AUT-06, D-567).
         *
         * Antworten braucht `nachricht.versenden`. Der Anhangsverweis fuehrt
         * auf `/portal/<m>/dokumente/<id>`, und das verlangt
         * `dokument.lesen`; der Freigabebeleg auf `/portal/<m>/freigaben/<id>`
         * mit `freigabe.entscheiden`. Wer die beiden Rechte nicht hat, sieht
         * den NAMEN ohne Verweis — ein Link auf eine Seite, die diese Sitzung
         * nicht oeffnen darf, ist ein 404, der die Existenz dessen verraet,
         * was er nicht zeigen darf.
         *
         * Gefragt wird in DERSELBEN gebundenen Transaktion wie gelesen wird.
         */
        const [recht] = await kontext.abfrage<{
          versenden: boolean; dokument: boolean; freigabe: boolean;
        }>(
          `select app.hat_recht('nachricht.versenden', app.aktiver_mandant()) as versenden,
                  app.hat_recht('dokument.lesen', app.aktiver_mandant()) as dokument,
                  app.hat_recht('freigabe.entscheiden', app.aktiver_mandant()) as freigabe`);
        return {
          faden,
          darfAntworten: recht?.versenden === true,
          darfDokument: recht?.dokument === true,
          darfFreigabe: recht?.freigabe === true,
        };
      }),
  ) as Promise<{
    faden: Faden; darfAntworten: boolean; darfDokument: boolean; darfFreigabe: boolean;
  } | null>);

  if (daten === null) notFound();
  const { faden, darfAntworten, darfDokument, darfFreigabe } = daten;
  /*
   * **Der EIGENE Lesestand, nicht der von irgendwem.** Hier stand einmal
   * `faden.nachrichten.some((n) => n.empfaenger.some((e) => e.gelesenAm ===
   * null))` — und `ladeFaden` gibt im internen Portal ALLE Empfänger der
   * Gesellschaft heraus. Der Knopf erschien damit, solange irgendwer den
   * Faden nicht gelesen hatte; der POST traf null eigene Zeilen, und die
   * Seite meldete trotzdem „Gespeichert." Gezählt wird die Zahl, die der
   * Dienst mitbringt — dieselbe Bedingung wie in der Liste.
   */
  const ungelesen = faden.ungelesen > 0;
  const ohneVersand = versandwege().filter((w) => !w.verbunden);

  return (
    <PortalRahmen
      titel={faden.betreff ?? 'Faden'}
      wurzelTitel="Portal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/nachrichten`, text: 'Alle Nachrichten' }}
    >
      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{faden.betreff ?? 'Ohne Betreff'}</h1>
        {faden.geschlossenAm !== null && <StatusPill zustand="Abgeschlossen" />}
      </div>

      {getan !== null && (
        <Hinweis art={getan === 'gelesen_schon' ? 'hinweis' : 'erfolg'}
                 cse="getan" className="mb-s5 max-w-prose">
          {getan === 'gelesen_schon' ? (
            <>
              <strong>Nichts zu stempeln.</strong>{' '}
              Für Sie war dieser Faden schon gelesen — der Lesestand anderer
              Beteiligter bleibt ihr eigener.
            </>
          ) : (
            <>
              <strong>Gespeichert.</strong>{' '}
              {getan === 'gelesen'
                ? 'Die Zeilen bleiben stehen — gelesen heisst gestempelt, nicht gelöscht.'
                : getan === 'geschlossen'
                  ? 'Der Faden ist geschlossen. Gelöscht wird nichts (Invariante 8).'
                  : 'Die Änderung ist gespeichert.'}
            </>
          )}
        </Hinweis>
      )}

      <ol data-cse="faden" className="m-0 mb-s6 list-none p-0">
        {faden.nachrichten.map((n) => (
          <li key={n.id}
              data-cse="nachricht"
              data-richtung={n.richtung}
              data-kanal={n.kanal}
              className="mb-s4 rounded-lg border border-line bg-surface p-s5">
            <div className="flex flex-wrap items-baseline justify-between gap-s3">
              <p className="m-0 text-sm font-semibold text-text">
                {n.absender ?? 'Unbekannt'}
                {n.akteurArt === 'agent' && (
                  <span className="ml-s2 text-xs font-normal text-text-subtle">
                    (Agent)
                  </span>
                )}
              </p>
              <p className="m-0 flex flex-wrap items-center gap-s3 text-xs text-text-subtle">
                <span>
                  {`${RICHTUNG_TEXT[n.richtung] ?? n.richtung} · ${KANAL_TEXT[n.kanal] ?? n.kanal}`}
                </span>
                <time dateTime={n.erstelltAm.toISOString()}>{zeitpunkt(n.erstelltAm)}</time>
              </p>
            </div>

            {n.betreff === null ? null : (
              <p className="m-0 mt-s1 text-sm text-text-muted">{n.betreff}</p>
            )}

            <p className="mt-s3 max-w-prose whitespace-pre-line text-sm text-text">
              {n.koerper}
            </p>

            {n.anhaenge.length > 0 && (
              <ul data-cse="anhaenge" className="m-0 mt-s3 list-none p-0">
                {n.anhaenge.map((a) => (
                  <li key={a.dokumentId} className="text-sm">
                    {darfDokument ? (
                      <Link href={`/portal/${mandant}/dokumente/${a.dokumentId}`}
                            className="text-text underline underline-offset-2 hover:text-brand">
                        {a.titel ?? 'Anhang'}
                      </Link>
                    ) : (
                      <span data-cse="anhang-ohne-recht" className="text-text-muted">
                        {a.titel ?? 'Anhang'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {n.empfaenger.length > 0 && (
              <p className="m-0 mt-s3 text-xs text-text-subtle">
                {`An: ${n.empfaenger.map((e) => `${e.name ?? e.typ}${e.gelesenAm === null ? '' : ' (gelesen)'}`).join(', ')}`}
              </p>
            )}

            {/*
              * **Der § 7-UWG-Beleg, sichtbar an der Zeile.**
              *
              * Nicht in einem Protokoll, das niemand öffnet: wer den Faden
              * liest, sieht, auf welcher Grundlage gesendet wurde und — bei
              * einem Agentenentwurf — welche Freigabe es erlaubte. Genau das
              * ist die Frage einer Abmahnung.
              */}
            {n.richtung === 'ausgehend' && (
              <p data-cse="uwg-beleg"
                 className="m-0 mt-s3 border-t border-line pt-s3 text-xs text-text-muted">
                {`Rechtsgrundlage: ${n.rechtsgrundlage === null ? 'nicht aufgezeichnet' : GRUNDLAGE_TEXT[n.rechtsgrundlage] ?? n.rechtsgrundlage}`}
                {n.zweck === null ? '' : ` · Zweck: ${ZWECK_TEXT[n.zweck] ?? n.zweck}`}
                {n.freigabeId === null ? '' : ' · '}
                {n.freigabeId === null ? null : darfFreigabe ? (
                  <Link href={`/portal/${mandant}/freigaben/${n.freigabeId}`}
                        data-cse="freigabe-beleg"
                        className="underline underline-offset-2 hover:text-text">
                    Freigabe ansehen
                  </Link>
                ) : (
                  <span data-cse="freigabe-ohne-recht">freigegeben</span>
                )}
                {` · ${ZUSTELL_TEXT[n.zustellStatus] ?? n.zustellStatus}`}
                {n.gesendetAm === null ? '' : ` (${zeitpunkt(n.gesendetAm)})`}
                {n.zustellFehler === null ? '' : ` · Fehler: ${n.zustellFehler}`}
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-s4">
        {ungelesen && (
          <form method="post" action={`/api/nachrichten?mandant=${mandant}`}>
            <input type="hidden" name="was" value="gelesen" />
            <input type="hidden" name="id" value={faden.threadId} />
            <Button type="submit" variante="secondary" data-cse="gelesen">
              Als gelesen markieren
            </Button>
          </form>
        )}
        {faden.geschlossenAm === null ? (
          <form method="post" action={`/api/nachrichten?mandant=${mandant}`}>
            <input type="hidden" name="was" value="schliessen" />
            <input type="hidden" name="id" value={faden.threadId} />
            <Button type="submit" variante="ghost" data-cse="schliessen">
              Faden schliessen
            </Button>
          </form>
        ) : (
          <form method="post" action={`/api/nachrichten?mandant=${mandant}`}>
            <input type="hidden" name="was" value="oeffnen" />
            <input type="hidden" name="id" value={faden.threadId} />
            <Button type="submit" variante="ghost" data-cse="wieder-oeffnen">
              Wieder öffnen
            </Button>
          </form>
        )}
      </div>

      {faden.geschlossenAm !== null ? (
        <Hinweis art="hinweis" cse="faden-geschlossen" className="mt-s5">
          <strong>Dieser Faden ist geschlossen.</strong>{' '}
          Gelöscht wird nichts: der Schriftverkehr bleibt als Nachweis stehen
          (Invariante 8).
        </Hinweis>
      ) : darfAntworten ? (
        <section aria-labelledby="antworten" className="mt-s6">
          <h2 id="antworten" className="text-h2 text-text">Antworten</h2>
          <form
            method="post"
            action={`/api/nachrichten?mandant=${mandant}`}
            className="mt-s3 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="was" value="antworten" />
            <input type="hidden" name="id" value={faden.threadId} />
            <label className="block text-sm text-text" htmlFor="koerper">Text</label>
            <textarea
              id="koerper" name="koerper" rows={3} required
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />
            <Button type="submit" variante="primary" data-cse="antworten" className="mt-s4">
              Antwort absenden
            </Button>
            <p className="m-0 mt-s3 text-xs text-text-subtle">
              Die Antwort bleibt im Portal und geht an die Beteiligten dieses
              Fadens.
              {ohneVersand.length === 0 ? '' : ' Ein Weg nach draussen ist nicht verbunden.'}
            </p>
          </form>
        </section>
      ) : (
        <p data-cse="antworten-fehlt" className="mt-s5 text-sm text-text-muted">
          Zum Antworten fehlt das Recht <code>nachricht.versenden</code>.
        </p>
      )}
    </PortalRahmen>
  );
}
