import { alias } from "./alias.js";

const BASE =
  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash";

export function ruleUrl(app: string): string {
  const folder = alias[app] ?? app;
  return `${BASE}/${folder}/${folder}.yaml`;
}
