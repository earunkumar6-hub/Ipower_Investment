"use client";

import { Cell, Pie, PieChart, Tooltip } from "recharts";

// Categorical slots 1–6 of the validated reference palette, in fixed order (never cycled).
// Validator: all checks pass; 3 slots are under 3:1 on the surface, so every slice is also
// labelled in the legend with its name, value and share (no colour-only identity).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const SURFACE = "#ffffff";
const share = (v: number, total: number) => (v > 0 && v / total < 0.005 ? "<1%" : `${Math.round((v / total) * 100)}%`);
const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

type Slice = { label: string; value: number };

/** Part-to-whole donut (≤ 6 slices) with a value legend that doubles as the table view. */
export function DonutChart({ slices, totalLabel }: { slices: Slice[]; totalLabel: string }) {
  const total = slices.reduce((t, s) => t + s.value, 0);
  if (total <= 0) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <PieChart width={150} height={150}>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius={44} outerRadius={70} startAngle={90} endAngle={-270}
            stroke={SURFACE} strokeWidth={2} isAnimationActive={false}>
            {slices.map((s, i) => <Cell key={s.label} fill={PALETTE[i]} />)}
          </Pie>
          <Tooltip formatter={(v, name) => [`${inr(Number(v))} · ${share(Number(v), total)}`, String(name)]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] text-muted-foreground">{totalLabel}</span>
          <span className="text-sm font-semibold">{inr(total)}</span>
        </div>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {slices.map((s, i) => (
            <tr key={s.label}>
              <td className="py-0.5 pr-2"><span className="inline-block size-2.5 rounded-sm align-middle" style={{ background: PALETTE[i] }} /></td>
              <td className="py-0.5">{s.label}</td>
              <td className="py-0.5 text-right">{inr(s.value)}</td>
              <td className="w-10 py-0.5 text-right text-muted-foreground">{share(s.value, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
