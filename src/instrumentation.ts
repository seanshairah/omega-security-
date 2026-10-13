export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.AUTOMATION_INPROCESS === "false") return;
  const { startInProcessScheduler } = await import("@/lib/automation/engine");
  startInProcessScheduler();
}
