/**
 * 业务错误类型：一个异常同时带 HTTP 状态码、业务码和给用户看的中文提示。
 * 链路位置：路由和工具里 throw，app.js 的全局错误处理负责翻译成 { code, data, msg }。
 * 对外导出：AppError 类、badRequest()、notFound() 两个快捷构造器。
 * 坑：message 会原样返回给前端，只写人话，别把 SQL、堆栈、Key 拼进去。
 */
// 业务错误：带 HTTP 状态码 + 业务码 + 给用户看的话。
// 抛出后由 app.js 的全局错误处理统一转成 { code, data, msg }。
export class AppError extends Error {
  // status 给 HTTP，code 给前端做细分判断，两者可以不一致（上游 401 对外常报 502）
  constructor(message, { status = 400, code = 40000, expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    // expose 目前没人读，先留着：以后要区分「能示人」和「内部错误」时有地方挂
    this.expose = expose;
  }
}

// 快捷构造：400 参数错误，默认业务码 40001，省得每次手写 status
export const badRequest = (message, code = 40001) => new AppError(message, { status: 400, code });
// 快捷构造：404 资源不存在，默认业务码 40401
export const notFound = (message = '资源不存在', code = 40401) => new AppError(message, { status: 404, code });
