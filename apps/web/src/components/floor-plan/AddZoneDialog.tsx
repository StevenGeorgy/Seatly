import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = { name: string };

type AddZoneDialogProps = {
  open: boolean;
  /** Suggested name pre-filled in the input (e.g. "Main Dining"). */
  defaultName?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
};

export function AddZoneDialog({
  open,
  defaultName = "",
  onOpenChange,
  onConfirm,
}: AddZoneDialogProps) {
  const { t } = useTranslation();

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("dashboard.floorPlan.zoneNameRequired"))
          .max(80, t("dashboard.floorPlan.zoneNameTooLong")),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: defaultName },
  });

  // Sync default name whenever the dialog opens
  useEffect(() => {
    if (open) reset({ name: defaultName });
    else reset({ name: "" });
  }, [open, defaultName, reset]);

  function submit(values: FormValues) {
    onConfirm(values.name.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit(submit)}>
          <DialogHeader>
            <DialogTitle>{t("dashboard.floorPlan.addZoneDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.floorPlan.addZoneDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="zone-name">{t("dashboard.floorPlan.zoneNameLabel")}</Label>
            <Input
              id="zone-name"
              autoComplete="off"
              autoFocus
              placeholder={t("dashboard.floorPlan.zoneNamePlaceholder")}
              aria-invalid={errors.name ? "true" : "false"}
              {...register("name")}
            />
            {errors.name?.message ? (
              <p className="text-xs text-danger">{errors.name.message}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit">
              {t("dashboard.floorPlan.addZoneConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
