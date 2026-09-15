import { computed, type ComputedRef } from 'vue';

/** Structural equality for prop values that are data, not behaviour: arrays,
 * plain objects, primitives and RegExp (the sanitize schema holds className
 * patterns). Functions and any other object kind (Set, Map, Date, class
 * instances) compare by identity only. Engine plugins are frozen module
 * singletons, so an equal plugin list short-circuits per element. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
  }
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b) || (proto !== null && proto !== Object.prototype)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const other = b as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(other, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], other[key])) return false;
  }
  return true;
}

/** A computed that keeps its previous value when the new one is deep-equal.
 * Vue only notifies dependents of a computed when its value changes
 * identity, so a parent that rebuilds an equal array or object literal on
 * every render does not reach the parse pipeline, whose retained state is
 * keyed by the identity of the plugin chain. This is the Vue counterpart of
 * the React adapter's DEEP_EQUAL stability policy. */
export function stableComputed<T>(source: () => T): ComputedRef<T> {
  let previous: T;
  let seeded = false;
  return computed(() => {
    const next = source();
    if (seeded && deepEqual(previous, next)) return previous;
    previous = next;
    seeded = true;
    return next;
  });
}
