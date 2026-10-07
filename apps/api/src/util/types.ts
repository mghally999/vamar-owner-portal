/** Partial update where every field may be explicitly undefined (what zod `.partial()` produces). */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };
