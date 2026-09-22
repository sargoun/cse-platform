import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  ladeStapelMappe, teileStapel, type StapelFall, type StapelMappe,
} from '@/server/services/freigabe/stapel-mappe';
import { STAPEL_HOECHSTZAHL } from '@/server/services/freigabe/stapel';
import { EINSPRUCH_MINUTEN, FENSTER_OFFENE_FRAGE }
  from '@/server/services/freigabe/fenster.platzhalter';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { RISIKO_LABEL, VORGANG_LABEL, zeitpunkt } from '../darstellung';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/freigaben/stapel` — Routinevorgänge zusammen genehmigen,
 * **jeden davon einzeln zu sehen** (APR-02, APR-03, APR-04, APR-07,
 * Invariante 7, `04-SEITENKARTE.md` §5.20).
 *
 * **Was diese Seite gegenüber der Häkchenspalte im Posteingang ändert.** Der
 * Posteingang zeigt Kopfdaten und sortiert; diese Mappe legt je Vorgang die
 * geänderten FELDER daneben — Wert vorher, Wert nachher, Konfidenz, und
 * markiert, was unsicher ist. Invariante 7 sagt nicht „ein Mensch hat
 * geklickt", sondern „nichts verlässt das System ohne menschliche Freigabe";
 * eine Stapelfreigabe, die die Fälle nicht zeigt, ist ein Häkchen bei „alle"
 * mit zusätzlichen Schritten.
 *
 * **Markierte Fälle sind ausgenommen — und sie verschwinden nicht.** Sie
 * stehen unten in derselben Mappe, ohne Häkchen, mit ihrem Grund und dem Weg
 * zur Einzelprüfung. Ein Stapel, der an ihnen abbricht, erzieht dazu, ihn
 * nicht zu benutzen; einer, der sie stillschweigend mitnimmt, hebelt APR-03
 * aus.
 *
 * **Der Bildschirm ist die Anzeige des Riegels, nicht der Riegel.** Was hier
 * kein Häkchen hat, bewertet `entscheideStapel` serverseitig ein zweites Mal —
 * was immer der Browser geschickt hat (05-API-KARTE §C). Und jede Genehmigung
 * bekommt trotzdem ihren eigenen Schnappschuss, ihr eigenes Kettenglied und
 * eine Ansichtszeile mit dem Kanal `stapel` (APR-07, APR-08): die Entscheidung
 * ist protokolliert, je Fall.
 *
 * **Diese Seite verlangt `freigabe.stapel_entscheiden`** (Manifest) — nicht
 * `freigabe.entscheiden`. Wer einzeln entscheiden darf, darf damit nicht schon
 * fünfzig auf einmal; wem das Recht fehlt, bekommt 404 und nicht 403 (AUT-06).
 */
export const dynamic = 'force-dynamic';

function zahl(wert: string | string[] | undefined): number | null {
  return typeof wert === 'string' && wert !== '' && Number.isFinite(Number(wert))
    ? Number(wert)
    : null;
}

function Fall(
  { fall, mandant, darfOeffnen, mitHaken }: {
    readonly fall: StapelFall;
    readonly mandant: string;
    readonly darfOeffnen: boolean;
    readonly mitHaken: boolean;
  },
) {
  const e = fall.eintrag;
  return (
    <li
      data-cse="stapel-fall"
      data-stapelbar={fall.grund === null ? 'ja' : 'nein'}
      className="rounded-lg border border-line bg-surface p-s5"
    >
      <div className="flex flex-wrap items-start justify-between gap-s3">
        <div className="flex min-w-0 items-start gap-s3">
          {mitHaken ? (
            <input
              type="checkbox" name="freigabe" value={e.id} defaultChecked
              data-cse="stapel-auswahl" className="mt-s1 size-4 rounded border-line"
              aria-label={`${e.titel} im Stapel genehmigen`}
            />
          ) : (
            <span aria-hidden className="mt-s1 inline-block size-4 rounded border border-line bg-surface-3" />
          )}
          <div className="min-w-0">
            <p className="m-0 text-base text-text">
              {darfOeffnen ? (
                <Link href={`/portal/${mandant}/freigaben/${e.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {e.titel}
                </Link>
              ) : e.titel}
            </p>
            <p className="m-0 text-sm text-text-muted">{e.zusammenfassung}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-s3 text-sm">
          <span data-risiko={e.risiko} className={e.risiko === 'hoch' ? 'text-warning' : 'text-text'}>
            {RISIKO_LABEL[e.risiko]}
          </span>
          <span className="text-text-muted">{VORGANG_LABEL[e.vorgangTyp]}</span>
          <span className="tabular-nums text-text">
            {e.betragCent === null ? '—' : formatiereGeld(e.betragCent)}
          </span>
          {e.dringlichkeit === 5
            ? <StatusPill zustand="Überfällig" />
            : <span className="text-text-muted">{e.dringlichkeitText}</span>}
        </div>
      </div>

      <p className="mt-s2 text-xs text-text-subtle">
        Frist: {zeitpunkt(e.frist)} · Sortierschlüssel {e.sortSchluessel}
      </p>

      {fall.grund !== null && (
        <p data-cse="stapel-ausgenommen-grund"
           className="mt-s3 rounded-md border border-warning bg-warning-soft p-s3 text-sm text-warning">
          <strong>Nicht im Stapel.</strong> {fall.grund}
          {darfOeffnen && (
            <>
              {' '}
              <Link href={`/portal/${mandant}/freigaben/${e.id}`}
                    className="underline underline-offset-2">
                Einzeln prüfen
              </Link>
            </>
          )}
        </p>
      )}

      {fall.felder.length === 0 ? (
        <p className="mt-s3 text-sm text-text-muted" data-cse="stapel-ohne-felder">
          Dieser Vorschlag führt keine einzelnen Feldnachweise — was er ändert, steht in
          seiner Zusammenfassung und im Diff der Prüfansicht.
        </p>
      ) : (
        /*
         * **`DataTable` und keine eigene `<table>`** — dieselbe Bauart wie die
         * Nachweistabelle der Prüfansicht (`../[id]/page.tsx`), und zwar aus
         * einem gemessenen Grund.
         *
         * Hier stand eine handgeschriebene `<table className="w-full">`. Eine
         * Tabelle wird nie schmaler als die Summe der Mindestbreiten ihrer
         * Spalten — `width: 100%` ändert daran nichts. Am Telefon (390px) war
         * sie 451px breit (x=49…500, der Kopf „Prüfung" allein bei
         * x=386…500) und schob die ganze Seite 110px über den Rand
         * (`abmessungen.spec.ts`).
         *
         * `DataTable` löst genau das, einmal für das ganze Haus (D-420):
         * unter `md` ein Kartenstapel — „nie ein seitlicher Rollbalken auf
         * einem Telefon" (DESIGN §5, §8) —, ab `md` die Tabelle in ihrem
         * eigenen Rollbehälter. Ein `overflow-x-auto` um die Tabelle hätte
         * die Seite ebenfalls gerettet und §8 verletzt.
         *
         * Die Anker `data-cse="stapel-feld"` und `data-unsicher` wandern auf
         * die Feldzelle; sie sind die Diagnose dieser Zeile und gehen nicht
         * verloren.
         */
        <div className="mt-s3">
          <DataTable
            beschriftung="Geänderte Felder dieses Vorgangs"
            zeilen={fall.felder}
            schluessel={(f) => f.id}
            spalten={[
              {
                schluessel: 'feld',
                kopf: 'Feld',
                zelle: (f) => (
                  <span className="text-text" data-cse="stapel-feld"
                        data-unsicher={f.unsicher ? 'ja' : 'nein'}>
                    {f.bezeichnung}
                  </span>
                ),
              },
              {
                schluessel: 'vorher',
                kopf: 'Vorher',
                zelle: (f) => (f.wertVorher === null
                  ? <span className="text-text-subtle">—</span>
                  : <span className="text-text-muted">{f.wertVorher}</span>),
              },
              {
                schluessel: 'nachher',
                kopf: 'Nachher',
                zelle: (f) => (f.wertNachher === null
                  ? <span className="text-text-subtle">—</span>
                  : <span className="text-text">{f.wertNachher}</span>),
              },
              {
                schluessel: 'pruefung',
                kopf: 'Prüfung',
                zelle: (f) => (f.unsicher
                  ? (
                    <span className="text-warning">
                      unsicher{f.grund === null ? '' : ` — ${f.grund}`}
                    </span>
                  )
                  : (
                    <span className="text-text-muted">
                      {f.konfidenz === null ? 'ohne Konfidenz' : `Konfidenz ${f.konfidenz}`}
                    </span>
                  )),
              },
            ]}
          />
        </div>
      )}

    </li>
  );
}

export default async function Stapelmappe({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/freigaben/stapel`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: die Prüfansicht verlangt `freigabe.entscheiden`, diese Seite
     `freigabe.stapel_entscheiden`. Beide sind eigene, bindbare Rechte — ein
     Titel, der auf 404 führt, verrät, was er nicht zeigen darf (D-581). */
  const darf = await haeltRechte(zugang.sitzung, 'freigabe.entscheiden', 'freigabe.lesen');

  const suche = await searchParams;
  const genehmigt = zahl(suche['stapel']);
  const uebersprungen = zahl(suche['uebersprungen']);
  const verzoegert = zahl(suche['verzoegert']);
  const ausgefuehrt = zahl(suche['ausgefuehrt']);
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const jetzt = new Date();
  const mappe = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeStapelMappe(kontext, jetzt)),
  ) as Promise<StapelMappe>);

  const { stapelbar, ausgenommen } = teileStapel(mappe.faelle);
  /* Mehr als die Obergrenze weist der Dienst ab — die Mappe sagt es VORHER,
     statt fünfzig Häkchen in einen Fehler laufen zu lassen. */
  const zuViele = stapelbar.length > STAPEL_HOECHSTZAHL;

  return (
    <PortalRahmen
      titel="Stapelfreigabe"
      wurzelTitel="Freigaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Stapelfreigabe</h1>
        {darf['freigabe.lesen'] === true && (
          <Link href={`/portal/${mandant}/freigaben`}
                data-cse="zu-posteingang"
                className="text-sm text-text underline underline-offset-2">
            Zum Posteingang
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Hier steht jeder Fall mit seinen geänderten Feldern — Wert vorher, Wert nachher,
        Konfidenz. Wer danach genehmigt, hat gesehen, was er genehmigt (APR-02).
        Markierte Vorgänge und solche mit unsicheren Feldern sind ausgenommen und
        stehen unten mit ihrem Grund (APR-03, APR-04). Jede Genehmigung bekommt ihren
        eigenen Schnappschuss und eine Ansichtszeile mit dem Kanal <code>stapel</code>{' '}
        (APR-07, APR-08).
      </p>

      {genehmigt !== null && (
        <Hinweis art="erfolg" cse="stapel-bericht" className="mb-s5 max-w-prose">
          <strong>{genehmigt} genehmigt.</strong>{' '}
          {uebersprungen === null || uebersprungen === 0
            ? 'Nichts übersprungen.'
            : `${String(uebersprungen)} übersprungen — sie stehen weiter in dieser Mappe `
              + 'und wollen einzeln angesehen werden (APR-04).'}
          {verzoegert !== null && verzoegert > 0 && (
            <>
              {' '}
              <span data-cse="stapel-verzoegert">
                {verzoegert} davon mit laufendem Einspruchsfenster — bis es abläuft, ist
                nichts ausgelöst (APR-05).
              </span>
            </>
          )}
          {ausgefuehrt !== null && ausgefuehrt > 0 && (
            <>
              {' '}
              <span data-cse="stapel-ausgefuehrt">
                {ausgefuehrt} Handlung(en) gleich ausgeführt.
              </span>
            </>
          )}
        </Hinweis>
      )}

      {fehler !== null && (
        <Hinweis art="warnung" cse="stapel-fehler" className="mb-s5 max-w-prose">
          <strong>Nichts genehmigt.</strong>{' '}
          {fehler === 'zu_gross'
            ? `Mehr als ${String(STAPEL_HOECHSTZAHL)} auf einmal ist keine Prüfung mehr, `
              + 'sondern ein Häkchen bei „alle".'
            : fehler === 'kein_recht'
              ? 'Stapelweise zu genehmigen ist eine eigene Befugnis '
                + '(„freigabe.stapel_entscheiden"), und dieses Konto hält sie nicht.'
              : 'Es war nichts ausgewählt.'}
        </Hinweis>
      )}

      {!mappe.darfStapel && (
        <Hinweis art="warnung" cse="stapel-kein-recht" className="mb-s5 max-w-prose">
          Dieses Konto hält <Recht schluessel="freigabe.stapel_entscheiden" /> nicht. Die Mappe
          bleibt lesbar; entschieden wird dann einzeln in der Prüfansicht. Wer die
          Befugnis halten soll, ist offen (O-367).
        </Hinweis>
      )}

      {mappe.faelle.length === 0 ? (
        <p data-cse="stapel-leer"
           className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Vorschlag wartet auf eine Entscheidung. Neue Vorgänge erscheinen hier,
          sobald ein Agent oder ein Dienst sie vorlegt.
        </p>
      ) : (
        <>
          <h2 className="mb-s3 text-h2 text-text">
            Routine ({stapelbar.length} von {mappe.faelle.length})
          </h2>
          {stapelbar.length === 0 ? (
            <p data-cse="stapel-keine-routine"
               className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
              Nichts davon ist Routine — jeder dieser Vorgänge will einzeln angesehen
              werden. Das ist kein Fehler der Liste, sondern ihr Ergebnis.
            </p>
          ) : (
            <form method="post" action="/api/freigaben/stapel" data-cse="stapel-formular"
                  className="mb-s6">
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="ansicht" value="stapel" />

              {zuViele && (
                <Hinweis art="warnung" cse="stapel-zu-viele" className="mb-s4 max-w-prose">
                  Es sind {stapelbar.length} Routinefälle offen, und höchstens{' '}
                  {STAPEL_HOECHSTZAHL} gehen auf einmal. Nehmen Sie Häkchen heraus —
                  darüber wäre es keine Prüfung mehr, und der Dienst weist den Stapel
                  ab, bevor etwas geschieht.
                </Hinweis>
              )}

              <ul className="m-0 flex list-none flex-col gap-s4 p-0">
                {stapelbar.map((f) => (
                  <Fall key={f.eintrag.id} fall={f} mandant={mandant}
                        darfOeffnen={darf['freigabe.entscheiden'] === true}
                        mitHaken={mappe.darfStapel} />
                ))}
              </ul>

              {mappe.darfStapel && (
                <div className="mt-s5 flex flex-wrap items-center gap-s3">
                  <Button type="submit" variante="primary" data-cse="stapel-genehmigen">
                    Angekreuzte genehmigen
                  </Button>
                  <p className="m-0 max-w-prose text-xs text-text-subtle">
                    Risikoarme Vorgänge ohne eigene Ausführung bekommen danach ein
                    Einspruchsfenster von {String(EINSPRUCH_MINUTEN)} Minuten (APR-05,
                    Platzhalter {FENSTER_OFFENE_FRAGE}); bis es abläuft, ist nichts
                    ausgelöst. Alles andere wird sofort wirksam.
                  </p>
                </div>
              )}
            </form>
          )}

          <h2 className="mb-s3 text-h2 text-text">
            Ausgenommen ({ausgenommen.length})
          </h2>
          {ausgenommen.length === 0 ? (
            <p data-cse="stapel-keine-ausnahme"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
              Kein Vorgang ist markiert und keiner trägt ein unsicheres Feld.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-s4 p-0" data-cse="stapel-ausgenommen">
              {ausgenommen.map((f) => (
                <Fall key={f.eintrag.id} fall={f} mandant={mandant}
                      darfOeffnen={darf['freigabe.entscheiden'] === true}
                      mitHaken={false} />
              ))}
            </ul>
          )}
        </>
      )}
    </PortalRahmen>
  );
}
