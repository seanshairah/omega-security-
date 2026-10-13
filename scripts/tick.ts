// Run one automation tick from the shell or cron:  npm run automation:tick
import { runAutomationTick } from "../src/lib/automation/engine";

runAutomationTick()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
