import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import {
  ABZUG_PLATZHALTER, GEWICHTE_PLATZHALTER,
} from '@/server/services/radar/gewichte.platzhalter';
import { REGEL_VERSION } from '@/server/services/radar/bewertung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { leseProfile, type ProfilZeile } from '../daten';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/radar/profile` — die Suchprofile (RAD-04, RAD-05).
 *
 * **Was ein Profil ist: die Antwort auf „was interessiert uns".** CPV-Codes,
 * Region, Stichwörter, Wertgrenzen — und daraus rechnet der Lauf die
 * Rangfolge. Diese Seite zeigt sie, **und sie zeigt auch, was daran noch
 * Platzhalter ist**: die Gewichte und die Benachrichtigungsschwelle hat
 * niemand entschieden (O-15), und ein Profil, das so tut, als wären sie
 * bestätigt, erzeugt eine Rangfolge, der jemand glaubt.
 *
 * **Bearbeitet wird je Profil auf seiner eigenen Seite**
 * (`/radar/profile/[id]`) — und nicht hier in der Liste: wer die Gewichte,
 * die CPV-Zeilen und die Empfänger eines Profils ändert, soll dabei sehen,
 * was gesperrt ist und warum. Ein Sammelformular über drei Profile hätte die
 * offenen Fragen (O-15, O-98, O-191, O-47) einmal in eine Fussnote gedrängt.
 *
 * **ANGELEGT wird hier** (V-016), und zwar nur der Name. Bis dahin sagte
 * diese Seite „Kein Profil angelegt. Ohne Profil bewertet der Lauf nichts"
 * — und bot keinen Weg zu einem; der einzige Weg zu einem Profil war der
 * Seed. Das Formular fragt nach EINEM Feld, weil alles andere auf dem
 * Profilblatt steht, wo neben jedem gesperrten Feld sein Grund steht. Zwei
 * Formulare mit denselben Feldern wären zwei Orte, an denen diese Sätze zu
 * pflegen wären.
 *
 * **Und das neue Profil ist abgeschaltet.** Ein leeres, aktives Profil bekäme
 * in der nächsten Nacht für jede Bekanntmachung in Euro das volle Wert- und
 * Fristkriterium (`bewertung.ts`) — die Rangfolge am Morgen wäre eine, der
 * jemand glaubt und die nichts aussagt.
 */
export const dynamic = 'force-dynamic';

const WIRKUNG: Readonly<Record<string, string>> = {
  positiv: 'zählt', abzug: 'zieht ab', ausschluss: 'schliesst aus',
};

/** Was die Route beim Anlegen abweisen kann — als Satz, nicht als Code. */
const FEHLER_TEXT: Readonly<Record<string, string>> = {
  name: 'Ein Profil braucht einen Namen (bis 120 Zeichen).',
  gesperrt: 'Das Profil wurde nicht angelegt. Fehlt `radar.profil_schreiben` in dieser '
    + 'Gesellschaft? In der Gruppenansicht entsteht ausserdem nichts — sie ist lesend.',
};

export default async function Profile(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const tor = await mandantTor(`/portal/${mandant}/radar/profile`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'radar.lesen');

  const profile = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => leseProfile(kontext))) as Promise<readonly ProfilZeile[]>);

  return (
    <PortalRahmen
      titel="Suchprofile"
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="radar"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Suchprofile</h1>
        {/*
          * `/radar` oeffnet mit `radar.lesen` (Manifest); diese Seite mit `radar.profil_schreiben`.
          * Ohne das Recht fuehrte der Verweis auf 404 und verriet damit, was er
          * nicht zeigen darf (AUT-06; D-581).
          */}
        {darf['radar.lesen'] === true && (
          <Link href={`/portal/${mandant}/radar`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            Zum Radar
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein Profil sagt, was diesen Betrieb an einer Bekanntmachung interessiert: Leistungsart
        (CPV), Region (NUTS), Stichwörter und Wertgrenzen. Daraus rechnet der Nachtlauf die
        Punktzahl — deterministisch, mit einer Begründung je Regel (RAD-05, Regelwerk{' '}
        <span className="font-mono text-xs">{REGEL_VERSION}</span>).
      </p>

      <Hinweis art="warnung" cse="radar-profile-platzhalter" className="mb-s5 max-w-prose">
        <strong>Die Gewichte sind Platzhalter.</strong> Wie viel ein CPV-Treffer gegenüber einer
        Region oder einem Stichwort wiegt, und ab welcher Punktzahl benachrichtigt wird, hat
        niemand entschieden (offene Frage O-15). Bis dahin gilt dieses Gerüst:{' '}
        CPV {String(GEWICHTE_PLATZHALTER.cpv)} · Region {String(GEWICHTE_PLATZHALTER.region)} ·
        Stichwort {String(GEWICHTE_PLATZHALTER.stichwort)} · Wert {String(GEWICHTE_PLATZHALTER.wert)} ·
        Frist {String(GEWICHTE_PLATZHALTER.frist)}; ein Negativ-Stichwort kostet{' '}
        {String(ABZUG_PLATZHALTER.stichwort)} Punkte und schliesst nicht aus (O-191 — die sichere
        Richtung, weil ein Ausschluss still verwirft, was nie ein Mensch gesehen hat).
      </Hinweis>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="radar-profil-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht angelegt.</strong>{' '}
          {FEHLER_TEXT[fehler] ?? 'Die Eingabe wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {/*
        * **Ein Profil anlegen** (V-016).
        *
        * Ein Feld, und mehr nicht: was das Profil suchen soll — CPV, Region,
        * Stichwörter, Wertgrenzen — steht auf seinem eigenen Blatt, und dort
        * steht neben jedem gesperrten Feld sein Grund (O-15, O-47, O-98,
        * O-191, O-721). Dieselben Felder ein zweites Mal hier hiesse, diese
        * Sätze an zwei Orten zu pflegen.
        */}
      <section aria-labelledby="neues-profil" className="mb-s6 max-w-prose">
        <h2 id="neues-profil" className="mb-s3 text-h2 text-text">Profil anlegen</h2>
        <form method="post" action="/api/radar/profil" data-cse="radar-profil-anlegen"
              className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
          <input type="hidden" name="was" value="anlegen" />
          <label className="flex flex-col gap-s2 text-sm text-text">
            Name des Profils
            <input name="name" required maxLength={120}
                   data-cse="radar-profil-neu-name"
                   placeholder="z. B. Unterhaltsreinigung Berlin, Landesbehörden"
                   className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
          </label>
          <div>
            <Button type="submit" variante="primary">Anlegen</Button>
          </div>
          <p className="m-0 text-xs text-text-muted">
            Das Profil entsteht <strong>abgeschaltet</strong> und trägt nur diesen Namen.
            Das ist Absicht: ein Profil ohne CPV-Codes, Region und Wertgrenzen bekäme für
            jede Bekanntmachung in Euro das volle Wert- und Fristkriterium — der nächste
            Nachtlauf schriebe eine Rangfolge, die nichts aussagt, und jemand läse sie am
            Morgen. Eingeschaltet wird auf dem Profilblatt, wenn dort steht, wonach gesucht
            werden soll.
          </p>
        </form>
      </section>

      {profile.length === 0 ? (
        <Hinweis art="hinweis" cse="radar-profile-leer" className="max-w-prose">
          <strong>Kein Profil angelegt.</strong> Ohne Profil bewertet der Lauf nichts, und die
          Radarliste bleibt leer. Das Formular darüber legt eines an; die CPV-Codes dieses
          Gewerks kommen danach auf dem Profilblatt dazu — und sie sind gegen die amtliche
          CPV-Liste zu bestätigen (offene Frage O-98), bevor sie hier als bestätigt gelten.
        </Hinweis>
      ) : (
        <ul data-cse="radar-profile-liste" className="flex flex-col gap-s4">
          {profile.map((p) => (
            <li key={p.id} data-cse="radar-profil" data-aktiv={String(p.istAktiv)}
                className="rounded-lg border border-line bg-surface p-s5">
              <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s3">
                {/* Diese Seite öffnet mit `radar.profil_schreiben` (Manifest) —
                    dasselbe Recht wie die Bearbeitungsseite. Der Verweis führt
                    deshalb nie auf ein 404. */}
                <h2 className="text-h2">
                  <Link href={`/portal/${mandant}/radar/profile/${p.id}`}
                        data-cse="radar-profil-bearbeiten"
                        className="text-text underline-offset-2 hover:text-brand hover:underline">
                    {p.name}
                  </Link>
                </h2>
                <span className="flex items-center gap-s2">
                  {p.istPlatzhalter ? <StatusPill zustand="Entwurf" /> : null}
                  <StatusPill zustand={p.istAktiv ? 'Aktiv' : 'Inaktiv'} />
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-s5">
                <dt className="text-text-muted">CPV</dt>
                <dd className="text-text">
                  {p.cpv.length === 0
                    ? 'keine — dieses Profil trifft über Stichwörter und Region'
                    : p.cpv.map((c) => `${c.code}${c.laenge < 8 ? ` (${String(c.laenge)} Stellen)` : ''} — ${WIRKUNG[c.wirkung] ?? c.wirkung}`).join(' · ')}
                </dd>
                <dt className="text-text-muted">Region (NUTS)</dt>
                <dd className="text-text">
                  {p.nutsPraefixe.length === 0 ? 'ohne Einschränkung' : p.nutsPraefixe.join(', ')}
                </dd>
                <dt className="text-text-muted">Stichwörter</dt>
                <dd className="text-text">
                  {p.positivKeywords.length === 0 ? '—' : p.positivKeywords.join(', ')}
                  {p.negativKeywords.length === 0
                    ? ''
                    : ` · nicht: ${p.negativKeywords.join(', ')} (${p.negativWirkung === 'ausschluss' ? 'schliesst aus' : 'zieht ab'})`}
                </dd>
                <dt className="text-text-muted">Auftragswert</dt>
                <dd className="text-text">
                  {p.wertMinCent === null && p.wertMaxCent === null
                    ? 'ohne Grenzen'
                    : `${p.wertMinCent === null ? 'ab —' : `ab ${formatiereGeld(cent(p.wertMinCent))}`} ${
                      p.wertMaxCent === null ? '' : `bis ${formatiereGeld(cent(p.wertMaxCent))}`}`}
                </dd>
                <dt className="text-text-muted">Benachrichtigung</dt>
                <dd className="text-text" data-cse="radar-profil-benachrichtigung">
                  {p.empfaenger.length === 0 ? (
                    <span className="text-text-muted">
                      Niemand eingetragen — RAD-08 meldet für dieses Profil nichts.
                      {p.schwelle === null ? '' : ` Die Profilschwelle ${String(p.schwelle)} wirkt erst mit einem Empfänger.`}
                    </span>
                  ) : (
                    <>
                      {p.empfaenger.map((e) => (
                        <span key={e.name} className="block" data-cse="radar-empfaenger"
                              data-schwelle={e.abPunkte ?? ''}>
                          {e.name} —{' '}
                          {e.abPunkte === null
                            ? 'ohne Schwelle, bekommt keine Treffermeldung (O-15)'
                            : `ab ${String(e.abPunkte)} von ${String(p.skalaMax)} Punkten`}
                        </span>
                      ))}
                    </>
                  )}
                  <span className="mt-s2 block text-xs text-text-subtle">
                    Die knappe Abgabefrist meldet der Wächter ohne Schwelle: fünf Tage stehen in
                    SPEC §14 und RAD-06, die sind nicht einzustellen.
                  </span>
                </dd>
                <dt className="text-text-muted">Fassung</dt>
                <dd className="text-text tabular-nums" data-cse="radar-profil-version">
                  {String(p.version)} · {String(p.bewertungen)} Bewertungen
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        Jede Änderung an einem Profil zählt seine Fassung hoch, und der nächste Lauf schreibt eine
        NEUE Bewertung — die alte bleibt stehen. So lässt sich später sagen, mit welcher Suche eine
        Bekanntmachung damals bewertet wurde, und nicht nur, wie sie heute aussähe. Geändert wird
        über den Namen des Profils.
      </p>
    </PortalRahmen>
  );
}
