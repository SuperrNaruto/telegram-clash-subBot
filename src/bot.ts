import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { fetchGistRaw, parseNodeLine } from "./gist.js";
import { buildYaml } from "./yaml.js";
import { alias } from "./alias.js";
import { fetchRuleCategories } from "./rules.js";

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN 未设置");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// SESSION_TTL 控制会话在多少秒无操作后失效，默认 1 小时
const SESSION_TTL = Number(process.env.SESSION_TTL) || 3600;
const PAGE_SIZE = 10;

const bot = new Telegraf(BOT_TOKEN);

/** 会话状态 */
interface Session {
  gist?: string;
  apps: Set<string>;
  lastActive: number;
  page: number;
}
const sessions = new Map<number, Session>();

let APP_LIST: string[] = [];

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
    s = { apps: new Set(), lastActive: Date.now(), page: 0 };
    sessions.set(id, s);
  } else {
    s.lastActive = Date.now();
  }
  return s;
}

function buildKeyboard(session: Session) {
  const start = session.page * PAGE_SIZE;
  const pageApps = APP_LIST.slice(start, start + PAGE_SIZE);
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
  if (start + PAGE_SIZE < APP_LIST.length)
    nav.push(Markup.button.callback("下一页 ➡️", "NEXT"));
  arranged.push(nav);
  arranged.push([Markup.button.callback("✅ 生成配置", "GENERATE")]);
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
setInterval(cleanupSessions, 60 * 60 * 1000);

/* ---------- Bot Logic ---------- */
bot.start(ctx =>
  ctx.reply(
    "发送包含节点信息的 Gist 原始链接（以 gist.githubusercontent.com 开头），然后点击按钮选择需要的分流规则，可通过上下页按钮浏览更多分类。",
    { disable_web_page_preview: true } as any
  )
);

bot.on("text", async ctx => {
  const url = ctx.message.text.trim();
  if (!url.includes("gist.github") && !url.includes("raw.githubusercontent")) {
    return ctx.reply("这看起来不是 Gist 链接，请重新发送。");
  }
  const session = getSession(ctx.from.id);
  session.gist = url;
  session.apps.clear();
  session.page = 0;
  await ctx.reply(
    "好的！请选择要启用的分流规则（可多选）：",
    buildKeyboard(session)
  );
});

bot.action(/TOGGLE_/, async ctx => {
  const callbackQuery = ctx.callbackQuery as { data: string };
  const data = callbackQuery.data;
  if (!data) return ctx.answerCbQuery("无效的回调数据");
  const app = data.replace("TOGGLE_", "");

  const session = getSession(ctx.from!.id);
  if (session.apps.has(app)) session.apps.delete(app);
  else session.apps.add(app);

  await ctx.editMessageReplyMarkup({
    inline_keyboard: buildKeyboard(session).reply_markup.inline_keyboard
  });
  await ctx.answerCbQuery();
});

bot.action("NEXT", async ctx => {
  const session = getSession(ctx.from!.id);
  if ((session.page + 1) * PAGE_SIZE < APP_LIST.length) session.page++;
  await ctx.editMessageReplyMarkup({
    inline_keyboard: buildKeyboard(session).reply_markup.inline_keyboard
  });
  await ctx.answerCbQuery();
});

bot.action("PREV", async ctx => {
  const session = getSession(ctx.from!.id);
  if (session.page > 0) session.page--;
  await ctx.editMessageReplyMarkup({
    inline_keyboard: buildKeyboard(session).reply_markup.inline_keyboard
  });
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
      });

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
  for (const app of APP_LIST) {
    if (alias[app] && !alias[app].includes(app) && !app.includes(alias[app])) {
      console.warn(`警告: APP_LIST 中的 "${app}" 与 alias 中的 "${alias[app]}" 名称不一致`);
    }
  }
  console.log("正在启动机器人，App列表:", APP_LIST.join(", "));
  await bot.launch();
  console.log("🤖 Telegram Bot 已启动");
}

start();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
