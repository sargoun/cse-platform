import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import {
  leseEmpfaengerkandidaten, leseProfil, type ProfilBlick,
} from '@/server/services/radar/profil';
import {
  ABZUG_PLATZHALTER, GEWICHTE_PLATZHALTER,
} from '@/server/services/radar/gewichte.platzhalter';
import { REGEL_VERSION } from '@/server/services/radar/bewertung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '../../../../rechte';
import { kennungOder404 } from '../../../../kennung';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/radar/profile/[id]` — ein Suchprofil bearbeiten
 * (RAD-04, RAD-05, RAD-08).
 *
 * **Was ein Profil ist: die Antwort auf „was interessiert uns".** Leistungsart
 * (CPV), Region (NUTS), Stichwörter, Wertgrenzen, Mindestrestfrist — und
 * daraus rechnet der Nachtlauf die Rangfolge, deterministisch, mit einer
 * Begründung je Regel. Kein Sprachmodell ist daran beteiligt (RAD-05,
 * Invariante 6).
 *
 * **Was ein Speichern auslöst, steht über dem Formular** — denn die Datenbank
 * tut es von selbst: `trg_radar_profil_version` und die sechs Trigger auf den
 * Kindtabellen zählen `version` hoch, und der nächste Lauf schreibt eine NEUE
 * `bewertung`-Zeile neben die alte. So bleibt nachlesbar, mit welcher Suche
 * eine Bekanntmachung damals bewertet wurde.
 *
 * **Vier Felder stehen sichtbar GESPERRT da, statt zu fehlen** (Regel 1):
 * Gewichtung und Benachrichtigungsschwelle (O-15), die Wirkung der
 * Negativ-Stichwörter (O-191), die Währung der Wertgrenzen (O-47). Ein freies
 * Zahlenfeld für die Gewichtung täte so, als wäre sie bestätigt — und die
 * Rangfolge, die daraus entsteht, würde geglaubt. Ein weggelassenes Feld sähe
 * aus, als gäbe es die Einstellung nicht.
 *
 * **Jede von Hand eingetragene CPV-Zeile bleibt Platzhalter** (O-98): die
 * Codes der drei Gewerke sind gegen die amtliche CPV-Liste unbestätigt, und
 * es gibt keine Liste im Haus, gegen die zu prüfen wäre. Dasselbe gilt für
 * die NUTS-Präfixe (O-721): geprüft wird die FORM, nicht die Existenz.
 *
 * **Gelöscht wird das Profil hier nicht** (O-720). Abgeschaltet wird über
 * „aktiv": der Lauf bewertet dann nichts mehr damit, und die alten
 * Bewertungen bleiben mit ihrem Profilnamen lesbar. Die Kindtabellen
 * (CPV, Empfänger) tragen weder `geloescht_am` noch `ist_aktiv` — ein Entfernen
 * dort löscht wirklich, und das ist zulässig: Invariante 8 nennt Finanzen,
 * Zeiterfassung und Audit, nicht Radar.
 */
export const dynamic = 'force-dynamic';

const WIRKUNG_TEXT: Readonly<Record<string, string>> = {
  positiv: 'zählt', abzug: 'zieht ab', ausschluss: 'schliesst aus',
};

const FEHLER_TEXT: Readonly<Record<string, string>> = {
  name: 'Der Name oder ein Stichwort passt nicht: ein Profil braucht einen Namen, und ein '
    + 'Stichwort ist ein Wort, kein Satz — verglichen wird, ob es im Text vorkommt.',
  nuts: 'Ein Regionspräfix hat nicht die Form eines NUTS-Codes: zwei Buchstaben für das '
    + 'Land und bis zu drei weitere Stellen (DE, DE3, DE30, DE300).',
  cpv: 'Ein CPV-Code hat nicht die Form, die die Datenbank verlangt: acht Ziffern, '
    + 'optional „-" und eine Prüfziffer. Die Präfixlänge liegt zwischen 2 und 8.',
  wert: 'Die Wertgrenzen passen nicht: deutsches Geldformat (1.234,56), nie negativ, und '
    + 'die Obergrenze nicht unter der Untergrenze.',
  frist: 'Die Mindestrestfrist sind ganze Tage zwischen 0 und 365.',
  empfaenger: 'Der Empfänger liess sich nicht eintragen. Ein Konto muss Mitglied DIESER '
    + 'Gesellschaft sein — die Datenbank besteht darauf.',
  nicht_gefunden: 'Das Profil wurde nicht gefunden, ist archiviert, oder diese Sitzung '
    + 'darf es nicht ändern.',
  gesperrt: 'Diese Handlung ist an dieser Stelle nicht vorgesehen.',
};

const VERMERKT_TEXT: Readonly<Record<string, string>> = {
  stammdaten: 'Die Stammdaten sind gespeichert. Die Fassung des Profils ist damit '
    + 'hochgezählt; der nächste Lauf schreibt neue Bewertungen, die alten bleiben stehen.',
  cpv_hinzu: 'Die CPV-Zeile ist eingetragen — als Platzhalter (O-98).',
  cpv_weg: 'Die CPV-Zeile ist entfernt.',
  empfaenger_hinzu: 'Der Empfänger ist eingetragen — ohne Schwelle, also ohne '
    + 'Treffermeldung, bis O-15 beantwortet ist.',
  empfaenger_weg: 'Der Empfänger ist entfernt.',
  /*
   * Die Umleitung nach dem Anlegen (V-016) landet HIER, auf dem Blatt des
   * neuen Profils — und der Satz sagt, was als Nächstes fehlt. Ein „Gespeichert."
   * an dieser Stelle wäre die Unwahrheit: gespeichert ist ein Name, gesucht
   * wird damit noch nichts.
   */
  anlegen: 'Das Profil ist angelegt — und ABGESCHALTET. Trage zuerst ein, was es '
    + 'suchen soll (CPV, Region, Stichwörter); ein Profil ohne diese Angaben '
    + 'bewertet sonst jede Bekanntmachung mit dem vollen Wert- und Fristkriterium. '
    + 'Zum Einschalten unten „aktiv" auf ja setzen und speichern.',
};

/**
 * `formatiereGeld` liefert „19,99 €"; ins Eingabefeld gehört „19,99".
 *
 * `parseGeld` liest das wieder ein (es streift die Währung selbst ab), sodass
 * ein Speichern ohne Änderung genau denselben Cent-Betrag zurückschreibt —
 * und der Versionszähler deshalb NICHT springt.
 */
function euroFeld(betrag: Cent | null): string {
  return betrag === null ? '' : formatiereGeld(betrag).replace(/\s*€$/u, '');
}

export default async function ProfilBearbeiten(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const vermerkt = typeof suche['vermerkt'] === 'string' ? suche['vermerkt'] : null;

  const tor = await mandantTor(`/portal/${mandant}/radar/profile/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * `/radar` und `/radar/[id]` öffnen mit `radar.lesen` (Manifest), diese
   * Seite mit `radar.profil_schreiben`. Ein Verweis, dessen Ziel diese
   * Sitzung nicht öffnen darf, verrät, was er nicht zeigen darf (AUT-06).
   * `system.benutzer_lesen` entscheidet, ob die Empfängernamen überhaupt
   * lesbar sind — ohne das Recht wäre eine leere Liste die Falschaussage
   * „niemand eingetragen".
   */
  const darf = await haeltRechte(zugang.sitzung, 'radar.lesen', 'system.benutzer_lesen');
  const namenSichtbar = darf['system.benutzer_lesen'] === true;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const profil = await leseProfil(kontext, id);
      if (profil === null) return null;
      return { profil, kandidaten: await leseEmpfaengerkandidaten(kontext, id) };
    })) as Promise<{
      profil: ProfilBlick;
      kandidaten: readonly { readonly id: string; readonly name: string }[];
    } | null>);

  if (daten === null) notFound();
  const { profil: p, kandidaten } = daten;

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
    + 'text-base text-text';
  const flaeche = 'w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';
  const gesperrt = 'min-h-11 w-full rounded-md border border-line bg-surface-2 px-s4 py-s3 '
    + 'text-base text-text-muted';

  return (
    <PortalRahmen
      titel={p.name}
      wurzelTitel="Suchprofile"
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
          <h1 className="text-h1 text-text">{p.name}</h1>
          <p className="mt-s2 text-sm text-text-muted" data-cse="profil-fassung"
             data-version={String(p.version)}>
            Fassung {String(p.version)} · {String(p.bewertungen)} Bewertungen · Regelwerk{' '}
            <span className="font-mono text-xs">{REGEL_VERSION}</span>
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-s2">
          {p.istPlatzhalter ? <StatusPill zustand="Entwurf" /> : null}
          <StatusPill zustand={p.istAktiv ? 'Aktiv' : 'Inaktiv'} />
          <Link href={`/portal/${mandant}/radar/profile`} data-cse="profil-zur-liste"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zur Liste
          </Link>
          {darf['radar.lesen'] === true ? (
            <Link href={`/portal/${mandant}/radar`} data-cse="profil-zum-radar"
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
              Zum Radar
            </Link>
          ) : null}
        </span>
      </div>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="profil-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong>{' '}
          {eigenerEintrag(FEHLER_TEXT, fehler) ?? 'Die Eingabe wurde abgewiesen.'}
        </Hinweis>
      ) : null}
      {vermerkt !== null ? (
        <Hinweis art="erfolg" cse="profil-vermerkt" className="mb-s5 max-w-prose">
          {VERMERKT_TEXT[vermerkt] ?? 'Gespeichert.'}
        </Hinweis>
      ) : null}

      <Hinweis art="hinweis" cse="profil-was-passiert" className="mb-s6 max-w-prose">
        <strong>Ein Speichern zählt die Fassung hoch.</strong> Das tut die Datenbank von
        selbst — auch beim Eintragen oder Entfernen einer CPV-Zeile oder eines Empfängers.
        Der nächste Nachtlauf schreibt dann eine <strong>neue</strong> Bewertung, und die
        alte bleibt stehen: so lässt sich später sagen, mit welcher Suche eine
        Bekanntmachung damals bewertet wurde, und nicht nur, wie sie heute aussähe.
        Bestehende Punktzahlen ändert dieses Formular nicht.
      </Hinweis>

      {/* ------------------------------------------------------- Stammdaten */}
      <section aria-labelledby="stamm-titel" className="mb-s7 max-w-prose">
        <h2 id="stamm-titel" className="mb-s3 text-h2 text-text">Suche</h2>
        <form method="post" action="/api/radar/profil" data-cse="profil-stammdaten"
              className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
          {/*
            * Kein verstecktes `mandant`-Feld mehr: die Route liest den
            * Bereich aus `app.aktiver_mandant()` (Invariante 3). Wer in
            * einem zweiten Reiter gewechselt hatte, schickte sonst den
            * alten Slug ab und landete nach dem 303 in der falschen
            * Gesellschaft — dort kennt `leseProfil` das Profil nicht,
            * also endete ein gegluecktes Speichern auf einem 404.
            */}
          <input type="hidden" name="profil" value={p.id} />
          <input type="hidden" name="was" value="stammdaten" />

          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="name">
            Name des Profils
            <input id="name" name="name" type="text" required maxLength={120}
                   className={feld} defaultValue={p.name} data-cse="profil-name" />
          </label>

          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="nuts">
            Region (NUTS-Präfixe, eines je Zeile oder durch Komma getrennt)
            <textarea id="nuts" name="nuts" rows={2} className={flaeche}
                      data-cse="profil-nuts" placeholder="DE3&#10;DE300"
                      defaultValue={p.nutsPraefixe.join('\n')} />
          </label>
          <p className="text-xs text-text-muted">
            Leer heisst: ohne Einschränkung. Geprüft wird die <strong>Form</strong> — zwei
            Buchstaben Land und bis zu drei Stellen. Gegen welche Fassung der amtlichen
            NUTS-Liste die Präfixe zu prüfen wären, ist offen{' '}
            <strong>(offen — O-721)</strong>: ein Präfix in richtiger Form, das kein Gebiet
            bezeichnet, engt die Suche still ein.
          </p>

          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="positiv">
            Stichwörter, die zählen
            <textarea id="positiv" name="positiv" rows={3} className={flaeche}
                      data-cse="profil-positiv"
                      defaultValue={p.positivKeywords.join('\n')} />
          </label>

          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="negativ">
            Stichwörter, die dagegen sprechen
            <textarea id="negativ" name="negativ" rows={3} className={flaeche}
                      data-cse="profil-negativ"
                      defaultValue={p.negativKeywords.join('\n')} />
          </label>

          {/* O-191: die Wirkung der Negativ-Stichwörter ist nicht umstellbar. */}
          <label className="flex flex-col gap-s2 text-xs text-text-muted"
                 htmlFor="negativWirkung">
            Wirkung der Negativ-Stichwörter <strong>(offen — O-191)</strong>
            <input id="negativWirkung" type="text" readOnly disabled
                   className={gesperrt} data-cse="profil-negativ-wirkung"
                   data-wirkung={p.negativWirkung}
                   value={p.negativWirkung === 'ausschluss'
                     ? 'schliesst aus' : `zieht ${String(ABZUG_PLATZHALTER.stichwort)} Punkte ab`} />
          </label>
          <p className="text-xs text-text-muted">
            Ob ein Negativ-Stichwort ausschliesst oder nur abzieht, hat niemand
            entschieden. Bis dahin steht es auf <strong>Abzug</strong> — der sicheren
            Richtung: ein Ausschluss verwirft still, was nie ein Mensch gesehen hat.
          </p>

          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="wertMin">
              Auftragswert ab ({p.waehrung})
              <input id="wertMin" name="wertMin" type="text" inputMode="decimal"
                     className={feld} placeholder="leer = ohne Untergrenze"
                     data-cse="profil-wert-min" defaultValue={euroFeld(p.wertMinCent)} />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="wertMax">
              bis ({p.waehrung})
              <input id="wertMax" name="wertMax" type="text" inputMode="decimal"
                     className={feld} placeholder="leer = ohne Obergrenze"
                     data-cse="profil-wert-max" defaultValue={euroFeld(p.wertMaxCent)} />
            </label>
          </div>
          <p className="text-xs text-text-muted">
            Beträge in ganzen Cent (Invariante 1), deutsches Format. Die Währung dieses
            Profils ist <strong>{p.waehrung}</strong> und hier nicht umstellbar{' '}
            <strong>(offen — O-47)</strong>: Fremdwährungen werden NIE umgerechnet — eine
            Bekanntmachung in einer anderen Währung bleibt im Wertkriterium unbewertet und
            sagt es. Ein Profil in anderer Währung verlöre das Kriterium für jede
            Bekanntmachung in Euro.
          </p>

          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <label className="flex flex-col gap-s2 text-xs text-text-muted"
                   htmlFor="fristMinTage">
              Mindestrestfrist in Tagen
              <input id="fristMinTage" name="fristMinTage" type="number" min={0} max={365}
                     step={1} className={feld} data-cse="profil-frist"
                     defaultValue={p.fristMinTage === null ? '' : String(p.fristMinTage)} />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted"
                   htmlFor="schwellenwert">
              Schwellenwert (EU-Verfahren)
              <select id="schwellenwert" name="schwellenwert" className={feld}
                      data-cse="profil-schwellenwert"
                      defaultValue={p.oberhalbSchwellenwert === null
                        ? 'egal' : p.oberhalbSchwellenwert ? 'ja' : 'nein'}>
                <option value="egal">gleichgültig</option>
                <option value="ja">nur oberhalb</option>
                <option value="nein">nur unterhalb</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-text-muted">
            Die Mindestrestfrist ist die eigene Grenze dieses Betriebs: bleibt weniger
            Zeit, zieht das Fristkriterium ab. Die fünf Tage, ab denen der Wächter die
            knappe Abgabe meldet, stehen in SPEC §14 und RAD-06 — die sind nicht
            einzustellen.
          </p>

          <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="istAktiv" value="ja" data-cse="profil-aktiv"
                   defaultChecked={p.istAktiv} />
            Profil ist aktiv
          </label>
          <p className="text-xs text-text-muted">
            Ein abgeschaltetes Profil bewertet nichts mehr; seine bisherigen Bewertungen
            bleiben lesbar. Gelöscht wird ein Profil hier nicht{' '}
            <strong>(offen — O-720)</strong> — was mit den Bewertungen eines archivierten
            Profils geschehen soll, hat niemand entschieden, und die sichere Richtung ist,
            es lesbar zu lassen.
          </p>

          <div>
            <Button type="submit" variante="primary" data-cse="profil-speichern">
              Suche speichern
            </Button>
          </div>
        </form>
      </section>

      {/* ------------------------------------------------- Gesperrte Gewichte */}
      <section aria-labelledby="gewichte-titel" className="mb-s7 max-w-prose">
        <h2 id="gewichte-titel" className="mb-s3 text-h2 text-text">Gewichtung</h2>
        <Hinweis art="warnung" cse="profil-gewichte" className="mb-s3">
          <strong>Die Gewichte sind Platzhalter (offen — O-15).</strong> Wie viel ein
          CPV-Treffer gegenüber einer Region oder einem Stichwort wiegt, welche Punkteskala
          gilt und ab welcher Punktzahl benachrichtigt wird, hat niemand entschieden. Diese
          Felder stehen deshalb gesperrt da, statt zu fehlen: ein freies Zahlenfeld täte
          so, als wäre die Gewichtung bestätigt, und die Rangfolge, die daraus entsteht,
          würde geglaubt.
        </Hinweis>
        <dl data-cse="profil-gewichte-werte"
            className="grid grid-cols-1 gap-s2 rounded-lg border border-line bg-surface p-s5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
          <dt className="text-text-muted">Punkteskala</dt>
          <dd className="text-text tabular-nums">
            0 bis {String(p.skalaMax)} <span className="text-text-subtle">(gesperrt, O-15)</span>
          </dd>
          <dt className="text-text-muted">Leistungsart (CPV)</dt>
          <dd className="text-text tabular-nums">
            {String(p.gewichtung['cpv'] ?? GEWICHTE_PLATZHALTER.cpv)}
          </dd>
          <dt className="text-text-muted">Ort der Leistung</dt>
          <dd className="text-text tabular-nums">
            {String(p.gewichtung['region'] ?? GEWICHTE_PLATZHALTER.region)}
          </dd>
          <dt className="text-text-muted">Stichwörter</dt>
          <dd className="text-text tabular-nums">
            {String(p.gewichtung['stichwort'] ?? GEWICHTE_PLATZHALTER.stichwort)}
          </dd>
          <dt className="text-text-muted">Auftragswert</dt>
          <dd className="text-text tabular-nums">
            {String(p.gewichtung['wert'] ?? GEWICHTE_PLATZHALTER.wert)}
          </dd>
          <dt className="text-text-muted">Restfrist</dt>
          <dd className="text-text tabular-nums">
            {String(p.gewichtung['frist'] ?? GEWICHTE_PLATZHALTER.frist)}
          </dd>
          <dt className="text-text-muted">Benachrichtigung ab</dt>
          <dd className="text-text tabular-nums" data-cse="profil-schwelle">
            {p.benachrichtigungAbPunkte === null
              ? 'nicht gesetzt — es wird niemand benachrichtigt (gesperrt, O-15)'
              : `${String(p.benachrichtigungAbPunkte)} Punkte (gesperrt, O-15)`}
          </dd>
        </dl>
      </section>

      {/* -------------------------------------------------------- CPV-Zeilen */}
      <section aria-labelledby="cpv-titel" className="mb-s7 max-w-prose">
        <h2 id="cpv-titel" className="mb-s3 text-h2 text-text">Leistungsarten (CPV)</h2>
        {p.cpv.length === 0 ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
             data-cse="profil-cpv-leer">
            Keine CPV-Zeile — dieses Profil trifft dann nur über Stichwörter und Region.
          </p>
        ) : (
          <ul data-cse="profil-cpv-liste" className="mb-s3 flex flex-col gap-s2">
            {p.cpv.map((c) => (
              <li key={c.id} data-cse="profil-cpv" data-code={c.code}
                  data-wirkung={c.wirkung}
                  className="flex flex-wrap items-baseline justify-between gap-s3 rounded-md border border-line bg-surface p-s3 text-sm">
                <span className="min-w-0">
                  <span className="font-mono text-text">{c.code}</span>
                  <span className="ml-s2 text-text-muted">
                    {c.praefixLaenge < 8 ? `${String(c.praefixLaenge)} Stellen · ` : ''}
                    {WIRKUNG_TEXT[c.wirkung] ?? c.wirkung}
                    {c.bezeichnung === null ? '' : ` · ${c.bezeichnung}`}
                  </span>
                  {c.istPlatzhalter ? (
                    <span className="ml-s2 text-xs text-warning">
                      Platzhalter — gegen die amtliche CPV-Liste unbestätigt (offen — O-98)
                    </span>
                  ) : null}
                </span>
                <form method="post" action="/api/radar/profil">
                  <input type="hidden" name="profil" value={p.id} />
                  <input type="hidden" name="was" value="cpv_weg" />
                  <input type="hidden" name="cpv" value={c.id} />
                  <Button type="submit" variante="ghost" data-cse="profil-cpv-weg">
                    Entfernen
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form method="post" action="/api/radar/profil" data-cse="profil-cpv-formular"
              className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
          <input type="hidden" name="profil" value={p.id} />
          <input type="hidden" name="was" value="cpv_hinzu" />
          <div className="grid grid-cols-1 gap-s3 sm:grid-cols-3">
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="cpvCode">
              CPV-Code
              <input id="cpvCode" name="cpvCode" type="text" required maxLength={10}
                     placeholder="90910000" className={feld} data-cse="profil-cpv-code" />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted"
                   htmlFor="praefixLaenge">
              Präfixlänge
              <input id="praefixLaenge" name="praefixLaenge" type="number" min={2} max={8}
                     step={1} defaultValue={8} className={feld}
                     data-cse="profil-cpv-laenge" />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="wirkung">
              Wirkung
              <select id="wirkung" name="wirkung" className={feld}
                      data-cse="profil-cpv-wirkung">
                <option value="positiv">zählt</option>
                <option value="abzug">
                  zieht ab ({String(ABZUG_PLATZHALTER.cpv)} Punkte)
                </option>
                <option value="ausschluss">schliesst aus</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="bezeichnung">
            Bezeichnung (frei, hilft beim Wiedererkennen)
            <input id="bezeichnung" name="bezeichnung" type="text" maxLength={200}
                   className={feld} data-cse="profil-cpv-bezeichnung" />
          </label>
          <p className="text-xs text-text-muted">
            Die Präfixlänge sagt, wie viele Stellen verglichen werden:{' '}
            <span className="font-mono">45000000</span> bei Länge 2 fängt den ganzen
            Hochbau. Jede hier eingetragene Zeile bleibt <strong>Platzhalter</strong>, bis
            die CPV-Listen der Gewerke gegen die amtliche Liste bestätigt sind{' '}
            <strong>(offen — O-98)</strong>. Ein eigenes Gewicht je Code gibt es nicht: die
            Spalte steht im Schema, die Bewertung benutzt sie nicht (O-15).
            {' '}<strong>„Schliesst aus" verwirft still</strong>, was nie ein Mensch gesehen
            hat — verwenden Sie es sparsam.
          </p>
          <div>
            <Button type="submit" variante="secondary" data-cse="profil-cpv-hinzu">
              CPV-Zeile eintragen
            </Button>
          </div>
        </form>
      </section>

      {/* -------------------------------------------------------- Empfänger */}
      <section aria-labelledby="empf-titel" className="max-w-prose">
        <h2 id="empf-titel" className="mb-s3 text-h2 text-text">Benachrichtigung</h2>
        {!namenSichtbar ? (
          <Hinweis art="hinweis" cse="profil-empfaenger-unsichtbar" className="mb-s3">
            <strong>Die Empfänger sind hier nicht sichtbar</strong> — dafür braucht es das
            Recht <Recht schluessel="system.benutzer_lesen" />. Das heisst nicht,
            dass keine eingetragen sind.
          </Hinweis>
        ) : null}
        {p.empfaenger.length === 0 ? (
          <p className="mb-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
             data-cse="profil-empfaenger-leer">
            Niemand eingetragen — RAD-08 meldet für dieses Profil nichts.
          </p>
        ) : (
          <ul data-cse="profil-empfaenger-liste" className="mb-s3 flex flex-col gap-s2">
            {p.empfaenger.map((e) => (
              <li key={e.id} data-cse="profil-empfaenger"
                  data-schwelle={e.abPunkte === null ? '' : String(e.abPunkte)}
                  className="flex flex-wrap items-baseline justify-between gap-s3 rounded-md border border-line bg-surface p-s3 text-sm">
                <span className="min-w-0">
                  <span className="text-text">
                    {e.name ?? 'Name hier nicht sichtbar'}
                  </span>
                  <span className="ml-s2 text-text-muted">
                    {e.abPunkte === null
                      ? `ohne Schwelle — bekommt keine Treffermeldung${
                        p.benachrichtigungAbPunkte === null
                          ? ' (offen — O-15)'
                          : `, solange auch das Profil keine wirksame Schwelle hat (offen — O-15)`}`
                      : `ab ${String(e.abPunkte)} von ${String(p.skalaMax)} Punkten`}
                  </span>
                </span>
                <form method="post" action="/api/radar/profil">
                  <input type="hidden" name="profil" value={p.id} />
                  <input type="hidden" name="was" value="empfaenger_weg" />
                  <input type="hidden" name="empfaenger" value={e.id} />
                  <Button type="submit" variante="ghost" data-cse="profil-empfaenger-weg">
                    Entfernen
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {kandidaten.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
             data-cse="profil-kandidaten-leer">
            {namenSichtbar
              ? 'Kein weiteres Konto dieser Gesellschaft zum Eintragen — alle aktiven sind '
                + 'schon Empfänger.'
              : 'Ohne das Recht system.benutzer_lesen lässt sich hier niemand auswählen.'}
          </p>
        ) : (
          <form method="post" action="/api/radar/profil" data-cse="profil-empfaenger-formular"
                className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="profil" value={p.id} />
            <input type="hidden" name="was" value="empfaenger_hinzu" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="benutzer">
              Konto dieser Gesellschaft
              <select id="benutzer" name="benutzer" required className={feld}
                      data-cse="profil-empfaenger-wahl">
                {kandidaten.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </label>
            <p className="text-xs text-text-muted">
              Eingetragen wird <strong>ohne Schwelle</strong>: ab welcher Punktzahl
              benachrichtigt wird, hat niemand entschieden{' '}
              <strong>(offen — O-15)</strong>, und eine erfundene Zahl schickte entweder
              Post, deren Auswahlregel niemand bestätigt hat, oder verschwiege Treffer, die
              niemand sucht. Die <strong>knappe Abgabefrist</strong> meldet der Wächter
              davon unabhängig und ohne Schwelle: fünf Tage stehen in SPEC §14 und RAD-06.
            </p>
            <div>
              <Button type="submit" variante="secondary" data-cse="profil-empfaenger-hinzu">
                Empfänger eintragen
              </Button>
            </div>
          </form>
        )}
      </section>
    </PortalRahmen>
  );
}
