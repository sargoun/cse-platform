import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { VERLAUF_TEXTE, type VerlaufTexte } from '@/lib/i18n/verwaltung/crm-verlauf';
import type { PortalSprache } from '@/lib/i18n/texte';
import type { VerlaufEintrag } from '@/server/services/crm/verlauf';

/**
 * Der Kommunikationsverlauf — EIN Bauteil für Kunden- und Kontaktblatt
 * (CRM-03, V-147, D-641).
 *
 * **Warum ein Bauteil und nicht zwei Tabellen in zwei Seiten.** Das
 * Kontaktblatt hatte seinen Verlauf als eigene Tabelle mit rohen
 * Aufzählungswerten (`ausgehend · email`, `vertraglich`); das Kundenblatt
 * hatte keinen. Zwei Fassungen derselben Liste laufen auseinander — die eine
 * bekommt die Nachrichten, die andere nicht. Hier steht sie einmal, übersetzt,
 * mit denselben Spalten auf beiden Blättern.
 *
 * **Die Rechtsgrundlage steht als Beleg, nicht als Auskunft.** Gezeigt wird
 * der Schnappschuss IM MOMENT DES SENDENS (`rechtsgrundlage_snapshot`,
 * `nachricht.rechtsgrundlage`) — die Frage einer Abmahnung ist „durften Sie
 * damals?", nicht „dürften Sie heute?". Der heutige Stand steht auf dem
 * Kontaktblatt im Nachweisblock, hinter seinem eigenen Recht.
 */

const ZEILE_TEXT = 'm-0 text-sm text-text';
const LEISE = 'm-0 mt-s1 text-xs text-text-muted';
const VERWEIS = 'text-text underline-offset-2 hover:text-brand hover:underline';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm '
  + 'text-text';

/** Ein Wert aus einer Übersetzungstabelle — nie der rohe Schlüssel. */
const aus = (t: VerlaufTexte, tabelle: Readonly<Record<string, string>>, wert: string | null) =>
  (wert === null ? null : tabelle[wert] ?? t.unbekannt);

function Weg({ e, t }: { readonly e: VerlaufEintrag; readonly t: VerlaufTexte }) {
  const teile = [
    aus(t, t.richtungen, e.richtung),
    aus(t, t.kanaele, e.kanal),
    e.richtung === 'intern' ? null : aus(t, t.zwecke, e.zweck),
  ].filter((x): x is string => x !== null);
  return <span className="text-sm text-text">{teile.join(' · ')}</span>;
}

function Beleg({ e, t }: { readonly e: VerlaufEintrag; readonly t: VerlaufTexte }) {
  const teile: string[] = [];
  if (e.richtung === 'ausgehend' && e.grundlage !== null) {
    teile.push(t.grundlageAmTag(aus(t, t.grundlagen, e.grundlage) ?? t.unbekannt));
  }
  if (e.quelle === 'nachricht' && e.zustellung !== null) {
    teile.push(aus(t, t.zustellung, e.zustellung) ?? t.unbekannt);
  }
  return teile.length === 0
    ? <span className="text-text-subtle">{t.unbekannt}</span>
    : <span className="text-xs text-text-muted" data-cse="verlauf-beleg">{teile.join(' · ')}</span>;
}

export function Kommunikationsverlauf({
  eintraege, sprache, mandant, blatt, darfNamen, darfNachrichten, grenze,
}: {
  readonly eintraege: readonly VerlaufEintrag[];
  readonly sprache: PortalSprache | null;
  readonly mandant: string;
  /**
   * Wo die Liste steht. Auf dem Kundenblatt ist der Bezug Lead und
   * Ansprechpartner, auf dem Kontaktblatt nur der Lead, in der
   * Aktivitätsliste (`/crm/aktivitaet`) auch der Kunde.
   */
  readonly blatt: 'kunde' | 'kontakt' | 'liste';
  readonly darfNamen: boolean;
  readonly darfNachrichten: boolean;
  readonly grenze: number;
}) {
  const t = nachSprache(VERLAUF_TEXTE, sprache);

  return (
    <div data-cse="kommunikationsverlauf" data-blatt={blatt}>
      {eintraege.length === 0 ? (
        <p className="mt-s3 text-sm text-text-muted" data-cse="verlauf-leer">{t.leer}</p>
      ) : (
        <DataTable
          beschriftung={blatt === 'kunde' ? t.beschriftungKunde
            : blatt === 'kontakt' ? t.beschriftungKontakt : t.beschriftungListe}
          zeilen={eintraege}
          schluessel={(e) => `${e.quelle}-${e.id}`}
          spalten={[
            { schluessel: 'wann', kopf: t.spalteWann, zelle: (e) => (
              <span className="text-sm text-text tabular-nums">{e.zeitpunkt}</span>
            ) },
            { schluessel: 'was', kopf: t.spalteWas, zelle: (e) => (
              <div data-cse="verlauf-eintrag" data-quelle={e.quelle} data-art={e.art}>
                <p className={LEISE}>{aus(t, t.arten, e.art)}</p>
                {e.betreff === null ? null : <p className={ZEILE_TEXT}>{e.betreff}</p>}
                {e.inhalt === null || e.inhalt === e.betreff ? null : (
                  <p className={`${LEISE} whitespace-pre-line`}>{e.inhalt}</p>
                )}
                {e.faellig === null ? null : (
                  <p className={LEISE}>
                    {`${t.faellig(e.faellig)} · ${e.erledigt ? t.erledigt : t.offen}`}
                  </p>
                )}
              </div>
            ) },
            { schluessel: 'weg', kopf: t.spalteWeg, zelle: (e) => <Weg e={e} t={t} /> },
            { schluessel: 'bezug', kopf: t.spalteBezug, zelle: (e) => {
              const lead = e.leadId === null || e.leadnummer === null ? null : (
                <Link href={`/portal/${mandant}/crm/leads/${e.leadId}`} className={VERWEIS}>
                  {t.lead(e.leadnummer)}
                </Link>
              );
              const kontakt = blatt === 'kontakt' || e.ansprechpartnerId === null
                || e.ansprechpartner === null ? null : (
                  <Link href={`/portal/${mandant}/crm/kontakte/${e.ansprechpartnerId}`}
                        className={VERWEIS}>
                    {e.ansprechpartner}
                  </Link>
                );
              const kunde = blatt !== 'liste' || e.kundeId === null || e.kunde === null ? null : (
                <Link href={`/portal/${mandant}/crm/kunden/${e.kundeId}`} className={VERWEIS}>
                  {e.kunde}
                </Link>
              );
              if (lead === null && kontakt === null && kunde === null) {
                return <span className="text-text-subtle">{t.unbekannt}</span>;
              }
              return (
                <span className="flex flex-col gap-s1 text-sm">
                  {kunde}
                  {lead}
                  {kontakt}
                </span>
              );
            } },
            { schluessel: 'wer', kopf: t.spalteWer, zelle: (e) => (
              e.wer ?? (
                <span className="text-text-subtle" data-cse="verlauf-wer-leer">
                  {darfNamen ? t.system : t.unbekannt}
                </span>
              )
            ) },
            { schluessel: 'beleg', kopf: t.spalteBeleg, zelle: (e) => <Beleg e={e} t={t} /> },
          ]}
        />
      )}
      {eintraege.length >= grenze ? (
        <p className="mt-s3 text-xs text-text-muted">{t.jungste(grenze)}</p>
      ) : null}
      {darfNamen ? null : (
        <p className="mt-s3 max-w-prose text-xs text-text-muted" data-cse="verlauf-namen-verdeckt">
          {t.namenVerdeckt} <Recht schluessel="system.benutzer_lesen" sprache={sprache} />.
        </p>
      )}
      {darfNachrichten ? null : (
        <p className="mt-s3 max-w-prose text-xs text-text-muted"
           data-cse="verlauf-nachrichten-verdeckt">
          {t.nachrichtenVerdeckt} <Recht schluessel="nachricht.lesen" sprache={sprache} />.
        </p>
      )}
    </div>
  );
}

/**
 * Das Formular „Festhalten" — am Kunden oder am Ansprechpartner.
 *
 * Kein JavaScript: die Richtung gilt nur für Anruf, E-Mail und Termin, und
 * das sagt der Dienst (`planeNotiz`), nicht ein ausgeblendetes Feld. Wer eine
 * Notiz „ausgehend" schickt, bekommt eine interne Notiz — dieselbe Regel wie
 * auf dem Leadblatt.
 */
export function NotizFormular({
  sprache, zurueck, kundeId, ansprechpartnerId, kontakte,
}: {
  readonly sprache: PortalSprache | null;
  readonly zurueck: string;
  readonly kundeId: string | null;
  /** Auf dem Kontaktblatt fest; auf dem Kundenblatt wählt man aus `kontakte`. */
  readonly ansprechpartnerId: string | null;
  readonly kontakte: readonly { readonly id: string; readonly name: string }[];
}) {
  const t = nachSprache(VERLAUF_TEXTE, sprache);
  return (
    <form method="post" action="/api/crm/notiz" data-cse="notiz-formular"
          className="mt-s5 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
      {kundeId === null ? null : <input type="hidden" name="kundeId" value={kundeId} />}
      {ansprechpartnerId === null ? null : (
        <input type="hidden" name="ansprechpartnerId" value={ansprechpartnerId} />
      )}
      <input type="hidden" name="zurueck" value={zurueck} />
      <h3 className="m-0 text-base text-text">{t.notizTitel}</h3>
      <p className="m-0 text-sm text-text-muted">{t.notizErklaerung}</p>

      <div className="flex flex-wrap gap-s4">
        <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
          {t.notizArt}
          <select name="art" defaultValue="notiz" className={FELD} data-cse="notiz-art">
            {['notiz', 'anruf', 'email', 'termin'].map((w) => (
              <option key={w} value={w}>{t.notizArten[w] ?? w}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
          {t.notizRichtung}
          <select name="richtung" defaultValue="intern" className={FELD}
                  data-cse="notiz-richtung">
            {['intern', 'eingehend', 'ausgehend'].map((w) => (
              <option key={w} value={w}>{t.richtungen[w] ?? w}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
          {t.notizZweck}
          <select name="zweck" defaultValue="vertraglich" className={FELD}
                  data-cse="notiz-zweck">
            {['vertraglich', 'transaktional', 'werbung'].map((w) => (
              <option key={w} value={w}>{t.zwecke[w] ?? w}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="m-0 text-xs text-text-muted">{t.notizZweckErklaerung}</p>

      {ansprechpartnerId === null && kontakte.length > 0 ? (
        <label className="flex flex-col gap-s2 text-sm text-text">
          {t.notizAnsprechpartner}
          <select name="ansprechpartnerId" defaultValue="" className={FELD}
                  data-cse="notiz-ansprechpartner">
            <option value="">{t.notizOhneAnsprechpartner}</option>
            {kontakte.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.notizBetreff}
        <input name="betreff" maxLength={200} className={FELD} data-cse="notiz-betreff" />
        <span className="text-xs text-text-muted">{t.notizBetreffErklaerung}</span>
      </label>
      <label className="flex flex-col gap-s2 text-sm text-text">
        {t.notizInhalt}
        <textarea name="inhalt" rows={3} required maxLength={4000} className={FELD}
                  data-cse="notiz-inhalt" />
      </label>
      <div>
        <Button type="submit" variante="primary" data-cse="notiz-speichern">
          {t.notizSpeichern}
        </Button>
      </div>
    </form>
  );
}

/**
 * Die Rückmeldung von `POST /api/crm/notiz` — `?notiz=<grund>` oder
 * `?notiert=1` (D-599). Jeder Grund hat einen Satz in beiden Sprachen; ein
 * unbekannter fällt auf „Nicht festgehalten." zurück, nie auf den Schlüssel.
 */
export function NotizRueckmeldung({ sprache, grund, notiert }: {
  readonly sprache: PortalSprache | null;
  readonly grund: string | null;
  readonly notiert: boolean;
}) {
  const t = nachSprache(VERLAUF_TEXTE, sprache);
  if (grund !== null) {
    return (
      <Hinweis art="warnung" cse="notiz-fehler" className="mt-s4 max-w-prose">
        <strong>{t.nichtGespeichert}</strong> {t.notizFehler[grund] ?? ''}
      </Hinweis>
    );
  }
  if (notiert) {
    return (
      <Hinweis art="erfolg" cse="notiz-erfolg" className="mt-s4 max-w-prose">
        {t.notiert}
      </Hinweis>
    );
  }
  return null;
}
