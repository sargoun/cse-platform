import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import {
  ART_TEXT, ART_WIRKUNG, QUELLE_TEXT, liste, protokoll,
  type ProtokollZeile, type WiderspruchZeile,
} from '@/server/services/datenschutz/werbewiderspruch';

/**
 * `/portal/[mandant]/datenschutz/widersprueche` — das Nachweisblatt zu § 7 UWG
 * und Art. 21 DSGVO (CRM-08, LEG-08, 04-SEITENKARTE §5.25).
 *
 * **Zwei Listen, weil es zwei Widersprüche sind.** Die Seitenkarte trennt sie
 * ausdrücklich (§2.4), und ein Blatt, das sie vermischt, lädt dazu ein, einem
 * Kunden versehentlich die Rechnungen abzustellen:
 *
 *  - **Werbewiderspruch** (`werbewiderspruch_am`) sperrt `zweck = 'werbung'`.
 *    Rechnungen, Leistungsnachweise, Terminbestätigungen und Mahnungen laufen
 *    weiter — sie ruhen auf Art. 6 Abs. 1 lit. b.
 *  - **Widerspruch nach Art. 21** (`widerspruch_am`) zwingt
 *    `rechtsgrundlage = 'keine'`.
 *
 * **Kein Zurücknehmen-Knopf, und der Grund steht dabei.** Beide Spalten sind
 * schreibbar-einmal; `kern.erzwinge_widerspruch()` (0020) wirft, wenn jemand
 * sie auf NULL setzt. Sie zurückzunehmen ist keine Datenpflege, sondern das
 * Löschen eines Beweises — und der Beweis ist der, mit dem sich eine Abmahnung
 * abwehren lässt.
 *
 * **Die Kontaktspalten sind `cse_app` entzogen** (K-05-Block in 0020,
 * nachgemessen: nur INSERT und UPDATE, kein SELECT). Gelesen wird über
 * `app.werbewiderspruch_liste()` (0222) — EIN Abruf, EINE Protokollzeile. Die
 * Alternative wäre `app.rechtsgrundlage_lesen` je Kontakt und damit eine
 * Protokollzeile je Zeile: das Prüfprotokoll füllte sich mit Aufrufen statt
 * mit Vorgängen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Widersprüche — Datenschutz' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Einwilligung',
  bestandskunde: 'Bestandskunde',
  anfrage: 'Anfrage',
  keine: 'keine',
};

function Blatt({ titel, erklaerung, zeilen, art, mandant, darfKunde }: {
  readonly titel: string;
  readonly erklaerung: string;
  readonly zeilen: readonly WiderspruchZeile[];
  readonly art: 'werbung' | 'verarbeitung';
  readonly mandant: string;
  /**
   * Die Kundenseite verlangt `crm.lesen`. Ohne das Recht bleibt der Name als
   * Text stehen und verliert nur den Verweis (D-567): ein Verweis, der auf
   * 404 führt, verrät die Existenz dessen, was er nicht zeigen darf (AUT-06).
   */
  readonly darfKunde: boolean;
}) {
  return (
    <section aria-label={titel} data-cse={`widerspruch-${art}`} className="mb-s7">
      <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
        <h2 className="m-0 text-h2 text-text">{titel}</h2>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Eintrag' : `${String(zeilen.length)} Einträge`}
        </p>
      </div>
      <p className="mb-s4 max-w-prose text-sm text-text-muted">{erklaerung}</p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Eintrag. Das Blatt ist ein Nachweis, kein Verzeichnis — wer nicht
          widersprochen hat, steht hier nicht.
        </p>
      ) : (
        <DataTable
          beschriftung={titel}
          zeilen={[...zeilen]}
          schluessel={(w) => `${w.ebene}-${w.betroffenerId}`}
          spalten={[
            {
              schluessel: 'wer',
              kopf: 'Kontakt oder Firma',
              zelle: (w) => (
                <span>
                  {w.ebene === 'kunde' && w.kundeName !== null && darfKunde ? (
                    <Link href={`/portal/${mandant}/crm/kunden/${w.betroffenerId}`}
                          className="text-text underline-offset-2 hover:text-brand hover:underline">
                      {w.name}
                    </Link>
                  ) : w.name}
                  <span className="block text-xs text-text-muted">
                    {w.ebene === 'kunde' ? 'Firma' : `Kontakt · ${w.kundeName ?? '—'}`}
                  </span>
                </span>
              ),
            },
            { schluessel: 'email', kopf: 'E-Mail', zelle: (w) => w.email ?? '—' },
            {
              schluessel: 'zeitpunkt',
              kopf: 'Erklärt am (Berliner Zeit)',
              zelle: (w) => {
                const t = art === 'werbung' ? w.werbewiderspruchAm : w.widerspruchAm;
                return t === null
                  ? <span className="text-text-subtle">—</span>
                  : BERLIN.format(new Date(t));
              },
            },
            {
              schluessel: 'grundlage',
              kopf: 'Rechtsgrundlage jetzt',
              zelle: (w) => (
                <span>
                  <StatusPill zustand={w.rechtsgrundlage === 'keine' ? 'Fehler' : 'Aktiv'} />
                  <span className="block text-xs text-text-muted">
                    {GRUNDLAGE_TEXT[w.rechtsgrundlage] ?? w.rechtsgrundlage}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}

export default async function Widerspruechseite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(
    `/portal/${mandant}/datenschutz/widersprueche`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  /* `crm.lesen` gehoert nicht dieser Seite, sondern dem Ziel ihrer Verweise:
     die Namensspalte fuehrt auf die Kundenseite (D-567). */
  const darf = await haeltRechte(
    zugang.sitzung, 'crm.rechtsgrundlage_lesen', 'crm.lesen');

  /**
   * **Der Definer WIRFT, wenn das Recht fehlt — und das ist richtig.**
   *
   * `app.werbewiderspruch_liste()` gibt keine leere Menge zurück, sondern
   * `insufficient_privilege`: eine leere Liste hiesse „niemand hat
   * widersprochen", und das ist die Aussage, nach der jemand eine Werbemail
   * schickt. Das Tor der Route verlangt dasselbe Recht, dieser Fall sollte
   * also nie eintreten — aber „sollte nie" ist kein Grund für eine 500er-Seite
   * mit „Da ist etwas schiefgegangen". Gefangen wird er hier und in Worten
   * gesagt.
   */
  let daten: {
    zeilen: readonly WiderspruchZeile[]; spur: readonly ProtokollZeile[];
  } = { zeilen: [], spur: [] };
  let lesbar = true;
  try {
    daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => ({
        zeilen: await liste(kontext),
        spur: await protokoll(kontext),
      })))) as {
        zeilen: readonly WiderspruchZeile[]; spur: readonly ProtokollZeile[];
      };
  } catch {
    lesbar = false;
  }

  const werbung = daten.zeilen.filter((w) => w.werbewiderspruchAm !== null);
  const verarbeitung = daten.zeilen.filter((w) => w.widerspruchAm !== null);

  return (
    <PortalRahmen
      titel="Widersprüche"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s2 text-h1 text-text">Widersprüche</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Wer hat wann widersprochen, auf welchem Weg, und was sendet seitdem nicht
        mehr. Das ist das Blatt, das im Streitfall vorgelegt wird: § 7 UWG
        verbietet elektronische Werbung ohne vorherige ausdrückliche Einwilligung
        — auch im B2B —, und die Beweislast liegt beim Absender.
      </p>

      <Hinweis art="hinweis" cse="widerspruch-unwiderruflich" className="mb-s5 max-w-prose">
        <strong className="block">Es gibt hier keinen Zurücknehmen-Knopf.</strong>
        Beide Zeitstempel sind schreibbar-einmal und nicht räumbar: der Auslöser
        <code className="mx-s1 font-mono">kern.erzwinge_widerspruch()</code>
        wirft, wenn jemand sie auf NULL setzt. Sie zurückzunehmen ist keine
        Datenpflege, sondern das Löschen eines Beweises.
      </Hinweis>

      {darf['crm.rechtsgrundlage_lesen'] !== true || !lesbar ? (
        <Hinweis art="warnung" cse="widerspruch-kein-recht" className="mb-s5 max-w-prose">
          <strong className="block">Die Kontaktspalten sind nicht lesbar.</strong>
          Für die Liste braucht es
          {' '}<code className="font-mono">crm.rechtsgrundlage_lesen</code>: die
          Spalten von <code className="font-mono">ansprechpartner</code> sind der
          Anwendung entzogen (K-05) und kommen über eine Definer-Funktion, die
          dieses Recht prüft und jeden Abruf protokolliert.
        </Hinweis>
      ) : null}

      <Blatt
        titel="Werbewiderspruch (§ 7 UWG)"
        erklaerung={ART_WIRKUNG.werbung}
        zeilen={werbung}
        art="werbung"
        mandant={mandant}
        darfKunde={darf['crm.lesen'] === true}
      />

      <Blatt
        titel="Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)"
        erklaerung={ART_WIRKUNG.verarbeitung}
        zeilen={verarbeitung}
        art="verarbeitung"
        mandant={mandant}
        darfKunde={darf['crm.lesen'] === true}
      />

      <section aria-labelledby="protokoll" className="mb-s6">
        <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 id="protokoll" className="m-0 text-h2 text-text">
            Protokoll: Weg, Kanal und auslösende Nachricht
          </h2>
          <p className="m-0 text-sm text-text-muted">
            {`${String(daten.spur.length)} Zeile(n)`}
          </p>
        </div>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Die beiden Zeitstempel oben sagen, DASS widersprochen wurde. Sie sagen
          nicht, auf welchem Weg und welche Nachricht der Anlass war — und das ist
          die Hälfte, auf die es in einer Abmahnung ankommt. Diese Zeilen entstehen
          seit <code className="font-mono">0222</code>; frühere Widersprüche haben
          keine, und das Blatt erfindet sie nicht.
        </p>

        {daten.spur.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Noch keine Protokollzeile. Sie entsteht beim Klick auf den
            Widerspruchslink einer Werbenachricht, beim tokenlosen Formular
            <code className="mx-s1 font-mono">/werbewiderspruch</code> und bei
            einem Widerspruch, den ein Mensch im Vorgang festhält.
          </p>
        ) : (
          <DataTable
            beschriftung="Protokoll der erklärten Widersprüche"
            zeilen={[...daten.spur]}
            schluessel={(p) => p.id}
            spalten={[
              {
                schluessel: 'zeit',
                kopf: 'Eingegangen',
                zelle: (p) => BERLIN.format(new Date(p.eingegangenAm)),
              },
              {
                schluessel: 'art',
                kopf: 'Art',
                zelle: (p) => ART_TEXT[p.art],
              },
              {
                schluessel: 'wer',
                kopf: 'Betroffener',
                zelle: (p) => (
                  <span>
                    {p.name ?? <span className="text-text-muted">Name nicht lesbar</span>}
                    <span className="block text-xs text-text-muted">
                      {p.email ?? (p.ansprechpartnerId === null ? 'Firma' : 'Kontakt')}
                    </span>
                  </span>
                ),
              },
              { schluessel: 'kanal', kopf: 'Kanal', zelle: (p) => p.kanal ?? '—' },
              {
                schluessel: 'weg',
                kopf: 'Weg',
                zelle: (p) => (
                  <span>
                    {QUELLE_TEXT[p.quelle]}
                    {p.nachrichtId === null ? null : (
                      <span className="block text-xs text-text-muted">
                        mit auslösender Nachricht
                      </span>
                    )}
                    {p.erfasstVon === null ? null : (
                      <span className="block text-xs text-text-muted">{p.erfasstVon}</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'bemerkung',
                kopf: 'Bemerkung',
                zelle: (p) => p.bemerkung ?? '—',
              },
            ]}
          />
        )}
      </section>

      <Hinweis art="hinweis" cse="widerspruch-offen" className="max-w-prose">
        <strong className="block">Drei Punkte sind offen und stehen hier als offen.</strong>
        <ul className="m-0 mt-s2 list-disc ps-s5">
          <li>
            <strong>O-640</strong> — soll ein Werbewiderspruch je Kanal gelten (nur
            E-Mail, Post läuft weiter) oder pauschal? Heute pauschal: die Sperre
            sitzt in EINER Spalte, so hat 0020 das Modell entschieden. Der Kanal in
            der Protokollzeile beschreibt den Anlass und wirkt nicht.
          </li>
          <li>
            <strong>O-641</strong> — wirkt ein Widerspruch bei einer Gesellschaft
            auch für die drei anderen? Heute nicht: die vier sind verschiedene
            juristische Personen, jede für ihre Werbung selbst verantwortlich.
          </li>
          <li>
            <strong>O-65</strong> — gilt eine transaktionale Nachricht
            (Terminbestätigung, Leistungsnachweis, Mahnung) als vertraglich
            notwendig? Bis das entschieden ist, weist
            {' '}<code className="font-mono">app.darf_kontaktiert_werden</code> sie
            bei Werbewiderspruch ab, statt sie lautlos zu senden — der restriktive
            Zweig, sichtbar statt still.
          </li>
        </ul>
      </Hinweis>
    </PortalRahmen>
  );
}
