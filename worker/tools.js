// 工具定义与执行器（D1 版）。定义和 server/ai/tools.js 完全一致，保证模型行为一致。
import { listItems, createItem, updateItem } from './db.js';

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
          due: { type: 'string', description: '截止日期，格式 YYYY-MM-DD；用户没说就不传。' },
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
          done: { type: 'integer', enum: [0, 1], description: '0 只看未完成，1 只看已完成；不传为全部。' },
          keyword: { type: 'string', description: '按标题关键词过滤，例如「实验」。' },
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
          keyword: { type: 'string', description: '要完成的条目标题关键词，从用户原话里提取，例如「实验报告」。' },
        },
        required: ['keyword'],
      },
    },
  },
];

export async function executeTool(env, name, args = {}) {
  switch (name) {
    case 'add_item': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return { ok: false, error: 'title 不能为空' };
      const item = await createItem(env, { title, due: args.due || null });
      return { ok: true, data: item, summary: `已新增 #${item.id}「${item.title}」` };
    }

    case 'query_items': {
      const done = args.done === 0 || args.done === 1 ? args.done : null;
      const items = await listItems(env, { done, q: args.keyword || '' });
      return {
        ok: true,
        data: { total: items.length, items: items.slice(0, 20) },
        summary: `查到 ${items.length} 条`,
      };
    }

    case 'complete_item': {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : '';
      if (!keyword) return { ok: false, error: 'keyword 不能为空' };
      const candidates = await listItems(env, { done: 0, q: keyword });
      if (candidates.length === 0) {
        return { ok: false, error: `没有找到包含「${keyword}」的未完成条目`, summary: '未找到条目' };
      }
      const target = candidates[0];
      const updated = await updateItem(env, target.id, { done: 1 });
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
