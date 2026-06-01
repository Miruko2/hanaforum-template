"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

// 注：@radix-ui/react-separator 1.1.7 的 SeparatorProps 在 strict 模式下
// 没有正确合并 HTMLAttributes，导致 className 等属性"看上去"不存在。
// 显式 & React.HTMLAttributes<HTMLDivElement> 让 className/style/onClick
// 这类基础 div 属性恢复可用。
const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> &
    React.HTMLAttributes<HTMLDivElement>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
