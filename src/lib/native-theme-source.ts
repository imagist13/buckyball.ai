export type NativeThemeSource = "system" | "light" | "dark";

export function isNativeThemeSource(value: unknown): value is NativeThemeSource {
  return value === "system" || value === "light" || value === "dark";
}

export function toNativeThemeSource(value: unknown): NativeThemeSource {
  return isNativeThemeSource(value) ? value : "system";
}
