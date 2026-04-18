import type { PromotionRow } from "@/hooks/usePromotions";

type CartLine = { id: string; price: number; qty: number };

export function computePromoDiscount(
  cart: CartLine[],
  promo: PromotionRow,
): { discount: number; appliedTo: string[] } {
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  if (cartTotal <= 0) return { discount: 0, appliedTo: [] };

  switch (promo.promo_type) {
    case "bogo": {
      const eligible = promo.bogo_item_ids.length > 0
        ? cart.filter((i) => promo.bogo_item_ids.includes(i.id))
        : cart;
      const buy = promo.buy_quantity ?? 1;
      const get = promo.get_quantity ?? 1;
      const cycle = buy + get;
      let discount = 0;
      const appliedTo: string[] = [];
      for (const line of eligible) {
        const freeUnits = Math.floor(line.qty / cycle) * get;
        if (freeUnits > 0) {
          discount += freeUnits * line.price;
          appliedTo.push(line.id);
        }
      }
      return { discount: Math.min(discount, cartTotal), appliedTo };
    }

    case "percentage": {
      if (!promo.discount_value) return { discount: 0, appliedTo: [] };
      if (promo.min_order_amount != null && cartTotal < promo.min_order_amount) {
        return { discount: 0, appliedTo: [] };
      }
      const eligible = promo.eligible_item_ids.length > 0
        ? cart.filter((i) => promo.eligible_item_ids.includes(i.id))
        : cart;
      const eligibleSubtotal = eligible.reduce((s, i) => s + i.price * i.qty, 0);
      const appliedTo = eligible.map((i) => i.id);
      const discount = Math.min(eligibleSubtotal * (promo.discount_value / 100), cartTotal);
      return { discount, appliedTo };
    }

    case "fixed": {
      if (!promo.discount_value) return { discount: 0, appliedTo: [] };
      if (promo.min_order_amount != null && cartTotal < promo.min_order_amount) {
        return { discount: 0, appliedTo: [] };
      }
      const eligible = promo.eligible_item_ids.length > 0
        ? cart.filter((i) => promo.eligible_item_ids.includes(i.id))
        : cart;
      const eligibleSubtotal = eligible.reduce((s, i) => s + i.price * i.qty, 0);
      const appliedTo = eligible.map((i) => i.id);
      const discount = Math.min(promo.discount_value, eligibleSubtotal, cartTotal);
      return { discount, appliedTo };
    }

    case "free_item": {
      if (!promo.free_item_id) return { discount: 0, appliedTo: [] };
      const line = cart.find((i) => i.id === promo.free_item_id);
      if (!line) return { discount: 0, appliedTo: [] };
      return { discount: Math.min(line.price, cartTotal), appliedTo: [line.id] };
    }

    default:
      return { discount: 0, appliedTo: [] };
  }
}
