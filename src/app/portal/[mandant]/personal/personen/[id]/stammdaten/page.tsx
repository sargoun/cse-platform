import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import {
  KeinStammdatenRecht, leseStammdaten, type Stammdaten,
} from '@/server/services/personal/stammdaten';
import { lesePerson, type PersonZeile } from '../../daten';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/personal/personen/[id]/stammdaten` — Geburtsdatum,
 * Geburtsort, Staatsangehoerigkeit (SEC-03, LEG-09, K-05, 01-KERN §6.13/§11).
 *
 * **Drei Felder, und mehr nicht.** Es sind die Angaben, die § 16 BewachV fuer
 * die Meldung an das Bewacherregister verlangt und die sonst nirgends im
 * Portal erscheinen. Sie sind `cse_app` als Spalte entzogen (0190) und kommen
 * ausschliesslich aus `app.person_stammdaten_lesen` — mit Rechtepruefung und
 * einer Auditzeile je Abruf.
 *
 * **Gelesen mit `personal.stammdaten_lesen`, geschrieben mit
 * `personal.schreiben`.** Das ist kein Widerspruch: `GRANT UPDATE` und
 * `GRANT SELECT` sind getrennte Rechte, und eine Spalte darf schreibbar und
 * unlesbar sein. Das Personalformular nimmt ein Geburtsdatum auf, ohne es
 * zurueckzulesen (§11 sagt das wortwoertlich).
 *
 * **Die heutige Annahme steht in Worten.** Pflegen darf, wer
 * `personal.schreiben` haelt UND in dessen Gesellschaft der Mensch
 * beschaeftigt ist (Policy `t_person_personalpflege`). Ob zwei
 * Gesellschaften, die denselben Menschen beschaeftigen, beide seine
 * Stammdaten pflegen duerfen, ist offen (O-43) — die Seite nennt es, statt es
 * zu verschweigen.
 */
export const dynamic = 'force-dynamic';

export default async function Stammdatenblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/personen/${id}/stammdaten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: das Personenblatt verlangt `personal.lesen`, diese Seite
     `personal.stammdaten_lesen`, das Formular `personal.schreiben`, der
     Bewacherverweis `personal.bewacher_verwalten`. Jeder Verweis wird vorher
     gefragt (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung,
    'personal.lesen', 'personal.schreiben', 'personal.bewacher_verwalten');

  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const gespeichert = suche['gespeichert'] === '1';

  const heute = await berlinHeute();
  /*
   * KEIN Schnappschuss: `app.person_stammdaten_lesen` SCHREIBT eine
   * Auditzeile. Eine `repeatable read`-Transaktion waere hier zwar zulaessig,
   * aber die uebrigen Seiten nehmen den Schnappschuss fuer reine Lesewege —
   * und dieser ist keiner.
   */
  const daten = await (db().begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const person = await lesePerson(kontext, heute, id);
      if (person === null) return { person: null, stammdaten: null, keinRecht: false };
      let stammdaten: Stammdaten | null = null;
      let keinRecht = false;
      try {
        stammdaten = await leseStammdaten(kontext, id);
      } catch (fehler) {
        if (fehler instanceof KeinStammdatenRecht) keinRecht = true;
        else throw fehler;
      }
      return { person, stammdaten, keinRecht };
    })) as Promise<{
      person: PersonZeile | null; stammdaten: Stammdaten | null; keinRecht: boolean;
    }>);

  if (daten.person === null) notFound();
  const { person, stammdaten, keinRecht } = daten;

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Stammdaten"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="stammdaten-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Stammdaten — {person.name}</h1>
        <p className="m-0 text-sm text-text-muted">
          {person.aktiveAnstellungen === 0
            ? 'keine aktive Beschäftigung in dieser Gesellschaft'
            : `${String(person.aktiveAnstellungen)} aktive Beschäftigung${person.aktiveAnstellungen === 1 ? '' : 'en'} hier`}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/personen/${id}`} className={verweis}>
            Zur Person
          </Link>
        )}
        {darf['personal.bewacher_verwalten'] === true && (
          <Link href={`/portal/${mandant}/security/bewacherregister`} className={verweis}>
            Bewacherregister
          </Link>
        )}
      </nav>

      {gespeichert && (
        <Hinweis art="erfolg" cse="stammdaten-gespeichert" className="mb-s5 max-w-prose">
          <strong>Gespeichert.</strong> Die Felder unten sind gleich neu über
          die geschützte Lesefunktion geholt — das Formular liest nichts zurück,
          was es selbst geschrieben hat.
        </Hinweis>
      )}
      {meldung !== null && (
        <Hinweis art="warnung" cse="stammdaten-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {meldung}
        </Hinweis>
      )}

      <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 className="mb-s4 text-h3 text-text">Angaben des Bewacherregisters</h2>
        {keinRecht ? (
          <p data-cse="stammdaten-kein-recht" className="m-0 text-sm text-text-muted">
            <strong className="text-text">Gesperrt.</strong> Diese Sitzung hält{' '}
            <span className="font-mono">personal.stammdaten_lesen</span> nicht.
            Das ist etwas anderes als „nichts hinterlegt": die Zeile trägt
            möglicherweise ein Geburtsdatum, diese Sitzung darf es nicht sehen
            (SEC-03, LEG-09).
          </p>
        ) : stammdaten === null ? (
          <p data-cse="stammdaten-keine" className="m-0 text-sm text-text-muted">
            Zu diesem Menschen sind keine Stammdaten lesbar.
          </p>
        ) : (
          <>
            <dl data-cse="stammdaten-felder" className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">
              <Feld label="Geburtsdatum" wert={stammdaten.geburtsdatum ?? 'nicht hinterlegt'} />
              <Feld label="Geburtsort" wert={stammdaten.geburtsort ?? 'nicht hinterlegt'} />
              <Feld
                label="Staatsangehörigkeit"
                wert={stammdaten.staatsangehoerigkeit ?? 'nicht hinterlegt'}
              />
            </dl>
            <p className="mb-0 mt-s4 text-xs text-text-subtle" data-cse="stammdaten-protokoll">
              <strong className="text-text">Dieser Abruf steht im Protokoll</strong> — mit
              Ihrem Konto, dem Zeitpunkt und der Rechtsgrundlage (Art. 6 Abs. 1
              lit. b und c DSGVO, § 16 BewachV). Die drei Felder sind der
              Anwendungsrolle als Spalte entzogen; es gibt genau einen Lesepfad,
              und er protokolliert.
            </p>
          </>
        )}
      </section>

      <h2 className="mb-s3 text-h2 text-text">Ändern</h2>
      {darf['personal.schreiben'] !== true ? (
        <p data-cse="stammdaten-kein-schreibrecht" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Stammdaten pflegt, wer <span className="font-mono">personal.schreiben</span>{' '}
          hält. Wer sie lesen darf, darf sie darum noch nicht ändern.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/personal/personen/${id}/stammdaten`}
          data-cse="stammdaten-formular"
          className="mb-s6 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="zurueck" value={pfad} />

          <label className="flex flex-col gap-s2 text-sm text-text">
            Geburtsdatum
            <input
              type="date"
              name="geburtsdatum"
              defaultValue={stammdaten?.geburtsdatum ?? ''}
              className={feld}
              data-cse="stammdaten-geburtsdatum"
            />
            <span className="text-xs text-text-subtle">
              Ein Kalendertag, kein Zeitpunkt — ein Geburtstag hat keine Uhrzeit
              (Invariante 2).
            </span>
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Geburtsort
            <input
              name="geburtsort"
              defaultValue={stammdaten?.geburtsort ?? ''}
              className={feld}
              data-cse="stammdaten-geburtsort"
            />
          </label>

          <label className="flex flex-col gap-s2 text-sm text-text">
            Staatsangehörigkeit
            <input
              name="staatsangehoerigkeit"
              maxLength={2}
              placeholder="DE"
              defaultValue={stammdaten?.staatsangehoerigkeit ?? ''}
              className={`${feld} uppercase`}
              data-cse="stammdaten-staat"
            />
            <span className="text-xs text-text-subtle">
              Zweibuchstabiger Ländercode nach ISO 3166-1 alpha-2 — „DE", „TR",
              „SY". Das ist die Form, in der das Bewacherregister sie verlangt
              (SEC-03); eine Nachschlagetabelle gibt es absichtlich nicht, die
              Liste der Staaten ändert sich.
            </span>
          </label>

          <div>
            <Button type="submit" variante="primary" data-cse="stammdaten-speichern">
              Speichern
            </Button>
          </div>

          {stammdaten === null && !keinRecht && (
            <p className="m-0 text-xs text-warning">
              Die Felder sind leer vorbelegt, weil zu diesem Menschen nichts
              lesbar war. Absenden überschreibt, was dort steht — prüfen Sie
              vorher, ob Ihnen nur das Leserecht fehlt.
            </p>
          )}
        </form>
      )}

      <p className="max-w-prose text-sm text-text-muted">
        <strong className="text-text">Offen (O-43):</strong> Wenn zwei
        Gesellschaften der Gruppe denselben Menschen beschäftigen, darf dann
        jede von ihnen seine Stammdaten pflegen? Ausgeliefert ist die heutige
        Annahme: ja, solange die Beschäftigung in der eigenen Gesellschaft
        besteht — `person` trägt keinen Mandanten (D-09), und der Mensch ist nur
        einmal im System. Jede Änderung steht mit dem Konto im Protokoll.
      </p>
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
