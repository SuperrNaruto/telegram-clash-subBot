import YAML from "yaml";
import { NodeMeta } from "./gist.js";
import { alias } from "./alias.js";

const BASE =
  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash";

const REGION_ALIAS: Record<string, string> = {
  HK: "香港节点",
  JP: "日本节点",
  SG: "新加坡节点",
  US: "美国节点",
  UK: "英国节点",
  GB: "英国节点",
  KR: "韩国节点",
  TW: "台湾节点",
  CN: "中国节点",
  DE: "德国节点",
  FR: "法国节点",
  CA: "加拿大节点",
  AU: "澳大利亚节点"
};

export function buildYaml(nodes: NodeMeta[], apps: string[]): string {
  const proxies = nodes.map(n => ({
    name: n.name,
    type: "vless",
    server: n.host,
    port: n.port,
    uuid: n.uuid,
    network: n.params.transport ?? "tcp",
    flow: n.params.flow,
    tls: n.params["over-tls"] === "true",
    "skip-cert-verify": n.params["skip-cert-verify"] !== "false",
    sni: n.params.sni,
    udp: n.params.udp === "true"
  }));

  const regionProxyMap: Record<string, string[]> = {};
  for (const n of nodes) {
    const name = REGION_ALIAS[n.region] ?? n.region;
    if (!regionProxyMap[name]) regionProxyMap[name] = [];
    regionProxyMap[name].push(n.name);
  }
  const regionNames = Object.keys(regionProxyMap);

  const groups = [
    {
      name: "♻️ Automatic",
      type: "url-test",
      url: "https://cp.cloudflare.com/generate_204",
      interval: 300,
      proxies: proxies.map(p => p.name)
    },
    ...regionNames.map(r => ({
      name: r,
      type: "select",
      proxies: regionProxyMap[r]
    })),
    { name: "DIRECT", type: "direct" },
    { name: "REJECT", type: "reject" },
    ...apps.map(app => ({
      name: `🎯 ${app}`,
      type: "select",
      proxies: ["♻️ Automatic", ...regionNames, "DIRECT", "REJECT"]
    }))
  ];

  const ruleProviders: Record<string, any> = {};
  for (const app of apps) {
    const folder = alias[app] ?? app;
    ruleProviders[app] = {
      type: "http",
      behavior: "domain",
      url: `${BASE}/${folder}/${folder}.yaml`,
      path: `./rules/${folder}.yaml`,
      interval: 86400
    };
  }

  const ruleLines = apps.map(app => `RULE-SET,${app},🎯 ${app}`);
  ruleLines.push("MATCH,♻️ Automatic");

  return YAML.stringify({
    port: 7890,
    socksPort: 7891,
    "allow-lan": true,
    mode: "rule",
    proxies,
    "proxy-groups": groups,
    "rule-providers": ruleProviders,
    rules: ruleLines
  });
}
