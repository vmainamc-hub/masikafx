import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({ title, subtitle, children, className, accent }: {
  title?: string; subtitle?: string; children: ReactNode; className?: string; accent?: "cyan" | "magenta" | "amber";
}) {
  const ring = accent === "magenta"
    ? "before:bg-[var(--accent)]"
    : accent === "amber"
      ? "before:bg-[var(--warn)]"
      : "before:bg-[var(--neon)]";
  return (
    <div className={cn(
      "glass rounded-xl relative overflow-hidden",
      "before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:opacity-70",
      ring, className,
    )}>
      {(title || subtitle) && (
        <div className="px-4 pt-3 pb-2 flex items-baseline justify-between border-b border-border/40">
          <div>
            {title && <h3 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>}
            {subtitle && <p className="text-sm text-foreground/90 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: {
  label: string; value: ReactNode; hint?: string; tone?: "bull" | "bear" | "warn" | "neon";
}) {
  const color = tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--neon)]";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("tabular text-2xl font-semibold", color)}>{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function Bar({ value, tone = "neon" }: { value: number; tone?: "bull" | "bear" | "neon" | "warn" }) {
  const color = tone === "bull" ? "bg-[var(--bull)]" : tone === "bear" ? "bg-[var(--bear)]" : tone === "warn" ? "bg-[var(--warn)]" : "bg-[var(--neon)]";
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
      <div className={cn("h-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
