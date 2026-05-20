# Giving Nick free Cenaiva (founder comp)

How to set up a free-forever Cenaiva account for Nick's restaurant.
Same pattern works for any future comped account (advisors, beta partners, etc.).

---

## The simple story

Imagine Nick owns a restaurant and you want him to use Cenaiva for free.

### What Nick does (same as any restaurant)

1. Nick goes to cenaiva.com
2. Nick signs up for Cenaiva — same way any restaurant would
3. Nick enters his credit card (yes, he still has to enter one)
4. Nick clicks "Publish my restaurant"
5. Nick's restaurant is live!

That's it from Nick's side. He doesn't do anything special.

### What you do (one time, before Nick signs up)

You go on Stripe's website and tell Stripe:

> "Hey Stripe — when Nick's restaurant tries to bill him, make it free."

You do this by clicking a few buttons on stripe.com. It's like attaching
a permanent 100% off coupon to his account.

### What happens when bill day comes

Every month, Cenaiva tells Stripe: "Charge Nick $199.99 for his subscription."

Stripe looks at Nick's account and goes: "Oh wait, this guy has a 100% off
coupon. So I'll send him an invoice but charge him $0."

Nick's credit card never gets charged. Nick sees an invoice in his Cenaiva
dashboard that says "$0.00 — paid." Done.

### The key thing to understand

**Cenaiva doesn't know or care that Nick is free.** Cenaiva just does its
normal thing every month. **Stripe is the one that knows about the discount**
and quietly makes the bill $0.

It's like if you went to McDonald's with a 100% off coupon. McDonald's makes
you the burger the same way they make everyone's burger. The cashier rings up
$5. Then they scan your coupon and the total becomes $0. The kitchen never
knew you got it free.

Same thing here. Cenaiva = the kitchen. Stripe = the cashier with the coupon.

---

## Step-by-step: how to do it on stripe.com

### Step 1 — Create the coupon (one time, reusable)

1. Log into stripe.com
2. Sidebar → Products → Coupons
3. Click "New coupon"
4. Fill in:
   - **Name**: `Founder Comp` (or whatever you want)
   - **Type**: Percentage
   - **Percent off**: 100
   - **Duration**: Forever
   - **Apply to**: All products (leave blank to apply to subscription + booking fees)
5. Click Save

You now have a coupon you can attach to any customer to make them free
forever. Keep it around — you'll reuse it for future comp accounts.

### Step 2 — Attach the coupon to Nick

After Nick signs up for Cenaiva (so his Stripe customer exists):

1. Stripe sidebar → Customers
2. Search for Nick's restaurant email
3. Click his name
4. Scroll to his active subscription
5. Click "Actions" → "Update subscription" → "Add coupon"
6. Pick "Founder Comp" → Save

From the next billing cycle onwards, his invoices will be $0.

### Step 3 (recommended) — Apply before first bill

Stripe charges the first real invoice when the 90-day trial ends. If you
attach the coupon BEFORE that happens, Nick is never charged at all — not
even the first month.

Just do Step 2 within 90 days of his signup.

---

## Common questions

**Q: Does Nick know he's getting it free?**
He'll see his invoices in the dashboard showing $0.00. So yes, technically.
He won't see "Founder Comp" anywhere unless he digs into Stripe.

**Q: What if Nick leaves the company?**
Remove the coupon from his customer in Stripe. Next month he starts paying
$199.99 like everyone else. No code changes, no data migration.

**Q: Does this work for the $1 per-booking fee too?**
Yes — if the coupon is set to "All products" duration forever, it applies
to every invoice including the per-booking fee line items.

**Q: Can I do this for more founders / advisors later?**
Yes — same coupon, attach to as many customers as you want. No limit.

**Q: Should we build an admin "Comp this account" button in Cenaiva?**
Not yet — manual Stripe Dashboard takes 2 minutes per account. Worth
building UI only if you end up comping 5+ accounts.

---

## Reversing it later

If you ever need to start charging Nick (or any comped account):

1. Stripe Customers → Nick's customer
2. Find the coupon on his subscription
3. Click "Remove coupon"

From next bill cycle, he pays normally.
