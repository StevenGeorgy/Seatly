import { useEffect, useMemo, useState } from "react";
import { format, parse, isValid, startOfToday } from "date-fns";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMenuCategories, useMenuItems } from "@/hooks/useMenuItems";
import type { SuggestionRow } from "@/hooks/useMenuSuggestions";
import { useMenuSuggestions } from "@/hooks/useMenuSuggestions";
import { type CreatePromotionPayload, usePromotions } from "@/hooks/usePromotions";
import { useEvents } from "@/hooks/useEvents";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function AiBadge() {
  return (
    <Badge variant="outline" className="ml-1 border-gold/30 bg-gold/10 px-1 py-0 text-[9px] font-semibold uppercase text-gold">
      AI
    </Badge>
  );
}

function DatePicker({
  value,
  onChange,
  placeholder,
  disableBefore,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disableBefore?: Date;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={cn("truncate text-xs leading-none", value ? "text-text-primary" : "text-text-muted")}>
            {selected ? format(selected, "EEE, MMM d, yyyy") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl" style={{ zIndex: 9999 }}>
        <Calendar
          mode="single"
          required={false}
          selected={selected}
          onSelect={(d) => { onChange(d ? format(d, "yyyy-MM-dd") : ""); if (d) setOpen(false); }}
          disabled={disableBefore ? { before: disableBefore } : undefined}
          className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
        />
        {value ? (
          <div className="border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full text-text-secondary hover:bg-bg-surface" onClick={() => { onChange(""); setOpen(false); }}>
              Clear date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ── Menu item (new) form ─────────────────────────────────────────────────────

function MenuItemForm({
  payload,
  aiFields,
  saving,
  onSave,
  onDismiss,
  onCancel,
}: {
  payload: Record<string, any>;
  aiFields: string[];
  saving: boolean;
  onSave: (data: Record<string, any>) => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const { categories } = useMenuCategories();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency?.toUpperCase() ?? "CAD";

  const [name, setName] = useState(payload.name ?? "");
  const [desc, setDesc] = useState(payload.description ?? "");
  const [price, setPrice] = useState(String(payload.price ?? ""));
  const [categoryId, setCategoryId] = useState(payload.category_id ?? "");

  const isAi = (f: string) => aiFields.includes(f);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Name * {isAi("name") ? <AiBadge /> : null}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Margherita Pizza" />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Description {isAi("description") ? <AiBadge /> : null}</Label>
        <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Price ({currency}) {isAi("price") ? <AiBadge /> : null}</Label>
          <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDismiss}>Dismiss suggestion</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving} onClick={() => onSave({ name: name.trim(), description: desc.trim() || null, price: parseFloat(price) || 0, category_id: categoryId || null })}>
          {saving ? "Saving…" : "Add to Menu"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Menu item update form ────────────────────────────────────────────────────

function MenuItemUpdateForm({
  suggestion,
  saving,
  onSave,
  onDismiss,
  onCancel,
}: {
  suggestion: SuggestionRow;
  saving: boolean;
  onSave: (data: Record<string, any>) => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency?.toUpperCase() ?? "CAD";

  const [existingItem, setExistingItem] = useState<Record<string, any> | null>(null);
  const [name, setName] = useState(suggestion.payload.name ?? "");
  const [desc, setDesc] = useState(suggestion.payload.description ?? "");
  const [price, setPrice] = useState(suggestion.payload.price != null ? String(suggestion.payload.price) : "");
  const [isAvailable, setIsAvailable] = useState<boolean | undefined>(suggestion.payload.is_available);

  useEffect(() => {
    if (!suggestion.target_entity_id || !isSupabaseConfigured()) return;
    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data } = await client.from("menu_items").select("name, description, price, is_available").eq("id", suggestion.target_entity_id!).single();
      if (data) {
        setExistingItem(data);
        if (!("name" in suggestion.payload)) setName(data.name ?? "");
        if (!("description" in suggestion.payload)) setDesc(data.description ?? "");
        if (!("price" in suggestion.payload)) setPrice(String(data.price ?? ""));
        if (!("is_available" in suggestion.payload)) setIsAvailable(data.is_available ?? true);
      }
    })();
  }, [suggestion.target_entity_id, suggestion.payload]);

  const aiFields = Object.keys(suggestion.payload);
  const isAi = (f: string) => aiFields.includes(f);

  const changedFields: Record<string, any> = {};
  if (name !== (existingItem?.name ?? "")) changedFields.name = name.trim();
  if (desc !== (existingItem?.description ?? "")) changedFields.description = desc.trim() || null;
  if (price && parseFloat(price) !== existingItem?.price) changedFields.price = parseFloat(price) || 0;
  if (isAvailable !== undefined && isAvailable !== existingItem?.is_available) changedFields.is_available = isAvailable;

  return (
    <div className="flex flex-col gap-4">
      {existingItem ? (
        <p className="text-xs text-text-muted">Editing: <span className="font-medium text-text-secondary">{existingItem.name}</span></p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Name {isAi("name") ? <AiBadge /> : null}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Description {isAi("description") ? <AiBadge /> : null}</Label>
        <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Price ({currency}) {isAi("price") ? <AiBadge /> : null}</Label>
          <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        {isAi("is_available") ? (
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1">Availability <AiBadge /></Label>
            <Select value={isAvailable ? "true" : "false"} onValueChange={(v) => setIsAvailable(v === "true")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Available</SelectItem>
                <SelectItem value="false">86'd (unavailable)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDismiss}>Dismiss suggestion</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving || Object.keys(changedFields).length === 0} onClick={() => onSave(changedFields)}>
          {saving ? "Saving…" : "Apply Changes"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Promotion form ────────────────────────────────────────────────────────────

const UUID_RE_PROMO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ItemChecklist({
  items,
  loading,
  selected,
  onToggle,
  emptyLabel,
  aiHighlighted,
}: {
  items: { id: string; name: string; price: number }[];
  loading: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
  aiHighlighted: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      {loading ? (
        <div className="flex flex-col gap-1.5">{[1,2,3].map((i) => <Skeleton key={i} className="h-9 rounded-md" />)}</div>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-bg-elevated">
          {items.map((m) => {
            const checked = selected.includes(m.id);
            const aiPicked = aiHighlighted.includes(m.id);
            return (
              <button key={m.id} type="button" onClick={() => onToggle(m.id)}
                className={`flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-bg-surface ${checked ? "bg-gold/5" : ""}`}
              >
                <div className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-gold bg-gold" : "border-border bg-transparent"}`}>
                  {checked && <CheckCircle2 className="size-3 text-bg-base" />}
                </div>
                <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{m.name}</span>
                {aiPicked && <span className="shrink-0 rounded border border-gold/30 bg-gold/10 px-1 py-0 text-[9px] font-semibold uppercase text-gold">AI</span>}
                <span className="shrink-0 text-xs text-text-muted">${m.price.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      )}
      {selected.length === 0 && !loading && (
        <p className="text-[11px] text-text-muted">{emptyLabel}</p>
      )}
    </div>
  );
}

function PromotionForm({
  payload,
  aiFields,
  saving,
  onSave,
  onDismiss,
  onCancel,
}: {
  payload: Record<string, any>;
  aiFields: string[];
  saving: boolean;
  onSave: (data: Partial<CreatePromotionPayload>) => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const { items: allItems, loading: menuLoading } = useMenuItems();
  const realMenuItems = useMemo(
    () => allItems.filter((m) => UUID_RE_PROMO.test(m.id) && m.is_active),
    [allItems],
  );

  const [title, setTitle] = useState(payload.title ?? "");
  const [desc, setDesc] = useState(payload.description ?? "");
  const [promoType, setPromoType] = useState<string>(payload.promo_type ?? "percentage");
  const [discountValue, setDiscountValue] = useState(String(payload.discount_value ?? ""));
  const [discountUnit, setDiscountUnit] = useState<string>(payload.discount_unit ?? "percent");
  const [startsAt, setStartsAt] = useState((payload.starts_at ?? "").slice(0, 10));
  const [endsAt, setEndsAt] = useState((payload.ends_at ?? "").slice(0, 10));
  const [promoCode, setPromoCode] = useState(payload.promo_code ?? "");

  // Item selections — seeded from AI payload
  const [bogoItemIds, setBogoItemIds] = useState<string[]>(
    Array.isArray(payload.bogo_item_ids)
      ? payload.bogo_item_ids.filter((id: unknown) => typeof id === "string" && UUID_RE_PROMO.test(id))
      : [],
  );
  const [freeItemId, setFreeItemId] = useState<string>(
    typeof payload.free_item_id === "string" && UUID_RE_PROMO.test(payload.free_item_id) ? payload.free_item_id : "",
  );
  const [eligibleItemIds, setEligibleItemIds] = useState<string[]>(
    Array.isArray(payload.eligible_item_ids)
      ? payload.eligible_item_ids.filter((id: unknown) => typeof id === "string" && UUID_RE_PROMO.test(id))
      : [],
  );
  const [buyQuantity, setBuyQuantity] = useState(String(payload.buy_quantity ?? "1"));
  const [getQuantity, setGetQuantity] = useState(String(payload.get_quantity ?? "1"));

  const isAi = (f: string) => aiFields.includes(f);
  const freeItem = realMenuItems.find((m) => m.id === freeItemId);

  const toggleBogo = (id: string) => setBogoItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleEligible = (id: string) => setEligibleItemIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Title * {isAi("title") ? <AiBadge /> : null}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Description {isAi("description") ? <AiBadge /> : null}</Label>
        <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Type {isAi("promo_type") ? <AiBadge /> : null}</Label>
          <Select value={promoType} onValueChange={(v) => {
            setPromoType(v);
            setBogoItemIds([]); setFreeItemId(""); setEligibleItemIds([]);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">% Off</SelectItem>
              <SelectItem value="fixed">$ Off</SelectItem>
              <SelectItem value="bogo">BOGO</SelectItem>
              <SelectItem value="free_item">Free Item</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {promoType !== "bogo" && promoType !== "free_item" ? (
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-1">Value {isAi("discount_value") ? <AiBadge /> : null}</Label>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="flex-1" />
              <Select value={discountUnit} onValueChange={setDiscountUnit}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">%</SelectItem>
                  <SelectItem value="dollar">$</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Starts {isAi("starts_at") ? <AiBadge /> : null}</Label>
          <DatePicker value={startsAt} onChange={setStartsAt} placeholder="Today" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Ends {isAi("ends_at") ? <AiBadge /> : null}</Label>
          <DatePicker value={endsAt} onChange={setEndsAt} placeholder="No end date" disableBefore={startOfToday()} />
        </div>
      </div>

      {/* BOGO — item checklist + quantities */}
      {promoType === "bogo" && (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1">
            Applies to which items? {isAi("bogo_item_ids") ? <AiBadge /> : null}
          </Label>
          <ItemChecklist
            items={realMenuItems}
            loading={menuLoading}
            selected={bogoItemIds}
            onToggle={toggleBogo}
            emptyLabel="No items selected — BOGO applies to all items."
            aiHighlighted={Array.isArray(payload.bogo_item_ids) ? payload.bogo_item_ids : []}
          />
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="flex flex-col gap-1.5">
              <Label>Buy quantity</Label>
              <Input type="number" min={1} placeholder="1" value={buyQuantity} onChange={(e) => setBuyQuantity(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Get free</Label>
              <Input type="number" min={1} placeholder="1" value={getQuantity} onChange={(e) => setGetQuantity(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* Free item — single select */}
      {promoType === "free_item" && (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1">
            Free item {isAi("free_item_id") ? <AiBadge /> : null}
          </Label>
          {menuLoading ? <Skeleton className="h-10 rounded-md" /> : (
            <Select value={freeItemId} onValueChange={setFreeItemId}>
              <SelectTrigger><SelectValue placeholder="Select the free item…" /></SelectTrigger>
              <SelectContent>
                {realMenuItems.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} — ${m.price.toFixed(2)}
                    {Array.isArray(payload.bogo_item_ids) ? null : (payload.free_item_id === m.id ? " · AI pick" : null)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {freeItem && (
            <p className="text-[11px] text-text-muted">
              Customers get one <span className="font-medium text-text-secondary">{freeItem.name}</span> (${freeItem.price.toFixed(2)}) free.
            </p>
          )}
        </div>
      )}

      {/* Percentage / Fixed — eligible item scope */}
      {(promoType === "percentage" || promoType === "fixed") && (
        <div className="flex flex-col gap-1.5">
          <Label className="flex items-center gap-1">
            Applies to which items? {isAi("eligible_item_ids") ? <AiBadge /> : null}
          </Label>
          <ItemChecklist
            items={realMenuItems}
            loading={menuLoading}
            selected={eligibleItemIds}
            onToggle={toggleEligible}
            emptyLabel="No items selected — discount applies to the whole cart."
            aiHighlighted={Array.isArray(payload.eligible_item_ids) ? payload.eligible_item_ids : []}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Promo code (optional)</Label>
        <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="e.g. SUMMER20" className="uppercase" />
      </div>

      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDismiss}>Dismiss suggestion</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving} onClick={() => onSave({
          title: title.trim(),
          description: desc.trim() || null,
          promo_type: promoType as any,
          discount_value: discountValue ? parseFloat(discountValue) : null,
          discount_unit: discountUnit as any,
          applies_to: "all",
          starts_at: startsAt || new Date().toISOString().slice(0, 10),
          ends_at: endsAt || null,
          is_active: true,
          promo_code: promoCode.trim().toUpperCase() || null,
          max_uses: null,
          badge_color: "amber",
          min_order_amount: null,
          bogo_item_ids: promoType === "bogo" ? bogoItemIds : [],
          free_item_id: promoType === "free_item" && freeItemId ? freeItemId : null,
          free_item_name: promoType === "free_item" && freeItem ? freeItem.name : null,
          eligible_item_ids: (promoType === "percentage" || promoType === "fixed") ? eligibleItemIds : [],
          buy_quantity: promoType === "bogo" ? (Number(buyQuantity) || 1) : 1,
          get_quantity: promoType === "bogo" ? (Number(getQuantity) || 1) : 1,
        })}>
          {saving ? "Saving…" : "Create Promotion"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Event form ────────────────────────────────────────────────────────────────

function EventForm({
  payload,
  aiFields,
  saving,
  onSave,
  onDismiss,
  onCancel,
}: {
  payload: Record<string, any>;
  aiFields: string[];
  saving: boolean;
  onSave: (data: Record<string, any>) => void;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency?.toUpperCase() ?? "CAD";

  const [name, setName] = useState(payload.name ?? "");
  const [desc, setDesc] = useState(payload.description ?? "");
  const [date, setDate] = useState((payload.date ?? "").slice(0, 10));
  const [startTime, setStartTime] = useState(payload.start_time ?? "18:00");
  const [endTime, setEndTime] = useState(payload.end_time ?? "22:00");
  const [price, setPrice] = useState(String(payload.price_per_person ?? ""));
  const [capacity, setCapacity] = useState(String(payload.capacity ?? ""));
  const [theme, setTheme] = useState(payload.theme ?? "");

  const isAi = (f: string) => aiFields.includes(f);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Event name * {isAi("name") ? <AiBadge /> : null}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-1">Description {isAi("description") ? <AiBadge /> : null}</Label>
        <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Date * {isAi("date") ? <AiBadge /> : null}</Label>
          <DatePicker value={date} onChange={setDate} placeholder="Select date" disableBefore={startOfToday()} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Theme {isAi("theme") ? <AiBadge /> : null}</Label>
          <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. holiday, live music" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Start time {isAi("start_time") ? <AiBadge /> : null}</Label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">End time {isAi("end_time") ? <AiBadge /> : null}</Label>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Price / person ({currency}) {isAi("price_per_person") ? <AiBadge /> : null}</Label>
          <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="flex items-center gap-1">Capacity {isAi("capacity") ? <AiBadge /> : null}</Label>
          <Input type="number" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" />
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDismiss}>Dismiss suggestion</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={saving} onClick={() => onSave({
          name: name.trim(),
          description: desc.trim() || null,
          date,
          start_time: startTime,
          end_time: endTime || null,
          price_per_person: price ? parseFloat(price) : null,
          capacity: capacity ? parseInt(capacity) : null,
          theme: theme.trim() || null,
        })}>
          {saving ? "Saving…" : "Create Event"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Root dialog ───────────────────────────────────────────────────────────────

const TITLE_MAP: Record<string, string> = {
  menu_item: "New Menu Item",
  menu_item_update: "Edit Menu Item",
  promotion: "New Promotion",
  event: "New Event",
};

type Props = {
  open: boolean;
  suggestion: SuggestionRow | null;
  onOpenChange: (o: boolean) => void;
};

export function SuggestionPreviewDialog({ open, suggestion, onOpenChange }: Props) {
  const [saving, setSaving] = useState(false);
  const { selectedRestaurantId } = useRestaurantScope();
  const { markApplied, dismiss } = useMenuSuggestions();
  const { createPromotion } = usePromotions();
  const { createEvent } = useEvents();

  const aiFields = suggestion ? Object.keys(suggestion.payload) : [];

  const handleDismiss = async () => {
    if (!suggestion) return;
    await dismiss(suggestion.id);
    onOpenChange(false);
  };

  const handleSaveMenuItem = async (data: Record<string, any>) => {
    if (!suggestion || !selectedRestaurantId || !isSupabaseConfigured()) return;
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { data: inserted, error } = await client
      .from("menu_items")
      .insert({ ...data, restaurant_id: selectedRestaurantId, is_available: true, is_active: true, is_featured: false, is_preorderable: false, sort_order: 0 })
      .select("id")
      .single();
    setSaving(false);
    if (error) { toast.error("Could not add item: " + error.message); return; }
    await markApplied(suggestion.id, inserted.id);
    toast.success("Menu item added.");
    onOpenChange(false);
  };

  const handleUpdateMenuItem = async (data: Record<string, any>) => {
    if (!suggestion?.target_entity_id || !isSupabaseConfigured()) return;
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("menu_items").update(data).eq("id", suggestion.target_entity_id);
    setSaving(false);
    if (error) { toast.error("Could not update item: " + error.message); return; }
    await markApplied(suggestion.id, suggestion.target_entity_id);
    toast.success("Menu item updated.");
    onOpenChange(false);
  };

  const handleSavePromotion = async (data: Partial<CreatePromotionPayload>) => {
    if (!suggestion) return;
    setSaving(true);
    const err = await createPromotion(data as CreatePromotionPayload);
    setSaving(false);
    if (err) { toast.error("Could not create promotion: " + err); return; }
    // Get newly created promo id from fresh fetch — approximate with timestamp
    await markApplied(suggestion.id, suggestion.id);
    toast.success("Promotion created.");
    onOpenChange(false);
  };

  const handleSaveEvent = async (data: Record<string, any>) => {
    if (!suggestion) return;
    setSaving(true);
    const err = await createEvent(data as any);
    setSaving(false);
    if (err) { toast.error("Could not create event: " + err); return; }
    await markApplied(suggestion.id, suggestion.id);
    toast.success("Event created.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{TITLE_MAP[suggestion?.suggestion_type ?? "menu_item"] ?? "Preview"}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">

        {!suggestion ? null : suggestion.suggestion_type === "menu_item" ? (
          <MenuItemForm
            payload={suggestion.payload}
            aiFields={aiFields}
            saving={saving}
            onSave={(d) => void handleSaveMenuItem(d)}
            onDismiss={() => void handleDismiss()}
            onCancel={() => onOpenChange(false)}
          />
        ) : suggestion.suggestion_type === "menu_item_update" ? (
          <MenuItemUpdateForm
            suggestion={suggestion}
            saving={saving}
            onSave={(d) => void handleUpdateMenuItem(d)}
            onDismiss={() => void handleDismiss()}
            onCancel={() => onOpenChange(false)}
          />
        ) : suggestion.suggestion_type === "promotion" ? (
          <PromotionForm
            payload={suggestion.payload}
            aiFields={aiFields}
            saving={saving}
            onSave={(d) => void handleSavePromotion(d)}
            onDismiss={() => void handleDismiss()}
            onCancel={() => onOpenChange(false)}
          />
        ) : suggestion.suggestion_type === "event" ? (
          <EventForm
            payload={suggestion.payload}
            aiFields={aiFields}
            saving={saving}
            onSave={(d) => void handleSaveEvent(d)}
            onDismiss={() => void handleDismiss()}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
