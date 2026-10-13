import { guarded, json } from "@/lib/api";
import { getSettings, saveSettings, SETTING_DEFS } from "@/lib/settings";
import { audit } from "@/lib/audit";

export const GET = guarded("SUPERVISOR", async () => json({ values: await getSettings(), definitions: SETTING_DEFS }));

export const PUT = guarded("SUPER_ADMIN", async (req, _ctx, user) => {
  const values = (await req.json().catch(() => ({}))) as Record<string, string>;
  await saveSettings(values);
  await audit({ userId: user.id, actor: user.name, action: "SETTINGS_UPDATED", entity: "Setting", details: values });
  return json({ values: await getSettings() });
});
