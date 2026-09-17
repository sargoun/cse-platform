import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import {
  beendigungsfolgen, findeAnstellung,
  type AnstellungZeile, type Beendigungsfolgen,
} from '@/server/services/personal/anstellung';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/personal/anstellungen/[id]/beenden` — Austritt und Grund
 * (D-09, K-14, R-08, Invariante 8).
 *
 * **Die Seite zeigt die FOLGEN, bevor sie bestaetigt werden.** Offene Einsaetze
 * nach dem Austritt, ein nicht abgeschlossenes Stundenkonto, ein Urlaubsrest,
 * offene Antraege, gueltige Schluesselquittungen: steht etwas davon offen,
 * benennt die Seite es und beendet trotzdem — mit Warnung. Eine Bestaetigung
 * ohne Blick auf das, was danach offen bleibt, ist eine Unterschrift auf ein
 * leeres Blatt.
 *
 * **„0 offene Einsätze" und „nicht prüfbar" sind zwei Saetze.** Jeder Posten
 * haengt an einem ANDEREN Recht als diese Seite: Einsaetze an
 * `dienstplan.lesen`, Konten an `zeit.konto_lesen`, Antraege an
 * `zeit.abwesenheit_lesen`, Quittungen an `schluessel.lesen`. Ohne das Recht
 * liefert die Datenbank null Zeilen, und null Zeilen als „nichts offen" zu
 * lesen ist der Fehler, der hier am teuersten ist.
 *
 * **Der Zugang erlischt am Statuswechsel, nicht beim Eintragen** (K-14). Liegt
 * der Austritt in der Zukunft, bleibt der Status stehen; der Nachtlauf setzt
 * `beendet`, sobald der Tag da ist, und erst dann entzieht der Ausloeser die
 * abgeleitete Mitgliedschaft. Eine erteilte Rolle ueberlebt beides.
 *
 * **Nie ein DELETE** (Invariante 8).
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant', aktiv: 'Aktiv', ruhend: 'Wartet', beendet: 'Abgeschlossen',
};

function tageText(roh: string | null): string {
  if (roh === null) return '—';
  const [ganz = '0', bruch = ''] = roh.split('.');
  const gekuerzt = bruch.replace(/0+$/u, '');
  return gekuerzt === '' ? ganz : `${ganz},${gekuerzt}`;
}

/** Ein Posten der Folgenliste — Text und Ton in einer Entscheidung. */
interface Posten {
  readonly name: string;
  readonly wert: string;
  readonly warnt: boolean;
  readonly pruefbar: boolean;
}

function posten(folgen: Beendigungsfolgen): readonly Posten[] {
  const zahl = (
    name: string, wert: number | null, einheit: string, recht: string,
  ): Posten => (wert === null
    ? { name, wert: `nicht prüfbar — kein Leserecht (${recht})`, warnt: false, pruefbar: false }
    : {
      name,
      wert: wert === 0 ? 'keine' : `${String(wert)} ${einheit}`,
      warnt: wert > 0,
      pruefbar: true,
    });

  const urlaub: Posten = folgen.urlaubskontoPruefbar
    ? {
      name: 'Resturlaub (offene Konten)',
      wert: `${tageText(folgen.urlaubsrestTage)} Tage`,
      warnt: Number(folgen.urlaubsrestTage ?? '0') > 0,
      pruefbar: true,
    }
    : {
      name: 'Resturlaub (offene Konten)',
      wert: 'nicht prüfbar — kein Leserecht (zeit.konto_lesen)',
      warnt: false,
      pruefbar: false,
    };

  return [
    zahl('Einsätze nach dem Austritt', folgen.einsaetzeNachAustritt, 'Einsätze', 'dienstplan.lesen'),
    zahl('Nicht abgeschlossene Stundenkonten', folgen.offeneStundenkonten, 'Monate', 'zeit.konto_lesen'),
    urlaub,
    zahl('Offene Anträge', folgen.offeneAntraege, 'Anträge', 'zeit.abwesenheit_lesen'),
    zahl('Nicht zurückgegebene Schlüssel', folgen.offeneSchluessel, 'Quittungen', 'schluessel.lesen'),
  ];
}

export default async function Beendenblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/anstellungen/${id}/beenden`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: das Blatt der Beschaeftigung verlangt `personal.lesen`, diese
     Seite `personal.anstellung_beenden` (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung, 'personal.lesen', 'personal.schreiben', 'personal.entgelt_lesen');

  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const heute = await berlinHeute();
  const rohAustritt = typeof suche['austritt'] === 'string' ? suche['austritt'] : null;
  const vorschau = rohAustritt !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohAustritt)
    ? rohAustritt : heute;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeile = await findeAnstellung(kontext, id);
      if (zeile === null) return { zeile: null, folgen: null };
      return { zeile, folgen: await beendigungsfolgen(kontext, id, vorschau) };
    })) as Promise<{
      zeile: AnstellungZeile | null; folgen: Beendigungsfolgen | null;
    }>);

  if (daten.zeile === null || daten.folgen === null) notFound();
  const { zeile, folgen } = daten;
  const liste = posten(folgen);
  const warnt = liste.some((p) => p.warnt);
  const beendet = zeile.status === 'beendet';

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Beschäftigung beenden"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="beenden-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Beenden — {zeile.personName}</h1>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={STATUS[zeile.status] ?? 'Aktiv'} />
          <span className="text-sm text-text-muted">
            Personalnummer <span className="tabular-nums">{zeile.personalnummer}</span>
            {' · '}
            Eintritt <span className="tabular-nums">{zeile.eintritt}</span>
          </span>
        </span>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}`} className={verweis}>
            Zur Beschäftigung
          </Link>
        )}
        {darf['personal.schreiben'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/vertrag`} className={verweis}>
            Vertragseckdaten
          </Link>
        )}
        {darf['personal.entgelt_lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/entgelt`} className={verweis}>
            Entgelt
          </Link>
        )}
      </nav>

      {meldung !== null && (
        <Hinweis art="warnung" cse="beenden-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {meldung}
        </Hinweis>
      )}

      {beendet && (
        <Hinweis art="hinweis" cse="beenden-bereits" className="mb-s5 max-w-prose">
          <strong>Diese Beschäftigung ist bereits beendet.</strong> Austritt{' '}
          <span className="tabular-nums">{zeile.austritt ?? '—'}</span>
          {zeile.austrittGrund === null ? '' : ` — Grund: ${zeile.austrittGrund}`}.
          Eine Beendigung wird nicht überschrieben und nicht zurückgedreht: eine
          neue Beschäftigung ist eine neue Zeile, mit eigenem Eintritt und
          eigener Personalnummer (§6.14). Die Zeile selbst bleibt — Zeit-,
          Konto- und Rechnungsdaten hängen daran (Invariante 8).
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">Was ein Austritt offen lässt</h2>
      <p className="mb-s3 max-w-prose text-sm text-text-muted">
        Stand zum <span className="tabular-nums">{vorschau}</span>. Steht etwas
        offen, hält das die Beendigung nicht auf — es soll nur niemand
        hinterher davon erfahren.
      </p>
      <dl
        data-cse="beenden-folgen"
        className="mb-s6 grid max-w-prose grid-cols-[1fr_auto] gap-x-s5 gap-y-s3 rounded-lg border border-line bg-surface p-s5 text-sm"
      >
        {liste.map((p) => (
          <div key={p.name} className="contents">
            <dt className={p.pruefbar ? 'text-text' : 'text-text-subtle'}>{p.name}</dt>
            <dd
              className={`m-0 text-right tabular-nums ${
                p.warnt ? 'text-warning' : p.pruefbar ? 'text-text' : 'text-text-subtle'
              }`}
            >
              {p.wert}
            </dd>
          </div>
        ))}
      </dl>

      {warnt && (
        <Hinweis art="warnung" cse="beenden-warnung" className="mb-s5 max-w-prose">
          <strong>Es bleibt etwas offen.</strong> Die Beendigung ist trotzdem
          möglich — sie rührt keine Zeitdaten an und schliesst kein Konto ab.
          Was oben in Warnfarbe steht, bearbeitet danach niemand mehr von
          selbst: ein Einsatz nach dem Austritt bleibt geplant, ein Schlüssel
          bleibt quittiert, und ein Urlaubsrest wird nicht ausgezahlt (das macht
          die Lohnabrechnung, nicht diese Plattform).
        </Hinweis>
      )}

      {!beendet && (
        <>
          <h2 className="mb-s3 text-h2 text-text">Beenden</h2>
          <form
            method="post"
            action={`/api/personal/anstellungen/${id}/beenden`}
            data-cse="beenden-formular"
            className="flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              Austritt
              <input
                type="date"
                name="austritt"
                required
                min={zeile.eintritt}
                defaultValue={vorschau}
                className={feld}
                data-cse="beenden-austritt"
              />
              <span className="text-xs text-text-subtle">
                Der letzte Tag der Beschäftigung, nicht früher als der Eintritt
                ({zeile.eintritt}). Liegt er in der Zukunft, bleibt der Status
                stehen und wechselt an diesem Tag auf „beendet" — erst dann
                erlischt der abgeleitete Portalzugang (K-14).
              </span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Grund
              <input
                name="grund"
                required
                placeholder="Eigenkündigung · Kündigung durch Arbeitgeber · Befristung ausgelaufen · Aufhebungsvertrag"
                className={feld}
                data-cse="beenden-grund"
              />
              <span className="text-xs text-text-subtle">
                Pflicht und in Worten. Eine Beendigung ohne Begründung ist kein
                Vorgang, sondern ein Klick; der Grund steht danach in der
                Personalakte und im Protokoll.{' '}
                <strong className="text-text">Offen (O-612):</strong> welche
                Beendigungsgründe die Gruppe als feste Liste führen will — bis
                dahin freier Text, keine erfundene Auswahl.
                {/* TODO(client, O-612): Welche Beendigungsgruende fuehrt die Gruppe als Auswahlliste (Eigenkuendigung, Kuendigung Arbeitgeber, Befristung, Aufhebungsvertrag, Rente …), und muessen sie den Codes des Lohnsystems fuer die Abmeldung entsprechen? */}
              </span>
            </label>

            <div>
              <Button type="submit" variante="primary" data-cse="beenden-absenden">
                Beschäftigung beenden
              </Button>
            </div>

            <p className="m-0 text-xs text-text-subtle">
              Es wird nichts gelöscht: gesetzt werden Austrittsdatum und Grund,
              und der Vorgang steht mit Ihrem Konto im Protokoll. Ein manuell
              erteiltes Recht in dieser Gesellschaft bleibt bestehen — der
              Auslöser entzieht nur die Mitgliedschaft, die aus der
              Beschäftigung entstanden ist (K-14).
            </p>
          </form>
        </>
      )}
    </PortalRahmen>
  );
}
