import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import type { FormularFeld } from '@/lib/formular/schema';
import { FORMULAR_EN, type FeldTexte } from '@/lib/i18n/formular-en';
import {
  type FormularZustand, felderEingefroren, reaktionszeitText,
} from '@/lib/formular/pflege';
import {
  type BenutzerWahl, type FormularDetail, istDienstkonto, ladeFormularZurPflege,
  waehlbareBenutzer,
} from '@/server/services/inhalt/formular';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/website/formulare/[id]` — eine Formularversion pflegen
 * (REQ-01 … REQ-04).
 *
 * **Die Felder stehen hier zum LESEN.** Änderbar sind Titel, Beschreibung und
 * Zuständigkeit; die Feldliste ist es nicht, und das hat zwei Gründe, die
 * beide nicht verhandelbar sind. Erstens friert
 * `kern.formular_definition_unveraenderlich` sie in einer veröffentlichten
 * Version ein — `formular_eingang` zeigt auf genau diese Version, und wer die
 * Felder darunter austauschte, machte aus jeder alten Einsendung eine Antwort
 * auf Fragen, die nie gestellt wurden. Zweitens lebt die englische Fassung im
 * CODE (`lib/i18n/formular-en.ts`): ein hier angelegtes Feld stünde auf
 * `/en/angebot` deutsch da, und kein Test schlüge an, weil
 * `tests/kern/i18n.test.ts` die Seed-Konstante prüft und nicht die Datenbank
 * (D-82, D-83, O-680).
 *
 * **Neben jedem Feld steht sein englisches Gegenstück** — und wo es fehlt,
 * steht das auch. Das ist die einzige Stelle im Portal, an der jemand sehen
 * kann, ob der zweisprachige Vertrag für dieses Formular wirklich erfüllt ist.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Formular' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const PILLE: Readonly<Record<FormularZustand, PillZustand>> = {
  entwurf: 'Entwurf', live: 'Aktiv', zurueckgezogen: 'Archiviert',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

const TYP_TEXT: Readonly<Record<string, string>> = {
  text: 'Text', textarea: 'Mehrzeiliger Text', zahl: 'Ganze Zahl',
  dezimal: 'Dezimalzahl', datum: 'Datum', datum_zeit: 'Datum und Zeit',
  auswahl: 'Auswahl', mehrfachauswahl: 'Mehrfachauswahl', checkbox: 'Kästchen',
  email: 'E-Mail', telefon: 'Telefon', datei: 'Datei',
};

/** Die Sätze zu den Abweisungen der Route — auf DIESER Seite, nicht als JSON. */
const FEHLER: Readonly<Record<string, string>> = {
  unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
  nicht_gefunden: 'Diese Formularversion gibt es hier nicht.',
  titel_fehlt: 'Ein Formular ohne Titel hat keine Überschrift auf der öffentlichen Seite.',
  sla_ungueltig: 'Die Reaktionszeit ist eine ganze Zahl von Stunden über null — oder nichts.',
  besitzer_fehlt: 'Ohne Besitzer fällt eine Anfrage niemandem zu.',
  besitzer_unbekannt: 'Dieser Mensch gehört nicht zu dieser Gesellschaft — oder diese '
    + 'Sitzung darf die Mitgliederliste nicht lesen (system.benutzer_lesen).',
  benutzer_unbekannt: 'Dieser Mensch gehört nicht zu dieser Gesellschaft — oder diese '
    + 'Sitzung darf die Mitgliederliste nicht lesen (system.benutzer_lesen).',
  schon_live: 'Diese Version ist schon live. Vermutlich war jemand anderes schneller — '
    + 'laden Sie die Seite neu.',
  nicht_geaendert: 'Der Schreibvorgang ging nicht durch. Das Formular gehört nicht zu '
    + 'dieser Gesellschaft, oder dieser Sitzung fehlt das Schreibrecht.',
  dienstkonto: 'Ein Dienstkonto pflegt keine Website. Der Annahmeprinzipal hält '
    + 'formular.schreiben, weil er Einsendungen speichern muss — nicht, um ein '
    + 'öffentliches Formular zu ändern (O-682).',
};

function englisch(formularSchluessel: string, feldSchluessel: string): FeldTexte | null {
  return FORMULAR_EN[formularSchluessel]?.felder[feldSchluessel] ?? null;
}

function optionenVon(f: FormularFeld): readonly { readonly wert: string; readonly label: string }[] {
  return f.typ === 'auswahl' || f.typ === 'mehrfachauswahl' ? f.optionen : [];
}

export default async function WebsiteFormular(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const formularId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/formulare/${formularId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darf = await haeltRechte(
    zugang.sitzung, 'formular.lesen', 'formular.schreiben', 'system.benutzer_lesen');
  const liest = darf['formular.lesen'] === true;
  /*
   * **Die Mitgliederliste hängt am RECHT, nicht an ihrer Länge.**
   *
   * Hier stand `daten.benutzer.length === 0` als Prüfung darauf, ob die Liste
   * lesbar ist — und dieser Zweig kann nie eintreten: `t_benutzer_lesen` lässt
   * jede Sitzung ihre EIGENE Zeile durch (`id = app.aktueller_benutzer()`).
   * Ohne `system.benutzer_lesen` schrumpft die Liste also auf genau einen
   * Namen zusammen, den eigenen, statt leer zu sein; der Bediener sah ein
   * Auswahlfeld mit sich selbst darin und keinen Hinweis, dass die anderen
   * fehlen. `tests/isolation/website-pflege.test.ts` beweist genau das.
   */
  const liestBenutzer = darf['system.benutzer_lesen'] === true;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      detail: await ladeFormularZurPflege(kontext, formularId),
      benutzer: await waehlbareBenutzer(kontext),
      /*
       * **Ein Dienstkonto sieht hier keine Knoepfe.** `formular.schreiben`
       * haelt auch der zum Internet offene Annahmeprinzipal
       * `formular_eingang`; die Route weist ihn ab (O-682), und ein Knopf, der
       * abgewiesen wird, ist ein Fehlerbericht mit Verzoegerung (AUT-06).
       */
      dienstkonto: await istDienstkonto(kontext),
    }))) as Promise<{
      detail: FormularDetail | null; benutzer: readonly BenutzerWahl[];
      dienstkonto: boolean;
    }>);

  const schreibt = darf['formular.schreiben'] === true
    && zugang.sitzung.ansicht !== 'gruppe' && !daten.dienstkonto;

  // 404 und nicht 403 — eine Kennung aus einer fremden Gesellschaft darf nicht
  // daran erkennbar sein, dass die Antwort eine andere ist (AUT-06).
  if (daten.detail === null) notFound();
  const { formular: f, felder, felderUnlesbar, geschwister, liveVersion } = daten.detail;

  const suche = await searchParams;
  const nimm = (n: string): string | null =>
    typeof suche[n] === 'string' ? (suche[n] as string) : null;
  const abgewiesen = nimm('fehler');
  const gespeichert = nimm('gespeichert');
  const abgeloest = nimm('abgeloest');
  const neu = nimm('neu');
  const neueVersion = nimm('version');

  const eingefroren = felderEingefroren(f.zustand);
  const anderesLive = liveVersion !== null && liveVersion.id !== f.id ? liveVersion : null;

  const feldSpalten: readonly Spalte<FormularFeld>[] = [
    {
      schluessel: 'schluessel', kopf: 'Schlüssel',
      zelle: (feld) => (
        <span className="font-mono text-xs text-text" data-cse="feld"
              data-schluessel={feld.schluessel}>
          {feld.schluessel}
        </span>
      ),
    },
    {
      schluessel: 'typ', kopf: 'Typ',
      zelle: (feld) => (
        <span className="text-xs text-text-muted">
          {TYP_TEXT[feld.typ] ?? feld.typ}
          {feld.pflicht ? ' · Pflicht' : ''}
        </span>
      ),
    },
    {
      schluessel: 'deutsch', kopf: 'Deutsch',
      zelle: (feld) => (
        <span className="block min-w-0">
          <span className="block text-sm text-text">{feld.label}</span>
          {feld.hilfetext === undefined ? null : (
            <span className="mt-s1 block text-xs text-text-subtle">{feld.hilfetext}</span>
          )}
          <span className="mt-s1 block text-xs text-text-muted">{feld.fehlermeldung}</span>
          {optionenVon(feld).length === 0 ? null : (
            <span className="mt-s1 block text-xs text-text-subtle">
              {optionenVon(feld).map((o) => o.label).join(' · ')}
            </span>
          )}
        </span>
      ),
    },
    {
      schluessel: 'englisch', kopf: 'Englisch (/en/angebot)',
      zelle: (feld) => {
        const e = englisch(f.schluessel, feld.schluessel);
        if (e === null) {
          return (
            <span className="text-xs text-warning" data-cse="englisch-fehlt">
              fehlt — die englische Seite zeigt hier den deutschen Text (D-83)
            </span>
          );
        }
        const optionen = optionenVon(feld);
        const ohneOption = optionen.filter((o) => e.optionen?.[o.wert] === undefined);
        return (
          <span className="block min-w-0">
            <span className="block text-sm text-text">{e.label}</span>
            {e.hilfetext === undefined ? null : (
              <span className="mt-s1 block text-xs text-text-subtle">{e.hilfetext}</span>
            )}
            <span className="mt-s1 block text-xs text-text-muted">{e.fehlermeldung}</span>
            {ohneOption.length === 0 ? null : (
              <span className="mt-s1 block text-xs text-warning" data-cse="option-fehlt">
                {`ohne englische Bezeichnung: ${ohneOption.map((o) => o.wert).join(', ')}`}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <PortalRahmen
      titel={`${f.schluessel} · Version ${String(f.version)}`}
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="formulare"
                       sitzung={zugang.sitzung} />
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/website/formulare`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Formulare
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text">{f.titel}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2"
              data-cse="formular-zustand" data-zustand={f.zustand}>
          <StatusPill zustand={PILLE[f.zustand]} />
          <span className="font-mono text-xs text-text-muted">
            {`${f.schluessel} · v${String(f.version)}`}
          </span>
        </span>
      </div>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="formular-fehler" className="mb-s5 max-w-prose">
          {FEHLER[abgewiesen] ?? 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      )}
      {gespeichert === null ? null : (
        <Hinweis art="erfolg" cse="formular-gespeichert" className="mb-s5 max-w-prose">
          Gespeichert.
          {abgeloest === null ? '' : ` Version ${abgeloest} ist damit zurückgezogen — `
            + 'zwei lebende Versionen lässt die Datenbank nicht zu.'}
        </Hinweis>
      )}
      {neu === null ? null : (
        <Hinweis art="erfolg" cse="version-angelegt" className="mb-s5 max-w-prose">
          <strong className="block">
            {`Version ${neueVersion ?? '?'} ist als Entwurf angelegt.`}
          </strong>
          Felder und Datenschutzhinweis sind kopiert; live ist sie noch nicht.{' '}
          <Link href={`/portal/${mandant}/website/formulare/${neu}`}
                className="underline underline-offset-4" data-cse="zur-neuen-version">
            Zur neuen Version
          </Link>
          {suche['ohne_zustaendigkeit'] === '1'
            ? ' — die Zuständigkeit wurde NICHT mitkopiert (sie ist dieser Sitzung nicht '
              + 'lesbar). Ohne Besitzer fällt eine Anfrage niemandem zu.'
            : '.'}
        </Hinweis>
      )}

      {daten.dienstkonto && (
        <Hinweis art="warnung" cse="dienstkonto" className="mb-s5 max-w-prose">
          <strong className="block">Diese Sitzung ist ein Dienstkonto.</strong>
          Der Annahmeprinzipal hält <Recht schluessel="formular.schreiben" />,
          weil er Einsendungen speichern muss — nicht, um ein öffentliches Formular zu
          ändern (03-AUTH §14.3). Welches Recht das Live-Stellen tragen soll, ist offen
          (O-682); bis dahin ist hier nichts änderbar.
        </Hinweis>
      )}

      {felderUnlesbar && (
        <Hinweis art="warnung" cse="felder-unlesbar" className="mb-s5 max-w-prose">
          <strong className="block">Die Feldliste geht nicht durch ihren Vertrag.</strong>
          <code className="font-mono">lib/formular/schema.ts</code> ist die einzige Quelle
          für Validierung und Anzeige; was sie nicht liest, kann{' '}
          <code className="font-mono">/angebot</code> nicht rendern. Diese Version ist in
          diesem Zustand nicht veröffentlichungsfähig.
        </Hinweis>
      )}

      {/* ── Kopf ────────────────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Überschrift und Beschreibung</h2>
        <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
          Beides ist auch an einer lebenden Version änderbar — eine Einsendung hängt am
          Fremdschlüssel auf die Version, nicht an ihrer Überschrift.
        </p>
        {schreibt ? (
          <form method="post" action="/api/website/formular"
                className="flex max-w-prose flex-col gap-s4" data-cse="formular-kopf">
            <input type="hidden" name="handlung" value="kopf" />
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <FormField label="Titel" name="titel" defaultValue={f.titel} required
                       maxLength={200} />
            <div className="flex flex-col gap-s2">
              <label htmlFor="beschreibung" className="text-xs text-text-muted">
                Beschreibung — der Satz über den Feldern
              </label>
              <textarea id="beschreibung" name="beschreibung" rows={3} className={FELD}
                        defaultValue={f.beschreibung ?? ''} />
            </div>
            <Button type="submit" variante="secondary" className="self-start"
                    data-cse="kopf-speichern">
              Speichern
            </Button>
          </form>
        ) : (
          <p className="m-0 max-w-prose whitespace-pre-line text-sm text-text-muted">
            {f.beschreibung ?? '—'}
          </p>
        )}
      </Card>

      {/* ── Zuständigkeit ───────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">Zuständigkeit</h2>
        {!liest ? (
          <Hinweis art="warnung" cse="zustaendigkeit-nicht-lesbar" className="max-w-prose">
            Die Zuständigkeit hängt am Recht{' '}
            <Recht schluessel="formular.lesen" />. Diese Sitzung hält nur{' '}
            <Recht schluessel="formular.schreiben" /> — hier steht deshalb
            nichts, und das heisst nicht, dass nichts eingetragen ist.
          </Hinweis>
        ) : (
          <>
            <dl className="mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-muted">Besitzer</dt>
                <dd className="m-0 text-sm text-text" data-cse="besitzer">
                  {f.besitzerName
                    ?? (f.besitzerId === null ? 'nicht gesetzt' : 'nicht lesbar')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Eskalation</dt>
                <dd className="m-0 text-sm text-text" data-cse="eskalation">
                  {f.eskalationName
                    ?? (f.eskalationId === null ? 'nicht gesetzt' : 'nicht lesbar')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Reaktionszeit</dt>
                <dd className="m-0 text-sm text-text" data-cse="reaktionszeit">
                  {reaktionszeitText(f.slaStunden)}
                </dd>
              </div>
            </dl>
            <p className="mb-s4 mt-0 max-w-prose text-xs text-text-subtle">
              Die 24 Stunden des Erstbestands sind <strong>vorläufig</strong> (D-75): ob
              sie in Kalender- oder Werktagsstunden zählen und wann sie an einem
              Freitagabend anlaufen, ist offen (O-14). Die Plattform speichert die Zahl
              und rechnet nichts daraus, was niemand vereinbart hat.
            </p>
            {schreibt && (
              <form method="post" action="/api/website/formular"
                    className="flex max-w-prose flex-col gap-s4" data-cse="zustaendigkeit">
                <input type="hidden" name="handlung" value="zustaendigkeit" />
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="zurueck" value={pfad} />
                {liestBenutzer ? null : (
                  <p className="m-0 max-w-prose text-xs text-warning"
                     data-cse="ohne-benutzerliste">
                    Die Mitgliederliste ist dieser Sitzung <strong>beschnitten</strong>
                    {' '}(<Recht schluessel="system.benutzer_lesen" /> fehlt):
                    darin steht nur der eigene Zugang. Wer sonst noch in Frage käme, ist
                    hier nicht zu sehen — die Reaktionszeit lässt sich trotzdem eintragen.
                  </p>
                )}
                {daten.benutzer.length === 0 ? null : (
                  <>
                    <div className="flex flex-col gap-s2">
                      <label htmlFor="besitzer" className="text-xs text-text-muted">
                        Besitzer — wem eine neue Anfrage zufällt
                      </label>
                      <select id="besitzer" name="besitzer" className={FELD}
                              defaultValue={f.besitzerId ?? ''} data-cse="besitzer-wahl">
                        <option value="">unverändert lassen</option>
                        {daten.benutzer.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-s2">
                      <label htmlFor="eskalation" className="text-xs text-text-muted">
                        Eskalationsziel — wer erfährt, dass die Frist verstrichen ist
                      </label>
                      <select id="eskalation" name="eskalation" className={FELD}
                              defaultValue={f.eskalationId ?? ''} data-cse="eskalation-wahl">
                        <option value="">unverändert lassen</option>
                        {daten.benutzer.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <FormField
                  label="Reaktionszeit in Stunden (leer = keine Frist)"
                  name="slaStunden" type="number" min={1} step={1}
                  defaultValue={f.slaStunden === null ? '' : String(f.slaStunden)}
                  hinweis="Vorläufig (O-14) — die Plattform berechnet daraus keine Zusage."
                />
                <Button type="submit" variante="secondary" className="self-start"
                        data-cse="zustaendigkeit-speichern">
                  Zuständigkeit speichern
                </Button>
              </form>
            )}
          </>
        )}
      </Card>

      {/* ── Felder ──────────────────────────────────────────────────────── */}
      <section className="mb-s5" data-cse="formular-felder">
        <h2 className="mb-s3 text-h2 text-text">
          {`Felder (${String(felder.length)})`}
        </h2>
        <Hinweis art="hinweis" cse="felder-nur-lesen" className="mb-s4 max-w-prose">
          <strong className="block">Die Feldliste wird hier nicht geändert.</strong>
          {eingefroren
            ? 'Eine veröffentlichte Version ist eingefroren — eine Änderung ist '
              + 'Version + 1. '
            : 'Auch in einem Entwurf nicht: '}
          Die englische Fassung eines Feldes lebt im Code
          (<code className="font-mono">lib/i18n/formular-en.ts</code>), nicht in der
          Datenbank; ein hier angelegtes Feld stünde auf{' '}
          <code className="font-mono">/en/angebot</code> deutsch da. Das ist offen
          (O-680) und deshalb ausdrücklich nicht gebaut — statt halb.
        </Hinweis>
        {felder.length === 0 ? (
          <Hinweis art="warnung" cse="keine-felder" className="max-w-prose">
            Diese Version hat keine lesbare Feldliste.
          </Hinweis>
        ) : (
          <DataTable
            beschriftung="Felder dieser Formularversion, deutsch und englisch"
            zeilen={felder}
            schluessel={(feld) => feld.schluessel}
            spalten={feldSpalten}
          />
        )}
      </section>

      {/* ── Zustand ─────────────────────────────────────────────────────── */}
      {schreibt && (
        <Card className="mb-s5">
          <h2 className="mb-s3 mt-0 text-h3 text-text">Zustand</h2>
          <dl className="mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">Datenschutzhinweis</dt>
              <dd className="m-0 font-mono text-sm text-text">{f.datenschutzVersion}</dd>
            </div>
            <div>
              {/*
                * **„Erstmals" und nicht „Veröffentlicht".**
                *
                * `kern.erzwinge_serverzeit_veroeffentlichung` setzt den
                * Zeitpunkt beim ersten Mal auf `now()` und FRIERT ihn danach
                * ein (`elsif tg_op='UPDATE' and old.veroeffentlicht_am is not
                * null then new.veroeffentlicht_am := old.veroeffentlicht_am`).
                * Eine zurückgezogene und wieder live gestellte Version trägt
                * also weiter ihr erstes Datum. Unter der Überschrift
                * „Veröffentlicht" las sich das wie ein Datum von vor dem
                * Rückzug — die Beschriftung sagt jetzt, was der Wert ist.
                */}
              <dt className="text-xs text-text-muted">Erstmals veröffentlicht</dt>
              <dd className="m-0 text-sm text-text">
                {f.veroeffentlichtAm === null
                  ? '—' : BERLIN.format(new Date(f.veroeffentlichtAm))}
              </dd>
            </div>
          </dl>
          <p className="mb-s4 mt-0 max-w-prose text-xs text-text-subtle"
             data-cse="erstmals-hinweis">
            Der Zeitpunkt kommt vom Server und bleibt stehen: wird diese Version
            zurückgezogen und später wieder live gestellt, ändert er sich nicht. Er sagt,
            wann diese Fassung zum ersten Mal draussen war — nicht, seit wann sie es
            gerade ist.
          </p>

          {f.zustand === 'live' ? (
            <>
              <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
                Diese Version ist live. Zurückgezogen hat diese Gesellschaft kein
                Anfrageformular mehr, und{' '}
                <code className="font-mono">/angebot/{mandant}</code> antwortet mit 404 —
                das ist keine Panne, sondern eine Entscheidung.
              </p>
              <form method="post" action="/api/website/formular">
                <input type="hidden" name="handlung" value="zurueckziehen" />
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="zurueck" value={pfad} />
                <Button type="submit" variante="secondary" data-cse="formular-zurueckziehen">
                  Zurückziehen
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
                {anderesLive === null
                  ? 'Diese Gesellschaft hat derzeit kein lebendes Formular unter diesem '
                    + 'Schlüssel. Veröffentlicht antwortet /angebot wieder.'
                  : `Live ist derzeit Version ${String(anderesLive.version)}. Diese `
                    + 'hier zu veröffentlichen zieht jene im gleichen Schritt zurück — '
                    + 'die Datenbank lässt je Schlüssel genau eine lebende Version zu, '
                    + 'und zwei Klicks hätten dazwischen ein Loch, in dem die '
                    + 'öffentliche Seite mit 404 antwortet.'}
              </p>
              <form method="post" action="/api/website/formular">
                <input type="hidden" name="handlung" value="veroeffentlichen" />
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="zurueck" value={pfad} />
                <Button type="submit" variante="primary" disabled={felderUnlesbar}
                        data-cse="formular-veroeffentlichen">
                  {anderesLive === null
                    ? 'Veröffentlichen'
                    : `Veröffentlichen und Version ${String(anderesLive.version)} zurückziehen`}
                </Button>
              </form>
            </>
          )}

          <hr className="my-s5 border-0 border-t border-line" />
          <h3 className="mb-s2 mt-0 text-h3 text-text">Neue Version anlegen</h3>
          <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
            Kopiert Felder, Datenschutzhinweis und Zuständigkeit in Version{' '}
            {String(f.version + 1)} als Entwurf. Die lebende Zeile bleibt unangetastet —
            jede vorhandene Einsendung zeigt weiter auf die Version, die sie gesehen hat.
          </p>
          <form method="post" action="/api/website/formular">
            <input type="hidden" name="handlung" value="neue_version" />
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <Button type="submit" variante="ghost" data-cse="neue-version">
              Neue Version anlegen
            </Button>
          </form>
        </Card>
      )}

      {/* ── Geschwister ─────────────────────────────────────────────────── */}
      {geschwister.length > 0 && (
        <section data-cse="formular-versionen">
          <h2 className="mb-s3 text-h2 text-text">Andere Versionen</h2>
          <ul className="m-0 flex list-none flex-col gap-s2 p-0">
            {geschwister.map((g) => (
              <li key={g.id}
                  className="flex flex-wrap items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s3">
                <Link href={`/portal/${mandant}/website/formulare/${g.id}`}
                      className="text-sm text-text underline underline-offset-4 hover:text-brand">
                  {`Version ${String(g.version)}`}
                </Link>
                <span className="flex flex-wrap items-center gap-s3">
                  <span className="text-xs text-text-subtle">
                    {liest ? `${String(g.eingaenge)} Eingänge` : 'Eingänge nicht lesbar'}
                  </span>
                  <StatusPill zustand={PILLE[g.zustand]} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalRahmen>
  );
}
