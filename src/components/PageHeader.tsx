import type { ReactNode } from "react";

// Attio-style page header: compact sans title + one-line description on the
// left, actions on the right, hairline separator below. Every app page uses
// this so titles/descriptions/actions stay uniform.
export default function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5">
        <h1 className="text-page-title text-foreground">{title}</h1>
        {subtitle && (
          <p className="max-w-2xl text-[13px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div className="mt-2 flex shrink-0 items-center gap-2 sm:mt-0">
          {children}
        </div>
      )}
    </div>
  );
}
