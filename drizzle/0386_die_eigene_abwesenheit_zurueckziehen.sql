-- 0386 · Die eigene Abwesenheit zurücknehmen (V-056, EMP-10).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Der Befund.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `/portal/mein/antraege` listet die eigenen Abwesenheiten — als Kacheln ohne
-- Ziel. Kein Verweis, kein Blatt, kein Knopf. Und darunter liegt mehr als ein
-- fehlender Link: **`cse_app` hat auf `abwesenheit` genau EINE
-- UPDATE-Policy**, `t_mandant_entscheiden`, und die verlangt
-- `zeit.abwesenheit_genehmigen` — ein Recht der Planung. Wer sich um 05:40
-- krank gemeldet und dabei den falschen Tag getippt hat, konnte das nicht
-- zurücknehmen. Nicht über die Oberfläche, und auch nicht darunter.
--
-- **Die Plattform hat die Entscheidung längst getroffen.** Der Kommentar an
-- `kern.abwesenheit_status` (0073) sagt: „`erfasst` ist der Endzustand der
-- Krankmeldung: sie wird nicht genehmigt, sie wird zur Kenntnis genommen —
-- und lässt sich stornieren, wenn sie falsch war." Die Zustandsmaschine
-- erlaubt `erfasst → storniert` und `beantragt → storniert`, und
-- `abwesenheit_urlaubskonto` bucht die Tage beim Stornieren zurück. Es fehlte
-- der WEG, nicht die Regel.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Dieselbe Form wie `antrag.t_selbst_zurueckziehen` (0301).**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nicht zufällig dieselbe: es ist dieselbe Frage — darf der Betroffene seinen
-- eigenen, noch unentschiedenen Vorgang zurücknehmen? — und sie ist für den
-- Antrag schon beantwortet. Eine zweite, abweichende Antwort für die
-- Abwesenheit wäre eine erfundene Regel.
--
--   USING       nur die eigene Zeile, nicht storniert, und nur `erfasst`
--               oder `beantragt` — also bevor jemand entschieden hat.
--   WITH CHECK  nur der Zielzustand `storniert`.
--
-- Damit ist diese Policy KEIN allgemeiner Schreibweg auf `abwesenheit`: eine
-- Selbstgenehmigung („status = 'genehmigt'") fällt an der WITH-CHECK-Hälfte,
-- eine schon genehmigte Abwesenheit an der USING-Hälfte — die bleibt der
-- Planung, die über Lohnfortzahlung und Urlaubskonto entschieden hat.
--
-- **Kein Rechteschlüssel, und das ist kein Loch** (K-19, dieselbe Begründung
-- wie in `0301`): „nur der Betroffene" lässt sich als Recht nicht ausdrücken,
-- weil ein Recht einer Rolle gehört und eine Rolle vielen Menschen. Der
-- Selbstbezug steht in der Policy, über `app.aktuelle_person()`.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Was hier NICHT entschieden wird.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `abwesenheit` trägt keine Spalte, die sagt, ob ihre Tage schon in einen
-- Lohnexport oder einen abgeschlossenen Stundenkonto-Monat geflossen sind.
-- Ob eine Rücknahme danach noch zulässig ist, ist damit weder gebaut noch
-- entschieden — siehe O-895. Bis dahin gilt, was die Zustandsmaschine seit
-- `0073` sagt: unentschieden heisst rücknehmbar.

create policy t_selbst_zurueckziehen on abwesenheit for update to cse_app
using (
  mandant_id = app.aktiver_mandant()
  and storniert_am is null
  and status in ('erfasst', 'beantragt')
  and exists (
    select 1 from anstellung a
     where a.mandant_id = abwesenheit.mandant_id
       and a.id = abwesenheit.anstellung_id
       and a.person_id = app.aktuelle_person()
  )
)
with check (
  mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and status = 'storniert'
  and exists (
    select 1 from anstellung a
     where a.mandant_id = abwesenheit.mandant_id
       and a.id = abwesenheit.anstellung_id
       and a.person_id = app.aktuelle_person()
  )
);

comment on policy t_selbst_zurueckziehen on abwesenheit is
  'EMP-10 (0386): die eigene Ruecknahme, in derselben Form wie antrag.t_selbst_zurueckziehen '
  '(0301). USING laesst nur erfasst und beantragt zu, WITH CHECK nur den Zielzustand '
  'storniert — die Policy ist damit kein allgemeiner Schreibweg auf abwesenheit. '
  'Selbstzugriff ueber app.aktuelle_person(), kein Rechteschluessel (K-19).';
