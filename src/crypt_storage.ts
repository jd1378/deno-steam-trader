import { AES, Buffer, getMachineId } from "../deps.ts";
import { getPathInStorage, mkdir } from "./storage.ts";

/** turns any string with any length to a string with 32 chars */
function normalizeKey(key: string) {
  let newKey = key.replace(/-/g, "");
  newKey = newKey.substr(0, 32);
  if (newKey.length < 32) {
    const requiredCharsCount = 32 - newKey.length;
    for (let i = 0; i < requiredCharsCount; i++) {
      newKey = "0" + newKey;
    }
  }
  return newKey;
}

/**
 * For using this class you need to give proper permissions to deno. It encrypts your data with this machine's id.
 * 
 * Automatically calls JSON.stringify on your data on save and JSON.parse on load.
 * 
 * on windows (not sure): --allow-env --allow-run --allow-read=%cd%\\storage --allow-write=%cd%\\storage
 * 
 * on linux: --allow-read=/var/lib/dbus/machine-id,/etc/machine-id --allow-read=$PWD/storage --allow-write=$PWD/storage
 */
export class CryptStorage {
  static async saveData(path: string, data: unknown) {
    const resolvedPath = getPathInStorage(path);
    await mkdir(resolvedPath);
    const key = normalizeKey(await getMachineId());
    const aes = new AES(key);
    await Deno.writeFile(resolvedPath, await aes.encrypt(JSON.stringify(data)));
  }

  static async loadData(path: string): Promise<unknown> {
    const fileData = await Deno.readFile(getPathInStorage(path));

    const key = normalizeKey(await getMachineId());
    const aes = new AES(key);

    const data = Buffer.from(await aes.decrypt(fileData)).toString(
      "utf-8",
    );
    return JSON.parse(data);
  }
}
