import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Plus, Bell, Armchair, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useWaitlist } from "@/hooks/useWaitlist";

export default function WaitlistPage() {
  const { t } = useTranslation();
  const { entries, loading, addEntry, notifyEntry, seatEntry, removeEntry } = useWaitlist();

  const [addOpen, setAddOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Add guest form
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [waitMinutes, setWaitMinutes] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => { setGuestName(""); setPhone(""); setPartySize("2"); setWaitMinutes(""); };

  const handleAdd = async () => {
    if (!guestName.trim()) { toast.error("Guest name is required."); return; }
    setSaving(true);
    try {
      await addEntry({
        guest_name: guestName.trim(),
        phone: phone.trim(),
        party_size: Math.max(1, parseInt(partySize) || 1),
        estimated_wait_minutes: waitMinutes ? parseInt(waitMinutes) : undefined,
      });
      toast.success("Guest added to waitlist.");
      setAddOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to add guest.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeEntry(id);
      toast.success("Removed from waitlist.");
    } catch {
      toast.error("Failed to remove.");
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.waitlist.title")}
        actions={
          <Button size="default" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            {t("dashboard.waitlist.addGuest")}
          </Button>
        }
      />

      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Clock className="size-5" />}
            title={t("dashboard.waitlist.noEntries")}
            description={t("dashboard.waitlist.noEntriesDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {entries.map((entry, i) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10, height: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-gold/10 text-sm font-bold text-gold">
                    {entry.position}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {entry.guest_name ?? "\u2014"}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{entry.party_size} guests</span>
                      {entry.estimated_wait_minutes ? (
                        <>
                          <span>·</span>
                          <span>~{entry.estimated_wait_minutes} {t("dashboard.waitlist.minutes")}</span>
                        </>
                      ) : null}
                      {entry.notified_at ? (
                        <>
                          <span>·</span>
                          <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">Notified</span>
                        </>
                      ) : null}
                      {entry.remote_join ? (
                        <>
                          <span>·</span>
                          <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">
                            {t("dashboard.waitlist.remoteJoin")}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("dashboard.waitlist.notify")}
                      disabled={!!entry.notified_at}
                      onClick={() => void notifyEntry(entry.id).then(() => toast.success("Guest notified."))}
                    >
                      <Bell className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("dashboard.waitlist.seatNow")}
                      onClick={() => void seatEntry(entry.id).then(() => toast.success("Guest seated."))}
                    >
                      <Armchair className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-danger hover:text-danger"
                      title={t("dashboard.waitlist.remove")}
                      onClick={() => setConfirmId(entry.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>

      {/* Add Guest Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.waitlist.addGuest")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Guest name *</Label>
              <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Phone</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Party size</Label>
                <Input type="number" min="1" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Est. wait (minutes)</Label>
                <Input type="number" min="0" value={waitMinutes} onChange={(e) => setWaitMinutes(e.target.value)} placeholder="30" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
            <Button disabled={saving} onClick={() => void handleAdd()}>
              {saving ? "Adding…" : "Add to Waitlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirm Dialog */}
      <Dialog open={!!confirmId} onOpenChange={(o) => { if (!o) setConfirmId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove from waitlist?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">This guest will be removed from the waitlist. This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmId && void handleRemove(confirmId)}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
