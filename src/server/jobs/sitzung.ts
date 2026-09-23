/**
 * Die Sitzung eines Nachtlaufs — der Teil, den jeder `je_mandant`-Job braucht
 * und den bisher keiner hatte.
 *
 * **Der Befund.** `pruefeKette` (FIN-06, LEG-01) filtert ueber
 * `app.aktiver_mandant()`. Ein Job hat keinen: `JobKontext` reicht eine
 * `mandantId` durch, aber niemand macht daraus eine Sitzungsvariable. Den
 * Pruefer ohne diesen Binder zu registrieren hiesse, jede Nacht null
 * Rechnungen zu pruefen und „ok" zu melden — schlimmer als kein Pruefer,
 * weil eine gruene Meldung Vertrauen schafft, das sie nicht deckt.
 *
 * **Und der zweite Befund, der beim Bauen auffiel.** Im ganzen Baum steht
 * kein einziges `set local role cse_job`. Die Kommentare sagen seit 0012 an
 * vielen Stellen „der Job verbindet sich als `cse_job`" — nichts machte das
 * wahr. Die Laeufe liefen unter der Rolle, die in `DATABASE_URL` steht, und
 * das ist in CI und im Seed `postgres`, also Superuser mit `BYPASSRLS`. Jede
 * Spaltenbeschraenkung und jede Policy, die seit 0012 fuer `cse_job`
 * geschrieben wurde — 0041, 0075, 0077, 0099, 0100, 0101 —, war damit
 * ungeprueft: sie wurde nie durchlaufen, weder in Produktion noch in einem
 * Test, der den echten Weg nimmt.
 *
 * Hier steht die Rolle deshalb ausdruecklich, und der Kettenpruefer ist der
 * erste Lauf, der sie wirklich traegt. Die anderen drei Jobs bleiben vorerst
 * ohne — sie umzustellen heisst, fuer jeden von ihnen Rechte und Policies
 * nachzuziehen, und das ist eine eigene Runde mit eigenen Tests. Was hier
 * NICHT passiert, steht in `bootstrap.ts` und in D-378, damit es niemand fuer
 * erledigt haelt.
 *
 * **Lesen heisst lesen.** `app.readonly = 'on'`: ein Pruefer, der schreiben
 * koennte, koennte auch reparieren — und eine Kette, die sich selbst
 * repariert, bezeugt nichts mehr.
 */

/** Methodensyntax, nicht Eigenschaftssyntax — siehe `bootstrap.ts`. */
export interface JobTransaktion {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface JobVerbindung {
  begin<T>(rueckruf: (tx: JobTransaktion) => Promise<T>): Promise<T>;
}

/** Was ein Dienst bekommt, der in einer gebundenen Jobsitzung laeuft. */
export interface JobAbfrage {
  abfrage<T>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface BinderOptionen {
  /**
   * Vorgabe `true`. Auf `false` nur, wo ein Lauf nachweislich schreiben muss
   * — und dann steht neben dem Aufruf, was er schreibt.
   */
  readonly nurLesen?: boolean;
}

/**
 * Fuehrt `fn` in einer Transaktion aus, in der die Mandantenwand steht.
 *
 * Transaktionslokal (`set_config(..., true)`): die Variablen enden mit der
 * Transaktion und koennen nicht in den naechsten Mandanten der Schleife
 * durchsickern. Genau das ist bei einem Lauf ueber alle Gesellschaften der
 * Fehler, der am teuersten waere.
 */
export async function alsJobSitzung<T>(
  sql: JobVerbindung,
  mandantId: string,
  fn: (db: JobAbfrage) => Promise<T>,
  optionen: BinderOptionen = {},
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/iu.test(mandantId)) {
    throw new Error(
      `alsJobSitzung: "${mandantId}" ist keine Mandantenkennung. `
      + 'Ohne gebundenen Mandanten liest der Lauf null Zeilen und meldet "ok".',
    );
  }
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_job`);
    const setze = async (name: string, wert: string): Promise<void> => {
      await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
    };
    await setze('app.scope', 'mandant');
    await setze('app.mandant_id', mandantId);
    await setze('app.mandant_ids', mandantId);
    /*
     * Kein Benutzer und keine Person: ein Nachtlauf ist keiner. Die beiden
     * leer zu lassen ist die ehrliche Angabe — `app.aktueller_benutzer()`
     * gibt dann NULL, und das Protokoll traegt `akteur_typ = 'system'`
     * (0004:132), was genau stimmt.
     */
    await setze('app.benutzer_id', '');
    await setze('app.person_id', '');
    await setze('app.portal', 'intern');
    await setze('app.akteur_typ', 'system');
    await setze('app.readonly', (optionen.nurLesen ?? true) ? 'on' : 'off');
    return fn({
      abfrage: async <R,>(anweisung: string, werte: readonly unknown[] = []) =>
        (await tx.unsafe(anweisung, werte)) as readonly R[],
    });
  });
}

/**
 * Dieselbe Bindung OHNE Mandanten — fuer einen `uebergreifend`-Lauf.
 *
 * **Wofuer das gebraucht wird.** Ein Lauf ueber alle Gesellschaften muss erst
 * einmal FINDEN, was faellig ist, und das geht ueber Mandantengrenzen hinweg.
 * Die `j_*`-Policies sind genau dafuer da: sie gelten `to cse_job` mit
 * `using (true)`, waehrend die `t_*`-Policies der Anwendung an
 * `app.aktiver_mandant()` haengen.
 *
 * **Und warum das NICHT reicht, um danach zu schreiben.** Wer einen Beitrag
 * veroeffentlicht, loest den Riegel aus 0163 aus, und der fragt
 * `app.freigabe_genehmigt` — einen Definer, dessen Policy auf `freigabe`
 * `mandant_id = app.aktiver_mandant()` verlangt. Ohne gebundenen Mandanten
 * sieht er null Zeilen und der Riegel schliesst (richtig herum, aber zur
 * falschen Zeit). Gearbeitet wird deshalb je Beitrag in `alsJobSitzung` mit
 * SEINEM Mandanten; diese Funktion hier findet nur, was zu tun ist.
 */
export async function alsJobRolle<T>(
  sql: JobVerbindung,
  fn: (db: JobAbfrage) => Promise<T>,
  optionen: BinderOptionen = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_job`);
    await tx.unsafe(`select set_config('app.akteur_typ', 'system', true)`);
    /*
     * `nurLesen: false` gibt es hier seit V-085/V-089: zwei Statusläufe
     * ziehen einen Zustand nach, der aus dem Kalender folgt, und tun das
     * über Mandantengrenzen hinweg (`nachweis` hängt am MENSCHEN und trägt
     * kein `mandant_id`; das Angebot wird je Gesellschaft geschrieben, aber
     * aus EINEM Lauf gefunden).
     *
     * Die Vorgabe bleibt `true`. Wer schreibt, sagt es am Aufrufort — und
     * daneben steht, WAS er schreibt. Das Spaltenrecht in der Datenbank ist
     * die eigentliche Grenze; dieser Schalter ist die Ehrlichkeit der
     * Sitzung darüber.
     */
    await tx.unsafe(`select set_config('app.readonly', $1, true)`,
      [(optionen.nurLesen ?? true) ? 'on' : 'off']);
    return fn({
      abfrage: async <R,>(anweisung: string, werte: readonly unknown[] = []) =>
        (await tx.unsafe(anweisung, werte)) as readonly R[],
    });
  });
}
