import { cn } from "@/lib/cn";

const control = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";

const width = (c?: string) => (/\bw-/.test(c ?? "") ? "" : "w-full");

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, width(className), className)} {...props} />;
}
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, width(className), "max-w-full appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22%23616060%22><path d=%22M12 15.5 5.5 9h13z%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)} {...props}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "w-full h-auto min-h-24 py-2 leading-relaxed", className)} {...props} />;
}
/** Labelled checkbox. Submits "on" when ticked, nothing when not. */
export function Checkbox({ label, hint, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[13px] text-ink hover:bg-surface-2 has-[:checked]:border-accent/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" {...props} />
      <span className="min-w-0"><span className="block font-medium">{label}</span>{hint && <span className="block text-[12px] text-ink-3">{hint}</span>}</span>
    </label>
  );
}

export function Field({ label, hint, children, className, required }: { label: string; hint?: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-critical"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="rounded-[var(--radius-control)] border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-[#b3301a]">{message}</p>;
}
export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-dashed border-line py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-[13px] text-ink-2">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}
