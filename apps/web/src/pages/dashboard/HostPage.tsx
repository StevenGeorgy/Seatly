import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import {
  BarChart3,
  Clock3,
  Crown,
  Mail,
  MessageSquareText,
  MoreVertical,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useHostInvites, type HostInviteRow } from "@/hooks/useHostInvites";
import { useStaffRoster, type StaffMemberRow } from "@/hooks/useStaffRoster";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils";
import type { DashboardPermissionKey, DashboardPermissionOverrides, StaffRole } from "@/types/auth";

const contactPattern = /(^[^\s@]+@[^\s@]+\.[^\s@]+$)|(^\+?[\d\s().-]{10,}$)/;
type InviteRole = Extract<StaffRole, "owner" | "manager" | "host">;

type InviteFormValues = {
  contact: string;
};

const ROLE_OPTIONS: Array<{ value: InviteRole; labelKey: string; descKey: string }> = [
  { value: "owner", labelKey: "dashboard.host.roleOwner", descKey: "dashboard.host.ownerPresetDesc" },
  { value: "manager", labelKey: "dashboard.host.roleManager", descKey: "dashboard.host.managerPresetDesc" },
  { value: "host", labelKey: "dashboard.host.roleHost", descKey: "dashboard.host.hostPresetDesc" },
];

const PERMISSION_OPTIONS: Array<{ key: DashboardPermissionKey; labelKey: string }> = [
  { key: "overview", labelKey: "dashboard.host.permissionOverview" },
  { key: "reservations", labelKey: "dashboard.host.permissionReservations" },
  { key: "floorPlan", labelKey: "dashboard.host.permissionFloorPlan" },
  { key: "hostView", labelKey: "dashboard.host.permissionHostView" },
  { key: "staffInvites", labelKey: "dashboard.host.permissionStaffInvites" },
  { key: "orders", labelKey: "dashboard.host.permissionOrders" },
  { key: "menu", labelKey: "dashboard.host.permissionMenu" },
  { key: "crm", labelKey: "dashboard.host.permissionCrm" },
  { key: "analytics", labelKey: "dashboard.host.permissionAnalytics" },
  { key: "expenses", labelKey: "dashboard.host.permissionExpenses" },
  { key: "events", labelKey: "dashboard.host.permissionEvents" },
  { key: "promotions", labelKey: "dashboard.host.permissionPromotions" },
  { key: "export", labelKey: "dashboard.host.permissionExport" },
  { key: "restaurant", labelKey: "dashboard.host.permissionRestaurant" },
  { key: "settings", labelKey: "dashboard.host.permissionSettings" },
];

const ROLE_PRESETS: Record<InviteRole, DashboardPermissionKey[]> = {
  owner: PERMISSION_OPTIONS.map((option) => option.key),
  manager: [
    "overview",
    "reservations",
    "floorPlan",
    "staffInvites",
    "orders",
    "menu",
    "crm",
    "analytics",
    "expenses",
    "events",
    "promotions",
    "restaurant",
    "settings",
  ],
  host: ["reservations", "floorPlan", "hostView"],
};

const INVITABLE_ROLES = new Set<StaffRole>(ROLE_OPTIONS.map((option) => option.value));

function isInviteRole(role: string): role is InviteRole {
  return ROLE_OPTIONS.some((option) => option.value === role);
}

function roleLabelKey(role: StaffRole): string {
  if (role === "owner") return "dashboard.host.roleOwner";
  if (role === "manager") return "dashboard.host.roleManager";
  return "dashboard.host.roleHost";
}

function permissionOverridesForRole(
  role: InviteRole,
  selectedPermissions: DashboardPermissionKey[],
): DashboardPermissionOverrides {
  const preset = new Set(ROLE_PRESETS[role]);
  const selected = new Set(selectedPermissions);
  const allow = selectedPermissions.filter((key) => !preset.has(key));
  const deny = ROLE_PRESETS[role].filter((key) => !selected.has(key));
  return {
    ...(allow.length > 0 ? { allow } : {}),
    ...(deny.length > 0 ? { deny } : {}),
  };
}

function accessForRole(
  role: InviteRole,
  permissionOverrides: DashboardPermissionOverrides = {},
): DashboardPermissionKey[] {
  const preset = new Set(ROLE_PRESETS[role]);
  const allow: DashboardPermissionKey[] = permissionOverrides.allow ?? [];
  const deny: DashboardPermissionKey[] = permissionOverrides.deny ?? [];
  allow.forEach((key) => preset.add(key));
  deny.forEach((key) => preset.delete(key));
  return PERMISSION_OPTIONS.map((option) => option.key).filter((key) => preset.has(key));
}

function accessForInvite(invite: HostInviteRow): DashboardPermissionKey[] {
  return accessForRole(
    isInviteRole(invite.role) ? invite.role : "host",
    invite.permission_overrides_json,
  );
}

function accessForMember(member: StaffMemberRow): DashboardPermissionKey[] {
  return accessForRole(
    isInviteRole(member.role) ? member.role : "host",
    member.permission_overrides_json ?? {},
  );
}

function hasPermissionOverrides(permissionOverrides?: DashboardPermissionOverrides): boolean {
  return Boolean(permissionOverrides?.allow?.length || permissionOverrides?.deny?.length);
}

function managementRoleFor(roles: Array<{ role: StaffRole }>): Extract<StaffRole, "owner" | "manager"> | null {
  if (roles.some((item) => item.role === "owner")) return "owner";
  if (roles.some((item) => item.role === "manager")) return "manager";
  return null;
}

function initialsFor(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function contactLabel(invite: HostInviteRow): string {
  return invite.email ?? invite.phone ?? "-";
}

export default function HostPage() {
  const { t } = useTranslation();
  const { selectedRestaurantId } = useRestaurantScope();
  const { profile, rolesAtRestaurant } = useUser();
  const { invites, loading: invitesLoading, sendInvite, resendInvite, cancelInvite } =
    useHostInvites();
  const {
    members,
    loading: rosterLoading,
    updateMemberAccess,
    removeMemberAccess,
  } = useStaffRoster({ includeMock: false });
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<StaffMemberRow | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<StaffMemberRow | null>(null);
  const [role, setRole] = useState<InviteRole>("host");
  const [customizePermissions, setCustomizePermissions] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<DashboardPermissionKey[]>(
    ROLE_PRESETS.host,
  );
  const [editRole, setEditRole] = useState<InviteRole>("host");
  const [editCustomizePermissions, setEditCustomizePermissions] = useState(false);
  const [editSelectedPermissions, setEditSelectedPermissions] = useState<DashboardPermissionKey[]>(
    ROLE_PRESETS.host,
  );

  const schema = useMemo(
    () =>
      z.object({
        contact: z
          .string()
          .trim()
          .min(1, t("dashboard.host.contactRequired"))
          .max(120, t("dashboard.host.contactTooLong"))
          .refine((value) => contactPattern.test(value), t("dashboard.host.invalidContact")),
      }),
    [t],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { contact: "" },
  });

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );
  const activeStaff = useMemo(
    () =>
      members.filter(
        (member) =>
          member.restaurant_id &&
          INVITABLE_ROLES.has(member.role as StaffRole) &&
          member.user_profiles,
      ),
    [members],
  );
  const presetPermissions = ROLE_PRESETS[role];
  const effectivePermissions = customizePermissions ? selectedPermissions : presetPermissions;
  const selectedRole = ROLE_OPTIONS.find((option) => option.value === role) ?? ROLE_OPTIONS[2];
  const currentManagementRole = useMemo(
    () => managementRoleFor(selectedRestaurantId ? rolesAtRestaurant(selectedRestaurantId) : []),
    [rolesAtRestaurant, selectedRestaurantId],
  );
  const editableRoleOptions = useMemo(
    () =>
      currentManagementRole === "owner"
        ? ROLE_OPTIONS
        : ROLE_OPTIONS.filter((option) => option.value === "host"),
    [currentManagementRole],
  );
  const editPresetPermissions = ROLE_PRESETS[editRole];
  const editEffectivePermissions = editCustomizePermissions
    ? editSelectedPermissions
    : editPresetPermissions;
  const editSelectedRole =
    ROLE_OPTIONS.find((option) => option.value === editRole) ?? ROLE_OPTIONS[2];

  const handleRoleChange = (nextRole: string) => {
    const parsedRole = (ROLE_OPTIONS.some((option) => option.value === nextRole)
      ? nextRole
      : "host") as InviteRole;
    setRole(parsedRole);
    setSelectedPermissions(ROLE_PRESETS[parsedRole]);
  };

  const togglePermission = (permission: DashboardPermissionKey, checked: boolean) => {
    setSelectedPermissions((current) => {
      if (checked) return [...new Set([...current, permission])];
      return current.filter((key) => key !== permission);
    });
  };

  const toggleEditPermission = (permission: DashboardPermissionKey, checked: boolean) => {
    setEditSelectedPermissions((current) => {
      if (checked) return [...new Set([...current, permission])];
      return current.filter((key) => key !== permission);
    });
  };

  const canManageMember = (member: StaffMemberRow): boolean => {
    if (profile?.id && member.user_id === profile.id) return false;
    if (currentManagementRole === "owner") return true;
    return currentManagementRole === "manager" && member.role === "host";
  };

  const openEditMember = (member: StaffMemberRow) => {
    const memberRole = isInviteRole(member.role) ? member.role : "host";
    setEditingMember(member);
    setEditRole(memberRole);
    setEditCustomizePermissions(hasPermissionOverrides(member.permission_overrides_json));
    setEditSelectedPermissions(accessForMember(member));
  };

  const handleEditRoleChange = (nextRole: string) => {
    const parsedRole = isInviteRole(nextRole) ? nextRole : "host";
    setEditRole(parsedRole);
    setEditSelectedPermissions(ROLE_PRESETS[parsedRole]);
  };

  const closeEditDialog = () => {
    setEditingMember(null);
    setEditRole("host");
    setEditCustomizePermissions(false);
    setEditSelectedPermissions(ROLE_PRESETS.host);
  };

  const handleSaveMemberAccess = async () => {
    if (!editingMember) return;
    setBusyMemberId(editingMember.id);
    const result = await updateMemberAccess(
      editingMember.id,
      editRole,
      editCustomizePermissions
        ? permissionOverridesForRole(editRole, editEffectivePermissions)
        : {},
    );
    setBusyMemberId(null);

    if (result.ok) {
      toast.success(t("dashboard.host.staffAccessUpdated"));
      closeEditDialog();
      return;
    }

    toast.error(result.error ?? t("dashboard.host.staffAccessUpdateFailed"));
  };

  const handleRemoveMemberAccess = async () => {
    if (!memberToRemove) return;
    setBusyMemberId(memberToRemove.id);
    const result = await removeMemberAccess(memberToRemove.id);
    setBusyMemberId(null);

    if (result.ok) {
      toast.success(t("dashboard.host.staffAccessRemoved"));
      setMemberToRemove(null);
      return;
    }

    toast.error(result.error ?? t("dashboard.host.staffAccessRemoveFailed"));
  };

  const onSubmit = async (values: InviteFormValues) => {
    const result = await sendInvite(
      values.contact,
      role,
      customizePermissions
        ? permissionOverridesForRole(role, effectivePermissions)
        : {},
    );
    if (result.ok) {
      toast.success(t("dashboard.host.inviteSent"));
      reset();
      setRole("host");
      setCustomizePermissions(false);
      setSelectedPermissions(ROLE_PRESETS.host);
      return;
    }
    if (result.setupRequired) {
      toast.info(t("dashboard.host.inviteQueued"));
      reset();
      setRole("host");
      setCustomizePermissions(false);
      setSelectedPermissions(ROLE_PRESETS.host);
      return;
    }
    toast.error(result.error ?? t("dashboard.host.inviteFailed"));
  };

  const handleResend = async (inviteId: string) => {
    setBusyInviteId(inviteId);
    const result = await resendInvite(inviteId);
    setBusyInviteId(null);
    if (result.ok) {
      toast.success(t("dashboard.host.resendSent"));
    } else if (result.setupRequired) {
      toast.info(t("dashboard.host.inviteQueued"));
    } else {
      toast.error(result.error ?? t("dashboard.host.inviteFailed"));
    }
  };

  const handleCancel = async (inviteId: string) => {
    setBusyInviteId(inviteId);
    const result = await cancelInvite(inviteId);
    setBusyInviteId(null);
    if (result.ok) {
      toast.success(t("dashboard.host.cancelSuccess"));
    } else {
      toast.error(result.error ?? t("dashboard.host.cancelFailed"));
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.host.title")}
        description={t("dashboard.host.description")}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.92fr)_minmax(0,1.08fr)]">
        <SectionCard className="overflow-hidden" noPadding>
          <div className="border-b border-border bg-bg-elevated/40 p-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold">
                <UserPlus className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  {t("dashboard.host.inviteTitle")}
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {t("dashboard.host.inviteDescription")}
                </p>
              </div>
            </div>
          </div>

          <form className="space-y-4 p-5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-2">
              <Label>{t("dashboard.host.roleLabel")}</Label>
              <Select value={role} onValueChange={handleRoleChange}>
                <SelectTrigger className="h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Controller
              control={control}
              name="contact"
              render={({ field }) => (
                <div className="space-y-2">
                  <Label htmlFor="host-contact">{t("dashboard.host.contactLabel")}</Label>
                  <div className="relative">
                    <Input
                      id="host-contact"
                      className="h-12 pl-10"
                      placeholder={t("dashboard.host.contactPlaceholder")}
                      aria-invalid={errors.contact ? true : undefined}
                      {...field}
                    />
                    <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  </div>
                  {errors.contact ? (
                    <p className="text-sm text-danger" role="alert">
                      {errors.contact.message}
                    </p>
                  ) : (
                    <p className="text-xs text-text-muted">
                      {t("dashboard.host.contactHelp")}
                    </p>
                  )}
                </div>
              )}
            />
            <div className="rounded-xl border border-border bg-bg-elevated/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {t("dashboard.host.presetTitle")}: {t(selectedRole.labelKey)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">
                    {t(selectedRole.descKey)}
                  </p>
                </div>
                <RoleIcon role={role} />
              </div>
              <PermissionPills permissions={effectivePermissions} />
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="customize-permissions">
                    {t("dashboard.host.customizePermissions")}
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    {t("dashboard.host.customizePermissionsDesc")}
                  </p>
                </div>
                <Switch
                  id="customize-permissions"
                  checked={customizePermissions}
                  onCheckedChange={setCustomizePermissions}
                />
              </div>
              {customizePermissions ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {PERMISSION_OPTIONS.map((permission) => (
                    <label
                      key={permission.key}
                      className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2 text-sm text-text-secondary"
                    >
                      <Checkbox
                        checked={selectedPermissions.includes(permission.key)}
                        onCheckedChange={(checked) =>
                          togglePermission(permission.key, checked === true)
                        }
                      />
                      {t(permission.labelKey)}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            <Button className="w-full" disabled={isSubmitting} type="submit">
              <Send className="size-4" />
              {t("dashboard.host.sendInvite")}
            </Button>
          </form>
        </SectionCard>

        <SectionCard title={t("dashboard.host.activeTitle")} noPadding>
          {rosterLoading ? (
            <LoadingRows />
          ) : activeStaff.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title={t("dashboard.host.noHosts")}
              description={t("dashboard.host.noHostsDesc")}
            />
          ) : (
            <div className="divide-y divide-border">
              {activeStaff.map((host) => {
                const name = host.user_profiles?.full_name ?? host.user_profiles?.email ?? "-";
                const subtitle = host.user_profiles?.email ?? host.user_profiles?.phone ?? "-";
                return (
                  <div
                    key={host.id}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/40"
                  >
                    <Avatar className="size-11 border border-border">
                      <AvatarImage src={host.user_profiles?.avatar_url ?? undefined} alt={name} />
                      <AvatarFallback className="bg-bg-elevated text-xs font-semibold text-text-secondary">
                        {initialsFor(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
                      <p className="truncate text-xs text-text-muted">{subtitle}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                        <ShieldCheck className="size-3" />
                        {t(roleLabelKey(host.role as StaffRole))}
                      </Badge>
                      {canManageMember(host) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              aria-label={t("dashboard.host.staffActions")}
                              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:pointer-events-none disabled:opacity-50"
                              disabled={busyMemberId === host.id}
                              type="button"
                            >
                              <MoreVertical className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditMember(host)}>
                              <Pencil className="mr-2 size-3.5" />
                              {t("dashboard.host.editStaffAccess")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger focus:text-danger"
                              onClick={() => setMemberToRemove(host)}
                            >
                              <Trash2 className="mr-2 size-3.5" />
                              {t("dashboard.host.removeStaffAccess")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title={t("dashboard.host.pendingTitle")} noPadding>
        {invitesLoading ? (
          <LoadingRows />
        ) : pendingInvites.length === 0 ? (
          <EmptyState
            icon={<Clock3 className="size-5" />}
            title={t("dashboard.host.noPending")}
            description={t("dashboard.host.noPendingDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            {pendingInvites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                busy={busyInviteId === invite.id}
                onResend={() => void handleResend(invite.id)}
                onCancel={() => void handleCancel(invite.id)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog
        open={Boolean(editingMember)}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.host.editStaffAccessTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">
                {editingMember?.user_profiles?.full_name ??
                  editingMember?.user_profiles?.email ??
                  t("dashboard.host.staffMemberFallback")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {editingMember?.user_profiles?.email ?? editingMember?.user_profiles?.phone ?? ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("dashboard.host.roleLabel")}</Label>
              <Select value={editRole} onValueChange={handleEditRoleChange}>
                <SelectTrigger className="h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editableRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    {t("dashboard.host.presetTitle")}: {t(editSelectedRole.labelKey)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">
                    {t(editSelectedRole.descKey)}
                  </p>
                </div>
                <RoleIcon role={editRole} />
              </div>
              <PermissionPills permissions={editEffectivePermissions} />
            </div>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="edit-customize-permissions">
                    {t("dashboard.host.customizePermissions")}
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    {t("dashboard.host.customizePermissionsDesc")}
                  </p>
                </div>
                <Switch
                  id="edit-customize-permissions"
                  checked={editCustomizePermissions}
                  onCheckedChange={setEditCustomizePermissions}
                />
              </div>
              {editCustomizePermissions ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {PERMISSION_OPTIONS.map((permission) => (
                    <label
                      key={permission.key}
                      className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2 text-sm text-text-secondary"
                    >
                      <Checkbox
                        checked={editSelectedPermissions.includes(permission.key)}
                        onCheckedChange={(checked) =>
                          toggleEditPermission(permission.key, checked === true)
                        }
                      />
                      {t(permission.labelKey)}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={Boolean(busyMemberId)}
              onClick={closeEditDialog}
              type="button"
              variant="outline"
            >
              {t("dashboard.host.cancelEditStaffAccess")}
            </Button>
            <Button
              disabled={Boolean(busyMemberId)}
              onClick={() => void handleSaveMemberAccess()}
              type="button"
            >
              {busyMemberId === editingMember?.id
                ? t("dashboard.host.savingStaffAccess")
                : t("dashboard.host.saveStaffAccess")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(memberToRemove)}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("dashboard.host.removeStaffAccessTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-text-secondary">
            {t("dashboard.host.removeStaffAccessDesc", {
              name:
                memberToRemove?.user_profiles?.full_name ??
                memberToRemove?.user_profiles?.email ??
                t("dashboard.host.staffMemberFallback"),
            })}
          </p>
          <DialogFooter>
            <Button
              disabled={Boolean(busyMemberId)}
              onClick={() => setMemberToRemove(null)}
              type="button"
              variant="outline"
            >
              {t("dashboard.host.keepStaffAccess")}
            </Button>
            <Button
              disabled={Boolean(busyMemberId)}
              onClick={() => void handleRemoveMemberAccess()}
              type="button"
              variant="destructive"
            >
              {busyMemberId === memberToRemove?.id
                ? t("dashboard.host.removingStaffAccess")
                : t("dashboard.host.confirmRemoveStaffAccess")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

function RoleIcon({ role }: { role: InviteRole }) {
  const className = "size-5";
  if (role === "owner") return <Crown className={className} />;
  if (role === "manager") return <BarChart3 className={className} />;
  return <Users className={className} />;
}

function PermissionPills({ permissions }: { permissions: DashboardPermissionKey[] }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {permissions.map((permission) => {
        const option = PERMISSION_OPTIONS.find((item) => item.key === permission);
        return (
          <Badge key={permission} className="border-gold/30 bg-gold/10 text-gold" variant="outline">
            {option ? t(option.labelKey) : permission}
          </Badge>
        );
      })}
    </div>
  );
}

function InviteRow({
  invite,
  busy,
  onResend,
  onCancel,
}: {
  invite: HostInviteRow;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isSms = invite.message_channel === "sms";
  const deliveryLabel = {
    created: t("dashboard.host.deliveryCreated"),
    sent: t("dashboard.host.deliverySent"),
    setup_required: t("dashboard.host.deliverySetupRequired"),
    failed: t("dashboard.host.deliveryFailed"),
  }[invite.delivery_status];
  const deliveryClass = cn(
    "border-border bg-bg-elevated text-text-secondary",
    invite.delivery_status === "sent" && "border-success/30 bg-success/10 text-success",
    invite.delivery_status === "setup_required" && "border-warning/30 bg-warning/10 text-warning",
    invite.delivery_status === "failed" && "border-danger/30 bg-danger/10 text-danger",
  );
  const invitePermissions = accessForInvite(invite);

  return (
    <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-elevated text-text-secondary">
          {isSms ? <MessageSquareText className="size-5" /> : <Mail className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-primary">{contactLabel(invite)}</p>
            <Badge className="border-gold/30 bg-gold/10 text-gold" variant="outline">
              {t(roleLabelKey(invite.role))}
            </Badge>
            <Badge variant="outline">
              {isSms ? t("dashboard.host.smsInvite") : t("dashboard.host.emailInvite")}
            </Badge>
            <Badge className={deliveryClass} variant="outline">
              {deliveryLabel}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("dashboard.host.expires", {
              date: format(new Date(invite.expires_at), "MMM d, yyyy"),
            })}
          </p>
          {invite.delivery_error ? (
            <p className="mt-2 break-words text-xs text-warning">{invite.delivery_error}</p>
          ) : null}
          <PermissionPills permissions={invitePermissions} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button disabled={busy} onClick={onResend} size="sm" type="button" variant="outline">
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          {t("dashboard.host.resendInvite")}
        </Button>
        <Button
          className="text-text-primary hover:bg-danger/10 hover:text-danger"
          disabled={busy}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" />
          {t("dashboard.host.cancelInvite")}
        </Button>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
