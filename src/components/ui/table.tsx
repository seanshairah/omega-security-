import { cn } from "@/lib/cn";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-full overflow-x-auto scroll-thin", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 [&_th]:border-b [&_th]:border-line [&_th]:px-5 [&_th]:py-2.5 [&_th]:font-semibold">{children}</thead>;
}
export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-5 [&_td]:py-3.5 [&_tr:last-child_td]:border-b-0 [&_tr]:transition-colors [&_tr:hover]:bg-surface-2/60">{children}</tbody>;
}
export function Empty({ title, body, action, colSpan }: { title: string; body?: string; action?: React.ReactNode; colSpan?: number }) {
  const inner = (
    <div className="flex flex-col items-center py-14 text-center">
      <span className="mb-3 h-8 w-8 rounded-full border-[1.5px] border-dashed border-line-strong" />
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
  if (colSpan) return <tr><td colSpan={colSpan} className="!py-0">{inner}</td></tr>;
  return inner;
}
