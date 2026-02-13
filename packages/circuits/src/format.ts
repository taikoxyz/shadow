export function bytesToCircuitInput(bytes: Uint8Array): string[] {
  return Array.from(bytes, (b) => b.toString());
}

export function padArray<T>(values: readonly T[], length: number, fill: T | (() => T)): T[] {
  const result = [...values];
  const filler = typeof fill === "function" ? (fill as () => T) : () => clone(fill);

  while (result.length < length) {
    result.push(filler());
  }

  return result;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) } as T;
  }
  return value;
}
