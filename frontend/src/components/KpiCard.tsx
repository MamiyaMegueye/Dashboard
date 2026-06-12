import { LucideIcon, ArrowUpRight } from "lucide-react";
import { TONE_STYLES, type Tone } from "@/lib/format";

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  tone?: Tone;
  onClick?: () => void;
}

export default function KpiCard({ label, value, sub, icon: Icon, tone = "default", onClick }: KpiCardProps) {
  const styles = TONE_STYLES[tone];
  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) onClick!(); }}
      className={`group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition ${
        clickable ? "cursor-pointer hover:border-snde-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-snde-200" : "hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {Icon && (
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ${styles.bg} ${styles.text} ${styles.ring}`}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {clickable && (
        <span className="absolute right-3 bottom-3 hidden text-slate-400 group-hover:inline-flex">
          <ArrowUpRight size={14} />
        </span>
      )}
    </div>
  );
}