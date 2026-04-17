import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Plus, Mail, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useStaffRoster, type StaffMemberRow } from "@/hooks/useStaffRoster";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { useUser } from "@/hooks/useUser";

const ROLES = ["owner", "manager", "server", "host", "kitchen", "bartender"] as const;
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;

export default function StaffPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { profile } = useUser();
  const { members, loading, refetch } = useStaffRoster();

  const [addOpen, setAddOpen] = useState(false);
  const [editMember, setEditMember] = useState<StaffMemberRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("server");
  const [employmentType, setEmploymentType] = useState<string>("full_time");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = () => { setEmail(""); setRole("server"); setEmploymentType("full_time"); setHourlyRate(""); };

  const openAdd = () => { setEditMember(null); resetForm(); setAddOpen(true); };
  const openEdit = (m: StaffMemberRow) => {
    setEditMember(m);
    setRole(m.role);
    setEmploymentType(m.employment_type ?? "full_time");
    setHourlyRate(m.hourly_rate != null ? String(m.hourly_rate) : "");
    setAddOpen(true);
  };

  const handleSave = async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;
    setSaving(true);
    const client = getSupabaseBrowserClient();

    if (editMember) {
      const { error } = await client
        .from("user_restaurant_roles")
        .update({
          role,
          employment_type: employmentType,
          hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        })
        .eq("id", editMember.id);
      if (error) { toast.error("Could not update staff member."); setSaving(false); return; }
      toast.success("Staff member updated.");
    } else {
      if (!email.trim()) { toast.error("Email is required."); setSaving(false); return; }
      // Look up user_profiles by email
      const { data: profileRows, error: lookupErr } = await client
        .from("user_profiles")
        .select("id")
        .eq("email", email.trim())
        .maybeSingle();

      if (lookupErr) { toast.error("Lookup failed: " + lookupErr.message); setSaving(false); return; }
      if (!profileRows) {
        toast.error("No user found with that email. Ask them to sign up first.");
        setSaving(false);
        return;
      }

      const { error } = await client.from("user_restaurant_roles").insert({
        user_id: profileRows.id,
        restaurant_id: selectedRestaurantId,
        role,
        employment_type: employmentType,
        hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        is_primary: false,
      });
      if (error) {
        toast.error(error.code === "23505" ? "This user is already on your staff." : "Could not add staff member.");
        setSaving(false);
        return;
      }
      toast.success("Staff member added.");
    }

    setSaving(false);
    setAddOpen(false);
    resetForm();
    void refetch();
  };

  const handleRemove = async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("user_restaurant_roles").delete().eq("id", id);
    if (error) { toast.error("Could not remove staff member."); return; }
    toast.success("Staff member removed.");
    setDeleteId(null);
    void refetch();
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.staff.title")}
        actions={
          <Button size="default" className="gap-2" onClick={openAdd}>
            <Plus className="size-4" />
            {t("dashboard.staff.addStaff")}
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
        ) : members.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={t("dashboard.staff.noStaff")}
            description={t("dashboard.staff.noStaffDesc")}
            action={
              <Button size="default" className="gap-2" onClick={openAdd}>
                <Mail className="size-4" />
                {t("dashboard.staff.addStaff")}
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {members.map((member, i) => {
              const name = member.user_profiles?.full_name ?? member.user_profiles?.email ?? "\u2014";
              const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const isCurrentUser = member.user_profiles?.email === profile?.email;

              return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.03 }}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <Avatar className="size-10 border border-border">
                    <AvatarImage src={member.user_profiles?.avatar_url ?? undefined} alt={name} />
                    <AvatarFallback className="bg-bg-elevated text-xs font-semibold text-text-secondary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">{name}</span>
                    <span className="truncate text-xs text-text-muted">
                      {member.user_profiles?.email}
                    </span>
                  </div>
                  <StatusBadge status="active" label={member.role} />
                  {member.employment_type ? (
                    <span className="hidden text-xs capitalize text-text-muted sm:block">
                      {member.employment_type.replace("_", " ")}
                    </span>
                  ) : null}
                  {member.hourly_rate ? (
                    <span className="hidden text-sm font-medium text-text-secondary sm:block">
                      {formatCurrency(member.hourly_rate, currency)}/hr
                    </span>
                  ) : null}
                  {!isCurrentUser && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="opacity-0 transition-opacity group-hover:opacity-100">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(member)}>
                          <Pencil className="mr-2 size-3.5" /> Edit role & rate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteId(member.id)}
                        >
                          <Trash2 className="mr-2 size-3.5" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Add/Edit Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editMember ? "Edit Staff Member" : t("dashboard.staff.addStaff")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {!editMember && (
              <div className="flex flex-col gap-2">
                <Label>Email address *</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" />
                <p className="text-xs text-text-muted">The user must already have a Cenaiva account.</p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Employment type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((et) => (
                      <SelectItem key={et} value={et} className="capitalize">{et.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Hourly rate ({currency.toUpperCase()})</Label>
                <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="0.00" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
            <Button disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : editMember ? "Save Changes" : "Add Staff Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirm Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove staff member?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">They will lose access to this restaurant's dashboard.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && void handleRemove(deleteId)}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
