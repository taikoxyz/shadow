# Shadow UI — E2E Test Report

**Date:** 2026-02-25
**Wallet:** `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb`
**Target:** `http://localhost:3000` (Docker image `shadow-local`, freshly built)
**Tool:** Playwright (headless Chromium) + injected `window.ethereum` mock
**Result:** 34 / 34 passed — 0 failed

---

## Test Environment

| Item | Value |
|------|-------|
| Server | Shadow v0.1.0 (Docker `shadow-local:latest`) |
| Chain | Taiko Hoodi (167013) |
| Shadow Contract | `0x77cdA0575e66A5FC95404fdA856615AD507d8A07` |
| Circuit ID | `0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8` |
| Verifier | `0x38b6e672eD9577258e1339bA9263cD034C147014` |
| Wallet (mock) | `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` |
| Viewport | 1280 × 900 |
| JS Bundle | `index-VBKChVC3.js` (latest build) |

---

## Results by Section

### 1. Page Load (6/6)
| # | Test | Result |
|---|------|--------|
| 1 | Page title is "Shadow" | PASS |
| 2 | Header wordmark "Shadow" present | PASS |
| 3 | Deposit list loaded | PASS |
| 4 | WebSocket RPC dot visible | PASS |
| 5 | Settings gear button present | PASS |
| 6 | No config bar at bottom | PASS |

### 2. Wallet Connection (2/2)
| # | Test | Result |
|---|------|--------|
| 7 | Wallet badge present | PASS |
| 8 | Full wallet address in badge — `0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb` | PASS |

### 3. Address Display (1/1)
| # | Test | Result |
|---|------|--------|
| 9 | No truncated addresses (`0x1234...abcd` pattern) anywhere on list page | PASS |

### 4. Deposits List (4/4)
| # | Test | Result |
|---|------|--------|
| 10 | At least one deposit card — 2 deposits | PASS |
| 11 | Deposit card has status badge | PASS |
| 12 | Deposit card has ETH amount | PASS |
| 13 | Deposit card ID not truncated | PASS |

### 5. Detail View (9/9)
| # | Test | Result |
|---|------|--------|
| 14 | Breadcrumb shows "Deposits" | PASS |
| 15 | Overview section present | PASS |
| 16 | Notes section present | PASS |
| 17 | Settings gear still in header | PASS |
| 18 | Deposit file row has inline action buttons — 4 buttons (↓ + × for deposit and proof) | PASS |
| 19 | No truncated addresses on detail page | PASS |
| 20 | Notes table: recipient addresses untruncated — 2 notes checked | PASS |
| 21 | At most one primary action button | PASS |
| 22 | Funding Status section present | PASS |

### 6. Settings Page (8/8)
| # | Test | Result |
|---|------|--------|
| 23 | Settings breadcrumb present | PASS |
| 24 | RPC Endpoint section | PASS |
| 25 | Appearance section | PASS |
| 26 | Server Info section | PASS |
| 27 | Circuit ID shown (full, untruncated) | PASS |
| 28 | Shadow Contract shown (full, untruncated) | PASS |
| 29 | Dark / Light theme buttons present | PASS |
| 30 | No config bar on settings page | PASS |

### 7. Theme Toggle (2/2)
| # | Test | Result |
|---|------|--------|
| 31 | Light theme applied on click (`data-theme=light`) | PASS |
| 32 | Dark theme restored on click (`data-theme=dark`) | PASS |

### 8. Button Consistency (2/2)
| # | Test | Result |
|---|------|--------|
| 33 | Buttons with `.btn` class present | PASS |
| 34 | All `.btn-icon` elements same size — 28 × 28 px | PASS |

---

## Observations

**All UI improvements verified in the freshly built Docker image:**

- Wallet address badge shows full 42-char address (previously truncated to `0xe36C...D9cb`)
- Notes table recipient column shows full addresses with `word-break: break-all`
- Config bar removed from footer — version / contract info accessible via Settings page
- Settings page shows all contract addresses in full (Shadow, Circuit ID, Verifier)
- Icon buttons uniform 28 × 28 px across all instances
- File rows have inline ↓ download and × delete buttons next to filename (detail view showed 4 buttons: download + delete for both deposit file and proof file)
- Single primary button constraint respected (detail view with proof file has 0 primary buttons — already proved)
- Dark ↔ Light theme toggle works; active theme indicated with ✓ checkmark

**Known limitation:**

- Funding Status balance shows "Loading balance..." in headless test because the injected mock wallet does not respond to `eth_getBalance`. The section renders correctly; balance requires a live RPC call which completes within ~1–2 seconds with MetaMask on Hoodi.

---

## Screenshots

All screenshots captured at 1280 × 900, headless Chromium.

| View | File |
|------|------|
| List view (dark) | `/tmp/shadow_01_list.png` |
| Wallet connected (dark) | `/tmp/shadow_02_wallet.png` |
| Detail view | `/tmp/shadow_03_detail.png` |
| Settings page (dark) | `/tmp/shadow_04_settings.png` |
| Settings page (light) | `/tmp/shadow_05_light_settings.png` |
