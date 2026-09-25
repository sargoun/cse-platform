import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import { mengeNachPostgres } from '@/server/services/finanz/menge';
import { rechneTage, ZeitraumFehler } from '@/server/services/abwesenheit/tage';
import { findeAntrag, type AntragZeile } from '@/server/services/abwesenheit/antrag';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/personal/antraege/[id]` — ein Antrag und was seine
 * Genehmigung kosten wird (EMP-10, EMP-11, NOT-01).
 *
 * **Die Seite zeigt den PREIS vor der Entscheidung.** Die aus dem Zeitraum
 * gerechneten Arbeitstage (aus `rechneTage` — nie in SQL nachgebaut,
 * Invariante 6) und der Stand des Urlaubskontos stehen NEBEN dem
 * Genehmigen-Knopf. Fehlt der Anspruch des Jahres, bricht `entscheideAntrag`
 * mit `UrlaubskontoFehlt` ab (O-18); das vorher als Satz zu lesen ist besser
 * als nachher als Fehler.
 *
 * **Ein TAUSCHANTRAG bekommt hier keinen Genehmigen-Knopf.**
 * `entscheideAntrag` behandelt nur den Abwesenheitszweig; ein Tausch wuerde
 * auf `genehmigt` gesetzt, ohne dass im Dienstplan etwas geschieht und ohne
 * das SEC-04-Qualifikationstor, das 05-API-KARTE §C.8 fuer eine
 * Tauschgenehmigung ausdruecklich verlangt. Eine Genehmigung ohne Wirkung ist
 * schlimmer als ein fehlender Knopf: der Antragsteller liest „genehmigt" und
 * kommt nicht zur Schicht.
 *
 * **Das Urlaubskonto haengt an `zeit.konto_lesen`**, diese Seite an
 * `zeit.antrag_entscheiden`. Das Recht wird deshalb VORHER gefragt — null
 * Zeilen saehen sonst aus wie „kein Anspruch hinterlegt".
 */
export const dynamic = 'force-dynamic';

const STATUS_PILL: Readonly<Record<string, PillZustand>> = {
  eingereicht: 'Wartet',
  in_pruefung: 'In Prüfung',
  genehmigt: 'Bereit',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  storniert: 'Archiviert',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  eingereicht: 'eingereicht — wartet auf eine Entscheidung',
  in_pruefung: 'in Prüfung',
  genehmigt: 'genehmigt',
  abgelehnt: 'abgelehnt',
  zurueckgezogen: 'zurückgezogen — durch den Antragsteller selbst',
  storniert: 'storniert',
};

interface Urlaubsstand {
  readonly jahr: number;
  readonly anspruch: string;
  readonly genommen: string;
  readonly rest: string;
  readonly abgeschlossen: boolean;
}

function tageText(roh: string | null): string {
  if (roh === null) return '—';
  const [ganz = '0', bruch = ''] = roh.split('.');
  const gekuerzt = bruch.replace(/0+$/u, '');
  return gekuerzt === '' ? ganz : `${ganz},${gekuerzt}`;
}

export default async function Antragsblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/antraege/${id}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: jeder Verweis wird vorher gefragt (D-581). `zeit.konto_lesen`
     entscheidet zusaetzlich, ob das Urlaubskonto gelesen wird. */
  const darf = await haeltRechte(
    zugang.sitzung,
    'zeit.konto_lesen', 'zeit.abwesenheit_lesen', 'personal.lesen', 'dienstplan.lesen');

  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const antrag = await findeAntrag(kontext, id);
      if (antrag === null) return { antrag: null, konto: null };
      const jahr = antrag.vonDatum === null ? null : Number(antrag.vonDatum.slice(0, 4));
      const konto = darf['zeit.konto_lesen'] === true && jahr !== null
        ? (await kontext.abfrage<Urlaubsstand>(
          `select jahr, anspruch_tage::text as anspruch,
                  genommen_tage::text as genommen, rest_tage::text as rest,
                  (abgeschlossen_am is not null) as abgeschlossen
             from urlaubskonto
            where anstellung_id = $1::uuid and jahr = $2`,
          [antrag.anstellungId, jahr]))[0] ?? null
        : null;
      return { antrag, konto };
    })) as Promise<{ antrag: AntragZeile | null; konto: Urlaubsstand | null }>);

  if (daten.antrag === null) notFound();
  const { antrag, konto } = daten;

  /*
   * Die Arbeitstage kommen aus dem getesteten Dienst und nicht aus einer
   * Formel in dieser Datei (Invariante 6, K-10). Ein Zeitraum, den
   * `rechneTage` abweist — mehr als 366 Tage, Ende vor Anfang —, ist eine
   * Aussage und kein Absturz.
   */
  let tage: string | null = null;
  let tageFehler: string | null = null;
  if (antrag.vonDatum !== null && antrag.bisDatum !== null) {
    try {
      /* `mengeNachPostgres` und nicht `formatiereMenge`: der Rest dieser
       * Seite liest `numeric(12,3)`-Text aus der Datenbank, und `tageText`
       * kuerzt ihn. Zwei Schreibweisen fuer dieselbe Groesse auf einem
       * Bildschirm sind ein Lesefehler mit Ankuendigung. */
      tage = mengeNachPostgres(rechneTage({ von: antrag.vonDatum, bis: antrag.bisDatum }));
    } catch (f) {
      tageFehler = f instanceof ZeitraumFehler ? f.message : null;
      if (tageFehler === null) throw f;
    }
  }

  /*
   * **Gesperrt wird am richtigen Merkmal — und das ist nicht „Tausch".**
   *
   * Die Lage, in der `entscheideAntrag` wirkungslos ist, hat mit dem Tausch
   * nur zufaellig zu tun: der Dienst betritt den Abwesenheitszweig genau dann,
   * wenn `erzeugt_abwesenheit` UND eine Abwesenheitsart UND ein Zeitraum da
   * sind (services/abwesenheit/antrag.ts). Sonst legt eine „Genehmigung" nur
   * den Status um.
   *
   * An `istTausch` zu haengen war deshalb in beide Richtungen falsch: eine Art
   * mit `erzeugt_abwesenheit = true` UND `erfordert_einsatz = true` haette
   * ihren Knopf verloren, obwohl der Dienst sie behandelt — und eine Art ohne
   * beides (`ist_stammdatenaenderung` ist eine vorhandene Spalte, O-142 nennt
   * „Stammdatenaenderung" und „Schichtabgabe" als kommende Arten) haette einen
   * Knopf bekommen, der nichts tut. Der Katalog ist nach K-17 kundenpflegbar
   * (0275 gibt `insert` auf `antragsart`); das ist keine hypothetische Lage.
   *
   * `istTausch` bleibt — aber nur noch fuer den Verweis in den Dienstplan.
   */
  const istTausch = antrag.tauschPartnerAnstellungId !== null || antrag.einsatzId !== null;
  const wirktGenehmigung = antrag.erzeugtAbwesenheit
    && antrag.abwesenheitsartId !== null
    && antrag.vonDatum !== null && antrag.bisDatum !== null;
  const offen = antrag.status === 'eingereicht' || antrag.status === 'in_pruefung';
  const urlaubsantrag = antrag.erzeugtAbwesenheit && antrag.zaehltAufUrlaubskonto === true;
  const kontoFehlt = urlaubsantrag && darf['zeit.konto_lesen'] === true
    && (konto === null || konto.abgeschlossen);

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Antrag"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="antrag-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{antrag.art} — {antrag.personName}</h1>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={STATUS_PILL[antrag.status] ?? 'Offen'} />
          <span className="text-sm text-text-muted">
            {STATUS_TEXT[antrag.status] ?? antrag.status}
          </span>
        </span>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link href={`/portal/${mandant}/personal/antraege`} className={verweis}>
          Zum Eingang
        </Link>
        {darf['personal.lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/anstellungen/${antrag.anstellungId}`}
            className={verweis}
          >
            Zur Beschäftigung
          </Link>
        )}
        {antrag.abwesenheitId !== null && darf['zeit.abwesenheit_lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/abwesenheiten/${antrag.abwesenheitId}`}
            className={verweis}
          >
            Zur Abwesenheit
          </Link>
        )}
        {istTausch && darf['dienstplan.lesen'] === true && (
          <Link href={`/portal/${mandant}/dienstplan/woche`} className={verweis}>
            Zum Dienstplan
          </Link>
        )}
      </nav>

      {meldung !== null && (
        <Hinweis art="warnung" cse="antrag-meldung" className="mb-s5 max-w-prose">
          <strong>Der Vorgang lief nicht durch.</strong> {meldung}
        </Hinweis>
      )}
      {fehler !== null && meldung === null && (
        <Hinweis art="warnung" cse="antrag-fehler" className="mb-s5 max-w-prose">
          <strong>Der Vorgang lief nicht durch.</strong> Grund:{' '}
          <span className="font-mono">{fehler}</span>
        </Hinweis>
      )}

      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Der Antrag</h2>
        <dl data-cse="antrag-felder" className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
          <Feld label="Art" wert={`${antrag.art} (${antrag.artSchluessel})`} />
          <Feld label="Antragsteller" wert={antrag.personName} />
          <Feld
            label="Zeitraum"
            wert={antrag.vonDatum !== null && antrag.bisDatum !== null
              ? `${tagDeutsch(antrag.vonDatum)} bis ${tagDeutsch(antrag.bisDatum)}`
              : 'ohne Zeitraum'}
          />
          <Feld label="Eingereicht" wert={berlinAnzeige(antrag.eingereichtAm)} />
          <Feld
            label="Entschieden"
            wert={antrag.entschiedenAm === null ? '—' : berlinAnzeige(antrag.entschiedenAm)}
          />
          <Feld label="Kommentar der Entscheidung" wert={antrag.entscheidungKommentar ?? '—'} />
          <Feld label="Nachricht des Antragstellers" wert={antrag.nachricht ?? '—'} />
        </dl>
        <p className="mb-0 mt-s4 text-xs text-text-subtle">
          Zeitpunkte in Europe/Berlin, gespeichert UTC (Invariante 2). Warum
          jemand fehlt, steht hier nicht: Art und Bemerkung einer Abwesenheit
          sind Gesundheitsdaten nach Art. 9 DSGVO und hängen an einem eigenen
          Recht (LEG-09).
        </p>
      </section>

      <h2 className="mb-s3 text-h2 text-text">Was eine Genehmigung kostet</h2>
      <section data-cse="antrag-kosten" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
        {!antrag.erzeugtAbwesenheit ? (
          <p className="m-0 text-sm text-text-muted">
            Diese Antragsart erzeugt keine Abwesenheit — sie kostet keine
            Urlaubstage und bucht nichts.
          </p>
        ) : tageFehler !== null ? (
          <p className="m-0 text-sm text-warning">{tageFehler}</p>
        ) : (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
            <Feld label="Arbeitstage im Zeitraum" wert={tage === null ? '—' : tageText(tage)} />
            <Feld
              label="Zählt auf das Urlaubskonto"
              wert={antrag.zaehltAufUrlaubskonto === null
                ? 'keine Abwesenheitsart gewählt'
                : antrag.zaehltAufUrlaubskonto ? 'Ja' : 'Nein'}
            />
            {darf['zeit.konto_lesen'] !== true ? (
              <Feld
                label="Urlaubskonto"
                wert="kein Leserecht (zeit.konto_lesen) — nicht prüfbar"
              />
            ) : konto === null ? (
              <Feld label="Urlaubskonto" wert="für dieses Jahr nicht hinterlegt" />
            ) : (
              <>
                <Feld label="Anspruch" wert={`${tageText(konto.anspruch)} Tage`} />
                <Feld label="Genommen" wert={`${tageText(konto.genommen)} Tage`} />
                <Feld
                  label="Rest"
                  wert={`${tageText(konto.rest)} Tage${konto.abgeschlossen ? ' (Konto abgeschlossen)' : ''}`}
                />
              </>
            )}
          </dl>
        )}
        <p className="mb-0 mt-s4 text-xs text-text-subtle">
          Gezählt werden Arbeitstage ohne Wochenenden und Berliner Feiertage
          (§ 3 Abs. 2 BUrlG). Welche Wochentage je Arbeitszeitmodell als
          Arbeitstage gelten, ist noch nicht entschieden — ausgeliefert ist
          Montag bis Freitag (offen, O-18).
        </p>
      </section>

      {kontoFehlt && (
        <Hinweis art="warnung" cse="antrag-konto-fehlt" className="mb-s5 max-w-prose">
          <strong>Eine Genehmigung würde jetzt abbrechen.</strong> Für{' '}
          {antrag.vonDatum?.slice(0, 4) ?? 'dieses Jahr'} ist kein offener
          Urlaubsanspruch hinterlegt (O-18). Er wird eingetragen, bevor Urlaub
          genehmigt wird — sonst stünde der Resturlaub im Minus, ohne dass
          jemand das entschieden hätte.
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">Entscheidung</h2>
      {!wirktGenehmigung && istTausch ? (
        <Hinweis art="hinweis" cse="antrag-tausch" className="max-w-prose">
          <strong>Ein Tausch wird im Dienstplan vollzogen, nicht hier.</strong>{' '}
          Diese Seite hat dafür bewusst keinen Genehmigen-Knopf: eine
          Genehmigung würde den Antrag auf „genehmigt" setzen, ohne dass im
          Dienstplan etwas geschieht — und ohne das Qualifikationstor, das eine
          Tauschgenehmigung nach SEC-04 genauso durchlaufen muss wie das
          Besetzen (05-API-KARTE §C.8). Der Antragsteller läse „genehmigt" und
          käme nicht zur Schicht.
          <span className="mt-s2 block text-xs">
            Offen (O-613): ob eine Tauschgenehmigung die Umbesetzung selbst
            ausführen soll oder nur freigibt, und wer das
            Qualifikationstor verantwortet.
            {/* TODO(client, O-613): Soll die Genehmigung eines Tauschantrags die Umbesetzung im Dienstplan selbst ausfuehren (mit SEC-04-Qualifikationstor) oder nur die Freigabe erteilen, die eine Planerin dann umsetzt? */}
          </span>
        </Hinweis>
      ) : !wirktGenehmigung ? (
        <Hinweis art="hinweis" cse="antrag-ohne-wirkung" className="max-w-prose">
          <strong>Diese Antragsart legt hier nur den Status um.</strong> Die
          Entscheidung ist gebaut für Arten, die eine Abwesenheit erzeugen —
          mit Abwesenheitsart und Zeitraum. Diese Art bringt {antrag.erzeugtAbwesenheit
            ? 'zwar die Kennzeichnung mit, aber keine Abwesenheitsart oder keinen Zeitraum'
            : 'die Kennzeichnung nicht mit'}; eine Genehmigung schriebe also
          nichts und rechnete nichts. Einen Knopf dafür zu zeigen hiesse, eine
          Wirkung zu versprechen, die es nicht gibt.
          <span className="mt-s2 block text-xs">
            Offen (O-616): was die Genehmigung der Antragsarten leisten soll,
            die der Kunde nach K-17 selbst anlegt — Stammdatenänderung,
            Schichtabgabe, unbezahlte Freistellung.
            {/* TODO(client, O-616): Was soll die Genehmigung einer kundeneigenen Antragsart bewirken, die keine Abwesenheit erzeugt — Stammdatenaenderung, Schichtabgabe, unbezahlte Freistellung (K-17, O-142)? */}
          </span>
        </Hinweis>
      ) : !offen ? (
        <p data-cse="antrag-abgeschlossen" className="max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Entschieden ist entschieden. Ein entschiedener Antrag wird nicht
          zurückgedreht und nicht gelöscht — wer eine genehmigte Abwesenheit
          loswerden will, storniert sie mit Grund und Spur (Invariante 8).
        </p>
      ) : (
        <form
          method="post"
          action={`/api/antraege/${id}`}
          data-cse="antrag-entscheidung"
          className="flex max-w-prose flex-col gap-s3 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={pfad} />
          <label className="flex flex-col gap-s2 text-sm text-text">
            Kommentar (bei Ablehnung Pflicht)
            <input name="kommentar" className={feld} placeholder="Was spricht dafür oder dagegen?" />
          </label>
          <div className="flex flex-wrap gap-s3">
            <Button type="submit" name="entscheidung" value="genehmigt" variante="primary">
              Genehmigen
            </Button>
            <Button type="submit" name="entscheidung" value="abgelehnt" variante="secondary">
              Ablehnen
            </Button>
          </div>
          <p className="m-0 text-xs text-text-subtle">
            Eine Genehmigung schreibt die Abwesenheit, rechnet die Arbeitstage
            und bucht das Urlaubskonto des Jahres — in einer Transaktion. Das
            Zurückziehen ist die Handlung des Antragstellers und steht unter
            <span className="font-mono"> /portal/mein</span>, nicht hier.
          </p>
        </form>
      )}
    </PortalRahmen>
  );
}

function Feld({ label, wert }: { readonly label: string; readonly wert: string }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">{wert}</dd>
    </div>
  );
}
