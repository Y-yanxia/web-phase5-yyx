// 业务错误：带 HTTP 状态码 + 业务码 + 给用户看的话。
// 抛出后由 app.js 的全局错误处理统一转成 { code, data, msg }。
export class AppError extends Error {
  constructor(message, { status = 400, code = 40000, expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export const badRequest = (message, code = 40001) => new AppError(message, { status: 400, code });
export const notFound = (message = '资源不存在', code = 40401) => new AppError(message, { status: 404, code });
