# HAB_REVIEW_SNAP_TRANSFER

How a diner's snap + review travels from the mobile app to the web app.

> Audience: engineers picking up either side of the integration. We treat the
> snap-capture flow (camera, filter overlay, viewshot compositing) as
> out-of-scope — start reading here at the moment the user taps **Post**.

---

## 1. Where everything lives

Single Supabase project — **`exbjodmnpdiayfzrdyux`**.

| Resource                  | Type            | Purpose                                                        |
| ------------------------- | --------------- | -------------------------------------------------------------- |
| `visit_photos`            | Postgres table  | The snap itself: photo URL + metadata + (optional) rating/caption.|
| `restaurant_reviews`      | Postgres table  | The review pair: rating + body text, joined by user + restaurant. |
| `visit-photos`            | Storage bucket  | Public bucket holding the JPEGs. Path: `{user_id}/{photo_id}.jpg`. |
| `user_profiles`           | Postgres table  | Display name + avatar URL for the poster.                      |
| `restaurants`             | Postgres table  | Restaurant `id`, `name`, `cover_photo_url`, `cover_image_url`. |

Mobile writes everything; the web app reads. RLS lets the web app query as
the **anonymous role** (using the project's `EXPO_PUBLIC_SUPABASE_ANON_KEY`
or any matching `SUPABASE_ANON_KEY`) — no auth header required for SELECT
on the relevant rows. See §6 for exactly what the anon role can see.

---

## 2. End-to-end flow

```
┌──────────────────┐   tap Post   ┌────────────────────────────────────────┐
│  Mobile app      │ ───────────► │  Supabase                              │
│  (post-review)   │              │                                        │
│                  │              │  ┌──────────────┐ ┌─────────────────┐  │
│                  │              │  │ visit_photos │ │ restaurant_     │  │
│                  │              │  │  (always)    │ │  reviews        │  │
│                  │              │  └─────┬────────┘ │  (best-effort)  │  │
│                  │              │        │          └─────────┬───────┘  │
│                  │              │        ▼                    ▼          │
│                  │              │  ┌──────────────────────────────────┐  │
│                  │              │  │ visit-photos storage bucket      │  │
│                  │              │  │   {user_id}/{photo_id}.jpg       │  │
│                  │              │  └──────────────────────────────────┘  │
└──────────────────┘              └────────────────────────────────────────┘
                                                       │
                                                       ▼  anon SELECT
                                              ┌──────────────────┐
                                              │  Web app (other  │
                                              │   repo)          │
                                              │  reads + renders │
                                              └──────────────────┘
```

The web app **does not have to authenticate** to render restaurant pages
that show diner snaps and reviews — both tables already permit anonymous
SELECT and the storage bucket is `public: true`.

---

## 3. Storage: `visit-photos` bucket

- **Visibility:** public (`public = true`).
- **Path convention:** `{auth_user_id}/{photo_id}.jpg`. Helper:
  `lib/storage/buckets.ts → visitPhotoObjectPath(userId, photoId)`.
- **Public URL shape:**
  `https://exbjodmnpdiayfzrdyux.supabase.co/storage/v1/object/public/visit-photos/{user_id}/{photo_id}.jpg`
- **Storage RLS** (set by `supabase/migrations/20260513140000_visit_photos_snap_columns.sql`):
  - `SELECT`: anyone (`using (bucket_id = 'visit-photos')`).
  - `INSERT/UPDATE/DELETE`: only the owner (`auth.uid()::text = (storage.foldername(name))[1]`).

The mobile app stores the public URL in `visit_photos.image_url` so the web
app should just render `<img src={row.image_url}>` — no signed-URL dance
required.

> **Gotcha already fixed:** uploads used to happen via
> `await (await fetch(uri)).blob()` which silently returns 0-byte blobs on
> React Native. They're now sent via
> `expo-file-system.FileSystem.uploadAsync(...)` directly to
> `${SUPABASE_URL}/storage/v1/object/visit-photos/...` (see
> `lib/snaps/uploadSnapPhoto.ts`). Any `size_bytes: 0` rows in storage are
> from before that fix and should be ignored / cleaned up.

---

## 4. Table: `visit_photos`

Created by `supabase/migrations/20260507000000_*` and extended by
`...20260513140000_visit_photos_snap_columns.sql`.

```sql
visit_photos (
  id                        uuid primary key default gen_random_uuid(),
  booking_id                uuid null  references reservations(id) on delete cascade,
  user_id                   uuid not null references auth.users(id) on delete cascade,
  restaurant_id             uuid not null references restaurants(id) on delete cascade,
  image_url                 text not null,    -- public storage URL
  caption                   text,
  story_filter_id           text,             -- registry id from lib/storyFilters
  story_filter_captured_at  bigint,           -- epoch ms
  rating                    int,              -- 1..5, optional
  tags                      text[],           -- legacy, no longer written
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
)
```

### RLS

| Cmd      | Policy                                       |
| -------- | -------------------------------------------- |
| SELECT   | **anyone** (`Anyone can read visit photos`)  |
| INSERT   | `auth.uid() = user_id`                       |
| UPDATE   | `auth.uid() = user_id`                       |
| DELETE   | `auth.uid() = user_id` *(added 2026-05-14)*  |

### How the web app should read it

Restaurant page → diner photo grid:

```sql
select
  vp.id, vp.image_url, vp.caption, vp.rating, vp.created_at,
  vp.story_filter_id, vp.story_filter_captured_at,
  p.full_name as poster_name,
  p.avatar_url as poster_avatar
from visit_photos vp
left join user_profiles p on p.auth_user_id = vp.user_id
where vp.restaurant_id = $1
order by vp.created_at desc
limit $2;
```

The same shape, returned by `lib/snaps/visitPhotosApi.ts → listVisitPhotosByRestaurant`,
is what the mobile app uses. Mirror that join in the web app so
display name + avatar are populated.

---

## 5. Table: `restaurant_reviews`

```sql
restaurant_reviews (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  guest_id       uuid not null references guests(id) on delete cascade,
  user_id        uuid not null references user_profiles(id) on delete cascade,
  rating         int  not null check (rating between 1 and 5),
  review_text    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (reservation_id)   -- one review per booking, enforced across web + mobile
)
```

> **Cross-platform dedup contract.** `UNIQUE (reservation_id)` is the
> single source of truth: only one review per booking, ever. Web and
> mobile both INSERT to this table; whichever client gets there first
> wins, and the second client's INSERT returns `23505 unique_violation`
> (treat as success — the user already reviewed, just from another
> device). The `ensure_pending_reservation_review_requests()` RPC's
> `NOT EXISTS` clause also stops creating the prompt notification for
> reviewed reservations, so the other client's "rate your visit" UI
> closes within the next poll / realtime tick.
>
> **Stale name correction (2026-05-14):** earlier revisions of this doc
> called the FK column `booking_id`. The live column is `reservation_id`.
> Migrations from `20260507043115_reservation_review_requests.sql` are
> authoritative.

### RLS

| Cmd      | Policy                                              |
| -------- | --------------------------------------------------- |
| SELECT   | **anyone** + "Users can read own restaurant reviews"|
| INSERT   | `auth.uid() = user_id`                              |
| UPDATE   | `auth.uid() = user_id`                              |
| DELETE   | `auth.uid() = user_id` *(added 2026-05-14)*         |

### How the web app should read it

```sql
select
  r.id, r.rating, r.body, r.created_at, r.user_id,
  p.full_name as reviewer_name
from restaurant_reviews r
left join user_profiles p on p.auth_user_id = r.user_id
where r.restaurant_id = $1
order by r.created_at desc
limit $2;
```

Matches `lib/reviews/getRestaurantReviews.ts → fetchRestaurantPublicReviews`.

---

## 6. What the anonymous role can see

The web app does not need to authenticate diners to render restaurant
pages. Anon SELECT works for:

- `visit_photos` — every row, on any restaurant.
- `restaurant_reviews` — every row, on any restaurant.
- `user_profiles` — `full_name` and `avatar_url` are exposed via the
  `Anyone can read public profile fields` policy (set in
  `supabase/migrations/20260507043856_*`). Sensitive fields (email, phone)
  are NOT visible to anon.
- `restaurants` — public columns including `name`, `cover_photo_url`,
  `cover_image_url`.
- `visit-photos` storage objects — public.

Anon **cannot** write or delete anything in these tables. All mutations go
through the mobile app while the diner is authenticated.

---

## 7. Pairing reviews and snaps

Both rows are written by the same `postSnap` handler in
`app/(customer)/discover/post-review/connect.tsx` when the diner taps
**Post**:

1. `uploadSnapPhoto(...)` — `expo-file-system.uploadAsync` ships the JPEG to
   `visit-photos/{user_id}/{photo_id}.jpg`.
2. `insertVisitPhoto({...})` — inserts the `visit_photos` row with
   `image_url`, `caption`, `rating`, `story_filter_id`, etc.
3. `insertRestaurantReview({...})` — inserts the `restaurant_reviews` row
   with the same `rating` + `caption` body. **Fire-and-forget**: if this
   throws, the snap photo is already persisted.

The two rows share `restaurant_id` and a booking reference, but
crucially they use **different identity columns for `user_id`**:
`visit_photos.user_id` = `auth.users.id`, while
`restaurant_reviews.user_id` = `user_profiles.id`. The web pair-up code
(`apps/web/src/hooks/useRestaurantPhotos.ts`) translates one to the other
via `user_profiles.auth_user_id`. There is **no foreign key** between the
two tables. To pair them:

1. Match on the booking reference (`visit_photos.booking_id` ↔
   `restaurant_reviews.reservation_id`) when both rows carry one.
2. Fall back to the nearest `restaurant_reviews` row for the same poster
   (after the identity translation above) and restaurant within
   **±5 minutes** of the photo's `created_at`.

---

## 8. Delete behaviour (mobile-driven, web app reflects it)

From the customer side, deletes originate on the **My Reviews** screen at
`app/(customer)/profile/my-reviews.tsx` and the **Snap detail** screen at
`app/(customer)/discover/snaps/detail/[snapId].tsx`. Both call
`lib/reviews/deleteMyReview.ts`, which performs:

1. `DELETE FROM visit_photos WHERE id = $vp AND user_id = auth.uid()`.
2. (Optional) `DELETE FROM restaurant_reviews WHERE id = $rev AND user_id = auth.uid()`.
3. `supabase.storage.from('visit-photos').remove([{user_id}/{photo_id}.jpg])`.

Because all three rows live in Supabase, the web app sees the delete
immediately on its next SELECT — no message-queue or webhook required.
**Recommendation:** the web app should not cache restaurant reviews/photos
across page loads for longer than the user spends on the page. The mobile
app refetches both sections on every focus via `useFocusEffect` in
`app/(customer)/discover/[id].tsx`.

---

## 9. Image URL contract (for the web app's `<img>` tags)

```
https://exbjodmnpdiayfzrdyux.supabase.co/storage/v1/object/public/visit-photos/{user_id}/{photo_id}.jpg
```

- Always `image/jpeg`, max 10 MiB.
- No size param / no transformation pipeline — render at whatever CSS size
  fits the layout.
- File names are stable. If the row is deleted, the file is deleted too
  (mobile cleans up; the web app may receive a 404 if it caches a URL after
  a delete).

---

## 10. Where each piece is consumed today (mobile-side reference)

| Surface                         | Reads `visit_photos`? | Reads `restaurant_reviews`? |
| ------------------------------- | --------------------- | --------------------------- |
| Restaurant detail page (Photos) | ✓                     |                             |
| Restaurant detail page (Reviews)|                       | ✓                           |
| Guest Snaps grid                | ✓                     |                             |
| Snap detail screen              | ✓                     |                             |
| Profile → My Reviews            | ✓                     | ✓ (paired)                  |

The web app should at minimum mirror these three views:

1. **Restaurant page** — list reviews (rating + body + author) and a grid
   of recent snaps (photo + author + optional caption).
2. **Snap detail** — single-photo page with the same metadata as the
   mobile snap detail screen.
3. (Optional) **User profile page** — list all snaps + reviews a diner has
   posted, similar to the mobile My Reviews screen.

---

## 11. Known caveats

- `visit_photos.tags` is a populated column but **no longer written** by
  the mobile app (tags UI was removed in commit `d13a0a9`). Treat as
  optional / legacy.
- `visit_photos.rating` was added in
  `20260513140000_visit_photos_snap_columns.sql`. Prior rows may have
  `rating = null`; treat as "not rated" rather than "0 stars".
- The `restaurant_reviews.body` column can be `null` even when the diner
  typed a caption — the mobile insert clamps empty strings to `null`.
- 0-byte storage objects exist from before
  `lib/snaps/uploadSnapPhoto.ts` was rewritten. The web app should display
  them gracefully (e.g. a broken-image placeholder or hide the tile).
  These should be cleaned up out-of-band.
