import axios from "axios";

export async function fetchRuleCategories(token?: string): Promise<string[]> {
  const url = "https://api.github.com/repos/blackmatrix7/ios_rule_script/contents/rule/Clash?ref=master";
  const { data } = await axios.get(url, {
    headers: token ? { Authorization: `token ${token}` } : undefined,
    timeout: 15000
  });
  return (data as any[])
    .filter(item => item.type === "dir")
    .map(item => item.name as string)
    .sort();
}
