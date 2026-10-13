import type { SmsProvider } from "./provider";
import { SimulatedProvider } from "./providers/simulated";
import { AfricasTalkingProvider } from "./providers/africastalking";
import { TwilioProvider } from "./providers/twilio";
import { HttpProvider } from "./providers/http";
import { SendaiProvider } from "./providers/sendai";

const registry: Record<string, () => SmsProvider> = {
  simulated: () => new SimulatedProvider(),
  sendai: () => new SendaiProvider(),
  africastalking: () => new AfricasTalkingProvider(),
  twilio: () => new TwilioProvider(),
  http: () => new HttpProvider(),
};

export function getProvider(name?: string): SmsProvider {
  const key = (name ?? process.env.SMS_PROVIDER ?? "simulated").toLowerCase();
  const factory = registry[key];
  if (!factory) throw new Error(`Unknown SMS provider "${key}". Known: ${Object.keys(registry).join(", ")}`);
  return factory();
}

export function activeProviderName(): string {
  return (process.env.SMS_PROVIDER ?? "simulated").toLowerCase();
}

export const PROVIDER_NAMES = Object.keys(registry);
