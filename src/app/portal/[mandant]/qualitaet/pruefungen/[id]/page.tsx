import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import {
  ERGEBNIS_TEXT, findePruefung, ladeBefunde,
  type BefundZeile, type PruefungZeile,
} from '@/server/services/reinigung/qualitaet';

/**
 * `/portal/[mandant]/qualitaet/pruefungen/[id]` — das Prüfprotokoll (OPS-11,
 * SPEC §22).
 *
 * **Geräte- und Serverzeit stehen GETRENNT** (Invariante 5). `geprueft_am`
 * setzt der Auslöser `kern.qualitaetspruefung_feldzeit` beim INSERT auf
 * `now()` — die Serveruhr; `geraete_zeit` ist, was das Telefon behauptet, und
 * `zeitabweichung_sek` die Differenz. Die beiden in ein Feld zu falten wäre
 * genau der Griff, den Invariante 5 verbietet: dann wäre nicht mehr
 * feststellbar, ob eine Prüfung um 06:12 oder um 06:12 nach einer falsch
 * gestellten Uhr erfasst wurde.
 *
 * **Es gibt kein „bestanden", und der Satz sagt warum.** Das Verfahren ist ein
 * Platzhalter ohne Skala und ohne Schwelle (O-29); `bestanden` bleibt NULL —
 * nicht `false`. Ein leeres Feld ohne Erklärung liest sich als „noch nicht
 * bewertet", und das wäre eine andere Aussage.
 *
 * **Überfällige Fristen sind farbig UND im Text markiert** (DESIGN §9): ein
 * rotes Datum allein erreicht einen farbenblinden Leser nicht.
 *
 * **Dieses Blatt ist lesend, und das ist eine Entscheidung gegen eine stille.**
 * `qualitaetspruefung` trägt `archiviert_am` und `loeschsperre`, aber kein
 * `ersetzt_durch_id` wie das Wachbuch — wie eine falsch erfasste Prüfung
 * berichtigt wird, ist nicht entschieden. Gelöscht wird sie ohnehin nie
 * (Invariante 8).
 *
 * // TODO(client, O-704): Wie wird eine falsch erfasste Qualitätsprüfung berichtigt — durch eine ersetzende Prüfung mit Verweis auf die alte (wie im Wachbuch), durch Archivieren mit Grund, oder ist eine Korrektur der Felder zulässig?
 *
 * **Ein Mangel wird hier nicht zur Reklamation.**
 * `qualitaetspruefung_position` trägt `mangel_beschreibung` und `frist_am`,
 * aber keinen Schlüssel auf `reklamation` oder `aufgabe` — in der anderen
 * Richtung schon (`reklamation.qualitaetspruefung_position_id`). Eine
 * Verknüpfung „Mangel wird Reklamation" zu bauen, hiesse zu entscheiden, wann
 * das geschieht und wer es tut.
 *
 * // TODO(client, O-705): Was folgt auf einen Mangel mit Frist — entsteht daraus automatisch eine Reklamation oder eine Aufgabe, und wer ist verantwortlich, wenn die Frist verstreicht?
 */
export const dynamic = 'force-dynamic';

const UNGEPRUEFT = 'nicht geprüft';

function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

export default async function PruefungBlatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const angelegt = typeof suche['angelegt'] === 'string' ? suche['angelegt'] : null;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/qualitaet/pruefungen/${id}`, mandant,
  );
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: Objekt, Revier, Dokument und der Medienweg liegen hinter anderen
     Rechten als dieses Blatt. Ein Verweis ohne das Recht dahinter führt auf 404
     und verrät, was er nicht zeigen darf. */
  const darf = await haeltRechte(
    sitzung, 'objekt.lesen', 'reinigung.lesen', 'zeit.lesen', 'dokument.lesen',
  );

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await findePruefung(kontext, id);
      if (kopf === null) return { kopf: null } as const;
      return { kopf, befunde: await ladeBefunde(kontext, kopf.id) } as const;
    })) as Promise<{
      readonly kopf: PruefungZeile | null;
      readonly befunde?: readonly BefundZeile[];
    }>);

  // AUT-06: eine fremde Prüfung ist nicht vorhanden, nicht verboten.
  if (daten.kopf === null) notFound();
  const q = daten.kopf;
  const befunde = daten.befunde ?? [];
  const nio = befunde.filter((b) => b.ergebnis === 'nio');
  const ueberfaellig = befunde.filter((b) => b.fristUeberfaellig);

  return (
    <PortalRahmen
      titel={q.nummer}
      wurzelTitel="Qualität"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/qualitaet/pruefungen`, text: 'Alle Prüfungen' }}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{q.nummer}</h1>
        <div className="flex flex-wrap items-baseline gap-s3">
          {q.archiviert && <StatusPill zustand="Archiviert" />}
          {q.nachgetragen && <StatusPill zustand="Wartet" />}
        </div>
      </div>

      {angelegt !== null && (
        <Hinweis art="erfolg" cse="pruefung-angelegt" className="mb-s5 max-w-prose">
          <strong>Prüfung {angelegt} erfasst.</strong> Nummer und Prüfzeitpunkt hat
          die Anwendung vergeben — die Serveruhr, nicht das Gerät (Invariante 5).
        </Hinweis>
      )}

      {/* --- Kopfblatt ------------------------------------------------------ */}
      <div className="mb-s6 grid grid-cols-1 gap-s4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Bezug</div>
          <p className="m-0 mt-s2 text-sm text-text">
            {q.objektId === null ? (
              q.projektId === null ? '—' : 'Projekt (Bau)'
            ) : q.objekt === null ? (
              <span className="text-text-muted">Objekt {UNGEPRUEFT}</span>
            ) : darf['objekt.lesen'] === true ? (
              <Link
                href={`/portal/${mandant}/objekte/${q.objektId}`}
                className="underline hover:text-text"
              >
                {q.objekt}
              </Link>
            ) : q.objekt}
          </p>
          <p className="m-0 mt-s2 text-sm text-text-muted">
            {q.revierId === null ? 'Ganzes Objekt, kein Revier' : (
              q.revier === null ? `Revier ${UNGEPRUEFT}` : (
                darf['reinigung.lesen'] === true ? (
                  <Link
                    href={`/portal/${mandant}/reinigung/reviere/${q.revierId}`}
                    className="underline hover:text-text"
                  >
                    {q.revier}
                  </Link>
                ) : q.revier
              )
            )}
            <br />
            {q.kundeId === null ? 'Kein Kunde am Bezug' : (q.kunde ?? `Kunde ${UNGEPRUEFT}`)}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Prüfzeitpunkt (Serveruhr)
          </div>
          <p className="m-0 mt-s2 text-sm tabular-nums text-text">{q.gepruefLokal}</p>
          {/*
            Invariante 5: die Serveruhr ist die Quelle, die Gerätezeit steht
            DANEBEN. Zusammengefaltet liesse sich nicht mehr feststellen, ob
            eine Prüfung nach einer falsch gestellten Uhr erfasst wurde.
          */}
          <p className="m-0 mt-s3 text-sm text-text-muted">
            Die Zeit setzt der Server beim Erfassen, nicht das Gerät.
            <br />
            Gerätezeit:{' '}
            {q.geraeteZeitLokal === null ? (
              'nicht mitgeschickt'
            ) : (
              <span className="tabular-nums text-text">{q.geraeteZeitLokal}</span>
            )}
            <br />
            Abweichung:{' '}
            {q.zeitabweichungSek === null ? (
              '—'
            ) : (
              <span
                className={Math.abs(q.zeitabweichungSek) > 120
                  ? 'tabular-nums text-warning' : 'tabular-nums'}
                data-cse="zeitabweichung"
              >
                {q.zeitabweichungSek > 0 ? '+' : ''}
                {q.zeitabweichungSek} s
                {Math.abs(q.zeitabweichungSek) > 120
                  && ' — die Geräteuhr geht deutlich falsch'}
              </span>
            )}
            {q.nachgetragen && (
              <>
                <br />
                <span className="text-warning">
                  <Icon
                    name="warnung"
                    groesse="sm"
                    className="mr-s2 inline-block align-[-2px]"
                  />
                  Nachgetragen — nicht im Feld erfasst.
                </span>
              </>
            )}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Verfahren</div>
          <p className="m-0 mt-s2 text-sm text-text">{q.verfahren}</p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {q.verfahrenIstPlatzhalter && (
              <span className="text-warning">Platzhalter ohne Skala (O-29)</span>
            )}
            {q.verfahrenMaxPunkte === null
              ? ' — das Verfahren trägt keine Skala, also gibt es keinen Erfüllungsgrad.'
              : ` — Skala bis ${deutsch(q.verfahrenMaxPunkte)} Punkte.`}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Prüfer</div>
          <p className="m-0 mt-s2 text-sm text-text">
            {q.prueferName ?? q.prueferExternName
              ?? (q.prueferAnstellungId === null ? '—' : UNGEPRUEFT)}
          </p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {q.prueferExternName !== null && q.prueferName === null
              ? 'Externer Prüfer (Name erfasst, keine Anstellung).'
              : 'Eigene Beschäftigung.'}
            <br />
            Mit Kunde: {q.mitKunde ? 'ja — der Kunde war anwesend' : 'nein'}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Bewertung</div>
          {/*
            Statt eines Bestanden-Felds steht hier der Grund, warum es keines
            gibt. `bestanden` bleibt NULL — nicht `false` (K-17, O-29).
          */}
          <p className="m-0 mt-s2 text-sm text-text" data-cse="keine-bewertung">
            {q.bestanden === null
              ? 'Kein Urteil'
              : q.bestanden ? 'Bestanden' : 'Nicht bestanden'}
          </p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {q.bestanden === null
              ? 'Auslöser, Skala, Bestehensschwelle und die Folge einer nicht '
                + 'bestandenen Prüfung sind nicht festgelegt (O-29). Deshalb steht '
                + 'hier kein Urteil — und ausdrücklich nicht „nicht bestanden".'
              : 'Ein Urteil steht nur, wenn das Verfahren eine Schwelle trägt.'}
            {q.punkte !== null && (
              <>
                <br />
                Punkte {deutsch(q.punkte)} von {deutsch(q.maxPunkte)}
                {q.erfuellungsgradProzent !== null
                  && ` — ${deutsch(q.erfuellungsgradProzent)} %`}
              </>
            )}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Befunde</div>
          <div className="mt-s1 text-h2 tabular-nums text-text">
            {befunde.length}
          </div>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            davon{' '}
            <span className={nio.length > 0 ? 'text-warning' : ''}>
              {nio.length} nicht in Ordnung
            </span>
            {ueberfaellig.length > 0 && (
              <>
                {', '}
                <span className="text-danger">
                  {ueberfaellig.length} Frist(en) überfällig
                </span>
              </>
            )}
          </p>
        </Card>
      </div>

      {(q.bemerkung !== null || q.dokumentId !== null) && (
        <section className="mb-s6" data-cse="pruefung-bemerkung">
          <h2 className="mb-s4 text-h3 text-text">Bemerkung und Dokument</h2>
          <Card>
            {q.bemerkung !== null && (
              <p className="m-0 max-w-prose whitespace-pre-line text-sm text-text">
                {q.bemerkung}
              </p>
            )}
            <p className="m-0 mt-s3 text-sm text-text-muted">
              {q.dokumentId === null ? 'Kein Dokument hinterlegt.'
                : darf['dokument.lesen'] === true ? (
                  <>
                    Dokument:{' '}
                    <Link
                      href={`/portal/${mandant}/dokumente/${q.dokumentId}`}
                      className="underline hover:text-text"
                    >
                      hinterlegt
                    </Link>
                  </>
                ) : 'Ein Dokument ist hinterlegt (Ablage liegt hinter dokument.lesen).'}
            </p>
          </Card>
        </section>
      )}

      {ueberfaellig.length > 0 && (
        <Hinweis art="warnung" cse="pruefung-fristen" className="mb-s6 max-w-prose">
          <strong>
            {ueberfaellig.length} Mängelfrist(en) sind verstrichen.
          </strong>{' '}
          Was daraus folgt, ist nicht entschieden (O-705): es entsteht keine
          Reklamation und keine Aufgabe von selbst, und niemand ist automatisch
          verantwortlich. Eine Beanstandung lässt sich unter{' '}
          <Link
            href={`/portal/${mandant}/qualitaet/reklamationen/neu`}
            className="underline underline-offset-2"
          >
            Reklamationen
          </Link>{' '}
          erfassen — von Hand, mit Verweis auf diese Prüfung.
        </Hinweis>
      )}

      {/* --- Die Befunde ---------------------------------------------------- */}
      <section data-cse="pruefung-befunde">
        <h2 className="mb-s4 text-h3 text-text">Befunde in Prüfreihenfolge</h2>

        {befunde.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Zu dieser Prüfung ist kein Befund erfasst. Eine Prüfung ohne Befund
            belegt nichts — auch nicht, dass alles in Ordnung war.
          </p>
        ) : (
          <DataTable<BefundZeile>
            beschriftung="Befunde mit Kriterium, Raum, Ergebnis, Mangel und Frist"
            zeilen={befunde}
            schluessel={(b) => b.id}
            spalten={[
              {
                schluessel: 'nr',
                kopf: 'Nr.',
                numerisch: true,
                zelle: (b) => String(b.reihenfolge + 1),
              },
              { schluessel: 'kriterium', kopf: 'Kriterium', zelle: (b) => b.kriterium },
              {
                schluessel: 'raum',
                kopf: 'Raum',
                zelle: (b) => (b.raum
                  ?? (b.raumId === null
                    ? (b.revierRaumId === null ? '—' : 'Revierraum')
                    : UNGEPRUEFT)),
              },
              {
                schluessel: 'ergebnis',
                kopf: 'Ergebnis',
                zelle: (b) => (
                  /* §9: das WORT trägt die Bedeutung, nicht die Farbe. */
                  <span
                    className={b.ergebnis === 'nio' ? 'text-warning'
                      : b.ergebnis === 'io' ? 'text-success' : 'text-text-muted'}
                    data-cse="befund-ergebnis"
                    data-ergebnis={b.ergebnis}
                  >
                    {b.ergebnis === 'nio' && (
                      <Icon
                        name="warnung"
                        groesse="sm"
                        className="mr-s2 inline-block align-[-2px]"
                      />
                    )}
                    {ERGEBNIS_TEXT[b.ergebnis]}
                  </span>
                ),
              },
              {
                schluessel: 'punkte',
                kopf: 'Punkte',
                numerisch: true,
                zelle: (b) => deutsch(b.punkte),
              },
              {
                schluessel: 'mangel',
                kopf: 'Mangel',
                zelle: (b) => b.mangelBeschreibung ?? '—',
              },
              {
                schluessel: 'frist',
                kopf: 'Frist',
                zelle: (b) => {
                  if (b.fristAm === null) return '—';
                  /* Farbe UND Text (DESIGN §9): ein rotes Datum allein erreicht
                     einen farbenblinden Leser nicht. */
                  return b.fristUeberfaellig ? (
                    <span className="text-danger" data-cse="befund-frist-ueberfaellig">
                      <Icon
                        name="fehler"
                        groesse="sm"
                        className="mr-s2 inline-block align-[-2px]"
                      />
                      <span className="tabular-nums">{b.fristAm}</span> — überfällig
                    </span>
                  ) : (
                    <span className="tabular-nums">{b.fristAm}</span>
                  );
                },
              },
              {
                schluessel: 'foto',
                kopf: 'Foto',
                /*
                  Der Medienweg läuft über `/api/medien/[id]` und damit über
                  eine signierte, kurzlebige Adresse — nie über einen
                  öffentlichen Bucket-Pfad. Dieser Handler autorisiert auf
                  `zeit.lesen` (Einsatzmedien gehören der Zeitdomäne, nicht der
                  Qualität) — ohne das Recht steht das Wort statt des Verweises,
                  sonst führte er auf 404 (AUT-06).
                */
                zelle: (b) => (b.medienId === null ? '—'
                  : darf['zeit.lesen'] === true ? (
                    <Link
                      href={`/api/medien/${b.medienId}`}
                      className="underline hover:text-text"
                      prefetch={false}
                    >
                      Foto öffnen
                    </Link>
                  ) : 'Foto hinterlegt'),
              },
            ]}
          />
        )}
      </section>

      <Hinweis art="hinweis" cse="pruefung-lesend" className="mt-s6 max-w-prose">
        <strong>Dieses Blatt ist lesend.</strong> Wie eine falsch erfasste Prüfung
        berichtigt wird, ist nicht entschieden (O-704): die Tabelle trägt
        <code> archiviert_am</code> und eine Löschsperre, aber kein
        <code> ersetzt_durch_id</code> wie das Wachbuch. Gelöscht wird eine
        Prüfung ohnehin nie (Invariante 8) — bis die Frage beantwortet ist,
        entsteht eine Korrektur als neue Prüfung.
      </Hinweis>
    </PortalRahmen>
  );
}
