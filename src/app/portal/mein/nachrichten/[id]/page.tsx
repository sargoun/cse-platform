import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { findeEintrag, type Eintrag } from '@/server/benachrichtigung/posteingang';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft } from '../../bausteine';

/**
 * `/portal/mein/nachrichten/[id]` — EINE Meldung (EMP-11, NOT-03).
 *
 * **Die Seite stempelt NICHT.** Lesen ist ein GET; `gelesen_am` setzt weiter
 * nur `POST /api/benachrichtigungen/[id]/oeffnen`. Wer das Stempeln in den
 * Seitenaufruf legt, laesst den Posteingang von einem Vorauslader oder einem
 * weitergeleiteten Link leeren (D-504) — und danach behauptet das Protokoll,
 * der Mensch habe gelesen, was er nie gesehen hat.
 *
 * **Das Ziel kommt aus der ZEILE.** Kein `ziel`-Feld im Formular: das waere
 * eine offene Weiterleitung mit einer echten Anmeldung davor. Die Route liest
 * es selbst aus `benachrichtigung.ziel`, und ein CHECK dort erzwingt, dass es
 * mit `/` beginnt.
 *
 * **Dieselbe Abfrage wie die Liste**, Spalte fuer Spalte (`findeEintrag` neben
 * `ladePosteingang` in derselben Datei): zwei Fassungen derselben Frage laufen
 * auseinander, und die Einzelansicht zeigte dann etwas anderes als die Zeile,
 * aus der man sie geoeffnet hat.
 *
 * **Eine fremde Meldung ist nicht vorhanden**, nicht verboten (AUT-06):
 * `t_benachrichtigung_eigene` bindet jede Zeile an `empfaenger_id =
 * app.aktueller_benutzer()`, und diese Seite antwortet 404.
 */
export const dynamic = 'force-dynamic';

export default async function MeineNachricht(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ergebnis = await meinPortal<Eintrag | null>(
    `/portal/mein/nachrichten/${id}`,
    async (kontext) => findeEintrag(kontext, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten: e } = ergebnis;
  const t = basis.texte;
  const zeitpunkt = new Intl.DateTimeFormat(basis.sprache === 'de' ? 'de-DE' : basis.sprache, {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
  });

  return (
    <MeinRahmen basis={basis} titel={t.nachrichten} aktiverTab="nachrichten">
      <Link
        href="/portal/mein/nachrichten"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.nachrichten}
      </Link>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{e.titel}</h1>
        <StatusPill zustand={e.gelesenAm === null ? 'Wartet' : 'Inaktiv'} />
      </div>

      <section
        data-cse="nachricht"
        data-gelesen={String(e.gelesenAm !== null)}
        className={`mb-s5 rounded-lg border p-s4 ${
          e.gelesenAm === null ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
        }`}
      >
        <p className="m-0 mb-s4 max-w-[60ch] whitespace-pre-line text-base text-text">
          {e.text}
        </p>
        <Felder>
          {e.mandantSlug !== null && (
            <Feld label={t.gesellschaft}>
              <Gesellschaft slug={e.mandantSlug} name={e.mandantName ?? e.mandantSlug} />
            </Feld>
          )}
          <Feld label={t.empfangenAm}>
            <time dateTime={e.erstelltAm.toISOString()} className="cse-zahl">
              {zeitpunkt.format(e.erstelltAm)}
            </time>
          </Feld>
          <Feld label={t.status}>
            {e.gelesenAm === null ? t.ungelesen : (
              <>
                {t.gelesen}
                {' · '}
                <time dateTime={e.gelesenAm.toISOString()} className="cse-zahl">
                  {zeitpunkt.format(e.gelesenAm)}
                </time>
              </>
            )}
          </Feld>
        </Felder>
      </section>

      {/*
        Genau zwei Wege: zum Datensatz (stempelt dabei) und zurueck in den
        Posteingang. NOT-03 verlangt, dass jede Meldung auf ihren Datensatz
        zeigt — eine Meldung ohne Weg dorthin ist eine Nachricht ueber etwas,
        das man danach suchen muss.
      */}
      <form method="post" action={`/api/benachrichtigungen/${e.id}/oeffnen`}>
        <Button type="submit" data-cse="nachricht-oeffnen">{t.zumDatensatz}</Button>
      </form>
    </MeinRahmen>
  );
}
