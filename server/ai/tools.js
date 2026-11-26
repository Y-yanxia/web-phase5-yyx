/**
 * 工具层：给模型看的函数清单（TOOL_DEFINITIONS）+ 真正的执行器（executeTool）。
 * 链路位置：agent 把定义随请求发给模型，模型回 tool_calls，再回到这里改数据库。
 * 对外导出：TOOL_DEFINITIONS、executeTool，另外转出一个 getItem。
 * 坑：description 写不清楚模型就不调用；执行器永远返回 { ok, ... }，绝不抛异常。
 */
// 任务5 的核心：工具定义 + 真正的执行器。
// [讲解点] 模型只能「说」要调哪个函数、传什么参数，真正的数据库操作永远发生在这里，
// 模型看不见 SQL，也拿不到数据库句柄——这条边界既是安全边界，也是可解释性来源。
import { listItems, createItem, updateItem, getItem } from '../db.js';

// description 是模型唯一的「使用说明书」。
// 上一版把 description 写成「新增」，模型就只当聊天、从不调用（事故 3 的起因）。
// parameters 用 JSON Schema：类型、必填、枚举写清楚，模型就少猜
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'add_item',
      // 描述里明确写「必须调用」，否则模型容易只用文字答应「好的已记下」
      description:
        '在待办清单中新增一条任务。当用户表达「帮我记一下 / 加一条 / 提醒我 / 别忘了我」这类意图时必须调用本工具，不要只用文字回复「好的已记下」。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            // 让模型先剥掉「帮我 / 记一下」，标题才干净
            description: '待办事项本身，只保留要做的事，去掉「帮我」「记一下」「提醒我」等指令词，例如「明天交实验报告」。',
          },
          due: {
            type: 'string',
            // 不传就是没有截止日期，别让模型自己编一个
            description: '截止日期，格式 YYYY-MM-DD；用户没说就不传。',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_items',
      // 查询：把真实清单喂给模型，它才不会凭空编条目
      description:
        '查询用户当前的待办清单。当用户问「我还有什么要做 / 还有哪些没完成 / 查一下清单」时必须调用本工具，不要凭空编造条目。',
      parameters: {
        type: 'object',
        properties: {
          done: {
            type: 'integer',
            enum: [0, 1],
            // enum 限死 0/1：模型看到枚举就不太会传 true 或 'done'
            description: '0 表示只看未完成，1 表示只看已完成；不传表示全部。',
          },
          keyword: {
            type: 'string',
            // 不传就不过滤；关键词由工具层拼成 LIKE 再查
            description: '按标题关键词过滤，例如「实验」。不传表示不过滤。',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_item',
      // 完成：只让模型给关键词，匹配交给 SQL，模型不需要知道 id
      description:
        '把一条待办标记为已完成。当用户说「我做完了 / 完成了 / 勾掉 / 那件事办完了」时必须调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            // 从原话里抠关键词，比如「实验报告」；多条命中时取哪条由工具层决定
            description: '要完成的条目标题关键词，从用户原话里提取，例如「实验报告」。',
          },
        },
        required: ['keyword'],
      },
    },
  },
];

// 统一的工具执行入口：永远返回可 JSON 序列化的对象，绝不抛异常给模型看堆栈
// 入参是模型生成的任意 JSON，每个分支都先判类型，再决定怎么落库
export function executeTool(name, args = {}) {
  switch (name) {
    case 'add_item': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      // title 只认非空字符串：数字、对象、空串都按「没填」处理
      if (!title) return { ok: false, error: 'title 不能为空' };
      // due 用 ||：空串 / null / undefined 都算没有截止日期
      const item = createItem({ title, due: args.due || null });
      return { ok: true, data: item, summary: `已新增 #${item.id}「${item.title}」` };
    }

    case 'query_items': {
      // 只认数字 0/1；模型传 '0' 或 true 一律当「全部」，宁可多查不漏查
      const done = args.done === 0 || args.done === 1 ? args.done : null;
      const items = listItems({ done, q: args.keyword || '' });
      return {
        ok: true,
        // 最多回 20 条给模型：太多既费 token 也没必要
        data: { total: items.length, items: items.slice(0, 20) },
        summary: `查到 ${items.length} 条`,
      };
    }

    case 'complete_item': {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      // keyword 是必填：空的话直接失败，别把清单里第一条误标完成
      if (!keyword) return { ok: false, error: 'keyword 不能为空' };
      // 只在未完成里找：已完成的不该被重复标记
      const candidates = listItems({ done: 0, q: keyword });
      if (candidates.length === 0) {
        // 找不到也给一句人话，模型可以直接转述给用户
        return { ok: false, error: `没有找到包含「${keyword}」的未完成条目`, summary: '未找到条目' };
      }
      // 多条命中时取最新一条（id 最大的），并在结果里说明，避免"悄悄改错"
      // listItems 按 id 倒序，所以 candidates[0] 就是最新那条
      const target = candidates[0];
      const updated = updateItem(target.id, { done: 1 });
      return {
        ok: true,
        data: updated,
        summary:
          candidates.length > 1
            ? `命中 ${candidates.length} 条，已完成最新的 #${updated.id}「${updated.title}」`
            : `已完成 #${updated.id}「${updated.title}」`,
      };
    }

    // 模型可能编出不存在的函数名，返回错误让它自己纠正，而不是抛异常
    default:
      return { ok: false, error: `未知工具：${name}` };
  }
}

// 转出 getItem：别的模块要读单条时不用各自去 import db
export { getItem };
