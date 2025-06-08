import axios from "axios";

export interface NodeMeta {
  name: string; host: string; port: number; uuid: string;
  params: Record<string, string>; region: string;
}

export async function fetchGistRaw(url: string, token?: string): Promise<string> {
  const rawUrl = url.includes("/raw")
    ? url
    : url.replace("gist.github.com", "gist.githubusercontent.com") + "/raw";
  const { data } = await axios.get(rawUrl, {
    headers: token ? { Authorization: `token ${token}` } : undefined,
    timeout: 15000
  });
  return data as string;
}

export function parseNodeLine(line: string): NodeMeta {
  const [name, type, host, portStr, uuid, ...rest] = line.split(",");
  const params: Record<string, string> = {};
  rest.join(",").split(",").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v) params[k.trim()] = v.replace(/"/g, "");
  });
  const region = name.split("-")[0];
  return {
    name: name.trim(),
    host: host.trim(),
    port: Number(portStr),
    uuid: uuid.replace(/"/g, "").trim(),
    params, region
  };
}