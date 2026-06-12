"use client";

import { LucideIcon } from "lucide-react";

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string | number;
}

export default function Tabs({
  items, active, onChange,
}: { items: TabItem[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
      {items.map((t) => {
        const isActive = t.id === active;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-white text-snde-800 shadow-sm ring-1 ring-slate-200"
                : "text-slate-600 hover:bg-white/60"
            }`}
          >
            {Icon && <Icon size={15} />}
            <span>{t.label}</span>
            {t.badge !== undefined && (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                isActive ? "bg-snde-100 text-snde-700" : "bg-slate-200 text-slate-600"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}