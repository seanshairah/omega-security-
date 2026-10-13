import { redirect } from "next/navigation";
import { ShieldIcon } from "@phosphor-icons/react/dist/ssr";
import { getSessionUser } from "@/lib/auth/session";
import { login } from "@/actions/auth";
import { Input, Field, FormError } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent text-white"><ShieldIcon weight="fill" size={20} /></span>
          <div>
            <p className="text-[17px] font-semibold leading-tight text-ink">Sentinel</p>
            <p className="text-[12px] text-ink-2">Omega Security operations portal</p>
          </div>
        </div>
        <form action={login} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h1 className="text-[18px] font-semibold text-ink">Sign in</h1>
          <FormError message={error === "1" ? "Email or password is incorrect." : error === "inactive" ? "This account has been deactivated." : null} />
          <Field label="Email"><Input name="email" type="email" required autoComplete="email" defaultValue="admin@omegasecurity.co.zw" /></Field>
          <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
          <Button type="submit" variant="primary" className="w-full">Sign in</Button>
          <p className="text-center text-[12px] text-ink-3">Demo password: Sentinel123!</p>
        </form>
      </div>
    </div>
  );
}
