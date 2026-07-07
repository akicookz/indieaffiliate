import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full rounded-md bg-muted/60 shadow-ring px-2.5 py-2 text-base transition-[box-shadow] duration-150 ease-out outline-none hover:shadow-[0_0_0_1px_rgba(28,28,33,0.16)] focus-visible:bg-card focus-visible:shadow-[0_0_0_1px_var(--ring),0_0_0_3px_rgba(37,99,235,0.15)] aria-invalid:shadow-[0_0_0_1px_var(--destructive)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
