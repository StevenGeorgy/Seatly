import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Building2,
  Clock,
  LayoutGrid,
  Users,
  Settings,
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  Trash2,
  UserPlus,
  X,
  Circle,
  Square,
  RectangleHorizontal,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// ─── Constants ───────────────────────────────────────────────────────────────
const STEPS = [
  { icon: Building2, labelKey: "Restaurant" },
  { icon: Clock,     labelKey: "Hours"      },
  { icon: LayoutGrid, labelKey: "Tables"    },
  { icon: Users,     labelKey: "Team"       },
  { icon: Settings,  labelKey: "Settings"   },
] as const;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const mStr = m === 0 ? "00" : "30";
    TIME_OPTIONS.push(`${h12}:${mStr} ${ampm}`);
  }
}

const ROLES = ["manager", "server", "host", "kitchen", "bar", "staff"] as const;
type StaffRole = typeof ROLES[number];

const ROLE_LABELS: Record<StaffRole, string> = {
  manager: "Manager",
  server:  "Server",
  host:    "Host",
  kitchen: "Kitchen",
  bar:     "Bar",
  staff:   "Staff",
};

const TABLE_SHAPES = ["circle", "rectangle", "booth"] as const;
type TableShape = typeof TABLE_SHAPES[number];

// ─── Sub-types ───────────────────────────────────────────────────────────────
type DayHours = {
  open: boolean;
  from: string;
  to: string;
};

type TableEntry = {
  id: string;
  label: string;
  capacity: number;
  shape: TableShape;
  section: string;
};

type TeamEntry = {
  id: string;
  email: string;
  role: StaffRole;
};

// ─── Form schema ─────────────────────────────────────────────────────────────
const restaurantSchema = z.object({
  name:         z.string().min(1, "Required"),
  address:      z.string().min(1, "Required"),
  city:         z.string().min(1, "Required"),
  province:     z.string().min(1, "Required"),
  cuisine_type: z.string().min(1, "Required"),
  phone:        z.string().optional(),
  description:  z.string().optional(),
  currency:     z.string().default("cad"),
});

type RestaurantFormValues = z.infer<typeof restaurantSchema>;

const slideVariants = {
  enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
};

// ─── Default hours (Mon–Fri 11am–10pm, Sat–Sun 10am–11pm) ───────────────────
function defaultHours(): DayHours[] {
  return DAYS.map((_, i) => ({
    open: true,
    from: i < 5 ? "11:00 AM" : "10:00 AM",
    to:   i < 5 ? "10:00 PM" : "11:00 PM",
  }));
}

// ─── Helper: small time select ────────────────────────────────────────────────
function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-xs text-text-primary outline-none focus:border-gold/40"
      >
        {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-text-muted" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 2 — Hours
  const [hours, setHours] = useState<DayHours[]>(defaultHours());

  // Step 3 — Tables
  const [tables, setTables] = useState<TableEntry[]>([
    { id: "t1", label: "T1", capacity: 4, shape: "circle",    section: "Main Dining" },
    { id: "t2", label: "T2", capacity: 2, shape: "circle",    section: "Main Dining" },
    { id: "t3", label: "T3", capacity: 6, shape: "rectangle", section: "Main Dining" },
  ]);
  const [newSection, setNewSection] = useState("Main Dining");

  // Step 4 — Team
  const [team, setTeam] = useState<TeamEntry[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("server");

  // Step 5 — Settings
  const [depositEnabled, setDepositEnabled] = useState(false);
  const [depositAmount, setDepositAmount] = useState("25");
  const [cancellationHours, setCancellationHours] = useState("24");
  const [noShowFee, setNoShowFee] = useState("");
  const [acceptsWalkins, setAcceptsWalkins] = useState(true);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [pointsPerDollar, setPointsPerDollar] = useState("1");

  const form = useForm<RestaurantFormValues>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: { name: "", address: "", city: "", province: "", cuisine_type: "", phone: "", description: "", currency: "cad" },
  });

  const goNext = () => { setDirection(1);  setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const goBack = () => { setDirection(-1); setStep((s) => Math.max(s - 1, 0)); };

  // ── Tables helpers ──────────────────────────────────────────────────────────
  function addTable() {
    const n = tables.length + 1;
    setTables((prev) => [...prev, { id: `t${Date.now()}`, label: `T${n}`, capacity: 2, shape: "circle", section: newSection }]);
  }
  function removeTable(id: string) { setTables((p) => p.filter((t) => t.id !== id)); }
  function updateTable(id: string, patch: Partial<TableEntry>) {
    setTables((p) => p.map((t) => t.id === id ? { ...t, ...patch } : t));
  }

  // ── Team helpers ────────────────────────────────────────────────────────────
  function addInvite() {
    if (!inviteEmail.trim()) return;
    setTeam((p) => [...p, { id: Date.now().toString(), email: inviteEmail.trim(), role: inviteRole }]);
    setInviteEmail("");
  }
  function removeInvite(id: string) { setTeam((p) => p.filter((m) => m.id !== id)); }

  // ── Finish ──────────────────────────────────────────────────────────────────
  const handleFinish = async () => {
    if (!isSupabaseConfigured()) { toast.error(t("auth.errors.supabaseNotConfigured")); return; }
    setSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) { toast.error(t("auth.errors.loadProfileFailed")); return; }

      const values = form.getValues();
      const hoursJson = Object.fromEntries(
        DAYS.map((day, i) => [day.toLowerCase(), hours[i].open
          ? { open: hours[i].from, close: hours[i].to }
          : null,
        ])
      );

      const res = await client.functions.invoke("signup-restaurant-owner", {
        body: {
          restaurant_name: values.name,
          address:         values.address,
          city:            values.city,
          province:        values.province,
          cuisine_type:    values.cuisine_type,
          phone:           values.phone || null,
          description:     values.description || null,
          currency:        values.currency,
          hours_json:      hoursJson,
          accepts_walkins: acceptsWalkins,
          no_show_fee:     noShowFee ? parseFloat(noShowFee) : null,
          cancellation_hours: parseInt(cancellationHours, 10),
        },
      });

      if (res.error) {
        const msg = (res.data as { error?: string } | null)?.error ?? res.error.message ?? "Setup failed. Please try again.";
        toast.error(msg);
        return;
      }
      toast.success("Restaurant created! Welcome to your dashboard.");
      navigate("/dashboard", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text-primary">
      {/* Header */}
      <header className="border-b border-border bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <span className="text-sm font-bold tracking-[0.2em] text-gold">SEATLY</span>
          <span className="text-sm text-text-muted">Restaurant Setup</span>
        </div>
      </header>

      {/* Progress */}
      <div className="mx-auto w-full max-w-2xl px-6 pt-8">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.labelKey} className="flex flex-1 flex-col items-center">
              <div className="flex items-center w-full">
                <div className="flex-1">
                  {i > 0 && <div className={`h-px w-full transition-colors ${i <= step ? "bg-gold" : "bg-border"}`} />}
                </div>
                <motion.div
                  animate={{ scale: i === step ? 1.1 : 1, backgroundColor: i <= step ? "#C9A84C" : "#242424" }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full"
                >
                  {i < step
                    ? <Check className="size-4 text-bg-base" />
                    : <s.icon className={`size-4 ${i <= step ? "text-bg-base" : "text-text-muted"}`} />
                  }
                </motion.div>
                <div className="flex-1">
                  {i < STEPS.length - 1 && <div className={`h-px w-full transition-colors ${i < step ? "bg-gold" : "bg-border"}`} />}
                </div>
              </div>
              <span className={`mt-2 text-[10px] font-medium ${i <= step ? "text-gold" : "text-text-muted"}`}>
                {s.labelKey}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 h-1 w-full rounded-full bg-bg-elevated">
          <motion.div
            className="h-full rounded-full bg-gold"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 200, damping: 25 }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-1 flex-col"
          >

            {/* ══════════════ STEP 1 — RESTAURANT INFO ══════════════ */}
            {step === 0 && (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-bold">Tell us about your restaurant</h2>
                  <p className="mt-1 text-sm text-text-muted">This is how customers will find and recognise you.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>Restaurant Name <span className="text-danger">*</span></Label>
                    <Input {...form.register("name")} placeholder="e.g. The Golden Fork" />
                    {form.formState.errors.name && <p className="text-xs text-danger">{form.formState.errors.name.message}</p>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Cuisine Type <span className="text-danger">*</span></Label>
                    <Input {...form.register("cuisine_type")} placeholder="e.g. Italian, Japanese" />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Street Address <span className="text-danger">*</span></Label>
                  <Input {...form.register("address")} placeholder="142 King St W" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>City <span className="text-danger">*</span></Label>
                    <Input {...form.register("city")} placeholder="Toronto" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Province / State <span className="text-danger">*</span></Label>
                    <Input {...form.register("province")} placeholder="ON" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>Phone</Label>
                    <Input {...form.register("phone")} placeholder="+1 (416) 555-0100" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Currency</Label>
                    <Select defaultValue={form.getValues("currency")} onValueChange={(v) => form.setValue("currency", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cad">CAD — Canadian Dollar</SelectItem>
                        <SelectItem value="usd">USD — US Dollar</SelectItem>
                        <SelectItem value="eur">EUR — Euro</SelectItem>
                        <SelectItem value="gbp">GBP — British Pound</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Description</Label>
                  <Textarea {...form.register("description")} rows={3} placeholder="A short description guests will see on your public page." />
                </div>
              </div>
            )}

            {/* ══════════════ STEP 2 — HOURS ══════════════ */}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-bold">Set your hours</h2>
                  <p className="mt-1 text-sm text-text-muted">Toggle days on/off and set open and close times. You can edit these any time in Settings.</p>
                </div>
                <div className="flex flex-col gap-2">
                  {DAYS.map((day, i) => (
                    <div key={day} className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface px-4 py-3">
                      {/* Toggle */}
                      <button
                        type="button"
                        onClick={() => setHours((h) => h.map((d, idx) => idx === i ? { ...d, open: !d.open } : d))}
                        className={`relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${hours[i].open ? "bg-gold" : "bg-border"}`}
                      >
                        <motion.div
                          animate={{ x: hours[i].open ? 16 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="size-4 rounded-full bg-white shadow"
                        />
                      </button>

                      {/* Day name */}
                      <span className={`w-24 text-sm font-medium ${hours[i].open ? "text-text-primary" : "text-text-muted"}`}>
                        {day}
                      </span>

                      {hours[i].open ? (
                        <div className="flex flex-1 items-center gap-2">
                          <TimeSelect value={hours[i].from} onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, from: v } : d))} />
                          <span className="text-xs text-text-muted">to</span>
                          <TimeSelect value={hours[i].to} onChange={(v) => setHours((h) => h.map((d, idx) => idx === i ? { ...d, to: v } : d))} />
                        </div>
                      ) : (
                        <span className="flex-1 text-sm text-text-muted">Closed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══════════════ STEP 3 — TABLES ══════════════ */}
            {step === 2 && (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-bold">Configure your tables</h2>
                  <p className="mt-1 text-sm text-text-muted">Add tables with their capacity and shape. These power your floor plan and reservation system.</p>
                </div>

                {/* Section selector + add button */}
                <div className="flex items-center gap-2">
                  <Input
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    placeholder="Section name"
                    className="flex-1"
                  />
                  <Button type="button" onClick={addTable} className="gap-1.5 shrink-0">
                    <Plus className="size-4" />
                    Add Table
                  </Button>
                </div>

                {/* Table list */}
                {tables.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
                    <LayoutGrid className="size-8 text-text-muted" />
                    <p className="text-sm text-text-muted">No tables yet. Add your first one above.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_80px_110px_1fr_36px] gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      <span>Label</span>
                      <span>Capacity</span>
                      <span>Shape</span>
                      <span>Section</span>
                      <span />
                    </div>
                    {tables.map((tb) => (
                      <div key={tb.id} className="grid grid-cols-[1fr_80px_110px_1fr_36px] items-center gap-2 rounded-xl border border-border bg-bg-surface px-3 py-2.5">
                        <Input
                          value={tb.label}
                          onChange={(e) => updateTable(tb.id, { label: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={tb.capacity}
                          onChange={(e) => updateTable(tb.id, { capacity: parseInt(e.target.value, 10) || 1 })}
                          className="h-8 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                        {/* Shape picker */}
                        <div className="flex gap-1">
                          {TABLE_SHAPES.map((shape) => (
                            <button
                              key={shape}
                              type="button"
                              title={shape}
                              onClick={() => updateTable(tb.id, { shape })}
                              className={`flex flex-1 items-center justify-center rounded-md border py-1.5 text-xs transition-all ${
                                tb.shape === shape
                                  ? "border-gold bg-gold/10 text-gold"
                                  : "border-border bg-bg-elevated text-text-muted hover:border-gold/30"
                              }`}
                            >
                              {shape === "circle"    && <Circle className="size-3.5" />}
                              {shape === "rectangle" && <RectangleHorizontal className="size-3.5" />}
                              {shape === "booth"     && <Square className="size-3.5" />}
                            </button>
                          ))}
                        </div>
                        <Input
                          value={tb.section}
                          onChange={(e) => updateTable(tb.id, { section: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeTable(tb.id)}
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-text-muted">
                  {tables.length} table{tables.length !== 1 ? "s" : ""} · You can add, remove, and reposition tables on the Floor Plan page at any time.
                </p>
              </div>
            )}

            {/* ══════════════ STEP 4 — TEAM ══════════════ */}
            {step === 3 && (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-xl font-bold">Invite your team</h2>
                  <p className="mt-1 text-sm text-text-muted">Optional — invite staff by email. They'll receive a link to join your restaurant. You can skip this and invite them later from the Staff page.</p>
                </div>

                {/* Invite row */}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="mb-1.5 block text-xs text-text-muted">Email address</Label>
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addInvite()}
                      placeholder="colleague@example.com"
                    />
                  </div>
                  <div className="w-36">
                    <Label className="mb-1.5 block text-xs text-text-muted">Role</Label>
                    <div className="relative">
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as StaffRole)}
                        className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-sm text-text-primary outline-none focus:border-gold/40"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                    </div>
                  </div>
                  <Button type="button" onClick={addInvite} className="gap-1.5 shrink-0">
                    <UserPlus className="size-4" />
                    Add
                  </Button>
                </div>

                {/* Role explanations */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.entries(ROLE_LABELS) as [StaffRole, string][]).map(([key, label]) => (
                    <div key={key} className="rounded-lg border border-border bg-bg-surface px-3 py-2">
                      <p className="text-xs font-semibold text-text-primary">{label}</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">
                        {key === "manager"  && "Full access except billing"}
                        {key === "server"   && "Orders, reservations, floor"}
                        {key === "host"     && "Reservations, waitlist, floor"}
                        {key === "kitchen"  && "KDS and order status only"}
                        {key === "bar"      && "Bar orders and KDS"}
                        {key === "staff"    && "Limited read-only access"}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Invite list */}
                {team.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-text-muted">Pending invites ({team.length})</p>
                    {team.map((member) => (
                      <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface px-4 py-2.5">
                        <div className="flex size-8 items-center justify-center rounded-full bg-gold/10 text-xs font-bold text-gold">
                          {member.email[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">{member.email}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-bg-elevated px-2.5 py-1 text-[10px] font-semibold text-text-secondary">
                          {ROLE_LABELS[member.role]}
                        </span>
                        <button type="button" onClick={() => removeInvite(member.id)} className="text-text-muted hover:text-danger transition-colors">
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {team.length === 0 && (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
                    <Users className="size-7 text-text-muted" />
                    <p className="text-sm text-text-muted">No invites yet — you can always add team members later.</p>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════ STEP 5 — SETTINGS ══════════════ */}
            {step === 4 && (
              <div className="flex flex-col gap-6">
                <div>
                  <h2 className="text-xl font-bold">Booking & policy settings</h2>
                  <p className="mt-1 text-sm text-text-muted">Configure how guests book and what happens if they don't show. Everything here can be changed later in Settings.</p>
                </div>

                {/* Walk-ins */}
                <div className="rounded-2xl border border-border bg-bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Accept walk-ins</p>
                      <p className="text-xs text-text-muted">Allow guests without a reservation to be seated when space is available.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAcceptsWalkins((v) => !v)}
                      className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${acceptsWalkins ? "bg-gold" : "bg-border"}`}
                    >
                      <motion.div
                        animate={{ x: acceptsWalkins ? 22 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="size-5 rounded-full bg-white shadow"
                      />
                    </button>
                  </div>
                </div>

                {/* Cancellation window */}
                <div className="rounded-2xl border border-border bg-bg-surface p-5">
                  <p className="mb-3 text-sm font-semibold text-text-primary">Cancellation window</p>
                  <p className="mb-3 text-xs text-text-muted">How many hours before the reservation can guests cancel for free?</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={168}
                      value={cancellationHours}
                      onChange={(e) => setCancellationHours(e.target.value)}
                      className="h-10 w-24 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-sm text-text-secondary">hours before reservation</span>
                  </div>
                </div>

                {/* Deposit */}
                <div className="rounded-2xl border border-border bg-bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Require deposit</p>
                      <p className="text-xs text-text-muted">Charge a deposit at booking time to secure the reservation.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDepositEnabled((v) => !v)}
                      className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${depositEnabled ? "bg-gold" : "bg-border"}`}
                    >
                      <motion.div
                        animate={{ x: depositEnabled ? 22 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="size-5 rounded-full bg-white shadow"
                      />
                    </button>
                  </div>
                  <AnimatePresence>
                    {depositEnabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 flex items-center gap-3">
                          <Label className="text-xs text-text-muted">Deposit amount ($)</Label>
                          <input
                            type="number"
                            min={1}
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            className="h-10 w-28 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-xs text-text-muted">per reservation</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* No-show fee */}
                <div className="rounded-2xl border border-border bg-bg-surface p-5">
                  <p className="mb-1 text-sm font-semibold text-text-primary">No-show fee</p>
                  <p className="mb-3 text-xs text-text-muted">Charge guests who don't show up and don't cancel. Leave blank to disable.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      value={noShowFee}
                      onChange={(e) => setNoShowFee(e.target.value)}
                      placeholder="0.00"
                      className="h-10 w-28 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-text-muted">per person (optional)</span>
                  </div>
                </div>

                {/* Loyalty */}
                <div className="rounded-2xl border border-border bg-bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Enable loyalty program</p>
                      <p className="text-xs text-text-muted">Reward guests with points on every visit.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLoyaltyEnabled((v) => !v)}
                      className={`relative flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors ${loyaltyEnabled ? "bg-gold" : "bg-border"}`}
                    >
                      <motion.div
                        animate={{ x: loyaltyEnabled ? 22 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="size-5 rounded-full bg-white shadow"
                      />
                    </button>
                  </div>
                  <AnimatePresence>
                    {loyaltyEnabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 flex items-center gap-3">
                          <Label className="text-xs text-text-muted">Points per $1 spent</Label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={pointsPerDollar}
                            onChange={(e) => setPointsPerDollar(e.target.value)}
                            className="h-10 w-20 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="mt-auto flex items-center justify-between pt-8">
          <Button variant="ghost" disabled={step === 0} onClick={goBack} className="gap-2">
            <ArrowLeft className="size-4" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            {step > 0 && step < STEPS.length - 1 && (
              <Button variant="ghost" onClick={goNext} className="text-text-muted hover:text-white">
                Skip
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} className="gap-2">
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button onClick={() => void handleFinish()} disabled={submitting} className="gap-2 px-8">
                {submitting ? "Creating your restaurant…" : "Launch Restaurant 🚀"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
