# Design System Specification: High-End B2B Intelligence

## 1. Overview & Creative North Star: "The Digital Curator"
This design system moves beyond the generic SaaS "dashboard" to create an experience of **The Digital Curator**. While inspired by the efficiency of Linear and the precision of Stripe, this system introduces an editorial weight that signals authority and high-stakes intelligence. 

We reject the "flat box" epidemic. Instead, we use intentional asymmetry, expansive negative space, and a sophisticated layering of surfaces to guide the user’s eye. The goal is to make complex marketing data feel curated, not just displayed. We achieve this through "The Breathing Layout"—where whitespace isn't just a gap, but a structural element that forces focus on high-value intelligence.

---

## 2. Colors & Surface Logic
The palette is rooted in a deep, authoritative `primary` blue, balanced by a sophisticated spectrum of neutral "Surface" tiers.

### The "No-Line" Rule
Standard 1px borders are strictly prohibited for sectioning. Structural boundaries must be defined solely through background shifts. To separate a card from a page, place a `surface_container_lowest` (#ffffff) element on a `surface` (#fcf8ff) background. 

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the following tiers to create depth without lines:
- **Base Layer:** `surface` (#fcf8ff) – The canvas for the entire application.
- **Section Layer:** `surface_container_low` (#f5f2ff) – Used for grouping large content blocks.
- **Action Layer:** `surface_container_lowest` (#ffffff) – Reserved for primary cards and interactive canvases.
- **Active/Hover Layer:** `surface_container_high` (#e8e5ff) – Used to indicate state changes or nested sub-sections.

### The Glass & Gradient Exception
While the aesthetic is "clean," we use **Glassmorphism** for floating elements (Modals, Popovers, and Toast notifications). Use `surface_container_lowest` at 80% opacity with a `backdrop-blur` of 12px. To provide a "signature" polish, primary CTAs may use a subtle linear gradient from `primary` (#00346d) to `primary_container` (#1a4b8c) at a 135-degree angle to add a tactile, premium depth.

---

## 3. Typography: Editorial Precision
We use **Inter** not as a standard sans-serif, but as a Swiss-style typographic tool. 

- **Display (display-lg/md):** Used for high-level "Growth Wins." These should be set with tight letter-spacing (-0.02em) to feel like a premium financial journal.
- **Headline (headline-sm):** Used for dashboard module titles. Always paired with high whitespace (Spacing 10) above to signal a new context.
- **Body (body-md):** Set to `on_surface_variant` (#434750) for readability.
- **Labels (label-md/sm):** Used for data points. These should often be all-caps with increased letter-spacing (+0.05em) to differentiate them from actionable text.

The hierarchy is designed to be **Top-Heavy**: Large titles, generous breathing room, and compact, precise data labels.

---

## 4. Elevation & Depth: Tonal Layering
We do not use structural lines. Depth is achieved through "The Layering Principle."

- **The Layering Principle:** Place a `surface_container_lowest` card on a `surface_container_low` section. The subtle shift in hex value creates a soft, natural lift.
- **Ambient Shadows:** For floating elements only (e.g., active dropdowns), use a multi-layered shadow: `0px 4px 20px rgba(26, 26, 46, 0.04), 0px 8px 40px rgba(26, 26, 46, 0.08)`. The shadow color must be a tint of `on_surface` (#1a1a2e), never pure black.
- **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., input fields), use `outline_variant` at **20% opacity**. 100% opaque borders are strictly forbidden.

---

## 5. Components

### Buttons & Chips
- **Primary Button:** `primary` background with `on_primary` text. Use `xl` (0.75rem) roundedness. No shadow; use the subtle gradient exception for "Hero" actions.
- **Secondary Button:** `surface_container_high` background. No border.
- **Chips:** Always use `lg` (0.5rem) roundedness. Use `secondary_fixed` for active filters to create a soft blue "glow" without using an actual glow effect.

### Input Fields & Controls
- **Inputs:** Background should be `surface_container_lowest`. Use the "Ghost Border" (outline_variant at 20%). On focus, transition the border to `primary` at 100% and add a 2px `primary_fixed` outer "halo."
- **Checkboxes/Radios:** Use `primary` for selected states. The "unselected" state should be a simple `surface_container_high` square—no border.

### Cards & Lists
- **The No-Divider Rule:** Forbid the use of horizontal divider lines in lists. Separate list items using **Vertical Whitespace** (Spacing 2 or 3). 
- **Data Rows:** Use alternating backgrounds (`surface` and `surface_container_low`) for complex tables rather than lines.

### Specialized Intelligence Components
- **Trend Indicators:** Use `error` (#ba1a1a) and `green` (#1d9e75) exclusively for data direction. Pair with `label-sm` typography.
- **Sidebar:** A monolithic `on_surface` (#1a1a2e) block. Icons must be 1.5px stroke weight. Active states use a "Vertical Bar" indicator in `secondary_container`, creating a high-contrast focal point.

---

## 6. Do’s and Don’ts

### Do:
- **Do** use `Spacing 16` or `20` between major dashboard sections to create an "Editorial" feel.
- **Do** lean on typography size contrasts (Display vs. Label) to create hierarchy.
- **Do** use `backdrop-blur` on navigation bars to allow surface colors to bleed through as the user scrolls.

### Don’t:
- **Don’t** use a border to separate the sidebar from the main content; use the color contrast between `on_surface` and `surface`.
- **Don’t** use "Default" blue (#0000FF). Only use the specific tonal blues defined in the `primary` and `secondary` tokens.
- **Don’t** crowd the screen. If a page feels full, increase the spacing tokens and move secondary data to a "Surface Container" nesting level.
- **Don't** use 100% black text. Use `on_surface` (#1a1a2e) for all "black" text to maintain a premium, ink-like softness.