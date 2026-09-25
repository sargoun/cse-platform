import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { leseMappe, type MappenBlick } from './daten';
import { kennungOder404 } from '../../../../kennung';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/radar/[id]/mappe` — die Vergabemappe (RAD-07, D-07).
 *
 * **Was diese Seite kann und was nicht.** Sie führt die Prüfliste: welche
 * Unterlage gefordert ist, ob sie vorliegt, ob jemand sie geprüft hat und was
 * fehlt. Sie reicht NICHTS ein — die deutschen Vergabeplattformen bieten
 * dafür keine Schnittstelle an (D-07). Der einzige Knopf in diese Richtung
 * heisst „Einreichung erfassen" und hält fest, was ein Mensch getan hat.
 *
 * **Die Liste ist leer, bis jemand sie füllt — mit Absicht.** Es gibt keine
 * Vorlage „die üblichen zwölf Unterlagen": welche Formblätter eine Plattform
 * bei welcher Verfahrensart verlangt, steht in keiner Liste, die hier
 * vorliegt (O-194). Eine geratene Vorlage wäre eine Prüfliste, die vollständig
 * aussieht und es nicht ist — genau der Fehler, der ein Angebot nach § 57 VgV
 * ausschliesst, ohne dass jemand den Preis liest.
 *
 * **„Liegt vor" ist nicht „erledigt."** Der Zähler oben verlangt `geprüft`
 * oder eine begründete Nichtzuständigkeit. Die häufigsten Ausschlüsse sind
 * beigelegte, aber falsche Unterlagen: das Formblatt des Vorjahres, die
 * abgelaufene Unbedenklichkeitsbescheinigung (D-492).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short',
});

const STAND_TEXT: Readonly<Record<string, string>> = {
  offen: 'offen', vorhanden: 'liegt vor, ungeprüft', geprueft: 'geprüft',
  nicht_zutreffend: 'gilt für uns nicht',
};

/** Die drei Enden eines deutschen Vergabeverfahrens — und kein viertes (REP-06). */
const AUSGAENGE_TEXT: Readonly<Record<string, string>> = {
  zuschlag: 'Zuschlag erhalten',
  nicht_beruecksichtigt: 'Nicht berücksichtigt',
  verfahren_aufgehoben: 'Das Verfahren wurde aufgehoben',
};

const MAPPE_TEXT: Readonly<Record<string, string>> = {
  offen: 'offen', in_arbeit: 'in Arbeit', vollstaendig: 'vollständig',
  freigegeben: 'freigegeben', eingereicht: 'eingereicht', verworfen: 'verworfen',
};

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  bezeichnung: 'Eine Position braucht eine Bezeichnung — mindestens drei Zeichen.',
  begruendung: '„Gilt für uns nicht" braucht eine Begründung. Ohne sie ist es eine Lücke mit einem Haken davor.',
  datei: 'Ohne beigelegte Datei kann eine Position nicht auf „liegt vor" stehen.',
  unvollstaendig: 'Diese Mappe hat noch offene Pflichtpositionen. Erst prüfen, dann freigeben.',
  keine_datei: 'Es wurde keine Datei ausgewählt.',
  speicher: 'Der Dokumentenspeicher ist nicht verbunden (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Es wurde NICHTS gespeichert.',
  datei_abgewiesen: 'Die Datei wurde abgewiesen — zu gross, oder der tatsächliche Dateityp ist keiner der erlaubten (geprüft wird an den Magic Bytes, nicht am Namen).',
  unbekannte_position: 'Die Position wurde nicht gefunden.',
  ausgang: 'Das ist kein Ausgang eines Vergabeverfahrens.',
  ausgang_eingabe: 'Zum Ergebnis gehört ein Entscheidungsdatum — und ein Auftragswert nur beim Zuschlag.',
  ausgang_ohne_einreichung: 'Ein Ergebnis wird erst erfasst, wenn die Einreichung erfasst ist. „Gewonnen, ohne zu bieten" gehört in keinen Bericht.',
  wert: 'Der Auftragswert ist kein deutsches Geldformat (1.234,56).',
  leer: 'Eine Mappe ohne eine einzige Pflichtposition ist nicht vollständig, sondern leer.',
  eingereicht: 'Diese Mappe ist eingereicht. Was abgegeben wurde, wird nicht mehr umsortiert.',
};

function Zaehler({ m }: { m: MappenBlick }) {
  const offen = m.pflichtGesamt - m.pflichtErledigt;
  return (
    <p data-cse="mappe-zaehler" data-gesamt={m.pflichtGesamt} data-erledigt={m.pflichtErledigt}
       className="text-sm text-text">
      {m.pflichtGesamt === 0
        ? 'Noch keine Pflichtposition erfasst.'
        : (
          <>
            <strong className={offen === 0 ? 'text-success' : 'text-text'}>
              {m.pflichtErledigt} von {m.pflichtGesamt}
            </strong>{' '}
            Pflichtpositionen geprüft
            {offen === 0 ? '.' : ` — ${String(offen)} ${offen === 1 ? 'fehlt' : 'fehlen'} noch.`}
          </>
        )}
    </p>
  );
}

export default async function Vergabemappe(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/radar/${id}/mappe`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const vermerkt = typeof suche['vermerkt'] === 'string' ? suche['vermerkt'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const mappe = await leseMappe(kontext, id);
      if (mappe === null) return null;
      /*
       * `/radar/[id]` verlangt `radar.lesen`, `/radar/plattformen` verlangt
       * `radar.plattform_verwalten` (Manifest); diese Seite öffnet mit
       * `vergabe.schreiben` allein. Ein Verweis, der auf 404 führt, verrät,
       * was er nicht zeigen darf (AUT-06). Gemeldet von der Copilot-Runde auf
       * PR 16 / D-581.
       */
      const [r] = await kontext.abfrage<{
        schreiben: boolean; einreichen: boolean; radar: boolean; plattformen: boolean;
      }>(
        `select app.hat_recht('vergabe.schreiben', app.aktiver_mandant()) as schreiben,
                app.hat_recht('vergabe.einreichung_erfassen', app.aktiver_mandant()) as einreichen,
                app.hat_recht('radar.lesen', app.aktiver_mandant()) as radar,
                app.hat_recht('radar.plattform_verwalten', app.aktiver_mandant()) as plattformen`);
      return {
        mappe,
        darfSchreiben: r?.schreiben === true,
        darfEinreichen: r?.einreichen === true,
        darfRadar: r?.radar === true,
        darfPlattformen: r?.plattformen === true,
      };
    })) as Promise<{
      mappe: MappenBlick; darfSchreiben: boolean; darfEinreichen: boolean;
      darfRadar: boolean; darfPlattformen: boolean;
    } | null>);

  if (daten === null) notFound();
  const { mappe: m, darfSchreiben, darfEinreichen, darfRadar, darfPlattformen } = daten;
  const offenePflicht = m.pflichtGesamt - m.pflichtErledigt;
  const gesperrt = m.status === 'eingereicht' || m.status === 'verworfen';

  return (
    <PortalRahmen
      titel="Vergabemappe"
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="radar"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">Vergabemappe</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">{m.titel}</p>
        </div>
        {darfRadar ? (
          <Link href={`/portal/${mandant}/radar/${id}`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zur Bekanntmachung
          </Link>
        ) : null}
      </div>

      {vermerkt !== null ? (
        <Hinweis art="erfolg" cse="mappe-vermerkt" className="mb-s5 max-w-prose">
          <strong>Vermerkt.</strong> {vermerkt === 'eingereicht'
            ? 'Die Einreichung ist erfasst.'
            : vermerkt === 'ausgang'
              ? 'Das Ergebnis des Verfahrens ist erfasst.'
              : vermerkt === 'beigelegt'
              ? 'Die Datei liegt bei. Geprüft ist sie damit noch nicht — das ist der nächste Schritt.'
              : 'Die Mappe wurde geändert.'}
        </Hinweis>
      ) : null}
      {fehler !== null ? (
        <Hinweis art="warnung" cse="mappe-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht geändert.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {m.eingereichtAm !== null ? (
        <Hinweis art="erfolg" cse="mappe-eingereicht" className="mb-s5 max-w-prose">
          <strong>Eingereicht am {BERLIN.format(m.eingereichtAm)}</strong> von{' '}
          {m.eingereichtVon ?? 'unbekannt'} über {m.eingereichtUeber ?? '—'}
          {m.kennzeichen === null ? '' : `, Kennzeichen ${m.kennzeichen}`}. Hochgeladen hat das ein
          Mensch; diese Plattform hat nichts übertragen (D-07).
        </Hinweis>
      ) : null}

      {m.fristAngebot !== null && m.restTage !== null && m.restTage < 5 && m.eingereichtAm === null ? (
        <Hinweis art="warnung" cse="mappe-frist" className="mb-s5 max-w-prose">
          <strong>Abgabe {BERLIN.format(m.fristAngebot)}</strong> — noch{' '}
          <span data-cse="mappe-rest" data-rest={m.restTage}>
            {m.restTage < 0 ? 'keine Zeit, die Frist ist abgelaufen'
              : `${String(m.restTage)} ${m.restTage === 1 ? 'Tag' : 'Tage'}`}
          </span>.
          {offenePflicht > 0 ? ` ${String(offenePflicht)} Pflichtposition${offenePflicht === 1 ? '' : 'en'} ${offenePflicht === 1 ? 'ist' : 'sind'} noch offen.` : ''}
        </Hinweis>
      ) : null}

      {m.plattformName !== null && m.freigeschaltet === false ? (
        <Hinweis art="warnung" cse="mappe-plattform" className="mb-s5 max-w-prose">
          <strong>Auf {m.plattformName} ist diese Gesellschaft nicht freigeschaltet.</strong>{' '}
          Eine vollständige Mappe nützt nichts, wenn niemand sie hochladen kann — die
          Freischaltung dauert Tage bis Wochen (RAD-09).
          {darfPlattformen ? (
            <>
              {' '}
              <Link href={`/portal/${mandant}/radar/plattformen`} className="underline underline-offset-4">
                Plattformen verwalten
              </Link>.
            </>
          ) : null}
        </Hinweis>
      ) : null}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <div className="flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="text-h2 text-text">Stand: {MAPPE_TEXT[m.status] ?? m.status}</h2>
          <Zaehler m={m} />
        </div>
        {m.freigegebenAm !== null ? (
          <p className="mt-s3 text-sm text-text-muted" data-cse="mappe-freigabe">
            Freigegeben von {m.freigegebenVon ?? 'unbekannt'} am {BERLIN.format(m.freigegebenAm)}.
          </p>
        ) : null}
        {m.lueckenHinweis !== null ? (
          <p className="mt-s3 max-w-prose text-sm text-text" data-cse="mappe-luecken">
            <span className="text-text-muted">Was fehlt: </span>{m.lueckenHinweis}
          </p>
        ) : null}

        {darfSchreiben && !gesperrt ? (
          <form method="post" action="/api/vergabe/mappe" data-cse="mappe-stand-formular"
                className="mt-s4 flex flex-col gap-s3">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="ausschreibung" value={id} />
            <input type="hidden" name="mappe" value={m.mappeId} />
            <input type="hidden" name="was" value="mappenstand" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              Was fehlt (Notiz)
              <input type="text" name="luecken" maxLength={500} defaultValue=""
                     className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
            </label>
            <div className="flex flex-wrap gap-s2">
              <Button type="submit" name="stand" value="in_arbeit" variante="secondary" data-cse="mappe-in-arbeit">
                In Arbeit
              </Button>
              <Button type="submit" name="stand" value="vollstaendig" variante="secondary" data-cse="mappe-vollstaendig">
                Vollständig
              </Button>
              <Button type="submit" name="stand" value="freigegeben" variante="primary" data-cse="mappe-freigeben">
                Freigeben
              </Button>
              <Button type="submit" name="stand" value="verworfen" variante="danger" data-cse="mappe-verwerfen">
                Verwerfen
              </Button>
            </div>
            <p className="text-xs text-text-subtle">
              „Vollständig" und „Freigeben" gehen erst, wenn jede Pflichtposition geprüft oder
              begründet nicht zutreffend ist. Wer freigibt, steht mit Namen daneben.
            </p>
          </form>
        ) : null}
      </section>

      <section className="mb-s6">
        <h2 className="mb-s3 text-h2 text-text">Prüfliste</h2>
        {m.positionen.length === 0 ? (
          <p className="max-w-prose text-sm text-text-muted" data-cse="mappe-leer">
            Noch keine Position. Die geforderten Unterlagen stehen in den Vergabeunterlagen der
            Vergabestelle — diese Plattform rät sie nicht: welche Formblätter eine Plattform bei
            welcher Verfahrensart verlangt, ist eine offene Frage (O-194), und eine erfundene
            Vorlage sähe vollständig aus, ohne es zu sein.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm" data-cse="mappe-positionen">
              <thead>
                <tr className="border-b border-line text-left text-xs text-text-muted">
                  <th className="py-s2 pr-s3 font-normal">#</th>
                  <th className="py-s2 pr-s3 font-normal">Unterlage</th>
                  <th className="py-s2 pr-s3 font-normal">Pflicht</th>
                  <th className="py-s2 pr-s3 font-normal">Stand</th>
                  <th className="py-s2 pr-s3 font-normal">Herkunft</th>
                  {/*
                    * Die Spalte erscheint nur, wenn es in ihr etwas zu tun
                    * gibt. Eine leere Spalte mit Überschrift sagt „hier
                    * fehlt etwas" — dabei ist die Liste nur zu.
                    */}
                  {darfSchreiben && !gesperrt ? (
                    <th className="py-s2 font-normal"><span className="sr-only">Zeile entfernen</span></th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {m.positionen.map((p) => (
                  <tr key={p.id} data-cse="mappe-position" data-stand={p.status}
                      className="border-b border-line align-top">
                    <td className="py-s3 pr-s3 tabular-nums text-text-subtle">{p.position}</td>
                    <td className="py-s3 pr-s3 text-text">
                      {p.bezeichnung}
                      {p.kategorie === null ? null : (
                        <span className="block text-xs text-text-subtle">{p.kategorie}</span>
                      )}
                      {p.hinweis === null ? null : (
                        <span className="block text-xs text-text-muted">{p.hinweis}</span>
                      )}
                    </td>
                    <td className="py-s3 pr-s3 text-text-muted">{p.pflicht ? 'ja' : 'nein'}</td>
                    <td className={`py-s3 pr-s3 ${
                      p.status === 'geprueft' ? 'text-success'
                        : p.status === 'offen' ? 'text-text-muted' : 'text-text'}`}>
                      {STAND_TEXT[p.status] ?? p.status}
                      {p.geprueftAm === null ? null : (
                        <span className="block text-xs text-text-subtle">
                          {p.geprueftVon ?? 'unbekannt'}
                        </span>
                      )}
                    </td>
                    <td className="py-s3 pr-s3 text-xs text-text-subtle">
                      {p.quelleDokument === null ? '—' : p.quelleDokument}
                      {p.quelleSeite === null ? '' : `, S. ${String(p.quelleSeite)}`}
                    </td>
                    {/*
                      * **Entfernen steht an der ZEILE, nicht in einem
                      * Auswahlfeld darunter.**
                      *
                      * Die beiden Formulare unter der Tabelle wählen ihre
                      * Position aus einer Liste — beim Setzen eines Standes
                      * geht das, weil ein falsch gesetzter Stand sich wieder
                      * setzen lässt. Beim Löschen geht es nicht: wer sich im
                      * Auswahlfeld vergreift, löscht die falsche Zeile und
                      * merkt es nicht. Hier ist die Zeile, die verschwindet,
                      * dieselbe, auf die geklickt wird.
                      *
                      * Der Name steht im `aria-label`, weil „Entfernen" in
                      * jeder Zeile gleich heisst und ein Screenreader die
                      * Knöpfe sonst nicht unterscheiden kann (DESIGN §9).
                      */}
                    {darfSchreiben && !gesperrt ? (
                      <td className="py-s3">
                        <form method="post" action="/api/vergabe/mappe"
                              data-cse="mappe-position-entfernen">
                          <input type="hidden" name="mandant" value={mandant} />
                          <input type="hidden" name="ausschreibung" value={id} />
                          <input type="hidden" name="was" value="position_entfernen" />
                          <input type="hidden" name="mappe" value={m.mappeId} />
                          <input type="hidden" name="position" value={p.id} />
                          <Button type="submit" variante="danger"
                                  data-cse="position-entfernen"
                                  aria-label={`Position ${String(p.position)} „${p.bezeichnung}" entfernen`}>
                            Entfernen
                          </Button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {darfSchreiben && !gesperrt ? (
          <>
            {m.positionen.length > 0 ? (
              <form method="post" action="/api/vergabe/mappe" data-cse="mappe-positionsstand"
                    className="mt-s4 flex flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s4">
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="ausschreibung" value={id} />
                <input type="hidden" name="was" value="positionsstand" />
                <label className="flex min-w-[14rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                  Position
                  <select name="position" required
                          className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text">
                    {m.positionen.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.position}. {p.bezeichnung}
                        {p.hatDokument ? ' — Datei liegt bei' : ' — ohne Datei'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[14rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                  Begründung (bei „gilt nicht" verpflichtend)
                  <input type="text" name="hinweis" maxLength={500}
                         className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
                </label>
                <div className="flex flex-wrap gap-s2">
                  <Button type="submit" name="stand" value="geprueft" variante="secondary" data-cse="position-geprueft">
                    Geprüft
                  </Button>
                  <Button type="submit" name="stand" value="nicht_zutreffend" variante="ghost" data-cse="position-nicht-zutreffend">
                    Gilt nicht
                  </Button>
                  <Button type="submit" name="stand" value="offen" variante="secondary" data-cse="position-offen">
                    Zurücksetzen
                  </Button>
                </div>
                <p className="w-full text-xs text-text-subtle">
                  „Geprüft" setzt eine beigelegte Datei voraus — ohne Datei gibt es nichts zu
                  prüfen. Geprüft hat, wer angemeldet ist.
                </p>
              </form>
            ) : null}

            {m.positionen.length > 0 ? (
              <form method="post" action="/api/vergabe/unterlage" encType="multipart/form-data"
                    data-cse="mappe-unterlage"
                    className="mt-s4 flex flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s4">
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="ausschreibung" value={id} />
                <label className="flex min-w-[14rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                  Position
                  <select name="position" required
                          className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text">
                    {m.positionen.map((p) => (
                      <option key={p.id} value={p.id}>{p.position}. {p.bezeichnung}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[14rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                  Datei
                  <input type="file" name="datei" required
                         className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-sm text-text" />
                </label>
                <Button type="submit" variante="secondary" data-cse="unterlage-beilegen">
                  Beilegen
                </Button>
                <p className="w-full text-xs text-text-subtle">
                  Der Dateityp wird an den Magic Bytes geprüft, nicht am Namen, und Metadaten
                  werden vor dem Speichern entfernt. Beigelegt heisst noch nicht geprüft.
                </p>
              </form>
            ) : null}

            <form method="post" action="/api/vergabe/mappe" data-cse="mappe-position-neu"
                  className="mt-s4 flex flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s4">
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="ausschreibung" value={id} />
              <input type="hidden" name="mappe" value={m.mappeId} />
              <input type="hidden" name="was" value="position_neu" />
              <label className="flex min-w-[16rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                Geforderte Unterlage
                <input type="text" name="bezeichnung" required maxLength={200}
                       placeholder="z. B. Formblatt 124 Eigenerklärung zur Eignung"
                       className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
              </label>
              <label className="flex min-w-[10rem] flex-col gap-s2 text-xs text-text-muted">
                Art (frei)
                <input type="text" name="kategorie" maxLength={80}
                       className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
              </label>
              <label className="flex items-center gap-s2 py-s3 text-sm text-text">
                <input type="checkbox" name="pflicht" value="1" defaultChecked
                       className="size-4 rounded border-line" />
                Pflicht
              </label>
              <Button type="submit" variante="secondary" data-cse="position-hinzufuegen">
                Position hinzufügen
              </Button>
            </form>
          </>
        ) : null}
      </section>

      <section className="mb-s6 max-w-prose">
        <h2 className="mb-s2 text-h2 text-text">Vergabeunterlagen der Quelle</h2>
        {m.quellDokumente.length === 0 ? (
          <p className="text-sm text-text-muted" data-cse="mappe-quelldokumente-leer">
            Die Quelle hat zu dieser Bekanntmachung keine Dokumente mitgeliefert. Herunterladen
            kann diese Plattform sie ohnehin noch nicht — was hier steht, sind die Angaben der
            Quelle, nicht ihre Dateien.
          </p>
        ) : (
          <ul className="flex flex-col gap-s2 text-sm" data-cse="mappe-quelldokumente">
            {m.quellDokumente.map((d) => (
              <li key={d.id} className="rounded-md border border-line bg-surface p-s3">
                <span className="text-text">{d.bezeichnung}</span>
                {d.gesperrt ? (
                  <span className="block text-xs text-warning">
                    Die Plattform verlangt eine Anmeldung für dieses Dokument (RAD-09).
                  </span>
                ) : null}
                {d.url === null ? null : (
                  <a href={d.url} target="_blank" rel="noopener noreferrer"
                     className="block truncate text-xs text-text-muted underline underline-offset-4">
                    {d.url}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s2 text-h2 text-text">Einreichung</h2>
        {m.eingereichtAm !== null ? (
          <p className="text-sm text-text-muted">
            Erfasst. Eine zweite Erfassung würde die erste überschreiben und ist deshalb gesperrt.
          </p>
        ) : darfEinreichen ? (
          <>
            <p className="mb-s3 text-sm text-text-muted">
              Hochgeladen wird auf der Plattform, von Hand — es gibt dafür keine Schnittstelle
              (D-07). Hier wird nur festgehalten, dass es geschehen ist.
            </p>
            <Link href={`/portal/${mandant}/radar/${id}/mappe/einreichung`}
                  className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:opacity-90"
                  data-cse="mappe-zur-einreichung">
              Einreichung erfassen
            </Link>
          </>
        ) : (
          <p className="text-sm text-text-muted">
            Eine Einreichung erfasst, wer{' '}
            <span className="font-mono">vergabe.einreichung_erfassen</span> hält.
          </p>
        )}
      </section>


      {m.eingereichtAm !== null ? (
        <section className="mt-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="mappe-ausgang">
          <h2 className="mb-s2 text-h2 text-text">Ergebnis des Verfahrens</h2>
          {AUSGAENGE_TEXT[m.vorgangStatus] !== undefined ? (
            <p className="text-sm text-text" data-cse="mappe-ausgang-erfasst">
              <strong>{AUSGAENGE_TEXT[m.vorgangStatus]}</strong>
              {m.entschiedenAm === null ? '' : `, entschieden am ${m.entschiedenAm}`}
              {m.zuschlagswertCent === null
                ? ''
                : ` — Auftragswert ${formatiereGeld(cent(m.zuschlagswertCent))}`}.
            </p>
          ) : darfEinreichen ? (
            <>
              <p className="mb-s3 text-sm text-text-muted">
                Drei Ausgänge hat ein deutsches Vergabeverfahren, und nur diese drei. Ohne sie
                lässt sich „gefunden · geprüft · geboten · gewonnen" nicht rechnen (REP-06).
              </p>
              <form method="post" action="/api/vergabe/ausgang" data-cse="ausgang-formular"
                    className="flex flex-col gap-s3">
                <input type="hidden" name="mandant" value={mandant} />
                <input type="hidden" name="ausschreibung" value={id} />
                <div className="flex flex-wrap gap-s3">
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                    Entschieden am
                    <input type="date" name="entschieden_am" required
                           className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
                  </label>
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-s2 text-xs text-text-muted">
                    Auftragswert (nur beim Zuschlag)
                    <input type="text" name="wert" inputMode="decimal" placeholder="486.000,00"
                           className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-s2">
                  <Button type="submit" name="ausgang" value="zuschlag" variante="secondary"
                          data-cse="ausgang-zuschlag">
                    Zuschlag
                  </Button>
                  <Button type="submit" name="ausgang" value="nicht_beruecksichtigt"
                          variante="ghost" data-cse="ausgang-abgelehnt">
                    Nicht berücksichtigt
                  </Button>
                  <Button type="submit" name="ausgang" value="verfahren_aufgehoben"
                          variante="secondary" data-cse="ausgang-aufgehoben">
                    Verfahren aufgehoben
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-text-muted">
              Das Ergebnis erfasst, wer{' '}
              <span className="font-mono">vergabe.einreichung_erfassen</span> hält.
            </p>
          )}
        </section>
      ) : null}

      {!darfSchreiben ? (
        <p className="mt-s5 max-w-prose text-xs text-text-muted">
          Die Mappe führt, wer <span className="font-mono">vergabe.schreiben</span> hält.
        </p>
      ) : null}
    </PortalRahmen>
  );
}
