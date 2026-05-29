# Music Fisheye Canvas - Manual Testing Checklist

## Overview

This document provides a comprehensive manual testing checklist for the Music Fisheye Canvas feature (`/music` route). Each test case includes clear steps, expected results, and cross-references to design requirements and NFRs.

**Feature:** Music Fisheye Canvas (WebGL + R3F Implementation)  
**Spec Path:** `.kiro/specs/music-fisheye-canvas/`  
**Last Updated:** 2025-01-XX

---

## Test Environment Setup

### Prerequisites
- [ ] Development server running (`pnpm run dev`)
- [ ] Test browsers installed:
  - Desktop: Chrome/Edge (latest), Firefox (latest), Safari (latest)
  - Mobile: Chrome Android, Safari iOS
- [ ] Capacitor Android build available for native testing
- [ ] DevTools Performance panel accessible
- [ ] Network throttling tools available

### Test Data
- [ ] Mock tracks loaded (`lib/music/mock-tracks.ts` - 96 tracks)
- [ ] Cover images available (`public/cover.jpg`)
- [ ] Audio file available (`public/cover.mp3`)

---

## Visual & Layout Tests

### TC-01: Desktop High-Density Card Display
**Validates:** Requirement 1.1, NFR-2, Design §1.3

**Test Steps:**
1. Open `/music` in Chrome on desktop (1920×1080 resolution)
2. Wait for canvas to fully load
3. Count visible cards in viewport without scrolling
4. Observe overall visual impression

**Expected Results:**
- [ ] ≥ 50 cards visible in a single viewport
- [ ] Cards arranged in Pinterest-style masonry layout
- [ ] Overall spherical/dome-like curvature is obvious
- [ ] No white flashes or content jumps during load
- [ ] Cards appear as ~100×130px mini cards

**Related Files:**
- `components/music/card-wall-mesh.tsx`
- `hooks/music/use-card-atlas.ts`
- `shaders/card-wall.vert.glsl`

---

### TC-02: Edge Card Perspective & Vignette
**Validates:** Requirement 1.2, NFR-5, Design §4.2, §4.3

**Test Steps:**
1. Load `/music` on desktop
2. Focus on cards at viewport edges (top, bottom, left, right)
3. Compare edge cards to center cards
4. Observe brightness gradient from center to edges

**Expected Results:**
- [ ] Edge cards show visible perspective compression (appear smaller)
- [ ] Edge cards have slight tilt/rotation (not perfectly flat)
- [ ] Vignette effect: edges noticeably darker than center
- [ ] Smooth gradient from bright center to dark edges
- [ ] "Looking into a dome" visual impression

**Related Files:**
- `shaders/card-wall.frag.glsl` (vignette calculation)
- `lib/music/geometry.ts` (fisheye transform)

---

## Interaction Tests

### TC-03: Drag Navigation & Inertia
**Validates:** Requirement 2, 3, NFR-3, NFR-4, CP1, CP8

**Test Steps:**
1. Load `/music` on desktop
2. Click and hold on canvas, drag horizontally 500px
3. Release mouse button
4. Observe canvas behavior after release
5. Repeat with vertical drag
6. Perform quick flick gesture

**Expected Results:**
- [ ] Canvas follows pointer smoothly during drag
- [ ] Cursor changes to "grabbing" state during drag
- [ ] After release, canvas continues sliding (inertia)
- [ ] Inertia velocity gradually decreases (not constant speed)
- [ ] Canvas stops naturally within 1-3 seconds
- [ ] Quick flick produces faster initial inertia
- [ ] Dragging back to original position returns to same view

**Related Files:**
- `hooks/music/use-drag-camera.ts`
- `lib/music/reducer.ts` (stepInertia, applyDelta)

---

### TC-04: Smooth Wheel Scrolling (Desktop, Non-Low Tier)
**Validates:** Requirement 5, Design §6.4

**Test Steps:**
1. Load `/music` on desktop (ensure device tier is not 'low')
2. Hover over canvas
3. Scroll mouse wheel slowly (5 notches)
4. Scroll mouse wheel quickly (10 notches rapidly)
5. Observe canvas movement

**Expected Results:**
- [ ] Canvas scrolls smoothly with damped animation
- [ ] No abrupt jumps or stuttering
- [ ] Scroll direction matches wheel direction
- [ ] Smooth deceleration after wheel stops
- [ ] Does not interfere with drag interaction

**Special Cases:**
- [ ] If device tier is 'low', wheel scrolling should be disabled
- [ ] On touch devices, wheel scrolling should be disabled

**Related Files:**
- `hooks/music/use-wheel-camera.ts`

---

### TC-05: Card Click → Focus Mode
**Validates:** Requirement 6, NFR-7, CP7

**Test Steps:**
1. Load `/music` on desktop
2. Click on any visible card (without dragging)
3. Observe transition to focus mode
4. Click on blurred background area
5. Observe transition back to normal mode
6. Repeat with Esc key instead of clicking background

**Expected Results:**
- [ ] Clicked card smoothly animates to center and enlarges
- [ ] Background blurs with liquid glass effect
- [ ] Only focused card remains sharp and visible
- [ ] All other cards uniformly blurred (no partial blur)
- [ ] Clicking background exits focus mode
- [ ] Pressing Esc exits focus mode
- [ ] Smooth animation back to original position
- [ ] No "half-focused" intermediate states

**Related Files:**
- `components/music/focus-overlay.tsx`
- `components/music/raycast-click-plane.tsx`
- `lib/music/reducer.ts` (FOCUS/UNFOCUS actions)

---

### TC-06: Focus Mode → Play → Floating Player
**Validates:** Requirement 7, 8, 9, NFR-8, CP6

**Test Steps:**
1. Load `/music` on desktop
2. Click a card to enter focus mode
3. Click the play button (▶) in focus overlay
4. Observe floating player appearance
5. Observe audio spectrum glow effect
6. Exit focus mode (Esc or click background)
7. Verify floating player remains visible

**Expected Results:**
- [ ] Play button triggers audio playback
- [ ] Floating player appears in bottom-right corner
- [ ] Floating player shows: cover, title, progress bar, play/pause, close
- [ ] Outer glow pulses in sync with music (bass frequencies)
- [ ] Glow color matches track accent color
- [ ] Exiting focus mode does NOT stop playback
- [ ] Floating player remains visible after exiting focus
- [ ] Only ONE floating player exists at any time

**Related Files:**
- `components/music/floating-player.tsx`
- `hooks/music/use-music-player.ts`
- `hooks/music/use-audio-analyser.ts`
- `lib/music/audio-analysis.ts` (splitBands)

---

### TC-07: Track Switching → Single Floating Player
**Validates:** Requirement 7.4, 8.7, NFR-8, CP6

**Test Steps:**
1. Load `/music` and start playing track A (via focus mode)
2. Verify floating player shows track A
3. Click a different card (track B) to enter focus mode
4. Click play button for track B
5. Count floating players in viewport
6. Verify floating player content

**Expected Results:**
- [ ] Only ONE floating player visible at all times
- [ ] Floating player content updates to track B
- [ ] Track A stops playing when track B starts
- [ ] No duplicate or overlapping floating players
- [ ] Smooth content transition (no flicker)

**Related Files:**
- `lib/music/reducer.ts` (PLAY action, floatingTrackId uniqueness)
- `components/music/floating-player.tsx`

---

## Mobile & Capacitor Tests

### TC-08: Capacitor Android Touch Interaction
**Validates:** Requirement 2 (touch), NFR-11

**Test Environment:**
- Capacitor Android build on physical device or emulator
- Android 8.0+ recommended

**Test Steps:**
1. Launch app on Android device
2. Navigate to `/music` route
3. Perform single-finger swipe gestures (up, down, left, right)
4. Attempt system gestures (pull-down notification, back swipe)
5. Perform quick flick gesture
6. Tap a card to enter focus mode

**Expected Results:**
- [ ] Canvas responds smoothly to touch drag
- [ ] No lag or stuttering during drag
- [ ] System gestures (pull-down, back) are blocked on canvas
- [ ] `touch-action: none` prevents browser interference
- [ ] Inertia works naturally after finger lift
- [ ] Tap-to-focus works without triggering drag

**Related Files:**
- `components/music/music-canvas-r3f.tsx` (touch-action: none)
- `hooks/music/use-drag-camera.ts` (PointerEvents)

---

## Accessibility Tests

### TC-09: Reduced Motion Preference
**Validates:** Requirement NFR-1.4, NFR-12.1, Design §10.2

**Test Steps:**
1. Enable "Reduce Motion" in OS settings:
   - macOS: System Preferences → Accessibility → Display → Reduce motion
   - Windows: Settings → Ease of Access → Display → Show animations
   - Chrome DevTools: Rendering → Emulate CSS media feature prefers-reduced-motion
2. Load `/music` route
3. Observe all animations and effects
4. Drag canvas and release
5. Enter focus mode
6. Play a track

**Expected Results:**
- [ ] Device tier automatically set to 'low'
- [ ] No idle breathing animation on mesh
- [ ] No card hover scan-light effects
- [ ] No audio-reactive glow on floating player (static glow only)
- [ ] Wheel smooth scrolling disabled
- [ ] Entry animation simplified or removed
- [ ] Focus mode transitions instant or minimal
- [ ] Core functionality (drag, play, focus) still works

**Related Files:**
- `hooks/music/use-device-tier.ts`
- `lib/music/device-tier.ts`
- `hooks/music/use-idle-breath.ts`
- `components/music/floating-player.tsx`

---

## Error Handling & Fallback Tests

### TC-10: WebGL Unsupported Fallback
**Validates:** NFR-10, Design §12

**Test Steps:**
1. Disable WebGL in browser:
   - Chrome: `chrome://flags/#ignore-gpu-blocklist` → Disabled
   - Firefox: `about:config` → `webgl.disabled` → true
2. Load `/music` route
3. Observe fallback behavior

**Expected Results:**
- [ ] No white screen or crash
- [ ] Static grid layout displays instead of 3D canvas
- [ ] Each card shows cover image using `next/image`
- [ ] Cards remain clickable (basic interaction)
- [ ] Error message or notice displayed (optional)
- [ ] No console errors related to WebGL context

**Related Files:**
- `components/music/music-page.client.tsx` (ErrorBoundary)
- `components/music/static-grid-fallback.tsx`

---

## Performance Tests

### TC-11: Long Session Memory Stability
**Validates:** NFR-2, CP5, Design §2.2

**Test Steps:**
1. Load `/music` on desktop
2. Open Chrome DevTools → Performance Monitor
3. Note initial values: JS Heap Size, DOM Nodes, GPU Memory
4. Continuously drag canvas in random directions for 10 minutes
5. Enter/exit focus mode 20+ times during session
6. Play/pause/switch tracks 10+ times
7. Monitor memory metrics throughout

**Expected Results:**
- [ ] JS Heap Size remains stable (no continuous growth)
- [ ] DOM node count does not increase over time
- [ ] GPU memory usage stable (no texture leaks)
- [ ] `scene.children.length` remains constant (single mesh)
- [ ] No visible performance degradation after 10 minutes
- [ ] Frame rate remains ≥ 55 FPS (desktop, high tier)

**Monitoring Commands:**
```javascript
// Run in DevTools console
setInterval(() => {
  console.log('Scene children:', window.__r3f?.scene?.children?.length)
}, 5000)
```

**Related Files:**
- `components/music/card-wall-mesh.tsx` (cleanup, dispose)
- `hooks/music/use-card-atlas.ts` (texture management)

---

## Cross-Browser Compatibility

### TC-12: Multi-Browser Visual Consistency

**Test Matrix:**

| Browser | OS | Resolution | Expected Result |
|---------|----|-----------|-----------------| 
| Chrome 120+ | Windows 11 | 1920×1080 | Full feature support |
| Firefox 120+ | Windows 11 | 1920×1080 | Full feature support |
| Safari 17+ | macOS 14 | 1920×1080 | Full feature support |
| Edge 120+ | Windows 11 | 1920×1080 | Full feature support |
| Chrome Android | Android 12+ | 1080×2400 | Touch optimized |
| Safari iOS | iOS 16+ | 390×844 | Touch optimized |

**Test Steps:**
1. Load `/music` in each browser/OS combination
2. Verify visual appearance matches design
3. Test core interactions (drag, focus, play)
4. Check for browser-specific issues

**Expected Results:**
- [ ] Consistent fisheye curvature across browsers
- [ ] Vignette effect renders correctly
- [ ] Liquid glass backdrop-filter works (or graceful fallback)
- [ ] Audio playback works without user gesture errors
- [ ] No browser-specific console errors

---

## Bundle Size Validation

### TC-13: Code Splitting & Chunk Size
**Validates:** NFR-13, Design §2.4

**Test Steps:**
1. Build production bundle: `pnpm run build`
2. Run bundle analyzer: `ANALYZE=true pnpm run build`
3. Open bundle analyzer report in browser
4. Locate `/music` route chunks
5. Locate other route chunks (`/`, `/about`, etc.)
6. Measure gzipped sizes

**Expected Results:**
- [ ] `/music` route client JS (gzipped) ≤ 250 KB
- [ ] `three.js` only appears in `/music` chunks
- [ ] `@react-three/fiber` only in `/music` chunks
- [ ] `@react-three/drei` only in `/music` chunks
- [ ] `animejs` only in `/music` chunks
- [ ] Other routes (`/`, `/about`) do NOT contain above libraries
- [ ] `next/dynamic` boundary working correctly

**Verification Commands:**
```bash
# Check chunk contents
grep -r "three" .next/static/chunks/*.js | grep -v "music"
# Should return no results

# Measure gzipped size
gzip -c .next/static/chunks/pages/music-*.js | wc -c
```

**Related Files:**
- `app/music/page.tsx` (Server Component)
- `components/music/music-page-dynamic.tsx` (dynamic boundary)
- `components/music/music-page.client.tsx` (client imports)

---

## Notes

### Test Execution Guidelines

1. **Test Order:** Execute tests in sequence for first-time validation. Spot-check critical tests for regression testing.

2. **Device Tier Verification:** Before each test, verify current device tier:
   ```javascript
   // Run in DevTools console
   console.log('Device Tier:', window.__musicCanvasState?.deviceTier)
   ```

3. **Failure Reporting:** For any failed test, capture:
   - Screenshot or screen recording
   - Browser console logs
   - DevTools Performance profile (if performance-related)
   - Device/browser/OS details

4. **Known Limitations:**
   - Liquid glass effect (`backdrop-filter`) may not work in older browsers (graceful degradation expected)
   - Audio context creation requires user gesture (first interaction)
   - WebGL performance varies significantly across devices

### Cross-References

**Requirements Document:** `.kiro/specs/music-fisheye-canvas/requirements.md`
- Requirement 1: Immersive music discovery interface
- Requirement 2: Drag navigation
- Requirement 3: Inertia
- Requirement 4: Infinite canvas
- Requirement 5: Wheel scrolling
- Requirement 6: Focus mode
- Requirement 7: Playback in focus
- Requirement 8: Floating player
- Requirement 9: Audio-reactive glow
- NFR-1 through NFR-14

**Design Document:** `.kiro/specs/music-fisheye-canvas/design.md`
- §1: Overview & visual goals
- §2: Architecture
- §4: Shader design
- §6: Camera & interaction
- §10: Device tier
- §12: Error handling

**Tasks Document:** `.kiro/specs/music-fisheye-canvas/tasks.md`
- Phase 1-9: Implementation phases
- Correctness Properties (CP1-CP10)

### Revision History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-01-XX | 1.0 | Initial checklist creation | Kiro |

---

**End of Manual Testing Checklist**
