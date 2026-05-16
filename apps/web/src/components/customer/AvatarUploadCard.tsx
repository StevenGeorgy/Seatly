import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AvatarCropDialog } from "@/components/customer/AvatarCropDialog";
import { useUpdateProfile } from "@/hooks/useUpdateProfile";
import { useUser } from "@/hooks/useUser";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const AVATAR_BUCKET = "user-avatars";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Extracts the storage path back out of a public-bucket URL so we can clean
// up the old avatar object when uploading a replacement. The public URL shape
// is `${SUPABASE_URL}/storage/v1/object/public/user-avatars/<path>` — anything
// else we return null and skip the cleanup (best-effort).
function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

export function AvatarUploadCard() {
  const { user, profile } = useUser();
  const { updateProfile } = useUpdateProfile();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedSourceUrl, setPickedSourceUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  const initials = initialsFromName(profile?.full_name ?? user?.email ?? null);
  const currentAvatarUrl = profile?.avatar_url ?? null;

  const handlePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Reset the input so picking the same file twice in a row still fires onChange.
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) {
      toast.error("Please pick a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (!assertImageSizeOk(file)) return;
    const objectUrl = URL.createObjectURL(file);
    setPickedSourceUrl(objectUrl);
  };

  const handleCancelCrop = () => {
    if (pickedSourceUrl) URL.revokeObjectURL(pickedSourceUrl);
    setPickedSourceUrl(null);
  };

  const handleCropped = async (blob: Blob) => {
    if (!user?.id) {
      toast.error("Sign in required.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setUploading(true);
    try {
      const client = getSupabaseBrowserClient();
      const previousPath = pathFromPublicUrl(currentAvatarUrl);
      const path = `${user.id}/avatar-${crypto.randomUUID()}.jpg`;
      const { error: uploadErr } = await client.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, {
          cacheControl: "3600",
          contentType: "image/jpeg",
          upsert: false,
        });
      if (uploadErr) {
        toast.error("Couldn't upload the photo: " + uploadErr.message);
        return;
      }
      const { data: publicUrlData } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = publicUrlData?.publicUrl;
      if (!publicUrl) {
        toast.error("Couldn't resolve the photo URL.");
        return;
      }
      await updateProfile({
        full_name: profile?.full_name ?? "",
        email: profile?.email ?? user.email ?? "",
        phone: profile?.phone ?? "",
        dietary_restrictions: profile?.dietary_restrictions ?? [],
        allergies: profile?.allergies ?? [],
        avatar_url: publicUrl,
      });
      // Best-effort cleanup of the prior object. Failure is non-fatal.
      if (previousPath) {
        await client.storage.from(AVATAR_BUCKET).remove([previousPath]).catch(() => {});
      }
      if (pickedSourceUrl) URL.revokeObjectURL(pickedSourceUrl);
      setPickedSourceUrl(null);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!profile?.id || removing) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setRemoving(true);
    try {
      const client = getSupabaseBrowserClient();
      const previousPath = pathFromPublicUrl(currentAvatarUrl);
      await updateProfile({
        full_name: profile.full_name ?? "",
        email: profile.email ?? user?.email ?? "",
        phone: profile.phone ?? "",
        dietary_restrictions: profile.dietary_restrictions ?? [],
        allergies: profile.allergies ?? [],
        avatar_url: null,
      });
      if (previousPath) {
        await client.storage.from(AVATAR_BUCKET).remove([previousPath]).catch(() => {});
      }
    } finally {
      setRemoving(false);
    }
  };

  const busy = uploading || removing;

  return (
    <>
      <div className="rounded-2xl border border-border bg-bg-surface p-6">
        <div className="flex items-start gap-5">
          <Avatar className="size-20 shrink-0 border border-gold/30">
            <AvatarImage src={currentAvatarUrl ?? undefined} alt="Profile photo" />
            <AvatarFallback className="bg-gold/10 text-2xl font-semibold text-gold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-lg text-white">Profile photo</p>
            <p className="mt-1 text-xs text-text-secondary">
              Shows up next to your reviews and snaps across the web and mobile apps.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handlePick}
                disabled={busy}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Camera className="mr-1.5 size-3.5" />
                    {currentAvatarUrl ? "Change photo" : "Add a photo"}
                  </>
                )}
              </Button>
              {currentAvatarUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRemove()}
                  disabled={busy}
                  className="text-text-muted hover:text-destructive"
                >
                  {removing ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 size-3.5" />
                  )}
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <AvatarCropDialog
        open={Boolean(pickedSourceUrl)}
        sourceUrl={pickedSourceUrl}
        onCancel={handleCancelCrop}
        onCropped={handleCropped}
      />
    </>
  );
}
