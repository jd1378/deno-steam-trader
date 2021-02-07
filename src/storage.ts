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
 * on windows: --allow-read=%cd% --allow-write=%cd%
 * 
 * on linux: --allow-read=$PWD --allow-write=$PWD
 */
export class Storage {
  static async saveData(path: string, data: string) {
    const resolvedPath = getPathInStorage(path);
    const dir = dirname(resolvedPath);
    await mkdir(dir);
    await Deno.writeTextFile(resolvedPath, data);
  }

  static async loadData(path: string): Promise<string> {
    const data = await Deno.readTextFile(getPathInStorage(path));
    return data;
  }
}
