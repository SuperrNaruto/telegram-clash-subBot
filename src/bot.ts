import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { fetchGistRaw, parseNodeLine } from "./gist.js";
import { buildYaml } from "./yaml.js";
import { alias } from "./alias.js";
import { fetchRuleCategories } from "./rules.js";
import { loadGroups, saveGroups } from "./groups.js";

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN 未设置");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// SESSION_TTL 控制会话在多少秒无操作后失效，默认 1 小时
const SESSION_TTL = Number(process.env.SESSION_TTL) || 3600;
const PAGE_SIZE = 10;
const GROUP_PAGE_SIZE = 5;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const bot = new Telegraf(BOT_TOKEN);

/** 会话状态 */
interface Session {
  gist?: string;
  apps: Set<string>;
  lastActive: number;
  page: number;
  filter?: string;
  awaitingSearch?: boolean;
  groupPage: number;
  prefixFilter?: boolean;
}
const sessions = new Map<number, Session>();

/** 分组编辑会话 */
interface EditSession {
  group: string;
  apps: Set<string>;
  page: number;
  filter?: string;
  awaitingSearch?: boolean;
}
const editSessions = new Map<number, EditSession>();

let APP_LIST: string[] = [];
let GROUPS: Record<string, string[]> = {};

async function loadCategories() {
  try {
    const names = await fetchRuleCategories(GITHUB_TOKEN);
    APP_LIST = names.map(name => {
      for (const [k, v] of Object.entries(alias)) {
        if (v === name) return k;
      }
      return name;
    });
    console.log("规则列表已加载", APP_LIST.length);
  } catch (e) {
    console.error("获取规则列表失败", e);
    APP_LIST = [];
  }
}

/* ---------- Helpers ---------- */
function getSession(id: number): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { apps: new Set(), lastActive: Date.now(), page: 0, groupPage: 0, prefixFilter: false };
    sessions.set(id, s);
  } else {
    s.lastActive = Date.now();
  }
  return s;
}

function buildKeyboard(session: Session) {
  const list = session.filter
    ? APP_LIST.filter(a => {
        const l = a.toLowerCase();
        const f = session.filter!.toLowerCase();
        return session.prefixFilter ? l.startsWith(f) : l.includes(f);
      })
    : APP_LIST;
  const start = session.page * PAGE_SIZE;
  const pageApps = list.slice(start, start + PAGE_SIZE);
  const rows = pageApps.map(app =>
    Markup.button.callback(
      `${session.apps.has(app) ? "✅" : "⬜️"} ${app}`,
      `TOGGLE_${app}`
    )
  );
  const arranged: any[][] = [];
  for (let i = 0; i < rows.length; i += 2) arranged.push(rows.slice(i, i + 2));
  const nav: any[] = [];
  if (session.page > 0)
    nav.push(Markup.button.callback("⬅️ 上一页", "PREV"));
  if (start + PAGE_SIZE < list.length)
    nav.push(Markup.button.callback("下一页 ➡️", "NEXT"));
  arranged.push(nav);
  const groupNames = Object.keys(GROUPS);
  if (groupNames.length) {
    const gStart = session.groupPage * GROUP_PAGE_SIZE;
    const gSlice = groupNames.slice(gStart, gStart + GROUP_PAGE_SIZE);
    const gRow = gSlice.map(g =>
      Markup.button.callback(`📂 ${g}`, `TOGGLE_GROUP_${g}`)
    );
    arranged.push(gRow);
    if (groupNames.length > GROUP_PAGE_SIZE) {
      const gNav: any[] = [];
      if (session.groupPage > 0)
        gNav.push(Markup.button.callback("⬅️ 上一页", "GPREV"));
      if (gStart + GROUP_PAGE_SIZE < groupNames.length)
        gNav.push(Markup.button.callback("下一页 ➡️", "GNEXT"));
      arranged.push(gNav);
    }
  }
  const letterRows: any[][] = [];
  let row: any[] = [];
  for (let i = 0; i < ALPHABET.length; i++) {
    row.push(Markup.button.callback(ALPHABET[i], `LETTER_${ALPHABET[i]}`));
    if ((i + 1) % 7 === 0 || i === ALPHABET.length - 1) {
      letterRows.push(row);
      row = [];
    }
  }
  arranged.push(...letterRows);
  const searchRow: any[] = [Markup.button.callback("🔍 搜索", "SEARCH")];
  if (session.filter) searchRow.push(Markup.button.callback("❌ 清除", "CLEAR_FILTER"));
  arranged.push(searchRow);
  arranged.push([Markup.button.callback("✅ 生成配置", "GENERATE")]);
  return Markup.inlineKeyboard(arranged);
}

function buildEditKeyboard(session: EditSession) {
  const list = session.filter
    ? APP_LIST.filter(a => a.toLowerCase().includes(session.filter!.toLowerCase()))
    : APP_LIST;
  const start = session.page * PAGE_SIZE;
  const pageApps = list.slice(start, start + PAGE_SIZE);
  const rows = pageApps.map(app =>
    Markup.button.callback(
      `${session.apps.has(app) ? "✅" : "⬜️"} ${app}`,
      `EG_TOGGLE_${app}`
    )
  );
  const arranged: any[][] = [];
  for (let i = 0; i < rows.length; i += 2) arranged.push(rows.slice(i, i + 2));
  const nav: any[] = [];
  if (session.page > 0) nav.push(Markup.button.callback("⬅️ 上一页", "EG_PREV"));
  if (start + PAGE_SIZE < list.length)
    nav.push(Markup.button.callback("下一页 ➡️", "EG_NEXT"));
  arranged.push(nav);
  const searchRow: any[] = [Markup.button.callback("🔍 搜索", "EG_SEARCH")];
  if (session.filter) searchRow.push(Markup.button.callback("❌ 清除", "EG_CLEAR_FILTER"));
  arranged.push(searchRow);
  arranged.push([
    Markup.button.callback("✅ 保存", "EG_SAVE"),
    Markup.button.callback("取消", "EG_CANCEL")
  ]);
  return Markup.inlineKeyboard(arranged);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_TTL * 1000) {
      sessions.delete(id);
    }
  }
}

async function safeEditReplyMarkup(ctx: any, markup: any) {
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: markup });
  } catch (e: any) {
    if (!e?.description?.includes("message is not modified")) {
      throw e;
    }
  }
}
setInterval(cleanupSessions, 60 * 60 * 1000);

/* ---------- Bot Logic ---------- */
bot.start(ctx =>
  ctx.reply(
    "发送包含节点信息的 Gist 原始链接（以 gist.githubusercontent.com 开头），然后点击按钮选择需要的分流规则，可通过上下页按钮浏览更多分类。",
    { disable_web_page_preview: true } as any
  )
);

bot.help(ctx => {
  ctx.reply(
    [
      "可用指令:",
      "/groups - 查看所有分组",
      "/newgroup <名称> [规则...] - 创建分组",
      "/addrules <名称> <规则...> - 向分组添加规则",
      "/removerules <名称> <规则...> - 从分组移除规则",
      "/editgroup <名称> - 使用按钮编辑分组"
    ].join("\n"),
    Markup.keyboard([
      ["/groups", "/newgroup"],
      ["/addrules", "/removerules"],
      ["/editgroup"]
    ])
      .oneTime()
      .resize()
  );
});

bot.command("groups", ctx => {
  if (Object.keys(GROUPS).length === 0) return ctx.reply("当前没有自定义分组");
  const lines = Object.entries(GROUPS).map(
    ([g, apps]) => `${g}: ${apps.join(", ") || "无规则"}`
  );
  ctx.reply(lines.join("\n"));
});

bot.command("newgroup", async ctx => {
  const [, name, ...rules] = ctx.message.text.trim().split(/\s+/);
  if (!name) return ctx.reply("用法: /newgroup 组名 [规则...]");
  if (GROUPS[name]) return ctx.reply("该分组已存在");
  GROUPS[name] = rules;
  await saveGroups(GROUPS);
  ctx.reply(`已创建分组 ${name}`);
});

bot.command("addrules", async ctx => {
  const [, name, ...rules] = ctx.message.text.trim().split(/\s+/);
  if (!name || rules.length === 0)
    return ctx.reply("用法: /addrules 组名 规则...");
  if (!GROUPS[name]) GROUPS[name] = [];
  for (const r of rules) if (!GROUPS[name].includes(r)) GROUPS[name].push(r);
  await saveGroups(GROUPS);
  ctx.reply(`已更新分组 ${name}`);
});

bot.command("removerules", async ctx => {
  const [, name, ...rules] = ctx.message.text.trim().split(/\s+/);
  if (!name || rules.length === 0)
    return ctx.reply("用法: /removerules 组名 规则...");
  if (!GROUPS[name]) return ctx.reply("分组不存在");
  GROUPS[name] = GROUPS[name].filter(r => !rules.includes(r));
  await saveGroups(GROUPS);
  ctx.reply(`已更新分组 ${name}`);
});

bot.command("editgroup", ctx => {
  const [, name] = ctx.message.text.trim().split(/\s+/);
  if (!name) return ctx.reply("用法: /editgroup 组名");
  const rules = GROUPS[name] || [];
  const s: EditSession = { group: name, apps: new Set(rules), page: 0 };
  editSessions.set(ctx.from.id, s);
  ctx.reply(
    `正在编辑分组 ${name}，勾选要包含的规则：`,
    buildEditKeyboard(s)
  );
});

bot.on("text", async ctx => {
  const text = ctx.message.text.trim();
  const editSession = editSessions.get(ctx.from.id);
  if (editSession?.awaitingSearch) {
    editSession.filter = text;
    editSession.page = 0;
    editSession.awaitingSearch = false;
    return ctx.reply(`已根据关键词“${text}”过滤：`, buildEditKeyboard(editSession));
  }
  const session = getSession(ctx.from.id);
  if (session.awaitingSearch) {
    session.filter = text;
    session.page = 0;
    session.groupPage = 0;
    session.prefixFilter = false;
    session.awaitingSearch = false;
    return ctx.reply(`已根据关键词“${text}”过滤：`, buildKeyboard(session));
  }
  if (!text.includes("gist.github") && !text.includes("raw.githubusercontent")) {
    return ctx.reply("这看起来不是 Gist 链接，请重新发送。");
  }
  session.gist = text;
  session.apps.clear();
  session.page = 0;
  session.filter = undefined;
  session.groupPage = 0;
  session.prefixFilter = false;
  await ctx.reply(
    "好的！请选择要启用的分流规则（可多选）：",
    buildKeyboard(session)
  );
});

bot.action(/^TOGGLE_/, async ctx => {
  const callbackQuery = ctx.callbackQuery as { data: string };
  const data = callbackQuery.data;
  if (!data) return ctx.answerCbQuery("无效的回调数据");

  const session = getSession(ctx.from!.id);

  if (data.startsWith("TOGGLE_GROUP_")) {
    const group = data.replace("TOGGLE_GROUP_", "");
    const apps = GROUPS[group] || [];
    const allSelected = apps.every(a => session.apps.has(a));
    for (const app of apps) {
      if (allSelected) session.apps.delete(app);
      else session.apps.add(app);
    }
  } else {
    const app = data.replace("TOGGLE_", "");
    if (session.apps.has(app)) session.apps.delete(app);
    else session.apps.add(app);
  }

  const newMarkup = buildKeyboard(session).reply_markup.inline_keyboard;
  const currentMarkup =
    (ctx.callbackQuery as any).message?.reply_markup?.inline_keyboard;
  if (JSON.stringify(newMarkup) !== JSON.stringify(currentMarkup)) {
    await safeEditReplyMarkup(ctx, newMarkup);
  }
  await ctx.answerCbQuery();
});

bot.action(/^EG_TOGGLE_/, async ctx => {
  const data = (ctx.callbackQuery as { data: string }).data;
  const session = editSessions.get(ctx.from!.id);
  if (!session) return ctx.answerCbQuery();
  const app = data.replace("EG_TOGGLE_", "");
  if (session.apps.has(app)) session.apps.delete(app);
  else session.apps.add(app);
  await safeEditReplyMarkup(
    ctx,
    buildEditKeyboard(session).reply_markup.inline_keyboard
  );
  await ctx.answerCbQuery();
});

bot.action("EG_NEXT", async ctx => {
  const session = editSessions.get(ctx.from!.id);
  if (session && (session.page + 1) * PAGE_SIZE < APP_LIST.length) {
    session.page++;
    await safeEditReplyMarkup(
      ctx,
      buildEditKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("EG_PREV", async ctx => {
  const session = editSessions.get(ctx.from!.id);
  if (session && session.page > 0) {
    session.page--;
    await safeEditReplyMarkup(
      ctx,
      buildEditKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("EG_SEARCH", async ctx => {
  const session = editSessions.get(ctx.from!.id);
  if (session) {
    session.awaitingSearch = true;
  }
  await ctx.answerCbQuery("请输入关键词发送给我");
});

bot.action("EG_CLEAR_FILTER", async ctx => {
  const session = editSessions.get(ctx.from!.id);
  if (session && session.filter) {
    session.filter = undefined;
    session.page = 0;
    await safeEditReplyMarkup(
      ctx,
      buildEditKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("EG_SAVE", async ctx => {
  const session = editSessions.get(ctx.from!.id);
  if (!session) return ctx.answerCbQuery();
  GROUPS[session.group] = Array.from(session.apps);
  await saveGroups(GROUPS);
  editSessions.delete(ctx.from!.id);
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.answerCbQuery("已保存");
  await ctx.reply(`分组 ${session.group} 已保存`);
});

bot.action("EG_CANCEL", async ctx => {
  if (editSessions.has(ctx.from!.id)) {
    const s = editSessions.get(ctx.from!.id)!;
    editSessions.delete(ctx.from!.id);
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(`已取消编辑 ${s.group}`);
  }
  await ctx.answerCbQuery();
});

bot.action("NEXT", async ctx => {
  const session = getSession(ctx.from!.id);
  if ((session.page + 1) * PAGE_SIZE < APP_LIST.length) {
    session.page++;
    await safeEditReplyMarkup(
      ctx,
      buildKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("PREV", async ctx => {
  const session = getSession(ctx.from!.id);
  if (session.page > 0) {
    session.page--;
    await safeEditReplyMarkup(
      ctx,
      buildKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("GNEXT", async ctx => {
  const session = getSession(ctx.from!.id);
  const total = Object.keys(GROUPS).length;
  if ((session.groupPage + 1) * GROUP_PAGE_SIZE < total) {
    session.groupPage++;
    await safeEditReplyMarkup(
      ctx,
      buildKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("GPREV", async ctx => {
  const session = getSession(ctx.from!.id);
  if (session.groupPage > 0) {
    session.groupPage--;
    await safeEditReplyMarkup(
      ctx,
      buildKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action(/^LETTER_[A-Z]$/, async ctx => {
  const letter = (ctx.callbackQuery as { data: string }).data.replace("LETTER_", "");
  const session = getSession(ctx.from!.id);
  session.filter = letter;
  session.prefixFilter = true;
  session.page = 0;
  session.groupPage = 0;
  await safeEditReplyMarkup(
    ctx,
    buildKeyboard(session).reply_markup.inline_keyboard
  );
  await ctx.answerCbQuery();
});

bot.action("SEARCH", async ctx => {
  const session = getSession(ctx.from!.id);
  session.awaitingSearch = true;
  await ctx.answerCbQuery("请输入关键词发送给我");
});

bot.action("CLEAR_FILTER", async ctx => {
  const session = getSession(ctx.from!.id);
  if (session.filter) {
    session.filter = undefined;
    session.page = 0;
    session.groupPage = 0;
    session.prefixFilter = false;
    await safeEditReplyMarkup(
      ctx,
      buildKeyboard(session).reply_markup.inline_keyboard
    );
  }
  await ctx.answerCbQuery();
});

bot.action("GENERATE", async ctx => {
  const session = getSession(ctx.from!.id);
  if (!session.gist) return ctx.answerCbQuery("请先发送 Gist 链接");
  if (session.apps.size === 0)
    return ctx.answerCbQuery("至少选择一个规则");

  await ctx.answerCbQuery("开始生成，请稍候…");
  try {
    let raw;
    try {
      raw = await fetchGistRaw(session.gist, GITHUB_TOKEN);
    } catch (error: any) {
      return ctx.reply(`获取Gist内容失败: ${error.message}`);
    }

    const nodes = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try {
          return parseNodeLine(line);
        } catch (e) {
          console.error(`解析节点失败: ${line}`, e);
          throw new Error(`解析节点失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .filter(
        n =>
          !["剩余流量", "距离下次重置剩余", "套餐到期"].some(keyword =>
            n.name.includes(keyword)
          )
      );

    const yamlStr = buildYaml(nodes, Array.from(session.apps));

    await ctx.replyWithDocument(
      { source: Buffer.from(yamlStr, "utf-8"), filename: "clash.yaml" },
      { caption: "配置生成成功 🎉" }
    );
  } catch (e: any) {
    console.error(e);
    await ctx.reply("生成失败：" + (e?.message ?? e));
  }
});

async function start() {
  await loadCategories();
  GROUPS = await loadGroups();
  for (const app of APP_LIST) {
    if (alias[app] && !alias[app].includes(app) && !app.includes(alias[app])) {
      console.warn(`警告: APP_LIST 中的 "${app}" 与 alias 中的 "${alias[app]}" 名称不一致`);
    }
  }
  console.log("正在启动机器人，App列表:", APP_LIST.join(", "));
  if (Object.keys(GROUPS).length)
    console.log("自定义分组:", Object.keys(GROUPS).join(", "));
  await bot.launch();
  console.log("🤖 Telegram Bot 已启动");
}

start();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
