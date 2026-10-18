import { cn } from "@/lib/utils";

const TONES = {
  blue: "bg-blue-100 text-blue-800",
  slate: "bg-slate-200 text-slate-700",
  indigo: "bg-indigo-100 text-indigo-800",
  orange: "bg-orange-100 text-orange-800",
  purple: "bg-purple-100 text-purple-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
} as const;

export type Tone = keyof typeof TONES;

export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone])}>{children}</span>;
}
