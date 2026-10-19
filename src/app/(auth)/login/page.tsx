import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { login } from "@/actions/auth";
import { Input, Field, FormError } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { BrandMark, COMPANY } from "@/components/layout/brand";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <BrandMark size={40} className="rounded-[11px]" />
            <div>
              <p className="text-[17px] font-semibold leading-tight text-ink">{COMPANY.name}</p>
              <p className="text-[12px] text-ink-2">{COMPANY.portal} · {COMPANY.city}</p>
            </div>
          </div>
          <form action={login} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
            <div>
              <h1 className="text-[18px] font-semibold text-ink">Sign in</h1>
              <p className="mt-1 text-[13px] text-ink-2">For administrators and supervisors. Guards report by SMS and do not sign in.</p>
            </div>
            <FormError message={error === "1" ? "Email or password is incorrect." : error === "inactive" ? "This account has been deactivated." : error === "throttled" ? "Too many failed sign-ins. Wait 15 minutes and try again." : null} />
            <Field label="Email"><Input name="email" type="email" required autoComplete="email" defaultValue="admin@omegasecurity.co.zw" /></Field>
            <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
            <Button type="submit" variant="primary" className="w-full">Sign in</Button>
          </form>
          <p className="mt-6 text-center text-[12px] text-ink-3">{COMPANY.domain}</p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/login.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#101010]/85 via-[#101010]/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-10 text-white">
          <p className="text-[26px] font-semibold leading-tight tracking-[-0.01em]">Who is on post, where, and are they safe.</p>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-white/80">{COMPANY.tagline}. Every arrival, welfare check, handover and incident is confirmed by the guard&rsquo;s own phone and recorded here.</p>
        </div>
      </div>
    </div>
  );
}
