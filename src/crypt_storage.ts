import { AES, Buffer, getMachineId } from "../deps.ts";

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
 * on windows: --allow-env, --allow-run
 * 
 * on linux: --allow-read=/var/lib/dbus/machine-id,/etc/machine-id
 */
export class CryptStorage {
  static async saveData(path: string | URL, data: string) {
    const key = normalizeKey(await getMachineId());
    const aes = new AES(key);
    await Deno.writeFile(path, await aes.encrypt(data));
  }

  static async loadData(path: string | URL): Promise<string> {
    const fileData = await Deno.readFile(path);

    const key = normalizeKey(await getMachineId());
    const aes = new AES(key);

    const data = Buffer.from(await aes.decrypt(fileData)).toString(
      "utf-8",
    );
    return data;
  }
}
