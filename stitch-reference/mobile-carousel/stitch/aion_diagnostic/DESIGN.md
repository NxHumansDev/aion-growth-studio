# Design System Document: The Luminescent Editorial

## 1. Overview & Creative North Star
**Creative North Star: The Precision Oracle**
This design system moves away from the utilitarian "dashboard" look and toward a high-end editorial experience. It treats diagnostic data not just as numbers, but as a narrative. We achieve this through **"The Precision Oracle"** aesthetic—a combination of deep, atmospheric voids (dark mode) and clinical, airy canvases (light mode).

The system breaks the standard mobile grid by using **intentional asymmetry**. Hero scores are treated as typographic art, while data cards use "nested depth" rather than rigid borders. The goal is to make the user feel like they are reading a bespoke report curated specifically for them, rather than looking at a generic database output.

---

## 2. Colors
Our palette is rooted in high-contrast transitions. We use depth and light to guide the eye, never lines.

*   **Primary & Secondary:** `primary` (#aac7ff) and `secondary` (#48e26e) act as our functional anchors. The Neon Green (`secondary_fixed`: #69FF87) is our "signal" color—reserved exclusively for positive outcomes and primary calls to action.
*   **The "No-Line" Rule:** Under no circumstances should 1px solid borders be used to section content. Boundaries are defined by shifting between `surface-container-low` and `surface-container-high`. If two sections need separation, use a background color shift or a `spacing-12` vertical gap.
*   **Surface Hierarchy & Nesting:** Treat the UI as physical layers. 
    *   **Base:** `surface` (#111125)
    *   **Section:** `surface-container-low` (#1a1a2e)
    *   **Cards:** `surface-container-highest` (#333348)
    *   This nesting creates natural "lift" without the clutter of lines.
*   **The "Glass & Gradient" Rule:** Use Glassmorphism for floating navigation and pagination dots. Apply `surface_variant` at 60% opacity with a 12px backdrop blur. For Hero CTAs, use a subtle linear gradient from `primary` to `primary_container` at a 135-degree angle to give the element a "lithographic" soul.

---

## 3. Typography
We use **Inter** as a singular, powerful typeface. The personality is driven by extreme scale variance.

*   **Hero Scores:** Use `display-lg` (3.5rem) for diagnostic scores. These should be tight-tracked (-0.02em) to feel authoritative and "architectural."
*   **Editorial Headings:** `headline-md` is our standard for section starts. Use `on_primary_fixed_variant` (#124687) on light backgrounds to maintain a "Corporate Blue" gravitas.
*   **Functional Labels:** `label-sm` (0.6875rem) must be used with all-caps and +0.05em letter spacing. This provides a "premium technical" feel, like a luxury watch face.
*   **The Narrative Flow:** Body text (`body-md`) should never exceed 60 characters per line to maintain legibility within the 375px viewport.

---

## 4. Elevation & Depth
In this system, elevation is a product of light and tone, not structure.

*   **The Layering Principle:** Depth is achieved by "stacking" surface tiers. To highlight a specific diagnostic detail, place a `surface-container-highest` card inside a `surface-container-low` section. The contrast in luminance creates the "pop."
*   **Ambient Shadows:** For floating elements (like the bottom pagination bar), use an extra-diffused shadow: `box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4)`. The shadow color must be a tinted version of the background, never pure black, to ensure it looks like a natural occlusion of light.
*   **The "Ghost Border" Fallback:** If a container requires a boundary for accessibility on `surface-bright`, use `outline-variant` (#434750) at **15% opacity**. It should be felt, not seen.
*   **Glassmorphism:** Navigation headers must use a semi-transparent `surface` color with a `backdrop-filter: blur(20px)`. This allows the "neon" accent colors of the content to bleed through as the user scrolls, creating a sense of environmental immersion.

---

## 5. Components

### Circular Gauges
*   **Styling:** Use a dual-ring system. The track uses `surface-container-highest`. The progress fill uses a gradient of `secondary_fixed` (#69FF87) to `on_tertiary_container` (#5dd1a4).
*   **Hero Metric:** Place the `display-md` score in the center, perfectly vertically aligned.

### Buttons
*   **Primary:** Background: `secondary_fixed`; Text: `on_secondary_fixed`. Radius: `full`. No shadow.
*   **Secondary (Ghost):** No background. "Ghost Border" at 20% opacity. Text: `secondary_fixed`.
*   **Sizing:** All mobile CTAs must be a minimum of 56px in height to ensure "fat-finger" accessibility.

### Cards & Lists
*   **Card Radius:** Always use `xl` (1.5rem) for primary cards to give a soft, approachable feel.
*   **No Dividers:** In lists, separate items using `spacing-4` of vertical whitespace. If grouping is needed, use a subtle background shift to `surface-container-lowest`.

### Pagination Dots
*   **Fixed Bottom:** Centered at the bottom of the 812px viewport.
*   **Active State:** `secondary_fixed` (#69FF87) with a slight glow (2px blur).
*   **Inactive State:** `surface-container-highest` at 50% opacity.

### Input Fields
*   **Form Factor:** "Underline-only" is forbidden. Use a fully enclosed container with `surface-container-low` and `xl` (1.5rem) corners.
*   **Focus State:** The border transitions from 0% opacity to 100% `primary` (#aac7ff).

---

## 6. Do's and Don'ts

### Do:
*   **Do** use extreme vertical whitespace (e.g., `spacing-16`) to separate high-level diagnostic categories.
*   **Do** allow "Hero Numbers" to bleed slightly off-center for a more editorial, asymmetrical look.
*   **Do** use `secondary_fixed` sparingly; it is a "reward" color for the user's positive data.

### Don't:
*   **Don't** use 1px dividers or borders. If you feel you need one, increase the spacing instead.
*   **Don't** use standard "drop shadows" (e.g., 0, 2, 4). Our shadows are large, ambient, and atmospheric.
*   **Don't** use pure white (#FFFFFF) in dark mode. Use `on_surface` (#e2e0fc) to reduce eye strain and maintain the "Clinical Luminescence" vibe.
*   **Don't** crowd the edges. Maintain a minimum of `spacing-5` (1.25rem) horizontal padding across all screens.