"use client";

import { Bar, BarChart, CartesianGrid, Rectangle, Tooltip, XAxis, YAxis, type BarShapeProps } from "recharts";

// Categorical slots 1–2 of the validated reference palette (light surface #fcfcfb):
// blue for cash, orange for UPI/bank. Checked with dataviz/scripts/validate_palette.js — all pass.
const SERIES = [
  { key: "cash", label: "Cash", color: "#2a78d6" },
  { key: "upi", label: "UPI / bank", color: "#eb6834" },
] as const;
const SURFACE = "#ffffff";
const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

type Day = { day: string; cash: number; upi: number };

/** Stacked bars: total collections per day, split cash vs UPI/bank. Hover shows both values. */
export function CollectionsChart({ data }: { data: Day[] }) {
  return (
    <figure>
      <div className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <BarChart width={520} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="#e7e5e4" />
        <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "#d6d3d1" }} tick={{ fontSize: 11, fill: "#57534e" }} />
        <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11, fill: "#78716c" }}
          tickFormatter={(v: number) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          formatter={(value, name) => [inr(Number(value)), SERIES.find((s) => s.key === name)?.label ?? String(name)]}
          labelFormatter={(label, payload) => `${label} · total ${inr(payload.reduce((t, p) => t + Number(p.value ?? 0), 0))}`}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {SERIES.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} stackId="c" fill={s.color} stroke={SURFACE} strokeWidth={2} isAnimationActive={false}
            // Round only the top of the stack; a 2px surface stroke separates the segments.
            shape={(props: BarShapeProps) => <Rectangle {...props} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />} />
        ))}
      </BarChart>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full">
          <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Day</th><th className="text-right font-normal">Cash</th><th className="text-right font-normal">UPI / bank</th><th className="text-right font-normal">Total</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}><td>{d.day}</td><td className="text-right">{inr(d.cash)}</td><td className="text-right">{inr(d.upi)}</td><td className="text-right font-medium">{inr(d.cash + d.upi)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
