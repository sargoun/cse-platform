import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/security/veranstaltungen/[id]/besetzung` — das Brett der
 * kurzfristigen Besetzung (SEC-08, SEC-04, TIM-05).
 *
 * **Es gibt hier keinen zweiten Einteilungsweg.** Das Formular schickt an
 * `POST /api/sicherheit/event-besetzung`, und der Dienst dahinter ruft
 * `besetzeEinsatz` — denselben Weg, den der Dienstplan geht, mit dem
 * § 34a-Tor und der Arbeitszeitprüfung davor. Ein eigenes „schnell besetzen"
 * wäre genau der Umgehungsweg, den SEC-04 verbietet.
 *
 * **Die Liste zeigt, wer BESCHÄFTIGT ist — nicht, wer qualifiziert ist.** Die
 * Qualifikation entscheidet der Dienst beim Speichern, an der Person und am
 * SCHICHTDATUM. Sie hier vorzusortieren hiesse, dieselbe Regel ein zweites Mal
 * zu schreiben; und die zweite Fassung wäre die, die nach der nächsten
 * Änderung falsch liegt.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly bezeichnung: string;
  readonly anlass: string | null;
  readonly kunde: string;
  readonly ort: string;
  readonly hat_objekt: boolean;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly soll_besetzung: number;
}

interface Kandidat {
  readonly id: string;
  readonly name: string;
  readonly personalnummer: string;
  readonly eingeteilt: boolean;
}

export default async function Besetzungsbrett(
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
  const pfad = `/portal/${mandant}/security/veranstaltungen/${id}/besetzung`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'security.lesen', 'dienstplan.lesen', 'dienstplan.arbzg_lesen');
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const [kopf] = await kontext.abfrage<Kopf>(
          `select v.id, v.bezeichnung, v.anlass, k.name as kunde,
                  coalesce(o.bezeichnung, v.veranstaltungsort_text) as ort,
                  (v.objekt_id is not null) as hat_objekt,
                  to_char(v.beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                    as beginn_lokal,
                  to_char(v.ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                    as ende_lokal,
                  v.soll_besetzung
             from veranstaltung v
             join kunde k on k.id = v.kunde_id and k.mandant_id = v.mandant_id
             left join objekt o on o.id = v.objekt_id and o.mandant_id = v.mandant_id
            where v.id = $1::uuid`,
          [id],
        );
        if (kopf === undefined) return null;

        /**
         * Die Beschäftigten dieser Gesellschaft, mit der Auskunft, wer auf
         * DIESER Veranstaltung schon eingeteilt ist. `left join` über die
         * Schicht: die Schicht entsteht erst beim ersten Besetzen, und ohne
         * sie ist die Liste trotzdem vollständig.
         */
        const kandidaten = await kontext.abfrage<Kandidat>(
          `select a.id, (p.vorname || ' ' || p.nachname) as name, a.personalnummer,
                  exists (select 1
                            from einsatz_zuordnung z
                            join einsatz e on e.id = z.einsatz_id
                           where e.veranstaltung_id = $1::uuid
                             and e.storniert_am is null
                             and z.anstellung_id = a.id
                             and z.entfernt_am is null
                             and z.status <> 'abgesagt') as eingeteilt
             from anstellung a
             join person p on p.id = a.person_id
            where a.geloescht_am is null and a.status = 'aktiv'
            order by p.nachname, p.vorname`,
          [id],
        );
        return { kopf, kandidaten };
      })) as Promise<{ kopf: Kopf; kandidaten: readonly Kandidat[] } | null>);

  if (daten === null) notFound();
  const { kopf, kandidaten } = daten;
  const eingeteilt = kandidaten.filter((k) => k.eingeteilt);
  const frei = kandidaten.filter((k) => !k.eingeteilt);

  const erzeugt = typeof suche['erzeugt'] === 'string' ? Number(suche['erzeugt']) : null;
  const offen = typeof suche['offen'] === 'string' ? Number(suche['offen']) : null;

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        {/*
          * Die Liste dahinter verlangt laut Manifest `security.lesen`; dieses
          * Brett nur `dienstplan.schreiben`. Wer besetzen darf, darf die
          * Veranstaltungen nicht zwangsläufig sehen — der Verweis führte dann
          * auf 404 und verriete, was er nicht zeigen darf (AUT-06;
          * Copilot-Runde auf PR 16 / D-581).
          */}
        {darf['security.lesen'] === true && (
          <Link
            href={`/portal/${mandant}/security/veranstaltungen`}
            className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted
                       hover:border-line-strong hover:text-text"
          >
            Zu den Veranstaltungen
          </Link>
        )}
      </div>

      <p className="mb-s5 text-sm text-text-muted">
        {kopf.kunde}
        {' · '}
        {kopf.ort}
        {kopf.anlass !== null && ` · ${kopf.anlass}`}
        {' · '}
        <span className="tabular-nums">{kopf.beginn_lokal} – {kopf.ende_lokal}</span>
        {' · '}
        <span className="tabular-nums">
          {eingeteilt.length} von {kopf.soll_besetzung} besetzt
        </span>
      </p>

      {erzeugt !== null && (
        <p
          data-cse="besetzungsergebnis"
          className="mb-s5 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
        >
          {erzeugt} Einteilung(en) geschrieben
          {offen !== null && offen > 0
            && `, ${String(offen)} nicht — fehlender Nachweis, Arbeitszeitbefund oder `
              + 'bereits eingeteilt. Die Gründe stehen im Konflikteingang.'}
          {/*
            * `/dienstplan/konflikte` verlangt laut Manifest `dienstplan.lesen`
            * UND `dienstplan.arbzg_lesen`; dieses Brett nur
            * `dienstplan.schreiben`. Ohne beide führte der Verweis auf 404 und
            * verriete, was er nicht zeigen darf (AUT-06; Copilot-Runde auf
            * PR 16 / D-581). Der Satz davor steht auch ohne ihn.
            */}
          {darf['dienstplan.lesen'] === true && darf['dienstplan.arbzg_lesen'] === true && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/dienstplan/konflikte`}
                className="text-text underline-offset-2 hover:text-brand hover:underline"
              >
                Zum Konflikteingang
              </Link>
            </>
          )}
        </p>
      )}

      {!kopf.hat_objekt ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-warning">
          Der Veranstaltungsort ist nur als Text erfasst. Eine Schicht hängt
          immer an einem Objekt — bitte den Ort als Objekt anlegen und der
          Veranstaltung zuordnen, dann lässt sich besetzen.
        </p>
      ) : (
        <form
          action="/api/sicherheit/event-besetzung"
          method="post"
          className="rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="veranstaltung" value={kopf.id} />

          <h2 className="mb-s2 text-h3 text-text">Wachen einteilen</h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Jede Zuweisung läuft durch das § 34a-Tor und die Arbeitszeitprüfung.
            Wer ohne gültigen Nachweis ausgewählt wird, wird nicht eingeteilt —
            daran führt hier kein Weg vorbei.
          </p>

          {frei.length === 0 ? (
            <p className="m-0 text-sm text-text-muted">
              Alle Beschäftigten dieser Gesellschaft sind bereits eingeteilt.
            </p>
          ) : (
            <ul className="m-0 mb-s4 list-none p-0">
              {frei.map((k) => (
                <li key={k.id} className="mb-s2">
                  <label className="flex items-center gap-s3 text-sm text-text">
                    <input
                      type="checkbox"
                      name="anstellung"
                      value={k.id}
                      className="min-h-6 min-w-6"
                    />
                    {k.name}
                    <span className="tabular-nums text-text-muted">{k.personalnummer}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <label className="mb-s5 flex items-start gap-s3 text-sm text-text-muted">
            <input type="checkbox" name="bestaetigt" value="1" className="min-h-6 min-w-6" />
            <span>
              Arbeitszeitbefunde sind mir bekannt und ich teile trotzdem ein.
              Der Verstoss wird mit dem Konflikt aufgezeichnet und muss im
              Eingang mit Begründung quittiert werden. Ein fehlender
              § 34a-Nachweis lässt sich damit <strong>nicht</strong> übergehen.
            </span>
          </label>

          <Button type="submit" variante="primary">Einteilen</Button>
        </form>
      )}

      {eingeteilt.length > 0 && (
        <section className="mt-s6">
          <h2 className="mb-s2 text-h3 text-text">Eingeteilt</h2>
          <ul className="m-0 list-none p-0">
            {eingeteilt.map((k) => (
              <li
                key={k.id}
                data-cse="eingeteilt"
                className="mb-s2 border-b border-line pb-s2 text-sm text-text last:border-0"
              >
                {k.name}
                {' · '}
                <span className="tabular-nums text-text-muted">{k.personalnummer}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalRahmen>
  );
}
