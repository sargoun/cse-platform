import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  type BeitragKanalZeile, type BeitragZeile, type KanalZeile,
  kanaeleZuBeitrag, ladeBeitrag, listeKanaele,
} from '@/server/services/social/dienst';
import { PLATTFORM_NAME, type Plattform } from '@/server/services/social/port';
import {
  SCHRITT_TEXT, STATUS_TEXT, type Schritt, darfBearbeiten, moeglicheSchritte,
  naechsterStatus,
} from '@/server/services/social/weg';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/social/posts/[id]` — der Beitrag und sein Stand
 * (SOC-03, SOC-07, SOC-08).
 *
 * **Die Knöpfe kommen aus derselben Regel wie der Dienst** (`weg.ts`). Eine
 * Oberfläche, die einen Knopf zeigt, den der Dienst abweist, ist ein
 * Fehlerbericht mit Verzögerung — und eine, die einen verschweigt, den er
 * erlaubt, lässt jemanden einen Umweg suchen, den es nicht gibt.
 *
 * **Freigeben und Ablehnen stehen NICHT hier.** Sie fallen im
 * Freigabe-Posteingang, wo die Entscheidung protokolliert und verkettet wird
 * (APR-02, K-13). Ein zweiter Knopf dafür wäre ein zweiter Weg zur selben
 * Entscheidung — und der eine ohne Kette.
 *
 * **Je Kanal steht sein Ergebnis.** „nicht verbunden" ist eine Auskunft, kein
 * Fehler; „veröffentlicht" steht nur da, wo wirklich etwas ankam (SOC-07).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const ARTEN: readonly { readonly wert: string; readonly text: string }[] = [
  { wert: 'beitrag', text: 'Beitrag' },
  { wert: 'projektschau', text: 'Projektschau' },
  { wert: 'neuigkeit', text: 'Neuigkeit' },
  { wert: 'aktualisierung', text: 'Aktualisierung' },
];

const ERGEBNIS: Readonly<Record<string, { readonly pill: 'Aktiv' | 'Wartet' | 'Inaktiv' | 'Überfällig'; readonly text: string }>> = {
  offen: { pill: 'Wartet', text: 'wartet auf die Veröffentlichung' },
  veroeffentlicht: { pill: 'Aktiv', text: 'veröffentlicht' },
  nicht_verbunden: { pill: 'Inaktiv', text: 'nicht verbunden — nichts ging hinaus' },
  fehlgeschlagen: { pill: 'Überfällig', text: 'fehlgeschlagen' },
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

/**
 * Die Saetze zu den Abweisungen der Routen — **auf DIESER Seite, nicht als
 * JSON auf einer weissen.**
 *
 * Die Routen warfen ihren `SocialFehler` bisher als `{"fehler":"…"}` zurueck,
 * fuer jeden Aufrufer gleich. Ein Formular hat damit den Menschen verloren.
 * Jetzt kommt der Schluessel als `?fehler=` zurueck, und der Satz steht hier —
 * dieselbe Form wie auf der Planungsseite.
 *
 * **Der Schluessel wird ABGEBILDET, nicht angezeigt.** Wer den Satz aus der
 * Adresszeile nehmen liesse, koennte jemandem einen Link schicken, auf dem im
 * eigenen Portal ein fremder Text steht.
 */
const FEHLER: Readonly<Record<string, string>> = {
  falscher_status: 'Aus dem jetzigen Zustand führt dieser Schritt nicht weiter. '
    + 'Vermutlich hat jemand anderes den Beitrag inzwischen weitergeschoben — '
    + 'laden Sie die Seite neu.',
  gleichzeitig: 'Jemand anderes war einen Augenblick schneller. Der Beitrag steht '
    + 'jetzt anders da als beim Öffnen dieser Seite; laden Sie sie neu.',
  /*
   * Bis D-585 bekam dieser Fall den Satz von `gleichzeitig` — und der schickte
   * den Menschen zum Neuladen, wo ihm ein RECHT fehlt. Neu laden zeigt
   * denselben Zustand, er versucht es wieder, und nichts erklärt ihm, warum.
   */
  kein_recht: 'Dieser Schritt verlangt zusätzlich das Recht, Beiträge zu bearbeiten '
    + '(social.schreiben). Am Beitrag hat sich nichts geändert.',
  grund_fehlt: 'Ein Rückzug ohne Grund ist keine Auskunft — er steht im Protokoll, '
    + 'und jemand wird danach fragen.',
  nicht_bearbeitbar: 'Bearbeitet wird nur der Entwurf. Nach dem Vorlegen bindet die '
    + 'Freigabe an genau diesen Text; über „Überarbeiten" geht er zurück.',
  nichts_zu_tun: 'Kein Kanal steht auf „fehlgeschlagen" — es gibt nichts zu wiederholen.',
  quelle_unzulaessig: 'Diese Quelle lässt sich nicht übernehmen.',
  unvollstaendig: 'Titel und Text sind Pflicht.',
  unbekannter_schritt: 'Diesen Schritt geht die Route nicht. Freigeben und Ablehnen '
    + 'fallen im Freigabe-Posteingang.',
  kein_schreibrecht: 'Der Schreibvorgang ging nicht durch. Fehlt Ihnen das Recht dazu, '
    + 'sagt es Ihnen die Person, die Ihre Rolle vergeben hat.',
  keine_serverzeit: 'Die Uhr des Servers war nicht zu lesen. Bitte noch einmal versuchen.',
};

export default async function Beitrag(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/social/posts/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  /*
   * `/freigaben/[id]` verlangt `freigabe.entscheiden` (Manifest); diese Seite
   * öffnet mit `social.lesen`. Wer vorlegt, aber nicht entscheidet, sah „Zur
   * Freigabe" mit einem 404 dahinter (AUT-06). Der Hinweis, DASS der Beitrag
   * im Posteingang liegt, bleibt für alle; nur der Weg hängt am Recht.
   * Gemeldet von der Copilot-Runde auf PR 16.
   */
  const darf = await haeltRechte(zugang.sitzung, 'freigabe.entscheiden', 'social.schreiben');
  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  /**
   * Der Rueckweg, den die Routen bei einer Abweisung nehmen.
   *
   * Er steht als verstecktes Feld in jedem Formular dieser Seite und wird von
   * `internesZiel` (D-562) noch einmal gegen den eigenen Ursprung geprueft —
   * das Feld kommt aus dem Rumpf, also vom Aufrufer.
   */
  const hierher = `/portal/${mandant}/social/posts/${id}`;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      beitrag: await ladeBeitrag(kontext, id),
      kanaele: await kanaeleZuBeitrag(kontext, id),
      alle: await listeKanaele(kontext),
      /*
       * **Darf dieser Mensch die Planungsseite ueberhaupt oeffnen?**
       *
       * Sie ist mit `social.planen` bewacht (Routenregister). Wer nur
       * `social.schreiben` haelt — eine `leitung` etwa —, sah hier einen Link
       * mit einem 404 dahinter. AUT-06 verlangt das Gegenteil: ein Verweis auf
       * etwas, das dieser Mensch nicht sehen darf, verraet, dass es das gibt.
       */
      darfPlanen: (await kontext.abfrage<{ ja: boolean }>(
        `select app.hat_recht('social.planen', app.aktiver_mandant()) as ja`)
      )[0]?.ja ?? false,
    }))) as Promise<{
      beitrag: BeitragZeile | null;
      kanaele: readonly BeitragKanalZeile[];
      alle: readonly KanalZeile[];
      darfPlanen: boolean;
    }>);

  const b = daten.beitrag;
  if (b === null) notFound();

  /*
   * **Drei Schritte fallen hier heraus, jeder aus einem eigenen Grund.**
   *
   * `freigeben` und `ablehnen` fallen im Freigabe-Posteingang — dort wird die
   * Entscheidung protokolliert und verkettet (APR-02, K-13). Ein zweiter Knopf
   * dafuer waere ein zweiter Weg zur selben Entscheidung, und der eine ohne
   * Kette.
   *
   * `planen` braucht einen ZEITPUNKT. Als blosser Knopf ohne Feld schickte er
   * `schritt=planen` an eine Route, die den Schritt nicht kennt — ein Knopf,
   * der jedes Mal einen Fehler erzeugt, sieht aus wie eine kaputte Funktion
   * und war keine. Der Weg dorthin ist die Planungsseite darunter.
   */
  const OHNE: readonly Schritt[] = ['freigeben', 'ablehnen', 'planen'];
  /*
   * **`erneut_senden` erscheint nur, wenn es etwas zu wiederholen GIBT** — und
   * nur für den, der es darf.
   *
   * Ein nicht verbundener Kanal ist kein Fehlschlag, sondern ein bekannter
   * Zustand (O-10); ihn zu wiederholen änderte nichts, und ein Knopf, der
   * jedes Mal „kein Kanal ist fehlgeschlagen" antwortet, sieht aus wie eine
   * kaputte Funktion. Dasselbe gilt für das Recht: der Schritt geht nach
   * DRAUSSEN und verlangt deshalb `social.planen`, wie „Jetzt
   * veröffentlichen" — ein Knopf davor, dessen Route abweist, ist ein
   * Fehlerbericht mit Verzögerung (AUT-06).
   */
  const hatFehlgeschlagene = daten.kanaele.some((k) => k.ergebnis === 'fehlgeschlagen');
  /**
   * **Jeder Schritt steht unter dem Recht, das seine Route verlangt.**
   *
   * `RECHT` in `/api/social/beitraege/[id]/schritt` teilt die Schritte in
   * zwei: `vorlegen` und `ueberarbeiten` gehoeren zu `social.schreiben`,
   * alles, was nach DRAUSSEN geht (`veroeffentlichen`, `zuruecknehmen`,
   * `planung_aufheben`, `erneut_senden`), zu `social.planen`. Diese Seite
   * oeffnet mit `social.lesen` allein — hier stand nur die Bedingung fuer
   * `erneut_senden`, also bekam ein reiner Leser die uebrigen Knoepfe zu
   * sehen und ihre Abweisung erst NACH dem Druecken (AUT-06, D-581).
   *
   * Die Tabelle steht bewusst hier und nicht importiert: die Route entscheidet
   * ueber die Ausfuehrung, diese Seite nur ueber die Sichtbarkeit — und ein
   * Knopf, der faelschlich fehlt, ist ein anderer Fehler als einer, der
   * faelschlich wirkt. `tests/kern/social-schritt-rechte.test.ts` haelt beide
   * Listen aneinander.
   */
  const rechtJeSchritt: Readonly<Record<string, boolean>> = {
    vorlegen: darf['social.schreiben'] === true,
    ueberarbeiten: darf['social.schreiben'] === true,
    veroeffentlichen: daten.darfPlanen,
    zuruecknehmen: daten.darfPlanen,
    planung_aufheben: daten.darfPlanen,
    erneut_senden: daten.darfPlanen && hatFehlgeschlagene,
  };
  const schritte = moeglicheSchritte(b.status)
    .filter((s): s is Schritt => !OHNE.includes(s))
    .filter((s) => rechtJeSchritt[s] === true);
  /*
   * Der Weg zur Planung steht offen, wenn der Zustand ihn kennt UND der
   * Mensch das Recht dazu haelt — nicht, weil der Zustand zufaellig
   * `freigegeben` heisst. `naechsterStatus` fragt dieselbe Tabelle, aus der
   * der Dienst antwortet; eine zweite Abschrift der Bedingung waere die
   * Stelle, an der beide auseinanderlaufen.
   */
  const planbar = naechsterStatus(b.status, 'planen') !== null && daten.darfPlanen;
  const gewaehlt = new Set(daten.kanaele.map((k) => k.kanalId));
  /*
   * Bearbeiten heisst speichern, und das verlangt `social.schreiben`
   * (`PATCH /api/social/beitraege/[id]`). Der Zustand allein reichte hier
   * nicht: ein Leser bekam auf einem Entwurf offene Felder und einen
   * „Speichern"-Knopf, dessen Route ihn abweist.
   */
  const bearbeitbar = darfBearbeiten(b.status) && darf['social.schreiben'] === true;

  return (
    <PortalRahmen
      titel={b.titel}
      wurzelTitel="Social Media"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="social"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="min-w-0 text-h1 text-text hyphens-auto">{b.titel}</h1>
        <span data-cse="beitrag-stand" data-status={b.status}
              className="text-sm text-text-muted">
          {STATUS_TEXT[b.status] ?? b.status}
        </span>
      </div>

      {suche['angelegt'] === '1' ? (
        <Hinweis art="hinweis" cse="beitrag-angelegt" className="mb-s5 max-w-prose">
          Der Entwurf steht. Er geht hinaus, nachdem ein Mensch ihn freigegeben hat.
        </Hinweis>
      ) : null}

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="beitrag-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Der Schritt wurde abgewiesen.'}
        </Hinweis>
      )}

      {b.status === 'vorgelegt' && b.freigabeId !== null ? (
        <Hinweis art="hinweis" cse="beitrag-wartet" className="mb-s5 max-w-prose">
          <strong>Er liegt im Freigabe-Posteingang.</strong> Entschieden wird dort, nicht
          hier — die Entscheidung wird protokolliert und verkettet (APR-02).
          {darf['freigabe.entscheiden'] === true && (
            <>
              {' '}
              <Link href={`/portal/${mandant}/freigaben/${b.freigabeId}`}
                    className="underline underline-offset-4" data-cse="zur-freigabe">
                Zur Freigabe
              </Link>.
            </>
          )}
        </Hinweis>
      ) : null}

      {b.status === 'abgelehnt' ? (
        <Hinweis art="warnung" cse="beitrag-abgelehnt" className="mb-s5 max-w-prose">
          <strong>Abgelehnt.</strong> Über „Überarbeiten" wird er wieder Entwurf; die alte
          Freigabe fällt dabei weg, weil sie für den alten Text galt.
        </Hinweis>
      ) : null}

      {b.zurueckgezogenAm !== null ? (
        <Hinweis art="warnung" cse="beitrag-zurueckgezogen" className="mb-s5 max-w-prose">
          <strong>Zurückgezogen am {BERLIN.format(new Date(b.zurueckgezogenAm))}.</strong>{' '}
          Was auf einer fremden Plattform steht, nimmt diese Plattform nicht zurück — das
          geschieht dort, von Hand.
        </Hinweis>
      ) : null}

      <section className="mb-s6" data-cse="beitrag-inhalt">
        <h2 className="mb-s3 text-h2 text-text">Inhalt</h2>
        <form method="post" action={`/api/social/beitraege/${id}`}
              className="flex max-w-prose flex-col gap-s4">
          <input type="hidden" name="zurueck" value={hierher} />
          <FormField label="Titel" name="titel" defaultValue={b.titel} required
                     maxLength={200} disabled={!bearbeitbar} />
          <div className="flex flex-col gap-s2">
            <label htmlFor="text" className="text-xs text-text-muted">Text</label>
            <textarea id="text" name="text" required rows={8} className={FELD}
                      defaultValue={b.text} disabled={!bearbeitbar} data-cse="beitrag-text" />
          </div>
          <div className="flex flex-col gap-s2">
            <label htmlFor="art" className="text-xs text-text-muted">Art</label>
            <select id="art" name="art" className={FELD} defaultValue={b.art}
                    disabled={!bearbeitbar} data-cse="beitrag-art">
              {ARTEN.map((a) => <option key={a.wert} value={a.wert}>{a.text}</option>)}
            </select>
          </div>
          <fieldset className="flex flex-col gap-s2 border-0 p-0" disabled={!bearbeitbar}>
            <legend className="text-xs text-text-muted">Kanäle</legend>
            {daten.alle.map((k) => (
              <label key={k.id} className="flex min-h-11 items-center gap-s3 text-sm text-text">
                <input type="checkbox" name="kanal" value={k.id}
                       defaultChecked={gewaehlt.has(k.id)}
                       className="size-4 accent-[var(--brand)]" />
                <span>{PLATTFORM_NAME[k.plattform as Plattform] ?? k.anzeigename}</span>
                {k.verbunden ? null : (
                  <span className="text-xs text-warning">nicht verbunden</span>
                )}
              </label>
            ))}
          </fieldset>
          {bearbeitbar ? (
            <Button type="submit" variante="primary" data-cse="beitrag-speichern">
              Speichern
            </Button>
          ) : (
            <p className="max-w-prose text-xs text-text-subtle" data-cse="nicht-bearbeitbar">
              Bearbeitet wird nur der Entwurf. Die Freigabe hängt am Text, der vorlag — wer
              ihn danach ändert, hätte keine Freigabe mehr für das, was hinausgeht.
            </p>
          )}
        </form>
      </section>

      <section className="mb-s6" data-cse="beitrag-kanaele">
        <h2 className="mb-s3 text-h2 text-text">Wohin er geht</h2>
        <ul className="flex flex-col gap-s2">
          <li data-cse="kanal-ergebnis" data-plattform="website"
              className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
            <span className="text-sm text-text">Eigene Gesellschaftsseite</span>
            <span className="flex items-center gap-s3">
              <span className="text-xs text-text-subtle">
                {b.status === 'veroeffentlicht' && b.zurueckgezogenAm === null
                  ? `öffentlich seit ${b.veroeffentlichtAm === null ? '—' : BERLIN.format(new Date(b.veroeffentlichtAm))}`
                  : 'noch nicht öffentlich'}
              </span>
              <StatusPill zustand={
                b.status === 'veroeffentlicht' && b.zurueckgezogenAm === null ? 'Aktiv' : 'Wartet'
              } />
            </span>
          </li>
          {daten.kanaele.map((k) => {
            const e = ERGEBNIS[k.ergebnis] ?? ERGEBNIS['offen']!;
            return (
              <li key={k.kanalId} data-cse="kanal-ergebnis" data-plattform={k.plattform}
                  data-ergebnis={k.ergebnis}
                  className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
                <span className="min-w-0">
                  <span className="text-sm text-text">{PLATTFORM_NAME[k.plattform]}</span>
                  {k.meldung === null ? null : (
                    <span className="mt-s1 block max-w-prose text-xs text-text-subtle">
                      {k.meldung}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-s3">
                  <span className="text-xs text-text-subtle">{e.text}</span>
                  <StatusPill zustand={e.pill} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section data-cse="beitrag-schritte">
        <h2 className="mb-s3 text-h2 text-text">Nächster Schritt</h2>
        {schritte.length === 0 && !planbar ? (
          <p className="max-w-prose text-sm text-text-muted">
            Von hier führt kein Schritt weiter. Wer denselben Text noch einmal will, legt
            einen neuen Beitrag an — und der geht seinen eigenen Weg durch die Freigabe.
          </p>
        ) : (
          <div className="flex flex-col gap-s3">
            {schritte.map((s) => (
              <form key={s} method="post" action={`/api/social/beitraege/${id}/schritt`}
                    className="flex flex-wrap items-end gap-s3">
                <input type="hidden" name="schritt" value={s} />
                <input type="hidden" name="zurueck" value={hierher} />
                {s === 'zuruecknehmen' ? (
                  <FormField label="Grund" name="grund" required className="min-w-64 flex-1"
                             hinweis="Er steht im Protokoll — jemand wird danach fragen." />
                ) : null}
                <Button type="submit" variante={s === 'vorlegen' ? 'primary' : 'secondary'}
                        data-cse={`schritt-${s}`}>
                  {SCHRITT_TEXT[s]}
                </Button>
              </form>
            ))}
            {planbar ? (
              <Link href={`/portal/${mandant}/social/posts/${id}/planung`}
                    data-cse="zur-planung"
                    className="inline-flex min-h-11 w-fit items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
                Auf einen Zeitpunkt legen
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
