window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/shared/bind-protocol.ts
		/**
		* 端内绑定协议 —— 宿主路由与客户端面板的共享契约
		*
		* 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
		* （client/bind-page.ts）各自 import，杜绝两端协议漂移。
		* 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
		* 客户端 tsdown 构建会将其内联进 bundle。
		*/
		/** 状态查询（绑定页轮询） */
		const BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
		/** 刷新二维码（绑定页按钮） */
		const BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
		/** 解绑：移除已保存凭据，回到绑定流程 */
		const BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
		/** 插件更新检查与执行（设置面板「插件更新」页签） */
		const BIND_UPDATE_PATH = "/qqbot/im-qqbot/update";
		/** 群友人格档案列表（设置面板「群友人格」页签） */
		const BIND_PERSONAS_PATH = "/qqbot/im-qqbot/personas";
		//#endregion
		//#region src/client/bind-page.ts
		/**
		* 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
		*
		* 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
		* - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
		* 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
		*
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		/** 样式注入标记（幂等） */
		const STYLE_ID$1 = "im-qqbot-bind-panel-styles";
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$1) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; min-height: 320px; text-align: center; font-size: 14px;
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; opacity: 0.75; line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 13px; opacity: 0.85; color: var(--dsw-alias-brand, #4d6bfe); text-decoration: none; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { border-radius: 10px; background: #fff; padding: 10px; max-width: 100%; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.imqb-btn, .imqb-pill {
  font: inherit; cursor: pointer; color: inherit;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;
}
.imqb-btn:disabled, .imqb-pill:disabled { opacity: 0.5; cursor: default; }
.imqb-btn {
  padding: 7px 18px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: transparent;
}
.imqb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand, #4d6bfe); color: #fff; font-weight: 500;
}
.imqb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-strong, #3b5cf0); }
.imqb-btn--danger { color: var(--dsw-alias-danger, #f26d6d); border-color: var(--dsw-alias-danger, rgba(242, 109, 109, 0.5)); }
.imqb-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-danger, rgba(242, 109, 109, 0.12)); }
.imqb-ghost {
  border: none; background: transparent; opacity: 0.65; padding: 4px 8px;
  font: inherit; font-size: 13px; cursor: pointer; color: inherit;
}
.imqb-ghost:hover { opacity: 1; text-decoration: underline; }
/* 插件详情「设置」按钮：30px，略高于旁边的 sm 次要按钮 */
.imqb-pluginOpen {
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box; height: 30px; padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit); font: inherit;
  font-size: 13px; line-height: 20px; cursor: pointer;
}
.imqb-pluginOpen:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-pluginOpen:focus-visible { outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 3px; }
@media (pointer: coarse) { .imqb-pluginOpen { height: 44px; } }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary, #1f2329);
}
.imqb-pluginPageContent { max-width: 1080px; margin: 0 auto; }
.imqb-pill {
  padding: 5px 16px; border-radius: 999px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)); background: transparent;
}
.imqb-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn:focus-visible, .imqb-pill:focus-visible, .imqb-input:focus-visible, .imqb-ghost:focus-visible {
  outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 1px;
}
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-input {
  padding: 8px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: var(--dsw-alias-bg-input, rgba(128, 128, 128, 0.08));
  color: inherit; font: inherit; font-size: 13px; outline: none;
}
.imqb-input:focus { border-color: var(--dsw-alias-brand, #4d6bfe); }
.imqb-error { margin: 0; font-size: 12px; color: var(--dsw-alias-danger, #f26d6d); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: 10px; background: #fff; padding: 10px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; opacity: 0.75; line-height: 1.6; }
    `;
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
		* 新相位（如解绑后的 waiting 二维码）。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "saving" ? 500 : phase === "bound" ? 3e4 : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
						if (res.status === 404) {
							if (!stopped && !sawRoute) setGone(true);
							else if (alive()) schedule(Date.now() < urgentUntil ? 1e3 : 3e3);
							return;
						}
						if (!res.ok) {
							if (alive()) schedule(RETRY_POLL_MS);
							return;
						}
						sawRoute = true;
						const body = await res.json();
						if (!alive()) return;
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch {} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, []);
			return {
				state,
				gone,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const res = await fetch(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				const body = await res.json().catch(() => ({}));
				if (res.ok && body.ok) return {
					ok: true,
					message: body.message
				};
				return {
					ok: false,
					error: body.error ?? `保存失败（HTTP ${res.status}）`
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示），提交成功后展示保存结果；
		* 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
		*/
		function ManualForm({ initialAppId }) {
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setBusy(true);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy
			]);
			if (result !== null && result.ok) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载；稍后即可开始对话"))));
			return (0, react.createElement)("form", {
				className: "imqb-form",
				onSubmit: submit
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)("input", {
				className: "imqb-input",
				value: appId,
				placeholder: "QQ 机器人 AppID",
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)("input", {
				className: "imqb-input",
				type: "password",
				value: appSecret,
				placeholder: initialAppId === void 0 ? "QQ 机器人 AppSecret" : "输入新的 AppSecret（不回显）",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password"
			})), result !== null && !result.ok ? (0, react.createElement)("p", { className: "imqb-error" }, result.error) : null, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				type: "submit",
				disabled: busy
			}, busy ? "正在保存…" : "保存"));
		}
		/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
		const QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
		/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
		function QqBotIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-qqicon"
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "#0085FF"
			}));
		}
		/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
		function BoundView({ appId, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const unbind = (0, react.useCallback)(() => {
				if (!window.confirm("确定解绑吗？\n解绑后机器人立即下线，插件将重新进入扫码绑定流程。")) return;
				fetch(BIND_UNBIND_PATH, { method: "POST" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? `解绑失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, [recheck]);
			if (unbindResult !== null) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, unbindResult.ok ? "👋" : "⚠️"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), unbindResult.ok ? (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: recheck
			}, "刷新状态") : (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setUnbindResult(null);
				}
			}, "返回")));
			if (editing) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "更换凭据")), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setEditing(false);
				}
			}, "返回")), (0, react.createElement)(ManualForm, { initialAppId: appId }));
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "已绑定"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId} · 私聊与群聊已接入`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--danger",
				onClick: unbind
			}, "解绑")));
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state }) {
			const [mode, setMode] = (0, react.useState)("qr");
			const refresh = (0, react.useCallback)(() => {
				fetch(BIND_REFRESH_PATH, { method: "POST" }).catch(() => {});
			}, []);
			if (mode === "manual") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "手动填写凭据"), (0, react.createElement)(ManualForm, {}), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setMode("qr");
				}
			}, "改用扫码绑定"));
			return (0, react.createElement)("div", { className: "imqb-panel" }, state.qrSvg === void 0 ? null : (0, react.createElement)("img", {
				src: state.qrSvg,
				alt: "QQ 扫码二维码",
				width: 220,
				height: 220,
				className: "imqb-qr"
			}), (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "使用手机 QQ 扫描二维码完成绑定"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "二维码显示异常？在浏览器中打开"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: refresh
			}, "刷新二维码"), (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写")));
		}
		/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
		function BindPanelBody(props) {
			usePanelStyles();
			const injected = props?.state !== void 0;
			const internal = useBindState(!injected);
			const state = injected ? props.state : internal.state;
			const gone = injected ? props.gone ?? false : internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const [lastQr, setLastQr] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (state === null) return;
				if (state.phase === "waiting") {
					if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
				} else if (state.phase === "bound") setLastQr(null);
			}, [state]);
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"));
			if (state === null || state.phase === "starting") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-hint" }, "正在获取绑定状态…"));
			if (state.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在连接机器人，稍候…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，插件正在重载，稍后即可开始对话"))));
			}
			if (state.phase === "failed") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, state.reason), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					window.location.reload();
				}
			}, "重试")));
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				appId: state.appId,
				recheck
			});
			return (0, react.createElement)(UnboundView, { state });
		}
		//#endregion
		//#region src/shared/tool-catalog.ts
		const GROUP_PLUGIN = "插件内置";
		const GROUP_OTHER = "其他";
		const TOOL_CATALOG = [
			{
				name: "qqbot_solve",
				label: "做题（答案+过程）",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_describe_image",
				label: "看图 / OCR / 读图表",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_send_file",
				label: "把本地文件发给用户",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_translate",
				label: "翻译",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_summarize",
				label: "长文总结",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_explain",
				label: "讲解概念 / 代码 / 报错",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_rewrite",
				label: "改写 / 润色",
				group: GROUP_PLUGIN
			},
			{
				name: "qqbot_analyze_persona",
				label: "分析群友人格（按群聊记录）",
				group: GROUP_PLUGIN
			}
		];
		[...TOOL_CATALOG.map((entry) => entry.name)];
		/** 清单里的全部工具名（稳定顺序） */
		function catalogToolNames() {
			return TOOL_CATALOG.map((entry) => entry.name);
		}
		/** 是否是插件内置工具（客户端只展示这些候选） */
		function isPluginToolName(name) {
			return TOOL_CATALOG.some((entry) => entry.name === name.trim());
		}
		/**
		* 合并多个来源的工具名：按首次出现顺序去重。
		*
		* @param sources - 任意个名字数组（可含 undefined）
		*/
		function mergeToolNames(...sources) {
			const seen = /* @__PURE__ */ new Set();
			const result = [];
			for (const source of sources) for (const raw of source ?? []) {
				const name = raw.trim();
				if (name === "" || seen.has(name)) continue;
				seen.add(name);
				result.push(name);
			}
			return result;
		}
		/**
		* 按分组整理候选工具（清单外的名字归入「其他」）。
		*
		* @param names - 合并后的工具名列表
		* @returns 分组标题 + 该组工具（空组不出现）
		*/
		function groupToolNames(names) {
			const catalog = new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]));
			const buckets = /* @__PURE__ */ new Map();
			for (const raw of names) {
				const name = raw.trim();
				if (name === "") continue;
				const entry = catalog.get(name);
				const group = entry?.group ?? "其他";
				const row = {
					name,
					label: entry?.label ?? "自定义工具"
				};
				const bucket = buckets.get(group);
				if (bucket === void 0) buckets.set(group, [row]);
				else bucket.push(row);
			}
			return [...new Set(TOOL_CATALOG.map((entry) => entry.group)), GROUP_OTHER].filter((group) => buckets.has(group)).map((group) => ({
				group,
				tools: buckets.get(group) ?? []
			}));
		}
		/**
		* 预置风格。id 会写进配置（profile patch / 设置面板下拉），
		* 改名会导致旧配置回落 daily，所以 id 保持稳定，只调整 name/内容。
		*/
		const KAOMOJI_STYLES = [
			{
				id: "daily",
				name: "日常",
				description: "通用情绪，轻微点缀，适合大多数人格",
				groups: [
					{
						mood: "开心",
						items: [
							"(￣▽￣)",
							"(＾▽＾)",
							"(≧▽≦)",
							"(・∀・)"
						]
					},
					{
						mood: "害羞",
						items: ["(⁄ ⁄•⁄ω⁄•⁄ ⁄)", "(๑´ㅂ๑)"]
					},
					{
						mood: "无语",
						items: [
							"(・_・;)",
							"(￣ω￣;)",
							"(°ー°〃)"
						]
					},
					{
						mood: "低落",
						items: ["(´・ω・)", "(´-ω-)"]
					},
					{
						mood: "生气",
						items: ["(￣ヘ￣)", "(＞︿＜)"]
					}
				]
			},
			{
				id: "genki",
				name: "元气",
				description: "高频、外放，适合元气/活泼人格",
				groups: [
					{
						mood: "开心",
						items: [
							"(๑•̀ㅂ•́)و✧",
							"٩(๑>◡<๑)۶",
							"(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
							"(≧∇≦)ﾉ"
						]
					},
					{
						mood: "加油",
						items: [
							"(ง •̀_•́)ง",
							"(๑˃̵ᴗ˂̵)و",
							"o(*≧▽≦)ツ"
						]
					},
					{
						mood: "得意",
						items: ["✧*｡٩(ˊᗜˋ*)و✧*｡", "(๑•̀ㅁ•́๑)✧"]
					},
					{
						mood: "兴奋",
						items: [
							"ヽ(≧Д≦)ノ",
							"(☝︎ ՞ਊ ՞)☝︎",
							"ヽ(•‿•)ノ"
						]
					}
				]
			},
			{
				id: "chuuni",
				name: "中二",
				description: "带设定感与戏剧性，适合中二人格",
				groups: [
					{
						mood: "得意",
						items: [
							"(￣▽￣)ゞ",
							"(￣^￣)ゞ",
							"ヽ(•̀ω•́ )ゝ"
						]
					},
					{
						mood: "高冷",
						items: [
							"(￣ー￣)",
							"(¬_¬)",
							"┌(┌ ^o^)┐"
						]
					},
					{
						mood: "震惊",
						items: [
							"(╯°□°）╯︵ ┻━┻",
							"┬─┬ノ( º _ ºノ)",
							"(；￣Д￣)"
						]
					},
					{
						mood: "嘴硬",
						items: ["( ｀ー´)ノ", "(￣ω￣;)"]
					}
				]
			},
			{
				id: "cat",
				name: "猫系",
				description: "猫耳/猫爪感，适合猫娘及萌系人格",
				groups: [
					{
						mood: "开心",
						items: [
							"ฅ^•ﻌ•^ฅ",
							"(=^･ω･^=)",
							"(^・ω・^ )"
						]
					},
					{
						mood: "撒娇",
						items: [
							"ฅ( ̳• ·̫ • ̳ฅ)",
							"(=^ ◡ ^=)",
							"(ΦωΦ)"
						]
					},
					{
						mood: "生气",
						items: ["(=｀ω´=)", "(^=◕ᴥ◕=^)"]
					},
					{
						mood: "困倦",
						items: [
							"(^-ω-^=)",
							"(=①ω①=)",
							"(=ω=)"
						]
					}
				]
			},
			{
				id: "tsundere",
				name: "傲娇",
				description: "嘴硬、别扭，适合傲娇/小恶魔人格",
				groups: [
					{
						mood: "嘴硬",
						items: [
							"(￣^￣)",
							"(￣3￣)",
							"(｀Д´*)",
							"(¬_¬)"
						]
					},
					{
						mood: "害羞",
						items: [
							"(￣▽￣)",
							"(⁄ ⁄•⁄ω⁄•⁄ ⁄)",
							"(￣ω￣;)"
						]
					},
					{
						mood: "生气",
						items: [
							"(￣ヘ￣)",
							"(＞︿＜)",
							"(ー_ーゞ"
						]
					},
					{
						mood: "委屈",
						items: ["(｡•́︿•̀｡)", "(￣﹏￣)"]
					}
				]
			},
			{
				id: "soft",
				name: "温柔",
				description: "柔和、体贴，适合温柔/大姐姐人格",
				groups: [
					{
						mood: "开心",
						items: [
							"(´｡• ᵕ •｡)",
							"(◍•ᴗ•◍)",
							"( ˶ˆᗜˆ˵ )"
						]
					},
					{
						mood: "暖心",
						items: [
							"(｡･ω･｡)ﾉ♡",
							"(灬º‿º灬)♡",
							"(∩˃o˂∩)♡",
							"( ˘ ³˘)♥"
						]
					},
					{
						mood: "害羞",
						items: ["(⁄ ⁄•⁄ω⁄•⁄ ⁄)", "(๑•́ ₃ •̀๑)"]
					},
					{
						mood: "鼓励",
						items: ["(｡•̀ᴗ-)✧", "(๑˘︶˘๑)"]
					}
				]
			},
			{
				id: "cool",
				name: "清冷",
				description: "克制、少用，适合清冷/学姐人格",
				groups: [
					{
						mood: "冷淡",
						items: [
							"(￣ー￣)",
							"(￣.￣)",
							"(・_・)",
							"(¬‿¬)"
						]
					},
					{
						mood: "无奈",
						items: [
							"(￣Д￣)",
							"(ー_ー)",
							"(・＿・)"
						]
					},
					{
						mood: "轻微",
						items: ["(￣ω￣)"]
					}
				]
			},
			{
				id: "maid",
				name: "女仆",
				description: "恭敬、细腻，适合女仆/侍从人格",
				groups: [
					{
						mood: "恭敬",
						items: [
							"(๑• . •๑)",
							"(*^▽^*)",
							"(｡･ω･｡)ﾉ"
						]
					},
					{
						mood: "害羞",
						items: [
							"(,,>﹏<,,)",
							"(⁄ ⁄•⁄ω⁄•⁄ ⁄)",
							"(๑ˊ͈ ॢꇴ ˋ͈)"
						]
					},
					{
						mood: "开心",
						items: [
							"(◕‿◕✿)",
							"(ノ*°▽°*)",
							"(๑¯ω¯๑)"
						]
					}
				]
			}
		];
		/** 按 id 查找风格（去空白、未知返回 undefined） */
		function findKaomojiStyle(id) {
			const trimmed = id?.trim();
			if (!trimmed) return void 0;
			return KAOMOJI_STYLES.find((style) => style.id === trimmed);
		}
		//#endregion
		//#region src/voice/voice-presets.ts
		/**
		* Qwen-Audio-TTS 系统音色预设
		*
		* 数据来源：阿里云百炼「Qwen-Audio-TTS 音色列表」；每个 id 都在真实账号上
		* 实测合成成功过（2026-10 / 2026-11）。
		*
		* 音色 id 与模型**代际**强绑定：3.1 的音色全部带 `_v3.1` 后缀，3.0 的旧 id
		* 不能跨代使用（会报 InvalidParameter / Engine error [411]）。flash 支持全部
		* 系统音色；plus 只有 4 个旗舰音色（见各 preset 的 models）以及声音复刻/
		* 设计的专属 id。面板下拉会把当前模型不支持的音色标注成「需 xxx 模型」，
		* 避免选完才发现合成失败。
		*/
		/** 当前默认（推荐）语音模型：3.1-flash（低延迟，支持全部系统音色） */
		const VOICE_PRESET_MODEL = "qwen-audio-3.1-tts-flash";
		/** 3.1 高音质模型（只支持 4 个旗舰系统音色 + 复刻/设计音色） */
		const VOICE_PRESET_MODEL_PLUS = "qwen-audio-3.1-tts-plus";
		/** 上一代模型（仍可使用：已有 3.0 克隆音色的配置切过来会失效，所以保留兼容） */
		const VOICE_PRESET_MODEL_30_FLASH = "qwen-audio-3.0-tts-flash";
		const VOICE_PRESET_MODEL_30_PLUS = "qwen-audio-3.0-tts-plus";
		/** 缺省语音模型（3.1-flash） */
		const DEFAULT_VOICE_MODEL = VOICE_PRESET_MODEL;
		/** 缺省音色（3.1-flash 默认音色，同时也是 3.1-plus 的旗舰音色之一） */
		const DEFAULT_VOICE_ID = "longanfengyue_v3.1";
		/**
		* 面板可选的语音模型清单（按推荐顺序排列）。
		*
		* 只收录已在真实账号上验证过的 Qwen-Audio-TTS 模型；其他 MaaS 模型（如
		* cosyvoice-v2）没有对应的音色清单，面板里走「其他模型 id」手动输入，
		* 音色只能靠「自定义音色」添加。
		*/
		const VOICE_MODELS = [
			{
				id: VOICE_PRESET_MODEL,
				label: "Qwen-Audio 3.1 TTS Flash",
				help: "低延迟，支持全部 26 个系统音色与 3.1 复刻/设计音色（缺省推荐）。",
				generation: "3.1",
				recommended: true
			},
			{
				id: VOICE_PRESET_MODEL_PLUS,
				label: "Qwen-Audio 3.1 TTS Plus",
				help: "高音质，只支持 4 个旗舰系统音色（longanfengyue_v3.1 / longanlingxin_v3.1 / longanhuan_v3.1 / xunanchuan_v3.1）与 3.1 复刻/设计音色。",
				generation: "3.1"
			},
			{
				id: VOICE_PRESET_MODEL_30_FLASH,
				label: "Qwen-Audio 3.0 TTS Flash（旧版）",
				help: "兼容旧配置：12 个 3.0 系统音色与 3.0 克隆/设计音色（3.0 音色不能用在 3.1 上）。",
				generation: "3.0"
			},
			{
				id: VOICE_PRESET_MODEL_30_PLUS,
				label: "Qwen-Audio 3.0 TTS Plus（旧版）",
				help: "兼容旧配置：只支持 longanlingxi / longanhuan_v3.6 两个系统音色与 3.0 克隆/设计音色。",
				generation: "3.0"
			}
		];
		/** 3.1 旗舰音色：flash 与 plus 都支持 */
		const FLAGSHIP_31 = [VOICE_PRESET_MODEL, VOICE_PRESET_MODEL_PLUS];
		/** 3.1 其余系统音色：仅 flash 支持 */
		const FLASH_ONLY_31 = [VOICE_PRESET_MODEL];
		const FLASH_30 = [VOICE_PRESET_MODEL_30_FLASH];
		const PLUS_30 = [VOICE_PRESET_MODEL_30_FLASH, VOICE_PRESET_MODEL_30_PLUS];
		const VOICE_PRESETS = [
			{
				id: "longanfengyue_v3.1",
				name: "龙安风悦",
				trait: "自然亲切音",
				gender: "女",
				models: FLAGSHIP_31,
				generation: "3.1"
			},
			{
				id: "longanlingxin_v3.1",
				name: "龙安灵心",
				gender: "女",
				models: FLAGSHIP_31,
				generation: "3.1"
			},
			{
				id: "longanhuan_v3.1",
				name: "龙安欢",
				gender: "女",
				models: FLAGSHIP_31,
				generation: "3.1"
			},
			{
				id: "xunanchuan_v3.1",
				name: "许南川",
				gender: "男",
				models: FLAGSHIP_31,
				generation: "3.1"
			},
			{
				id: "longanyuanfei_v3.1",
				name: "龙安元妃",
				trait: "高傲妃子音",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longanlingxi_v3.1",
				name: "龙安灵希",
				trait: "可爱甜美音",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longjielidou_v3.1",
				name: "龙杰力豆",
				trait: "天真男童音",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longhuohuo_v3.1",
				name: "龙火火",
				trait: "顽皮少年音",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longpaopao_v3.1",
				name: "龙泡泡",
				trait: "飞天泡泡音",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longhua_v3.1",
				name: "龙华",
				trait: "元气甜美女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longwan_v3.1",
				name: "龙婉",
				trait: "细腻柔声女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longxing_v3.1",
				name: "龙星",
				trait: "温婉邻家女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longyue_v3.1",
				name: "龙悦",
				trait: "温暖、磁性",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longyan_v3.1",
				name: "龙颜",
				trait: "温暖、自然、亲切",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longyuan_v3.1",
				name: "龙媛",
				trait: "温暖治愈女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longmiao_v3.1",
				name: "龙妙",
				trait: "抑扬顿挫女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longhan_v3.1",
				name: "龙寒",
				trait: "温暖痴情男",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longanyang_v3.1",
				name: "龙安洋",
				trait: "阳光大男孩",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longanzhi_v3.1",
				name: "龙安智",
				trait: "睿智轻熟男",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longzhe_v3.1",
				name: "龙哲",
				trait: "呆板大暖男",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "loongbella_v3.1",
				name: "Bella",
				trait: "干练、磁性、知性",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "loongstella_v3.1",
				name: "Stella",
				trait: "飒爽利落女",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longxiaobai_v3.1",
				name: "龙小白",
				trait: "磁性、质感",
				gender: "女",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longshu_v3.1",
				name: "龙书",
				trait: "沉稳、磁性",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longcheng_v3.1",
				name: "龙橙",
				trait: "智慧、磁性",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longtian_v3.1",
				name: "龙天",
				trait: "磁性、理智",
				gender: "男",
				models: FLASH_ONLY_31,
				generation: "3.1"
			},
			{
				id: "longanfengyue",
				name: "龙安风悦",
				trait: "自然亲切音",
				gender: "女",
				age: 30,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longanyuanfei",
				name: "龙安元妃",
				trait: "高傲妃子音",
				gender: "女",
				age: 30,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longanlingxi",
				name: "龙安灵希",
				trait: "可爱甜美音",
				gender: "女",
				age: 25,
				models: PLUS_30,
				generation: "3.0"
			},
			{
				id: "longanxiaoxin",
				name: "龙安小昕",
				trait: "亲切活泼音",
				gender: "女",
				age: 22,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longanhuan_v3.6",
				name: "龙安欢",
				gender: "女",
				age: 25,
				models: PLUS_30,
				generation: "3.0"
			},
			{
				id: "longjielidou_v3.6",
				name: "龙杰力豆",
				trait: "天真男童",
				gender: "男",
				age: 5,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longpaopao_v3.6",
				name: "龙泡泡",
				trait: "软糯可爱音",
				gender: "女",
				age: 5,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longhuohuo_v3.6",
				name: "龙火火",
				trait: "顽皮少年音",
				gender: "男",
				age: 8,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "longchuanshu_v3.6",
				name: "龙川叔",
				trait: "川普大叔音",
				gender: "男",
				age: 40,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "loongmary",
				name: "Loong Mary",
				trait: "温暖英音",
				gender: "女",
				age: 20,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "loongjohn",
				name: "Loong John",
				trait: "沉稳亲切美音",
				gender: "男",
				age: 28,
				models: FLASH_30,
				generation: "3.0"
			},
			{
				id: "loongeva_v3.6",
				name: "Loong Eva",
				trait: "高智美音",
				gender: "女",
				age: 28,
				models: FLASH_30,
				generation: "3.0"
			}
		];
		/** 3.1 → 3.0 的同名音色（仅用于内置音色跨代切换；复刻/设计 id 不在此列） */
		const PRESET_31_TO_30 = {
			"longanfengyue_v3.1": "longanfengyue",
			"longanyuanfei_v3.1": "longanyuanfei",
			"longanlingxi_v3.1": "longanlingxi",
			"longanhuan_v3.1": "longanhuan_v3.6",
			"longjielidou_v3.1": "longjielidou_v3.6",
			"longpaopao_v3.1": "longpaopao_v3.6",
			"longhuohuo_v3.1": "longhuohuo_v3.6"
		};
		/** 3.0 → 3.1 的同名音色（上表的反向映射） */
		const PRESET_30_TO_31 = Object.fromEntries(Object.entries(PRESET_31_TO_30).map(([current, legacy]) => [legacy, current]));
		/**
		* 该模型缺省用哪个音色。
		*
		* plus 只支持 4 个旗舰音色，取其中默认项；3.0 的默认音色与其旧的兼容清单一致，
		* 保证「只写了模型、没写音色」的配置也能合成成功。
		*/
		function defaultVoiceForModel(model) {
			const target = model?.trim() || "qwen-audio-3.1-tts-flash";
			if (target === "qwen-audio-3.1-tts-plus") return "longanlingxin_v3.1";
			if (target === "qwen-audio-3.1-tts-flash") return DEFAULT_VOICE_ID;
			if (target === "qwen-audio-3.0-tts-plus") return "longanlingxi";
			if (target === "qwen-audio-3.0-tts-flash") return "longanfengyue";
			return DEFAULT_VOICE_ID;
		}
		/**
		* 按模型代际修正音色 id（**只处理内置系统音色的同名映射**）。
		*
		* 场景：面板把缺省音色物化成 3.1 的 `..._v3.1`，用户却把模型改回了 3.0，
		* 或反过来。两代系统音色 id 不能混用，这里做同名映射；映射结果若不被目标
		* 模型支持（如 3.1-plus 只有 4 个旗舰音色），回落到该模型的缺省音色，
		* 避免合成必然失败。复刻/设计音色（`vd-...`、`qwen-audio-...-vd-...`）与
		* 没有同名对应的旧音色一律原样返回，不静默改成别的声线。空音色按模型取缺省值。
		*/
		function resolveVoicePresetForModel(id, model) {
			const target = id?.trim() ?? "";
			const modelId = model?.trim() || "qwen-audio-3.1-tts-flash";
			if (target === "") return defaultVoiceForModel(modelId);
			const mapped = modelId === "qwen-audio-3.1-tts-flash" || modelId === "qwen-audio-3.1-tts-plus" ? PRESET_30_TO_31[target] : modelId === "qwen-audio-3.0-tts-flash" || modelId === "qwen-audio-3.0-tts-plus" ? PRESET_31_TO_30[target] : void 0;
			if (mapped === void 0) return target;
			const preset = findVoicePreset(mapped);
			if (preset === void 0 || !preset.models.includes(modelId)) return defaultVoiceForModel(modelId);
			return mapped;
		}
		/** 按 id 查内置语音模型（不在清单里的模型返回 undefined） */
		function findVoiceModel(id) {
			const target = id?.trim() ?? "";
			if (target === "") return void 0;
			return VOICE_MODELS.find((model) => model.id === target);
		}
		/**
		* 面板「切换语音模型」时的音色联动：算出切到 `model` 后当前音色应该变成什么。
		*
		* 与 `resolveVoicePresetForModel` 的区别是这里处理**用户显式切换模型**：内置系统
		* 音色若在目标模型下不可用（如 3.1-plus 只有 4 个旗舰音色，或 3.1 独有的
		* `longwan_v3.1` 切回 3.0），回落到目标模型的缺省音色，避免切完模型必然合成失败。
		* 复刻/设计等未知 id 原样返回（需要用户在新代际下重新创建）；空音色仍返回空，
		* 面板里表示「按模型缺省」，不物化具体 id。
		*/
		function followVoiceModel(id, model) {
			const current = id?.trim() ?? "";
			if (current === "") return "";
			const modelId = model.trim() || "qwen-audio-3.1-tts-flash";
			if (findVoiceModel(modelId) === void 0) return current;
			const mapped = resolveVoicePresetForModel(current, modelId);
			const preset = findVoicePreset(mapped);
			if (preset === void 0) return mapped;
			return preset.models.includes(modelId) ? mapped : defaultVoiceForModel(modelId);
		}
		/** 按音色 id 查预设（用于展示友好名称） */
		function findVoicePreset(id) {
			const target = id?.trim() ?? "";
			if (target === "") return void 0;
			return VOICE_PRESETS.find((preset) => preset.id === target);
		}
		/** 下拉提示文案：龙安风悦（自然亲切音 · 女 · v3.1） */
		function formatVoicePresetLabel(preset) {
			const ageGender = `${preset.age === void 0 ? "" : `${preset.age}岁`}${preset.gender ?? ""}`;
			const details = [
				preset.trait,
				ageGender === "" ? void 0 : ageGender,
				`v${preset.generation}`
			].filter((part) => part !== void 0 && part !== "").join(" · ");
			return details === "" ? preset.name : `${preset.name}（${details}）`;
		}
		/**
		* 面板音色下拉：**用户自定义音色在最上，内置系统音色在其后**。
		*
		* 内置音色不再按模型直接过滤掉（否则 plus 模型下只剩自定义项，用户会以为
		* 没有系统音色）：当前模型不支持的项仍列出来，但带上 `requiresModel`，
		* 面板显示「需 xxx 模型」并提示把语音模型一起改掉。
		* 未知模型（如 cosyvoice-v2）没有可确认的兼容矩阵，返回空清单，只保留自定义音色。
		*/
		function buildVoiceOptions(custom, model) {
			const options = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of custom ?? []) {
				const id = (entry?.voice ?? "").trim();
				if (id === "" || seen.has(id)) continue;
				seen.add(id);
				const name = (entry?.name ?? "").trim() || id;
				options.push({
					value: id,
					label: `${name}（自定义）`
				});
			}
			const target = model?.trim() || "qwen-audio-3.1-tts-flash";
			if (!VOICE_PRESETS.some((preset) => preset.models.includes(target))) return options;
			for (const preset of VOICE_PRESETS) {
				if (seen.has(preset.id)) continue;
				seen.add(preset.id);
				const supported = preset.models.includes(target);
				options.push({
					value: preset.id,
					label: formatVoicePresetLabel(preset),
					...supported ? {} : { requiresModel: preset.models[0] ?? "qwen-audio-3.1-tts-flash" }
				});
			}
			return options;
		}
		/** 按 id 取下拉里的展示文案（找不到就用 id 本身，自定义与内置都覆盖） */
		function voiceOptionLabel(options, id) {
			const target = id?.trim() ?? "";
			if (target === "") return "";
			return options.find((option) => option.value === target)?.label ?? target;
		}
		//#endregion
		//#region src/client/config-panel.ts
		/**
		* QQ 机器人配置面板 — 必要配置的 UI 编辑
		*
		* UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
		* 配置按「服务范围 / 身份与权限 / 群友人格 / 对话设置 / 语音回复 / 模型与提示词 / 人格预设」七个分区呈现；
		* 一次只渲染一个分区，避免单列过长；每个分区有未保存修改时 tab 显示小圆点。
		* 「群友人格」页签含自动分析开关与人格表格（可按昵称 / openid / 人格特点筛选）。
		* 另有一个不写入配置的「插件更新」页签：检查远端版本并执行一键更新。
		* 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
		* Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
		* 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
		* 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
		*
		* 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 字段策略：只开放用户必要的配置；cwd 只读展示；超时与性能调优
		* 类字段走 profile patch / 环境变量。
		*/
		/** 样式注入标记（幂等；版本变化时替换旧样式，避免客户端热更新后仍用旧样式） */
		const STYLE_ID = "im-qqbot-config-panel-styles";
		const STYLE_VERSION = "9";
		/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const existing = document.getElementById(STYLE_ID);
				if (existing !== null) {
					if (existing.getAttribute("data-version") === STYLE_VERSION) return;
					existing.remove();
				}
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.setAttribute("data-version", STYLE_VERSION);
				style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-hint-warn {
  margin: 4px 0 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-state-warning-primary, #b26b00);
}
/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */
.imqb2-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;
}
.imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.imqb2-switch:disabled { cursor: default; opacity: 0.5; }
.imqb2-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.imqb2-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: transform 120ms ease;
}
.imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
/* 输入（官方 fields.input 复刻） */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* 工具下拉（原生 select + 已选 chip） */
.imqb2-select { padding: 0 8px; cursor: pointer; }
.imqb2-select:disabled { cursor: default; }
.imqb2-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.imqb2-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 3px 8px; border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px; background: var(--dsw-alias-bg-layer-3);
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary);
  word-break: break-all;
}
.imqb2-chip-x {
  appearance: none; flex: none; border: 0; background: transparent; padding: 0 1px;
  font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}
.imqb2-chip-x:hover { color: var(--dsw-alias-label-primary); }
/* 分段控件（官方 SegmentedControl 复刻：指示器按段数/索引定位） */
.imqb2-seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-seg-indicator {
  position: absolute; top: 4px; left: 4px;
  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));
  height: calc(100% - 8px);
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}
.imqb2-seg-tab {
  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;
}
.imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-seg-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* 人格预设卡片（折叠抽屉：默认只显示标题，点击标题展开编辑） */
.imqb2-persona {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-persona-head { display: flex; align-items: center; gap: 8px; }
.imqb2-persona-toggle {
  appearance: none; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  border: 0; background: transparent; padding: 2px 0; cursor: pointer; font: inherit;
  text-align: left; color: inherit;
}
.imqb2-persona-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; border-radius: var(--dsw-radius-sm, 6px);
}
.imqb2-persona-arrow {
  flex: none; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}
.imqb2-persona-arrow[data-expanded='true'] { transform: rotate(90deg); }
.imqb2-persona-title {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.imqb2-persona-sub {
  flex: none; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.imqb2-persona-body { display: flex; flex-direction: column; gap: 8px; padding-left: 19px; }
.imqb2-persona-remove {
  appearance: none; border: 0; background: transparent; padding: 2px 6px;
  border-radius: var(--dsw-radius-sm, 6px); cursor: pointer; font: inherit;
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
}
.imqb2-persona-remove:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.imqb2-persona-add {
  appearance: none; align-self: flex-start; border: 0.5px solid var(--dsw-alias-border-l4);
  background: transparent; border-radius: var(--dsw-radius-md, 8px); padding: 5px 12px;
  font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.imqb2-persona-add:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* 自定义音色行（名称 + 音色 id + 删除） */
.imqb2-voice-row { display: flex; gap: 6px; align-items: center; }
.imqb2-voice-row .imqb2-input { min-width: 0; }
.imqb2-voice-name { flex: 0 0 140px; }
.imqb2-voice-id { flex: 1 1 auto; }
/* 分区 tab 栏（自动换行，选中态为浮起胶囊） */
.imqb2-tabs {
  display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; margin: 2px 0 4px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-tab {
  appearance: none; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; color: var(--dsw-alias-label-secondary); white-space: nowrap; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.imqb2-tab:hover, .imqb2-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-tab[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
}
.imqb2-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.imqb2-tab-dot {
  flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
.imqb2-tabpanel { display: flex; flex-direction: column; padding-top: 2px; }
/* 底栏（官方 SettingsForm.footer 复刻） */
.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
.imqb2-save {
  appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.imqb2-save:disabled { opacity: 0.4; cursor: default; }
.imqb2-save:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
/* 群友人格：筛选栏 + 表格 + 详情 */
.imqb2-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 10px; }
.imqb2-filter { flex: 1 1 140px; min-width: 120px; }
.imqb2-table-wrap { width: 100%; overflow-x: auto; padding-bottom: 4px; }
.imqb2-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; }
.imqb2-table th {
  padding: 6px 8px; text-align: left; white-space: nowrap; font-weight: 600;
  color: var(--dsw-alias-label-tertiary); border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-table td {
  padding: 7px 8px; vertical-align: top; color: var(--dsw-alias-label-primary);
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-table tr[data-expanded='true'] td { background: var(--dsw-alias-interactive-bg-hover); }
.imqb2-table-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.imqb2-table-name { font-weight: 500; white-space: nowrap; }
.imqb2-table-click {
  appearance: none; border: 0; background: transparent; padding: 0;
  font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap;
}
.imqb2-table-click:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.imqb2-table-meta { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.imqb2-chip--trait { font-size: 11px; padding: 2px 6px; }
.imqb2-chip--warn {
  border-color: var(--dsw-alias-state-warning-primary, #b26b00);
  color: var(--dsw-alias-state-warning-primary, #b26b00);
}
.imqb2-detail {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 0 4px;
  font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary);
}
.imqb2-capture {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 10px; margin-bottom: 8px; border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-capture-hint { flex-basis: 100%; margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
.imqb2-detail-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb2-detail-row { display: flex; gap: 6px; }
.imqb2-detail-key { flex: none; width: 76px; color: var(--dsw-alias-label-tertiary); }
.imqb2-empty { margin: 0; padding: 12px 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
    `;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
		}
		/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
		function Switch({ checked, label, onChange }) {
			return (0, react.createElement)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				className: "imqb2-switch",
				onClick: () => {
					onChange(!checked);
				}
			}, (0, react.createElement)("span", { className: "imqb2-switch-thumb" }));
		}
		/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
		function Segmented({ value, options, onChange, label }) {
			const index = Math.max(0, options.findIndex((o) => o.value === value));
			const trackStyle = {
				"--imqb2-seg-count": options.length,
				"--imqb2-seg-index": index
			};
			return (0, react.createElement)("div", {
				className: "imqb2-seg",
				role: "tablist",
				"aria-label": label,
				style: trackStyle
			}, (0, react.createElement)("span", { className: "imqb2-seg-indicator" }), options.map((o) => (0, react.createElement)("button", {
				key: o.value,
				type: "button",
				role: "tab",
				"aria-selected": o.value === value,
				className: "imqb2-seg-tab",
				onClick: () => {
					onChange(o.value);
				}
			}, o.label)));
		}
		/** 开关行（label 左 + Switch 右 + 可选 help） */
		function SwitchRow({ label, help, checked, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Switch, {
				checked,
				label,
				onChange
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-help" }, help));
		}
		/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
		function FieldRow({ label, help, value, placeholder, type, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("input", {
				className: "imqb2-input",
				value,
				placeholder,
				spellCheck: false,
				type: type ?? "text",
				autoComplete: "off",
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 毫秒时间戳 → 本地 MM-DD HH:mm（表格紧凑展示） */
		function formatShortTime(timestamp) {
			if (timestamp === void 0 || !Number.isFinite(timestamp)) return "—";
			const date = new Date(timestamp);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		/** 可信度中文 */
		function confidenceText(confidence) {
			return confidence === "high" ? "高" : confidence === "medium" ? "中" : confidence === "low" ? "低" : "未评估";
		}
		/** 特点 chips（最多展示 4 个，超出用 +N） */
		function traitChips(traits) {
			if (traits.length === 0) return (0, react.createElement)("span", { className: "imqb2-table-meta" }, "—");
			const shown = traits.slice(0, 4);
			return (0, react.createElement)("span", { className: "imqb2-chips" }, ...shown.map((trait) => (0, react.createElement)("span", {
				key: trait,
				className: "imqb2-chip imqb2-chip--trait"
			}, trait)), traits.length > shown.length ? (0, react.createElement)("span", { className: "imqb2-table-meta" }, `+${traits.length - shown.length}`) : null);
		}
		/** 会话分布文案（群聊只拿得到 openid，用短 id 区分） */
		function chatDistribution(profile) {
			if (profile.chats.length === 0) return "—";
			return profile.chats.filter((chat) => chat.messageCount > 0).slice(0, 4).map((chat) => `${chat.scope === "group" ? "群" : "私聊"} ${chat.peerId.slice(0, 8)} · ${chat.messageCount} 条`).join("；");
		}
		/**
		* 表格里的会话摘要（区分群聊 / 私聊）。
		*
		* 私聊与群聊下发的是同一个 openid（实测一致），所以同一个人的两处发言
		* 会落在一行里；这里把「几个群、几个私聊」直接标出来，避免只看到数字。
		*/
		function chatSummary(profile) {
			const groupCount = profile.chats.filter((chat) => chat.scope === "group").length;
			const c2cCount = profile.chats.filter((chat) => chat.scope === "c2c").length;
			const parts = [groupCount > 0 ? `群 ${groupCount}` : "", c2cCount > 0 ? `私聊 ${c2cCount}` : ""].filter((part) => part !== "");
			return parts.length > 0 ? parts.join(" · ") : String(profile.chatCount);
		}
		/**
		* 采集状态条（表格上方）：归档规模 + 平台实际下发的群事件类型。
		*
		* QQ 官方只向普通群机器人推送被 @ 的群消息，未 @ 的发言根本不会到达插件；
		* 这里把「只收到 @ 事件」直接标出来，用户不会误以为是自己配置漏记。
		*/
		function PersonaCaptureStatus({ stats }) {
			const events = Object.entries(stats.eventTypes).filter(([, count]) => count > 0).slice(0, 4).map(([type, count]) => `${type} ×${count}`);
			const parts = [
				`已归档 ${stats.messageCount} 条`,
				`${stats.memberCount} 位群友`,
				`${stats.chatCount} 个会话`,
				stats.lastArchivedAt !== void 0 ? `最近 ${formatShortTime(stats.lastArchivedAt)}` : ""
			].filter((part) => part !== "");
			return (0, react.createElement)("div", { className: "imqb2-capture" }, (0, react.createElement)("span", { className: "imqb2-table-meta" }, parts.join(" · ")), events.length > 0 ? (0, react.createElement)("span", { className: "imqb2-table-meta" }, `平台下发：${events.join("、")}`) : null, stats.groupFullMessages ? (0, react.createElement)("span", { className: "imqb2-chip imqb2-chip--trait" }, "全量群消息") : (0, react.createElement)("span", {
				className: "imqb2-chip imqb2-chip--warn",
				title: "平台只下发被 @ 机器人的群消息（GROUP_AT_MESSAGE_CREATE）"
			}, "仅 @ 消息"), (0, react.createElement)("p", { className: "imqb2-capture-hint" }, stats.groupFullMessages ? "机器人能收到群内全量消息（GROUP_MESSAGE_CREATE），群友未 @ 机器人的发言也会进档案。" : "当前平台只推送被 @ 机器人的群消息（GROUP_AT_MESSAGE_CREATE），群友未 @ 机器人的发言不会到达插件，所以档案里只有被 @ 时的那几条。开通私域 / 全量群消息权限后会自动收到 GROUP_MESSAGE_CREATE。"));
		}
		/** 一行卡的详情（展开后展示结构化分析结果） */
		function PersonaProfileDetail({ profile }) {
			const rows = [
				{
					key: "分析状态",
					value: profile.analyzedAt === void 0 ? profile.pending ? "累计发言已达阈值，等待自动分析（也可在群里让机器人手动分析）" : "尚未分析（发言达到阈值后会自动生成）" : `${formatShortTime(profile.analyzedAt)} · 覆盖 ${profile.analyzedMessageCount ?? 0} 条 · 可信度 ${confidenceText(profile.confidence)}`
				},
				...profile.provider !== void 0 ? [{
					key: "分析模型",
					value: `${profile.provider} / ${profile.model ?? ""}`
				}] : [],
				{
					key: "说话风格",
					value: profile.style ?? "—"
				},
				{
					key: "口头禅",
					value: profile.catchphrases.length > 0 ? profile.catchphrases.join("；") : "—"
				},
				{
					key: "兴趣",
					value: profile.interests.length > 0 ? profile.interests.join("；") : "—"
				},
				{
					key: "群内角色",
					value: profile.role ?? "—"
				},
				{
					key: "相处建议",
					value: profile.advice ?? "—"
				},
				{
					key: "会话分布",
					value: chatDistribution(profile)
				},
				{
					key: "openid",
					value: (0, react.createElement)("span", { className: "imqb2-table-mono" }, profile.senderId)
				},
				...profile.lastError !== void 0 ? [{
					key: "上次失败",
					value: (0, react.createElement)("span", { className: "imqb2-hint-warn" }, profile.lastError)
				}] : []
			];
			return (0, react.createElement)("div", { className: "imqb2-detail" }, ...rows.map((row) => (0, react.createElement)("div", {
				key: row.key,
				className: "imqb2-detail-row"
			}, (0, react.createElement)("span", { className: "imqb2-detail-key" }, row.key), (0, react.createElement)("span", {}, row.value))));
		}
		/**
		* 群友人格表格（设置面板「群友人格」页签）。
		*
		* 数据来自 `GET /qqbot/im-qqbot/personas`，筛选在服务端完成（名称 / openid /
		* 人格特点），300ms 防抖；点一行展开结构化分析结果。
		*/
		function PersonaProfilesTable({ archived }) {
			const [name, setName] = (0, react.useState)("");
			const [openid, setOpenid] = (0, react.useState)("");
			const [trait, setTrait] = (0, react.useState)("");
			const [query, setQuery] = (0, react.useState)({
				name: "",
				openid: "",
				trait: ""
			});
			const [profiles, setProfiles] = (0, react.useState)([]);
			const [archiveStats, setArchiveStats] = (0, react.useState)(null);
			const [total, setTotal] = (0, react.useState)(0);
			const [loading, setLoading] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [refreshKey, setRefreshKey] = (0, react.useState)(0);
			const [expanded, setExpanded] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const timer = setTimeout(() => {
					setQuery({
						name,
						openid,
						trait
					});
				}, 300);
				return () => {
					clearTimeout(timer);
				};
			}, [
				name,
				openid,
				trait
			]);
			(0, react.useEffect)(() => {
				let stopped = false;
				const params = new URLSearchParams();
				if (query.name.trim() !== "") params.set("name", query.name.trim());
				if (query.openid.trim() !== "") params.set("openid", query.openid.trim());
				if (query.trait.trim() !== "") params.set("trait", query.trait.trim());
				setLoading(true);
				setError(null);
				fetch(`${BIND_PERSONAS_PATH}?${params.toString()}`, { cache: "no-store" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (stopped) return;
					if (body.ok !== true) {
						setProfiles([]);
						setTotal(0);
						setError(body.error ?? `读取人格档案失败（HTTP ${res.status}）`);
						return;
					}
					setProfiles(Array.isArray(body.profiles) ? body.profiles : []);
					setTotal(typeof body.total === "number" ? body.total : 0);
					setArchiveStats(body.archive ?? null);
				}).catch((err) => {
					if (!stopped) setError(err instanceof Error ? err.message : String(err));
				}).finally(() => {
					if (!stopped) setLoading(false);
				});
				return () => {
					stopped = true;
				};
			}, [
				query.name,
				query.openid,
				query.trait,
				refreshKey,
				archived
			]);
			const filterInput = (label, value, onChange) => (0, react.createElement)("input", {
				className: "imqb2-input imqb2-filter",
				value,
				placeholder: label,
				"aria-label": label,
				spellCheck: false,
				autoComplete: "off",
				onChange: (event) => {
					onChange(event.currentTarget.value);
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") event.preventDefault();
				}
			});
			const header = (0, react.createElement)("tr", {}, (0, react.createElement)("th", {}, "昵称"), (0, react.createElement)("th", {}, "openid"), (0, react.createElement)("th", {}, "会话"), (0, react.createElement)("th", {}, "消息"), (0, react.createElement)("th", {}, "人格特点"), (0, react.createElement)("th", {}, "一句话印象"), (0, react.createElement)("th", {}, "最近发言"));
			const rows = profiles.map((profile) => {
				const isOpen = expanded === profile.senderId;
				const trimmedName = profile.senderName?.trim() ?? "";
				const displayName = trimmedName !== "" ? trimmedName : `${profile.senderId.slice(0, 8)}…`;
				return (0, react.createElement)("tbody", { key: profile.senderId }, (0, react.createElement)("tr", { "data-expanded": isOpen }, (0, react.createElement)("td", {}, (0, react.createElement)("button", {
					type: "button",
					className: "imqb2-table-click",
					onClick: () => {
						setExpanded(isOpen ? null : profile.senderId);
					}
				}, displayName)), (0, react.createElement)("td", {}, (0, react.createElement)("span", {
					className: "imqb2-table-mono",
					title: profile.senderId
				}, `${profile.senderId.slice(0, 8)}…`)), (0, react.createElement)("td", {
					className: "imqb2-table-meta",
					title: chatDistribution(profile)
				}, chatSummary(profile)), (0, react.createElement)("td", {}, (0, react.createElement)("span", { className: "imqb2-table-meta" }, `${profile.messageCount} 条` + (profile.analyzedMessageCount !== void 0 && profile.analyzedMessageCount > 0 ? ` · 分析 ${profile.analyzedMessageCount}` : "")), profile.pending ? (0, react.createElement)("span", {
					className: "imqb2-chip imqb2-chip--warn",
					title: "累计发言已达到自动分析阈值"
				}, "待分析") : null), (0, react.createElement)("td", {}, traitChips(profile.traits)), (0, react.createElement)("td", {}, profile.summary ?? (0, react.createElement)("span", { className: "imqb2-table-meta" }, "—")), (0, react.createElement)("td", { className: "imqb2-table-meta" }, formatShortTime(profile.lastAt))), isOpen ? (0, react.createElement)("tr", {}, (0, react.createElement)("td", { colSpan: 7 }, (0, react.createElement)(PersonaProfileDetail, { profile }))) : null);
			});
			return (0, react.createElement)("div", { className: "imqb2-table-wrap" }, (0, react.createElement)("div", {
				className: "imqb2-head",
				style: { paddingBottom: "4px" }
			}, (0, react.createElement)("span", { className: "imqb2-label" }, "群友人格档案"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-persona-add",
				onClick: () => {
					setRefreshKey((key) => key + 1);
				}
			}, loading ? "刷新中…" : "刷新")), archiveStats !== null ? (0, react.createElement)(PersonaCaptureStatus, { stats: archiveStats }) : null, (0, react.createElement)("div", { className: "imqb2-filters" }, filterInput("按昵称筛选", name, setName), filterInput("按 openid 筛选", openid, setOpenid), filterInput("按人格特点筛选（如 慢热 / 毒舌）", trait, setTrait)), error !== null ? (0, react.createElement)("p", { className: "imqb2-empty" }, `人格档案读取失败：${error}`) : profiles.length === 0 ? (0, react.createElement)("p", { className: "imqb2-empty" }, loading ? "正在读取人格档案…" : archived ? "还没有匹配的人格档案。群友累计发言达到阈值后会自动分析（也可在群里 @机器人 说「分析一下某某的性格」）。" : "请先打开上方「群聊人格档案」。") : (0, react.createElement)("table", { className: "imqb2-table" }, (0, react.createElement)("thead", {}, header), ...rows), profiles.length > 0 ? (0, react.createElement)("p", { className: "imqb2-empty" }, `共 ${total} 位群友${total > profiles.length ? `（当前展示 ${profiles.length} 位）` : ""}；同一 openid 在多个群/私聊的发言会合并成一份档案。`) : null);
		}
		/** 不在候选项里的历史音色值的占位（不可重新选中，只用于回显） */
		const CURRENT_VOICE_OPTION = "__imqb2-current-voice__";
		/**
		* 音色下拉（原生 select，不允许手输）
		*
		* 候选项 = 自定义音色（置顶）+ 内置系统音色。当前模型不支持的预设也会列出来，
		* 但标注「需 xxx 模型」；选中这类音色时下面会出现警告，提醒先把「语音模型」改掉。
		* 旧配置里不在清单中的音色 id 会作为「当前音色」保留，避免一打开面板就被静默改掉。
		*/
		function VoiceSelectField({ label, value, placeholder, help, options, onChange }) {
			const current = value.trim();
			const known = options.some((option) => option.value === current);
			const mismatch = known ? options.find((option) => option.value === current)?.requiresModel : void 0;
			const unknown = current !== "" && !known && options.length > 0;
			const selectValue = known ? current : current === "" ? "" : CURRENT_VOICE_OPTION;
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("select", {
				className: "imqb2-input imqb2-select",
				value: selectValue,
				onChange: (event) => {
					const next = event.currentTarget.value;
					if (next === CURRENT_VOICE_OPTION) return;
					onChange(next);
				}
			}, (0, react.createElement)("option", { value: "" }, placeholder ?? "（留空，继承全局音色）"), current !== "" && !known ? (0, react.createElement)("option", { value: CURRENT_VOICE_OPTION }, `${current}（当前音色，不在列表中）`) : null, options.map((option) => (0, react.createElement)("option", {
				key: option.value,
				value: option.value
			}, option.requiresModel === void 0 ? option.label : `${option.label} · 需 ${option.requiresModel} 模型`))), mismatch === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint-warn" }, `当前音色只支持 ${mismatch}，与现用语音模型不匹配，合成会失败；请把「语音模型」改成 ${mismatch}。`), unknown ? (0, react.createElement)("p", { className: "imqb2-hint-warn" }, "当前音色不在内置清单中（多半是复刻/设计音色）：它绑定在创建时的账号与模型上，换代际后通常仍可合成，若失败请回到原代际模型，或在当前代际重新克隆。") : null, help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 不在候选里的历史模型占位（只用于回显，不可重新选中） */
		const CURRENT_MODEL_OPTION = "__imqb2-current-model__";
		/** 模型下拉里的「手动输入其他模型 id」项 */
		const MANUAL_MODEL_OPTION = "__imqb2-manual-model__";
		/**
		* 语音模型下拉（只列插件内置验证过的 Qwen 模型；其他模型走「其他模型 id」手动输入）
		*
		* 与「默认音色」联动：切换模型后由面板统一把内置同名音色改写到目标代际、
		* 目标模型不支持的内置音色回落到该模型缺省音色（见 applyVoiceModel）。
		*/
		function VoiceModelField({ value, help, onChange }) {
			const current = value.trim();
			const preset = findVoiceModel(current);
			const [manual, setManual] = (0, react.useState)(preset === void 0 && current !== "");
			const selectValue = manual ? MANUAL_MODEL_OPTION : preset === void 0 ? current === "" ? "" : CURRENT_MODEL_OPTION : current;
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, "语音模型"), (0, react.createElement)("select", {
				className: "imqb2-input imqb2-select",
				value: selectValue,
				onChange: (event) => {
					const next = event.currentTarget.value;
					if (next === CURRENT_MODEL_OPTION) return;
					if (next === MANUAL_MODEL_OPTION) {
						setManual(true);
						return;
					}
					setManual(false);
					onChange(next);
				}
			}, (0, react.createElement)("option", { value: "" }, `（留空，使用缺省 ${DEFAULT_VOICE_MODEL}）`), current !== "" && preset === void 0 ? (0, react.createElement)("option", { value: CURRENT_MODEL_OPTION }, `${current}（当前模型，不在列表中）`) : null, VOICE_MODELS.map((model) => (0, react.createElement)("option", {
				key: model.id,
				value: model.id
			}, model.recommended === true ? `${model.label}（推荐）` : model.label)), (0, react.createElement)("option", { value: MANUAL_MODEL_OPTION }, "其他模型 id（手动输入）")), manual ? (0, react.createElement)("input", {
				className: "imqb2-input",
				value: current,
				placeholder: "自定义模型 id（如 cosyvoice-v2）",
				spellCheck: false,
				autoComplete: "off",
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}) : null, manual ? (0, react.createElement)("p", { className: "imqb2-hint" }, "内置音色清单只覆盖 Qwen-Audio-TTS；其他模型的音色请在「自定义音色」里手动添加。") : preset === void 0 ? (0, react.createElement)("p", { className: "imqb2-hint" }, current === "" ? `留空时使用缺省模型 ${DEFAULT_VOICE_MODEL}。` : "当前模型不在内置清单里：只能使用「自定义音色」，内置系统音色不会列出。") : (0, react.createElement)("p", { className: "imqb2-hint" }, preset.help), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/**
		* 自定义音色编辑器：用户自己填「名称 + 音色 id」。
		*
		* 新增行插到数组头部，因此下拉里最新添加的音色排在最上面（在系统预设之前）。
		*/
		function VoicePresetListField({ value, onChange }) {
			const updateRow = (index, next) => {
				onChange(value.map((row, i) => i === index ? {
					...row,
					...next
				} : row));
			};
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, "自定义音色"), value.length === 0 ? (0, react.createElement)("p", { className: "imqb2-hint" }, "还没有自定义音色。点击下方按钮新增，填名称 + 音色 id；新增项会排在音色下拉的最上方。") : value.map((row, index) => (0, react.createElement)("div", {
				key: `voice-preset-${index}`,
				className: "imqb2-voice-row"
			}, (0, react.createElement)("input", {
				className: "imqb2-input imqb2-voice-name",
				value: row.name ?? "",
				placeholder: "名称（如 元气少女）",
				spellCheck: false,
				autoComplete: "off",
				onChange: (event) => {
					updateRow(index, { name: event.currentTarget.value });
				}
			}), (0, react.createElement)("input", {
				className: "imqb2-input imqb2-voice-id",
				value: row.voice ?? "",
				placeholder: "音色 id（如 longanfengyue_v3.1 或克隆音色 id）",
				spellCheck: false,
				autoComplete: "off",
				onChange: (event) => {
					updateRow(index, { voice: event.currentTarget.value });
				}
			}), (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-chip-x",
				"aria-label": `删除音色 ${(row.name ?? "").trim() || index + 1}`,
				title: "删除这个音色",
				onClick: () => {
					onChange(value.filter((_, i) => i !== index));
				}
			}, "×"))), (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-persona-add",
				onClick: () => {
					onChange([{
						name: "",
						voice: ""
					}, ...value]);
				}
			}, "＋ 添加音色"), (0, react.createElement)("p", { className: "imqb2-hint" }, "这里填的是你自己的声音复刻 / 声音设计音色 id（绑定在创建它的账号上；旧代际的音色在 3.1 模型下通常也能用，但官方未承诺），下拉里排在内置系统音色之前；留空的音色 id 保存时会被丢弃。"));
		}
		/** 多行文本行 */
		function AreaRow({ label, help, value, rows, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("textarea", {
				className: "imqb2-input imqb2-textarea",
				value,
				rows: rows ?? 3,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Segmented, {
				value,
				options,
				onChange,
				label
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/**
		* 人格工具下拉：已选工具以 chip 展示，下拉只列还没选中的候选。
		*
		* 候选 = 宿主运行时工具 ∪ 内置常用清单 ∪ 当前已配置的名字，
		* 所以清空后还能从下拉里把同一个工具加回来。
		*/
		function ToolPicker({ selected, available, onChange }) {
			const chosen = selected.map((name) => name.trim()).filter(Boolean);
			const groups = groupToolNames(available.filter((name) => !chosen.includes(name)));
			return (0, react.createElement)("div", {
				className: "imqb2-field",
				style: {
					padding: "4px 0 0",
					borderTop: 0
				}
			}, chosen.length === 0 ? (0, react.createElement)("p", { className: "imqb2-hint" }, "还没选任何工具：留空 = 该人格没有任何工具能力。") : (0, react.createElement)("div", { className: "imqb2-chips" }, chosen.map((name) => (0, react.createElement)("span", {
				key: name,
				className: "imqb2-chip"
			}, name, (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-chip-x",
				"aria-label": `移除 ${name}`,
				title: `移除 ${name}`,
				onClick: () => {
					onChange(chosen.filter((item) => item !== name));
				}
			}, "×")))), (0, react.createElement)("select", {
				className: "imqb2-input imqb2-select",
				"aria-label": "添加工具",
				value: "",
				onChange: (event) => {
					const name = event.currentTarget.value;
					if (name !== "") onChange([...chosen, name]);
				}
			}, (0, react.createElement)("option", { value: "" }, groups.length === 0 ? "已选完全部可用工具" : "＋ 选择要允许的工具…"), groups.map(({ group, tools }) => (0, react.createElement)("optgroup", {
				key: group,
				label: group
			}, tools.map((tool) => (0, react.createElement)("option", {
				key: tool.name,
				value: tool.name
			}, `${tool.label}（${tool.name}）`))))));
		}
		/**
		* 单个人格预设编辑卡片（抽屉式：默认收起，点击标题展开 id / 名称 / prompt）
		*
		* 收起态只占一行，人格多时面板不会被撑得过长。
		*/
		function PersonaCard({ index, value, expanded, available, voiceOptions, onChange, onToggle, onRemove }) {
			const title = value.name.trim() || value.id.trim() || `人格 ${index + 1}`;
			const kaomojiEnabled = value.expressions?.kaomoji?.enabled === true;
			const kaomojiStyle = kaomojiEnabled ? value.expressions?.kaomoji?.style?.trim() || "daily" : "";
			const voiceId = value.expressions?.voice?.voice?.trim() ?? "";
			const voiceLabel = voiceOptionLabel(voiceOptions, voiceId);
			const subtitle = [
				value.id.trim(),
				value.tools === void 0 ? void 0 : `工具 ${value.tools.filter((t) => t.trim()).length}`,
				kaomojiEnabled ? `颜文字·${findKaomojiStyle(kaomojiStyle)?.name ?? kaomojiStyle}` : void 0,
				voiceId !== "" ? `语音·${voiceLabel}` : void 0,
				(value.expressions?.voice?.instruction ?? "").trim() !== "" ? "情感指令" : void 0
			].filter((part) => part !== void 0).join(" · ");
			const updatePersonaVoice = (next) => {
				const { voice: _removedVoice, ...restExpressions } = value.expressions ?? {};
				const merged = {
					...value.expressions?.voice,
					...next
				};
				const nextVoice = {};
				if ((merged.voice ?? "").trim() !== "") nextVoice.voice = merged.voice;
				if (merged.rate !== void 0) nextVoice.rate = merged.rate;
				if (merged.volume !== void 0) nextVoice.volume = merged.volume;
				const instruction = (merged.instruction ?? "").trim();
				if (instruction !== "") nextVoice.instruction = instruction;
				const expressions = Object.keys(nextVoice).length > 0 ? {
					...restExpressions,
					voice: nextVoice
				} : restExpressions;
				onChange({ expressions: Object.keys(expressions).length > 0 ? expressions : void 0 });
			};
			return (0, react.createElement)("div", { className: "imqb2-persona" }, (0, react.createElement)("div", { className: "imqb2-persona-head" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-persona-toggle",
				"aria-expanded": expanded,
				title: expanded ? "收起" : "展开编辑",
				onClick: onToggle
			}, (0, react.createElement)("span", {
				className: "imqb2-persona-arrow",
				"data-expanded": expanded
			}, "▶"), (0, react.createElement)("span", { className: "imqb2-persona-title" }, title), (0, react.createElement)("span", { className: "imqb2-persona-sub" }, subtitle)), (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-persona-remove",
				onClick: onRemove
			}, "删除")), expanded ? (0, react.createElement)("div", { className: "imqb2-persona-body" }, (0, react.createElement)("input", {
				className: "imqb2-input",
				value: value.id,
				spellCheck: false,
				placeholder: "id（字母/数字/-/_，QQ 端 /persona <id> 用）",
				onChange: (event) => {
					onChange({ id: event.currentTarget.value });
				}
			}), (0, react.createElement)("input", {
				className: "imqb2-input",
				value: value.name,
				spellCheck: false,
				placeholder: "展示名称（QQ 菜单里显示）",
				onChange: (event) => {
					onChange({ name: event.currentTarget.value });
				}
			}), (0, react.createElement)("textarea", {
				className: "imqb2-input imqb2-textarea",
				value: value.prompt,
				rows: 5,
				placeholder: "该人格的 system prompt（只写角色设定/说话风格）",
				onChange: (event) => {
					onChange({ prompt: event.currentTarget.value });
				}
			}), (0, react.createElement)("div", {
				className: "imqb2-field",
				style: {
					padding: "8px 0 4px",
					borderTop: 0
				}
			}, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "颜文字"), (0, react.createElement)(Switch, {
				checked: kaomojiEnabled,
				label: "颜文字",
				onChange: (checked) => {
					if (!checked) {
						const { kaomoji: _kaomoji, ...rest } = value.expressions ?? {};
						onChange({ expressions: Object.keys(rest).length > 0 ? rest : void 0 });
						return;
					}
					const current = value.expressions?.kaomoji;
					onChange({ expressions: {
						...value.expressions,
						kaomoji: {
							...current,
							enabled: true,
							style: current?.style?.trim() || "daily"
						}
					} });
				}
			})), kaomojiEnabled ? (0, react.createElement)("div", {
				className: "imqb2-head",
				style: { marginTop: "6px" }
			}, (0, react.createElement)("span", { className: "imqb2-label" }, "风格"), (0, react.createElement)("select", {
				className: "imqb2-input imqb2-select",
				style: {
					width: "auto",
					minWidth: "160px"
				},
				"aria-label": "颜文字风格",
				value: kaomojiStyle || "daily",
				onChange: (event) => {
					const style = event.currentTarget.value;
					const current = value.expressions?.kaomoji;
					onChange({ expressions: {
						...value.expressions,
						kaomoji: {
							...current,
							enabled: true,
							style
						}
					} });
				}
			}, KAOMOJI_STYLES.map((style) => (0, react.createElement)("option", {
				key: style.id,
				value: style.id
			}, `${style.name}（${style.id}）`)))) : null, (0, react.createElement)("p", { className: "imqb2-hint" }, "开启后把该风格的颜文字清单写进 system prompt，模型按语境自然使用（默认一条回复最多 1 个），不需要工具调用。")), (0, react.createElement)(VoiceSelectField, {
				label: "语音音色",
				value: value.expressions?.voice?.voice ?? "",
				placeholder: "（留空，继承全局音色）",
				options: voiceOptions,
				help: "从下拉里选内置系统音色或自定义音色；留空继承全局音色。标了「需 xxx 模型」的音色与当前语音模型不匹配，需要先把全局「语音模型」改过去。",
				onChange: (nextVoiceId) => {
					updatePersonaVoice({ voice: nextVoiceId });
				}
			}), (0, react.createElement)(FieldRow, {
				label: "语音情感/语气（可选）",
				value: value.expressions?.voice?.instruction ?? "",
				placeholder: "如：用清冷、克制的语气，语速稍慢",
				help: "自然语言指令，合成时随请求下发；留空继承全局「情感/语气指令」。qwen-audio-3.1/3.0-tts-plus/flash 支持。",
				onChange: (next) => {
					updatePersonaVoice({ instruction: next });
				}
			}), (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "限制可用工具"), (0, react.createElement)(Switch, {
				checked: value.tools !== void 0,
				label: "限制可用工具",
				onChange: (checked) => {
					onChange({ tools: checked ? [] : void 0 });
				}
			})), value.tools === void 0 ? (0, react.createElement)("p", { className: "imqb2-hint" }, "关闭时使用默认放行清单（插件内置工具 + 只读联网/提问）；开启后模型只能看到下面选中的工具（硬约束，不是提示词）。") : (0, react.createElement)(ToolPicker, {
				selected: value.tools,
				available,
				onChange: (next) => {
					onChange({ tools: next });
				}
			}), (0, react.createElement)("p", { className: "imqb2-hint" }, "候选只有 QQ 插件内置工具（做题 / 看图 / 发文件 / 翻译 / 总结 / 讲解 / 改写）；文件读写、命令执行等宿主能力默认不开放。")) : null);
		}
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "disabled",
				label: "禁用"
			}
		];
		const SPLIT_OPTIONS = [
			{
				value: "none",
				label: "按长度"
			},
			{
				value: "delimiter",
				label: "约定分隔符"
			},
			{
				value: "line",
				label: "每个换行"
			},
			{
				value: "paragraph",
				label: "按空行"
			}
		];
		const TABS = [
			{
				id: "access",
				label: "服务范围",
				keys: ["access"]
			},
			{
				id: "identity",
				label: "身份与权限",
				keys: ["identity"]
			},
			{
				id: "members",
				label: "群友人格",
				keys: ["personaAnalysis"]
			},
			{
				id: "conversation",
				label: "对话设置",
				keys: [
					"requireMention",
					"streaming",
					"replySplitMode",
					"replySplitIntervalMs",
					"showToolResults"
				]
			},
			{
				id: "voice",
				label: "语音回复",
				keys: ["voice"]
			},
			{
				id: "model",
				label: "模型与提示词",
				keys: [
					"provider",
					"model",
					"preset",
					"globalPrompt"
				]
			},
			{
				id: "personas",
				label: "人格预设",
				keys: ["personas", "defaultPersona"]
			},
			{
				id: "update",
				label: "插件更新",
				keys: []
			}
		];
		/** 安装方式的中文说明 */
		function updateKindLabel(kind) {
			switch (kind) {
				case "git": return "Git 安装";
				case "npm": return "npm 安装";
				case "local": return "本地路径安装";
				default: return "未知安装方式";
			}
		}
		/** commit 缩写（非 commit 的引用原样返回） */
		function shortHash(ref) {
			return /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
		}
		/** 深比较（表单值与初始回显值的 dirty 判断） */
		function shallowEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/**
		* 配置面板主体。
		*
		* 保存仅提交变更键（服务端按白名单合并），保存成功后提示
		* HMR 重载语义（进行中的机器人会话将重置）。
		*/
		function ConfigPanel(props) {
			useConfigPanelStyles();
			const [initial, setInitial] = (0, react.useState)(null);
			const [form, setForm] = (0, react.useState)(null);
			const [discoveredTools, setDiscoveredTools] = (0, react.useState)([]);
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [expandedPersonas, setExpandedPersonas] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [activeTab, setActiveTab] = (0, react.useState)("access");
			const [updateInfo, setUpdateInfo] = (0, react.useState)(null);
			const [updateCheck, setUpdateCheck] = (0, react.useState)(null);
			const [updateBusy, setUpdateBusy] = (0, react.useState)(null);
			const [updateError, setUpdateError] = (0, react.useState)(null);
			const [updateNotice, setUpdateNotice] = (0, react.useState)(null);
			const [confirmUpdate, setConfirmUpdate] = (0, react.useState)(false);
			const bindPhase = props?.bindPhase;
			(0, react.useEffect)(() => {
				let stopped = false;
				fetch(BIND_CONFIG_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const body = await res.json();
					if (stopped) return;
					setInitial(body.config);
					setForm(body.config);
					setDiscoveredTools(Array.isArray(body.tools) ? body.tools : []);
				}).catch((err) => {
					if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					stopped = true;
				};
			}, [bindPhase]);
			(0, react.useEffect)(() => {
				if (activeTab !== "update" || updateInfo !== null) return;
				let stopped = false;
				fetch(BIND_UPDATE_PATH, { cache: "no-store" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (stopped) return;
					if (body.install !== void 0) setUpdateInfo(body.install);
					else if (res.status === 404) setUpdateError("插件服务端仍在跑旧代码（找不到更新接口）。请完全退出并重启 DSH（不是只关窗口）后重试。");
					else setUpdateError(body.error ?? `读取安装信息失败（HTTP ${res.status}）`);
				}).catch((err) => {
					if (!stopped) setUpdateError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					stopped = true;
				};
			}, [activeTab, updateInfo]);
			const patch = (0, react.useCallback)((key, value) => {
				setForm((current) => current === null ? current : {
					...current,
					[key]: value
				});
				setResult(null);
			}, []);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy || initial === null || form === null) return;
				const changed = {};
				for (const key of Object.keys(form)) if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
				if (Object.keys(changed).length === 0) return;
				if (changed.access !== void 0) {
					const a = changed.access;
					changed.access = {
						...a,
						c2cAllow: a.c2cAllow.map((s) => s.trim()).filter(Boolean),
						groupAllow: a.groupAllow.map((s) => s.trim()).filter(Boolean)
					};
				}
				if (changed.identity !== void 0) {
					const i = changed.identity;
					const clean = (list) => list.map((s) => s.trim()).filter(Boolean);
					changed.identity = {
						enabled: i.enabled !== false,
						ownerOpenIds: clean(i.ownerOpenIds),
						adminOpenIds: clean(i.adminOpenIds),
						friendOpenIds: clean(i.friendOpenIds)
					};
				}
				if (changed.personas !== void 0) changed.personas = changed.personas.map((p) => ({
					id: p.id.trim(),
					name: p.name.trim(),
					prompt: p.prompt,
					...p.tools !== void 0 ? { tools: [...new Set(p.tools.map((t) => t.trim()).filter(Boolean))] } : {},
					...p.expressions !== void 0 ? { expressions: p.expressions } : {}
				}));
				if (changed.defaultPersona !== void 0) changed.defaultPersona = String(changed.defaultPersona).trim();
				if (changed.voice !== void 0) {
					const { hasApiKey: _hasApiKey, ...rest } = changed.voice;
					const maxChars = Math.round(Number(rest.maxChars));
					const timeoutMs = Math.round(Number(rest.timeoutMs));
					const presets = (rest.presets ?? []).map((entry) => ({
						name: (entry.name ?? "").trim(),
						voice: (entry.voice ?? "").trim()
					})).filter((entry) => entry.voice !== "");
					changed.voice = {
						...rest,
						apiKey: (rest.apiKey ?? "").trim(),
						instruction: (rest.instruction ?? "").trim(),
						presets,
						maxChars: Number.isFinite(maxChars) ? Math.min(1e3, Math.max(20, maxChars)) : 300,
						timeoutMs: Number.isFinite(timeoutMs) ? Math.min(12e4, Math.max(5e3, timeoutMs)) : 3e4
					};
				}
				if (changed.personaAnalysis !== void 0) {
					const p = changed.personaAnalysis;
					const maxMessages = Math.round(Number(p.maxMessages));
					const retentionDays = Math.round(Number(p.retentionDays));
					const autoAnalyzeThreshold = Math.round(Number(p.autoAnalyzeThreshold));
					changed.personaAnalysis = {
						enabled: p.enabled !== false,
						maxMessages: Number.isFinite(maxMessages) ? Math.min(1e3, Math.max(20, maxMessages)) : 300,
						retentionDays: Number.isFinite(retentionDays) ? Math.min(365, Math.max(1, retentionDays)) : 30,
						autoAnalyze: p.autoAnalyze !== false,
						autoAnalyzeThreshold: Number.isFinite(autoAnalyzeThreshold) ? Math.min(200, Math.max(5, autoAnalyzeThreshold)) : 20
					};
				}
				setBusy(true);
				fetch(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(changed)
				}).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setResult({
							ok: true,
							message: body.message ?? "配置已保存，插件将自动重载"
						});
						let nextForm = form;
						if (changed.voice !== void 0) {
							const submitted = changed.voice;
							const hasKey = submitted.clearApiKey === true ? false : (submitted.apiKey ?? "").trim() !== "" || form.voice?.hasApiKey === true;
							nextForm = {
								...form,
								voice: {
									...form.voice,
									apiKey: "",
									clearApiKey: false,
									hasApiKey: hasKey
								}
							};
							setForm(nextForm);
						}
						setInitial(nextForm);
						return;
					}
					setResult({
						ok: false,
						message: body.error ?? `保存失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [
				busy,
				form,
				initial
			]);
			const runUpdateAction = (0, react.useCallback)((action) => {
				setUpdateBusy(action);
				setUpdateError(null);
				setUpdateNotice(null);
				fetch(BIND_UPDATE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ action })
				}).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (body.install !== void 0) setUpdateInfo(body.install);
					if (body.check !== void 0) setUpdateCheck(body.check);
					if (body.ok === true) {
						if (action === "update") {
							setUpdateNotice(body.message ?? "更新完成");
							setConfirmUpdate(false);
							setUpdateCheck(null);
						}
						return;
					}
					setUpdateError(body.error ?? `操作失败（HTTP ${res.status}）`);
				}).catch((err) => {
					setUpdateError(err instanceof Error ? err.message : String(err));
				}).finally(() => {
					setUpdateBusy(null);
				});
			}, []);
			if (loadError !== null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, `配置加载失败：${loadError}`);
			if (initial === null || form === null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, "正在加载配置…");
			const changedKeys = Object.keys(form).filter((key) => !shallowEqual(form[key], initial[key]));
			const dirty = changedKeys.length > 0;
			const access = form.access ?? {
				c2cMode: "allowlist",
				c2cAllow: [],
				groupMode: "open",
				groupAllow: []
			};
			const identity = form.identity ?? {
				enabled: true,
				ownerOpenIds: [],
				adminOpenIds: [],
				friendOpenIds: []
			};
			const personaAnalysis = form.personaAnalysis ?? {
				enabled: true,
				maxMessages: 300,
				retentionDays: 30,
				autoAnalyze: true,
				autoAnalyzeThreshold: 20
			};
			const personas = form.personas ?? [];
			const voice = form.voice ?? {};
			const voiceOptions = buildVoiceOptions(voice.presets, voice.model);
			const customPresetCount = (voice.presets ?? []).filter((entry) => (entry.voice ?? "").trim() !== "").length;
			const toolCandidates = mergeToolNames(discoveredTools.filter((name) => isPluginToolName(name)), catalogToolNames(), ...personas.map((persona) => (persona.tools ?? []).filter((name) => isPluginToolName(name))));
			const updatePersona = (index, next) => {
				const list = [...form.personas ?? []];
				const current = list[index];
				if (current === void 0) return;
				list[index] = {
					...current,
					...next
				};
				patch("personas", list);
				if (next.id !== void 0 && current.id !== "" && form.defaultPersona === current.id) patch("defaultPersona", next.id);
			};
			const togglePersona = (index) => {
				setExpandedPersonas((current) => {
					const next = new Set(current);
					if (next.has(index)) next.delete(index);
					else next.add(index);
					return next;
				});
			};
			const addPersona = () => {
				const list = form.personas ?? [];
				const used = new Set(list.map((p) => p.id));
				let n = list.length + 1;
				while (used.has(`persona-${n}`)) n += 1;
				patch("personas", [...list, {
					id: `persona-${n}`,
					name: `人格 ${n}`,
					prompt: ""
				}]);
				setExpandedPersonas((current) => new Set(current).add(list.length));
			};
			const removePersona = (index) => {
				const list = (form.personas ?? []).filter((_, i) => i !== index);
				const removedId = form.personas?.[index]?.id;
				patch("personas", list);
				setExpandedPersonas((current) => {
					const next = /* @__PURE__ */ new Set();
					for (const i of current) {
						if (i === index) continue;
						next.add(i > index ? i - 1 : i);
					}
					return next;
				});
				if (removedId !== void 0 && removedId !== "" && form.defaultPersona === removedId) patch("defaultPersona", "");
			};
			/**
			* 切换语音模型并与音色联动。
			*
			* - 全局默认音色：内置同名音色按代际改写；目标模型不支持的内置音色回落到该模型
			*   的缺省音色；空音色保持空（表示按模型缺省），克隆/设计等未知 id 原样保留。
			* - 各人格的覆盖音色：同样按目标模型修正，避免人格里还留着上一代的 id。
			* - preferredVoiceId：用户刚在「默认音色」下拉里选中的 id（它属于目标模型），不再改写。
			*/
			const applyVoiceModel = (nextModel, preferredVoiceId) => {
				const nextVoiceId = preferredVoiceId !== void 0 ? preferredVoiceId : voice.voice === void 0 ? void 0 : followVoiceModel(voice.voice, nextModel);
				patch("voice", {
					...voice,
					model: nextModel,
					...nextVoiceId === void 0 ? {} : { voice: nextVoiceId }
				});
				const list = form.personas ?? [];
				let personasChanged = false;
				const nextPersonas = list.map((persona) => {
					const currentId = persona.expressions?.voice?.voice;
					if (currentId === void 0 || currentId.trim() === "") return persona;
					const mapped = followVoiceModel(currentId, nextModel);
					if (mapped === currentId) return persona;
					personasChanged = true;
					return {
						...persona,
						expressions: {
							...persona.expressions,
							voice: {
								...persona.expressions?.voice,
								voice: mapped
							}
						}
					};
				});
				if (personasChanged) patch("personas", nextPersonas);
			};
			const tabDirty = (tab) => tab.keys.some((key) => changedKeys.includes(key));
			const accessPanel = [
				(0, react.createElement)(SegmentedRow, {
					label: "私聊",
					value: access.c2cMode,
					options: MODE_OPTIONS,
					onChange: (v) => {
						patch("access", {
							...access,
							c2cMode: v
						});
					}
				}),
				access.c2cMode === "allowlist" ? (0, react.createElement)(AreaRow, {
					label: "私聊白名单",
					help: "请输入用户 openid，多个请换行输入",
					rows: 3,
					value: access.c2cAllow.join("\n"),
					onChange: (v) => {
						patch("access", {
							...access,
							c2cAllow: v.split("\n").map((s) => s.trim())
						});
					}
				}) : null,
				(0, react.createElement)(SegmentedRow, {
					label: "群聊",
					value: access.groupMode,
					options: MODE_OPTIONS,
					onChange: (v) => {
						patch("access", {
							...access,
							groupMode: v
						});
					}
				}),
				access.groupMode === "allowlist" ? (0, react.createElement)(AreaRow, {
					label: "群聊白名单",
					help: "请输入群 openid，多个请换行输入",
					rows: 3,
					value: access.groupAllow.join("\n"),
					onChange: (v) => {
						patch("access", {
							...access,
							groupAllow: v.split("\n").map((s) => s.trim())
						});
					}
				}) : null,
				(0, react.createElement)("p", {
					className: "imqb2-hint",
					style: { padding: "8px 0 0" }
				}, "openid 可在 QQ 里对机器人发送 /whoami 查看；私聊与群聊是两套值。")
			];
			const identityPanel = [
				(0, react.createElement)(SwitchRow, {
					label: "身份识别",
					checked: identity.enabled,
					help: "按 openid 判定发送者身份，并在消息前注入 [身份: 主人 / 管理员 / 朋友 / 陌生人]；三份名单都为空时不注入，保持旧行为",
					onChange: (v) => {
						patch("identity", {
							...identity,
							enabled: v
						});
					}
				}),
				identity.enabled ? (0, react.createElement)("p", {
					className: "imqb2-hint",
					style: { padding: "0 0 8px" }
				}, "在 QQ 里对机器人发送 /whoami 可查看并复制自己的 openid。私聊（user_openid）与群聊（member_openid）是两套值，需要分别添加。") : null,
				identity.enabled ? (0, react.createElement)(AreaRow, {
					label: "主人 openid",
					rows: 2,
					help: "对应「身份: 主人」，人格里的专属称呼只对这些人生效；一行一个",
					value: identity.ownerOpenIds.join("\n"),
					onChange: (v) => {
						patch("identity", {
							...identity,
							ownerOpenIds: v.split("\n").map((s) => s.trim())
						});
					}
				}) : null,
				identity.enabled ? (0, react.createElement)(AreaRow, {
					label: "管理员 openid",
					rows: 2,
					help: "对应「身份: 管理员」，按熟人对待但不套用主人设定；一行一个",
					value: identity.adminOpenIds.join("\n"),
					onChange: (v) => {
						patch("identity", {
							...identity,
							adminOpenIds: v.split("\n").map((s) => s.trim())
						});
					}
				}) : null,
				identity.enabled ? (0, react.createElement)(AreaRow, {
					label: "朋友 openid",
					rows: 2,
					help: "对应「身份: 朋友」，其余未命中名单的人都是「陌生人」；一行一个",
					value: identity.friendOpenIds.join("\n"),
					onChange: (v) => {
						patch("identity", {
							...identity,
							friendOpenIds: v.split("\n").map((s) => s.trim())
						});
					}
				}) : null
			];
			const membersPanel = [
				(0, react.createElement)(SwitchRow, {
					label: "群聊人格档案",
					checked: personaAnalysis.enabled,
					help: "按会话滚动保存群聊/私聊消息（~/.dsh-qqbot/persona-archive.json），供人格分析总结群友的说话风格与性格；只存本机、不上传，关闭后不再记录新消息（已有档案保留）",
					onChange: (v) => {
						patch("personaAnalysis", {
							...personaAnalysis,
							enabled: v
						});
					}
				}),
				personaAnalysis.enabled ? (0, react.createElement)(FieldRow, {
					label: "每个会话最多保留条数",
					value: String(personaAnalysis.maxMessages),
					placeholder: "300",
					help: "超出后淘汰最旧的消息（20–1000）；条数越多，人格总结的依据越充分，档案文件也越大",
					onChange: (v) => {
						const n = Math.round(Number(v));
						patch("personaAnalysis", {
							...personaAnalysis,
							maxMessages: Number.isFinite(n) ? Math.min(1e3, Math.max(20, n)) : 300
						});
					}
				}) : null,
				personaAnalysis.enabled ? (0, react.createElement)(FieldRow, {
					label: "消息保留天数",
					value: String(personaAnalysis.retentionDays),
					placeholder: "30",
					help: "超过天数的记录会在启动与写入时清理（1–365）；删除档案文件可立即清空全部记录",
					onChange: (v) => {
						const n = Math.round(Number(v));
						patch("personaAnalysis", {
							...personaAnalysis,
							retentionDays: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 30
						});
					}
				}) : null,
				personaAnalysis.enabled ? (0, react.createElement)(SwitchRow, {
					label: "自动获取人格",
					checked: personaAnalysis.autoAnalyze,
					help: "某位群友累计发言达到阈值后自动生成人格档案；之后每新增同样条数再更新一次，失败会冷却 10 分钟。关闭后只能手动让机器人分析",
					onChange: (v) => {
						patch("personaAnalysis", {
							...personaAnalysis,
							autoAnalyze: v
						});
					}
				}) : null,
				personaAnalysis.enabled && personaAnalysis.autoAnalyze ? (0, react.createElement)(FieldRow, {
					label: "自动分析触发条数",
					value: String(personaAnalysis.autoAnalyzeThreshold),
					placeholder: "20",
					help: "累计发言达到这个条数就自动分析一次（5–200）；数值越小档案更新越频繁，模型调用也越多",
					onChange: (v) => {
						const n = Math.round(Number(v));
						patch("personaAnalysis", {
							...personaAnalysis,
							autoAnalyzeThreshold: Number.isFinite(n) ? Math.min(200, Math.max(5, n)) : 20
						});
					}
				}) : null,
				(0, react.createElement)("p", {
					className: "imqb2-hint",
					style: { padding: "0 0 8px" }
				}, "采集范围：QQ 官方只向普通群机器人推送被 @ 的群消息（GROUP_AT_MESSAGE_CREATE），群友没 @ 机器人的发言平台不会下发；开通私域 / 全量群消息权限后还会收到 GROUP_MESSAGE_CREATE，届时群内每条发言都会进档案。另外官方不提供任意群的历史消息，机器人未上线期间的消息无法补录。同一个 openid 在多个群/私聊的发言会合并成一份档案；表格可按昵称、openid、人格特点筛选，分析结果也可作为后续新增人格的参考。"),
				(0, react.createElement)(PersonaProfilesTable, { archived: personaAnalysis.enabled })
			];
			const conversationPanel = [
				(0, react.createElement)(SwitchRow, {
					label: "群聊仅回复 @机器人的消息",
					checked: form.requireMention ?? true,
					help: "开启后，机器人仅可回复 @机器人的群聊消息",
					onChange: (v) => {
						patch("requireMention", v);
					}
				}),
				(0, react.createElement)(SwitchRow, {
					label: "流式输出",
					checked: form.streaming ?? true,
					help: "回复内容分段实时推送到聊天（开启回复拆分时自动失效）",
					onChange: (v) => {
						patch("streaming", v);
					}
				}),
				(0, react.createElement)(SegmentedRow, {
					label: "回复拆分",
					value: form.replySplitMode ?? "none",
					options: SPLIT_OPTIONS,
					help: "推荐「约定分隔符」：模型输出固定分隔符 ||| 时拆条；只要出现分隔符，段内剩余换行也会拆（模型偶尔把分隔符敲成换行），没出现分隔符时换行不拆；开启后自动关闭流式输出",
					onChange: (v) => {
						patch("replySplitMode", v);
					}
				}),
				form.replySplitMode === "delimiter" ? (0, react.createElement)("p", {
					className: "imqb2-hint",
					style: { padding: "0 0 8px" }
				}, "分隔符固定为 |||（不可配置）；拆条规则写在「模型与提示词」的「全局提示词」里即可对整个机器人生效") : null,
				form.replySplitMode !== void 0 && form.replySplitMode !== "none" ? (0, react.createElement)(FieldRow, {
					label: "拆分间隔(ms)",
					value: String(form.replySplitIntervalMs ?? 0),
					placeholder: "0",
					help: "相邻消息之间的等待时间，0 表示顺序立即发送；遇到平台限流可调大",
					onChange: (v) => {
						const n = Math.max(0, Math.round(Number(v)));
						patch("replySplitIntervalMs", Number.isFinite(n) ? n : 0);
					}
				}) : null,
				(0, react.createElement)(SwitchRow, {
					label: "显示工具调用结果",
					checked: form.showToolResults ?? false,
					help: "在聊天中展示 agent 工具调用的结构化结果",
					onChange: (v) => {
						patch("showToolResults", v);
					}
				})
			];
			const voiceEnabled = voice.enabled !== false;
			const panels = {
				access: accessPanel,
				identity: identityPanel,
				members: membersPanel,
				conversation: conversationPanel,
				voice: [
					(0, react.createElement)(SwitchRow, {
						label: "启用语音回复",
						checked: voiceEnabled,
						help: "关闭后即使已保存 API Key 也不会注册 qqbot_voice 工具、不合成、不发语音；重新打开即可恢复，不需要清除 Key。",
						onChange: (v) => {
							patch("voice", {
								...voice,
								enabled: v
							});
						}
					}),
					(0, react.createElement)("p", {
						className: "imqb2-hint",
						style: { padding: "4px 0 8px" }
					}, voiceEnabled ? voice.hasApiKey === true ? "语音功能已启用：由模型判断这一轮要不要发语音。需要语音时会调用 qqbot_voice，本轮回复只发语音、不再重复发文字；合成失败或内容不适合朗读时退回文字。" : "语音开关已打开，但还没有填写 API Key：填写并保存后才会真正生效。" : "语音已关闭：即使已保存 API Key 也不会注册语音工具、不合成、不发语音，也不消耗额度；打开上方开关即可恢复。"),
					(0, react.createElement)(FieldRow, {
						label: "DashScope API Key",
						type: "password",
						value: voice.apiKey ?? "",
						placeholder: voice.hasApiKey === true ? "已保存（输入新 Key 可替换）" : "留空则不启用语音",
						help: "已保存的 Key 不会回显；留空提交表示保持现有 Key。要停用语音请用上方开关，不需要清除 Key。",
						onChange: (v) => {
							patch("voice", {
								...voice,
								apiKey: v
							});
						}
					}),
					voice.hasApiKey === true && (voice.apiKey ?? "").trim() === "" ? (0, react.createElement)("div", {
						className: "imqb2-field",
						style: {
							padding: "0 0 8px",
							borderTop: 0
						}
					}, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-hint" }, "已保存 API Key；语音是否生效由上方开关决定。"), (0, react.createElement)("button", {
						type: "button",
						className: "imqb2-persona-add",
						onClick: () => {
							patch("voice", {
								...voice,
								apiKey: "",
								clearApiKey: true,
								hasApiKey: false
							});
						}
					}, "清除已保存的 Key"))) : null,
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "模型与音色"),
					(0, react.createElement)(VoiceModelField, {
						value: voice.model ?? "",
						help: "当前只内置 Qwen-Audio-TTS 的 3.1 / 3.0 模型（其他模型走「其他模型 id」手动输入）。切换模型会自动修正内置系统音色：同名音色跨代改写（longanfengyue ↔ longanfengyue_v3.1），目标模型不支持的内置音色回落到该模型缺省音色；人格里的音色也会跟着改。克隆/设计音色不会自动改（面板无法判断其兼容性）；合成失败时日志会写明原因。",
						onChange: (v) => {
							applyVoiceModel(v);
						}
					}),
					(0, react.createElement)(VoiceSelectField, {
						label: "默认音色",
						value: voice.voice ?? "",
						placeholder: "（留空，使用缺省音色）",
						options: voiceOptions,
						help: voiceOptions.length > 0 ? `只能从下拉里选（自定义 ${customPresetCount} 个置顶，其后为内置系统音色）。音色与模型代际绑定：标了「需 xxx 模型」的项选中后会自动把上面的「语音模型」切过去。要新增复刻/设计音色，请在下方「自定义音色」里添加名称 + id。人格可在「人格预设」里覆盖。` : "当前模型没有可确认的内置音色清单：请在下方「自定义音色」里添加名称 + id，或把「语音模型」改回 Qwen-Audio 3.1 TTS Flash（3.0 旧模型也可）。",
						onChange: (v) => {
							const picked = voiceOptions.find((option) => option.value === v);
							if (picked?.requiresModel !== void 0) {
								applyVoiceModel(picked.requiresModel, v);
								return;
							}
							patch("voice", {
								...voice,
								voice: v
							});
						}
					}),
					(0, react.createElement)(VoicePresetListField, {
						value: voice.presets ?? [],
						onChange: (nextPresets) => {
							patch("voice", {
								...voice,
								presets: nextPresets
							});
						}
					}),
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "情感与语气"),
					(0, react.createElement)(AreaRow, {
						label: "情感/语气指令",
						rows: 4,
						help: "可写成「场景 + 逐句走向」，合成时随请求下发（≤400 字）。例：场景：夜里教学楼走廊，她叫住学长，紧张又鼓起勇气；第1句：很轻、迟疑；第2句：吞吐、有停顿；第3句：柔和带笑；第4句：转为坚定、加快一点。留空 = 模型默认语气；人格可在「人格预设」里单独覆盖。",
						value: voice.instruction ?? "",
						onChange: (v) => {
							patch("voice", {
								...voice,
								instruction: v
							});
						}
					}),
					(0, react.createElement)("p", { className: "imqb2-hint" }, "服务端还支持文本内情感标签（[excited] 兴奋、[sad] 悲伤、[serious] 严肃、[laughing] 笑声、[sighing] 叹息、[whispers] 耳语、[very slowly] 放慢…），但标签必须出现在待朗读文本里才生效，日常建议用上面的指令控制情感，必要时模型还可以在单轮调用里指定语气。"),
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "长度与超时"),
					(0, react.createElement)(FieldRow, {
						label: "单次朗读字数上限",
						value: String(voice.maxChars ?? 300),
						placeholder: "300",
						help: "超出后截断（20–1000）；QQ 语音不宜过长",
						onChange: (v) => {
							const n = Math.round(Number(v));
							patch("voice", {
								...voice,
								maxChars: Number.isFinite(n) ? Math.min(1e3, Math.max(20, n)) : 300
							});
						}
					}),
					(0, react.createElement)(FieldRow, {
						label: "合成超时(ms)",
						value: String(voice.timeoutMs ?? 3e4),
						placeholder: "30000",
						help: "超时后放弃语音、改为发送文字回复（5000–120000）",
						onChange: (v) => {
							const n = Math.round(Number(v));
							patch("voice", {
								...voice,
								timeoutMs: Number.isFinite(n) ? Math.min(12e4, Math.max(5e3, n)) : 3e4
							});
						}
					}),
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "网关"),
					(0, react.createElement)(FieldRow, {
						label: "WebSocket 地址",
						value: voice.baseUrl ?? "",
						placeholder: "留空使用 DashScope 官方网关",
						help: "自定义 MaaS 网关时填完整 wss:// 地址；留空则按 workspace 或官方网关连接",
						onChange: (v) => {
							patch("voice", {
								...voice,
								baseUrl: v
							});
						}
					}),
					(0, react.createElement)(FieldRow, {
						label: "业务空间 workspace",
						value: voice.workspace ?? "",
						placeholder: "留空使用官方共享网关",
						help: "百炼业务空间 id：用于拼接 MaaS 地址并在请求头携带 X-DashScope-WorkSpace",
						onChange: (v) => {
							patch("voice", {
								...voice,
								workspace: v
							});
						}
					}),
					(0, react.createElement)("p", {
						className: "imqb2-hint",
						style: { padding: "8px 0 0" }
					}, "语音走 DashScope 实时合成（需要 Node 22+ 内置 WebSocket）；合成失败时退回文字回复，消息不会丢。")
				],
				model: [
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "模型"),
					(0, react.createElement)(FieldRow, {
						label: "Provider",
						value: form.provider ?? "",
						placeholder: "留空继承宿主默认",
						onChange: (v) => {
							patch("provider", v);
						}
					}),
					(0, react.createElement)(FieldRow, {
						label: "Model",
						value: form.model ?? "",
						placeholder: "留空继承宿主默认",
						onChange: (v) => {
							patch("model", v);
						}
					}),
					(0, react.createElement)(FieldRow, {
						label: "Preset",
						value: form.preset ?? "",
						placeholder: "Agent preset id",
						onChange: (v) => {
							patch("preset", v);
						}
					}),
					form.cwd !== void 0 ? (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "Agent 工作目录"), (0, react.createElement)("span", { className: "imqb2-hint" }, "只读")), (0, react.createElement)("p", { className: "imqb2-readonly" }, form.cwd)) : null,
					(0, react.createElement)("div", { className: "imqb2-group-title" }, "全局提示词"),
					(0, react.createElement)(AreaRow, {
						label: "全局 system prompt",
						rows: 6,
						help: "对所有群聊/私聊生效。把「多条消息用固定分隔符 ||| 分隔」这类通用规则写在这里，人格里只写角色设定。",
						value: form.globalPrompt ?? "",
						onChange: (v) => {
							patch("globalPrompt", v);
						}
					})
				],
				personas: [
					(0, react.createElement)("p", {
						className: "imqb2-hint",
						style: { padding: "4px 0 8px" }
					}, "每个人格是一套角色 system prompt，叠加在全局提示词之上。点击标题展开编辑，配置后可在 QQ 聊天发送 /persona（或直接点击菜单）按会话切换；修改过但未保存的分区会在 tab 上显示小圆点。"),
					personas.length === 0 ? (0, react.createElement)("p", {
						className: "imqb2-hint",
						style: { padding: "4px 0 12px" }
					}, "尚未添加人格。添加并保存后，QQ 端 /persona 即可看到切换菜单。") : null,
					personas.map((persona, index) => (0, react.createElement)(PersonaCard, {
						key: `persona-${index}`,
						index,
						value: persona,
						expanded: expandedPersonas.has(index),
						available: toolCandidates,
						voiceOptions,
						onChange: (next) => {
							updatePersona(index, next);
						},
						onToggle: () => {
							togglePersona(index);
						},
						onRemove: () => {
							removePersona(index);
						}
					})),
					(0, react.createElement)("button", {
						type: "button",
						className: "imqb2-persona-add",
						onClick: addPersona
					}, "＋ 添加人格"),
					personas.length > 0 ? (0, react.createElement)(FieldRow, {
						label: "默认人格 id",
						value: form.defaultPersona ?? "",
						placeholder: "留空表示不启用人格",
						help: `可用 id: ${personas.map((p) => p.id).filter(Boolean).join(", ") || "（尚未填写）"}；留空则不启用人格`,
						onChange: (v) => {
							patch("defaultPersona", v);
						}
					}) : null
				],
				update: [
					(0, react.createElement)("p", {
						className: "imqb2-hint",
						style: { padding: "4px 0 8px" }
					}, "检查当前安装方式下远端是否有新版本。git 安装会对比远端最新 commit；更新后会重新解析依赖并自动重载插件，不需要卸载重装。"),
					updateError !== null ? (0, react.createElement)("p", { className: "imqb2-hint-warn" }, updateError) : null,
					(0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, "当前安装"), updateInfo === null ? (0, react.createElement)("p", { className: "imqb2-hint" }, "正在读取安装信息…") : (0, react.createElement)("div", null, (0, react.createElement)("p", { className: "imqb2-readonly" }, `${updateInfo.version} · ${updateKindLabel(updateInfo.kind)}`), updateInfo.installed !== "" ? (0, react.createElement)("p", { className: "imqb2-hint" }, `已安装引用：${updateInfo.kind === "git" ? shortHash(updateInfo.installed) : updateInfo.installed}`) : null, updateInfo.spec !== void 0 ? (0, react.createElement)("p", { className: "imqb2-hint" }, `依赖写法：${updateInfo.spec}`) : null, updateInfo.message !== void 0 ? (0, react.createElement)("p", { className: "imqb2-hint-warn" }, updateInfo.message) : null)),
					(0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, "版本检查"), updateCheck === null ? (0, react.createElement)("p", { className: "imqb2-hint" }, "点击「检查更新」对比远端最新版本；git 安装对比远端 commit，npm 安装对比 registry。") : (0, react.createElement)("div", null, (0, react.createElement)("p", { className: updateCheck.updateAvailable ? "imqb2-hint-warn" : "imqb2-hint" }, updateCheck.message), (0, react.createElement)("p", { className: "imqb2-hint" }, `检查时间：${new Date(updateCheck.checkedAt).toLocaleTimeString()}`)), (0, react.createElement)("div", { style: {
						display: "flex",
						flexWrap: "wrap",
						gap: "8px",
						marginTop: "8px"
					} }, (0, react.createElement)("button", {
						type: "button",
						className: "imqb2-save",
						disabled: updateBusy !== null || updateInfo === null,
						onClick: () => {
							runUpdateAction("check");
						}
					}, updateBusy === "check" ? "正在检查…" : "检查更新"), updateCheck?.updateAvailable === true && updateInfo !== null ? confirmUpdate ? [(0, react.createElement)("button", {
						key: "confirm",
						type: "button",
						className: "imqb2-save",
						disabled: updateBusy !== null,
						onClick: () => {
							runUpdateAction("update");
						}
					}, updateBusy === "update" ? "正在更新…" : "确认更新"), (0, react.createElement)("button", {
						key: "cancel",
						type: "button",
						className: "imqb2-tab",
						disabled: updateBusy !== null,
						onClick: () => {
							setConfirmUpdate(false);
						}
					}, "取消")] : (0, react.createElement)("button", {
						key: "start",
						type: "button",
						className: "imqb2-save",
						disabled: updateBusy !== null || !updateInfo.canUpdate,
						title: updateInfo.canUpdate ? "执行 pnpm update，完成后自动重载插件" : `当前宿主不支持一键更新，请手动执行：${updateInfo.command}`,
						onClick: () => {
							setConfirmUpdate(true);
						}
					}, "立即更新") : null), updateInfo !== null && !updateInfo.canUpdate && updateCheck?.updateAvailable === true ? (0, react.createElement)("p", { className: "imqb2-hint" }, `当前宿主不支持一键更新，请手动执行：${updateInfo.command}`) : null, updateNotice !== null ? (0, react.createElement)("p", { className: "imqb2-note imqb2-note--ok" }, updateNotice) : null, (0, react.createElement)("p", { className: "imqb2-hint" }, "更新完成后插件会自动重载；若界面没有刷新，请重启 DSH。"))
				]
			};
			const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? "";
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit
			}, (0, react.createElement)("div", {
				className: "imqb2-tabs",
				role: "tablist",
				"aria-label": "配置分区"
			}, TABS.map((tab) => (0, react.createElement)("button", {
				key: tab.id,
				type: "button",
				role: "tab",
				"aria-selected": activeTab === tab.id,
				"aria-controls": "imqb2-config-tabpanel",
				className: "imqb2-tab",
				onClick: () => {
					setActiveTab(tab.id);
				}
			}, tab.label, tabDirty(tab) ? (0, react.createElement)("span", {
				className: "imqb2-tab-dot",
				title: "有未保存的修改"
			}) : null))), (0, react.createElement)("div", {
				id: "imqb2-config-tabpanel",
				className: "imqb2-tabpanel",
				role: "tabpanel",
				"aria-label": activeTabLabel
			}, panels[activeTab]), (0, react.createElement)("div", { className: "imqb2-footer" }, result !== null ? (0, react.createElement)("p", { className: `imqb2-note${result.ok ? " imqb2-note--ok" : " imqb2-note--error"}` }, (result.ok ? "" : "⚠️ ") + result.message) : dirty ? (0, react.createElement)("p", { className: "imqb2-note" }, "保存后插件将重载，进行中的机器人会话将重置") : (0, react.createElement)("p", { className: "imqb2-note" }), (0, react.createElement)("button", {
				className: "imqb2-save",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "正在保存…" : "保存")));
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "qqbot-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-qqbot/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		/** 绑定入口图标（QQ 机器人，跟随主题图标色变量） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}));
		}
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		function QQBotSettingsSection() {
			const { state, gone, recheck } = useBindState();
			return (0, react.createElement)("div", null, (0, react.createElement)(BindPanelBody, {
				state,
				gone,
				recheck
			}), (0, react.createElement)(ConfigPanel, { bindPhase: state?.phase }));
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(QQBotSettingsSection)));
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function QqBotSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)("button", {
				type: "button",
				className: "imqb-pluginOpen",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			const tabs = ctx.sidebarRightTabs;
			const right = ctx.sidebarRight;
			const slots = ctx.slots;
			const disposers = [];
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, QQBotSettingsSection)));
			if (tabs !== void 0 && slots !== void 0) {
				disposers.push(tabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: () => "QQ 机器人绑定",
					guide: [{
						id: "bind",
						order: 90,
						title: () => "QQ 机器人绑定",
						description: () => "扫码或手动填写，绑定 QQ 机器人",
						icon: BindGuideIcon
					}]
				}));
				disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
					name: "sidebar.right.pane.tab",
					key: TAB_ID
				}, BindPanelBody)));
				disposers.push(watchAndPrompt(right));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") ctxInject.call(ctx, ["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				if (pageSlots === void 0 || layout === void 0) return void 0;
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, QQBotPage));
				const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register({
					name: "plugins.detail.actions",
					id: "im-qqbot-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
					})
				}, OpenQqBotAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "QQ 机器人"
				}, QqBotSidebarIcon));
				return () => {
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.binding");
		}
		/**
		* 轮询绑定状态：待绑定时自动打开绑定页。
		*
		* - 页面隐藏时降频轮询（可见时立即恢复节拍）
		* - 404（已绑定/未安装）时退避到 30s，保持低成本常驻探测
		* - 每次页面加载至多打开一次（用户手动关闭后不打扰）；
		*   打开失败（如启动早期 Session surface 尚未挂载）不消费机会，
		*   由下一轮轮询（3s）自动重试
		*/
		function watchAndPrompt(right) {
			let stopped = false;
			let opened = right === void 0;
			let timer;
			const schedule = (ms) => {
				timer = setTimeout(() => {
					tick();
				}, ms);
			};
			const tick = async () => {
				if (stopped) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					schedule(5e3);
					return;
				}
				try {
					const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
					if (res.ok) {
						if ((await res.json()).phase === "waiting" && !opened && right !== void 0) try {
							right.openTab(TAB_KIND);
							opened = true;
						} catch (err) {
							console.error("[im-qqbot] 打开绑定页失败，稍后重试", err);
						}
						schedule(3e3);
						return;
					}
					schedule(3e4);
					return;
				} catch {}
				schedule(1e4);
			};
			tick();
			return () => {
				stopped = true;
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map