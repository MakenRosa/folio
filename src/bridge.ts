import { invoke, convertFileSrc } from '@tauri-apps/api/core';
export { invoke };
export const asset = (path: string) => convertFileSrc(path);
