/// <reference types="vite/client" />

// issues/12：版本身份由构建管线注入（三个 vite/vitest 配置同源读取 package.json）。
declare const __APP_VERSION__: string;
