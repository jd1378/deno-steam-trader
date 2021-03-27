import { dirname, resolve } from "../deps.ts";

export function getPathInStorage(path: string) {
  return resolve(Deno.cwd(), "storage", path);
}

export async function mkdir(path: string) {
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
  } catch {
    // silently ignore if directory exist
  }
}

/**
 * For using this class you need to give proper permissions to deno.
 * 
 * Automatically calls JSON.stringify on your data on save and JSON.parse on load.
 * 
 * on windows (not sure): --allow-read=%cd%\\storage --allow-write=%cd%\\storage
 * 
 * on linux: --allow-read=$PWD/storage --allow-write=$PWD/storage
 */
export class Storage {
  static async saveData(path: string, data: unknown) {
    const resolvedPath = getPathInStorage(path);
    await mkdir(resolvedPath);
    await Deno.writeTextFile(
      resolvedPath,
      typeof data === "string" ? data : JSON.stringify(data),
    );
  }

  static async loadData(path: string, { noParse = false }): Promise<unknown> {
    const data = await Deno.readTextFile(getPathInStorage(path));
    if (noParse) return data;
    return JSON.parse(data);
  }
}
