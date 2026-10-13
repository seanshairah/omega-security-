/** Half-ring attendance gauge. Bands: critical < 60, warn < 85, ok ≥ 85. */
export function Gauge({ value }: { value: number }) {
  const r = 84, cx = 110, cy = 104, stroke = 22;
  const arc = (from: number, to: number) => {
    const a1 = Math.PI * (1 - from), a2 = Math.PI * (1 - to);
    const x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1), x2 = cx + r * Math.cos(a2), y2 = cy - r * Math.sin(a2);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const gap = 0.012;
  const bands = [
    { from: 0, to: 0.3, color: "#e94127" }, { from: 0.3, to: 0.6, color: "#f2a93b" }, { from: 0.6, to: 0.85, color: "#c9d94a" }, { from: 0.85, to: 1, color: "#29a37e" },
  ];
  const v = Math.max(0, Math.min(100, value)) / 100;
  const ang = Math.PI * (1 - v);
  const nx = cx + (r - 14) * Math.cos(ang), ny = cy - (r - 14) * Math.sin(ang);
  return (
    <svg viewBox="0 0 220 120" className="w-full max-w-[300px]" role="img" aria-label={`Attendance ${value}%`}>
      {bands.map((b) => <path key={b.from} d={arc(b.from + gap, b.to - gap)} stroke={b.color} strokeWidth={stroke} fill="none" strokeLinecap="butt" opacity={v >= b.from ? 1 : 0.35} />)}
      <circle cx={cx} cy={cy} r={34} fill="#fff" stroke="#e7e6e5" />
      <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="#161616" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#161616" />
    </svg>
  );
}
