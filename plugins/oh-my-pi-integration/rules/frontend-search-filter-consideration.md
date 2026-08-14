---
name: frontend-search-filter-consideration
description: "Consider search and filtering on the frontend where a selection/get-data control may require it — an unbounded list/menu becomes a searchable or filtered control (search input, filtered dropdown, multi-select, submenus, checklists, DSL) once it can grow"
condition: ["frontend|client|ui|selector|dropdown|menu|list|checkbox|select|picker", "search|filter|filtering|lookup|find (an? )?option|choose (from|among)|narrow down", "DSL|query language|submenu|checklist|multi-?select|many options|large (list|menu|set|options)"]
scope: ["text", "thinking"]
---

CONSIDER search/filtering on the frontend wherever a selection or get-data control can grow — an unbounded selectable list is the wrong UI once it is large.

THE RULE:
- WHEN REQUIRED: if a dropdown/menu/list can contain MANY options, plan for search or filtering instead of forcing a user to scroll an unbounded list (see frontend-pagination-display for the display-side; see data-size-extensibility for size). The trigger is "the option set can grow".
- CHOOSE THE RIGHT CONTROL for the selection's shape: a searchable text input, a filtered dropdown, a multi-select with search, nested submenus for hierarchy, a DSL/query language for complex selection, or checklists for many independent choices. Match the interaction to single-pick vs multi-pick vs many vs hierarchical.
- DESIGN IT IN, NOT RETROFIT: consider it while designing the interface, not as an after-construction add (see research-before-complex-build). 
- "WHERE MAY BE REQUIRED": confirm the threshold — a small fixed set needs nothing; anything that can grow needs search/filter.

WHY: an unbounded selectable list is a UX failure at scale — search/filter turns "scroll an unbounded list" into a bounded, findable interaction, and deciding it up front avoids a retrofit.

TIES: frontend-pagination-display, frontend-backend-validation, frontend-request-cooldown, data-size-extensibility, derive-types-from-valid-structures (share option values/types with the backend).

DON'T OVER-APPLY: a genuinely small, fixed option set needs no search/filter — the rule is "consider where it may be required", not "add search everywhere". Apply when the set can actually grow into an unbounded scroll.
