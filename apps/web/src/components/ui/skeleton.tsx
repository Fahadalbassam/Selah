import { cn } from "@/lib/utils"

// A soft shimmer instead of shadcn's pulse: it reads as "loading" without
// blinking. Under prefers-reduced-motion the global rule stops the sweep.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-skeleton bg-[linear-gradient(90deg,transparent_25%,var(--skeleton-shine)_50%,transparent_75%)] bg-[length:200%_100%] rtl:[animation-direction:reverse]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
