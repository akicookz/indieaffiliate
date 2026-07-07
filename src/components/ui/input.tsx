import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Attio-style field: white surface with a hairline ring, compact height
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-8 w-full min-w-0 rounded-md bg-muted/60 shadow-ring px-2.5 py-1 text-base transition-[box-shadow,background-color] duration-150 ease-out outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "hover:shadow-[0_0_0_1px_rgba(28,28,33,0.16)]",
        "focus-visible:bg-card focus-visible:shadow-[0_0_0_1px_var(--ring),0_0_0_3px_rgba(37,99,235,0.15)]",
        "aria-invalid:shadow-[0_0_0_1px_var(--destructive)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
