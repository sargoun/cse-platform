import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  HINWEIS_TEXT, ladeRichtlinie, WIRKUNG_TEXT, type RichtlinieBlick, type Wirkung,
} from '@/server/services/agent/richtlinie';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/agenten/richtlinien/[id]` — EINE Zeile des
 * Ausgangs-Gates einstellen (AGT-03, APR-01, Invariante 7, Invariante 8).
 *
 * **Die Aktion ist unveränderlich.** Sie ist Teil des eindeutigen Schlüssels
 * (`agent_richtlinie_uk` über `mandant_id, aktion`); sie hier umzustellen
 * hiesse, eine andere Zeile zu meinen. Wer eine andere Aktion konfigurieren
 * will, legt sie in der Liste an.
 *
 * **Drei Felder, und das dritte ist Pflicht, sobald die Automatik an ist.**
 * `auto_erlaubt` als Schalter, `max_betrag_cent` als Euro-Eingabe (der Dienst
 * rechnet sie in ganze Cent — Invariante 1, nie eine Gleitkommazahl) und
 * `begruendung` als Text: wer Automatik einschaltet, schuldet den anderen eine
 * Erklärung, und in einem halben Jahr ist „warum darf das von allein hinaus"
 * eine echte Frage. **Erzwungen wird das im Dienst** (`setzeRichtlinie`) und
 * nicht durch `required`: hier stand ein `required`, das nur im Browser galt,
 * während dasselbe Feld der Schwesterseite ohne `required` durch denselben
 * Handler ging. Was ein Formular fordert, entscheidet nicht, was gespeichert
 * werden kann.
 *
 * **Die Sperre wird GEZEIGT, nicht als Datenbankfehler nachgeliefert.** Für
 * Angebot, Nachtrag und Behinderungsanzeige steht das Häkchen gesperrt da,
 * mit dem Grund daneben: § 145 BGB, § 2 Abs. 6 und § 6 Abs. 1 VOB/B. „Ein
 * Angebot sendet sich unter keiner Einstellung selbst" ist eine Aussage der
 * Seitenkarte, kein Betriebsunfall — und `setzeRichtlinie` weist eine
 * gespeicherte Erlaubnis ohnehin ab, die Datenbank seit 0290 für alle drei ein
 * zweites Mal (`agent_richtlinie_kein_auto_willenserklaerung`; der alte Riegel
 * `agent_richtlinie_kein_auto_angebot` aus 0012 deckte nur das Angebot und ist
 * mit 0290 gefallen).
 *
 * **Und sie hebt LEG-08 nicht auf.** Ein Kontakt ohne aufgezeichnete
 * Rechtsgrundlage wird abgewiesen, ungeachtet jeder Einstellung hier und
 * jeder erteilten Freigabe — § 7 UWG ist ein hartes Tor.
 *
 * **Gelöscht wird nicht.** `agent_richtlinie` trägt keine
 * `geloescht_am`-Spalte und eine Löschsperre (0203): abgeschaltet wird über
 * „aktiv", damit belegbar bleibt, was einmal galt (Invariante 8). Eine
 * abgeschaltete Zeile wirkt wie keine — das Gate verlangt dann eine Freigabe.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<Wirkung, PillZustand>> = {
  nicht_hinterlegt: 'Offen',
  abgeschaltet: 'Inaktiv',
  freigabe: 'In Prüfung',
  im_code_gesperrt: 'Wartet',
  automatisch: 'Aktiv',
  automatisch_bis_limit: 'Aktiv',
};

export default async function Richtlinie(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  /* Ein CODE aus geschlossenem Satz, kein Text aus der Adresse — siehe
     `HINWEIS_TEXT`. */
  const hinweis = typeof suche['hinweis'] === 'string'
    ? HINWEIS_TEXT[suche['hinweis']] ?? null : null;

  const tor = await mandantTor(`/portal/${mandant}/agenten/richtlinien/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const r = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeRichtlinie(kontext, id)),
  ) as Promise<RichtlinieBlick | null>);

  /*
   * Keine Zeile heisst „gibt es nicht ODER darf die Sitzung nicht sehen" —
   * nach aussen dasselbe (AUT-06). Die Policy `t_richtlinie_lesen` verlangt
   * `agent.richtlinie_verwalten` oder `versand.lesen`; das Tor der Route
   * verlangt das erste, also kommt niemand hierher, der es nicht hält.
   */
  if (r === null) notFound();

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 '
    + 'text-base text-text';

  return (
    <PortalRahmen
      titel={r.text}
      wurzelTitel="Richtlinien"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="agenten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{r.text}</h1>
          <p className="mt-s2 text-sm text-text-muted">
            <code className="text-xs">{r.aktion}</code>
            {r.erstelltAm === null ? '' : ` · angelegt ${r.erstelltAm}`}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-s2">
          <StatusPill zustand={PILLE[r.wirkung]} />
          <Link href={`/portal/${mandant}/agenten/richtlinien`}
                data-cse="richtlinie-zur-liste"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zur Liste
          </Link>
        </span>
      </div>

      {hinweis === null ? null : (
        <Hinweis art="hinweis" cse="richtlinie-hinweis" className="mb-s5 max-w-prose">
          {hinweis}
        </Hinweis>
      )}

      <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="richtlinie-wirkung">
        <strong>Heute: {WIRKUNG_TEXT[r.wirkung]}.</strong>{' '}
        Eine Richtlinie entscheidet nur dort, wo keine menschliche Freigabe vorliegt — eine
        gültige Freigabe schlägt jede Automatik, und der Nutzlast-Hash bindet sie an den
        Inhalt: wer nach der Freigabe den Text ändert, hat keine Freigabe mehr für das, was
        er sendet. § 7 UWG steht vor allem: ein Kontakt ohne aufgezeichnete Rechtsgrundlage
        wird abgewiesen, ungeachtet jeder Einstellung hier (LEG-08).
        {r.maxBetragCent === null
          ? ''
          : ` Die hinterlegte Grenze liegt bei ${formatiereGeld(r.maxBetragCent)}.`}
      </p>

      {r.unbekannteAktion ? (
        <Hinweis art="warnung" cse="richtlinie-unbekannt" className="mb-s5 max-w-prose">
          <strong>Diese Aktion kennt das Gate nicht.</strong> Die Spalte
          {' '}<code className="text-xs">aktion</code> ist blanker Text;
          {' '}<code className="text-xs">{r.aktion}</code> kommt in den acht
          {' '}<code className="text-xs">AKTIONEN</code> aus
          {' '}<code className="text-xs">server/agent/policy.ts</code> nicht vor.
          {' '}<code className="text-xs">gate()</code> schlägt die Zeile deshalb nie nach:
          sie wirkt wie keine, also „Freigabe nötig" — auch wenn hier „automatisch"
          eingestellt wäre. Speichern lässt sie sich von dieser Seite nicht; wer sie
          korrigieren will, legt die richtige Aktion in der Liste an.
        </Hinweis>
      ) : null}

      {r.imCodeGesperrt ? (
        <Hinweis art="warnung" cse="richtlinie-gesperrt" className="mb-s5 max-w-prose">
          <strong>Diese Aktion geht nie automatisch hinaus.</strong> {r.grund}{' '}
          Die Sperre steht im Code (<code className="text-xs">server/agent/policy.ts</code>)
          und nicht in dieser Tabelle — eine hier gespeicherte Erlaubnis wäre wirkungslos
          und sähe auf dem Bildschirm wie eine aus. Das Häkchen bleibt deshalb gesperrt.
        </Hinweis>
      ) : null}

      {r.unbekannteAktion ? null : (
        <form method="post" data-cse="richtlinie-formular"
              action={`/api/einstellungen/agent-richtlinien?mandant=${mandant}`}
              className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          {/*
            * Die Aktion fährt als verstecktes Feld mit, weil der Handler nach
            * `(mandant_id, aktion)` schreibt — nicht nach `id`. Sie ist der
            * Schlüssel der Zeile, kein Eingabefeld: die Seite zeigt sie oben
            * als Text.
            */}
          <input type="hidden" name="aktion" value={r.aktion} />
          <input type="hidden" name="ziel" value="agenten" />

          <div className="flex flex-col gap-s4">
            <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="autoErlaubt" value="ja"
                     data-cse="richtlinie-auto"
                     defaultChecked={r.autoErlaubt && !r.imCodeGesperrt}
                     disabled={r.imCodeGesperrt} />
              Darf ohne menschliche Freigabe hinausgehen
            </label>

            <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="istAktiv" value="ja"
                     data-cse="richtlinie-aktiv" defaultChecked={r.istAktiv} />
              Richtlinie ist aktiv
            </label>
            <p className="text-xs text-text-muted">
              Eine abgeschaltete Richtlinie wirkt wie keine: das Gate verlangt eine
              Freigabe. Sie bleibt lesbar, damit belegbar ist, was einmal galt — gelöscht
              wird hier nichts (Invariante 8).
            </p>

            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="maxBetrag">
              Betragsgrenze in Euro (leer = kein Limit)
              <input id="maxBetrag" name="maxBetrag" type="text" inputMode="decimal"
                     data-cse="richtlinie-grenze" className={feld} placeholder="0,00"
                     defaultValue={r.maxBetragCent === null
                       ? '' : formatiereGeld(r.maxBetragCent).replace(/\s*€$/u, '')} />
            </label>
            <p className="text-xs text-text-muted">
              Der Betrag wird in ganze Cent gelesen und als ganze Cent gespeichert
              (Invariante 1). Er greift nur, wo die Nutzlast einen Betrag trägt; über der
              Grenze verlangt das Gate eine Freigabe.
            </p>

            <label className="flex flex-col gap-s2 text-xs text-text-muted" htmlFor="begruendung">
              Begründung (Pflicht, sobald das Häkchen oben gesetzt ist —
              mindestens fünf Zeichen)
              <textarea id="begruendung" name="begruendung" rows={3} minLength={5}
                        data-cse="richtlinie-begruendung"
                        className="w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
                        defaultValue={r.begruendung ?? ''}
                        placeholder="Warum diese Aktion so konfiguriert ist." />
            </label>

            <div>
              <Button type="submit" variante="primary" data-cse="richtlinie-speichern">
                Richtlinie setzen
              </Button>
            </div>
          </div>
        </form>
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        {r.geaendertAm === null
          ? 'Seit dem Anlegen unverändert.'
          : `Zuletzt gesetzt ${r.geaendertAm}${
            r.geaendertVon === null ? '' : ` von ${r.geaendertVon}`}.`}
        {' '}Jede Änderung steht im Protokoll (Einstellungen › Protokoll). Was ein Agent
        vorgelegt hat und was ein Mensch entschieden hat, steht im Freigabe-Posteingang —
        nicht hier: diese Seite setzt die Regel, sie gibt nichts frei.
      </p>
    </PortalRahmen>
  );
}
