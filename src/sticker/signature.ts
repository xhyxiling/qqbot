/**
 * 文件签名识别 — 按文件头判断真实图片格式
 *
 * 共享给 transport/attachment.ts（下载后纠正本地缓存扩展名）
 * 和 sticker 模块（元数据写入时纠正路径扩展名）。
 */
import { basename, extname } from "node:path";

/** 允许的图片扩展名 */
export const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
]);

/** 文件头 → 扩展名 */
export const SIGNATURE_MAP: Array<{
  sig: string;
  len: number;
  ext: string;
  mime: string;
}> = [
  { sig: "47494638", len: 6, ext: ".gif", mime: "image/gif" }, // GIF87a / GIF89a
  { sig: "89504e470d0a1a0a", len: 8, ext: ".png", mime: "image/png" }, // PNG
  { sig: "ffd8ff", len: 3, ext: ".jpg", mime: "image/jpeg" }, // JPEG
  { sig: "424d", len: 2, ext: ".bmp", mime: "image/bmp" }, // BMP
];

/** 特殊：WEBP 需要同时检查前 4 字节和 8-12 字节 */
function matchWebp(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const first4 = buf.subarray(0, 4).toString("ascii");
  const next4 = buf.subarray(8, 12).toString("ascii");
  return first4 === "RIFF" && next4 === "WEBP";
}

/** 从文件 buffer 识别真实扩展名 */
export function detectImageExt(
  buf: Buffer,
): { ext: string; mime: string } | null {
  const hex = buf.subarray(0, 12).toString("hex");
  for (const { sig, len, ext, mime } of SIGNATURE_MAP) {
    if (hex.startsWith(sig) && buf.length >= len) return { ext, mime };
  }
  if (matchWebp(buf)) return { ext: ".webp", mime: "image/webp" };
  return null;
}

/** 纠正路径扩展名 — 如果路径后缀与真实格式不一致，返回纠正后的路径 */
export function correctPathExt(filePath: string, buf: Buffer): string {
  const detected = detectImageExt(buf);
  if (!detected) return filePath;
  const currentExt = extname(filePath).toLowerCase();
  if (
    currentExt === detected.ext ||
    (detected.ext === ".jpg" && currentExt === ".jpeg")
  )
    return filePath;
  const stem = currentExt ? filePath.slice(0, -currentExt.length) : filePath;
  return `${stem}${detected.ext}`;
}

/** 纠正 basename 中的扩展名（不影响目录） */
export function correctBasenameExt(filePath: string, buf: Buffer): string {
  const corrected = correctPathExt(filePath, buf);
  return basename(corrected);
}
