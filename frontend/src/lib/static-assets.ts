const raw = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
export const BASE_PATH = raw && raw !== "/" ? `/${raw.replace(/^\/+|\/+$/g, "")}` : "";
export function assetUrl(path: string): string { return `${BASE_PATH}/${path.replace(/^\/+/, "")}`; }
