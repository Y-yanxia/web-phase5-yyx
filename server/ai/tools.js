// 任务5 的核心：工具定义 + 真正的执行器。
// [讲解点] 模型只能「说」要调哪个函数、传什么参数，真正的数据库操作永远发生在这里，
// 模型看不见 SQL，也拿不到数据库句柄——这条边界既是安全边界，也是可解释性来源。
import { listItems, createItem, updateItem, getItem } from '../db.js';

// description 是模型唯一的「使用说明书」。
// 上一版把 description 写成「新增」，模型就只当聊天、从不调用（事故 3 的起因）。
export const TOOL_DEFINITIONS = [
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
          due: {
            type: 'string',
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
      description:
        '查询用户当前的待办清单。当用户问「我还有什么要做 / 还有哪些没完成 / 查一下清单」时必须调用本工具，不要凭空编造条目。',
      parameters: {
        type: 'object',
        properties: {
          done: {
            type: 'integer',
            enum: [0, 1],
            description: '0 表示只看未完成，1 表示只看已完成；不传表示全部。',
          },
          keyword: {
            type: 'string',
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
      description:
        '把一条待办标记为已完成。当用户说「我做完了 / 完成了 / 勾掉 / 那件事办完了」时必须调用本工具。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '要完成的条目标题关键词，从用户原话里提取，例如「实验报告」。',
          },
        },
        required: ['keyword'],
      },
    },
  },
];

// 统一的工具执行入口：永远返回可 JSON 序列化的对象，绝不抛异常给模型看堆栈
export function executeTool(name, args = {}) {
  switch (name) {
    case 'add_item': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return { ok: false, error: 'title 不能为空' };
      const item = createItem({ title, due: args.due || null });
      return { ok: true, data: item, summary: `已新增 #${item.id}「${item.title}」` };
    }

    case 'query_items': {
      const done = args.done === 0 || args.done === 1 ? args.done : null;
      const items = listItems({ done, q: args.keyword || '' });
      return {
        ok: true,
        data: { total: items.length, items: items.slice(0, 20) },
        summary: `查到 ${items.length} 条`,
      };
    }

    case 'complete_item': {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      if (!keyword) return { ok: false, error: 'keyword 不能为空' };
      const candidates = listItems({ done: 0, q: keyword });
      if (candidates.length === 0) {
        return { ok: false, error: `没有找到包含「${keyword}」的未完成条目`, summary: '未找到条目' };
      }
      // 多条命中时取最新一条（id 最大的），并在结果里说明，避免"悄悄改错"
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

    default:
      return { ok: false, error: `未知工具：${name}` };
  }
}

export { getItem };
