import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/form";

/** Optional photo: upload a small image, paste a link, or keep the standard illustrated avatar. */
export function PhotoField({ name, current, personName }: { name: string; current?: string | null; personName: string }) {
  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">Photo <span className="font-normal text-ink-3">· optional</span></span>
      <div className="flex flex-wrap items-start gap-4 rounded-[10px] border border-dashed border-line p-3">
        <Avatar src={current} name={personName} size={56} />
        <div className="min-w-0 flex-1 space-y-2">
          <input type="file" name={`${name}File`} accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-[13px] text-ink-2 file:mr-3 file:h-8 file:rounded-[8px] file:border file:border-line file:bg-surface file:px-3 file:text-[12.5px] file:font-medium file:text-ink hover:file:bg-surface-2" />
          <Input name={name} defaultValue={current && !current.startsWith("data:") ? current : ""} placeholder="or paste an image link (https://…)" />
          <p className="text-[12px] text-ink-3">Square, under 400 KB. Without a photo the standard illustrated avatar is used.</p>
          {current && <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" name={`${name}Remove`} value="1" className="accent-[#4f9f3a]" /> Remove current photo</label>}
        </div>
      </div>
    </div>
  );
}
