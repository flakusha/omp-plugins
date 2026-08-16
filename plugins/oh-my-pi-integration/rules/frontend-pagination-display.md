---
name: frontend-pagination-display
description: "Pagination on frontend AND backend with a proper amount of elements displayed — users do not list huge pages, devices may be slow, memory can be exhausted, responsiveness suffers; choose a sane page size and bounded rendering"
condition: ["^(?=[\\s\\S]*frontend|client|ui|list|table|grid|display (results|items|rows))(?=[\\s\\S]*pagination|paginate|page size|show more|load more|infinite scroll|next page|items per page)(?=[\\s\\S]*huge page|too many|slow device|memory (exhaust|pressure)|responsive|lag|freeze|virtualiz)"]
scope: ["text", "thinking"]
---

Paginate the FRONTEND and the BACKEND together, and display a PROPER AMOUNT of elements.

THE RULE:
- FRONTEND + BACKEND PAGINATION: both layers paginate as one contract — the backend bounds the query (see bounded-paginated-reads); the frontend renders one page at a time with paginated navigation / load-more / infinite scroll rather than rendering everything at once.
- PROPER AMOUNT DISPLAYED: choose a SANE page size and stick to it. Users do not want to scroll huge pages; devices may be slow; rendering thousands of DOM/node elements exhausts memory and kills responsiveness. Render and keep a bounded set — virtualized list for large data — not the whole dataset (see avoid-intermediate-array-allocations for the memory side of large collections).
- MATCH UX TO DATA SIZE: paged navigation vs progressive (load-more/infinite scroll) chosen by context — small datasets may fit one page; large ones need bounded display. Name the choice (see frontend-request-cooldown: the discipline of naming the UX decision).
- MEMORY/RESPONSIVENESS are the failure modes: an unbounded render is a hang/freeze on a slow device — that is a UX defect even though the frontend is not the reliability boundary (see frontend-backend-validation).

WHY: unbounded frontend rendering of large results exhausts memory and destroys responsiveness — the same "do not render/buffer unbounded data" discipline applies in the UI as in the DB (see protocol-timeout-streaming).

TIES: bounded-paginated-reads, data-size-extensibility, frontend-backend-validation, frontend-request-cooldown, avoid-intermediate-array-allocations, prefer-async-parallelism.

DON'T OVER-APPLY: tiny datasets (single-digit items) need no pagination — a page size is overhead there. Apply when the dataset can actually grow (see the many-vs-one judgment in db-access-performance).
