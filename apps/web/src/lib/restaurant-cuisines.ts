export const RESTAURANT_CUISINE_OPTIONS = [
  "African",
  "American",
  "Argentine",
  "Asian",
  "Australian",
  "Austrian",
  "Basque",
  "Barbecue",
  "Breakfast",
  "Brazilian",
  "British",
  "Burgers",
  "Cafe",
  "Cajun",
  "Caribbean",
  "Chinese",
  "Contemporary",
  "Continental",
  "Dim Sum",
  "Dessert",
  "Ethiopian",
  "European",
  "Farm-to-table",
  "Filipino",
  "French",
  "Fusion",
  "Gastropub",
  "German",
  "Greek",
  "Halal",
  "Hawaiian",
  "Indian",
  "Italian",
  "Jamaican",
  "Japanese",
  "Jewish",
  "Korean",
  "Latin American",
  "Lebanese",
  "Malaysian",
  "Mediterranean",
  "Mexican",
  "Middle Eastern",
  "Moroccan",
  "Pakistani",
  "Persian",
  "Peruvian",
  "Pizza",
  "Portuguese",
  "Ramen",
  "Russian",
  "Seafood",
  "Singaporean",
  "Soul Food",
  "South American",
  "Southern",
  "Spanish",
  "Steakhouse",
  "Sushi",
  "Syrian",
  "Thai",
  "Turkish",
  "Vegan",
  "Vegetarian",
  "Vietnamese",
  "Wine Bar",
  "Other",
] as const;

export type RestaurantCuisine = typeof RESTAURANT_CUISINE_OPTIONS[number];

const CUISINE_ALIASES: Record<string, RestaurantCuisine> = {
  "bbq": "Barbecue",
  "brunch": "Breakfast",
  "coffee": "Cafe",
  "coffee shop": "Cafe",
  "modern": "Contemporary",
  "modern french": "French",
  "modern indian": "Indian",
  "omakase": "Japanese",
  "pan asian": "Asian",
  "pan-asian": "Asian",
  "plant based": "Vegan",
  "plant-based": "Vegan",
  "tapas": "Spanish",
  "wine": "Wine Bar",
};

function normalizeCuisineKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

const CUISINE_BY_KEY = new Map(
  RESTAURANT_CUISINE_OPTIONS.map((cuisine) => [normalizeCuisineKey(cuisine), cuisine]),
);

export function normalizeRestaurantCuisine(value: string | null | undefined): RestaurantCuisine | "" {
  const key = normalizeCuisineKey(value ?? "");
  if (!key) return "";
  return CUISINE_BY_KEY.get(key) ?? CUISINE_ALIASES[key] ?? "";
}
