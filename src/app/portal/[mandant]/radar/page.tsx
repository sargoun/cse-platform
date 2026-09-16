import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { alleQuellStaende } from '@/server/services/radar/quelle';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../unterseite';
import { leseRadarKennzahlen, leseRadarListe, type RadarKennzahlen, type RadarZeile } from './daten';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/radar` — die Liste (RAD-01, RAD-02, RAD-05 … RAD-09).
 *
 * **Was diese Seite am Morgen leisten muss.** Eine Vergabe verpasst man nicht
 * daran, dass sie fehlt, sondern daran, dass sie zwischen dreissig anderen
 * steht. Deshalb: Punkte mit dem Satz, der sie erklärt; die Restfrist als
 * Zahl, unter fünf Tagen rot (RAD-06); und die Plattformwarnung HIER und
 * nicht erst im Detail — eine Freischaltung dauert Tage bis Wochen, wer das
 * am Abgabetag merkt, hat die Chance verloren (RAD-09).
 *
 * **Kein Knopf „einreichen".** Es gibt keinen, nirgends in diesem Modul
 * (D-07): die deutschen Vergabeplattformen bieten dafür keine Schnittstelle
 * an. Die Plattform bereitet vor, ein Mensch lädt hoch.
 */
export const dynamic = 'force-dynamic';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const VORGANG: Readonly<Record<string, string>> = {
  neu: 'neu', geprueft: 'geprüft', verworfen: 'verworfen', in_bearbeitung: 'in Bearbeitung',
  eingereicht: 'eingereicht', zuschlag: 'Zuschlag', nicht_beruecksichtigt: 'nicht berücksichtigt',
  verfahren_aufgehoben: 'Verfahren aufgehoben',
};

/**
 * Die Restfrist als Text, nicht als Pille.
 *
 * **Warum nicht als Pille.** DESIGN §5 gibt den Status-Pillen ein FESTES
 * Vokabular („Überfällig", „Wartet", „Bereit" …). „Noch 3 Tage" steht dort
 * nicht, und eine Pille mit erfundenem Text wäre genau die Art Ausnahme, die
 * ein Vokabular auflöst. Die Farbe trägt die Dringlichkeit trotzdem — und
 * nicht allein: die Zahl steht daneben (§9).
 *
 * Fünf Tage nennt RAD-06 selbst; die Grenze ist nicht erfunden.
 */
function fristKlasse(rest: number | null): string {
  if (rest === null) return 'text-text-subtle';
  if (rest < 0) return 'text-text-subtle';
  if (rest < 5) return 'text-danger font-semibold';
  if (rest < 14) return 'text-warning';
  return 'text-text-muted';
}

function fristText(rest: number | null): string {
  if (rest === null) return 'keine Frist genannt';
  if (rest < 0) return 'Frist abgelaufen';
  if (rest === 0) return 'heute';
  if (rest === 1) return 'noch 1 Tag';
  return `noch ${String(rest)} Tage`;
}

export default async function Radar(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/radar`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'radar.profil_schreiben', 'radar.plattform_verwalten');
  const suche = await searchParams;
  const nurOffene = suche['alle'] !== '1';

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      zeilen: await leseRadarListe(kontext, { nurOffene }),
      kennzahlen: await leseRadarKennzahlen(kontext),
    }))) as Promise<{ zeilen: readonly RadarZeile[]; kennzahlen: RadarKennzahlen }>);

  const quellen = alleQuellStaende();
  const ohneQuelle = quellen.every((q) => !q.verbunden);
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2';

  const spalten: readonly Spalte<RadarZeile>[] = [
    {
      schluessel: 'titel', kopf: 'Bekanntmachung',
      zelle: (z) => (
        <div className="min-w-0">
          <Link href={`/portal/${mandant}/radar/${z.ausschreibungId}`} className="text-text underline underline-offset-4 hover:text-brand">
            {z.titel}
          </Link>
          <div className="mt-s1 text-xs text-text-subtle">
            {z.vergabestelle ?? 'Vergabestelle unbekannt'}
            {z.ort === null ? '' : ` · ${z.ort}`}
            {z.cpvHaupt === null ? '' : ` · CPV ${z.cpvHaupt}`}
          </div>
        </div>
      ),
    },
    {
      schluessel: 'punkte', kopf: 'Punkte', numerisch: true,
      zelle: (z) => (
        <span title={z.begruendung} data-cse="radar-punkte">
          {z.ausgeschlossen ? '—' : `${String(z.punkte)} / ${String(z.skalaMax)}`}
        </span>
      ),
    },
    { schluessel: 'profil', kopf: 'Profil', zelle: (z) => z.profilName },
    {
      schluessel: 'frist', kopf: 'Abgabe',
      zelle: (z) => (
        <span className="flex flex-col gap-s1" data-cse="radar-frist" data-rest={String(z.restTage ?? '')}>
          {z.restTage !== null && z.restTage < 0
            ? <StatusPill zustand="Überfällig" />
            : <span className={`text-sm ${fristKlasse(z.restTage)}`}>{fristText(z.restTage)}</span>}
          <span className="text-xs text-text-subtle">
            {z.fristAngebot === null ? '—' : BERLIN.format(z.fristAngebot)}
          </span>
        </span>
      ),
    },
    {
      schluessel: 'wert', kopf: 'Wert', numerisch: true,
      zelle: (z) => (z.wertCent === null
        ? <span className="text-text-subtle">—</span>
        : z.wertKriterium === 'fremdwaehrung'
          ? <span title="Fremdwährung — nicht umgerechnet (O-47)">{`${z.wertCent.toString()} ${z.waehrung ?? ''}`}</span>
          : <span>{formatiereGeld(cent(z.wertCent))}</span>),
    },
    {
      schluessel: 'plattform', kopf: 'Plattform',
      zelle: (z) => (z.plattformName === null
        ? <span className="text-xs text-text-subtle">{z.plattformHinweis ?? 'unbekannt'}</span>
        : z.registrierung === 'registriert'
          ? <span className="text-xs text-text-muted">{z.plattformName}</span>
          : (
            /*
             * RAD-09 in der LISTE: die Freischaltung dauert Tage bis Wochen.
             * Wer erst beim Öffnen sieht, dass sein Haus dort kein Konto hat,
             * sieht es zu spät.
             */
            <span data-cse="radar-nicht-registriert" className="flex flex-col gap-s1">
              <span className="text-sm font-semibold text-danger">nicht freigeschaltet</span>
              <span className="text-xs text-text-subtle">{z.plattformName}</span>
            </span>
          )),
    },
    {
      schluessel: 'vorgang', kopf: 'Stand',
      zelle: (z) => (z.vorgangStatus === null
        ? <span className="text-xs text-text-subtle">neu</span>
        : <span className="text-xs text-text-muted">{VORGANG[z.vorgangStatus] ?? z.vorgangStatus}</span>),
    },
  ];

  return (
    <PortalRahmen
      titel="Vergaberadar"
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Vergaberadar</h1>
        <nav aria-label="Radar" className="flex flex-wrap gap-s2">
          {/*
            * `/radar/profile` verlangt `radar.profil_schreiben`, `/radar/plattformen`
            * `radar.plattform_verwalten` (Manifest); diese Liste nur `radar.lesen`.
            * Ohne das jeweilige Recht fuehrte der Knopf auf 404 (AUT-06; D-581).
            */}
          {darf['radar.profil_schreiben'] === true && (
            <Link href={`/portal/${mandant}/radar/profile`} className={knopf} data-cse="radar-profile">Suchprofile</Link>
          )}
          {darf['radar.plattform_verwalten'] === true && (
            <Link href={`/portal/${mandant}/radar/plattformen`} className={knopf} data-cse="radar-plattformen">Plattformen</Link>
          )}
          <Link href={nurOffene ? `/portal/${mandant}/radar?alle=1` : `/portal/${mandant}/radar`}
            className={knopf} data-cse="radar-umschalten">
            {nurOffene ? 'Auch abgelaufene' : 'Nur offene'}
          </Link>
        </nav>
      </div>

      <div data-cse="radar-kennzahlen" className="mb-s5 grid grid-cols-2 gap-s3 lg:grid-cols-4">
        <KpiStat label="Bekanntmachungen" wert={String(daten.kennzahlen.bekanntmachungen)} />
        <KpiStat label="Offene Fristen" wert={String(daten.kennzahlen.offeneFristen)} />
        <KpiStat label="Unter fünf Tagen" wert={String(daten.kennzahlen.unter5Tage)} />
        <KpiStat label="Ohne Freischaltung" wert={String(daten.kennzahlen.ohneRegistrierung)} />
      </div>

      {ohneQuelle ? (
        <Hinweis art="warnung" cse="radar-quellen" className="mb-s5 max-w-prose">
          <strong>Keine Quelle verbunden.</strong> Der Radar liest{' '}
          {quellen.map((q) => q.name).join(' und ')} — beide sind öffentlich und brauchen keinen
          Zugangsschlüssel. Was fehlt, ist die Abfrage, die dieser Betrieb stellen will: welche
          CPV-Gruppen, welche Region, welches Zeitfenster (offene Frage O-366). Bis dahin steht hier
          nur, was jemand von Hand eingetragen hat — nichts wird vorgetäuscht.
        </Hinweis>
      ) : null}

      {daten.kennzahlen.profile === 0 ? (
        <Hinweis art="warnung" cse="radar-ohne-profil" className="mb-s5 max-w-prose">
          <strong>Kein Suchprofil.</strong> Ohne Profil gibt es keine Punkte und keine Rangfolge —
          eine Bekanntmachung wird erst dadurch interessant, dass jemand gesagt hat, was diesen
          Betrieb interessiert.
          {darf['radar.profil_schreiben'] === true && (
            <> <Link href={`/portal/${mandant}/radar/profile`} className="underline underline-offset-4">Profile ansehen</Link>.</>
          )}
        </Hinweis>
      ) : null}

      {daten.kennzahlen.letzterLauf !== null ? (
        <p className="mb-s5 text-xs text-text-subtle" data-cse="radar-letzter-lauf">
          Letzter Lauf: {daten.kennzahlen.letzterLauf.quelle} — {daten.kennzahlen.letzterLauf.status}
          {daten.kennzahlen.letzterLauf.am === null ? '' : `, ${BERLIN.format(daten.kennzahlen.letzterLauf.am)}`}
        </p>
      ) : null}

      {daten.zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="radar-leer" className="max-w-prose">
          Keine bewertete Bekanntmachung. Der Nachtlauf liest ein und bewertet; bis dahin ist diese
          Liste leer — und sagt das, statt eine Auswahl zu zeigen, die es nicht gibt.
        </Hinweis>
      ) : (
        <DataTable
          spalten={spalten}
          zeilen={daten.zeilen}
          schluessel={(z) => z.bewertungId}
          beschriftung="Bewertete Bekanntmachungen mit Punkten, Frist und Plattformstand"
        />
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        Die Punkte rechnet Code, kein Sprachmodell (RAD-05); der Satz hinter jeder Zahl steht im
        Detail. Eingereicht wird von Hand: die Vergabeplattformen bieten dafür keine Schnittstelle
        an, und diese Oberfläche hat deshalb keinen Knopf dafür (D-07).
      </p>
    </PortalRahmen>
  );
}
