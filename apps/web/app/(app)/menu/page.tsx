import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PAGE_HEADERS } from "@/lib/page-headers";

type MenuCategoryKey = "starters" | "mains" | "desserts" | "beverages";

type MenuDish = {
  id: string;
  name: string;
  category: MenuCategoryKey;
  priceLabel: string;
  isAvailableTonight: boolean;
  isPreorderable: boolean;
  allergens: string[];
  notes?: string;
};

type Category = {
  key: MenuCategoryKey;
  label: string;
  count: number;
};

const CATEGORIES: Category[] = [
  { key: "starters", label: "Starters", count: 12 },
  { key: "mains", label: "Mains", count: 28 },
  { key: "desserts", label: "Desserts", count: 9 },
  { key: "beverages", label: "Beverages", count: 14 },
];

const DISHES: MenuDish[] = [
  {
    id: "d-1",
    name: "Truffle Fries",
    category: "starters",
    priceLabel: "$14",
    isAvailableTonight: true,
    isPreorderable: false,
    allergens: ["Dairy"],
    notes: "Chef recommendation",
  },
  {
    id: "d-2",
    name: "Spicy Tuna Roll",
    category: "starters",
    priceLabel: "$16",
    isAvailableTonight: true,
    isPreorderable: true,
    allergens: ["Fish", "Soy"],
  },
  {
    id: "d-3",
    name: "Wood-Grilled Chicken",
    category: "mains",
    priceLabel: "$32",
    isAvailableTonight: true,
    isPreorderable: true,
    allergens: ["None"],
  },
  {
    id: "d-4",
    name: "Braised Short Rib",
    category: "mains",
    priceLabel: "$38",
    isAvailableTonight: true,
    isPreorderable: false,
    allergens: ["Gluten"],
  },
  {
    id: "d-5",
    name: "Margherita Pizza",
    category: "mains",
    priceLabel: "$29",
    isAvailableTonight: true,
    isPreorderable: true,
    allergens: ["Gluten", "Dairy"],
  },
  {
    id: "d-6",
    name: "Lemon Ricotta Tart",
    category: "desserts",
    priceLabel: "$12",
    isAvailableTonight: true,
    isPreorderable: false,
    allergens: ["Dairy", "Egg"],
  },
  {
    id: "d-7",
    name: "Citrus Sorbet",
    category: "desserts",
    priceLabel: "$10",
    isAvailableTonight: false,
    isPreorderable: false,
    allergens: ["None"],
    notes: "Only runs on limited nights",
  },
  {
    id: "d-8",
    name: "House Lemonade",
    category: "beverages",
    priceLabel: "$9",
    isAvailableTonight: true,
    isPreorderable: false,
    allergens: ["None"],
  },
];

export default function MenuPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const stateParam = searchParams.state;
  const state =
    typeof stateParam === "string"
      ? stateParam
      : Array.isArray(stateParam)
        ? stateParam[0]
        : undefined;

  const loading = state === "loading";
  const empty = state === "empty";
  const error = state === "error";

  const categoryParam = searchParams.category;
  const category =
    typeof categoryParam === "string"
      ? (categoryParam as MenuCategoryKey)
      : Array.isArray(categoryParam)
        ? (categoryParam[0] as MenuCategoryKey)
        : "starters";

  if (loading) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.menu} />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.menu} />
        <EmptyState
          title="No menu categories"
          message="Set up your menu categories first."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.menu} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/menu?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const filteredDishes = DISHES.filter((d) => d.category === category);

  return (
    <div>
      <PageHeader {...PAGE_HEADERS.menu} />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-4 app-card-elevated p-xl">
          <div className="mb-lg">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Categories
            </p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              Select a category to manage dishes.
            </p>
          </div>

          <div className="flex flex-col gap-md">
            {CATEGORIES.map((c) => {
              const isActive = c.key === category;
              return (
                <Link
                  key={c.key}
                  href={`/menu?category=${c.key}`}
                  className={`rounded-md border px-md py-sm text-xs font-medium uppercase tracking-widest transition-transform duration-400 hover:scale-[1.02] ${
                    isActive
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-border-card bg-surface-dark text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                  }`}
                >
                  <div className="flex items-center justify-between gap-md">
                    <span>{c.label}</span>
                    <span className="text-text-muted-on-dark">{c.count}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-lg app-card p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Quick actions
            </p>
            <div className="mt-md flex flex-col gap-md">
              <button
                type="button"
                disabled
                className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold opacity-70"
              >
                Add new dish (coming soon)
              </button>
              <button
                type="button"
                disabled
                className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
              >
                Upload CSV (coming soon)
              </button>
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-8 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Dishes in this category
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Availability and pre-order toggles (mock UI).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Category: {category}
              </div>
            </div>
          </div>

          <div className="space-y-md">
            {filteredDishes.map((d) => (
              <article
                key={d.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {d.name}
                      </p>
                      <div className="rounded-full border border-gold/30 bg-gold/10 px-sm py-xs">
                        <p className="text-xs font-medium uppercase tracking-widest text-gold">
                          {d.priceLabel}
                        </p>
                      </div>
                    </div>
                    {d.notes ? (
                      <p className="mt-xs text-sm text-text-muted-on-dark">
                        {d.notes}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-md">
                    <div
                      className={`rounded-md border px-md py-sm text-xs font-medium uppercase tracking-widest ${
                        d.isAvailableTonight
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border-dark bg-surface-dark text-text-muted-on-dark opacity-70"
                      }`}
                    >
                      {d.isAvailableTonight ? "Available tonight" : "Not available"}
                    </div>
                    <div
                      className={`rounded-md border px-md py-sm text-xs font-medium uppercase tracking-widest ${
                        d.isPreorderable
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border-dark bg-surface-dark text-text-muted-on-dark opacity-70"
                      }`}
                    >
                      {d.isPreorderable ? "Pre-orderable" : "No pre-order"}
                    </div>
                  </div>
                </div>

                {d.allergens.length > 0 ? (
                  <div className="mt-md flex flex-wrap gap-sm">
                    {d.allergens.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                      >
                        {a}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}

            {filteredDishes.length === 0 ? (
              <EmptyState
                title="No dishes in this category"
                message="Add dishes to start managing availability."
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
