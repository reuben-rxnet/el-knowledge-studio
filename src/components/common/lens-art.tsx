/** Hero illustration: one source refracted through a lens into many outputs. Decorative. */
export function LensArt() {
  const outs: [number, number, string][] = [[300, 40, "Video"], [340, 100, "Guide"], [330, 165, "FAQ"], [290, 215, "Translations"]];
  return (
    <svg className="lensart" viewBox="0 0 420 240" aria-hidden focusable="false">
      <defs>
        <radialGradient id="lg" cx="40%" cy="35%"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset=".25" stopColor="#7FDAF0" stopOpacity=".5" /><stop offset="1" stopColor="#00A6CE" stopOpacity="0" /></radialGradient>
        <linearGradient id="beam" x1="0" x2="1"><stop offset="0" stopColor="#D6A84B" stopOpacity="0" /><stop offset=".5" stopColor="#D6A84B" /><stop offset="1" stopColor="#00A6CE" /></linearGradient>
      </defs>
      <path d="M0 120 C80 120 120 120 168 120" stroke="url(#beam)" strokeWidth="2" fill="none" />
      <ellipse cx="210" cy="120" rx="46" ry="96" fill="url(#lg)" stroke="rgba(255,255,255,.55)" strokeWidth="1.2" />
      <ellipse cx="210" cy="120" rx="30" ry="76" fill="none" stroke="rgba(255,255,255,.18)" />
      {outs.map(([x, y, l]) => (
        <g key={l}>
          <path d={`M252 120 C 275 120, ${x - 30} ${y}, ${x} ${y}`} stroke="rgba(0,166,206,.6)" strokeWidth="1.4" fill="none" />
          <rect x={x} y={y - 13} width={l.length * 7.4 + 22} height="26" rx="13" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.35)" />
          <text x={x + 11} y={y + 4.5} fill="#fff" fontSize="12" fontFamily="Segoe UI, Arial">{l}</text>
        </g>
      ))}
      {[[40, 70], [70, 170], [110, 95]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="40" height="26" rx="4" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.3)" />)}
    </svg>
  );
}
