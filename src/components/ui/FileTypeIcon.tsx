import { cn } from "@/lib/utils";
import {
  GENERATED_COMPOUND_SUFFIX_ICONS,
  GENERATED_EXTENSION_ICONS,
  GENERATED_FILE_ICON_PATHS,
  GENERATED_SPECIAL_NAME_ICONS,
  type GeneratedFileIconId,
} from "@/components/ui/file-type-icons.generated";

const compoundSuffixes = Object.entries(
  GENERATED_COMPOUND_SUFFIX_ICONS,
).sort(([left], [right]) => right.length - left.length);

function isGeneratedIcon(value: string): value is GeneratedFileIconId {
  return value in GENERATED_FILE_ICON_PATHS;
}

export function resolveFileTypeIcon(filePath: string): GeneratedFileIconId {
  const filename =
    filePath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? filePath;
  const lower = filename.toLowerCase();
  const special =
    GENERATED_SPECIAL_NAME_ICONS[
      lower as keyof typeof GENERATED_SPECIAL_NAME_ICONS
    ];
  if (special && isGeneratedIcon(special)) return special;
  if (lower === ".env" || lower.startsWith(".env.")) return "tune";

  for (const [suffix, icon] of compoundSuffixes) {
    if (lower.endsWith(suffix) && isGeneratedIcon(icon)) return icon;
  }

  const dot = lower.lastIndexOf(".");
  const extension = dot >= 0 ? lower.slice(dot + 1) : "";
  const icon =
    GENERATED_EXTENSION_ICONS[
      extension as keyof typeof GENERATED_EXTENSION_ICONS
    ];
  return icon && isGeneratedIcon(icon) ? icon : "file";
}

export function FileTypeIcon({
  filePath,
  className,
  size = 16,
}: {
  filePath: string;
  className?: string;
  size?: number;
}) {
  const icon = resolveFileTypeIcon(filePath);
  return (
    // Static local SVGs are already optimized assets; Next/Image would add
    // per-row wrappers and loader work to a potentially large file tree.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={GENERATED_FILE_ICON_PATHS[icon]}
      width={size}
      height={size}
      draggable={false}
      alt=""
      aria-hidden
      className={cn("shrink-0 object-contain", className)}
      data-file-icon={icon}
    />
  );
}
