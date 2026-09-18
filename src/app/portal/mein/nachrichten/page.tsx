import Link from 'next/link';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { ladePosteingang, type Eintrag } from '@/server/benachrichtigung/posteingang';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Gesellschaft, Leer } from '../bausteine';

/**
 * `/portal/mein/nachrichten` — der persönliche Posteingang (EMP-11, NOT-03).
 *
 * **Der Befund, der diese Seite nötig machte — ein Nutzerbericht.** Auf dem
 * Telefon einer Mitarbeiterin IST die untere Leiste die ganze Navigation
 * (SEITENKARTE §11.2), und ihr viertes Ziel heisst „Nachrichten". Es führte
 * auf „Dieses Modul wird noch gebaut — die Seite dahinter entsteht in
 * Phase 3". Phase 3 ist in der ROADMAP abgehakt.
 *
 * **Die Meldungen gab es die ganze Zeit.** Wächter, Ablaufwarnungen und
 * Fristwarnungen schreiben seit mehreren PRs in `benachrichtigung`; der
 * interne Posteingang (`/portal/[mandant]/benachrichtigungen`) zeigt sie. Nur
 * die Kraft, an die eine Ablaufwarnung sich richtet (EMP-08), hatte keinen
 * Bildschirm dafür. Eine Warnung, die ihren Empfänger nicht erreicht, ist
 * keine.
 *
 * **Dieselbe Abfrage wie der interne Posteingang, nicht eine zweite.**
 * `ladePosteingang` gilt in beiden Scopes: `t_benachrichtigung_eigene` bindet
 * jede Zeile an `empfaenger_id = app.aktueller_benutzer()`, und
 * `app.sichtbare_mandanten()` ist im Personen-Scope genau die Menge der
 * eigenen lebenden Beschäftigungen (0004). Eine zweite Fassung derselben
 * Frage driftet — und zwei Posteingänge, die verschiedene Zahlen zeigen,
 * machen beide unglaubwürdig.
 *
 * **Die Gesellschaft steht an JEDER Zeile.** Ein Mensch, zwei Beschäftigungen
 * (D-09, EMP-14): ohne sie sähe dieselbe Meldung zweimal gleich aus, und der
 * Link führte in einen Bereich, den man beim Lesen nicht erkannt hat.
 *
 * **Öffnen ist ein POST**, kein Link: es stempelt `gelesen_am`. Ein
 * Vorauslader oder ein weitergeleiteter Link machte den Posteingang sonst von
 * allein leer (D-504).
 */
export const dynamic = 'force-dynamic';

export default async function MeineNachrichten() {
  const ergebnis = await meinPortal('/portal/mein/nachrichten', async (kontext) =>
    ladePosteingang(kontext, { grenze: 100 }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  const { basis, daten } = ergebnis;
  const t = basis.texte;

  const zeitpunkt = new Intl.DateTimeFormat(basis.sprache === 'de' ? 'de-DE' : basis.sprache, {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
  });
  const offen = daten.filter((e: Eintrag) => e.gelesenAm === null).length;

  return (
    <MeinRahmen basis={basis} titel={t.nachrichten} aktiverTab="nachrichten">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.nachrichten}</h1>
        {offen > 0 && (
          <p data-cse="nachrichten-offen" className="m-0 text-base text-text-muted">
            <span className="tabular-nums">{offen}</span> {t.ungelesen}
          </p>
        )}
      </div>

      {daten.length === 0 ? (
        <Leer text={t.keineNachrichten} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-s3 p-0">
          {daten.map((e: Eintrag) => (
            <li
              key={e.id}
              data-cse="nachricht"
              data-gelesen={String(e.gelesenAm !== null)}
              className={`rounded-lg border p-s4 ${
                e.gelesenAm === null
                  ? 'border-brand bg-brand-soft'
                  : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s2">
                {/*
                  Der Titel fuehrt auf die Meldung selbst und STEMPELT DABEI
                  NICHT — das tut nur der Knopf unten (D-504). Zwei Wege mit
                  zwei verschiedenen Wirkungen, und jeder sagt, welche er hat.
                */}
                <Link
                  href={`/portal/mein/nachrichten/${e.id}`}
                  data-cse="nachricht-lesen"
                  className="text-h3 text-text underline"
                >
                  {e.titel}
                </Link>
                <StatusPill zustand={e.gelesenAm === null ? 'Wartet' : 'Inaktiv'} />
              </div>

              {e.mandantSlug !== null && (
                <p className="mt-s2">
                  <Gesellschaft slug={e.mandantSlug} name={e.mandantName ?? e.mandantSlug} />
                </p>
              )}

              <p className="mt-s2 max-w-[60ch] text-base text-text-muted">{e.text}</p>

              <p className="mt-s2 text-sm text-text-subtle">
                <time dateTime={e.erstelltAm.toISOString()} className="tabular-nums">
                  {zeitpunkt.format(e.erstelltAm)}
                </time>
                {e.gelesenAm !== null && <> · {t.gelesen}</>}
              </p>

              {/*
                * Das Ziel kommt aus der ZEILE, nicht aus diesem Formular — ein
                * `ziel`-Feld hier waere eine offene Weiterleitung mit einer
                * echten Anmeldung davor (D-504). Die Route liest es selbst.
                */}
              <form
                method="post"
                action={`/api/benachrichtigungen/${e.id}/oeffnen`}
                className="mt-s4"
              >
                <Button type="submit" variante="secondary" data-cse="nachricht-oeffnen">
                  {t.oeffnen}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
