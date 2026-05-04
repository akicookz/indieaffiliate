import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-6">
      <div className="space-y-1">
        <p className="text-eyebrow">{eyebrow}</p>
        <h1 className="text-page-title text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground max-w-xl">{subtitle}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2 shrink-0 mt-3 sm:mt-0">
          {children}
        </div>
      )}
    </div>
  );
}
