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
    <div className="bg-card shadow-xs shadow-card border border-card/20 rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-4">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">
              {title}
            </h3>
          </div>
          <p className="text-3xl font-medium text-foreground mb-2">{value}</p>
        </div>
        {change !== undefined && isPositive !== undefined && (
          <div className="text-right">
            <span
              className={`text-sm font-medium ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {isPositive ? "+" : ""}
              {change}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
