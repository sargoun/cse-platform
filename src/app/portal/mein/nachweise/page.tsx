import Link from 'next/link';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { berlinHeute } from '@/server/db/heute';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { tagInSprache } from '@/lib/datum/kalendertag';
import {
  leseEigeneNachweise, type EigeneNachweislage, type Warnlage,
} from '@/server/services/mitarbeiter/nachweise';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Feld, Felder, Gesellschaft, Leer } from '../bausteine';

/**
 * `/portal/mein/nachweise` — eigene Nachweise mit persoenlicher Ablaufwarnung
 * (EMP-08, SEC-02, SEC-03).
 *
 * **Dieselbe Quelle, aus der PR 31 die Einteilung sperrt.** Die Gueltigkeit
 * kommt aus `decktStichtag`, die Sperrwirkung aus
 * `qualifikation.blockiert_einsatz`, die Warnschwellen aus
 * `qualifikation.warnung_tage` — genau die drei, die
 * `app.einsatz_qualifikation_erfuellt` und der naechtliche Ablaufwaechter
 * lesen. Eine zweite, hier erfundene Regel waere genau die, die irgendwann
 * etwas anderes sagt als das Tor: die Kraft saehe „gueltig" und die Planung
 * koennte sie nicht einteilen.
 *
 * **Die Warnung ist ein WORT und nicht eine Farbe** (DESIGN §9): „abgelaufen",
 * „laeuft ab" und dazu der Satz, was daraus folgt. Ein roter Punkt sagt einer
 * farbenblinden Kraft gar nichts, und einer sehenden auch nicht, was zu tun
 * ist.
 *
 * **Der Stichtag ist HEUTE aus der Datenbank** und nicht `now()` im
 * Node-Prozess: zwischen Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag
 * der gestrige, und ein Nachweis, der heute ablaeuft, saehe dann noch gueltig
 * aus (Invariante 5, K-11).
 *
 * **SEC-03 wird als das gezeigt, was es ist**: die Registerlage ist
 * handerfasst; eine Schnittstelle zum Bewacherregister gibt es nicht, und das
 * steht da (CLAUDE.md, „No fake integrations").
 */
export const dynamic = 'force-dynamic';

function pille(lage: Warnlage): PillZustand {
  if (lage === 'abgelaufen') return 'Überfällig';
  if (lage === 'laeuft_ab') return 'Wartet';
  return 'Aktiv';
}

export default async function MeineNachweise() {
  const heute = await berlinHeute();
  const ergebnis = await meinPortal<EigeneNachweislage>(
    '/portal/mein/nachweise',
    async (kontext, basis) => leseEigeneNachweise(kontext, heute, basis.sprache),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  /*
   * Die Gesellschaften dieses Menschen — das Büro, das den Nachweis einträgt
   * (V-061, D-09). Zwei Beschäftigungen heissen zwei Büros, und keines von
   * beiden ist „das" Büro; deshalb stehen beide da, nicht das erste.
   */
  const gesellschaften = basis.anstellungen;
  const wortZu: Readonly<Record<Warnlage, string>> = {
    gueltig: t.status,
    laeuft_ab: t.laeuftAb,
    abgelaufen: t.abgelaufen,
  };

  return (
    <MeinRahmen basis={basis} titel={t.nachweise} aktiverTab="heute">
      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.nachweise}</h1>
        <p className="m-0 text-base text-text-muted">
          <span className="cse-zahl">{tagInSprache(daten.stichtag, basis.sprache)}</span>
        </p>
      </div>

      {daten.sperrendeAnzahl > 0 && (
        <section data-cse="sperrende-nachweise" className="mb-s5">
          <KpiStat
            label={t.nachweise}
            wert={String(daten.sperrendeAnzahl)}
            icon="warnung"
            ton="danger"
          />
          <p className="mt-s3 max-w-prose text-base text-text">{t.sperrtEinteilung}</p>

          {/*
            * **Der nächste Schritt** (V-061).
            *
            * Die Seite nannte die Sperre und hörte dort auf: kein Weg, kein
            * Ansprechpartner, kein Satz darüber, was zu tun ist. Wer liest,
            * dass ihn niemand mehr einteilen darf, und nichts findet, hält das
            * Portal für kaputt — oder ruft irgendwo an.
            *
            * **Kein „Nachweis hochladen".** Es gibt keine Ablage für Dateien
            * (O-12/O-13: kein Medienspeicher verbunden), und ein Feld, das
            * nichts speichert, wäre schlimmer als keines. Der Weg, den es
            * WIRKLICH gibt, steht da: das Büro der Gesellschaft trägt den
            * Nachweis ein, und die Antwort kommt in den Posteingang.
            */}
          <div
            data-cse="nachweis-was-tun"
            className="mt-s4 rounded-lg border border-line bg-surface p-s4"
          >
            <h2 className="m-0 text-h3 text-text">{t.nachweisWasTun}</h2>
            <p className="mt-s2 m-0 max-w-prose text-base text-text">
              {t.nachweisWasTunText}
            </p>
            {gesellschaften.length === 0 ? null : (
              <p className="mt-s2 m-0 flex flex-wrap gap-s2 text-base text-text">
                {gesellschaften.map((a) => (
                  <Gesellschaft key={a.mandantId} slug={a.mandantSlug} name={a.mandantName} />
                ))}
              </p>
            )}
            <p className="mt-s2 m-0 max-w-prose text-base text-text-muted">
              {t.nachweisKeinUpload}
            </p>
            <Link
              href="/portal/mein/nachrichten"
              data-cse="zu-nachrichten"
              className="mt-s3 inline-flex min-h-11 items-center rounded-md border border-line-strong px-s4 text-base text-text"
            >
              {t.nachweisZuNachrichten}
            </Link>
          </div>
        </section>
      )}

      {daten.nachweise.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <ul data-cse="nachweise" className="m-0 flex list-none flex-col gap-s3 p-0">
          {daten.nachweise.map((n) => (
            <li
              key={n.nachweisId}
              data-cse="nachweis"
              data-warnlage={n.warnlage}
              data-blockiert={String(n.blockiertEinsatz)}
              className="rounded-lg border border-line bg-surface p-s4"
            >
              <div className="mb-s3 flex flex-wrap items-center gap-s3">
                <span className="text-base text-text">{n.bezeichnung}</span>
                <StatusPill sprache={basis.sprache} zustand={pille(n.warnlage)} />
                {n.warnlage !== 'gueltig' && (
                  <span data-cse="warnwort" className="text-base text-text">
                    <Icon name="warnung" groesse="sm" className="inline-block align-[-2px]" />{' '}
                    {wortZu[n.warnlage]}
                  </span>
                )}
              </div>
              <Felder>
                <Feld label={t.gueltigBis}>
                  <span className="cse-zahl">
                    {n.gueltigBis === null
                      ? t.unbefristet : tagInSprache(n.gueltigBis, basis.sprache)}
                  </span>
                </Feld>
                {/*
                  Die Fundstelle („§34a Abs. 1a GewO") unter IHRER Beschriftung
                  (V-195) — hier stand „Status", und ein Paragraph ist kein
                  Zustand. Die Fundstelle selbst bleibt unübersetzt.
                */}
                {n.rechtsgrundlage !== null && (
                  <Feld label={t.rechtsgrundlage}>{n.rechtsgrundlage}</Feld>
                )}
                {n.tageBisAblauf !== null && (
                  <Feld label={t.laeuftAb}>
                    <span className="cse-zahl">{String(n.tageBisAblauf)}</span> {t.tage}
                  </Feld>
                )}
              </Felder>
              {n.blockiertEinsatz && !n.gueltigAmStichtag && (
                <p data-cse="sperrt" className="mt-s3 m-0 max-w-prose text-base text-text">
                  {t.sperrtEinteilung}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* SEC-03: handerfasst, und das steht da. */}
      <section data-cse="bewacherregister" className="mt-s6 rounded-lg border border-line
                                                      bg-surface-2 p-s4">
        <h2 className="mb-s3 text-h3 text-text">{t.registerBewacher}</h2>
        <Felder>
          {/* Der Status als Wort in der Sprache der Person, nie als Schlüssel (V-195). */}
          <Feld label={t.status}>
            <span data-cse="bewacher-status" data-status={daten.bewacher.status ?? ''}>
              {daten.bewacher.vorhanden
                ? (eigenerEintrag(t.bewacherStatus, daten.bewacher.status) ?? '—') : '—'}
            </span>
          </Feld>
          <Feld label={t.gueltigBis}>
            <span className="cse-zahl">
              {daten.bewacher.gueltigBis === null
                ? t.unbefristet : tagInSprache(daten.bewacher.gueltigBis, basis.sprache)}
            </span>
          </Feld>
          <Feld label={t.registerBewacher}>{t.nichtVerbunden}</Feld>
        </Felder>
      </section>
    </MeinRahmen>
  );
}
