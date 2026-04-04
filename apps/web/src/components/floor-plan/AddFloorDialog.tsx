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

type AddFloorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => Promise<void>;
  isPending: boolean;
};

export function AddFloorDialog({ open, onOpenChange, onConfirm, isPending }: AddFloorDialogProps) {
  const { t } = useTranslation();

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("dashboard.floorPlan.floorNameRequired"))
          .max(80, t("dashboard.floorPlan.floorNameTooLong")),
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
    defaultValues: { name: "" },
  });

  useEffect(() => {
    if (!open) reset({ name: "" });
  }, [open, reset]);

  async function submit(values: FormValues) {
    await onConfirm(values.name.trim());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!isPending}>
        <form onSubmit={handleSubmit(submit)}>
          <DialogHeader>
            <DialogTitle>{t("dashboard.floorPlan.addFloorDialogTitle")}</DialogTitle>
            <DialogDescription>{t("dashboard.floorPlan.addFloorDialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="floor-name">{t("dashboard.floorPlan.floorNameLabel")}</Label>
            <Input
              id="floor-name"
              autoComplete="off"
              placeholder={t("dashboard.floorPlan.floorNamePlaceholder")}
              disabled={isPending}
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
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t("dashboard.floorPlan.addFloor")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
