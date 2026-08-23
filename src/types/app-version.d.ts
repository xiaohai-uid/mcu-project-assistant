// issues/12：版本身份由构建管线注入（三个 vite/vitest 配置同源读取 package.json）。
// 环境声明：不含模块导出，保持全局可见（server 与 tests 共用同一 tsconfig 工程）。
declare const __APP_VERSION__: string;
