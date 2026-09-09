// FIXTURE — must FAIL `cse/no-raw-color`.
export function Schlecht() {
  return <div style={{ color: '#ff0000', background: 'rgba(0,0,0,0.5)' }} />;
}
