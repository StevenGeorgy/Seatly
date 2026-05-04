import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { StaffRestaurantRow } from "@/hooks/useStaffRestaurants";
import { useUser } from "@/hooks/useUser";
import { getStaffDefaultPath, getStaffRoleSet } from "@/lib/auth/dashboard-access";
import type { StaffRole, UserRestaurantRole } from "@/types/auth";

type StaffWorkspaceMenuItemsProps = {
  restaurants: StaffRestaurantRow[];
  restaurantRoles: UserRestaurantRole[];
};

const ROLE_PRIORITY: StaffRole[] = ["owner", "manager", "host", "server", "kitchen", "bar", "staff"];

function primaryRoleForRestaurant(roles: UserRestaurantRole[]): StaffRole | null {
  return ROLE_PRIORITY.find((role) => roles.some((row) => row.role === role)) ?? null;
}

export function StaffWorkspaceMenuItems({
  restaurants,
  restaurantRoles,
}: StaffWorkspaceMenuItemsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { switchToStaffView } = useUser();

  const workspaces = useMemo(
    () =>
      restaurants.map((restaurant) => {
        const scopedRoles = restaurantRoles.filter((role) => role.restaurant_id === restaurant.id);
        return {
          restaurant,
          scopedRoles,
          role: primaryRoleForRestaurant(scopedRoles),
        };
      }),
    [restaurantRoles, restaurants],
  );

  if (workspaces.length === 0) return null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t("dashboard.shell.workspaces")}</DropdownMenuLabel>
      {workspaces.map(({ restaurant, scopedRoles, role }) => (
        <DropdownMenuItem
          key={restaurant.id}
          onClick={() => {
            localStorage.setItem("cenaiva.selectedRestaurantId", restaurant.id);
            switchToStaffView();
            void navigate(getStaffDefaultPath(getStaffRoleSet(scopedRoles), scopedRoles));
          }}
        >
          <LayoutDashboard className="size-4" />
          <span className="min-w-0 flex-1 truncate">{restaurant.name ?? restaurant.slug}</span>
          {role ? (
            <span className="shrink-0 text-xs capitalize text-text-muted">
              {t(`dashboard.shell.staffRole.${role}`)}
            </span>
          ) : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}
