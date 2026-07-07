import { type LucideIcon } from "lucide-react";

export default function StatCard({
  title,
  value,
  Icon,
  isPositive,
  change,
}: {
  title: string;
  value: number | string;
  Icon: LucideIcon;
  isPositive?: boolean;
  change?: number;
}) {
  // Attio-style metric tile: normal-case muted label, compact semibold number.
  return (
    <div className="bg-card shadow-card rounded-lg p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">{title}</span>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums text-foreground">
          {value}
        </p>
        {change !== undefined && isPositive !== undefined && (
          <span
            className={`text-[13px] font-medium tabular-nums ${
              isPositive ? "text-positive" : "text-negative"
            }`}
          >
            {isPositive ? "+" : ""}
            {change}%
          </span>
        )}
      </div>
    </div>
  );
}
