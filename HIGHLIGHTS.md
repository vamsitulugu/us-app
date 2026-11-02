# Profile Highlights

Instagram-style circles under the couple card on **Our Profile** (web + Android).

## Set-up (one time)
1. Run `migrations/highlights.sql` in the Supabase SQL editor (creates `highlights` and `highlight_items`).
2. Nothing else: files go into the existing public `couple-photos` bucket under `<coupleId>/highlights/`.
3. Redeploy the server (`routes/highlights.js` is registered in `server.js`).

## API (`/api/highlights`)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/:coupleId` | – | All highlights of the couple (both partners), each with `items[]` |
| POST | `/upload` | multipart `file`, `coupleId`, `userId` (role), `durationSec?`, then `highlightId` **or** `title` + `category` | One clip per call. First call creates the highlight |
| PATCH | `/:id` | `coupleId`, `userId`, `title?`, `category?` | Owner only |
| DELETE | `/item/:itemId` | `coupleId`, `userId` | Owner only. Last clip removes the highlight |
| DELETE | `/:id` | `coupleId`, `userId` | Owner only |

Categories: `travel love dates friends family food events fun other`. Title max 24 chars. Clip max 150 MB.

## Not included (yet)
- Choosing a custom cover (cover = first clip).
- Push notification to the partner when a highlight is added.
