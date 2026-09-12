// FIXTURE — `border-t-0` ist eine BREITE und muss durchgehen, `border-blau`
// als erfundene Farbe daneben aber gemeldet werden. Ohne den zweiten Teil
// beweist die Fixtur nur, dass die Wache schweigt.
export function Fixtur() {
  return (
    <div className="border-t-0 border-b-2 border-x-4">
      <span className="border-blau">Erfundene Farbe</span>
    </div>
  );
}
