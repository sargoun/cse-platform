import Link from 'next/link';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import type { ArbzgBlatt, KonfliktBlatt } from '@/server/services/dienstplan/konflikt';

/**
 * Die Bausteine, die sich Quittung und Uebersteuerung TEILEN.
 *
 * Sie stehen hier und nicht in den beiden `page.tsx`, weil eine `page.tsx`
 * nur exportieren darf, was Next.js kennt: jeder weitere Export bricht
 * `pnpm build` mit „Property … is incompatible with index signature", und
 * `tsc --noEmit` sieht es nicht (die Wache `page-fremder-export` prueft
 * genau das).
 *
 * Und sie stehen EINMAL, weil zwei Fassungen derselben Karte zwei Fassungen
 * derselben Aussage sind: sobald eine davon „höchstens" schreibt, wo die
 * andere „mindestens" sagt, widersprechen sich zwei Bildschirme in einem
 * Detail, das niemand nachrechnet.
 */

export const ART_TEXT: Readonly<Record<string, string>> = {
  arbzg: 'Arbeitszeit',
  qualifikation_entfallen: 'Nachweis',
  ueberschneidung: 'Überschneidung',
  aufzeichnungsfrist: 'Aufzeichnungsfrist',
};

export const REGEL_TEXT: Readonly<Record<string, string>> = {
  tagesarbeitszeit_ueber_8h: 'Tagesarbeitszeit über 8 Stunden (§ 3 ArbZG)',
  tagesarbeitszeit_ueber_10h: 'Tagesarbeitszeit über 10 Stunden (§ 3 ArbZG)',
  ruhezeit_unter_11h: 'Ruhezeit unter 11 Stunden (§ 5 ArbZG)',
  pause_fehlt_ueber_6h: 'Pause fehlt bei über 6 Stunden (§ 4 ArbZG)',
  pause_fehlt_ueber_9h: 'Pause zu kurz bei über 9 Stunden (§ 4 ArbZG)',
  ausgleichszeitraum_ueberschritten: 'Ausgleichszeitraum überschritten (§ 3 Satz 2 ArbZG)',
};

/**
 * Die vier Werte von `konflikt_status` bzw. `verstoss_status` — deutsch.
 *
 * Nachgesehen und nicht geraten: beide Enums tragen
 * ('offen','quittiert','behoben','hinfaellig'). Ohne diese Karte stand auf
 * dem Bildschirm „Dieser Konflikt ist nicht offen (hinfaellig)" — der rohe
 * Enum-Wert, also genau der Fehlertyp, den der Kopfkommentar von
 * `ERKANNT_TEXT` als Lehre notiert.
 */
export const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'offen',
  quittiert: 'quittiert',
  behoben: 'behoben',
  hinfaellig: 'hinfällig',
};

export const SCHWERE_TEXT: Readonly<Record<string, string>> = {
  hinweis: 'Hinweis',
  warnung: 'Warnung',
  verstoss: 'Verstoß',
};

/**
 * Die Schluessel sind die WIRKLICHEN Werte von `erkennung_quelle` —
 * ('planung_live','detektor_job','import'), nachgesehen und nicht geraten.
 *
 * Ein Zugriff mit unbekanntem Schluessel gibt `undefined`, und dann stuende
 * der rohe Enum-Wert auf dem Bildschirm. Genau dieser Fehler stand einmal im
 * Konflikteingang (`arbeitszeit`, `qualifikation`, `unterbesetzung` — keiner
 * davon existiert).
 */
export const ERKANNT_TEXT: Readonly<Record<string, string>> = {
  planung_live: 'bei der Planung',
  detektor_job: 'im Nachtlauf',
  import: 'aus einem Import',
};

export function Feld({ label, wert, zahl = false }: {
  readonly label: string; readonly wert: string; readonly zahl?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className={`m-0 mt-s1 text-sm text-text ${zahl ? 'tabular-nums' : ''}`}>{wert}</dd>
    </div>
  );
}

/**
 * Der Kopf eines Konflikts — Art, Schwere, Person, Fenster, Objekt.
 *
 * **K-06: ueber Gesellschaften hinweg steht nur DASS.** Nicht welche
 * Gesellschaft, nicht welches Objekt, nicht welcher Kunde. Der Planer
 * erfaehrt, dass die Person anderweitig gebunden ist; alles Weitere geht ihn
 * nichts an, und es steht auch nicht in den Daten, die diese Seite liest.
 */
export function KonfliktKopf({ k, mandant }: {
  readonly k: KonfliktBlatt; readonly mandant: string;
}) {
  return (
    <section
      data-cse="konflikt"
      data-konflikt={k.id}
      data-blockiert={k.blockiert ? 'ja' : 'nein'}
      className="mb-s6 rounded-lg border border-line bg-surface p-s5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s3">
        <span className="text-base text-text">
          {/* DESIGN §9: das Wort traegt die Bedeutung, nicht die Farbe. */}
          <strong className={k.blockiert ? 'text-danger' : 'text-warning'}>
            {k.blockiert ? 'Gesperrt' : 'Warnung'}
          </strong>
          {' · '}
          {ART_TEXT[k.art] ?? k.art}
          {' · '}
          {SCHWERE_TEXT[k.schwere] ?? k.schwere}
        </span>
        <span className="text-sm tabular-nums text-text-muted">
          {k.beginnLokal} – {k.endeLokal}
        </span>
      </div>

      <dl className="m-0 mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
        <Feld label="Person" wert={k.person} />
        <Feld label="Objekt" wert={k.objekt ?? 'ohne Objekt'} />
        <Feld label="Dauer des Fensters" wert={stundenAusMinuten(k.dauerMinuten)} zahl />
        <Feld
          label="Erkannt"
          wert={`${k.erkanntLokal} · ${ERKANNT_TEXT[k.erkanntDurch] ?? k.erkanntDurch}`}
          zahl
        />
        <Feld
          label="Über Gesellschaften hinweg"
          wert={k.fremd
            ? 'ja — die Person ist anderweitig gebunden'
            : 'nein'}
        />
        <Feld label="Zustand" wert={k.status === 'offen' ? 'offen' : k.status} />
      </dl>

      {k.fremd && (
        <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
          Welche Gesellschaft, welches Objekt und welcher Kunde dahinterstehen,
          steht hier <strong>nicht</strong> — und zwar nicht aus Versehen (K-06).
          Für die Einteilung zählt, dass die Person gebunden ist; alles Weitere
          gehört der anderen Gesellschaft.
        </p>
      )}

      {k.gegenschichten.length > 0 && (
        <p data-cse="gegenschicht" className="m-0 mt-s4 max-w-prose text-sm text-warning">
          Gegenschicht: {k.gegenschichten.join(' · ')}
        </p>
      )}

      {k.einsatzId !== null && (
        <p className="m-0 mt-s4 text-sm">
          <Link
            href={`/portal/${mandant}/dienstplan/einsatz/${k.einsatzId}`}
            data-cse="zur-schicht"
            className="text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Zur Schicht
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Der ArbZG-Block — oder die Auskunft, warum er leer ist.
 *
 * **Leer und nicht einsehbar sind zwei verschiedene Dinge.**
 * `arbeitszeit_verstoss` ist fuer `cse_app` nur mit `dienstplan.arbzg_lesen`
 * lesbar. Ohne das Recht findet der `left join` nichts — und ein leerer
 * Kasten laese sich als „kein Befund" lesen, wo „nicht einsehbar" die
 * Wahrheit ist. Der Unterschied ist der zwischen „alles in Ordnung" und
 * „hier steht etwas, das Sie nicht sehen".
 *
 * **Die Richtung des Grenzwerts steht im Wort.** § 5 ArbZG verlangt elf
 * Stunden MINDESTENS; „4,07 h statt höchstens 11,00 h" verdreht den eigenen
 * Paragrafen und macht aus einem Befund eine Formulierung, der niemand traut.
 */
export function ArbzgBlock({ verstoss, sichtbar, artIstArbzg }: {
  readonly verstoss: ArbzgBlatt | null;
  readonly sichtbar: boolean;
  readonly artIstArbzg: boolean;
}) {
  return (
    <section data-cse="arbzg-block" className="mb-s6">
      <h2 className="mb-s2 mt-0 text-h3 text-text">Arbeitszeitbefund</h2>
      {!sichtbar ? (
        <p
          data-cse="arbzg-nicht-einsehbar"
          className="rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          Der Arbeitszeitbefund ist <strong>nicht einsehbar</strong> — dafür fehlt
          das Recht <code className="text-xs">dienstplan.arbzg_lesen</code>. Das
          heißt <strong>nicht</strong>, dass keiner vorliegt.
        </p>
      ) : verstoss === null ? (
        <p className="rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          {artIstArbzg
            ? 'Zu diesem Konflikt hängt kein Arbeitszeitbefund — die Verknüpfung fehlt, '
              + 'obwohl die Art „Arbeitszeit" ist. Das ist ein Befund über die Daten, '
              + 'keine Entlastung.'
            : 'Kein Arbeitszeitbefund — diese Art von Konflikt trägt keinen '
              + '(Überschneidung, Nachweis, Aufzeichnungsfrist).'}
        </p>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-s5">
          <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
            <Feld label="Regel" wert={REGEL_TEXT[verstoss.regel] ?? verstoss.regel} />
            <Feld
              label="Ist"
              wert={stundenAusMinuten(verstoss.istMinuten)}
              zahl
            />
            <Feld
              label={verstoss.grenzwertIstMindestwert ? 'Mindestens' : 'Höchstens'}
              wert={stundenAusMinuten(verstoss.grenzwertMinuten)}
              zahl
            />
            <Feld label="Fenster" wert={`${verstoss.beginnLokal} – ${verstoss.endeLokal}`} zahl />
            <Feld label="Schwere" wert={SCHWERE_TEXT[verstoss.schwere] ?? verstoss.schwere} />
            <Feld
              label="Zustand"
              wert={verstoss.status === 'offen' ? 'offen' : verstoss.status}
            />
          </dl>
          <p className="m-0 mt-s4 max-w-prose text-sm text-text-muted">
            {stundenAusMinuten(verstoss.istMinuten)} statt{' '}
            {verstoss.grenzwertIstMindestwert ? 'mindestens' : 'höchstens'}{' '}
            {stundenAusMinuten(verstoss.grenzwertMinuten)}.
            {verstoss.fremd && ' Der Befund entsteht über Gesellschaften hinweg — '
              + 'die ArbZG-Grenzen gelten je MENSCH, nicht je Beschäftigung (D-09).'}
          </p>
          {verstoss.quittiertAmLokal !== null && (
            <p
              data-cse="arbzg-quittung"
              className="m-0 mt-s4 max-w-prose text-sm text-text"
            >
              Übersteuert am <span className="tabular-nums">{verstoss.quittiertAmLokal}</span>
              {' '}von {verstoss.quittiertVon ?? 'einem nicht einsehbaren Konto'}:{' '}
              {verstoss.quittierungBegruendung ?? 'ohne Begründung'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
