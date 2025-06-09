import fs from "fs/promises";

export const GROUPS_FILE = "groups.json";

export async function loadGroups(
  path = GROUPS_FILE
): Promise<Record<string, string[]>> {
  try {
    const data = await fs.readFile(path, "utf-8");
    const obj = JSON.parse(data);
    if (typeof obj !== "object" || obj === null) throw new Error("格式错误");
    const result: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) result[k] = v.map(s => String(s));
    }
    return result;
  } catch (e: any) {
    console.warn("未加载自定义分组", e.message);
    return {};
  }
}

export async function saveGroups(
  groups: Record<string, string[]>,
  path = GROUPS_FILE
) {
  await fs.writeFile(path, JSON.stringify(groups, null, 2), "utf-8");
}
