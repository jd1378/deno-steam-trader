import { dirname, resolve } from "../deps.ts";

function getPathInStorage(path: string) {
  return resolve(Deno.cwd(), "storage", path);
}

async function mkdir(path: string) {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch {
    // silently ignore if directory exist
  }
}

/**
 * For using this class you need to give proper permissions to deno.
 * 
 * Automatically calls JSON.stringify on your data on save and JSON.parse on load.
 * 
 * on windows: --allow-read=%cd% --allow-write=%cd%
 * 
 * on linux: --allow-read=$PWD --allow-write=$PWD
 */
export class Storage {
  static async saveData(path: string, data: unknown) {
    const resolvedPath = getPathInStorage(path);
    const dir = dirname(resolvedPath);
    await mkdir(dir);
    await Deno.writeTextFile(resolvedPath, JSON.stringify(data));
  }

  static async loadData(path: string): Promise<unknown> {
    const data = await Deno.readTextFile(getPathInStorage(path));
    return JSON.parse(data);
  }
}
