// Single source for QQ commands: menu order, permission keys, menu text and
// usage help. Every entry has the same shape:
//   key          permission key (menu visibility and execution share it)
//   category     section id from qqCommandCategories
//   menuLine     the command as shown in the menu
//   description  one-line purpose shown under the menu line
//   usage        [syntax, note] pairs shown by the command's own help card
//   aliases      recognized spellings
//   defaultPublic / configurable  permission defaults
export const qqCommandCategories = [
  { id: "conversation", icon: "💬", label: "会话" },
  { id: "intelligence", icon: "🧠", label: "AI 与学习" },
  { id: "group", icon: "👥", label: "群与成员" },
  { id: "operations", icon: "🛠️", label: "运行状态" },
  { id: "authority", icon: "🔐", label: "权限" }
];

const commands = [
  {
    key: "menu",
    category: "conversation",
    menuLine: "/菜单",
    description: "查看按身份显示的指令菜单",
    usage: [["/菜单", ""]],
    aliases: ["菜单", "管理菜单", "menu", "help", "帮助", "指令"],
    defaultPublic: true,
    configurable: true
  },
  {
    key: "newDialog",
    category: "conversation",
    menuLine: "/新对话",
    description: "清空当前上下文，开启新会话",
    usage: [["/新对话", "同时清除当前会话的线程映射"]],
    aliases: ["新对话", "开启新对话", "开始新对话", "清空上下文", "清除上下文", "清理上下文", "重置上下文", "忘记上下文"],
    defaultPublic: true,
    configurable: true
  },
  {
    key: "stop",
    category: "conversation",
    menuLine: "/stop",
    description: "暂停当前回复，保留会话与记忆",
    usage: [["/stop", "只停止正在生成的回复"]],
    aliases: ["stop", "停止", "停", "打住", "停一下", "别回了", "别生成了", "中止", "终止"],
    defaultPublic: true,
    configurable: true
  },
  {
    key: "summary",
    category: "conversation",
    menuLine: "/总结聊天记录",
    description: "总结当前聊天并提取长期知识",
    usage: [["/总结聊天记录 [条数|全部]", "默认总结最近记录"]],
    aliases: ["总结上下文", "总结前文", "总结聊天记录", "总结群聊", "总结私聊", "总结最近", "概括上下文", "概括聊天记录", "概括群聊", "概括私聊", "summary"],
    defaultPublic: true,
    configurable: true
  },
  {
    key: "session",
    category: "conversation",
    menuLine: "/会话模式",
    description: "切换自动、长期或临时会话线程",
    usage: [
      ["/会话模式", "查看当前群或私聊的模式"],
      ["/会话模式 自动|长期|临时", "从下一次模型回复开始生效"]
    ],
    aliases: ["会话模式", "长期会话", "临时会话", "自动会话", "session", "session-mode"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "crossSession",
    category: "conversation",
    menuLine: "/跨会话",
    description: "列出、读取其他会话，或向目标会话发送",
    usage: [
      ["/跨会话 列表 [筛选]", ""],
      ["/跨会话 查看 group:群号 [最近30]", ""],
      ["/跨会话 发送 private:QQ号 | 消息", ""]
    ],
    aliases: ["跨会话", "会话列表", "其他会话", "cross-session"],
    defaultPublic: false,
    configurable: false
  },
  {
    key: "aiTasks",
    category: "intelligence",
    menuLine: "/AI任务",
    description: "手动运行总结、记忆、人设、风格与知识审核",
    usage: [
      ["/AI任务", "查看任务中心"],
      ["/AI任务 任务名 [完整记录]", "完整记录：使用完整聊天总结上限"],
      ["/AI任务 强制 [后台] 任务名", "强制：跳过到期/冷却；后台：立即返回任务编号"]
    ],
    aliases: ["AI任务", "AI任务中心", "手动触发", "任务中心", "ai-task", "ai-tasks"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "model",
    category: "intelligence",
    menuLine: "/模型",
    description: "查看或切换 Codex 模型",
    usage: [
      ["/模型", "列出当前账号可用模型"],
      ["/模型 序号|模型名", "切换 QQ 通道模型"]
    ],
    aliases: ["模型", "qq模型", "切模型", "切换模型"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "reasoning",
    category: "intelligence",
    menuLine: "/思考强度",
    description: "调整思考强度、推理摘要、人格与服务档位",
    usage: [
      ["/思考强度 [档位]", "low、medium、high、xhigh 等，以模型支持为准"],
      ["/推理摘要 [档位]", "auto、concise、detailed、none"],
      ["/人格 [档位]", "none、friendly、pragmatic"],
      ["/服务档位 [档位|默认]", "以模型公布的档位为准"]
    ],
    aliases: ["智能等级", "智能", "思考强度", "qq智能等级", "推理摘要", "人格", "服务档位"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "interest",
    category: "intelligence",
    menuLine: "/兴趣配置",
    description: "配置主动兴趣判断与判定模型",
    usage: [
      ["/兴趣配置", "查看当前配置"],
      ["/兴趣 开启|关闭", ""],
      ["/兴趣间隔 条数", "每 N 条普通群消息判断一次"],
      ["/兴趣分钟 分钟|关闭", "有新消息时按分钟补充判断"],
      ["/兴趣厂商 openrouter|deepseek|custom", ""],
      ["/兴趣模型 模型名", ""],
      ["/兴趣超时 毫秒", "1500–20000"],
      ["/兴趣最近 条数", "1–12"],
      ["/兴趣重置", "重置消息计数与分钟周期"]
    ],
    aliases: ["兴趣", "兴趣配置", "主动配置", "兴趣间隔", "兴趣模型", "interest", "proactive"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "allowlist",
    category: "group",
    menuLine: "/白名单",
    description: "查看或修改群白名单",
    usage: [
      ["/白名单", "查看当前白名单"],
      ["/加群 群号", ""],
      ["/删群 群号", ""]
    ],
    aliases: ["白名单", "群白名单", "白名单列表", "加群", "添加白名单群", "删群", "移除白名单群"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "groupAdmin",
    category: "group",
    menuLine: "/群管理",
    description: "禁言、踢人、全员禁言与禁言列表",
    usage: [
      ["/禁言 @用户 [时长]", "默认 10 分钟，最长 30 天"],
      ["/解禁言 @用户", ""],
      ["/踢人 @用户 [拒绝再加]", ""],
      ["/全员禁言 开启|关闭", ""],
      ["/群禁言列表", ""]
    ],
    aliases: ["群管理", "禁言", "解禁言", "解除禁言", "踢人", "全员禁言", "群禁言列表"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "ban",
    category: "group",
    menuLine: "/ban",
    description: "管理 Bot 侧的用户封禁名单",
    usage: [
      ["/ban @用户|QQ号 [时长]", "不写时长为永久"],
      ["/unban @用户|QQ号", ""],
      ["/banlist", "查看封禁名单"]
    ],
    aliases: ["ban", "封禁", "拉黑", "unban", "解禁", "banlist"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "requests",
    category: "group",
    menuLine: "/申请",
    description: "处理好友申请、群邀请和入群申请",
    usage: [
      ["/申请 列表 [全部]", ""],
      ["/申请 同步", "从 NapCat 补取待处理申请"],
      ["/申请 同意 最新|#申请ID [备注]", ""],
      ["/申请 拒绝 #申请ID [理由]", ""]
    ],
    aliases: ["申请", "好友申请", "群申请"],
    defaultPublic: false,
    configurable: false
  },
  {
    key: "activeGroupJoin",
    category: "group",
    menuLine: "/主动加群",
    description: "让 Bot 申请加入指定 QQ 群",
    usage: [["/主动加群 群号 [答案:… 验证信息:…]", "需要时附上验证答案"]],
    aliases: ["主动加群"],
    defaultPublic: false,
    configurable: false
  },
  {
    key: "status",
    category: "operations",
    menuLine: "/状态",
    description: "查看 QQ 通道与模型运行状态",
    usage: [["/状态", ""]],
    aliases: ["状态", "status", "查看状态"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "config",
    category: "operations",
    menuLine: "/详细配置",
    description: "查看完整后台配置摘要",
    usage: [["/详细配置", ""]],
    aliases: ["详细配置", "配置", "config", "settings", "详细状态"],
    defaultPublic: false,
    configurable: true
  },
  {
    key: "permissions",
    category: "authority",
    menuLine: "/菜单权限",
    description: "设置非主人可见且可执行的指令",
    usage: [
      ["/菜单权限", "查看每个指令的开放情况"],
      ["/允许指令 key [QQ号]", "对所有人或某个人开放"],
      ["/禁用指令 key [QQ号]", "对所有人或某个人关闭"]
    ],
    aliases: ["菜单权限", "权限菜单", "公开指令", "允许指令", "禁用指令"],
    defaultPublic: false,
    configurable: false
  },
  {
    key: "botAdmins",
    category: "authority",
    menuLine: "/Bot管理员",
    description: "查看 Bot 管理员；仅主人可增删",
    usage: [
      ["/Bot管理员", "查看管理员名单"],
      ["/Bot管理员 添加 QQ号", "仅主人"],
      ["/Bot管理员 删除 QQ号", "仅主人"]
    ],
    aliases: ["Bot管理员", "机器人管理员", "助手管理员", "agent管理员"],
    defaultPublic: false,
    configurable: false
  }
];

const categoryIcons = Object.fromEntries(qqCommandCategories.map((category) => [category.id, category.icon]));

export const qqCommandCatalog = commands.map((command) => Object.freeze({
  ...command,
  icon: categoryIcons[command.category] || ""
}));

export const defaultQqPublicCommands = Object.fromEntries(
  qqCommandCatalog.filter((command) => command.defaultPublic).map((command) => [command.key, true])
);

export function getQqCommand(key) {
  return qqCommandCatalog.find((command) => command.key === key) || null;
}
