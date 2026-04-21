/**
 * Super TG Bot - 旗舰版 v2.0
 * 功能：身份验证 + 留言转发 + 智能导航 + 群组管理
 * 部署平台: Cloudflare Workers
 * 依赖变量: BOT_TOKEN, ADMIN_ID, BOT_KV (KV Namespace)
 */

// =========================================================================
// 🎨 1. 核心配置区域
// =========================================================================

const CONFIG = {
  // 🟢 1.1 身份验证设置
  AUTH: {
    ENABLED: true, 
    QUESTION: "🔒 *身份验证*\n\n为了防止滥用，请回答：\n\n1 + 1 = ？",
    ANSWER: "3",   
    SUCCESS_MSG: "✅ *验证通过！*\n\n欢迎使用私人助手，现在你可以使用导航或给我留言。",
  },

  // 🟢 1.2 唤醒关键词 (支持模糊匹配)
  WAKE_UP_KEYWORDS: ["/start", "/menu", "导航", "菜单", "bot", "help", "老张","机器人"],

  // 🟢 1.3 欢迎语
  WELCOME_TEXT: "👋 *Hi, 欢迎回来！*\n\n全能私人助手为您服务，请选择功能：\n(如需联系我，请点击最下方的留言按钮)",

  // 🟢 1.4 导航按钮布局
  KEYBOARD_LAYOUT: [
    [
      { text: "🏰 个人导航", url: "https://home.nas.dollei.top:16445" },
      { text: "📣 官方频道", url: "https://t.me/Jaychoud" }
    ],
    [
      { text: "🧠 Google AI", url: "https://aistudio.google.com" },
      { text: "🎬 Github", url: "https://github.com/dollei-jay" }
    ],
    [
      { text: "📊 哪吒探针 v1", url: "https://nz.dollei.dpdns.org" },
      { text: "📈 Uptime Kuma", url: "https://kuma.dollei.dpdns.org" }
    ],
    [
      { text: "⚡️ 聚合订阅", url: "https://merge.dollei.dpdns.org" }
    ],
    [
      { text: "🛡️ Proxy 检测", url: "https://check.proxyip.cmliussss.net" },
      { text: "🧦 Socks5 检测", url: "https://check.socks5.cmliussss.net" }
    ],
    [
      { text: "🎛️ Upime 面板", url: "https://bjlglhez.us-west-1.clawcloudrun.com/dashboard" },
      { text: "☁️ 优选订阅器", url: "https://sub.dollei.top" }
    ],
    [
      { text: "🆔 查 ID", callback_data: "tool_id" }, 
      { text: "🌦 查天气", callback_data: "tool_weather_guide" },
      { text: "🌍 查 IP", callback_data: "tool_ip_guide" }
    ],
    [
      { text: "📨 给主人留言", callback_data: "action_contact_owner" },
      { text: "❌ 关闭菜单", callback_data: "btn_close" }
    ]
  ]
};

// =========================================================================
// 🛑 2. 系统核心逻辑
// =========================================================================

export default {
  async fetch(request, env, ctx) {
    if (!env.BOT_TOKEN || !env.ADMIN_ID) {
      return new Response("Error: Missing BOT_TOKEN or ADMIN_ID in variables.", { status: 500 });
    }
    if (CONFIG.AUTH.ENABLED && !env.BOT_KV) {
      console.warn("⚠️ Warning: BOT_KV not bound. Auth and State features will fail.");
    }

    const url = new URL(request.url);
    if (url.pathname === "/set_webhook") return await setWebhook(request, env);

    if (request.method === "POST") {
      try {
        const update = await request.json();
        await handleUpdate(update, env);
      } catch (e) {
        console.error("Worker 内部报错:", e);
      }
      return new Response("Ok");
    }
    return new Response("Bot is running.");
  },
};

async function handleUpdate(update, env) {
  if (update.callback_query) {
    await handleCallback(update.callback_query, env);
  } else if (update.message && update.message.text) {
    await handleMessage(update.message, env);
  }
}

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();
  const lowerText = text.toLowerCase();
  const msgId = message.message_id;
  const isPrivate = message.chat.type === "private";
  
  const ADMIN_ID = Number(env.ADMIN_ID);

  // --- 🛡️ 1. 身份验证逻辑 ---
  if (isPrivate && userId !== ADMIN_ID && CONFIG.AUTH.ENABLED && env.BOT_KV) {
    const isVerified = await env.BOT_KV.get(`verified_${userId}`);
    
    if (!isVerified) {
      if (text === CONFIG.AUTH.ANSWER) {
        await env.BOT_KV.put(`verified_${userId}`, "true", { expirationTtl: 31536000 });
        await sendMessage(env, chatId, CONFIG.AUTH.SUCCESS_MSG);
        await sendMenu(env, chatId); 
        return;
      } else {
        await sendMessage(env, chatId, CONFIG.AUTH.QUESTION);
        return; 
      }
    }
  }

  // --- 📨 2. 检查留言模式 ---
  if (isPrivate && env.BOT_KV) {
    const userState = await env.BOT_KV.get(`state_${userId}`);
    if (userState === "waiting_for_message") {
      const forwardMsg = `📩 *收到新留言*\n\n👤 来自: ${message.from.first_name} (ID: \`${userId}\`)\n📄 内容: \n\n${text}`;
      await sendMessage(env, ADMIN_ID, forwardMsg);
      await sendMessage(env, chatId, "✅ 您的消息已发送给主人，如有回复我会通知您。");
      await env.BOT_KV.delete(`state_${userId}`);
      return;
    }
  }

  // --- 🤖 3. 关键词唤醒 ---
  const isWakeUp = CONFIG.WAKE_UP_KEYWORDS.some(k => lowerText.includes(k.toLowerCase()));
  if (isWakeUp) {
    await sendMenu(env, chatId);
    return;
  }

  // --- 🛠️ 4. 群组管理指令 ---
  if (lowerText === "/pin" || lowerText === "置顶") {
    if (!message.reply_to_message) return sendMessage(env, chatId, "⚠️ 请先回复一条消息。", null, msgId);
    try {
      await callApi(env, "pinChatMessage", { chat_id: chatId, message_id: message.reply_to_message.message_id });
    } catch (e) { await sendMessage(env, chatId, "❌ 权限不足。", null, msgId); }
    return;
  }

  if (lowerText === "/ban" || lowerText === "踢") {
    if (!message.reply_to_message) return;
    try {
      await callApi(env, "banChatMember", { chat_id: chatId, user_id: message.reply_to_message.from.id });
      await sendMessage(env, chatId, "🚫 已封禁该用户。", null, msgId);
    } catch (e) { await sendMessage(env, chatId, "❌ 封禁失败。", null, msgId); }
    return;
  }

  // --- 🔧 5. 工具指令 ---
  if (lowerText.startsWith("/ip") || lowerText.startsWith("ip")) {
    const target = text.replace(/^\/?ip\s*/i, "").trim();
    if (!target) return sendMessage(env, chatId, "🌍 用法：`/ip 8.8.8.8`", null, msgId);
    await handleIPQuery(env, chatId, target, msgId);
    return;
  }

  if (lowerText.startsWith("/weather") || lowerText.startsWith("天气")) {
    const city = text.replace(/^\/?(weather|天气)\s*/i, "").trim();
    if (!city) return sendMessage(env, chatId, "🌦 用法：`天气 北京`", null, msgId);
    await handleWeatherQuery(env, chatId, city, msgId);
    return;
  }

  // --- 🔚 6. 默认兜底逻辑 ---
  if (isPrivate) {
    await sendMenu(env, chatId);
    return;
  }
}

async function handleCallback(query, env) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId = query.message.message_id;
  const data = query.data;

  switch (data) {
    case "action_contact_owner":
      if (env.BOT_KV) {
        await env.BOT_KV.put(`state_${userId}`, "waiting_for_message", { expirationTtl: 300 }); 
        await answerCallback(env, query.id, "进入留言模式");
        await sendMessage(env, chatId, "📝 *请直接发送你要说的话*\n\n(仅限文本，发送下一条消息将自动转发给主人)");
      } else {
        await answerCallback(env, query.id, "KV数据库未配置，无法留言", true);
      }
      break;

    case "tool_id":
      const groupInfo = chatId < 0 ? `\n👥 群组 ID: \`${chatId}\`` : "";
      await sendMessage(env, chatId, `🆔 *ID 信息*\n\n👤 User ID: \`${userId}\`${groupInfo}`);
      break;

    case "tool_time":
      const time = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
      await answerCallback(env, query.id, `⏰ 北京时间：${time}`, true);
      return; 

    case "tool_weather_guide":
      await answerCallback(env, query.id, "请看提示");
      await sendMessage(env, chatId, "🌦 *天气查询*\n直接发送：`天气 城市`");
      break;

    case "tool_ip_guide":
      await answerCallback(env, query.id, "请看提示");
      await sendMessage(env, chatId, "🌍 *IP 查询*\n直接发送：`/ip 1.1.1.1`");
      break;

    case "btn_close":
      await deleteMessage(env, chatId, msgId);
      return;

    default:
      await answerCallback(env, query.id, "🚧 功能开发中");
  }
  await answerCallback(env, query.id);
}

// =========================================================================
// 3. 辅助函数
// =========================================================================

async function sendMenu(env, chatId) {
  await sendMessage(env, chatId, CONFIG.WELCOME_TEXT, {
    inline_keyboard: CONFIG.KEYBOARD_LAYOUT
  });
}

async function handleIPQuery(env, chatId, ip, replyId) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`);
    const data = await res.json();
    if (data.status !== "success") throw new Error();
    const msg = `🌍 *IP 归属地*\n📍 IP: \`${data.query}\`\n🏳️ 国家: ${data.country}\n🏙 城市: ${data.regionName} ${data.city}\n🏢 ISP: ${data.isp}`;
    await sendMessage(env, chatId, msg, null, replyId);
  } catch (e) { await sendMessage(env, chatId, "❌ IP 查询失败", null, replyId); }
}

async function handleWeatherQuery(env, chatId, city, replyId) {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    if (res.status !== 200) throw new Error();
    const text = await res.text();
    await sendMessage(env, chatId, `🌦 *实时天气*:\n${text}`, null, replyId);
  } catch (e) { await sendMessage(env, chatId, "❌ 天气查询失败", null, replyId); }
}

async function sendMessage(env, chatId, text, replyMarkup = null, replyToMsgId = null) {
  const payload = { chat_id: chatId, text: text, parse_mode: "Markdown", disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  return await callApi(env, "sendMessage", payload);
}

async function deleteMessage(env, chatId, msgId) {
  return await callApi(env, "deleteMessage", { chat_id: chatId, message_id: msgId });
}

async function answerCallback(env, callbackId, text = null, showAlert = false) {
  return await callApi(env, "answerCallbackQuery", { callback_query_id: callbackId, text: text, show_alert: showAlert });
}

async function callApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  
  // 核心修复：如果 Telegram API 拒绝请求，将错误打印到控制台
  if (!result.ok) {
    console.error(`❌ Telegram API 报错 (${method}):`, result.description);
  }
  return result;
}

async function setWebhook(request, env) {
  const url = new URL(request.url);
  const webhookUrl = `${url.protocol}//${url.hostname}`;
  const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
  const res = await fetch(apiUrl);
  return new Response(JSON.stringify(await res.json(), null, 2), { headers: { "Content-Type": "application/json" } });
}
