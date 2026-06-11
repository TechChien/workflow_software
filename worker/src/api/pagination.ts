import { z } from "zod";

const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional()
});

export function parsePaginationQuery(query: unknown) {
  return PaginationQuerySchema.parse(query ?? {});
}

export function pageItems<TItem extends { id: string }>(items: TItem[], limit: number) {
  const hasNextPage = items.length > limit;
  const page = hasNextPage ? items.slice(0, limit) : items;

  return {
    items: page,
    nextCursor: hasNextPage ? page.at(-1)?.id : undefined
  };
}

export function cursorArgs(
  cursor: string | undefined
): { cursor?: { id: string }; skip?: number } {
  return cursor
    ? {
        cursor: { id: cursor },
        skip: 1
      }
    : {};
}
