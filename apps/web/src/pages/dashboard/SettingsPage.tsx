import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const CURRENCY_OPTIONS = [
  { value: "cad", label: "CAD — Canadian Dollar" },
  { value: "usd", label: "USD — US Dollar" },
  { value: "eur", label: "EUR — Euro" },
  { value: "gbp", label: "GBP — British Pound" },
  { value: "aud", label: "AUD — Australian Dollar" },
  { value: "mxn", label: "MXN — Mexican Peso" },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, refreshRestaurants } = useRestaurantScope();
  const [activeTab, setActiveTab] = useState("restaurant");
  const [restaurantName, setRestaurantName] = useState(selectedRestaurant?.name ?? "");
  const [savingRestaurant, setSavingRestaurant] = useState(false);

  useEffect(() => {
    setRestaurantName(selectedRestaurant?.name ?? "");
  }, [selectedRestaurant?.id, selectedRestaurant?.name]);

  const saveRestaurantSettings = async () => {
    if (!selectedRestaurant) return;
    if (!isSupabaseConfigured()) {
      toast.error(t("auth.errors.supabaseNotConfigured"));
      return;
    }

    const nextName = restaurantName.trim();
    if (!nextName) return;

    setSavingRestaurant(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("restaurants")
      .update({ name: nextName })
      .eq("id", selectedRestaurant.id);

    setSavingRestaurant(false);

    if (error) {
      toast.error(t("dashboard.settings.saveFailed"));
      return;
    }

    refreshRestaurants();
    toast.success(t("dashboard.settings.saved"));
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.settings.title")} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="restaurant">{t("dashboard.settings.restaurant")}</TabsTrigger>
          <TabsTrigger value="hours">{t("dashboard.settings.hours")}</TabsTrigger>
          <TabsTrigger value="policy">{t("dashboard.settings.policy")}</TabsTrigger>
          <TabsTrigger value="loyalty">{t("dashboard.settings.loyalty")}</TabsTrigger>
          <TabsTrigger value="billing">{t("dashboard.settings.billing")}</TabsTrigger>
        </TabsList>

        <TabsContent value="restaurant" className="mt-6">
          <SectionCard title={t("dashboard.settings.restaurant")}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.name")}</Label>
                  <Input
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.cuisine")}</Label>
                  <Input />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.address")}</Label>
                <Input />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.description")}</Label>
                <Textarea rows={3} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.currency")}</Label>
                  <Select defaultValue={selectedRestaurant?.currency ?? "cad"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="self-end"
                disabled={savingRestaurant || !restaurantName.trim() || !selectedRestaurant}
                onClick={() => void saveRestaurantSettings()}
              >
                {savingRestaurant ? t("routes.loading") : t("common.actions.save")}
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="hours" className="mt-6">
          <SectionCard title={t("dashboard.settings.hours")}>
            <p className="text-sm text-text-muted">
              Hours editor — configure opening and closing times for each day.
            </p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="policy" className="mt-6">
          <SectionCard title={t("dashboard.settings.policy")}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.cancellationWindow")}</Label>
                  <Input type="number" defaultValue="24" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("dashboard.settings.noShowFee")}</Label>
                  <Input type="number" defaultValue="0" />
                </div>
              </div>
              <Button className="self-end">{t("common.actions.save")}</Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="loyalty" className="mt-6">
          <SectionCard title={t("dashboard.settings.loyalty")}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label>{t("dashboard.settings.pointsPerDollar")}</Label>
                <Input type="number" defaultValue="1" />
              </div>
              <Button className="self-end">{t("common.actions.save")}</Button>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <SectionCard title={t("dashboard.settings.billing")}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.settings.currentPlan")}</span>
                <span className="text-sm font-medium capitalize text-gold">
                  {selectedRestaurant?.name ? "active" : "\u2014"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.settings.stripeStatus")}</span>
                <span className="text-sm font-medium text-text-primary">
                  {"\u2014"}
                </span>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AnimatedPage>
  );
}
