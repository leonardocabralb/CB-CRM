"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

// Root: primary token when checked (responds to the active color theme),
// slate when unchecked.
// CB: desligado em `muted-foreground/45` e o polegar branco nos dois modos.
// O `bg-muted` de antes sumia no cartão (0,967 sobre 1 no claro, 0,22 sobre
// 0,18 no escuro): o operador não via que havia um interruptor ali.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // CB: a raiz do base-ui é um <span> com `data-disabled`, não um
        // <button>: o `disabled:` nunca casava e o inativo saía igual ao ativo.
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        "data-[checked]:bg-primary data-[unchecked]:bg-muted-foreground/45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
          "data-[checked]:translate-x-4 data-[unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
