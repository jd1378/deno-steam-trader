import type { EconItem } from "./EconItem.ts";

export function fastConcat<T>(a?: Array<T>, b?: Array<T>): Array<T> {
  const newArray = (a || []).slice();
  const bArr = b || [];
  for (let i = 0; i < bArr.length; i++) {
    newArray.push(bArr[i]);
  }
  return newArray;
}

export function hasNoName(item: EconItem) {
  return !item.name;
}
