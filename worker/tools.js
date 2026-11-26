// 工具定义与执行器（D1 版）。定义和 server/ai/tools.js 完全一致，保证模型行为一致。
//
// 在链路里的位置：chat.js 的 runAgent 收到 tool_calls 后交给 executeTool 真正改库；
// 模型只负责「说调哪个、传什么」，SQL 永远在这条边界的下面。
// 与 Express 版的差异只有一处：db.js 全变成 async，所以执行器也是 async/await。
import { listItems, createItem, updateItem } from './db.js';

// 这份 JSON Schema 会原样发给模型，是它唯一能看到的「函数签名」：
// name 决定它怎么叫，description 决定它何时叫，required 决定哪几个字段必填
export const TOOL_DEFINITIONS = [
  // 工具一：新增。description 写细它才准；只写「新增」模型会当闲聊，嘴上答应不写库
  {
    type: 'function',
    function: {
      name: 'add_item',
      description:
        '在待办清单中新增一条任务。当用户表达「帮我记一下 / 加一条 / 提醒我 / 别忘了我」这类意图时必须调用本工具，不要只用文字回复「好的已记下」。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '待办事项本身，只保留要做的事，去掉「帮我」「记一下」「提醒我」等指令词，例如「明天交实验报告」。',
          },
          due: { type: 'string', description: '截止日期，格式 YYYY-MM-DD；用户没说就不传。' },
        },
        required: ['title'],
      },
    },
  },
  // 工具二：查询。done / keyword 两个可选参数，由模型按用户原话自己填
  {
    type: 'function',
    function: {
      name: 'query_items',
      description:
        '查询用户当前的待办清单。当用户问「我还有什么要做 / 还有哪些没完成 / 查一下清单」时必须调用本工具，不要凭空编造条目。',
      parameters: {
        type: 'object',
        properties: {
          done: { type: 'integer', enum: [0, 1], description: '0 只看未完成，1 只看已完成；不传为全部。' },
          keyword: { type: 'string', description: '按标题关键词过滤，例如「实验」。' },
        },
        required: [],
      },
    },
  },
  // 工具三：完成。只让模型给关键词不给 id——用户说的是标题，猜 id 交给服务端更稳
  {
    type: 'function',
    function: {
      name: 'complete_item',
      description:
        '把一条待办标记为已完成。当用户说「我做完了 / 完成了 / 勾掉 / 那件事办完了」时必须调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '要完成的条目标题关键词，从用户原话里提取，例如「实验报告」。' },
        },
        required: ['keyword'],
      },
    },
  },
];

// 统一执行入口：永远返回可 JSON 序列化的结果，绝不把异常和堆栈扔给模型
export async function executeTool(env, name, args = {}) {
  switch (name) {
    case 'add_item': {
      // 模型可能把 title 传成数字或空串，先收紧再写库，脏数据进不去
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return { ok: false, error: 'title 不能为空' };
      const item = await createItem(env, { title, due: args.due || null });
      return { ok: true, data: item, summary: `已新增 #${item.id}「${item.title}」` };
    }

    case 'query_items': {
      // done 只认 0/1，其他（包括字符串 '0'）一律当「不过滤」，别因为类型传错就查空
      const done = args.done === 0 || args.done === 1 ? args.done : null;
      const items = await listItems(env, { done, q: args.keyword || '' });
      return {
        ok: true,
        // 只回前 20 条：工具结果会进上下文，一次塞几百条既贵又容易把窗口撑爆
        data: { total: items.length, items: items.slice(0, 20) },
        summary: `查到 ${items.length} 条`,
      };
    }

    case 'complete_item': {
      // 先按关键词找未完成的候选，让模型只出关键词、不用记 id
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      if (!keyword) return { ok: false, error: 'keyword 不能为空' };
      const candidates = await listItems(env, { done: 0, q: keyword });
      if (candidates.length === 0) {
        // 找不到不是异常：回一个模型能读懂的原因，它下一轮才知道怎么跟用户解释
        return { ok: false, error: `没有找到包含「${keyword}」的未完成条目`, summary: '未找到条目' };
      }
      // listItems 是 id 倒序，所以 candidates[0] 天然是最新那条
      const target = candidates[0];
      const updated = await updateItem(env, target.id, { done: 1 });
      return {
        ok: true,
        data: updated,
        // summary 里说清命中几条：用户才知道服务端替他挑了一条，不是「悄悄改错」
        summary:
          candidates.length > 1
            ? `命中 ${candidates.length} 条，已完成最新的 #${updated.id}「${updated.title}」`
            : `已完成 #${updated.id}「${updated.title}」`,
      };
    }

    default:
      // 模型偶尔会编出不存在的工具名，默认分支必须兜住，回明确错误而不是抛异常
      return { ok: false, error: `未知工具：${name}` };
  }
}
