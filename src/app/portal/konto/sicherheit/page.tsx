import type postgres from 'postgres';
import Link from 'next/link';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { db } from '@/server/db/pool';
import { bindePersoenlich } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { leisteFuer } from '@/server/registry/tableiste';
import {
  meinBeschriftungen, meinTexte, PORTAL_BCP47, PORTAL_RICHTUNG,
} from '@/lib/i18n/texte';
import { SICHERHEIT_TEXTE } from '@/lib/i18n/konto';
import { leseKonto } from '../konto';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meineSitzungen, type EigeneSitzung } from '@/server/services/konto/sitzungen';

/**
 * `/portal/konto/sicherheit` — Kennwort, zweite Stufe, aktive Anmeldungen
 * (V-039, V-038, AUT-02, AUT-05, AUT-07, AUT-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: die Seite stand im Register und existierte nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Seitenkarte führt sie seit Phase 1. Die Teile, auf die sie zeigt, sind
 * seit je gebaut — `/auth/kennwort-wechseln`, `/auth/zwei-faktor/einrichten`,
 * `/auth/zwei-faktor/wiederherstellung` — und von nirgendwo im Portal
 * erreichbar: wer sein Kennwort ändern wollte, musste die Adresse kennen.
 *
 * **Die Liste der Anmeldungen ist die eigentliche Neuerung.**
 * `benutzer_sitzung` hat seit je zwei Policies für `cse_app`:
 * `t_sitzung_eigene` (lesen) und `t_sitzung_eigene_schreiben` (beenden).
 * Keine wurde benutzt. Wer sein Telefon verlor, hatte keinen Weg, die
 * Anmeldung darauf zu beenden.
 *
 * **Was NICHT hier steht: fremde Sitzungen.** Das ist
 * `system.sitzung_widerrufen` — die Verwaltungsentscheidung, und sie hat
 * ihren eigenen Befund (V-076). Diese Seite ist Selbstbedienung; die Policy
 * sagt es schon: `benutzer_id = app.aktueller_benutzer()`.
 *
 * **Die laufende Anmeldung trägt „diese hier" und keinen Knopf.** Sie zu
 * beenden liesse das Sitzungsplätzchen im Browser stehen und auf etwas
 * zeigen, das es nicht mehr gibt — jede weitere Seite antwortete mit einer
 * Anmeldeaufforderung, die niemand erklärt hat. Zum Abmelden gibt es
 * „Abmelden".
 */
export const dynamic = 'force-dynamic';


export default async function Sicherheit(
  { searchParams }: {
    readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const k = await leseKonto(sitzung);

  const suche = searchParams === undefined ? {} : await searchParams;
  const beendet = suche['beendet'] === '1';
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const aktuell = k.sprache ?? 'de';
  const t = SICHERHEIT_TEXTE[aktuell];
  const meine = sitzung.portal === 'mitarbeiter' ? meinTexte(aktuell) : null;

  /* Wortgleich die Begründung der Kontowurzel: die Wurzel ist das PORTAL. */
  const wurzel = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : sitzung.portal === 'mitarbeiter' ? '/portal/mein'
    : sitzung.portal === 'kunde' ? '/portal/kunde'
    : k.slug === null ? '/auth/bereich' : `/portal/${k.slug}`;

  const sitzungen = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    return meineSitzungen(
      {
        abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
          (await tx.unsafe(sql, werte as never[])) as readonly T[],
      } as never,
      sitzung.sitzungId,
    );
  }) as Promise<readonly EigeneSitzung[]>);

  const zeit = new Intl.DateTimeFormat(PORTAL_BCP47[aktuell], {
    timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short',
  });

  const karte = 'rounded-lg border border-line bg-surface p-s5';
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s4 text-sm text-text hover:bg-surface-2';

  return (
    <div lang={PORTAL_BCP47[aktuell]} dir={PORTAL_RICHTUNG[aktuell]} data-sprache={aktuell}>
      <PortalRahmen
        titel={t.titel}
        bereich={null}
        nurLesen={sitzung.ansicht === 'gruppe'}
        leiste={leisteFuer(sitzung.portal, sitzung.ansicht, k.rolle)}
        wurzel={wurzel}
        aktiverTab="profil"
        sichtbareTabs={k.sichtbareTabs}
        navigationsRechte={k.navigationsRechte}
        {...(meine === null ? {} : { beschriftungen: meinBeschriftungen(meine) })}
      >
        <h1 className="mb-s5 text-h1 text-text">{t.titel}</h1>

        {beendet && (
          <Hinweis art="erfolg" cse="sitzung-beendet" className="mb-s5 max-w-[72ch]">
            {t.beendet}
          </Hinweis>
        )}
        {meldung !== null && (
          <Hinweis art="warnung" cse="sitzung-meldung" className="mb-s5 max-w-[72ch]">
            {meldung}
          </Hinweis>
        )}

        <div className="mb-s6 grid max-w-[72ch] grid-cols-1 gap-s4">
          <section className={karte}>
            <h2 className="mb-s2 mt-0 text-h3 text-text">{t.kennwort}</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">{t.kennwortText}</p>
            <Link href="/auth/kennwort-wechseln" data-cse="zum-kennwort" className={knopf}>
              {t.kennwort}
            </Link>
          </section>

          <section className={karte}>
            <h2 className="mb-s2 mt-0 text-h3 text-text">{t.zweiFaktor}</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">{t.zweiFaktorText}</p>
            <div className="flex flex-wrap gap-s3">
              <Link href="/auth/zwei-faktor/einrichten" data-cse="zur-zweiten-stufe"
                    className={knopf}>
                {t.zweiFaktor}
              </Link>
              <Link href="/auth/zwei-faktor/wiederherstellung" data-cse="zu-den-codes"
                    className={knopf}>
                {t.wiederherstellung}
              </Link>
            </div>
            <p className="mb-0 mt-s3 text-xs text-text-subtle">{t.wiederherstellungText}</p>
          </section>
        </div>

        <h2 className="mb-s2 text-h3 text-text">{t.anmeldungen}</h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">{t.anmeldungenText}</p>

        {sitzungen.length <= 1 ? (
          <p data-cse="keine-weiteren" className={`max-w-[72ch] text-sm text-text-muted ${karte}`}>
            {t.keine}
          </p>
        ) : (
          <ul data-cse="sitzungsliste" className="m-0 flex max-w-[72ch] list-none flex-col gap-s3 p-0">
            {sitzungen.map((s) => (
              <li key={s.id} data-cse="sitzung" data-diese={s.istDiese ? '1' : '0'}
                  className={`flex flex-wrap items-center justify-between gap-s3 ${karte}`}>
                <div className="min-w-0">
                  <p className="m-0 break-words text-base text-text">
                    {s.geraet ?? s.userAgent ?? '—'}
                    {s.istDiese && (
                      <span className="ms-s2 text-sm text-success">({t.diese})</span>
                    )}
                  </p>
                  <p className="m-0 mt-s1 break-words text-xs text-text-muted">
                    {s.ip ?? '—'}
                    {' · '}
                    {t.zuletzt} <span className="cse-zahl">{zeit.format(s.letzteAktivitaetAm)}</span>
                    {' · '}
                    {t.seit} <span className="cse-zahl">{zeit.format(s.erstelltAm)}</span>
                    {' · '}
                    {t.laeuftAb} <span className="cse-zahl">{zeit.format(s.ablaufAm)}</span>
                  </p>
                </div>
                {!s.istDiese && (
                  <form method="post" action="/api/konto/sitzung">
                    <input type="hidden" name="sitzung" value={s.id} />
                    <input type="hidden" name="zurueck" value="/portal/konto/sicherheit" />
                    <Button type="submit" variante="secondary" data-cse="sitzung-beenden">
                      {t.beenden}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </PortalRahmen>
    </div>
  );
}
