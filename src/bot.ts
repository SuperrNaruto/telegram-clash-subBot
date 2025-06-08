import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { fetchGistRaw, parseNodeLine } from "./gist";
import { fetchRule } from "./rules";
import { buildYaml } from "./yaml";
import { Cache } from "./cache";

const BOT_TOKEN = process.env.BOT_TOKEN!;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN 未设置");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TTL = Number(process.env.CACHE_TTL) || 600;

const bot = new Telegraf(BOT_TOKEN);
const ruleCache = new Cache<string>(TTL * 1000);

/** 会话状态 */
interface Session {
  gist?: string;
  apps: Set<string>;
}
const sessions = new Map<number, Session>();

const APP_LIST = [
  "YouTube",
  "Netflix",
  "PrimeVideo",
  "Telegram",
  "Instagram",
  "OpenAI",
  "Discord",
  "TikTok"
] as const;

/* ---------- Helpers ---------- */
function getSession(id: number): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { apps: new Set() };
    sessions.set(id, s);
  }
  return s;
}

function buildKeyboard(session: Session) {
  const rows = APP_LIST.map(app =>
    Markup.button.callback(
      `${session.apps.has(app) ? "✅" : "⬜️"} ${app}`,
      `TOGGLE_${app}`
    )
  );
  // 每行两个按钮
  const arranged: any[][] = [];
  for (let i = 0; i < rows.length; i += 2) arranged.push(rows.slice(i, i + 2));
  arranged.push([Markup.button.callback("✅ 生成配置", "GENERATE")]);
  return Markup.inlineKeyboard(arranged);
}

/* ---------- Bot Logic ---------- */
bot.start(ctx =>
  ctx.reply(
    "发送包含节点信息的 Gist 原始链接（以 raw.githubusercontent.com 开头），然后点击按钮选择需要的分流规则。",
    { disable_web_page_preview: true }
  )
);

bot.on("text", async ctx => {
  const url = ctx.message.text.trim();
  if (!url.includes("gist.github") && !url.includes("raw.githubusercontent")) {
    return ctx.reply("这看起来不是 Gist 链接，请重新发送。");
  }
  const session = getSession(ctx.from.id);
  session.gist = url;
  session.apps.clear(); // 重置
  await ctx.reply(
    "好的！请选择要启用的分流规则（可多选）：",
    buildKeyboard(session)
  );
});

bot.action(/TOGGLE_/, async ctx => {
  const app = ctx.callbackQuery.data.replace("TOGGLE_", "");
  const session = getSession(ctx.from!.id);
  if (session.apps.has(app)) session.apps.delete(app);
  else session.apps.add(app);
  await ctx.editMessageReplyMarkup(buildKeyboard(session));
  await ctx.answerCbQuery();
});

bot.action("GENERATE", async ctx => {
  const session = getSession(ctx.from!.id);
  if (!session.gist) return ctx.answerCbQuery("请先发送 Gist 链接");
  if (session.apps.size === 0)
    return ctx.answerCbQuery("至少选择一个规则");

  await ctx.answerCbQuery("开始生成，请稍候…");
  try {
    /* 1. Gist */
    const raw = await fetchGistRaw(session.gist, GITHUB_TOKEN);
    const nodes = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseNodeLine);

    /* 2. Rules */
    const rules: Record<string, string> = {};
    for (const app of session.apps) {
      const cached = ruleCache.get(app);
      if (cached) {
        rules[app] = cached;
        continue;
      }
      const content = await fetchRule(app, GITHUB_TOKEN);
      rules[app] = content;
      ruleCache.set(app, content);
    }

    /* 3. YAML */
    const yamlStr = buildYaml(nodes, rules);

    await ctx.replyWithDocument(
      { source: Buffer.from(yamlStr, "utf-8"), filename: "clash.yaml" },
      { caption: "配置生成成功 🎉" }
    );
  } catch (e: any) {
    console.error(e);
    await ctx.reply("生成失败：" + (e?.message ?? e));
  }
});

/* ---------- Launch ---------- */
bot.launch();
console.log("🤖 Telegram Bot 已启动");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
