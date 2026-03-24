import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CalendarDays, ShoppingBag, Gift, User, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { useUser } from "@/hooks/useUser";

export default function AccountPage() {
  const { t } = useTranslation();
  const { profile, signOut } = useUser();

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/discover">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <h1 className="flex-1 text-base font-semibold">{t("routes.account.title")}</h1>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            {t("dashboard.shell.signOut")}
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {/* Profile card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-4 rounded-xl border border-border bg-bg-surface p-5"
        >
          <Avatar className="size-14 border-2 border-gold/30">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback className="bg-gold/10 text-lg font-bold text-gold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">
              {profile?.full_name ?? profile?.email ?? "\u2014"}
            </p>
            <p className="truncate text-sm text-text-muted">{profile?.email}</p>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="mt-6"
        >
          <Tabs defaultValue="bookings">
            <TabsList>
              <TabsTrigger value="bookings" className="gap-1.5">
                <CalendarDays className="size-3.5" />
                Bookings
              </TabsTrigger>
              <TabsTrigger value="orders" className="gap-1.5">
                <ShoppingBag className="size-3.5" />
                Orders
              </TabsTrigger>
              <TabsTrigger value="loyalty" className="gap-1.5">
                <Gift className="size-3.5" />
                Loyalty
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-1.5">
                <User className="size-3.5" />
                Profile
              </TabsTrigger>
            </TabsList>

            <TabsContent value="bookings" className="mt-6">
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title="No bookings yet"
                description="Your upcoming and past reservations will appear here."
              />
            </TabsContent>

            <TabsContent value="orders" className="mt-6">
              <EmptyState
                icon={<ShoppingBag className="size-5" />}
                title="No orders yet"
                description="Your order history will appear here."
              />
            </TabsContent>

            <TabsContent value="loyalty" className="mt-6">
              <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-bg-surface p-8">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gold/10">
                  <Gift className="size-7 text-gold" />
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gold">0</p>
                  <p className="mt-1 text-sm text-text-muted">Points Balance</p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="profile" className="mt-6">
              <div className="rounded-xl border border-border bg-bg-surface p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Name</span>
                    <span className="text-sm font-medium">{profile?.full_name ?? "\u2014"}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Email</span>
                    <span className="text-sm font-medium">{profile?.email ?? "\u2014"}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Phone</span>
                    <span className="text-sm font-medium">{profile?.phone ?? "\u2014"}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">Dietary</span>
                    <span className="text-sm font-medium">
                      {profile?.dietary_restrictions?.join(", ") ?? "None"}
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
