import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface HoldExpiredDialogProps {
  open: boolean;
  restaurantName: string;
  conflictReason: "slot_taken" | "over_cap" | "diner_double_book" | null;
  grabbing: boolean;
  onGrabAgain: () => Promise<void>;
  onPickDifferentTime: () => void;
}

export function HoldExpiredDialog({
  open,
  restaurantName,
  conflictReason,
  grabbing,
  onGrabAgain,
  onPickDifferentTime,
}: HoldExpiredDialogProps) {
  const cantGrab = conflictReason !== null;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Your hold ended</DialogTitle>
          <DialogDescription>
            {cantGrab
              ? `Someone just grabbed that table at ${restaurantName}. Pick another time to keep going.`
              : `Tables go fast at ${restaurantName}. Want to try locking it in again?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onPickDifferentTime}>
            Pick a different time
          </Button>
          {!cantGrab && (
            <Button onClick={() => void onGrabAgain()} disabled={grabbing}>
              {grabbing ? "Grabbing…" : "Grab it again"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
