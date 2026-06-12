import { Activity, CheckCircle2, Lock, EyeOff, Wrench, ShieldOff, FileQuestion, XCircle } from "lucide-react";
import KpiCard from "./KpiCard";
import { fmt, pct } from "@/lib/format";
import type { KpiGlobal } from "@/lib/types";
import type { DrillFilter } from "./DrillModal";

interface Props {
  data: KpiGlobal | undefined;
  onDrill: (f: DrillFilter) => void;
}

export default function KpiCardsRow({ data, onDrill }: Props) {
  const d = data;
  const total = d?.total ?? 0;
  const ratio = (n: number | undefined) => (total ? (n ?? 0) / total : 0);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label="Total relevés"
        value={fmt(total)}
        sub="Cliquer pour la liste"
        icon={Activity}
        tone="info"
        onClick={() => onDrill({ title: "Tous les relevés", subtitle: "Aucun filtre d'état" })}
      />
      <KpiCard
        label="Accessibles"
        value={fmt(d?.accessible)}
        sub={`${pct(ratio(d?.accessible))} du parc`}
        icon={CheckCircle2}
        tone="good"
        onClick={() => onDrill({ title: "Compteurs accessibles", subtitle: "ID_COMP = 1", idComp: 1 })}
      />
      <KpiCard
        label="Inaccessibles"
        value={fmt(d?.inaccessible)}
        sub={`${pct(ratio(d?.inaccessible))} à débloquer`}
        icon={XCircle}
        tone="warn"
        onClick={() => onDrill({ title: "Compteurs inaccessibles", subtitle: "ID_COMP = 5", idComp: 5 })}
      />
      <KpiCard
        label="Bloqués"
        value={fmt(d?.bloque)}
        sub="Compteurs à réparer"
        icon={Lock}
        tone="danger"
        onClick={() => onDrill({ title: "Compteurs bloqués", subtitle: "ID_COMP = 4", idComp: 4 })}
      />
      <KpiCard
        label="Illisibles"
        value={fmt(d?.illisible)}
        sub="Compteurs à remplacer"
        icon={EyeOff}
        tone="warn"
        onClick={() => onDrill({ title: "Compteurs illisibles", subtitle: "ID_COMP = 2", idComp: 2 })}
      />
      <KpiCard
        label="Défectueux"
        value={fmt(d?.defectueux)}
        sub="Compteurs HS"
        icon={Wrench}
        tone="danger"
        onClick={() => onDrill({ title: "Compteurs défectueux", subtitle: "ID_COMP = 3", idComp: 3 })}
      />
      <KpiCard
        label="Volés"
        value={fmt(d?.vole)}
        sub="À investiguer (fraude)"
        icon={ShieldOff}
        tone="danger"
        onClick={() => onDrill({ title: "Compteurs volés", subtitle: "ID_COMP = 6", idComp: 6 })}
      />
      <KpiCard
        label="Non validés"
        value={fmt(d?.non_valides)}
        sub={`${pct(ratio(d?.non_valides))} à valider`}
        icon={FileQuestion}
        tone={ratio(d?.non_valides) > 0.2 ? "danger" : "warn"}
        onClick={() => onDrill({ title: "Relevés non validés", subtitle: "REL_VALIDE = 0" })}
      />
    </div>
  );
}