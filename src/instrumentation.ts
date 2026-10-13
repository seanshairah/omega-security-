export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.AUTOMATION_INPROCESS !== "false") {
      const { startInProcessScheduler } = await import("./lib/automation/engine");
      startInProcessScheduler();
    }
  }
}
