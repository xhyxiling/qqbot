/**
 * 富媒体下载 — 将 QQ 图片/视频/file 附件安全下载到本地
 *
 * 下载后仅通过本地绝对路径提示模型，由模型通过 qqbot_describe_image / ffmpeg / tool-fs 等工具自行分析，
 *
 * 下载目录固定为 ~/.dsh-qqbot/media，
 * 文件名用时间戳+随机数防重名，不依赖 agent cwd，便于 qqbot_describe_image / tool-fs 等工具稳定访问。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as dns from 'node:dns';
import * as https from 'node:https';
import { MEDIA_ROOT } from "../media/media-cleaner.js";
/** 默认富媒体下载大小上限（MB），可被 media.maxMB 覆盖 */
const DEFAULT_MAX_MB = 200;
/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** 是否为图片（兼容裸值 'image' 与 MIME 'image/png'） */
export function isImageContentType(contentType) {
    return contentType === 'image' || contentType?.startsWith('image/') === true;
}
/** 是否为视频（兼容裸值 'video' 与 MIME 'video/mp4'） */
export function isVideoContentType(contentType) {
    return contentType === 'video' || contentType?.startsWith('video/') === true;
}
/** 是否为语音（兼容裸值 'voice' 与 MIME 'audio/silk'） */
export function isVoiceContentType(contentType) {
    return contentType === 'voice' || contentType?.startsWith('audio/') === true;
}
/** 归类附件 content_type 为统一类型 */
export function classifyContentType(contentType) {
    if (isImageContentType(contentType))
        return 'image';
    if (isVideoContentType(contentType))
        return 'video';
    if (isVoiceContentType(contentType))
        return 'voice';
    return 'file';
}
/** 处理 `//` 开头的协议相对 URL（补 https:） */
function normalizeUrl(url) {
    return url.startsWith('//') ? `https:${url}` : url;
}
/** 文件名净化：去路径、移除非法字符（保留中文等 Unicode 字符），防止路径穿越 */
function sanitizeFilename(name) {
    const base = basename(name.replace(/\\/g, '/'));
    // 仅替换文件系统非法字符（Windows 保留字符 + 控制字符），保留中文/空格等
    // normalize NFC：统一 Unicode 规范化，避免 macOS(NFD) 与 Linux/Windows(NFC) 存储差异导致路径对不上
    const safe = base
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .trim()
        .normalize('NFC');
    return safe || 'attachment';
}
/** 统一路径分隔符为 `/`（POSIX），Node fs 在 Windows 也接受正斜杠，保证注入路径跨平台一致 */
function toPosixPath(p) {
    return p.split(sep).join('/');
}
/** 防重名：文件名 + 时间戳 + 随机数 */
function uniqueFilename(name) {
    const base = sanitizeFilename(name);
    const ext = extname(base);
    const stem = basename(base, ext);
    const rand = randomBytes(4).toString('hex');
    return `${stem}_${Date.now()}_${rand}${ext}`;
}
/** 字节数格式化 */
function formatSize(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}
/** 按图片文件头纠正扩展名（QQ 的 filename 可能与实际内容不一致） */
function correctImageExtension(filePath, buf) {
    const signature = buf.subarray(0, 12).toString('hex');
    let actualExt = null;
    if (signature.startsWith('474946383761') || signature.startsWith('474946383961'))
        actualExt = '.gif';
    else if (signature.startsWith('89504e470d0a1a0a'))
        actualExt = '.png';
    else if (signature.startsWith('ffd8ff'))
        actualExt = '.jpg';
    else if (signature.startsWith('52494646') && buf.toString('ascii', 8, 12) === 'WEBP')
        actualExt = '.webp';
    else if (signature.startsWith('424d'))
        actualExt = '.bmp';
    if (!actualExt)
        return filePath;
    const currentExt = extname(filePath).toLowerCase();
    if (currentExt === actualExt || (actualExt === '.jpg' && currentExt === '.jpeg'))
        return filePath;
    const stem = currentExt ? filePath.slice(0, -currentExt.length) : filePath;
    return `${stem}${actualExt}`;
}
// ── SSRF 防护：阻断解析到私有/保留地址的下载 ──
const PRIVATE_RANGES = [
    [0x0a000000n, 8], // 10.0.0.0/8
    [0xac100000n, 12], // 172.16.0.0/12
    [0xc0a80000n, 16], // 192.168.0.0/16
    [0x7f000000n, 8], // 127.0.0.0/8
    [0xa9fe0000n, 16], // 169.254.0.0/16
    [0xe0000000n, 4], // 224.0.0.0/4 (multicast)
];
function ipToBigInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}
function isPrivateIP(ip) {
    const val = ipToBigInt(ip);
    return PRIVATE_RANGES.some(([mask, prefix]) => (val >> (32n - BigInt(prefix))) === (mask >> (32n - BigInt(prefix))));
}
/**
 * 解析 hostname 并阻断指向私有/内网地址的 URL（SSRF 防护）
 * @returns 一个可达的 IPv4 地址（用于后续 https.request 跳过 fetch DNS）
 */
async function assertSafeHostname(hostname) {
    // 优先 dns.lookup（走系统 resolver，会 fallback 到 hosts 文件），
    // fallback 到 resolve4（只查 A 记录）——两者都尝试，哪个先返回可用 IPv4 就用
    const ip = await new Promise((resolve, reject) => {
        let done = false;
        const onResult = (ip, err) => {
            if (done)
                return;
            if (!err && ip) {
                done = true;
                resolve(ip);
            }
        };
        dns.lookup(hostname, { family: 4 }, (err, address) => onResult(address, err));
        dns.promises.resolve4(hostname).then((ips) => { if (ips.length > 0)
            onResult(ips[0], null); }, () => { }).catch(() => { });
        // 1.5s 超时后 reject
        setTimeout(() => {
            if (!done) {
                done = true;
                reject(new Error(`DNS resolution failed: ${hostname}`));
            }
        }, 1500);
    });
    if (isPrivateIP(ip))
        throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${ip}`);
    return ip;
}
/** 用 https.request 手动下载（绕过 fetch 的 DNS 解析，直接用已知 IPv4） */
function downloadViaHttps(url, ip, maxBytes) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
            method: 'GET',
            hostname: ip, // 直接用 IP，跳过 DNS
            port: 443,
            path: parsed.pathname + parsed.search,
            headers: {
                Host: parsed.hostname, // 保留原始 hostname 做 SNI
                'User-Agent': 'dsh-qqbot/1.0',
            },
            timeout: DOWNLOAD_TIMEOUT_MS,
            servername: parsed.hostname, // TLS SNI 必须用原始 hostname
        }, (res) => {
            if (res.statusCode !== 200 && res.statusCode !== 206) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let bytes = 0;
            const chunks = [];
            res.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > maxBytes) {
                    reject(new Error(`Download exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB`));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Download timeout')); });
        req.end();
    });
}
/** 安全下载：仅 HTTPS + SSRF 防护 + 大小上限 + 超时 */
async function download(url, maxBytes) {
    const parsed = new URL(normalizeUrl(url));
    if (parsed.protocol !== 'https:') {
        throw new Error(`Only HTTPS allowed: ${parsed.protocol}`);
    }
    // 解析 hostname → 拿到一个可达的 IPv4（SSRF 防护已在内部做）
    const ip = await assertSafeHostname(parsed.hostname);
    // 用 https.request 指定 IP 连接（绕过 fetch 内置 DNS），避免 Windows 某些环境 DNS 异常
    return await downloadViaHttps(url, ip, maxBytes);
}
/**
 * 下载消息中的富媒体附件（image/video/file）到本地
 *
 * 下载目录固定为 ~/.dsh-qqbot/media，文件名用时间戳+随机数防重名。
 * 下载失败不阻断（由调用方回退描述）。
 */
export async function downloadMediaAttachments(attachments, media, logger) {
    if (!media.enabled)
        return [];
    const targets = (attachments ?? []).filter(a => classifyContentType(a.content_type) !== 'voice' && a.url);
    if (targets.length === 0)
        return [];
    mkdirSync(MEDIA_ROOT, { recursive: true });
    const maxBytes = (media.maxMB ?? DEFAULT_MAX_MB) * 1024 * 1024;
    const results = [];
    for (const att of targets) {
        const contentType = classifyContentType(att.content_type);
        let localPath = toPosixPath(join(MEDIA_ROOT, uniqueFilename(att.filename)));
        if (att.size > maxBytes) {
            logger.debug(`im-qqbot: skip download (${att.size}B too large): ${att.filename}`);
            continue; // 超限不下载，由 buildDynamicCtx 回退为描述
        }
        let bytes;
        try {
            const buf = await download(att.url, maxBytes);
            if (contentType === 'image')
                localPath = correctImageExtension(localPath, buf);
            writeFileSync(localPath, buf);
            bytes = buf.length;
        }
        catch (err) {
            logger.warn(`im-qqbot: download failed: ${att.filename} — ${err instanceof Error ? err.message : String(err)}`);
            continue; // 下载失败不加入结果，由 buildDynamicCtx 回退为描述
        }
        logger.debug(`im-qqbot: attachment downloaded: ${att.filename} (${formatSize(bytes)}) → ${localPath}`);
        results.push({ filename: att.filename, contentType, localPath });
    }
    return results;
}
//# sourceMappingURL=attachment.js.map