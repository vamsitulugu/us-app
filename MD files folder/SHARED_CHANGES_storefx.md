# SHARED_CHANGES: Twin Store effects (themes, frames, decor, game packs)

Status: NOT COMPILED in sandbox (no Kotlin compiler). Brace/paren balance checked only.
README rules R-30/R-31: this patch edits files outside its own folder. Apply only if you approve
(say "override README rule R-30/R-31" or review the patch first). New code is all in `feature/storefx/`.

## Gradle/catalog lines
None.
## Manifest entries
None.
## AppNavHost line
None.
## TwinDatabase entities
None.
## Strings/permissions
None (pack/decor names are in `StoreFxCatalog`, same as the server catalog).

## Edits outside feature/storefx (reason)
- chat/ChatGraph.kt: wraps ChatScreen in `StoreFxThemed` (dark text on light themes).
- chat/ui/ChatStyle.kt: Base, Glass, Bar, Field, Selection, MineOutline, SentBubble, Avatar, MetaText read the equipped theme.
- chat/ui/ChatBubbles.kt: partner bubble uses theme partner colour.
- chat/ui/ChatMedia.kt: default wallpaper = theme background gradient (a chosen wallpaper still wins).
- music/ui/components/MusicStyle.kt: page, accent, glow, card follow the theme (player card = partner colour).
- rewards/*: `partnerFrame` in DTO, domain, repository; ViewModel pushes equipped items into `StoreFxState`;
  FIX: equip no longer wipes the equipped map (server answers only category + itemId).
- profile/ui/components/ProfileComponents.kt: `ProfileAvatar(frame = ...)`; MainPage, OtherPages, PartnerProfilePage pass it.
- home/ui/HomeScreen.kt: `CozyCornerCard()` under the rewards card.
- games/domain/engine/TruthOrDareEngine.kt + games/ui/play/TruthOrDareScreen.kt: equipped pack = extra category + suggestions.

## CHANGE REQUEST: promote StoreFxState to core
Why: chat, music, profile, home and games all read it; features importing `feature.storefx` conflicts with R-83.
Proposed: move `StoreFxState` (+ catalog) to `core/design`. Features affected: all above.

## Backend changes
REQUIRES BACKEND CHANGE: deploy us-app commit "Twin Store effects (web)": adds themes `theme_lavender`, `theme_cotton`
and `partnerFrame` on GET /api/rewards/summary and /api/rewards/store. If `reward_config.store_catalog` exists in
Supabase, add the two themes to that row too (it overrides the built-in list).

## Known gaps
Avatars outside Profile (chat header, Home hero) do not draw frames yet. Equipped state is not cached, so the first
Home load after app start recolours Chat/Music a moment late. Light themes not visually checked on device.
