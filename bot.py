import os
import json
import yaml
import asyncio
import aiohttp
from dataclasses import dataclass, field
from typing import Dict, List, Set

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, InputFile
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

BOT_TOKEN = os.getenv("BOT_TOKEN")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
SESSION_TTL = int(os.getenv("SESSION_TTL", "3600"))
PAGE_SIZE = 10
GROUP_PAGE_SIZE = 5
ALPHABET = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")

alias = {
    "PrimeVideo": "AmazonPrimeVideo",
    "TikTok": "DouYin",
    "Copilot": "MicrosoftCopilot",
    "ChatGPT": "OpenAI",
    "X": "Twitter",
}

@dataclass
class NodeMeta:
    name: str
    host: str
    port: int
    uuid: str
    params: Dict[str, str]
    region: str


async def fetch_gist_raw(url: str, token: str | None = None) -> str:
    raw_url = url if "/raw" in url else url.replace("gist.github.com", "gist.githubusercontent.com") + "/raw"
    headers = {"Authorization": f"token {token}"} if token else None
    async with aiohttp.ClientSession() as session:
        async with session.get(raw_url, headers=headers, timeout=15) as resp:
            resp.raise_for_status()
            return await resp.text()


def parse_node_line(line: str) -> NodeMeta:
    name, _type, host, port_str, uuid, *rest = line.split(",")
    params: Dict[str, str] = {}
    for p in rest:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip()] = v.replace('"', '').strip()
    region = name.split("-")[0]
    return NodeMeta(
        name=name.strip(),
        host=host.strip(),
        port=int(port_str),
        uuid=uuid.replace('"', '').strip(),
        params=params,
        region=region,
    )


BASE_URL = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/refs/heads/master/rule/Clash"
REGION_ALIAS = {
    "HK": "香港节点",
    "JP": "日本节点",
    "SG": "新加坡节点",
    "US": "美国节点",
    "UK": "英国节点",
    "GB": "英国节点",
    "KR": "韩国节点",
    "TW": "台湾节点",
    "CN": "中国节点",
    "DE": "德国节点",
    "FR": "法国节点",
    "CA": "加拿大节点",
    "AU": "澳大利亚节点",
}


def build_yaml(nodes: List[NodeMeta], apps: List[str]) -> str:
    proxies = [
        {
            "name": n.name,
            "type": "vless",
            "server": n.host,
            "port": n.port,
            "uuid": n.uuid,
            "network": n.params.get("transport", "tcp"),
            "flow": n.params.get("flow"),
            "tls": n.params.get("over-tls") == "true",
            "skip-cert-verify": n.params.get("skip-cert-verify", "true") != "false",
            "sni": n.params.get("sni"),
            "udp": n.params.get("udp") == "true",
        }
        for n in nodes
    ]

    region_proxy_map: Dict[str, List[str]] = {}
    for n in nodes:
        name = REGION_ALIAS.get(n.region, n.region)
        region_proxy_map.setdefault(name, []).append(n.name)
    region_names = list(region_proxy_map.keys())

    auto_group = "Automatic"
    groups = [
        {
            "name": auto_group,
            "type": "url-test",
            "url": "https://cp.cloudflare.com/generate_204",
            "interval": 300,
            "proxies": [p["name"] for p in proxies],
        },
        *[
            {"name": r, "type": "select", "proxies": region_proxy_map[r]}
            for r in region_names
        ],
        {"name": "DIRECT", "type": "direct"},
        {"name": "REJECT", "type": "reject"},
        *[
            {
                "name": app,
                "type": "select",
                "proxies": [auto_group, *region_names, "DIRECT", "REJECT"],
            }
            for app in apps
        ],
    ]

    rule_providers = {}
    for app in apps:
        folder = alias.get(app, app)
        rule_providers[app] = {
            "type": "http",
            "behavior": "domain",
            "url": f"{BASE_URL}/{folder}/{folder}.yaml",
            "path": f"./rules/{folder}.yaml",
            "interval": 86400,
        }

    rule_lines = [f"RULE-SET,{app},{app}" for app in apps]
    rule_lines.append(f"MATCH,{auto_group}")

    config = {
        "port": 7890,
        "socksPort": 7891,
        "allow-lan": True,
        "mode": "rule",
        "proxies": proxies,
        "proxy-groups": groups,
        "rule-providers": rule_providers,
        "rules": rule_lines,
    }
    return yaml.safe_dump(config, sort_keys=False, allow_unicode=True)


def load_groups(path: str = "groups.json") -> Dict[str, List[str]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
            result = {k: [str(x) for x in v] for k, v in obj.items() if isinstance(v, list)}
            return result
    except Exception:
        return {}


def save_groups(groups: Dict[str, List[str]], path: str = "groups.json") -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(groups, f, ensure_ascii=False, indent=2)


async def fetch_rule_categories(token: str | None = None) -> List[str]:
    url = "https://api.github.com/repos/blackmatrix7/ios_rule_script/contents/rule/Clash?ref=master"
    headers = {"Authorization": f"token {token}"} if token else None
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers, timeout=15) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return sorted([item["name"] for item in data if item.get("type") == "dir"])


@dataclass
class Session:
    gist: str | None = None
    apps: Set[str] = field(default_factory=set)
    last_active: float = field(default_factory=lambda: asyncio.get_event_loop().time())
    page: int = 0
    filter: str | None = None
    awaiting_search: bool = False
    group_page: int = 0
    prefix_filter: bool = False


@dataclass
class EditSession:
    group: str
    apps: Set[str]
    page: int = 0
    filter: str | None = None
    awaiting_search: bool = False


class BotApp:
    def __init__(self):
        if not BOT_TOKEN:
            raise RuntimeError("BOT_TOKEN is not set")
        self.app = ApplicationBuilder().token(BOT_TOKEN).build()
        self.sessions: Dict[int, Session] = {}
        self.edit_sessions: Dict[int, EditSession] = {}
        self.app_list: List[str] = []
        self.groups: Dict[str, List[str]] = {}

        self.app.add_handler(CommandHandler("start", self.start))
        self.app.add_handler(CommandHandler("help", self.help))
        self.app.add_handler(CommandHandler("groups", self.cmd_groups))
        self.app.add_handler(CommandHandler("newgroup", self.new_group))
        self.app.add_handler(CommandHandler("addrules", self.add_rules))
        self.app.add_handler(CommandHandler("removerules", self.remove_rules))
        self.app.add_handler(CommandHandler("editgroup", self.edit_group))
        self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.on_text))
        self.app.add_handler(CallbackQueryHandler(self.on_action))

    async def load_initial(self):
        try:
            self.app_list = [
                alias.get(name, name)
                for name in await fetch_rule_categories(GITHUB_TOKEN)
            ]
        except Exception as e:
            print("Failed to fetch categories", e)
            self.app_list = []
        self.groups = load_groups()

    def get_session(self, user_id: int) -> Session:
        s = self.sessions.get(user_id)
        if not s:
            s = Session()
            self.sessions[user_id] = s
        s.last_active = asyncio.get_event_loop().time()
        return s

    def build_keyboard(self, session: Session) -> InlineKeyboardMarkup:
        if session.filter:
            flt = session.filter.lower()
            if session.prefix_filter:
                items = [a for a in self.app_list if a.lower().startswith(flt)]
            else:
                items = [a for a in self.app_list if flt in a.lower()]
        else:
            items = self.app_list
        start = session.page * PAGE_SIZE
        page_apps = items[start:start + PAGE_SIZE]
        rows = [
            [InlineKeyboardButton(
                ("✅" if app in session.apps else "⬜️") + " " + app,
                callback_data="TOGGLE_" + app,
            )]
            for app in page_apps
        ]
        nav = []
        if session.page > 0:
            nav.append(InlineKeyboardButton("⬅️ 上一页", callback_data="PREV"))
        if start + PAGE_SIZE < len(items):
            nav.append(InlineKeyboardButton("下一页 ➡️", callback_data="NEXT"))
        if nav:
            rows.append(nav)
        group_names = list(self.groups.keys())
        if group_names:
            gstart = session.group_page * GROUP_PAGE_SIZE
            gslice = group_names[gstart:gstart + GROUP_PAGE_SIZE]
            rows.append([
                InlineKeyboardButton(f"📂 {g}", callback_data="TOGGLE_GROUP_" + g)
                for g in gslice
            ])
            if len(group_names) > GROUP_PAGE_SIZE:
                gnav = []
                if session.group_page > 0:
                    gnav.append(InlineKeyboardButton("⬅️ 上一页", callback_data="GPREV"))
                if gstart + GROUP_PAGE_SIZE < len(group_names):
                    gnav.append(InlineKeyboardButton("下一页 ➡️", callback_data="GNEXT"))
                if gnav:
                    rows.append(gnav)
        letters = []
        r = []
        for i, ch in enumerate(ALPHABET):
            r.append(InlineKeyboardButton(ch, callback_data="LETTER_" + ch))
            if (i + 1) % 7 == 0 or i == len(ALPHABET) - 1:
                letters.append(r)
                r = []
        rows.extend(letters)
        sr = [InlineKeyboardButton("🔍 搜索", callback_data="SEARCH")]
        if session.filter:
            sr.append(InlineKeyboardButton("❌ 清除", callback_data="CLEAR_FILTER"))
        rows.append(sr)
        rows.append([InlineKeyboardButton("✅ 生成配置", callback_data="GENERATE")])
        return InlineKeyboardMarkup(rows)

    def build_edit_keyboard(self, session: EditSession) -> InlineKeyboardMarkup:
        if session.filter:
            flt = session.filter.lower()
            items = [a for a in self.app_list if flt in a.lower()]
        else:
            items = self.app_list
        start = session.page * PAGE_SIZE
        page_apps = items[start:start + PAGE_SIZE]
        rows = [
            [InlineKeyboardButton(
                ("✅" if app in session.apps else "⬜️") + " " + app,
                callback_data="EG_TOGGLE_" + app,
            )]
            for app in page_apps
        ]
        nav = []
        if session.page > 0:
            nav.append(InlineKeyboardButton("⬅️ 上一页", callback_data="EG_PREV"))
        if start + PAGE_SIZE < len(items):
            nav.append(InlineKeyboardButton("下一页 ➡️", callback_data="EG_NEXT"))
        if nav:
            rows.append(nav)
        sr = [InlineKeyboardButton("🔍 搜索", callback_data="EG_SEARCH")]
        if session.filter:
            sr.append(InlineKeyboardButton("❌ 清除", callback_data="EG_CLEAR_FILTER"))
        rows.append(sr)
        rows.append([
            InlineKeyboardButton("✅ 保存", callback_data="EG_SAVE"),
            InlineKeyboardButton("取消", callback_data="EG_CANCEL"),
        ])
        return InlineKeyboardMarkup(rows)

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "发送包含节点信息的 Gist 原始链接，然后点击按钮选择需要的分流规则。",
            disable_web_page_preview=True,
        )

    async def help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        await update.message.reply_text(
            "\n".join(
                [
                    "可用指令:",
                    "/groups - 查看所有分组",
                    "/newgroup <名称> [规则...] - 创建分组",
                    "/addrules <名称> <规则...> - 向分组添加规则",
                    "/removerules <名称> <规则...> - 从分组移除规则",
                    "/editgroup <名称> - 使用按钮编辑分组",
                ]
            )
        )

    async def cmd_groups(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not self.groups:
            await update.message.reply_text("当前没有自定义分组")
            return
        lines = [f"{g}: {', '.join(a) if a else '无规则'}" for g, a in self.groups.items()]
        await update.message.reply_text("\n".join(lines))

    async def new_group(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        args = update.message.text.split()
        if len(args) < 2:
            await update.message.reply_text("用法: /newgroup 组名 [规则...]")
            return
        name = args[1]
        rules = args[2:]
        if name in self.groups:
            await update.message.reply_text("该分组已存在")
            return
        self.groups[name] = rules
        save_groups(self.groups)
        await update.message.reply_text(f"已创建分组 {name}")

    async def add_rules(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        args = update.message.text.split()
        if len(args) < 3:
            await update.message.reply_text("用法: /addrules 组名 规则...")
            return
        name = args[1]
        rules = args[2:]
        if name not in self.groups:
            self.groups[name] = []
        for r in rules:
            if r not in self.groups[name]:
                self.groups[name].append(r)
        save_groups(self.groups)
        await update.message.reply_text(f"已更新分组 {name}")

    async def remove_rules(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        args = update.message.text.split()
        if len(args) < 3:
            await update.message.reply_text("用法: /removerules 组名 规则...")
            return
        name = args[1]
        rules = args[2:]
        if name not in self.groups:
            await update.message.reply_text("分组不存在")
            return
        self.groups[name] = [r for r in self.groups[name] if r not in rules]
        save_groups(self.groups)
        await update.message.reply_text(f"已更新分组 {name}")

    async def edit_group(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        args = update.message.text.split()
        if len(args) < 2:
            await update.message.reply_text("用法: /editgroup 组名")
            return
        name = args[1]
        rules = self.groups.get(name, [])
        s = EditSession(group=name, apps=set(rules))
        self.edit_sessions[update.effective_user.id] = s
        await update.message.reply_text(
            f"正在编辑分组 {name}，勾选要包含的规则：",
            reply_markup=self.build_edit_keyboard(s),
        )

    async def on_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        text = update.message.text.strip()
        uid = update.effective_user.id
        if uid in self.edit_sessions and self.edit_sessions[uid].awaiting_search:
            s = self.edit_sessions[uid]
            s.filter = text
            s.page = 0
            s.awaiting_search = False
            await update.message.reply_text(
                f"已根据关键词“{text}”过滤：",
                reply_markup=self.build_edit_keyboard(s),
            )
            return
        session = self.get_session(uid)
        if session.awaiting_search:
            session.filter = text
            session.page = 0
            session.group_page = 0
            session.prefix_filter = False
            session.awaiting_search = False
            await update.message.reply_text(
                f"已根据关键词“{text}”过滤：",
                reply_markup=self.build_keyboard(session),
            )
            return
        if "gist.github" not in text and "raw.githubusercontent" not in text:
            await update.message.reply_text("这看起来不是 Gist 链接，请重新发送。")
            return
        session.gist = text
        session.apps.clear()
        session.page = 0
        session.filter = None
        session.group_page = 0
        session.prefix_filter = False
        await update.message.reply_text(
            "好的！请选择要启用的分流规则（可多选）：",
            reply_markup=self.build_keyboard(session),
        )

    async def on_action(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        query = update.callback_query
        await query.answer()
        data = query.data
        uid = update.effective_user.id
        if data.startswith("TOGGLE_"):
            session = self.get_session(uid)
            if data.startswith("TOGGLE_GROUP_"):
                group = data[len("TOGGLE_GROUP_") :]
                apps = self.groups.get(group, [])
                all_selected = all(a in session.apps for a in apps)
                for a in apps:
                    if all_selected and a in session.apps:
                        session.apps.remove(a)
                    else:
                        session.apps.add(a)
            else:
                app = data[len("TOGGLE_") :]
                if app in session.apps:
                    session.apps.remove(app)
                else:
                    session.apps.add(app)
            await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data.startswith("EG_TOGGLE_"):
            es = self.edit_sessions.get(uid)
            if es:
                app = data[len("EG_TOGGLE_") :]
                if app in es.apps:
                    es.apps.remove(app)
                else:
                    es.apps.add(app)
                await query.edit_message_reply_markup(self.build_edit_keyboard(es))
        elif data == "EG_NEXT":
            es = self.edit_sessions.get(uid)
            if es and (es.page + 1) * PAGE_SIZE < len(self.app_list):
                es.page += 1
                await query.edit_message_reply_markup(self.build_edit_keyboard(es))
        elif data == "EG_PREV":
            es = self.edit_sessions.get(uid)
            if es and es.page > 0:
                es.page -= 1
                await query.edit_message_reply_markup(self.build_edit_keyboard(es))
        elif data == "EG_SEARCH":
            es = self.edit_sessions.get(uid)
            if es:
                es.awaiting_search = True
                await query.answer("请输入关键词发送给我")
        elif data == "EG_CLEAR_FILTER":
            es = self.edit_sessions.get(uid)
            if es and es.filter:
                es.filter = None
                es.page = 0
                await query.edit_message_reply_markup(self.build_edit_keyboard(es))
        elif data == "EG_SAVE":
            es = self.edit_sessions.get(uid)
            if es:
                self.groups[es.group] = list(es.apps)
                save_groups(self.groups)
                del self.edit_sessions[uid]
                await query.edit_message_reply_markup(None)
                await context.bot.send_message(uid, f"分组 {es.group} 已保存")
        elif data == "EG_CANCEL":
            if uid in self.edit_sessions:
                g = self.edit_sessions[uid].group
                del self.edit_sessions[uid]
                await query.edit_message_reply_markup(None)
                await context.bot.send_message(uid, f"已取消编辑 {g}")
        elif data == "NEXT":
            session = self.get_session(uid)
            if (session.page + 1) * PAGE_SIZE < len(self.app_list):
                session.page += 1
                await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data == "PREV":
            session = self.get_session(uid)
            if session.page > 0:
                session.page -= 1
                await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data == "GNEXT":
            session = self.get_session(uid)
            if (session.group_page + 1) * GROUP_PAGE_SIZE < len(self.groups):
                session.group_page += 1
                await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data == "GPREV":
            session = self.get_session(uid)
            if session.group_page > 0:
                session.group_page -= 1
                await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data.startswith("LETTER_"):
            letter = data[len("LETTER_") :]
            session = self.get_session(uid)
            session.filter = letter
            session.prefix_filter = True
            session.page = 0
            session.group_page = 0
            await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data == "SEARCH":
            session = self.get_session(uid)
            session.awaiting_search = True
            await query.answer("请输入关键词发送给我")
        elif data == "CLEAR_FILTER":
            session = self.get_session(uid)
            if session.filter:
                session.filter = None
                session.page = 0
                session.group_page = 0
                session.prefix_filter = False
                await query.edit_message_reply_markup(self.build_keyboard(session))
        elif data == "GENERATE":
            session = self.get_session(uid)
            if not session.gist:
                await query.answer("请先发送 Gist 链接")
                return
            if not session.apps:
                await query.answer("至少选择一个规则")
                return
            await query.answer("开始生成，请稍候…")
            try:
                raw = await fetch_gist_raw(session.gist, GITHUB_TOKEN)
            except Exception as e:
                await context.bot.send_message(uid, f"获取Gist内容失败: {e}")
                return
            nodes = []
            for line in raw.splitlines():
                if not line:
                    continue
                try:
                    node = parse_node_line(line)
                except Exception as e:
                    await context.bot.send_message(uid, f"解析节点失败: {e}")
                    return
                if any(k in node.name for k in ["剩余流量", "距离下次重置剩余", "套餐到期"]):
                    continue
                nodes.append(node)
            yaml_str = build_yaml(nodes, list(session.apps))
            await context.bot.send_document(
                uid,
                InputFile.from_bytes(yaml_str.encode("utf-8"), filename="clash.yaml"),
                caption="配置生成成功 🎉",
            )

    async def run(self):
        await self.load_initial()
        await self.app.initialize()
        await self.app.start()
        print("🤖 Telegram Bot 已启动")
        await self.app.updater.start_polling()
        await self.app.updater.idle()


if __name__ == "__main__":
    bot_app = BotApp()
    asyncio.run(bot_app.run())
