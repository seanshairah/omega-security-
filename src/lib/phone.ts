/**
 * Normalise a phone number to E.164. Defaults to Zimbabwe (+263) for local formats:
 *   0772123456  → +263772123456
 *   772123456   → +263772123456
 *   263772123456 → +263772123456
 *   +263 77 212 3456 → +263772123456
 */
export function normalisePhone(raw: string, defaultCountry = "263"): string {
  let digits = (raw ?? "").replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\D/g, "");
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+${defaultCountry}${digits.slice(1)}`;
  if (digits.startsWith(defaultCountry)) return `+${digits}`;
  return `+${defaultCountry}${digits}`;
}

export function isValidPhone(e164: string): boolean {
  return /^\+\d{9,15}$/.test(e164);
}

export function formatPhone(e164: string): string {
  // +263772123456 → +263 77 212 3456
  const m = e164.match(/^\+(\d{3})(\d{2})(\d{3})(\d{4})$/);
  if (m) return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return e164;
}
