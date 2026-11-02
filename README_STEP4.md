# Twin Rewards — Step 4: Twin Store & Spend Sinks
**Chat Themes, Profile Frames, Virtual Home Decor & Game Packs**

---

## 1. Overview
In Step 4, users can spend their earned Gold Coins in the **Twin Store**.

### Sinks & Default Pricing
- **Chat Themes (100 coins):**
  - Sunset Glow (`#ff7a59` gradient)
  - Midnight Rose (`#3a0425` gradient)
  - Ocean Breeze (`#1e3c72` gradient)
  - Lavender Dream (`#834d9b` gradient)
- **Profile Frames (80–120 coins):**
  - Golden Aura (`#f5b83d`)
  - Neon Heart (`#ff2d55`)
  - Sparkle Crown (`#a855f7`)
  - Diamond Shine (`#06b6d4`)
- **Virtual Home Decor (120–150 coins):**
  - Romantic Fireplace 🪵
  - Fairy String Lights ✨
  - Couple Bonsai Tree 🪴
  - Grand Piano 🎹
- **Game Packs (80–90 coins):**
  - Deep Questions Deck 🎴
  - Spicy Dares Pack 🔥
  - Couple Trivia Gold 🧠

---

## 2. Key Architecture & Behavior
1. **Coupled vs Personal Unlocks:**
   - Themes, Home Decor, and Game Packs are shared per couple (`reward_purchases` keyed on `couple_id` + `item_id`).
   - Profile frames are unlocked for the couple, and each partner can independently equip their own frame (`reward_equipped` keyed on `couple_id`, `category`, and `user_id`).
2. **Double-Tap Protection (Idempotency):**
   - The backend uses atomic coin debiting via `reward_credit()` with a unique `client_id`. Retrying or double tapping never charges twice.
3. **Equip / Unequip State:**
   - Active equipped items are stored in `reward_equipped` and synchronized in `RewardsSummary` (`equipped` map and `unlockedItemIds`).
   - Tapping an active item toggles it off (unequips); tapping an unlocked item activates it.

---

## 3. Database Migration
Run the following SQL in your Supabase SQL editor:
```sql
-- See migrations/rewards_v4_store.sql
CREATE TABLE IF NOT EXISTS reward_purchases (
  id BIGSERIAL PRIMARY KEY,
  couple_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  price INT NOT NULL DEFAULT 0,
  client_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reward_purchases_couple_item UNIQUE (couple_id, item_id)
);

CREATE TABLE IF NOT EXISTS reward_equipped (
  couple_id TEXT NOT NULL,
  category TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (couple_id, category, user_id)
);
```

---

## 4. Modified Files List

### Web / Backend (`us-app`)
- `routes/rewards.js`:
  - Catalog list `DEFAULT_STORE_ITEMS`
  - Overrideable via `reward_config` (`store_catalog`)
  - `GET /api/rewards/store`
  - `POST /api/rewards/buy`
  - `POST /api/rewards/store/equip`
  - Updated `buildSummary()` to include `unlockedItemIds` and `equipped`
- `public/rewards.js`: Twin Store card with category filter chips, item cards, unlock & equip handling
- `public/rewards.css`: Twin Store grid, filter tabs, item preview swatches, and active states
- `public/sw.js`: Bumped cache to `uwl-v65`
- `migrations/rewards_v4_store.sql`: Store SQL migration
- `tests/rewards-store.test.js`: Comprehensive backend test suite for Step 4

### Android App (`twin-hearts-android`)
- `app/src/main/java/com/twinhearts/app/feature/rewards/domain/RewardsModels.kt`: `StoreItem`, `StoreCatalog`, `StorePurchaseResult`, `StoreEquipResult`, and updated `RewardsSummary`
- `app/src/main/java/com/twinhearts/app/feature/rewards/data/remote/RewardsApi.kt`: `store()`, `buy()`, `equip()` API endpoints and DTOs
- `app/src/main/java/com/twinhearts/app/feature/rewards/data/RewardsRepository.kt`: Repository interface & implementation
- `app/src/main/java/com/twinhearts/app/feature/rewards/ui/RewardsViewModel.kt`: State management for store items, active unlocks, equip state, and category filtering
- `app/src/main/java/com/twinhearts/app/feature/rewards/ui/RewardsParts.kt`: Native Jetpack Compose `TwinStoreCard` and `StoreItemRow` with preview color swatches and action buttons
- `app/src/main/java/com/twinhearts/app/feature/rewards/ui/RewardsScreen.kt`: Embedded store in rewards list
- `app/src/main/res/values/strings_rewards.xml`: Store localized UI strings
