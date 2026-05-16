import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Renders a square 1:1 crop overlay over the diner's picked image. On Save,
// canvas-renders the cropped region to a 512×512 JPEG Blob and hands it back
// to the parent for upload. Keeps storage objects small (~100KB) regardless
// of the source file size, and gives every avatar a consistent retina-safe
// resolution across web + mobile.

const OUTPUT_SIZE_PX = 512;
const OUTPUT_QUALITY = 0.9;

type AvatarCropDialogProps = {
  open: boolean;
  sourceUrl: string | null;
  onCancel: () => void;
  onCropped: (blob: Blob) => void | Promise<void>;
};

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

async function cropImageToBlob(
  sourceUrl: string,
  pixelArea: Area,
): Promise<Blob> {
  const image = await loadImage(sourceUrl);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE_PX;
  canvas.height = OUTPUT_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    pixelArea.x,
    pixelArea.y,
    pixelArea.width,
    pixelArea.height,
    0,
    0,
    OUTPUT_SIZE_PX,
    OUTPUT_SIZE_PX,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Couldn't render the cropped image."));
      },
      "image/jpeg",
      OUTPUT_QUALITY,
    );
  });
}

export function AvatarCropDialog({ open, sourceUrl, onCancel, onCropped }: AvatarCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixelArea, setPixelArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset every time a new source file is picked.
  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixelArea(null);
      setSaving(false);
    }
  }, [open, sourceUrl]);

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setPixelArea(areaPixels);
  }, []);

  const handleSave = async () => {
    if (!sourceUrl || !pixelArea || saving) return;
    setSaving(true);
    try {
      const blob = await cropImageToBlob(sourceUrl, pixelArea);
      await onCropped(blob);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Crop your photo</DialogTitle>
          <DialogDescription>
            Drag to reposition. Use the slider to zoom in or out.
          </DialogDescription>
        </DialogHeader>
        <div className="relative h-72 w-full overflow-hidden rounded-2xl border border-border bg-bg-base">
          {sourceUrl ? (
            <Cropper
              image={sourceUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              No image loaded.
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">Zoom</p>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            disabled={saving}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-bg-elevated accent-gold disabled:opacity-50"
            aria-label="Zoom"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!pixelArea || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save photo"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
