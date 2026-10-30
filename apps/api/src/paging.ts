// Pagination for list endpoints.
//
// A list endpoint pages only when the caller asks (`?page=`), so existing
// clients that read the whole array keep working unchanged. The body stays a
// plain array; the totals travel in response headers:
//
//   X-Total-Count  rows matching the filters, across every page
//   X-Page         the page returned (1-based, clamped to the last page)
//   X-Page-Size    rows per page
//   X-Total-Pages  pages in all
//
// The default page size is 15 and the ceiling is 100.

import type { FastifyReply } from "fastify";

export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 100;

export interface PageQuery { page?: string; pageSize?: string }

export interface PageSpec {
  /** false when the caller did not ask for a page: return everything, as before */
  enabled: boolean;
  page: number;
  pageSize: number;
}

const toInt = (v: unknown, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

export function pageSpec(q: PageQuery): PageSpec {
  const enabled = q.page !== undefined || q.pageSize !== undefined;
  return {
    enabled,
    page: toInt(q.page, 1),
    pageSize: Math.min(toInt(q.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
  };
}

/**
 * Resolve the window for a known total. A page past the end (the last row on
 * the last page was just deleted) is pulled back to the last page rather than
 * returning an empty list.
 */
export function pageWindow(spec: PageSpec, total: number) {
  const pages = Math.max(1, Math.ceil(total / spec.pageSize));
  const page = Math.min(spec.page, pages);
  return { page, pages, skip: (page - 1) * spec.pageSize, take: spec.pageSize };
}

export function sendPageHeaders(reply: FastifyReply, spec: PageSpec, total: number) {
  const w = pageWindow(spec, total);
  reply.header("X-Total-Count", String(total));
  reply.header("X-Page", String(w.page));
  reply.header("X-Page-Size", String(spec.pageSize));
  reply.header("X-Total-Pages", String(w.pages));
}
