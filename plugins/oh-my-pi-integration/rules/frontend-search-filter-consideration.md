---
name: frontend-search-filter-consideration
description: "Consider search and filtering on the frontend where a selection/get-data control may require it — an unbounded list/menu becomes a searchable or filtered control (search input, filtered dropdown, multi-select, submenus, checklists, DSL) once it can grow"
condition: ["^(?=[\\s\\S]*frontend|client|ui|selector|dropdown|menu|list|checkbox|select|picker)(?=[\\s\\S]*search|filter|filtering|lookup|find (an? )?option|choose (from|among)|narrow down)(?=[\\s\\S]*DSL|query language|submenu|checklist|multi-?select|many options|large (list|menu|set|options))"]
scope: ["text", "thinking"]
---

CONSIDER search/filtering wherever a selection control can grow — unbounded lists are wrong at scale.

- TRIGGER: option set can grow ⇒ search/filter, not scrolling; small fixed sets need nothing (see frontend-pagination-display, data-size-extensibility).
- CONTROL, by shape: searchable input, filtered dropdown, multi-select+search, submenus (hierarchy), DSL (complex), checklists (many) — match pick count/hierarchy.
- DESIGN IN, not retrofit (see research-before-complex-build).

WHY: bounded, findable interaction; deciding up front avoids retrofit.

TIES: frontend-pagination-display, frontend-backend-validation, frontend-request-cooldown, data-size-extensibility, derive-types-from-valid-structures (share option values with backend).

DON'T OVER-APPLY: consider, don't add everywhere; apply when the set can grow unbounded.
