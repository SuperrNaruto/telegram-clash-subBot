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
HK-01=vless,1478523.xyz,12101,"xxx",transport=tcp,over-tls=true,skip-cert-verify=false,flow=xtls-rprx-vision,sni=www.msi.com,public-key="xxx",short-id=xxx,udp=true
```

Then choose rule sets via the inline keyboard. Rules are loaded remotely from [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Clash).

The available categories are fetched dynamically from the repository at runtime. Use the "下一页" and "上一页" buttons to browse through all rule sets. You can press "🔍 搜索" and then send keywords to filter the list.
You can also tap a letter button to quickly filter by the rule name's first letter.

Send `/help` in the chat at any time to see available commands. The bot will
display a one-time keyboard with quick shortcuts for group management.

### Custom groups

Create a `groups.json` file in the project root to define groups of rule sets. Each key is the group name and its value is an array of category names. Selecting a group button toggles all rules inside it and the generated configuration will include those rule sets.

Example `groups.json`:

```json
{
  "Streaming": ["Netflix", "Disney", "YouTube"],
  "Social": ["X", "Telegram"]
}
```

Add more presets by editing this file. Each array entry must match an available
category name exactly. After modifying `groups.json`, restart the bot so the new
groups are loaded.

You can also manage groups directly through the bot:

- `/groups` – list all groups and their rules.
- `/newgroup <name> [rules...]` – create a new group.
- `/addrules <name> <rules...>` – add rules to a group.
- `/removerules <name> <rules...>` – remove rules from a group.
- `/editgroup <name>` – interactively edit a group's rules with buttons.
