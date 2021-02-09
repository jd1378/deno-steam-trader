import type { EconItem } from "./econ_item.ts";

export function fastConcat<T>(a?: Array<T>, b?: Array<T>): Array<T> {
  const newArray = (a || []).slice();
  const bArr = b || [];
  for (let i = 0; i < bArr.length; i++) {
    newArray.push(bArr[i]);
  }
  return newArray;
}

/** mutates original array (first arg), runs no checks*/
export function fastConcatMU<T>(a: Array<T>, b: Array<T>): void {
  for (let i = 0; i < b.length; i++) {
    a.push(b[i]);
  }
}

export function hasNoName(item: EconItem) {
  return !item.name;
}
