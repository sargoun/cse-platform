import type postgres from 'postgres';
import { Geraetezeit } from '@/app/portal/mein/Geraetezeit';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  EREIGNIS_TEXT, SCHLUESSEL_EREIGNISSE, ZUSTAND_TEXT,
  findeSchluessel, leseQuittungen,
  type QuittungZeile, type SchluesselZeile,
} from '@/server/services/security/schluessel';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Hinweis } from '@/components/ui/Hinweis';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { QUITTUNG_WACHBUCH_TEXTE } from '@/lib/i18n/verwaltung/wachbuch';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/security/schluessel/[id]/quittung` — die Übergabe mit
 * Unterschrift (SEC-07, TIM-08, Abnahme 3).
 *
 * **Kein Zeitfeld.** Wann quittiert wurde, entscheidet die SERVERUHR
 * (Invariante 5, TIM-08) — ein Formularfeld dafür wäre die Einladung, es
 * anders auszufüllen, und der Auslöser überschriebe es ohnehin. Die Geräteuhr
 * wandert als verstecktes Feld mit, damit ihre Abweichung gespeichert werden
 * kann; massgeblich ist sie nie.
 *
 * **Beide Beteiligten stehen auf der Quittung** (Abnahme 3): der Empfänger als
 * Name und — wo es eine Beschäftigung ist — als `anstellung_id`, und der
 * Übergebende als der angemeldete Mensch, den der Dienst aus der Sitzung
 * aufnimmt. Ein Feld „übergeben von" gibt es deshalb nicht: wer übergibt, ist
 * nicht die Antwort des Formulars.
 *
 * **Der Empfänger hängt an der BESCHÄFTIGUNG, nicht am Menschen** (D-09,
 * review B8). Eine Quittung ist keine Tatsache über eine Person, sondern
 * betrieblicher Nachweis EINER Gesellschaft über EIN Objekt — mit
 * Haftungsfolgen für genau diese GmbH.
 *
 * **Die Unterschrift ist heute ein Name.** Das Bild vom Bildschirm braucht
 * `POST /api/dokumente/upload-ticket` und eine Zeile im geschlossenen Register
 * `einsatz_medien_bezug`; beides gibt es für `schluessel_quittung` nicht, und
 * das steht hier, statt eine Unterschriftsfläche zu zeigen, die nichts
 * speichert (D-232).
 */
export const dynamic = 'force-dynamic';

interface Wahlzeile { readonly id: string; readonly name: string }

export default async function Quittung(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/security/schluessel/${id}/quittung`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'schluessel.lesen', 'wachbuch.schreiben');
  const tQ = nachSprache(QUITTUNG_WACHBUCH_TEXTE, zugang.sprache);
  /* D-599/D-728: der Grund einer Abweisung nur als EIGENER Eintrag. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(tQ.fehler, suche['fehler']) ?? tQ.fehlerUnbekannt) : null;
  if (sitzung.aktiverMandantId === null) notFound();

  const { schluessel, quittungen, anstellungen, kunden } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        schluessel: await findeSchluessel(kontext, id),
        quittungen: await leseQuittungen(kontext, id),
        anstellungen: await kontext.abfrage<Wahlzeile>(
          `select a.id, (p.vorname || ' ' || p.nachname) as name
             from anstellung a
             join person p on p.id = a.person_id
            where a.geloescht_am is null and a.status = 'aktiv'
            order by p.nachname, p.vorname`,
        ),
        kunden: await kontext.abfrage<Wahlzeile>(
          `select id, name from kunde where archiviert_am is null order by name`,
        ),
      }))) as Promise<{
        schluessel: SchluesselZeile | null;
        quittungen: readonly QuittungZeile[];
        anstellungen: readonly Wahlzeile[];
        kunden: readonly Wahlzeile[];
      }>);

  if (schluessel === null) notFound();

  const offeneAusgabe = quittungen.find((q) => q.offen) ?? null;
  const sperrungen = quittungen.filter((q) => q.art === 'sperrung');
  const vorschlag = suche['art'];
  /**
   * Die Vorauswahl folgt dem ZUSTAND und nicht der Gewohnheit: ist der
   * Schlüssel draussen, ist die Rücknahme der wahrscheinliche Vorgang — und
   * eine zweite Ausgabe weist die Datenbank ohnehin ab
   * (`sq_offene_ausgabe_uk`, Abnahme 4).
   */
  const vorgewaehlt = typeof vorschlag === 'string' ? vorschlag
    : (offeneAusgabe !== null ? 'ruecknahme' : 'ausgabe');

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      {...(darf['schluessel.lesen'] === true ? { zurueck: { ziel: `/portal/${mandant}/security/schluessel/${id}`, text: schluessel.bezeichnung } } : {})}
      titel="Schlüsselquittung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="schluessel"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {/*
        * Das Schlüsselblatt dahinter verlangt laut Manifest `schluessel.lesen`;
        * diese Seite nur `schluessel.schreiben`. Wer quittieren darf, darf das
        * Journal nicht zwangsläufig lesen — der Rückverweis führte dann auf 404
        * und verriete, was er nicht zeigen darf (AUT-06; Copilot-Runde auf
        * PR 16 / D-581).
        */}

      <h1 className="mb-s2 text-h1 text-text">Schlüsselquittung</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {schluessel.bezeichnung} · {schluessel.objekt} ·{' '}
        {ZUSTAND_TEXT[schluessel.status]}
        {schluessel.besitzer !== null && ` · bei ${schluessel.besitzer}`}
        <br />
        Der Zeitpunkt kommt vom Server und lässt sich nicht eintragen. Die
        Quittung ist danach unveränderlich — richtiggestellt wird sie durch
        eine Gegenquittung, nie durch Überschreiben.
      </p>

      {offeneAusgabe !== null && (
        <p
          className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-sm text-warning"
          data-cse="offene-ausgabe"
        >
          Dieser Schlüssel ist seit {offeneAusgabe.quittiertLokal} ausgegeben
          {offeneAusgabe.empfaengerName === null
            ? '' : ` an ${offeneAusgabe.empfaengerName}`}
          . Eine zweite Übergabe ohne Rücknahme weist die Datenbank ab — ein
          Schlüssel kann nicht an zwei Orten sein.
        </p>
      )}

      {fehler !== null && (
        <Hinweis art="warnung" cse="quittung-abgewiesen" rolle="alert"
                 className="mb-s5 max-w-prose">
          <strong>{tQ.abgewiesen}</strong>{' '}
          {fehler}
        </Hinweis>
      )}

      <form
        action={`/api/sicherheit/schluessel/${id}/quittung`}
        method="post"
        data-cse="quittung-formular"
        className="max-w-prose rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="zurueck_fehler" value={pfad} />
        <input
          type="hidden" name="zurueck"
          value={`/portal/${mandant}/security/schluessel/${id}`}
        />

        {/*
          * Die Gerätezeit (V-060, TIM-08). `api/sicherheit/schluessel/[id]/quittung`
          * nimmt sie seit je entgegen — dieses Formular schickte keine, und die
          * Abweichung stand damit auf jeder Quittung auf „—". Massgeblich ist
          * `erfasst_am` aus der Serveruhr; diese Zahl steht daneben, damit eine
          * falsch gehende Uhr auffällt statt unsichtbar zu bleiben.
          */}
        <Geraetezeit marke="geraetezeit" />

        <label className="mb-s4 block">
          <span className={feld}>Vorgang</span>
          <select name="art" required className={eingabe} defaultValue={vorgewaehlt}>
            {SCHLUESSEL_EREIGNISSE.map((e) => (
              <option key={e} value={e}>{EREIGNIS_TEXT[e]}</option>
            ))}
          </select>
        </label>

        <fieldset className="mb-s4 border-0 p-0">
          <legend className={feld}>Empfänger (bei Übergabe und Rücknahme)</legend>
          <label className="mb-s3 block">
            <span className={feld}>Art</span>
            <select name="empfaenger_art" className={eingabe} defaultValue="mitarbeiter">
              <option value="">— keiner (Verlust, Sperrung, Inventur …) —</option>
              <option value="mitarbeiter">Mitarbeitende</option>
              <option value="kunde">Kunde</option>
              <option value="fremdfirma">Fremdfirma</option>
            </select>
          </label>
          <label className="mb-s3 block">
            <span className={feld}>Beschäftigung</span>
            <select name="anstellung" className={eingabe}>
              <option value="">— keine —</option>
              {anstellungen.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {kunden.length > 0 && (
            <label className="mb-s3 block">
              <span className={feld}>Kunde</span>
              <select name="kunde" className={eingabe}>
                <option value="">— keiner —</option>
                {kunden.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="mb-s3 block">
            <span className={feld}>Name auf der Quittung</span>
            <input
              name="empfaenger_name" maxLength={160} className={eingabe}
              placeholder="Fatima Yildiz"
            />
          </label>
        </fieldset>

        <label className="mb-s4 block">
          <span className={feld}>Unterschrift — Name in Druckbuchstaben</span>
          <input
            name="unterzeichner" maxLength={160} className={eingabe}
            placeholder="Fatima Yildiz"
          />
          <span className="mt-s1 block text-sm text-text-subtle" data-cse="signatur-hinweis">
            Unterschriftsbild: nicht verbunden. Der Uploadweg für
            Schlüsselquittungen ist nicht gebaut (D-232) — bis dahin ist die
            Quittung der Name plus die Serverzeit.
          </span>
        </label>

        <label className="mb-s4 block">
          <span className={feld}>Rückgabe zugesagt für</span>
          <input name="geplante_rueckgabe" type="date" className={eingabe} />
        </label>

        {sperrungen.length > 0 && (
          <label className="mb-s4 block">
            <span className={feld}>Hebt diese Sperrung auf (nur bei Entsperrung)</span>
            <select name="aufhebt" className={eingabe}>
              <option value="">— keine —</option>
              {sperrungen.map((s) => (
                <option key={s.id} value={s.id}>
                  Sperrung vom {s.quittiertLokal}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="mb-s5 block">
          <span className={feld}>Bemerkung</span>
          <textarea
            name="bemerkung" rows={3}
            className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2
                       text-sm text-text"
          />
        </label>

        {/*
          * **Nachgetragen** (V-078, TIM-09).
          *
          * `schluessel_ereignis.nachgetragen` steht seit `0070` da, der
          * Dienst nimmt es entgegen, die Route reicht es durch — geschickt
          * hat es nie ein Formular. Eine Schlüsselübergabe am Tor um 05:50
          * wird selten am Tor getippt; wer sie um 14:00 einträgt, soll das
          * sagen können, ohne die Uhrzeit zu fälschen.
          *
          * **Keine Uhrabweichung:** die misst die Gerätezeit daneben. Dieses
          * Häkchen ist die Aussage eines Menschen über den Vorgang, nicht über
          * sein Telefon.
          */}
        <label className="mb-s5 flex min-h-11 items-start gap-s3 text-sm text-text">
          <input type="checkbox" name="nachgetragen" value="1" className="mt-s1"
                 data-cse="quittung-nachgetragen" />
          <span>
            Nachgetragen
            <span className="mt-s1 block text-xs text-text-muted">
              Der Vorgang ist früher geschehen und wird jetzt erst eingetippt.
              Die Zeit der Quittung bleibt die des Servers; dieses Häkchen sagt
              nur, dass sie nicht die Zeit der Übergabe ist.
            </span>
          </span>
        </label>

        {/*
          * V-180 (SEC-05 „key"): dieselbe Bewegung als Seite im Wachbuch des
          * Objekts. Angeboten nur, wer das Buch führen darf; vorausgewählt,
          * weil eine Schlüsselübergabe am Objekt dorthin gehört — abwählbar,
          * weil der Urheber einer Seite eine Beschäftigung in dieser
          * Gesellschaft sein muss.
          */}
        {darf['wachbuch.schreiben'] === true && (
          <label className="mb-s5 flex min-h-11 items-start gap-s3 text-sm text-text">
            <input type="checkbox" name="im_wachbuch" value="1" defaultChecked
                   className="mt-s1" data-cse="quittung-im-wachbuch" />
            <span>
              {tQ.imWachbuch}
              <span className="mt-s1 block text-xs text-text-muted">
                {tQ.imWachbuchHinweis}
              </span>
            </span>
          </label>
        )}

        <Button type="submit" variante="primary">Quittung schreiben</Button>
      </form>
    </PortalRahmen>
  );
}
