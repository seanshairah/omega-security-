export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnv } = await import("./lib/env-check");
    const issues = checkEnv();
    for (const i of issues) console[i.level === "fatal" ? "error" : "warn"](`[config] ${i.key}: ${i.message}`);
    if (process.env.NODE_ENV === "production" && issues.some((i) => i.level === "fatal")) throw new Error("Refusing to start: fatal configuration problems (see [config] lines above).");
    if (process.env.AUTOMATION_INPROCESS !== "false") {
      const { startInProcessScheduler } = await import("./lib/automation/engine");
      startInProcessScheduler();
    }
  }
}
