# Goblin L00t — Discord Server Setup Guide

Use this as a step-by-step blueprint when configuring the Goblin L00t support server.

---

## Roles (create in this order — highest to lowest)

| Role | Color | Who gets it | Key permissions |
|---|---|---|---|
| 👑 Goblin Overlord | Gold `#F5A623` | You (owner) | Administrator |
| 🛡️ Staff | Amber `#E8B84B` | Team / moderators | Manage Messages, Kick Members, Mute Members |
| 💎 Goblin King | Purple `#9B59B6` | Pro-tier subscribers | Access to #goblin-king-lounge |
| ✨ Premium Goblin | Blue `#3498DB` | Premium-tier subscribers | Access to #premium-chat |
| 🎙️ Streamer | Green `#2ECC71` | Linked-Twitch users (self-assign or manual) | Access to #streamer-showcase |
| 👾 Goblin | Default grey | Everyone on join (default role) | Send Messages in public channels |
| 🤖 Bots | Dark grey | Bot accounts | Role-specific; no Admin |

---

## Categories & Channels

### 📋 INFORMATION
> Read-only for members. Staff can post.

| Channel | Type | Topic |
|---|---|---|
| `#welcome` | Text | Server rules, how to get help, links to dashboard + docs |
| `#announcements` | Text | Major releases, outages, maintenance windows. Slowmode: 1h. |
| `#changelog` | Text | Cross-posted from goblinl00t.com/changelog on each release |
| `#roadmap` | Text | Pinned post of planned features and their status |

---

### 🐛 SUPPORT
> Members can post. Staff manage.

| Channel | Type | Topic |
|---|---|---|
| `#faq` | Text | Pinned answers to the most common setup questions (staff-only posts) |
| `#bug-reports` | Text | Use the pinned template when reporting. One issue per post. |
| `#help-desk` | Forum | Open-ended help questions. Members can mark posts as resolved. |
| `#known-issues` | Text | Staff-maintained pinned list of open bugs + workarounds |

**Pinned bug report template for `#bug-reports`:**
```
**What happened:**

**What you expected:**

**Steps to reproduce:**
1.
2.
3.

**Bot theme:** Goblin / CS2
**Subscription tier:** Free / Premium / Pro
**Screenshot or error message (if any):**
```

---

### 💡 SUGGESTIONS
> Members can post. Staff react with ✅ (accepted) / ❌ (declined) / 🔁 (considering).

| Channel | Type | Topic |
|---|---|---|
| `#feature-requests` | Forum | Suggest new features. Search before posting — upvote existing ones. |
| `#feedback` | Text | General thoughts on the product, UX, pricing, etc. |

---

### 💬 COMMUNITY

| Channel | Type | Topic |
|---|---|---|
| `#general` | Text | Off-topic chat, introductions |
| `#streamer-showcase` | Text | Share your stream or giveaway highlights. Streamers role only. |
| `#loot-flex` | Text | Post screenshots of rare drops or big giveaway wins |
| `#bot-suggestions` | Text | Quick one-line ideas that don't need a full feature request |

---

### 💎 GOBLIN KING LOUNGE
> Pro-tier subscribers only. Invite-gated.

| Channel | Type | Topic |
|---|---|---|
| `#king-chat` | Text | Private chat for pro subscribers |
| `#early-access` | Text | Preview upcoming features and share feedback before release |
| `#direct-feedback` | Text | Direct line to flag issues and suggestions with higher priority |

---

### 🔧 STAFF (private — Staff role only)

| Channel | Type | Topic |
|---|---|---|
| `#staff-chat` | Text | Internal coordination |
| `#bug-tracker` | Text | Thread-per-bug tracking: status, reproduction, fix PR link |
| `#feature-backlog` | Text | Internal feature prioritization notes |
| `#release-notes-draft` | Text | Draft changelog entries before publishing to #changelog |
| `#logs` | Text | Bot/webhook notifications (new signups, Stripe events, etc.) |

---

## Channel Permissions Quick Reference

| Category | @everyone | 🎙️ Streamer | ✨ Premium | 💎 Goblin King | 🛡️ Staff |
|---|---|---|---|---|---|
| INFORMATION | View + Read | — | — | — | Post |
| SUPPORT | View + Post | — | — | — | Manage |
| SUGGESTIONS | View + Post | — | — | — | Manage |
| COMMUNITY | View + Post | #streamer-showcase | — | — | Manage |
| GOBLIN KING LOUNGE | ❌ | ❌ | ❌ | View + Post | View + Post |
| STAFF | ❌ | ❌ | ❌ | ❌ | Full access |

---

## Server Settings

- **Verification level:** Medium (must have verified email on Discord account)
- **Explicit content filter:** Scan messages from all members
- **Default notifications:** Only @mentions (reduces noise for members)
- **System messages channel:** `#welcome` — enable "Member joined" messages
- **Vanity URL:** Request `discord.gg/goblinl00t` once you hit 100 members

---

## Onboarding / Rules Checklist (pin in `#welcome`)

```
👋 Welcome to the Goblin L00t community!

🔗 Dashboard → https://goblinl00t.com
📖 Docs / Help → https://goblinl00t.com/help
📝 Changelog → https://goblinl00t.com/changelog

RULES
1. Be respectful — no harassment, slurs, or personal attacks.
2. Keep it on-topic — use the right channel for bugs, suggestions, and chat.
3. Search before posting — check #faq and #known-issues first.
4. One bug per post in #bug-reports — use the pinned template.
5. No self-promotion outside #streamer-showcase.
6. Staff decisions are final.

🎙️ Streamer role: post your Twitch link in #streamer-showcase and tag a @Staff member.
💎 Goblin King role: assigned automatically when you link your Discord (coming soon).
```

---

## Bots to Add

| Bot | Purpose |
|---|---|
| **Carl-bot** | Auto-roles, reaction roles (for self-assign Streamer), moderation logs |
| **MEE6** (optional) | Leveling / activity tracking if you want gamification |
| **Dyno** (optional) | Moderation automation, slowmode management |
