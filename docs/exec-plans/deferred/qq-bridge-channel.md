> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `deferred/`——用户明确暂缓，未来可能重启。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [deferred/README.md](README.md)。

# QQ Bridge Channel Integration

> ⏸ **本轮重构暂缓**（见 [refactor-closeout.md](../completed/refactor-closeout.md) "暂缓清单"）— 更多 Bridge 渠道不在本轮 6 条主线内；保留作未来参考。

## Status: IN PROGRESS

## Scope
Add QQ as a new bridge channel. First version: private chat text + image inbound only. No group/channel, no Markdown, no active messages, no stream preview.

## Implementation Steps

### Phase 1: Foundation
- [x] `types.ts`: Add `qq: 2000` to PLATFORM_LIMITS
- [x] `qq-api.ts`: QQ HTTP/WS protocol helpers (token, gateway, heartbeat, send)
- [x] `qq-adapter.ts`: Full adapter (lifecycle, WS, event parsing, auth, image download)
- [x] `adapters/index.ts`: Register `import './qq-adapter'`

### Phase 2: Settings & API
- [x] `src/app/api/settings/qq/route.ts`: GET/PUT QQ settings
- [x] `src/app/api/settings/qq/verify/route.ts`: Verify token + gateway
- [x] `src/app/api/bridge/settings/route.ts`: Add QQ keys

### Phase 3: UI
- [x] `QqBridgeSection.tsx`: Settings UI component
- [x] `BridgeLayout.tsx`: Add QQ sidebar item
- [x] `BridgeSection.tsx`: Add QQ channel toggle
- [x] `i18n/en.ts` + `i18n/zh.ts`: QQ translations

### Phase 4: replyToMessageId Threading
- [x] `bridge-manager.ts`: Thread `msg.messageId` through all reply paths (deliver, deliverResponse, command replies, error replies, permission broker)

## Key Decisions
- No `getPreviewCapabilities()` — QQ passive reply window is tight
- No `channel_offsets` — WS-based, not polling
- Permission: text `/perm` fallback only, no buttons
- `msg_seq` generation in qq-api.ts (auto-increment per reply)
- Image: download attachments, convert to FileAttachment, 20MB limit
