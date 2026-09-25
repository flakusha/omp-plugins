---
name: frontend-pagination-display
description: "Pagination on frontend AND backend with a proper amount of elements displayed — users do not list huge pages, devices may be slow, memory can be exhausted, responsiveness suffers; choose a sane page size and bounded rendering"
condition: ["^(?=[\\s\\S]*frontend|client|ui|list|table|grid|display (results|items|rows))(?=[\\s\\S]*pagination|paginate|page size|show more|load more|infinite scroll|next page|items per page)(?=[\\s\\S]*huge page|too many|slow device|memory (exhaust|pressure)|responsive|lag|freeze|virtualiz)"]
scope: ["text", "thinking"]
---

Paginate frontend AND backend; sane, bounded display.

- BOTH: backend bounds the query (see bounded-paginated-reads); frontend renders one page (nav / load-more / infinite scroll), never everything. Unbounded render hangs slow devices; frontend is not the reliability boundary (see frontend-backend-validation).
- SANE PAGE SIZE: thousands of DOM nodes exhaust memory on slow devices — render bounded; virtualize large data (see avoid-intermediate-array-allocations).
- UX FIT: paged nav vs progressive by context; name it (see frontend-request-cooldown).

WHY: unbounded rendering exhausts memory — same no-unbounded-data discipline as the DB (see protocol-timeout-streaming).

TIES: bounded-paginated-reads, data-size-extensibility, frontend-backend-validation, frontend-request-cooldown, avoid-intermediate-array-allocations, prefer-async-parallelism.

DON'T OVER-APPLY: single-digit datasets need none; apply when the dataset can grow (see db-access-performance).
