import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";

type Step6PhotosProps = {
  restaurantId: string;
  onComplete: () => void;
  onBusyChange: (busy: boolean) => void;
};

type GalleryEntry = {
  key: string;
  url: string;
  caption: string;
};

const SUPPORTED_MIME: Array<{ mime: string; extensions: string[] }> = [
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/webp", extensions: ["webp"] },
  { mime: "image/gif", extensions: ["gif"] },
  { mime: "image/avif", extensions: ["avif"] },
];
const ACCEPT_ATTR = SUPPORTED_MIME.flatMap((t) => [t.mime, ...t.extensions.map((e) => `.${e}`)]).join(",");

function resolveImage(file: File): { mime: string } | null {
  const mime = file.type.toLowerCase();
  const byMime = SUPPORTED_MIME.find((t) => t.mime === mime);
  if (byMime) return { mime: byMime.mime };
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const byExt = SUPPORTED_MIME.find((t) => t.extensions.includes(ext));
  return byExt ? { mime: byExt.mime } : null;
}

function makeKey(): string {
  return `g-${crypto.randomUUID()}`;
}

type RestaurantSettingsWithGallery = RestaurantSettings & {
  galleryUrls?: Array<{ url: string; caption: string | null }> | null;
};

export function Step6Photos({ restaurantId, onComplete, onBusyChange }: Step6PhotosProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryEntry[]>([]);
  const [galleryFiles, setGalleryFiles] = useState<Map<string, File>>(new Map());
  const [existingSettings, setExistingSettings] = useState<RestaurantSettingsWithGallery>({});
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const objectUrlsRef = useRef<string[]>([]);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (hydrated) return;
    if (!isSupabaseConfigured()) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("restaurants")
        .select("cover_photo_url, logo_url, settings_json")
        .eq("id", restaurantId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? null) as {
        cover_photo_url: string | null;
        logo_url: string | null;
        settings_json: RestaurantSettingsWithGallery | null;
      } | null;
      if (row) {
        setCoverUrl(row.cover_photo_url);
        setLogoUrl(row.logo_url);
        setExistingSettings(row.settings_json ?? {});
        const existingGallery = Array.isArray(row.settings_json?.galleryUrls)
          ? (row.settings_json?.galleryUrls ?? [])
          : [];
        setGallery(
          existingGallery.map((g) => ({
            key: makeKey(),
            url: g.url,
            caption: g.caption ?? "",
          })),
        );
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const uploadFile = async (file: File, kind: string): Promise<string | null> => {
    const image = resolveImage(file);
    if (!image) {
      toast.error("Upload a JPG, PNG, WebP, GIF, or AVIF image.");
      return null;
    }
    if (!assertImageSizeOk(file)) return null;
    const client = getSupabaseBrowserClient();
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${restaurantId}/restaurant/${kind}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await client.storage
      .from("event-media")
      .upload(path, file, { cacheControl: "3600", contentType: image.mime, upsert: false });
    if (error) {
      toast.error(error.message);
      return null;
    }
    const { data } = client.storage.from("event-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const setCoverFromFile = (file: File) => {
    if (!resolveImage(file)) {
      toast.error("Upload a JPG, PNG, WebP, GIF, or AVIF image.");
      return;
    }
    if (!assertImageSizeOk(file)) return;
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    setCoverFile(file);
    setCoverPreview(url);
  };

  const setLogoFromFile = (file: File) => {
    if (!resolveImage(file)) {
      toast.error("Upload a JPG, PNG, WebP, GIF, or AVIF image.");
      return;
    }
    if (!assertImageSizeOk(file)) return;
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    setLogoFile(file);
    setLogoPreview(url);
  };

  const addGalleryFiles = (files: FileList) => {
    const arr = Array.from(files);
    const valid = arr.filter((f) => Boolean(resolveImage(f)) && assertImageSizeOk(f));
    if (valid.length < arr.length) {
      // Either mime or size rejected; assertImageSizeOk has already toasted
      // for size, so only mention mime when no toast already fired.
    }
    if (valid.length === 0) return;
    const additions: GalleryEntry[] = [];
    const nextFiles = new Map(galleryFiles);
    for (const f of valid) {
      const previewUrl = URL.createObjectURL(f);
      objectUrlsRef.current.push(previewUrl);
      const key = makeKey();
      additions.push({ key, url: previewUrl, caption: "" });
      nextFiles.set(key, f);
    }
    setGalleryFiles(nextFiles);
    setGallery((prev) => [...prev, ...additions]);
  };

  const updateCaption = (key: string, caption: string) => {
    setGallery((prev) => prev.map((g) => (g.key === key ? { ...g, caption } : g)));
  };

  const removeGalleryEntry = (key: string) => {
    setGallery((prev) => prev.filter((g) => g.key !== key));
    setGalleryFiles((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const removeCover = () => {
    setCoverFile(null);
    setCoverPreview(null);
    setCoverUrl(null);
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoUrl(null);
  };

  const onSubmit = async () => {
    const hasCover = Boolean(coverFile) || Boolean(coverUrl);
    if (!hasCover) {
      toast.error("Add a cover photo to continue.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      let nextCoverUrl = coverUrl;
      if (coverFile) {
        const uploaded = await uploadFile(coverFile, "cover");
        if (!uploaded) return;
        nextCoverUrl = uploaded;
      }
      let nextLogoUrl = logoUrl;
      if (logoFile) {
        const uploaded = await uploadFile(logoFile, "logo");
        if (!uploaded) return;
        nextLogoUrl = uploaded;
      }

      const finalGallery: Array<{ url: string; caption: string | null }> = [];
      for (const entry of gallery) {
        const pendingFile = galleryFiles.get(entry.key);
        if (pendingFile) {
          const uploaded = await uploadFile(pendingFile, "gallery");
          if (!uploaded) return;
          finalGallery.push({
            url: uploaded,
            caption: entry.caption.trim() || null,
          });
        } else {
          finalGallery.push({
            url: entry.url,
            caption: entry.caption.trim() || null,
          });
        }
      }

      const updatedSettings: RestaurantSettingsWithGallery = {
        ...existingSettings,
        galleryUrls: finalGallery,
      };

      const client = getSupabaseBrowserClient();
      const { error } = await client
        .from("restaurants")
        .update({
          cover_photo_url: nextCoverUrl,
          logo_url: nextLogoUrl,
          settings_json: updatedSettings,
        })
        .eq("id", restaurantId);
      if (error) {
        toast.error(`Couldn't save photos: ${error.message}`);
        return;
      }
      toast.success("Photos saved.");
      onComplete();
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Photos</h1>
        <p className="mt-1 text-sm text-text-muted">
          Strong photos win bookings. Cover photo is required; logo and gallery are recommended.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Cover photo</h2>
            <p className="text-xs text-text-muted">
              The hero image diners see on your restaurant page. Required.
            </p>
          </div>
          {(coverPreview || coverUrl) && (
            <Button type="button" variant="ghost" size="sm" onClick={removeCover} className="text-danger">
              <Trash2 className="mr-1.5 size-3.5" />
              Remove
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setCoverFromFile(f);
          }}
          className="flex min-h-60 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-elevated/40 text-center transition-colors hover:border-gold/40"
        >
          {coverPreview || coverUrl ? (
            <img src={coverPreview ?? coverUrl ?? ""} alt="Cover" className="h-60 w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-text-muted">
              <Upload className="size-7" />
              <p className="text-sm">Drag or click to upload your cover photo</p>
              <p className="text-xs">JPG, PNG, WebP, GIF, or AVIF</p>
            </div>
          )}
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setCoverFromFile(f);
            e.target.value = "";
          }}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Logo</h2>
            <p className="text-xs text-text-muted">
              Square image. Falls back to your initials when missing.
            </p>
          </div>
          {(logoPreview || logoUrl) && (
            <Button type="button" variant="ghost" size="sm" onClick={removeLogo} className="text-danger">
              <Trash2 className="mr-1.5 size-3.5" />
              Remove
            </Button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setLogoFromFile(f);
            }}
            className="flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-elevated/40 transition-colors hover:border-gold/40"
          >
            {logoPreview || logoUrl ? (
              <img src={logoPreview ?? logoUrl ?? ""} alt="Logo" className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-7 text-text-muted" />
            )}
          </button>
          <p className="text-xs text-text-muted">
            Tap to upload. Square crop works best (1:1).
          </p>
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setLogoFromFile(f);
            e.target.value = "";
          }}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Gallery</h2>
            <p className="text-xs text-text-muted">
              Add 3+ photos that show off your space and dishes. Optional.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => galleryInputRef.current?.click()}
            className="gap-1.5"
          >
            <Upload className="size-3.5" />
            Add photos
          </Button>
        </div>
        <input
          ref={galleryInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addGalleryFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />
        {gallery.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-bg-elevated/40 px-4 py-8 text-center text-sm text-text-muted">
            No gallery photos yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {gallery.map((g) => (
              <div key={g.key} className="overflow-hidden rounded-xl border border-border bg-bg-elevated/40">
                <div className="relative h-36 w-full">
                  <img src={g.url} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeGalleryEntry(g.key)}
                    aria-label="Remove photo"
                    className="absolute right-2 top-2 rounded-full bg-bg-base/80 p-1 text-text-primary hover:bg-bg-base"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="p-3">
                  <Label htmlFor={`caption-${g.key}`} className="sr-only">
                    Caption
                  </Label>
                  <Input
                    id={`caption-${g.key}`}
                    value={g.caption}
                    onChange={(e) => updateCaption(g.key, e.target.value)}
                    placeholder="Caption (optional)"
                    className="h-9"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center justify-end">
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
