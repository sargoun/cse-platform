import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { DataTable } from '@/components/ui/DataTable';
import { SETZBAR } from '@/server/services/radar/vorgang';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { kennungOder404 } from '../../../../kennung';
import {
  leseRadarZeile, leseStandHistorie, leseVorgang,
  type RadarZeile, type StandEreignis, type VorgangBlick,
} from '../../daten';
import { fristKlasse, fristText, istKnapp } from '../../frist';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/radar/[id]/status` — die Übergangssteuerung (RAD-06,
 * RAD-07, REP-06, D-07).
 *
 * **Drei Stände, und jeder mit seiner Bedingung davor.** `geprueft` geht
 * immer. `verworfen` verlangt einen Grund — das Formular macht ihn zur
 * Pflicht, weil der Dienst sonst abweist und die Datenbank es ein zweites Mal
 * tut (`av_verworfen_begruendet`); in einem halben Jahr ist „warum haben wir
 * das damals liegen lassen" eine echte Frage. `in_bearbeitung` verlangt das
 * Recht `vergabe.schreiben` — **nicht eine vorhandene Vergabemappe**: der
 * Dienst legt sie selbst an, idempotent. Ein Verweis „erst Mappe anlegen"
 * hätte eine Handlung weggenommen, die es gibt.
 *
 * **Einen Knopf „einreichen" gibt es hier nicht** (D-07). Die deutschen
 * Vergabeplattformen bieten für eine Abgabe keine Schnittstelle an; die
 * Abgabe ist von Hand, absichtlich. Festgehalten wird sie unter dem eigenen
 * Recht `vergabe.einreichung_erfassen` auf `/radar/[id]/mappe/einreichung` —
 * als Protokoll, nicht als Übertragung.
 *
 * **Die Historie kommt aus dem `audit_log`** und nicht aus
 * `ausschreibung_vorgang`: die Tabelle führt eine Zeile je Bekanntmachung und
 * überschreibt bei jedem Stand `status_geaendert_am/_von`, also existiert
 * dort keine Historie. Der Dienst protokolliert jeden Stand
 * (`radar.stand_gesetzt`), und das ist die Quelle, an der sich die Zahlen des
 * Pipeline-Berichts (REP-06) nachlesen lassen.
 *
 * **Sie öffnet mit `radar.status_setzen` — und lebt von `radar.lesen`.** Das
 * Tor der Route ist das erste Recht; gelesen wird aber aus `ausschreibung` und
 * `bewertung`, deren Policies das zweite verlangen. Eine Sitzung ohne
 * `radar.lesen` bekommt hier ein 404, nicht eine halb gefüllte Seite — die
 * Datenbank entscheidet das, nicht diese Datei. Früher stand hier, die Seite
 * öffne „mit `radar.status_setzen` allein"; wer das las, hielt die zweite
 * Bedingung für unnötig.
 *
 * **Die Frist wird nicht gerechnet, sie wird gelesen.** `restTage` kommt aus
 * der Datenbank (Invariante 5, `floor(epoch/86400)` gegen `now()`); die
 * Fünf-Tage-Grenze steht in `./frist` und stammt aus RAD-06.
 */
export const dynamic = 'force-dynamic';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

/** Die Stände in Worten — Darstellung, keine Regel. */
const STAND_TEXT: Readonly<Record<string, string>> = {
  neu: 'neu — noch nicht angesehen',
  geprueft: 'geprüft',
  in_bearbeitung: 'in Bearbeitung',
  eingereicht: 'eingereicht',
  verworfen: 'verworfen',
  zuschlag: 'Zuschlag',
  nicht_beruecksichtigt: 'nicht berücksichtigt',
  verfahren_aufgehoben: 'Verfahren aufgehoben',
};

/** Was das Setzen dieses Standes bedeutet — und was es auslöst. */
const ZIEL_TEXT: Readonly<Record<string, string>> = {
  geprueft: 'Angesehen und für passend gehalten. Löst nichts aus; er sagt nur, dass diese '
    + 'Bekanntmachung nicht mehr unbesehen in der Liste steht.',
  in_bearbeitung: 'Jemand fängt an, die geforderten Unterlagen zusammenzutragen. Legt die '
    + 'Vergabemappe an — die Prüfliste der geforderten Unterlagen (idempotent: eine '
    + 'vorhandene Mappe bleibt, wie sie ist).',
  verworfen: 'Wir bieten nicht. Verlangt einen Grund (RAD-07) — mindestens fünf Zeichen.',
};

export default async function Standseite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const tor = await mandantTor(`/portal/${mandant}/radar/${id}/status`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/radar/[id]/mappe` verlangt `vergabe.schreiben`,
   * `/radar/[id]/mappe/einreichung` `vergabe.einreichung_erfassen` (Manifest).
   * Jeder Verweis, dessen Ziel diese Sitzung nicht öffnen darf, verrät, was er
   * nicht zeigen darf (AUT-06, D-581).
   *
   * **`radar.lesen` steht hier, obwohl es nie `false` sein kann.** Das Tor der
   * Route verlangt `radar.status_setzen`; die Daten kommen aber aus
   * `ausschreibung` und `bewertung`, und beide Lesepolicies
   * (`r_ausschreibung_lesen`, `bewertung.t_lesen`) fordern `radar.lesen` —
   * ohne das Recht liefert `leseRadarZeile` null Zeilen, und unten steht
   * `notFound()` für die GANZE Seite. Wer den Verweis unten überhaupt zu
   * sehen bekommt, hält das Recht also schon.
   *
   * Die Frage bleibt trotzdem stehen, und zwar mit Absicht: `verweis-rechte`
   * prüft statisch, dass JEDER Verweis, dessen Ziel ein Recht verlangt, an
   * einem Recht hängt, das die Seite selbst erhoben hat (AUT-06, D-581). Diese
   * Wache kann von der Policy nichts wissen; ein unbedingter Verweis fiele ihr
   * auf, und sie hätte recht — die Herleitung steht in diesem Kommentar und
   * nicht im Code. Der Kopfkommentar behauptete früher, die Seite öffne „mit
   * `radar.status_setzen` allein"; das war die eigentliche Falschaussage.
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'radar.lesen', 'vergabe.schreiben', 'vergabe.einreichung_erfassen',
    'system.benutzer_lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeilen = await leseRadarZeile(kontext, id);
      if (zeilen[0] === undefined) return null;
      const vorgang = await leseVorgang(kontext, id);
      return {
        zeilen,
        vorgang,
        historie: vorgang === null
          ? [] : await leseStandHistorie(kontext, vorgang.id),
      };
    })) as Promise<{
      zeilen: readonly RadarZeile[];
      vorgang: VorgangBlick | null;
      historie: readonly StandEreignis[];
    } | null>);

  if (daten === null) notFound();
  const kopf = daten.zeilen[0];
  if (kopf === undefined) notFound();
  const { vorgang, historie } = daten;
  const stand = vorgang?.status ?? 'neu';
  const darfMappe = darf['vergabe.schreiben'] === true;
  const namenSichtbar = darf['system.benutzer_lesen'] === true;

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
    + 'text-base text-text';

  return (
    <PortalRahmen
      titel="Stand setzen"
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
          <h1 className="text-h1 text-text">Stand setzen</h1>
          <p className="mt-s2 max-w-prose text-sm text-text-muted">{kopf.titel}</p>
        </div>
        {darf['radar.lesen'] === true ? (
          <Link href={`/portal/${mandant}/radar/${id}`} data-cse="status-zur-bekanntmachung"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zur Bekanntmachung
          </Link>
        ) : null}
      </div>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="status-abgewiesen" className="mb-s5 max-w-prose">
          <strong>Nicht geändert.</strong>{' '}
          {fehler === 'grund'
            ? 'Ein Verwerfen braucht einen Grund — RAD-07 verlangt ihn, und in einem '
              + 'halben Jahr erinnert sich niemand mehr ohne ihn.'
            : fehler === 'mappe_recht'
              ? '„In Bearbeitung" legt die Vergabemappe an — dafür fehlt das Recht '
                + 'vergabe.schreiben.'
              : 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {kopf.quellStatus !== 'aktiv' ? (
        <Hinweis art="warnung" cse="status-quellstatus" className="mb-s5 max-w-prose">
          <strong>
            {kopf.quellStatus === 'aufgehoben'
              ? 'Das Verfahren ist aufgehoben.'
              : 'Die Quelle liefert diese Bekanntmachung nicht mehr.'}
          </strong>{' '}
          Die Frist zählt nicht weiter, und ein Angebot wäre vergeblich. Ein Stand lässt
          sich trotzdem setzen — festzuhalten, dass wir nicht geboten haben, bleibt richtig.
        </Hinweis>
      ) : null}

      {/* ------------------------------------------------- Stand und Frist */}
      <dl data-cse="status-lage"
          className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Aktueller Stand</dt>
        <dd className="text-text" data-cse="status-aktuell" data-stand={stand}>
          {STAND_TEXT[stand] ?? stand}
          {vorgang === null
            ? ' — es ist noch kein Vorgang eröffnet; der erste gesetzte Stand eröffnet ihn.'
            : ''}
        </dd>
        <dt className="text-text-muted">Abgabefrist</dt>
        <dd data-cse="status-frist" data-rest={String(kopf.restTage ?? '')}>
          <span className="flex flex-wrap items-center gap-s2">
            {kopf.restTage !== null && kopf.restTage < 0
              ? <StatusPill zustand="Überfällig" />
              : istKnapp(kopf.restTage)
                ? <StatusPill zustand="Wartet" />
                : null}
            <span className={`text-sm ${fristKlasse(kopf.restTage)}`}>
              {fristText(kopf.restTage)}
              {kopf.fristAngebot === null ? '' : ` · ${BERLIN.format(kopf.fristAngebot)}`}
            </span>
          </span>
          {istKnapp(kopf.restTage) ? (
            <span className="mt-s1 block text-xs text-danger">
              Unter fünf Tagen (RAD-06): Unterlagen, Rückfragen und — ohne Freischaltung —
              die Registrierung brauchen länger.
            </span>
          ) : null}
        </dd>
        {vorgang?.fristSnapshot === null || vorgang === null ? null : (
          <>
            <dt className="text-text-muted">Frist bei Eröffnung</dt>
            <dd className="text-text" data-cse="status-frist-snapshot">
              {BERLIN.format(vorgang.fristSnapshot)}
              {vorgang.fristAbweichungSeit === null
                ? ''
                : ' — weicht von der geltenden ab: eine Änderungsbekanntmachung. '
                  + 'Der Schnappschuss wird nicht nachgezogen, damit es auffällt.'}
            </dd>
          </>
        )}
        {vorgang === null ? null : (
          <>
            <dt className="text-text-muted">Zuletzt gesetzt</dt>
            <dd className="text-text">
              {vorgang.statusGeaendertAm === null
                ? '—' : BERLIN.format(vorgang.statusGeaendertAm)}
              {vorgang.statusGeaendertVon !== null
                ? ` · ${vorgang.statusGeaendertVon}`
                : namenSichtbar ? '' : ' · Name hier nicht sichtbar'}
            </dd>
          </>
        )}
        {vorgang?.verworfenGrund === null || vorgang === null ? null : (
          <>
            <dt className="text-text-muted">Verwerfungsgrund</dt>
            <dd className="text-text" data-cse="status-verworfen-grund">
              {vorgang.verworfenGrund}
            </dd>
          </>
        )}
      </dl>

      {/* ------------------------------------------------------ Die Übergänge */}
      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
               data-cse="status-uebergaenge">
        <h2 className="mb-s2 text-h2 text-text">Wohin</h2>
        <ul className="mb-s4 flex flex-col gap-s3">
          {SETZBAR.map((ziel) => {
            const gesperrt = ziel === 'in_bearbeitung' && !darfMappe;
            return (
              <li key={ziel} data-cse="status-ziel" data-ziel={ziel}
                  data-moeglich={gesperrt ? '0' : '1'}
                  className="rounded-md border border-line bg-surface-2 p-s3 text-sm">
                <span className="text-text">{STAND_TEXT[ziel] ?? ziel}</span>
                <span className="mt-s1 block text-xs text-text-muted">{ZIEL_TEXT[ziel]}</span>
                {gesperrt ? (
                  <span className="mt-s1 block text-xs text-warning"
                        data-cse="status-ziel-gesperrt">
                    Dafür fehlt das Recht <Recht schluessel="vergabe.schreiben" /> — die Mappe anzulegen
                    ist eine eigene Befugnis. Die beiden anderen Stände bleiben möglich.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <form method="post" action="/api/radar/vorgang" data-cse="status-formular"
              className="flex flex-col gap-s3">
          {/*
            * `zurueck` bringt Absagen HIERHER zurück statt auf die
            * Detailseite — der Fehlerblock oben wertet `?fehler=grund` und
            * `?fehler=mappe_recht` aus, und ohne dieses Feld erreichte ihn
            * nichts. Der Name wird in der Route über eine Karte aufgelöst
            * (`FORMULARSEITE`), nie als Pfad eingesetzt.
            *
            * Kein verstecktes `mandant`-Feld: den Bereich nimmt die Route aus
            * `app.aktiver_mandant()` (Invariante 3).
            */}
          <input type="hidden" name="zurueck" value="status" />
          <input type="hidden" name="ausschreibung" value={id} />
          <input type="hidden" name="profil" value={kopf.profilId} />
          <input type="hidden" name="bewertung" value={kopf.bewertungId} />
          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="grund">
            Grund (bei „verworfen" verpflichtend, mindestens 5 Zeichen)
            <input id="grund" type="text" name="grund" maxLength={500} className={feld}
                   data-cse="status-grund" />
          </label>
          <div className="flex flex-wrap gap-s2">
            <Button type="submit" name="status" value="geprueft" variante="secondary"
                    data-cse="status-geprueft">
              Geprüft
            </Button>
            {darfMappe ? (
              <Button type="submit" name="status" value="in_bearbeitung" variante="primary"
                      data-cse="status-in-bearbeitung">
                In Bearbeitung
              </Button>
            ) : null}
            <Button type="submit" name="status" value="verworfen" variante="danger"
                    data-cse="status-verworfen">
              Verwerfen
            </Button>
          </div>
          <p className="text-xs text-text-subtle">
            Nach dem Setzen führt der Weg auf die Bekanntmachung zurück — dort steht der
            Stand im Zusammenhang mit Punktzahl, Frist und Plattformstand.
          </p>
        </form>
      </section>

      {/* ------------------------------------------------- Was hier NICHT steht */}
      <Hinweis art="hinweis" cse="status-kein-einreichen" className="mb-s6 max-w-prose">
        <strong>„Eingereicht" ist hier nicht setzbar</strong> — und einen Knopf „jetzt
        einreichen" gibt es nirgends (D-07): keine der deutschen Vergabeplattformen bietet
        dafür eine Schnittstelle an, die Abgabe läuft von Hand. Festgehalten wird sie
        unter dem eigenen Recht <Recht schluessel="vergabe.einreichung_erfassen" />
        {' '}als Nachweis — wer, wann, wo.
        {darf['vergabe.einreichung_erfassen'] === true && vorgang !== null
          && vorgang.hatMappe ? (
            <>
              {' '}
              <Link href={`/portal/${mandant}/radar/${id}/mappe/einreichung`}
                    data-cse="status-zur-einreichung" className="underline underline-offset-2">
                Einreichung erfassen
              </Link>.
            </>
          ) : null}
        {' '}Die Ausgänge (Zuschlag, nicht berücksichtigt, Verfahren aufgehoben) gehören
        zur Vergabemappe und kommen mit ihr — sie brauchen mehr als einen Knopf.
      </Hinweis>

      {/* -------------------------------------------------------- Die Historie */}
      <h2 className="mb-s3 text-h2 text-text">Was gesetzt wurde</h2>
      {historie.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
           data-cse="status-historie-leer">
          {vorgang === null
            ? 'Noch kein Stand gesetzt — es gibt zu dieser Bekanntmachung keinen Vorgang.'
            : 'Kein Protokolleintrag zu diesem Vorgang. Der Stand steht also nicht von '
              + 'dieser Oberfläche (etwa aus dem Seed oder aus einem Job).'}
        </p>
      ) : (
        <>
          <DataTable
            beschriftung="Protokoll der gesetzten Stände mit Zeitpunkt und Person"
            zeilen={historie}
            schluessel={(e) => e.id}
            spalten={[
              {
                schluessel: 'am',
                kopf: 'Wann',
                zelle: (e) => BERLIN.format(e.am),
              },
              {
                schluessel: 'stand',
                kopf: 'Stand',
                zelle: (e) => (e.status === null
                  ? '—' : STAND_TEXT[e.status] ?? e.status),
              },
              {
                schluessel: 'wer',
                kopf: 'Wer',
                zelle: (e) => (e.akteurName !== null
                  ? e.akteurName
                  : e.akteurTyp !== 'mensch'
                    ? e.akteurTyp
                    : namenSichtbar
                      ? 'kein benannter Mensch'
                      : 'Name hier nicht sichtbar'),
              },
              {
                schluessel: 'grund',
                kopf: 'Grund',
                zelle: (e) => (e.mitGrund ? 'mit Grund' : 'ohne Grund'),
              },
            ]}
          />
          <p className="mt-s3 max-w-prose text-xs text-text-subtle">
            Das Protokoll hält fest, DASS ein Grund angegeben wurde, nicht seinen Wortlaut —
            er stünde sonst ein zweites Mal in einer Tabelle, aus der nicht gelöscht wird.
            Der Wortlaut des geltenden Verwerfungsgrundes steht oben; ältere sind mit ihrem
            Stand überschrieben, weil der Vorgang genau eine Zeile führt.
            {namenSichtbar ? '' : ' Namen sind hier nicht sichtbar — dafür braucht es das '
              + 'Recht system.benutzer_lesen.'}
          </p>
        </>
      )}
    </PortalRahmen>
  );
}
