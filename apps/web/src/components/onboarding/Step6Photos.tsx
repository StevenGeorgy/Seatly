import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ColorPicker, BACKGROUND_PRESETS } from "@/components/ui/color-picker";
import type { RestaurantSettings, RestaurantTheme } from "@/hooks/useStaffRestaurants";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";
import { cn } from "@/lib/utils";

type Step6PhotosProps = {
  restaurantId: string;
  /** Receives the saved primary theme color so SetupPage can pass it
   *  to the "Preview as diner" modal without an extra DB roundtrip. */
  onComplete: (themeColor: string) => void;
  onBusyChange: (busy: boolean) => void;
};

const DEFAULT_PRIMARY_COLOR = "#C9A84C";
const DEFAULT_ACCENT_COLOR = "#22C55E";
const DEFAULT_BACKGROUND_COLOR = "#0A0A0A";

function isLightHex(hex: string): boolean {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

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

// galleryUrls stays in the type for pass-through preservation — owners
// who upload gallery photos post-publish via Settings shouldn't have
// them wiped when they revisit the wizard. The wizard's submit just
// forwards whatever was already there.
type RestaurantSettingsWithGallery = RestaurantSettings & {
  galleryUrls?: Array<{ url: string; caption: string | null }> | null;
};

export function Step6Photos({ restaurantId, onComplete, onBusyChange }: Step6PhotosProps) {
  const { errorToast } = useErrorToast();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [existingSettings, setExistingSettings] = useState<RestaurantSettingsWithGallery>({});
  const [primaryColor, setPrimaryColor] = useState<string>(DEFAULT_PRIMARY_COLOR);
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ACCENT_COLOR);
  const [backgroundColor, setBackgroundColor] = useState<string>(DEFAULT_BACKGROUND_COLOR);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const objectUrlsRef = useRef<string[]>([]);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

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
        const savedTheme = row.settings_json?.theme ?? null;
        if (savedTheme?.primaryColor && /^#[0-9a-f]{6}$/i.test(savedTheme.primaryColor)) {
          setPrimaryColor(savedTheme.primaryColor);
        }
        if (savedTheme?.accentColor && /^#[0-9a-f]{6}$/i.test(savedTheme.accentColor)) {
          setAccentColor(savedTheme.accentColor);
        }
        if (savedTheme?.backgroundColor && /^#[0-9a-f]{6}$/i.test(savedTheme.backgroundColor)) {
          setBackgroundColor(savedTheme.backgroundColor);
        }
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
      errorToast(error, {
        fallback: "Couldn't upload image. Try again.",
        logTag: "[Step6Photos.uploadFile]",
      });
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

      // Gallery is no longer surfaced in the wizard. Pass through any
      // existing galleryUrls untouched so owners who uploaded them via
      // Settings post-publish don't lose them when they revisit the
      // wizard.
      const passthruGallery = existingSettings.galleryUrls ?? null;

      const nextTheme: RestaurantTheme = {
        ...(existingSettings.theme ?? {}),
        primaryColor,
        accentColor,
        backgroundColor,
      };
      const updatedSettings: RestaurantSettingsWithGallery = {
        ...existingSettings,
        ...(passthruGallery !== null ? { galleryUrls: passthruGallery } : {}),
        theme: nextTheme,
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
        errorToast(error, {
          context: "Couldn't save photos",
          logTag: "[Step6Photos.saveRestaurant]",
        });
        return;
      }
      toast.success("Photos saved.");
      onComplete(primaryColor);
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

      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-surface p-5">
        <div>
          <h2 className="text-lg font-semibold">Theme colors</h2>
          <p className="text-xs text-text-muted">
            Used on your public page&apos;s buttons, accents, and
            reservation CTA. Matches the picker you&apos;ll see in
            Settings → Theme after you publish.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <ColorPicker label="Primary color" value={primaryColor} onChange={setPrimaryColor} />
          <ColorPicker label="Accent color" value={accentColor} onChange={setAccentColor} />
          <ColorPicker label="Background color" value={backgroundColor} onChange={setBackgroundColor} presets={BACKGROUND_PRESETS} />
        </div>
        <div>
          <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Preview</span>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated p-4">
            <div
              className={cn("flex h-9 items-center rounded-md px-4 text-sm font-medium")}
              style={{ backgroundColor: primaryColor, color: isLightHex(primaryColor) ? "#0A0A0A" : "#FFFFFF" }}
            >
              Primary button
            </div>
            <div
              className="flex h-9 items-center rounded-md border-2 px-4 text-sm font-medium"
              style={{ borderColor: primaryColor, color: primaryColor }}
            >
              Outline button
            </div>
            <div
              className="flex h-9 items-center rounded-md px-4 text-sm font-medium"
              style={{ backgroundColor: accentColor, color: isLightHex(accentColor) ? "#0A0A0A" : "#FFFFFF" }}
            >
              Accent
            </div>
            <span className="text-sm font-semibold" style={{ color: primaryColor }}>Highlighted text</span>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end">
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting} className="px-6">
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
