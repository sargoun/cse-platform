import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import {
  findeVeranstaltung, type VeranstaltungBlatt,
} from '@/server/services/security/veranstaltung';

/**
 * `/portal/[mandant]/security/veranstaltungen/[id]` — ein Eventdienst und sein
 * Besetzungsstand (SEC-08, SEC-04).
 *
 * **Der Besetzungsblock kennt DREI Zustände, nicht zwei.** Die Route hält
 * `security.lesen`; `einsatz` und `einsatz_zuordnung` liegen hinter
 * `dienstplan.lesen`, die Nachweislage hinter `personal.nachweis_lesen`. Mit
 * `security.lesen` allein ist die Veranstaltung sichtbar und der Stand leer —
 * und „leer" ist hier gefährlich, weil eine unbesetzte und eine nicht lesbare
 * Veranstaltung gleich aussehen. Deshalb: „nicht geprüft" ist etwas anderes
 * als „keine Schicht angelegt", und beides etwas anderes als „niemand
 * eingeteilt".
 *
 * **Keine Ampel aus `soll_besetzung`.** Ob die vereinbarte Stärke zugleich die
 * Mindeststärke ist, steht in keinem Dokument (O-210) — und die Antwort
 * entscheidet, ob jede unvollständig besetzte Veranstaltung als Notfall
 * gemeldet wird oder keine. Die Seite zeigt die Zahlen und sagt, was offen
 * ist.
 *
 * **Ein Ort als Freitext trägt keine Schicht**, und das steht hier als Grund
 * und nicht als Fehler: `veranstaltung.objekt_id` ist nullbar (ein
 * Veranstaltungsort existiert oft, bevor es eine Objektakte gibt),
 * `einsatz.objekt_id` dagegen NOT NULL. Ein Objekt zu erfinden wäre eine
 * Stammdatenzeile, die niemand angelegt hat.
 */
export const dynamic = 'force-dynamic';

const UNGEPRUEFT = 'nicht geprüft';

export default async function VeranstaltungBlattSeite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/security/veranstaltungen/[id]`, mandant,
  );
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: das Besetzungsbrett verlangt laut Manifest `dienstplan.schreiben`,
     die Dienstanweisung `dienstanweisung.lesen`, die Personenakte
     `personal.lesen`, das Objekt `objekt.lesen`. Jeder Verweis steht unter dem
     Recht SEINES Ziels — ein Verweis auf 404 verrät, was er nicht zeigen darf. */
  const darf = await haeltRechte(
    sitzung, 'dienstplan.schreiben', 'dienstanweisung.lesen', 'personal.lesen',
    'objekt.lesen', 'personal.nachweis_lesen',
  );

  const blatt = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      findeVeranstaltung(kontext, id))) as Promise<VeranstaltungBlatt | null>);

  // AUT-06: eine fremde Veranstaltung ist nicht vorhanden, nicht verboten.
  if (blatt === null) notFound();
  const { kopf, schichten } = blatt;

  const lebende = schichten?.filter((s) => !s.storniert) ?? [];
  const besetzt = lebende.reduce((summe, s) => summe + s.besetztAnzahl, 0);
  const ohneNachweis = lebende.flatMap((s) => s.besetzung).filter(
    (b) => b.lage !== null && !b.lage.bewacher.gueltigAmStichtag);

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      wurzelTitel="Sicherheit"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/security/veranstaltungen`, text: 'Alle Veranstaltungen' }}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <div className="flex flex-wrap items-baseline gap-s3">
          <StatusPill zustand={kopf.archiviert ? 'Archiviert' : 'Geplant'} />
          {darf['dienstplan.schreiben'] === true && (
            <Link
              href={`/portal/${mandant}/security/veranstaltungen/${kopf.id}/besetzung`}
              className="text-sm underline hover:text-text"
            >
              Zum Besetzungsbrett
            </Link>
          )}
        </div>
      </div>

      {/* --- Block 1: der Kopf --------------------------------------------- */}
      <div className="mb-s6 grid grid-cols-1 gap-s4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Auftrag</div>
          <p className="m-0 mt-s2 text-sm text-text">
            {kopf.kunde ?? <span className="text-text-muted">Kunde {UNGEPRUEFT}</span>}
            {kopf.anlass !== null && (
              <>
                <br />
                <span className="text-text-muted">{kopf.anlass}</span>
              </>
            )}
          </p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {kopf.auftragLeistungId === null
              ? 'Ohne Auftragsleistung erfasst — die Herkunft eines Eventauftrags ist offen (O-703).'
              : 'Hängt an einer Auftragsleistung.'}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Ort</div>
          <p className="m-0 mt-s2 text-sm text-text">
            {kopf.hatObjekt ? (
              kopf.objekt === null ? (
                <span className="text-text-muted">Objekt hinterlegt, Name {UNGEPRUEFT}</span>
              ) : darf['objekt.lesen'] === true && kopf.objektId !== null ? (
                <Link
                  href={`/portal/${mandant}/objekte/${kopf.objektId}`}
                  className="underline hover:text-text"
                >
                  {kopf.objekt}
                </Link>
              ) : kopf.objekt
            ) : (kopf.veranstaltungsortText ?? '—')}
          </p>
          {!kopf.hatObjekt && (
            /* Kein Fehler, ein Grund: `einsatz.objekt_id` ist NOT NULL, weil
               Kundendecke, Check-in und Medien daran hängen. */
            <p className="m-0 mt-s3 text-sm text-warning" data-cse="ort-nur-text">
              <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
              Der Ort ist nur als Text erfasst. Daraus lässt sich keine Schicht
              bauen — eine Schicht hängt immer an einem Objekt. Bitte den
              Veranstaltungsort als Objekt anlegen und zuordnen.
            </p>
          )}
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Zeitfenster</div>
          <p className="m-0 mt-s2 text-sm tabular-nums text-text">
            {kopf.beginnLokal}
            <br />
            bis {kopf.endeLokal}
          </p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            Dauer {stundenAusMinuten(kopf.dauerMinuten)} — Differenz der
            Zeitpunkte, nicht der Uhrzeiten.
            <br />
            <span className="tabular-nums">
              {kopf.beginnUtc} – {kopf.endeUtc} UTC
            </span>
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Stärke und Leitung
          </div>
          <div className="mt-s1 text-h2 tabular-nums text-text">
            {schichten === null ? (
              <span className="text-base text-text-muted">{UNGEPRUEFT}</span>
            ) : (
              <>{besetzt} von {kopf.sollBesetzung}</>
            )}
          </div>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            Vereinbarte Stärke {kopf.sollBesetzung}
            {kopf.erwarteteBesucher !== null
              && ` · erwartet ${String(kopf.erwarteteBesucher)} Besucher`}
            <br />
            Leitung: {kopf.leitung ?? 'nicht benannt'}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Dienstanweisung
          </div>
          {kopf.dienstanweisungId === null ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">
              Keine Dienstanweisung zugeordnet.
            </p>
          ) : darf['dienstanweisung.lesen'] === true ? (
            <p className="m-0 mt-s2 text-sm text-text">
              <Link
                href={`/portal/${mandant}/security/dienstanweisungen/${kopf.dienstanweisungId}`}
                className="underline hover:text-text"
              >
                {kopf.dienstanweisungTitel ?? 'Dienstanweisung'}
              </Link>
              <br />
              <span className="text-text-muted">
                {kopf.dienstanweisungVersion === null
                  ? 'keine aktive Version'
                  : `Version ${String(kopf.dienstanweisungVersion)}`}
                {kopf.dienstanweisungStatus !== null && ` · ${kopf.dienstanweisungStatus}`}
              </span>
            </p>
          ) : (
            <p className="m-0 mt-s2 text-sm text-text-muted">
              Eine Dienstanweisung ist zugeordnet. Ihr Inhalt liegt hinter{' '}
              <code>dienstanweisung.lesen</code>.
            </p>
          )}
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Offen (O-210)
          </div>
          <p className="m-0 mt-s2 text-sm text-text-muted">
            Ob die vereinbarte Stärke zugleich die <strong className="text-text">Mindest</strong>
            stärke ist, ist nicht entschieden. Deshalb steht hier keine Ampel und
            kein „dringend": die Antwort entscheidet, ob jede unvollständig
            besetzte Veranstaltung als Notfall gemeldet wird oder keine.
          </p>
        </Card>
      </div>

      {/* --- Block 2: der Besetzungsstand ---------------------------------- */}
      <section className="mb-s6" data-cse="veranstaltung-besetzung">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Besetzung</h2>
          <p className="m-0 text-sm text-text-muted">
            Nachweislage zum Stichtag{' '}
            <span className="tabular-nums">{blatt.stichtag}</span> — dem Tag der
            Veranstaltung, nicht heute
          </p>
        </div>

        {schichten === null ? (
          <Hinweis art="hinweis" cse="besetzung-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Schichten und Einteilungen liegen hinter
            dem Recht <code>dienstplan.lesen</code>, das dieses Konto hier nicht
            hält. Das ist etwas anderes als „unbesetzt" — und der Unterschied ist
            an dieser Stelle der zwischen „niemand kommt" und „ich darf es nicht
            sehen".
          </Hinweis>
        ) : schichten.length === 0 ? (
          <Hinweis art="warnung" cse="besetzung-keine-schicht" className="max-w-prose">
            <strong>Es ist keine Schicht angelegt.</strong> Für diese Veranstaltung
            gibt es noch keine <code>einsatz</code>-Zeile — also auch keine
            Einteilung, keinen Check-in und keinen Zeiteintrag.
            {kopf.hatObjekt
              ? darf['dienstplan.schreiben'] === true
                ? ' Die Schicht entsteht auf dem Besetzungsbrett.'
                : ' Die Schicht entsteht auf dem Besetzungsbrett; dafür fehlt dieses Konto das Recht dienstplan.schreiben.'
              : ' Solange der Ort nur als Text erfasst ist, lässt sich keine anlegen.'}
          </Hinweis>
        ) : (
          <ul className="m-0 list-none p-0">
            {schichten.map((s) => (
              <li key={s.einsatzId} className="mb-s4" data-cse="event-schicht">
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-s3">
                    <span className="text-base text-text">
                      <span className="tabular-nums">{s.planDatum}</span>
                      {' · '}
                      <span className="tabular-nums">{s.beginnLokal} – {s.endeLokal}</span>
                      {s.storniert && (
                        <span className="ml-s2 text-text-muted">· storniert</span>
                      )}
                    </span>
                    <span className="text-sm tabular-nums text-text-muted">
                      {s.besetztAnzahl} von {s.sollBesetzung} besetzt · Minimum{' '}
                      {s.minBesetzung}
                    </span>
                  </div>

                  {s.besetzung.length === 0 ? (
                    <p className="m-0 mt-s3 text-sm text-warning">
                      Die Schicht steht, es ist aber niemand eingeteilt.
                    </p>
                  ) : (
                    <ul className="m-0 mt-s3 list-none p-0">
                      {s.besetzung.map((b) => {
                        const sperrt = b.lage !== null
                          && !b.lage.bewacher.gueltigAmStichtag;
                        return (
                          <li
                            key={b.zuordnungId}
                            data-cse="event-wache"
                            className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3
                                       border-b border-line pb-s2 text-sm last:border-0"
                          >
                            <span className="text-text">
                              {darf['personal.lesen'] === true ? (
                                <Link
                                  href={`/portal/${mandant}/personal/personen/${b.personId}`}
                                  className="underline hover:text-text"
                                >
                                  {b.name}
                                </Link>
                              ) : b.name}
                              {b.funktion !== null && (
                                <span className="ml-s2 text-text-muted">{b.funktion}</span>
                              )}
                              <span className="ml-s2 text-micro text-text-muted">
                                {b.status}
                                {b.zugesagtAmLokal !== null && ` · zugesagt ${b.zugesagtAmLokal}`}
                                {b.abgesagtAmLokal !== null
                                  && ` · abgesagt ${b.abgesagtAmLokal}${b.absageGrund === null ? '' : ` (${b.absageGrund})`}`}
                              </span>
                            </span>
                            {/* §9: das WORT trägt die Bedeutung, nicht die Farbe. */}
                            {b.lage === null ? (
                              <span className="text-text-muted">
                                § 34a-Lage {UNGEPRUEFT}
                              </span>
                            ) : sperrt ? (
                              <span className="text-danger" data-cse="wache-gesperrt">
                                <Icon
                                  name="fehler"
                                  groesse="sm"
                                  className="mr-s2 inline-block align-[-2px]"
                                />
                                Bewacherregister deckt den Tag nicht —{' '}
                                {b.lage.bewacher.vorhanden
                                  ? `Status ${b.lage.bewacher.status ?? 'unbekannt'}`
                                  : 'kein Eintrag erfasst'}
                                {' (handerfasst, nicht verbunden)'}
                              </span>
                            ) : (
                              <span className="text-success">
                                § 34a gedeckt — {b.lage.bewacher.bewacherId ?? 'ohne ID'}
                                {' (handerfasst, nicht verbunden)'}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        {ohneNachweis.length > 0 && (
          <Hinweis art="warnung" cse="event-sec04" className="mt-s4 max-w-prose">
            <strong>
              {ohneNachweis.length} eingeteilte Person(en) sind am Veranstaltungstag
              im Bewacherregister nicht gedeckt.
            </strong>{' '}
            SEC-04 ist eine harte Sperre: das § 34a-Tor lehnt eine Einteilung auf
            eine Bewachungstätigkeit ohne gültigen Registereintrag ab. Der Stand
            ist handerfasst — es gibt keine Schnittstelle zum Bewacherregister.
          </Hinweis>
        )}

        {darf['personal.nachweis_lesen'] !== true && schichten !== null
          && schichten.length > 0 && (
          <Hinweis art="hinweis" cse="event-nachweis-ungeprueft" className="mt-s4 max-w-prose">
            <strong>Die § 34a-Lage ist nicht geprüft.</strong> Nachweise hängen am
            Menschen und liegen hinter <code>personal.nachweis_lesen</code>. Dass
            hier keine Sperre steht, heisst nicht, dass keine besteht.
          </Hinweis>
        )}
      </section>

      <Hinweis art="hinweis" cse="veranstaltung-o703" className="max-w-prose">
        <strong>Offen (O-703):</strong> woher ein Veranstaltungsauftrag entsteht —
        aus einer Auftragsleistung, aus dem Vertrieb oder handerfasst von der
        Wachleitung — ist nicht entschieden, und die Seitenkarte führt keine
        Route zum Anlegen. Deshalb gibt es hier keinen Knopf „Veranstaltung
        anlegen": welche Felder Pflicht sind und wer sie füllen darf, hängt an
        dieser Antwort.
      </Hinweis>
    </PortalRahmen>
  );
}
