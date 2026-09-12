/**
 * `POST /api/jobs/<schluessel>` — der EINE Weg, auf dem ein Nachtlauf in
 * Produktion startet (SPEC §14).
 *
 * **Warum eine Route und kein Server-Start-Hook.** Vercel-Funktionen leben
 * pro Anfrage; ein `setInterval` im Modulkoerper laeuft dort nie zuverlaessig
 * und in der Entwicklung mehrfach. Der Ausloeser gehoert deshalb nach
 * draussen — Supabase cron oder Vercel cron ruft diese Adresse, und der
 * Zeitplan, der im Job steht (`zeitplan`), ist die Quelle, gegen die der
 * externe Eintrag geprueft wird. `GET /api/jobs/<schluessel>` gibt ihn aus,
 * damit sich beides vergleichen laesst, statt es zu glauben.
 *
 * **Ohne Geheimnis laeuft hier nichts.** Ist `JOB_TOKEN` nicht gesetzt,
 * antwortet die Route 503 und sagt, dass der Ausloeser nicht verbunden ist —
 * sie laeuft nicht ersatzweise offen. Eine offene Adresse, die den
 * Dienstplan von acht Wochen neu materialisiert, ist keine Bequemlichkeit,
 * sondern ein Schalter fuer jeden, der die URL kennt.
 *
 * **Idempotent je Tag.** Der Schluessel ist `<job>:<Berliner Datum>`; zwei
 * Ausloeser derselben Nacht ergeben einen Lauf. Das Fenster gehoert dabei
 * nicht dieser Datei, sondern `job_lauf` und seinem eindeutigen Index — wer
 * als Zweiter kommt, bekommt `uebersprungen: true` und keine zweite Arbeit.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { alleJobs } from '@/server/jobs/bootstrap';
import { finde } from '@/server/jobs/registry';
import { fuehreAus } from '@/server/jobs/runner';
import { PostgresProtokoll } from '@/server/jobs/postgres-protokoll';
import { ProtokollAlarm } from '@/server/jobs/alarm';

export const dynamic = 'force-dynamic';

/**
 * Vergleich in konstanter Zeit.
 *
 * `a === b` bricht beim ersten abweichenden Zeichen ab, und der Unterschied
 * ist messbar. Bei einem Geheimnis, das eine Maschine beliebig oft raten
 * darf, ist das keine Theorie.
 */
function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // `timingSafeEqual` wirft bei ungleicher Laenge — die Laenge selbst ist
  // kein Geheimnis, also wird sie vorher geprueft.
  return x.length === y.length && timingSafeEqual(x, y);
}

function abgewiesen(anfrage: NextRequest): NextResponse | null {
  const erwartet = process.env['JOB_TOKEN'] ?? '';
  if (erwartet === '') {
    return NextResponse.json(
      {
        fehler: 'nicht_verbunden',
        hinweis: 'JOB_TOKEN ist nicht gesetzt. Ohne Geheimnis wird hier kein Lauf '
          + 'ausgeloest — auch nicht ersatzweise offen.',
      },
      { status: 503 },
    );
  }
  const mitgegeben = anfrage.headers.get('x-job-token')
    ?? (anfrage.headers.get('authorization') ?? '').replace(/^Bearer\s+/iu, '');
  if (!gleich(mitgegeben, erwartet)) {
    // AUT-06: ein falsches Geheimnis erfaehrt nicht, dass es den Job gibt.
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  return null;
}

export async function POST(
  anfrage: NextRequest,
  { params }: { params: Promise<{ schluessel: string }> },
): Promise<NextResponse> {
  const verweigert = abgewiesen(anfrage);
  if (verweigert !== null) return verweigert;

  const sql = db();
  alleJobs(sql);
  const { schluessel } = await params;
  const job = finde(schluessel);
  if (job === undefined) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const [tag] = (await sql.unsafe(
    `select (now() at time zone 'Europe/Berlin')::date::text as tag`,
  )) as unknown as readonly { tag: string }[];

  /**
   * Bei `je_mandant`: ALLE aktiven Gesellschaften, und zwar aus der
   * Datenbank.
   *
   * Eine Liste im Code waere die stille Variante — eine fuenfte Gesellschaft
   * entstuende, und ihr Dienstplan bliebe leer, ohne dass irgendwo etwas
   * rot wird.
   */
  const mandanten = job.bereich === 'je_mandant'
    ? ((await sql.unsafe(
      `select id from mandant where aktiv = true order by schluessel`,
    )) as unknown as readonly { id: string }[]).map((m) => m.id)
    : [];

  const ergebnis = await fuehreAus(job, new PostgresProtokoll(sql), new ProtokollAlarm(), {
    idempotenzSchluessel: `${job.schluessel}:${tag!.tag}`,
    mandanten,
  });

  // 200 auch bei `fehler`: der Lauf HAT stattgefunden, und sein Ergebnis
  // steht in `job_lauf`. Ein 500 hier liesse den externen Ausloeser
  // wiederholen — und genau das soll die Idempotenz verhindern, nicht
  // ausloesen.
  return NextResponse.json({ job: job.schluessel, tag: tag!.tag, ...ergebnis });
}

/** Was der externe Zeitplan eintragen muss — zum Vergleichen, nicht zum Raten. */
export async function GET(
  anfrage: NextRequest,
  { params }: { params: Promise<{ schluessel: string }> },
): Promise<NextResponse> {
  const verweigert = abgewiesen(anfrage);
  if (verweigert !== null) return verweigert;

  alleJobs(db());
  const { schluessel } = await params;
  const job = finde(schluessel);
  if (job === undefined) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  return NextResponse.json({
    schluessel: job.schluessel,
    bezeichnung: job.bezeichnung,
    zeitplan: job.zeitplan,
    bereich: job.bereich,
    versuche: job.versuche,
  });
}
