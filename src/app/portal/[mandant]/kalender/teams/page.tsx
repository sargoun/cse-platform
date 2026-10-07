import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KALENDER_TEAMS_TEXTE } from '@/lib/i18n/verwaltung/kalender-teams';
import { setzeEin } from '@/lib/i18n/vorlage';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  TEAM_ROLLEN_VORSCHLAG, listeTeams, waehlbareTeamleitungen, zuordenbareBeschaeftigungen,
  type TeamZeile,
} from '@/server/services/kern/team';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { FELD } from './felder';
import { MandantAntwort, mandantTor } from '../../../unterseite';

/**
 * `/portal/[mandant]/kalender/teams` — Teams und ihre Mitglieder (V-378,
 * O-650, D-813, CAL-02).
 *
 * Lesen mit `kalender.lesen`, anlegen und zuordnen mit `kalender.schreiben`
 * (Seitenkarte §5.17). Ohne das Schreibrecht steht ein Satz statt der
 * Formulare (AUT-06: kein Knopf, der abgewiesen würde). Eine beendete
 * Mitgliedschaft bleibt mit ihrem Ende stehen.
 */
export const dynamic = 'force-dynamic';

export default async function Teams({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/kalender/teams`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const darfSchreiben = (await haeltRechte(zugang.sitzung, 'kalender.schreiben'))[
    'kalender.schreiben'] === true;
  const { teams, beschaeftigungen, leitungen } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, zugang.sitzung, async (kontext) => ({
      teams: await listeTeams(kontext),
      beschaeftigungen: darfSchreiben ? await zuordenbareBeschaeftigungen(kontext) : [],
      leitungen: darfSchreiben ? await waehlbareTeamleitungen(kontext) : [],
    })))) as {
    teams: readonly TeamZeile[];
    beschaeftigungen: readonly { readonly id: string; readonly name: string }[];
    leitungen: readonly { readonly id: string; readonly name: string }[];
  };

  const t = nachSprache(KALENDER_TEAMS_TEXTE, internSprache(zugang.sprache));
  const erfolg = typeof suche['erfolg'] === 'string' ? eigenerEintrag(t.erfolg, suche['erfolg']) : null;
  const fehler = typeof suche['fehler'] === 'string' && /^[a-z_]{1,64}$/u.test(suche['fehler'])
    ? (eigenerEintrag(t.fehler, suche['fehler']) ?? t.fehlerSonst) : null;

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="kalender"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/kalender`, text: t.zumKalender }}
    >
      <h1 className="mb-s2 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      {erfolg !== null && (
        <Hinweis art="erfolg" rolle="status" cse="teams-erfolg" className="mb-s5 max-w-prose">
          {erfolg}
        </Hinweis>
      )}
      {fehler !== null && (
        <Hinweis art="warnung" rolle="alert" cse="teams-fehler" className="mb-s5 max-w-prose">
          {fehler}
        </Hinweis>
      )}

      {darfSchreiben && teams.length > 0 && (
        <p className="mb-s4 max-w-prose text-xs text-text-subtle">{t.rolleHinweis}</p>
      )}

      {teams.length === 0 ? (
        <p className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineTeams}
        </p>
      ) : (
        <ul className="mb-s6 m-0 flex list-none flex-col gap-s4 p-0">
          {teams.map((team) => {
            const laufend = team.mitglieder.filter((m) => m.bis === null);
            const beendet = team.mitglieder.filter((m) => m.bis !== null);
            return (
              <li key={team.id} data-cse="team" data-team={team.id}
                  className="rounded-lg border border-line bg-surface p-s5">
                <h2 className="m-0 text-h3 text-text">{team.name}</h2>
                <p className="m-0 mt-s2 text-sm text-text-muted">
                  {t.leitung}: {team.leitung ?? t.ohneAngabe} · {t.bereich}: {team.bereich ?? t.ohneAngabe}
                </p>
                {darfSchreiben && leitungen.length > 0 && (
                  <form method="post" action="/api/kalender/teams" data-cse="team-leitung-setzen"
                        aria-label={`${t.leitungSetzen}: ${team.name}`}
                        className="mt-s3 flex flex-wrap items-end gap-s3">
                    <input type="hidden" name="vorgang" value="leitung" />
                    <input type="hidden" name="team" value={team.id} />
                    <label className="flex flex-col gap-s1 text-xs text-text-muted">
                      {t.leitung}
                      <select name="leitung" className={FELD} defaultValue={team.leitungId ?? ''}>
                        <option value="">{t.leitungOhne}</option>
                        {/*
                          * Steht die bisherige Leitung nicht zur Wahl (ohne Benutzerverwaltung
                          * sieht man nur das eigene Konto), bleibt sie als Option — sonst
                          * stünde das Feld auf „Ohne Leitung", und ein Klick entfernte sie.
                          */}
                        {team.leitungId !== null && !leitungen.some((l) => l.id === team.leitungId) && (
                          <option value={team.leitungId}>{team.leitung ?? t.leitungBisher}</option>
                        )}
                        {leitungen.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                    <Button type="submit" variante="ghost">{t.leitungSetzen}</Button>
                  </form>
                )}

                <h3 className="mb-s2 mt-s4 text-base text-text">{t.mitglieder}</h3>
                {laufend.length === 0 ? (
                  <p className="m-0 text-sm text-text-muted">{t.keineMitglieder}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-s2 p-0">
                    {laufend.map((m) => (
                      <li key={m.id} data-cse="team-mitglied"
                          className="flex flex-wrap items-center justify-between gap-s3">
                        <span className="text-sm text-text">
                          {m.name}{m.rolle !== null ? ` · ${m.rolle}` : ''}
                          <span className="text-text-muted"> · {setzeEin(t.seit, { seit: m.seit })}</span>
                        </span>
                        {darfSchreiben && (
                          <form method="post" action="/api/kalender/teams">
                            <input type="hidden" name="vorgang" value="beenden" />
                            <input type="hidden" name="mitglied" value={m.id} />
                            <Button type="submit" variante="ghost" data-cse="team-mitglied-beenden">
                              {t.beenden}
                            </Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {beendet.length > 0 && (
                  <>
                    <h3 className="mb-s2 mt-s4 text-sm text-text-muted">{t.beendete}</h3>
                    <ul className="m-0 flex list-none flex-col gap-s1 p-0">
                      {beendet.map((m) => (
                        <li key={m.id} data-cse="team-mitglied-beendet" className="text-sm text-text-muted">
                          {m.name}{m.rolle !== null ? ` · ${m.rolle}` : ''} · {setzeEin(t.seitBis, { seit: m.seit, bis: m.bis ?? '' })}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {darfSchreiben && beschaeftigungen.length > 0 && (
                  <form method="post" action="/api/kalender/teams" data-cse="team-zuordnen"
                        aria-label={`${t.zuordnenTitel}: ${team.name}`}
                        className="mt-s4 flex flex-wrap items-end gap-s3">
                    <input type="hidden" name="vorgang" value="zuordnen" />
                    <input type="hidden" name="team" value={team.id} />
                    <label className="flex flex-col gap-s1 text-xs text-text-muted">
                      {t.beschaeftigung}
                      <select name="anstellung" required className={FELD} defaultValue="">
                        <option value="" disabled>{t.beschaeftigungWaehlen}</option>
                        {beschaeftigungen.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-s1 text-xs text-text-muted">
                      {t.rolle}
                      <input name="rolle" maxLength={60} list={`rollen-${team.id}`} className={FELD} />
                    </label>
                    <datalist id={`rollen-${team.id}`}>
                      {TEAM_ROLLEN_VORSCHLAG.map((r) => <option key={r} value={r} />)}
                    </datalist>
                    <Button type="submit" variante="secondary">{t.zuordnen}</Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {darfSchreiben ? (
        <section aria-labelledby="team-neu" className="max-w-prose" data-cse="team-neu">
          <h2 id="team-neu" className="mb-s3 text-h3 text-text">{t.neuTitel}</h2>
          <form method="post" action="/api/kalender/teams"
                className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="vorgang" value="anlegen" />
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              {t.name}
              <input name="name" required maxLength={120} className={FELD} data-cse="team-name" />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              {t.bereich}
              <input name="bereich" maxLength={80} className={FELD} />
            </label>
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              {t.leitung}
              <select name="leitung" className={FELD} defaultValue="" data-cse="team-leitung">
                <option value="">{t.leitungOhne}</option>
                {leitungen.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span className="text-text-subtle">{t.leitungHinweis}</span>
            </label>
            <div>
              <Button type="submit" variante="primary" data-cse="team-anlegen">{t.anlegen}</Button>
            </div>
          </form>
        </section>
      ) : (
        <p className="max-w-prose text-sm text-text-muted" data-cse="teams-ohne-schreibrecht">
          {t.ohneSchreibrecht}
        </p>
      )}
    </PortalRahmen>
  );
}
