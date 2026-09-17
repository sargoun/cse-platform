import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { STAND_TEXT } from '@/server/registry/integrationen';
import {
  ladeVorlagenuebersicht, type Vorlagenuebersicht,
} from '@/server/services/einstellung/vorlagen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/vorlagen` — jede Vorlage dieser
 * Gesellschaft an ihrer echten Quelle (OPS-08, BAU-06, FIN-15, NOT-02).
 *
 * **Vier Abschnitte, und nur EINER schreibt hier.** Die
 * Behinderungsvorlagen werden hier gepflegt. Der Mahntext liegt auf
 * `mahnstufe` und wird unter Einstellungen › Mahnwesen gesetzt — dort stehen
 * Frist, Gebuehr und Zinsart, und zwei Editoren auf einer Zeile waeren ein
 * Defekt. Die E-Mail-Texte stehen im CODE und nicht in der Datenbank. Die
 * Fusszeilen stehen in der Identitaet.
 *
 * **Das Recht der Seite ist nicht das Recht der Tabellen.** Die Route ist mit
 * `system.einstellung_verwalten` bewacht; `behinderung_vorlage` verlangt
 * `bau.lesen`/`bau.schreiben`, `mahnstufe` verlangt `mahnung.lesen`. Ohne das
 * Gewerkerecht saehe man eine leere Liste — „nicht hinterlegt" statt „nicht
 * sichtbar". Die Seite sagt deshalb, WELCHES Recht fehlt. Die RLS wird dafuer
 * nicht geweitet: die Vorlage einer VOB/B-Erklaerung gehoert dem Bau.
 *
 * **Es geht nichts hinaus.** Ein EU-gehosteter Transaktionsmailer ist nicht
 * gewaehlt (O-36 / O-501), also ist jede E-Mail-Vorlage heute ein Text im
 * Posteingang und keine Nachricht an jemanden.
 */
export const dynamic = 'force-dynamic';

export default async function Vorlagen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/vorlagen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const uebersicht = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, zugang.sitzung,
      (kontext) => ladeVorlagenuebersicht(kontext)),
  ) as Promise<Vorlagenuebersicht>);

  const { rechte, behinderung, mahnstufen, arten, identitaet } = uebersicht;
  const platzhalterOffen = behinderung.filter((v) => v.ist_platzhalter).length;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel="Vorlagen"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Vorlagen</h1>
      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Vier Arten von Vorlagen, vier verschiedene Orte — und jede Zeile hier nennt
        ihren. Nur die Behinderungsanzeige wird auf dieser Seite gepflegt; Mahntext,
        E-Mail-Texte und Fusszeilen gehören woanders hin und werden hier nur gezeigt.
      </p>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="vorlagen-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      {/* 1 — Behinderungsanzeige (BAU-06) */}
      <section aria-labelledby="behinderung-titel" className="mb-s7">
        <h2 id="behinderung-titel" className="mb-s3 text-h2 text-text">
          Behinderungsanzeige (§ 6 VOB/B)
        </h2>
        {rechte.bauLesen ? (
          <>
            {platzhalterOffen > 0 ? (
              <Hinweis art="warnung" cse="vorlagen-platzhalter" className="mb-s4 max-w-[72ch]">
                <strong>{String(platzhalterOffen)} von {String(behinderung.length)}{' '}
                Vorlagen tragen Platzhaltertext.</strong> Eine Behinderungsanzeige ist
                eine anspruchswahrende Erklärung nach § 6 Abs. 1 VOB/B — mit geratenem
                Wortlaut geht sie nicht hinaus, und der Versand weist sie ab. Bestätigt
                wird der Wortlaut unten; die bisherige Fassung wird dabei archiviert,
                nicht überschrieben, damit eine versendete Anzeige ihren damaligen
                Wortlaut behält.
              </Hinweis>
            ) : null}
            {behinderung.length === 0 ? (
              <p data-cse="behinderung-leer"
                 className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Es ist keine Vorlage hinterlegt.
              </p>
            ) : (
              <div data-cse="behinderung-vorlagen">
                <DataTable
                  beschriftung="Vorlagen der Behinderungsanzeige mit Fundstelle, Betreff und Zustand"
                  zeilen={[...behinderung]}
                  schluessel={(v) => v.id}
                  spalten={[
                    { schluessel: 'schluessel', kopf: 'Schlüssel',
                      zelle: (v) => <code className="text-xs">{v.schluessel}</code> },
                    { schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                      zelle: (v) => v.bezeichnung },
                    { schluessel: 'fundstelle', kopf: 'Fundstelle',
                      zelle: (v) => v.fundstelle },
                    { schluessel: 'betreff', kopf: 'Betreff', zelle: (v) => v.betreff },
                    { schluessel: 'zustand', kopf: 'Zustand',
                      zelle: (v) => (v.ist_platzhalter
                        ? <StatusPill zustand="Entwurf" />
                        : <StatusPill zustand="Aktiv" />) },
                  ]}
                />
              </div>
            )}
            <p className="mt-s3 max-w-[72ch] text-xs text-text-muted">
              Erlaubte Platzhalter:{' '}
              {uebersicht.erlaubtePlatzhalter.map((p) => (
                <code key={p} className="mr-s2 text-xs">{`{${p}}`}</code>
              ))}
              — genau die Angaben, die § 6 Abs. 1 VOB/B selbst verlangt, plus Absender.
              Ein anderer bleibt beim Versand als geschweifte Klammer im Schreiben
              stehen; deshalb weist der Dienst ihn ab.
            </p>
          </>
        ) : (
          <Hinweis art="warnung" cse="behinderung-kein-recht" className="max-w-[72ch]">
            <strong>Diese Liste ist nicht leer — sie ist nicht sichtbar.</strong> Die
            Vorlagen der Behinderungsanzeige gehören dem Bau und verlangen
            <code> bau.lesen</code>; Ihre Sitzung hält das Recht dieser Seite
            (<code>system.einstellung_verwalten</code>), aber nicht das des Gewerks.
            Ohne diesen Satz stünde hier „keine Vorlage hinterlegt", und das wäre die
            falsche Auskunft.
          </Hinweis>
        )}
      </section>

      {/* 2 — Mahnwesen (FIN-15), nur lesend */}
      <section aria-labelledby="mahntext-titel" className="mb-s7">
        <h2 id="mahntext-titel" className="mb-s3 text-h2 text-text">Mahntext je Stufe</h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Der Text liegt auf der Mahnstufe, zusammen mit Frist, Gebühr und Zinsart.
          Gepflegt wird er dort:{' '}
          <a className="text-brand underline"
             href={`/portal/${mandant}/einstellungen/mahnwesen`}>
            Einstellungen › Mahnwesen
          </a>. Hier steht er, damit man alle Vorlagen an einer Stelle findet — nicht,
          damit man ihn zweimal ändern kann.
        </p>
        {rechte.mahnungLesen ? (
          mahnstufen.length === 0 ? (
            <p data-cse="mahntext-leer"
               className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
              Es ist keine laufende Stufe hinterlegt.
            </p>
          ) : (
            <div data-cse="mahntexte">
              <DataTable
                beschriftung="Laufende Mahnstufen und ihr Zustand"
                zeilen={[...mahnstufen]}
                schluessel={(s) => s.id}
                spalten={[
                  { schluessel: 'stufe', kopf: 'Stufe', zelle: (s) => String(s.stufe) },
                  { schluessel: 'bez', kopf: 'Bezeichnung', zelle: (s) => s.bezeichnung },
                  { schluessel: 'gueltig', kopf: 'Gültig ab', zelle: (s) => s.gueltigAb },
                  { schluessel: 'zustand', kopf: 'Zustand',
                    zelle: (s) => (s.istPlatzhalter
                      ? <StatusPill zustand="Entwurf" />
                      : <StatusPill zustand="Aktiv" />) },
                  { schluessel: 'ort', kopf: 'Gepflegt unter',
                    zelle: () => <span className="text-xs text-text-muted">Mahnwesen</span> },
                ]}
              />
            </div>
          )
        ) : (
          <Hinweis art="warnung" cse="mahntext-kein-recht" className="max-w-[72ch]">
            <strong>Nicht sichtbar, nicht leer.</strong> Die Mahnstufen verlangen
            <code> mahnung.lesen</code>; Ihre Sitzung hält es nicht.
          </Hinweis>
        )}
      </section>

      {/* 3 — E-Mail und Posteingang (NOT-02) */}
      <section aria-labelledby="email-titel" className="mb-s7">
        <h2 id="email-titel" className="mb-s3 text-h2 text-text">
          Benachrichtigungen und E-Mail
        </h2>
        <p data-cse="email-stand"
           className="mb-s4 flex max-w-[72ch] items-center gap-s2 text-sm text-text-muted">
          <StatusPill zustand="Inaktiv" />
          <span className="text-xs text-text-muted">
            Transaktions-E-Mail: {STAND_TEXT.nicht_verbunden} (O-36, O-501)
          </span>
        </p>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Titel und Text jeder Art stehen <strong>im Code</strong>
          (<code>server/benachrichtigung/registry.ts</code>) und nicht in der Datenbank —
          deshalb gibt es hier kein Formular, das nichts speichern würde. Zustellt wird
          in den Posteingang des Portals; nach draussen geht nichts, solange kein
          EU-gehosteter Versender mit Vertrag zur Auftragsverarbeitung gewählt ist
          (O-36), und welche Absenderadresse je Gesellschaft gilt sowie ob DKIM und
          DMARC eingerichtet sind, ist offen (O-501).
        </p>
        <div data-cse="benachrichtigungsarten">
          <DataTable
            beschriftung="Registrierte Benachrichtigungsarten mit Modul und Vorgabekanälen"
            zeilen={[...arten]}
            schluessel={(a) => a.schluessel}
            spalten={[
              { schluessel: 'art', kopf: 'Art',
                zelle: (a) => <code className="text-xs">{a.schluessel}</code> },
              { schluessel: 'modul', kopf: 'Modul', zelle: (a) => a.modulTitel },
              { schluessel: 'kanaele', kopf: 'Vorgabekanäle',
                zelle: (a) => a.kanaele.join(', ') },
              { schluessel: 'sammelbar', kopf: 'Sammelbar',
                zelle: (a) => (a.sammelbar
                  ? 'ja'
                  : <span className="text-warning">nein — nie in eine Zusammenfassung</span>) },
              { schluessel: 'quelle', kopf: 'Quelle',
                zelle: () => <span className="text-xs text-text-muted">im Code definiert</span> },
            ]}
          />
        </div>
      </section>

      {/* 4 — Fusszeilen und Absender (DESIGN §11) */}
      <section aria-labelledby="fuss-titel" className="mb-s7">
        <h2 id="fuss-titel" className="mb-s3 text-h2 text-text">
          Fusszeilen und Absender
        </h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Brief-, Rechnungs- und Angebotsfuss und der E-Mail-Absender gehören zur
          Identität dieser Gesellschaft und werden dort gepflegt:{' '}
          <a className="text-brand underline"
             href={`/portal/${mandant}/einstellungen/identitaet`}>
            Einstellungen › Identität
          </a>.
        </p>
        {identitaet === null ? (
          <Hinweis art="warnung" cse="fuss-keine-identitaet" className="max-w-[72ch]">
            Für diesen Bereich ist keine Identitätszeile hinterlegt — dann gibt es auch
            keine Fusszeilen.
          </Hinweis>
        ) : (
          <div data-cse="fusszeilen">
            <DataTable
              beschriftung="Rechtliche Fusszeilen und E-Mail-Absender dieser Gesellschaft"
              zeilen={[
                { schluessel: 'brief', kopf: 'Brief', wert: identitaet.briefFuss },
                { schluessel: 'rechnung', kopf: 'Rechnung', wert: identitaet.rechnungFuss },
                { schluessel: 'angebot', kopf: 'Angebot', wert: identitaet.angebotFuss },
                { schluessel: 'absender', kopf: 'E-Mail-Absender',
                  wert: identitaet.emailAbsender },
                { schluessel: 'signatur', kopf: 'E-Mail-Signatur',
                  wert: identitaet.emailSignatur },
              ]}
              schluessel={(z) => z.schluessel}
              spalten={[
                { schluessel: 'was', kopf: 'Vorlage', zelle: (z) => z.kopf },
                { schluessel: 'wert', kopf: 'Inhalt',
                  zelle: (z) => (z.wert === null || z.wert === ''
                    ? <span className="text-text-subtle">nicht hinterlegt</span>
                    : z.wert) },
              ]}
            />
          </div>
        )}
        <Hinweis art="hinweis" cse="fuss-k12" className="mt-s4 max-w-[72ch]">
          <strong>K-12: die Rechnungsfusszeile gehört in die Rechnung kopiert, nicht
          verlinkt</strong> — sonst veränderte eine spätere Änderung eine
          festgeschriebene Rechnung und entwertete ihre Hashkette stillschweigend.
          <strong> Dieses Kopieren ist noch nicht gebaut:</strong> der kanonische
          Rechnungs-Payload führt kein Feld für die Fusszeile der Gesellschaft, und was
          auf einer Rechnung steht, kommt aus deren eigenem Fusstext.
        </Hinweis>
      </section>

      {/* Schreibweg: nur die Behinderungsvorlage */}
      {rechte.bauSchreiben ? (
        <section aria-labelledby="vorlage-setzen-titel"
                 className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 id="vorlage-setzen-titel" className="text-h2 text-text">
            Behinderungsvorlage bestätigen
          </h2>
          <p className="mt-s2 text-xs text-text-muted">
            Die bisherige Fassung dieses Schlüssels wird archiviert und bleibt lesbar;
            die neue gilt ab sofort und ist damit kein Platzhalter mehr.
          </p>
          <form method="post" action={`/api/einstellungen/vorlagen?mandant=${mandant}`}>
            <label className="mt-s4 block text-sm text-text" htmlFor="schluessel">
              Schlüssel
            </label>
            <input id="schluessel" name="schluessel" type="text" required className={feld}
                   placeholder="behinderung_standard" />

            <label className="mt-s4 block text-sm text-text" htmlFor="bezeichnung">
              Bezeichnung
            </label>
            <input id="bezeichnung" name="bezeichnung" type="text" required className={feld}
                   placeholder="Behinderungsanzeige Standard" />

            <label className="mt-s4 block text-sm text-text" htmlFor="fundstelle">
              Fundstelle
            </label>
            <input id="fundstelle" name="fundstelle" type="text" required className={feld}
                   placeholder="§ 6 Abs. 1 VOB/B" />

            <label className="mt-s4 block text-sm text-text" htmlFor="betreff">Betreff</label>
            <input id="betreff" name="betreff" type="text" required className={feld}
                   placeholder="Behinderungsanzeige {projekt}" />

            <label className="mt-s4 block text-sm text-text" htmlFor="rumpf">Rumpf</label>
            <textarea id="rumpf" name="rumpf" rows={10} required className={feld} />

            <button type="submit"
                    className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
              Vorlage bestätigen
            </button>
          </form>
        </section>
      ) : (
        <Hinweis art="hinweis" cse="vorlage-kein-schreibrecht" className="max-w-[72ch]">
          Pflegen kann die Behinderungsvorlage, wer <code>bau.schreiben</code> hält — das
          Recht dieser Seite genügt dafür nicht. Eine Erklärung nach § 6 VOB/B ist eine
          Bau-Entscheidung, keine Verwaltungsangelegenheit.
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
