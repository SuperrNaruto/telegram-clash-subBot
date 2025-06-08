import axios from "axios";
import { alias } from "./alias";

const BASE =
  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash";

export async function fetchRule(app: string, token?: string): Promise<string> {
  const folder = alias[app] ?? app;
  const url = `${BASE}/${folder}/${folder}.yaml`;
  const { data } = await axios.get(url, {
    headers: token ? { Authorization: `token ${token}` } : undefined,
    timeout: 15000
  });
  return data as string;
}
