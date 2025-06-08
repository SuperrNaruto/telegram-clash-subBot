import YAML from "yaml";
import { NodeMeta } from "./gist";

export function buildYaml(
  nodes: NodeMeta[],
  rules: Record<string, string>
): string {
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

  const regions = [...new Set(nodes.map(n => n.region))];
  const groups = [
    {
      name: "♻️ Automatic",
      type: "url-test",
      url: "https://cp.cloudflare.com/generate_204",
      interval: 300,
      proxies: proxies.map(p => p.name)
    },
    ...regions.map(r => ({
      name: `🌏 ${r}`,
      type: "select",
      proxies: proxies.filter(p => p.name.startsWith(r)).map(p => p.name)
    })),
    { name: "DIRECT", type: "direct" },
    { name: "REJECT", type: "reject" },
    ...Object.keys(rules).map(app => ({
      name: `🎯 ${app}`,
      type: "select",
      proxies: ["♻️ Automatic", "DIRECT", "REJECT"]
    }))
  ];

  const ruleProviders: Record<string, any> = {};
  for (const [app, body] of Object.entries(rules)) {
    ruleProviders[app] = { type: "inline", behavior: "domain", body };
  }

  const ruleLines = Object.keys(rules).map(
    app => `RULE-SET,${app},🎯 ${app}`
  );
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
