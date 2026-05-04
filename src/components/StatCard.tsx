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
  return (
    <div className="bg-card border rounded-md p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-eyebrow">{title}</span>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-hero-number text-foreground">{value}</p>
        {change !== undefined && isPositive !== undefined && (
          <span
            className={`text-sm font-medium tabular-nums ${
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
