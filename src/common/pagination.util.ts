export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function skipTake(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): { items: T[]; meta: PaginationMeta } {
  return {
    items,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
