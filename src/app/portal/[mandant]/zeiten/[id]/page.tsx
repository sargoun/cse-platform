import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { darfKorrigieren, ladeZeiteintrag, type SpurZeile } from '../daten';
import { kennungOder404 } from '../../../kennung';

/**
 * `/portal/[mandant]/zeiten/[id]` — ein Zeiteintrag, vollständig (TIM-08,
 * TIM-09, TIM-10, TIM-11, LEG-10).
 *
 * **Die Serverzeit und die Gerätezeit stehen NEBENEINANDER**, und das ist der
 * Kern dieser Seite. Invariante 5 sagt, welche von beiden gilt; sie sagt
 * nicht, dass die andere verschwindet. Ein Telefon, das zwei Stunden falsch
 * geht, erzeugt einen Eintrag mit `zeitabweichung_sek = -7200` — und wer die
 * Aufzeichnung später prüft, muss beides sehen können, sonst ist die Abweichung
 * eine Behauptung ohne Beleg.
 *
 * **Die Behauptung ist kein Vorschlag.** Was ein Mensch nachträglich angibt
 * (`behauptet_*`), steht als Text da und nicht in einem vorbelegten Feld: es
 * ist die Aussage eines Menschen, keine Messung. Wer sie übernimmt, tut das
 * als Korrektur mit Grund und Spur (TIM-11) — nicht durch einen Klick auf
 * „Übernehmen".
 *
 * **Die Korrekturspur ist die Geschichte der KETTE**, nicht dieser Zeile. Eine
 * Korrektur erzeugt eine neue Fassung; die alte bleibt (Invariante 8), und
 * beide gehören zusammen. Deshalb steht die Spur auf jeder Fassung gleich.
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  laufend: 'Läuft',
  abgeschlossen: 'Abgeschlossen',
  offen_nacherfassung: 'Nacherfassung offen',
  storniert: 'Storniert',
};

const ERFASSUNGSART_TEXT: Readonly<Record<string, string>> = {
  checkin_token: 'Check-in-Link',
  portal: 'Portal',
  planer_manuell: 'von der Planung gesetzt',
  nacherfassung: 'nacherfasst',
  import: 'importiert',
};

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  server_uhr: 'Serveruhr',
  planer_entscheidung: 'Entscheidung der Planung',
  import: 'Import',
};

const GEO_TEXT: Readonly<Record<string, string>> = {
  erfasst: 'erfasst',
  deaktiviert: 'für diesen Bereich ausgeschaltet',
  verweigert: 'vom Gerät verweigert',
  nicht_verfuegbar: 'nicht verfügbar',
};

const KORREKTUR_ART_TEXT: Readonly<Record<string, string>> = {
  zeit_korrektur: 'Zeit korrigiert',
  pause_korrektur: 'Pause korrigiert',
  zuordnung_korrektur: 'Zuordnung korrigiert',
  nacherfassung: 'Nacherfassung',
  storno: 'Storniert',
};

const KORREKTUR_GRUND_TEXT: Readonly<Record<string, string>> = {
  vergessen_auszustempeln: 'vergessen auszustempeln',
  geraet_defekt: 'Gerät defekt',
  falsches_objekt: 'falsches Objekt',
  einwand_mitarbeiter: 'Einwand der Person',
  nachtrag_offline: 'Nachtrag aus der Offline-Warteschlange',
  sonstiges: 'Sonstiges',
};

export default async function Zeiteintragsblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/zeiten/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /**
   * Keine Zeile heisst 404 und nie 403: ein 403 bestätigte, dass es den
   * Eintrag gibt (AUT-06). Die RLS hat hier schon entschieden — diese Seite
   * fragt nicht nach, warum.
   */
  const e = await ladeZeiteintrag(sitzung, id);
  if (e === null) notFound();

  /**
   * Der Weg zur Korrektur (TIM-11) — und warum er nicht immer dasteht.
   *
   * Vier Bedingungen entscheiden, und jede einzelne führte sonst auf eine
   * Schaltfläche, die beim Drücken scheitert: das Recht `zeit.korrigieren`
   * (ohne es antwortet die Korrekturseite mit 404, und ein Knopf dorthin
   * verriete, dass es sie gibt — AUT-06); der eigene Eintrag (`zk_nicht_selbst`,
   * EMP-07); ein Eintrag, der noch läuft (der wird bearbeitet, nicht
   * korrigiert); und eine Fassung, die bereits abgelöst ist (die Kette gabelt
   * nicht). Die Korrekturseite selbst sagt jeden dieser Gründe noch einmal in
   * Worten — wer die Adresse tippt, steht nicht vor einem 404, sondern vor
   * einer Begründung.
   */
  const frage = await searchParams;
  const korrigiert = frage['korrigiert'] === '1';

  const befugnis = await darfKorrigieren(sitzung, e.personId);
  const korrigierbar = befugnis.recht && !befugnis.eigener
    && e.status !== 'laufend' && e.ersetztDurchId === null;

  return (
    <PortalRahmen
      titel="Zeiteintrag"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">
          {e.person}
          {e.storniert && <span className="ml-s3 text-h3 text-danger">storniert</span>}
        </h1>
        <div className="flex flex-wrap gap-s2">
          {korrigierbar && (
            <Link
              href={`/portal/${mandant}/zeiten/${id}/korrektur`}
              data-cse="zur-korrektur"
              className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
            >
              Korrigieren
            </Link>
          )}
          <Link
            href={`/portal/${mandant}/zeiten`}
            className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
          >
            Zur Wochenliste
          </Link>
        </div>
      </div>

      {korrigiert && (
        <p
          data-cse="korrektur-geschrieben"
          className="mb-s4 max-w-prose rounded-lg border border-success bg-success-soft p-s4 text-sm text-success"
        >
          Die Korrektur ist geschrieben. Dies ist die neue Fassung; die alte bleibt
          lesbar und steht unten in der Korrekturspur — mit Grund, Zeitpunkt und
          Namen (TIM-11, Invariante 8).
        </p>
      )}

      {e.storniert && e.stornoGrund !== null && (
        <p className="mb-s4 rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger">
          Storniert: {e.stornoGrund} — die Zeile bleibt stehen, weil eine
          gelöschte Aufzeichnung nichts mehr belegt (Invariante 8).
        </p>
      )}

      {e.ersetztDurchId !== null && (
        <p className="mb-s4 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Diese Fassung ist nicht mehr die aktuelle.{' '}
          <Link
            href={`/portal/${mandant}/zeiten/${e.ersetztDurchId}`}
            className="underline"
          >
            Zur aktuellen Fassung
          </Link>
        </p>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 mt-0 text-h3 text-text">Aufgezeichnet</h2>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
          <Feld label="Beginn (Serveruhr)" wert={e.beginnVollLokal} zahl />
          <Feld
            label="Ende (Serveruhr)"
            wert={e.endeVollLokal ?? 'läuft noch'}
            zahl={e.endeVollLokal !== null}
          />
          <Feld
            label="Netto"
            wert={e.nettoMinuten !== null
              ? stundenAusMinuten(e.nettoMinuten)
              : e.laufendMinuten !== null
                ? `${stundenAusMinuten(e.laufendMinuten)} bis jetzt`
                : '—'}
            zahl
          />
          <Feld
            label="Brutto"
            wert={e.bruttoMinuten !== null ? stundenAusMinuten(e.bruttoMinuten) : '—'}
            zahl
          />
          <Feld label="Pause" wert={`${String(e.pauseMinuten)} min`} zahl />
          <Feld label="Status" wert={STATUS_TEXT[e.status] ?? e.status} />
          <Feld label="Objekt" wert={e.objekt ?? 'ohne Objekt'} />
          <Feld
            label="Auftrag"
            wert={e.auftragsnummer !== null
              ? `${e.auftragsnummer}${e.leistung !== null ? ` · ${e.leistung}` : ''}`
              : 'ohne Auftrag — nicht abrechenbar (FIN-18)'}
          />
          <Feld label="Fassung" wert={`Version ${String(e.version)}`} zahl />
        </dl>

        {e.einsatzId !== null && (
          <p className="m-0 mt-s4 text-sm">
            <Link
              href={`/portal/${mandant}/dienstplan/einsatz/${e.einsatzId}`}
              className="text-text-muted underline hover:text-text"
            >
              Zur geplanten Schicht
            </Link>
          </p>
        )}
        {e.notiz !== null && (
          <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">Notiz: {e.notiz}</p>
        )}
      </section>

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Gerät und Erfassung</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Massgeblich ist die Serveruhr (Invariante 5). Die Gerätezeit steht
          daneben, weil eine Abweichung ohne den Wert, aus dem sie entsteht,
          nicht nachprüfbar wäre.
        </p>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <Feld
            label="Erfassung Beginn"
            wert={`${ERFASSUNGSART_TEXT[e.erfassungsartBeginn] ?? e.erfassungsartBeginn}`
              + ` · ${QUELLE_TEXT[e.quelleBeginn] ?? e.quelleBeginn}`}
          />
          <Feld
            label="Erfassung Ende"
            wert={e.erfassungsartEnde === null
              ? '—'
              : `${ERFASSUNGSART_TEXT[e.erfassungsartEnde] ?? e.erfassungsartEnde}`
                + ` · ${QUELLE_TEXT[e.quelleEnde ?? ''] ?? e.quelleEnde ?? ''}`}
          />
          <Feld label="Gerätezeit Beginn" wert={e.geraeteZeitBeginnLokal ?? '—'} zahl />
          <Feld label="Gerätezeit Ende" wert={e.geraeteZeitEndeLokal ?? '—'} zahl />
          <Feld label="Abweichung Beginn" wert={abweichung(e.abweichungBeginnSek)} zahl />
          <Feld label="Abweichung Ende" wert={abweichung(e.abweichungEndeSek)} zahl />
        </dl>

        <h3 className="mb-s2 mt-s5 text-base text-text">Standort</h3>
        <p className="mb-s3 max-w-prose text-sm text-text-muted">
          Ob überhaupt ein Standort erfasst wird, entscheidet die Einstellung
          <code className="mx-s1 text-xs">zeit.geolokalisierung</code> je Bereich —
          nicht diese Seite. Steht sie aus, ist hier nichts gespeichert, und das
          ist kein Fehler (LEG-10, § 87 Abs. 1 Nr. 6 BetrVG).
        </p>
        <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <Feld
            label="Beginn"
            wert={ortText(e.geoBeginnStatus, e.geoBeginn, e.geoBeginnGenauigkeitM)}
          />
          <Feld
            label="Ende"
            wert={ortText(e.geoEndeStatus, e.geoEnde, e.geoEndeGenauigkeitM)}
          />
        </dl>
      </section>

      {(e.nacherfasst || e.behauptetBeginnLokal !== null || e.behauptetEndeLokal !== null
        || e.behauptetPauseMinuten !== null) && (
        <section className="mb-s6 rounded-lg border border-warning bg-warning-soft p-s5">
          <h2 className="mb-s2 mt-0 text-h3 text-warning">Nachträglich erfasst</h2>
          <p className="mb-s4 max-w-prose text-sm text-warning">
            Was hier steht, ist die ANGABE eines Menschen, keine Messung. Sie
            wird gespeichert, weil eine Aufzeichnung ohne sie so täte, als sei
            die Zeit gestempelt worden (TIM-09).
          </p>
          <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
            <Feld label="Angegebener Beginn" wert={e.behauptetBeginnLokal ?? '—'} zahl />
            <Feld label="Angegebenes Ende" wert={e.behauptetEndeLokal ?? '—'} zahl />
            <Feld
              label="Angegebene Pause"
              wert={e.behauptetPauseMinuten === null
                ? '—' : `${String(e.behauptetPauseMinuten)} min`}
              zahl
            />
            <Feld
              label="Verzögerung bis zum Eingang"
              wert={e.nacherfassungVerzoegerungSek === null
                ? '—'
                : `${String(Math.round(e.nacherfassungVerzoegerungSek / 60))} min`}
              zahl
            />
            <Feld
              label="Herkunft"
              wert={e.ausOfflineWarteschlange
                ? 'aus der Offline-Warteschlange übernommen'
                : 'im Portal erfasst'}
            />
          </dl>
        </section>
      )}

      <section className="mb-s6">
        <h2 className="mb-s2 mt-0 text-h3 text-text">Korrekturspur</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Jede Korrektur erzeugt eine neue Fassung; die alte bleibt lesbar. Was
          hier fehlt, ist nie gelöscht worden — es ist nie passiert (TIM-11,
          Invariante 8).
        </p>
        {e.spur.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Keine Korrektur. Der Eintrag steht so da, wie er erfasst wurde.
          </p>
        ) : (
          <ol className="m-0 list-none p-0">
            {e.spur.map((s) => <SpurKarte key={s.id} spur={s} mandant={mandant} />)}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-s2 mt-0 text-h3 text-text">Aufnahmen</h2>
        {e.medien.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
            Keine Aufnahme zu diesem Eintrag.
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-s3 p-0 sm:grid-cols-2">
            {e.medien.map((m) => (
              <li
                key={m.id}
                data-cse="medium"
                className="rounded-lg border border-line bg-surface p-s4"
              >
                <div className="flex items-baseline justify-between gap-s3">
                  <span className="text-sm text-text">
                    <Icon
                      name={m.art === 'video' ? 'auge' : 'dokument'}
                      groesse="sm"
                      className="mr-s2 inline-block align-[-2px]"
                    />
                    {m.art === 'video' ? 'Video' : 'Foto'}
                  </span>
                  <span className="text-xs tabular-nums text-text-muted">
                    {m.hochgeladenLokal}
                  </span>
                </div>
                {m.beschreibung !== null && (
                  <p className="m-0 mt-s2 text-sm text-text-muted">{m.beschreibung}</p>
                )}
                <p className="m-0 mt-s2 text-xs text-text-subtle">
                  {m.mimeTyp} · {megabyte(m.groesseBytes)}
                </p>
                {m.entfernt ? (
                  <p className="m-0 mt-s2 text-xs text-text-subtle">
                    Die Datei ist aus dem Speicher entfernt; die Zeile bleibt.
                  </p>
                ) : (
                  <a
                    href={`/api/medien/${m.id}`}
                    className="mt-s3 inline-flex min-h-11 items-center text-sm text-text-muted underline hover:text-text"
                  >
                    Öffnen (signierte Adresse, 15 Minuten)
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalRahmen>
  );
}

/**
 * `-7200` → `-7200 s — Gerät ging nach`. Das Vorzeichen trägt die Richtung.
 *
 * **Die Richtung stand hier verkehrt herum.** Die Abweichung ist GERÄT MINUS
 * SERVER (`kern.stempel_feldzeit()` in 0034, D-134): eine negative Zahl heisst,
 * die Telefonuhr lag HINTER der Serveruhr — das Gerät ging nach. Dieser Satz
 * nannte genau dann „Gerät ging vor", und für eine vorgehende Uhr „ging nach".
 *
 * Die Zahl daneben war immer richtig, und das ist das Teure daran: die Seite
 * widersprach sich in einem Detail, das niemand nachrechnet. Wer eine § 17-
 * Aufzeichnung prüft, liest den Satz, nicht das Vorzeichen — und „das Gerät
 * ging vor" heisst im Streitfall: die Kraft hat früher getippt, als
 * aufgezeichnet wurde. Die falsche Richtung erfindet diesen Vorwurf.
 */
function abweichung(sekunden: number | null): string {
  if (sekunden === null) return '—';
  if (sekunden === 0) return '0 s — Gerät und Server gleich';
  const richtung = sekunden < 0 ? 'Gerät ging nach' : 'Gerät ging vor';
  return `${String(sekunden)} s — ${richtung}`;
}

function ortText(
  status: string | null, koordinaten: string | null, genauigkeit: number | null,
): string {
  if (status === null) return '—';
  if (koordinaten === null) return GEO_TEXT[status] ?? status;
  return genauigkeit === null
    ? koordinaten
    : `${koordinaten} (±${String(genauigkeit)} m)`;
}

function megabyte(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB`;
}

function Feld({ label, wert, zahl = false }: {
  readonly label: string; readonly wert: string; readonly zahl?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className={`m-0 mt-s1 text-sm text-text ${zahl ? 'tabular-nums' : ''}`}>{wert}</dd>
    </div>
  );
}

function SpurKarte({ spur, mandant }: {
  readonly spur: SpurZeile; readonly mandant: string;
}) {
  return (
    <li
      data-cse="korrektur"
      data-korrektur={spur.id}
      className="mb-s3 rounded-lg border border-line bg-surface p-s4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s3">
        <span className="text-base text-text">
          <strong>{KORREKTUR_ART_TEXT[spur.art] ?? spur.art}</strong>
          {' · '}
          {KORREKTUR_GRUND_TEXT[spur.grund] ?? spur.grund}
        </span>
        <span className="text-sm tabular-nums text-text-muted">{spur.amLokal}</span>
      </div>
      <p className="m-0 mt-s2 max-w-prose text-sm text-text">{spur.begruendung}</p>
      <p className="m-0 mt-s2 text-sm text-text-muted">
        {spur.durchVon ?? 'Konto nicht einsehbar'}
        {spur.ersatzId !== null && spur.ersatzId !== spur.ursprungId && (
          <>
            {' · '}
            <Link
              href={`/portal/${mandant}/zeiten/${spur.ersatzId}`}
              className="underline hover:text-text"
            >
              zur neuen Fassung
            </Link>
          </>
        )}
      </p>
    </li>
  );
}
