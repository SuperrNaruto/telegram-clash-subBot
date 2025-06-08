# telegram-clash-subBot

This bot converts a Gist containing node lines into a Clash/Mihomo configuration with fine-grained routing rules. It is designed to run as a Telegram bot.

## Prerequisites

- Node.js 18+
- npm

Install dependencies:

```bash
npm install
```

## Environment variables

Create a `.env` file based on `.env.example` and fill in the values:

- `BOT_TOKEN` – Telegram bot token.
- `GITHUB_TOKEN` – Optional, increases GitHub raw rate limit.
- `CACHE_TTL` – Cache time for fetched resources in seconds.
- `SESSION_TTL` – How long a user session remains active without interaction.

## Usage

During development you can run:

```bash
npm run dev
```

Build and start for production:

```bash
npm run build
npm start
```

Send a Gist raw link containing node definitions such as:

```
HK-BAGEHKL-VL-01=vless,bagehkl02.122733.xyz,12101,"e8194655-165d-4f54-aeca-ea27f63f81a1",transport=tcp,over-tls=true,skip-cert-verify=false,flow=xtls-rprx-vision,sni=www.msi.com,public-key="4SOnMHdgnsWC0ITUfqRyVDdV3Jc6pajuCPLsj_6trUg",short-id=39cd9d1aaa93e804,udp=true
```

Then choose rule sets via the inline keyboard. Rules are loaded remotely from [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Clash).

The available categories are fetched dynamically from the repository at runtime. Use the "下一页" and "上一页" buttons to browse through all rule sets.
