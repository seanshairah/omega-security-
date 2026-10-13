/**
 * Optional profile photos are stored as data URLs in the database so they work on serverless hosts
 * without a file store. Files are capped at 400 KB; admins are asked to use a small square image.
 */
export async function fileToDataUrl(file: FormDataEntryValue | null): Promise<string | null | undefined> {
  if (!(file instanceof File) || file.size === 0) return undefined; // no change
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("Photo must be a PNG, JPEG, WebP or SVG image.");
  if (file.size > 400 * 1024) throw new Error("Photo must be under 400 KB. Resize it to about 256×256 pixels.");
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buf.toString("base64")}`;
}

/** Resolve the stored URL for a form: uploaded file wins, then a pasted URL, then "remove". */
export async function resolvePhoto(fd: FormData, field: string): Promise<string | null | undefined> {
  const uploaded = await fileToDataUrl(fd.get(`${field}File`));
  if (uploaded !== undefined) return uploaded;
  if (fd.get(`${field}Remove`) === "1") return null;
  const url = String(fd.get(field) ?? "").trim();
  return url ? url : undefined;
}
