import fs from "fs/promises";

export async function loadGroups(
  path = "groups.json"
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
