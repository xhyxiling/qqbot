window.__ModuleLoader__.load({ id: '@tencent-connect/dsh-qqbot', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/shared/bind-protocol.ts
var BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
var BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
var BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
var BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
var BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
var BIND_UPDATE_PATH = "/qqbot/im-qqbot/update";
var BIND_PERSONAS_PATH = "/qqbot/im-qqbot/personas";

// src/client/bind-page.ts
var import_react = require("react");
var ACTIVE_POLL_MS = 2e3;
var RETRY_POLL_MS = 3e3;
var STYLE_ID = "im-qqbot-bind-panel-styles";
function installPanelStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
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
/* \u63D2\u4EF6\u8BE6\u60C5\u300C\u8BBE\u7F6E\u300D\u6309\u94AE\uFF1A30px\uFF0C\u7565\u9AD8\u4E8E\u65C1\u8FB9\u7684 sm \u6B21\u8981\u6309\u94AE */
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
/* \u4E3B\u9762\u677F\u9875\u9762\u5BB9\u5668\uFF08layout.selectPanel \u76EE\u6807\uFF09\uFF1A\u6EDA\u52A8 + \u7559\u767D */
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
/* \u7D27\u51D1\u72B6\u6001\u89C6\u56FE\uFF08\u5DF2\u7ED1\u5B9A / \u8FC7\u6E21\u6001\uFF09\uFF1A\u8BBE\u7F6E\u884C\u98CE\u683C\uFF0C\u65E0\u5C45\u4E2D\u5927\u5361\u7559\u767D */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* \u900F\u660E\u5E95\uFF0CQQ \u84DD\u5FBD\u6807\u5728\u660E\u6697\u4E3B\u9898\u4E0B\u5747\u6E05\u6670 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
/* \u626B\u7801\u6210\u529F\u540E\u7684\u8FDE\u63A5\u8FC7\u6E21\uFF1A\u4E8C\u7EF4\u7801\u6A21\u7CCA\u53D8\u6697 + \u8986\u76D6\u5C42 */
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
  (0, import_react.useEffect)(() => {
    installPanelStyles();
  }, []);
}
function useBindState(enabled = true) {
  const [state, setState] = (0, import_react.useState)(null);
  const [gone, setGone] = (0, import_react.useState)(false);
  const recheckRef = (0, import_react.useRef)(() => {
  });
  (0, import_react.useEffect)(() => {
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
        void tick();
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
      } catch {
      } finally {
        running = false;
        if (restartAfterFlight && !stopped) {
          restartAfterFlight = false;
          void tick();
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
      void tick();
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== void 0) clearTimeout(timer);
    };
  }, []);
  const recheck = (0, import_react.useCallback)(() => {
    recheckRef.current();
  }, []);
  return { state, gone, recheck };
}
async function submitManualCredentials(appId, appSecret) {
  try {
    const res = await fetch(BIND_MANUAL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId, appSecret })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) return { ok: true, message: body.message };
    return { ok: false, error: body.error ?? `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function ManualForm({ initialAppId }) {
  const [appId, setAppId] = (0, import_react.useState)(initialAppId ?? "");
  const [appSecret, setAppSecret] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [result, setResult] = (0, import_react.useState)(null);
  const submit = (0, import_react.useCallback)((event) => {
    event.preventDefault();
    if (busy) return;
    const trimmedId = appId.trim();
    const trimmedSecret = appSecret.trim();
    if (trimmedId.length === 0 || trimmedSecret.length === 0) {
      setResult({ ok: false, error: "appId \u4E0E appSecret \u5747\u4E3A\u5FC5\u586B" });
      return;
    }
    setBusy(true);
    void submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
      setResult(outcome);
      setBusy(false);
    });
  }, [appId, appSecret, busy]);
  if (result !== null && result.ok) {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-status" },
      (0, import_react.createElement)(
        "div",
        { className: "imqb-status-row" },
        (0, import_react.createElement)("div", { className: "imqb-status-icon" }, "\u2705"),
        (0, import_react.createElement)(
          "div",
          { className: "imqb-status-meta" },
          (0, import_react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "\u51ED\u636E\u5DF2\u4FDD\u5B58"),
          (0, import_react.createElement)("p", { className: "imqb-status-sub" }, "\u63D2\u4EF6\u5C06\u81EA\u52A8\u91CD\u8F7D\uFF1B\u7A0D\u540E\u5373\u53EF\u5F00\u59CB\u5BF9\u8BDD")
        )
      )
    );
  }
  return (0, import_react.createElement)(
    "form",
    { className: "imqb-form", onSubmit: submit },
    (0, import_react.createElement)(
      "label",
      { className: "imqb-field" },
      "AppID",
      (0, import_react.createElement)("input", {
        className: "imqb-input",
        value: appId,
        placeholder: "QQ \u673A\u5668\u4EBA AppID",
        onChange: (event) => {
          setAppId(event.currentTarget.value);
        },
        autoComplete: "off",
        spellCheck: false
      })
    ),
    (0, import_react.createElement)(
      "label",
      { className: "imqb-field" },
      "AppSecret",
      (0, import_react.createElement)("input", {
        className: "imqb-input",
        type: "password",
        value: appSecret,
        placeholder: initialAppId === void 0 ? "QQ \u673A\u5668\u4EBA AppSecret" : "\u8F93\u5165\u65B0\u7684 AppSecret\uFF08\u4E0D\u56DE\u663E\uFF09",
        onChange: (event) => {
          setAppSecret(event.currentTarget.value);
        },
        autoComplete: "new-password"
      })
    ),
    result !== null && !result.ok ? (0, import_react.createElement)("p", { className: "imqb-error" }, result.error) : null,
    (0, import_react.createElement)(
      "button",
      { className: "imqb-btn imqb-btn--primary", type: "submit", disabled: busy },
      busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58"
    )
  );
}
var QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
function QqBotIcon({ size = 28 }) {
  return (0, import_react.createElement)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": true,
      className: "imqb-qqicon"
    },
    (0, import_react.createElement)("path", { d: QQ_BOT_LOGO_PATH, fill: "#0085FF" })
  );
}
function BoundView({ appId, recheck }) {
  const [editing, setEditing] = (0, import_react.useState)(false);
  const [unbindResult, setUnbindResult] = (0, import_react.useState)(null);
  const unbind = (0, import_react.useCallback)(() => {
    if (!window.confirm("\u786E\u5B9A\u89E3\u7ED1\u5417\uFF1F\n\u89E3\u7ED1\u540E\u673A\u5668\u4EBA\u7ACB\u5373\u4E0B\u7EBF\uFF0C\u63D2\u4EF6\u5C06\u91CD\u65B0\u8FDB\u5165\u626B\u7801\u7ED1\u5B9A\u6D41\u7A0B\u3002")) return;
    void fetch(BIND_UNBIND_PATH, { method: "POST" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok === true) {
        setUnbindResult({ ok: true, message: body.message ?? "\u5DF2\u89E3\u7ED1\uFF0C\u63D2\u4EF6\u5C06\u91CD\u8F7D\u5E76\u91CD\u65B0\u8FDB\u5165\u7ED1\u5B9A\u6D41\u7A0B" });
        recheck();
        return;
      }
      setUnbindResult({ ok: false, message: body.error ?? `\u89E3\u7ED1\u5931\u8D25\uFF08HTTP ${res.status}\uFF09` });
    }).catch((err) => {
      setUnbindResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    });
  }, [recheck]);
  if (unbindResult !== null) {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-status" },
      (0, import_react.createElement)(
        "div",
        { className: "imqb-status-row" },
        (0, import_react.createElement)("div", { className: "imqb-status-icon" }, unbindResult.ok ? "\u{1F44B}" : "\u26A0\uFE0F"),
        (0, import_react.createElement)(
          "div",
          { className: "imqb-status-meta" },
          (0, import_react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)
        ),
        unbindResult.ok ? (0, import_react.createElement)("button", { className: "imqb-ghost", onClick: recheck }, "\u5237\u65B0\u72B6\u6001") : (0, import_react.createElement)("button", { className: "imqb-ghost", onClick: () => {
          setUnbindResult(null);
        } }, "\u8FD4\u56DE")
      )
    );
  }
  if (editing) {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-status" },
      (0, import_react.createElement)(
        "div",
        { className: "imqb-status-row" },
        (0, import_react.createElement)(
          "div",
          { className: "imqb-status-meta" },
          (0, import_react.createElement)("p", { className: "imqb-status-title" }, "\u66F4\u6362\u51ED\u636E")
        ),
        (0, import_react.createElement)("button", { className: "imqb-ghost", onClick: () => {
          setEditing(false);
        } }, "\u8FD4\u56DE")
      ),
      (0, import_react.createElement)(ManualForm, { initialAppId: appId })
    );
  }
  return (0, import_react.createElement)(
    "div",
    { className: "imqb-status" },
    (0, import_react.createElement)(
      "div",
      { className: "imqb-status-row" },
      (0, import_react.createElement)(QqBotIcon, { size: 28 }),
      (0, import_react.createElement)(
        "div",
        { className: "imqb-status-meta" },
        (0, import_react.createElement)("p", { className: "imqb-status-title" }, "\u5DF2\u7ED1\u5B9A"),
        (0, import_react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId} \xB7 \u79C1\u804A\u4E0E\u7FA4\u804A\u5DF2\u63A5\u5165`)
      )
    ),
    (0, import_react.createElement)(
      "div",
      { className: "imqb-status-actions" },
      (0, import_react.createElement)("button", { className: "imqb-btn imqb-btn--primary", onClick: () => {
        setEditing(true);
      } }, "\u66F4\u6362\u51ED\u636E"),
      (0, import_react.createElement)("button", { className: "imqb-btn imqb-btn--danger", onClick: unbind }, "\u89E3\u7ED1")
    )
  );
}
function UnboundView({ state }) {
  const [mode, setMode] = (0, import_react.useState)("qr");
  const refresh = (0, import_react.useCallback)(() => {
    void fetch(BIND_REFRESH_PATH, { method: "POST" }).catch(() => {
    });
  }, []);
  if (mode === "manual") {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-panel" },
      (0, import_react.createElement)("p", { className: "imqb-title" }, "\u624B\u52A8\u586B\u5199\u51ED\u636E"),
      (0, import_react.createElement)(ManualForm, {}),
      (0, import_react.createElement)("button", { className: "imqb-ghost", onClick: () => {
        setMode("qr");
      } }, "\u6539\u7528\u626B\u7801\u7ED1\u5B9A")
    );
  }
  return (0, import_react.createElement)(
    "div",
    { className: "imqb-panel" },
    state.qrSvg === void 0 ? null : (0, import_react.createElement)("img", { src: state.qrSvg, alt: "QQ \u626B\u7801\u4E8C\u7EF4\u7801", width: 220, height: 220, className: "imqb-qr" }),
    (0, import_react.createElement)("p", { className: "imqb-title" }, "\u626B\u7801\u7ED1\u5B9A QQ \u673A\u5668\u4EBA"),
    (0, import_react.createElement)("p", { className: "imqb-hint" }, "\u4F7F\u7528\u624B\u673A QQ \u626B\u63CF\u4E8C\u7EF4\u7801\u5B8C\u6210\u7ED1\u5B9A"),
    (0, import_react.createElement)("a", { href: state.url, target: "_blank", rel: "noreferrer noopener", className: "imqb-link" }, "\u4E8C\u7EF4\u7801\u663E\u793A\u5F02\u5E38\uFF1F\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00"),
    (0, import_react.createElement)(
      "div",
      { className: "imqb-row" },
      (0, import_react.createElement)("button", { className: "imqb-pill", onClick: refresh }, "\u5237\u65B0\u4E8C\u7EF4\u7801"),
      (0, import_react.createElement)("button", { className: "imqb-pill", onClick: () => {
        setMode("manual");
      } }, "\u624B\u52A8\u586B\u5199")
    )
  );
}
function BindPanelBody(props) {
  usePanelStyles();
  const injected = props?.state !== void 0;
  const internal = useBindState(!injected);
  const state = injected ? props.state : internal.state;
  const gone = injected ? props.gone ?? false : internal.gone;
  const recheck = injected ? props.recheck ?? (() => {
  }) : internal.recheck;
  const [lastQr, setLastQr] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (state === null) return;
    if (state.phase === "waiting") {
      if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
    } else if (state.phase === "bound") {
      setLastQr(null);
    }
  }, [state]);
  if (gone) {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-panel" },
      (0, import_react.createElement)("div", { className: "imqb-icon" }, "\u2754"),
      (0, import_react.createElement)("p", { className: "imqb-hint" }, "\u63D2\u4EF6\u672A\u542F\u7528\uFF0C\u6216\u5F53\u524D\u7248\u672C\u4E0D\u652F\u6301\u7AEF\u5185\u914D\u7F6E")
    );
  }
  if (state === null || state.phase === "starting") {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-panel" },
      (0, import_react.createElement)("p", { className: "imqb-hint" }, "\u6B63\u5728\u83B7\u53D6\u7ED1\u5B9A\u72B6\u6001\u2026")
    );
  }
  if (state.phase === "saving") {
    if (lastQr !== null) {
      return (0, import_react.createElement)(
        "div",
        { className: "imqb-panel" },
        (0, import_react.createElement)(
          "div",
          { className: "imqb-scanned" },
          (0, import_react.createElement)("img", { src: lastQr, alt: "QQ \u626B\u7801\u4E8C\u7EF4\u7801", width: 220, height: 220, className: "imqb-scanned-qr" }),
          (0, import_react.createElement)(
            "div",
            { className: "imqb-scanned-veil" },
            (0, import_react.createElement)("p", { className: "imqb-scanned-title" }, "\u2705 \u626B\u7801\u6210\u529F"),
            (0, import_react.createElement)("p", { className: "imqb-scanned-sub" }, "\u6B63\u5728\u8FDE\u63A5\u673A\u5668\u4EBA\uFF0C\u7A0D\u5019\u2026")
          )
        )
      );
    }
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-status" },
      (0, import_react.createElement)(
        "div",
        { className: "imqb-status-row" },
        (0, import_react.createElement)("div", { className: "imqb-status-icon" }, "\u{1F389}"),
        (0, import_react.createElement)(
          "div",
          { className: "imqb-status-meta" },
          (0, import_react.createElement)("p", { className: "imqb-status-title" }, "\u626B\u7801\u6210\u529F"),
          (0, import_react.createElement)("p", { className: "imqb-status-sub" }, "\u51ED\u636E\u5DF2\u4FDD\u5B58\uFF0C\u63D2\u4EF6\u6B63\u5728\u91CD\u8F7D\uFF0C\u7A0D\u540E\u5373\u53EF\u5F00\u59CB\u5BF9\u8BDD")
        )
      )
    );
  }
  if (state.phase === "failed") {
    return (0, import_react.createElement)(
      "div",
      { className: "imqb-panel" },
      (0, import_react.createElement)("div", { className: "imqb-icon" }, "\u26A0\uFE0F"),
      (0, import_react.createElement)("p", { className: "imqb-title" }, "\u7ED1\u5B9A\u5931\u8D25"),
      (0, import_react.createElement)("p", { className: "imqb-hint" }, state.reason),
      (0, import_react.createElement)(
        "div",
        { className: "imqb-row" },
        (0, import_react.createElement)("button", { className: "imqb-btn imqb-btn--primary", onClick: () => {
          window.location.reload();
        } }, "\u91CD\u8BD5")
      )
    );
  }
  if (state.phase === "bound") {
    return (0, import_react.createElement)(BoundView, { appId: state.appId, recheck });
  }
  return (0, import_react.createElement)(UnboundView, { state });
}

// src/client/config-panel.ts
var import_react2 = require("react");

// src/shared/tool-catalog.ts
var GROUP_PLUGIN = "\u63D2\u4EF6\u5185\u7F6E";
var GROUP_OTHER = "\u5176\u4ED6";
var TOOL_CATALOG = [
  { name: "qqbot_solve", label: "\u505A\u9898\uFF08\u7B54\u6848+\u8FC7\u7A0B\uFF09", group: GROUP_PLUGIN },
  { name: "qqbot_describe_image", label: "\u770B\u56FE / OCR / \u8BFB\u56FE\u8868", group: GROUP_PLUGIN },
  { name: "qqbot_send_file", label: "\u628A\u672C\u5730\u6587\u4EF6\u53D1\u7ED9\u7528\u6237", group: GROUP_PLUGIN },
  { name: "qqbot_translate", label: "\u7FFB\u8BD1", group: GROUP_PLUGIN },
  { name: "qqbot_summarize", label: "\u957F\u6587\u603B\u7ED3", group: GROUP_PLUGIN },
  { name: "qqbot_explain", label: "\u8BB2\u89E3\u6982\u5FF5 / \u4EE3\u7801 / \u62A5\u9519", group: GROUP_PLUGIN },
  { name: "qqbot_rewrite", label: "\u6539\u5199 / \u6DA6\u8272", group: GROUP_PLUGIN },
  { name: "qqbot_analyze_persona", label: "\u5206\u6790\u7FA4\u53CB\u4EBA\u683C\uFF08\u6309\u7FA4\u804A\u8BB0\u5F55\uFF09", group: GROUP_PLUGIN }
];
var DEFAULT_TOOL_ALLOWLIST = [
  ...TOOL_CATALOG.map((entry) => entry.name),
  "ask_user_question",
  "web_search",
  "web_fetch"
];
function catalogToolNames() {
  return TOOL_CATALOG.map((entry) => entry.name);
}
function isPluginToolName(name2) {
  return TOOL_CATALOG.some((entry) => entry.name === name2.trim());
}
function mergeToolNames(...sources) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const source of sources) {
    for (const raw of source ?? []) {
      const name2 = raw.trim();
      if (name2 === "" || seen.has(name2)) continue;
      seen.add(name2);
      result.push(name2);
    }
  }
  return result;
}
function groupToolNames(names) {
  const catalog = new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]));
  const buckets = /* @__PURE__ */ new Map();
  for (const raw of names) {
    const name2 = raw.trim();
    if (name2 === "") continue;
    const entry = catalog.get(name2);
    const group = entry?.group ?? GROUP_OTHER;
    const row = { name: name2, label: entry?.label ?? "\u81EA\u5B9A\u4E49\u5DE5\u5177" };
    const bucket = buckets.get(group);
    if (bucket === void 0) buckets.set(group, [row]);
    else bucket.push(row);
  }
  const order = [...new Set(TOOL_CATALOG.map((entry) => entry.group)), GROUP_OTHER];
  return order.filter((group) => buckets.has(group)).map((group) => ({ group, tools: buckets.get(group) ?? [] }));
}

// src/expressions/kaomoji.ts
var DEFAULT_KAOMOJI_STYLE = "daily";
var KAOMOJI_STYLES = [
  {
    id: "daily",
    name: "\u65E5\u5E38",
    description: "\u901A\u7528\u60C5\u7EEA\uFF0C\u8F7B\u5FAE\u70B9\u7F00\uFF0C\u9002\u5408\u5927\u591A\u6570\u4EBA\u683C",
    groups: [
      { mood: "\u5F00\u5FC3", items: ["(\uFFE3\u25BD\uFFE3)", "(\uFF3E\u25BD\uFF3E)", "(\u2267\u25BD\u2266)", "(\u30FB\u2200\u30FB)"] },
      { mood: "\u5BB3\u7F9E", items: ["(\u2044 \u2044\u2022\u2044\u03C9\u2044\u2022\u2044 \u2044)", "(\u0E51\xB4\u3142\u0E51)"] },
      { mood: "\u65E0\u8BED", items: ["(\u30FB_\u30FB;)", "(\uFFE3\u03C9\uFFE3;)", "(\xB0\u30FC\xB0\u3003)"] },
      { mood: "\u4F4E\u843D", items: ["(\xB4\u30FB\u03C9\u30FB)", "(\xB4-\u03C9-)"] },
      { mood: "\u751F\u6C14", items: ["(\uFFE3\u30D8\uFFE3)", "(\uFF1E\uFE3F\uFF1C)"] }
    ]
  },
  {
    id: "genki",
    name: "\u5143\u6C14",
    description: "\u9AD8\u9891\u3001\u5916\u653E\uFF0C\u9002\u5408\u5143\u6C14/\u6D3B\u6CFC\u4EBA\u683C",
    groups: [
      { mood: "\u5F00\u5FC3", items: ["(\u0E51\u2022\u0300\u3142\u2022\u0301)\u0648\u2727", "\u0669(\u0E51>\u25E1<\u0E51)\u06F6", "(\uFF89\u25D5\u30EE\u25D5)\uFF89*:\uFF65\uFF9F\u2727", "(\u2267\u2207\u2266)\uFF89"] },
      { mood: "\u52A0\u6CB9", items: ["(\u0E07 \u2022\u0300_\u2022\u0301)\u0E07", "(\u0E51\u02C3\u0335\u1D17\u02C2\u0335)\u0648", "o(*\u2267\u25BD\u2266)\u30C4"] },
      { mood: "\u5F97\u610F", items: ["\u2727*\uFF61\u0669(\u02CA\u15DC\u02CB*)\u0648\u2727*\uFF61", "(\u0E51\u2022\u0300\u3141\u2022\u0301\u0E51)\u2727"] },
      { mood: "\u5174\u594B", items: ["\u30FD(\u2267\u0414\u2266)\u30CE", "(\u261D\uFE0E \u055E\u0A0A \u055E)\u261D\uFE0E", "\u30FD(\u2022\u203F\u2022)\u30CE"] }
    ]
  },
  {
    id: "chuuni",
    name: "\u4E2D\u4E8C",
    description: "\u5E26\u8BBE\u5B9A\u611F\u4E0E\u620F\u5267\u6027\uFF0C\u9002\u5408\u4E2D\u4E8C\u4EBA\u683C",
    groups: [
      { mood: "\u5F97\u610F", items: ["(\uFFE3\u25BD\uFFE3)\u309E", "(\uFFE3^\uFFE3)\u309E", "\u30FD(\u2022\u0300\u03C9\u2022\u0301 )\u309D"] },
      { mood: "\u9AD8\u51B7", items: ["(\uFFE3\u30FC\uFFE3)", "(\xAC_\xAC)", "\u250C(\u250C ^o^)\u2510"] },
      { mood: "\u9707\u60CA", items: ["(\u256F\xB0\u25A1\xB0\uFF09\u256F\uFE35 \u253B\u2501\u253B", "\u252C\u2500\u252C\u30CE( \xBA _ \xBA\u30CE)", "(\uFF1B\uFFE3\u0414\uFFE3)"] },
      { mood: "\u5634\u786C", items: ["( \uFF40\u30FC\xB4)\u30CE", "(\uFFE3\u03C9\uFFE3;)"] }
    ]
  },
  {
    id: "cat",
    name: "\u732B\u7CFB",
    description: "\u732B\u8033/\u732B\u722A\u611F\uFF0C\u9002\u5408\u732B\u5A18\u53CA\u840C\u7CFB\u4EBA\u683C",
    groups: [
      { mood: "\u5F00\u5FC3", items: ["\u0E05^\u2022\uFECC\u2022^\u0E05", "(=^\uFF65\u03C9\uFF65^=)", "(^\u30FB\u03C9\u30FB^ )"] },
      { mood: "\u6492\u5A07", items: ["\u0E05( \u0333\u2022 \xB7\u032B \u2022 \u0333\u0E05)", "(=^ \u25E1 ^=)", "(\u03A6\u03C9\u03A6)"] },
      { mood: "\u751F\u6C14", items: ["(=\uFF40\u03C9\xB4=)", "(^=\u25D5\u1D25\u25D5=^)"] },
      { mood: "\u56F0\u5026", items: ["(^-\u03C9-^=)", "(=\u2460\u03C9\u2460=)", "(=\u03C9=)"] }
    ]
  },
  {
    id: "tsundere",
    name: "\u50B2\u5A07",
    description: "\u5634\u786C\u3001\u522B\u626D\uFF0C\u9002\u5408\u50B2\u5A07/\u5C0F\u6076\u9B54\u4EBA\u683C",
    groups: [
      { mood: "\u5634\u786C", items: ["(\uFFE3^\uFFE3)", "(\uFFE33\uFFE3)", "(\uFF40\u0414\xB4*)", "(\xAC_\xAC)"] },
      { mood: "\u5BB3\u7F9E", items: ["(\uFFE3\u25BD\uFFE3)", "(\u2044 \u2044\u2022\u2044\u03C9\u2044\u2022\u2044 \u2044)", "(\uFFE3\u03C9\uFFE3;)"] },
      { mood: "\u751F\u6C14", items: ["(\uFFE3\u30D8\uFFE3)", "(\uFF1E\uFE3F\uFF1C)", "(\u30FC_\u30FC\u309E"] },
      { mood: "\u59D4\u5C48", items: ["(\uFF61\u2022\u0301\uFE3F\u2022\u0300\uFF61)", "(\uFFE3\uFE4F\uFFE3)"] }
    ]
  },
  {
    id: "soft",
    name: "\u6E29\u67D4",
    description: "\u67D4\u548C\u3001\u4F53\u8D34\uFF0C\u9002\u5408\u6E29\u67D4/\u5927\u59D0\u59D0\u4EBA\u683C",
    groups: [
      { mood: "\u5F00\u5FC3", items: ["(\xB4\uFF61\u2022 \u1D55 \u2022\uFF61)", "(\u25CD\u2022\u1D17\u2022\u25CD)", "( \u02F6\u02C6\u15DC\u02C6\u02F5 )"] },
      { mood: "\u6696\u5FC3", items: ["(\uFF61\uFF65\u03C9\uFF65\uFF61)\uFF89\u2661", "(\u706C\xBA\u203F\xBA\u706C)\u2661", "(\u2229\u02C3o\u02C2\u2229)\u2661", "( \u02D8 \xB3\u02D8)\u2665"] },
      { mood: "\u5BB3\u7F9E", items: ["(\u2044 \u2044\u2022\u2044\u03C9\u2044\u2022\u2044 \u2044)", "(\u0E51\u2022\u0301 \u2083 \u2022\u0300\u0E51)"] },
      { mood: "\u9F13\u52B1", items: ["(\uFF61\u2022\u0300\u1D17-)\u2727", "(\u0E51\u02D8\uFE36\u02D8\u0E51)"] }
    ]
  },
  {
    id: "cool",
    name: "\u6E05\u51B7",
    description: "\u514B\u5236\u3001\u5C11\u7528\uFF0C\u9002\u5408\u6E05\u51B7/\u5B66\u59D0\u4EBA\u683C",
    groups: [
      { mood: "\u51B7\u6DE1", items: ["(\uFFE3\u30FC\uFFE3)", "(\uFFE3.\uFFE3)", "(\u30FB_\u30FB)", "(\xAC\u203F\xAC)"] },
      { mood: "\u65E0\u5948", items: ["(\uFFE3\u0414\uFFE3)", "(\u30FC_\u30FC)", "(\u30FB\uFF3F\u30FB)"] },
      { mood: "\u8F7B\u5FAE", items: ["(\uFFE3\u03C9\uFFE3)"] }
    ]
  },
  {
    id: "maid",
    name: "\u5973\u4EC6",
    description: "\u606D\u656C\u3001\u7EC6\u817B\uFF0C\u9002\u5408\u5973\u4EC6/\u4F8D\u4ECE\u4EBA\u683C",
    groups: [
      { mood: "\u606D\u656C", items: ["(\u0E51\u2022 . \u2022\u0E51)", "(*^\u25BD^*)", "(\uFF61\uFF65\u03C9\uFF65\uFF61)\uFF89"] },
      { mood: "\u5BB3\u7F9E", items: ["(,,>\uFE4F<,,)", "(\u2044 \u2044\u2022\u2044\u03C9\u2044\u2022\u2044 \u2044)", "(\u0E51\u02CA\u0348 \u0962\uA1F4 \u02CB\u0348)"] },
      { mood: "\u5F00\u5FC3", items: ["(\u25D5\u203F\u25D5\u273F)", "(\u30CE*\xB0\u25BD\xB0*)", "(\u0E51\xAF\u03C9\xAF\u0E51)"] }
    ]
  }
];
function findKaomojiStyle(id) {
  const trimmed = id?.trim();
  if (!trimmed) return void 0;
  return KAOMOJI_STYLES.find((style) => style.id === trimmed);
}

// src/voice/voice-presets.ts
var VOICE_PRESET_MODEL = "qwen-audio-3.1-tts-flash";
var VOICE_PRESET_MODEL_PLUS = "qwen-audio-3.1-tts-plus";
var VOICE_PRESET_MODEL_30_FLASH = "qwen-audio-3.0-tts-flash";
var VOICE_PRESET_MODEL_30_PLUS = "qwen-audio-3.0-tts-plus";
var DEFAULT_VOICE_MODEL = VOICE_PRESET_MODEL;
var DEFAULT_VOICE_ID = "longanfengyue_v3.1";
var VOICE_MODELS = [
  {
    id: VOICE_PRESET_MODEL,
    label: "Qwen-Audio 3.1 TTS Flash",
    help: "\u4F4E\u5EF6\u8FDF\uFF0C\u652F\u6301\u5168\u90E8 26 \u4E2A\u7CFB\u7EDF\u97F3\u8272\u4E0E 3.1 \u590D\u523B/\u8BBE\u8BA1\u97F3\u8272\uFF08\u7F3A\u7701\u63A8\u8350\uFF09\u3002",
    generation: "3.1",
    recommended: true
  },
  {
    id: VOICE_PRESET_MODEL_PLUS,
    label: "Qwen-Audio 3.1 TTS Plus",
    help: "\u9AD8\u97F3\u8D28\uFF0C\u53EA\u652F\u6301 4 \u4E2A\u65D7\u8230\u7CFB\u7EDF\u97F3\u8272\uFF08longanfengyue_v3.1 / longanlingxin_v3.1 / longanhuan_v3.1 / xunanchuan_v3.1\uFF09\u4E0E 3.1 \u590D\u523B/\u8BBE\u8BA1\u97F3\u8272\u3002",
    generation: "3.1"
  },
  {
    id: VOICE_PRESET_MODEL_30_FLASH,
    label: "Qwen-Audio 3.0 TTS Flash\uFF08\u65E7\u7248\uFF09",
    help: "\u517C\u5BB9\u65E7\u914D\u7F6E\uFF1A12 \u4E2A 3.0 \u7CFB\u7EDF\u97F3\u8272\u4E0E 3.0 \u514B\u9686/\u8BBE\u8BA1\u97F3\u8272\uFF083.0 \u97F3\u8272\u4E0D\u80FD\u7528\u5728 3.1 \u4E0A\uFF09\u3002",
    generation: "3.0"
  },
  {
    id: VOICE_PRESET_MODEL_30_PLUS,
    label: "Qwen-Audio 3.0 TTS Plus\uFF08\u65E7\u7248\uFF09",
    help: "\u517C\u5BB9\u65E7\u914D\u7F6E\uFF1A\u53EA\u652F\u6301 longanlingxi / longanhuan_v3.6 \u4E24\u4E2A\u7CFB\u7EDF\u97F3\u8272\u4E0E 3.0 \u514B\u9686/\u8BBE\u8BA1\u97F3\u8272\u3002",
    generation: "3.0"
  }
];
var FLAGSHIP_31 = [VOICE_PRESET_MODEL, VOICE_PRESET_MODEL_PLUS];
var FLASH_ONLY_31 = [VOICE_PRESET_MODEL];
var FLASH_30 = [VOICE_PRESET_MODEL_30_FLASH];
var PLUS_30 = [VOICE_PRESET_MODEL_30_FLASH, VOICE_PRESET_MODEL_30_PLUS];
var VOICE_PRESETS = [
  // ---- 3.1 旗舰音色（plus 也支持）----
  { id: "longanfengyue_v3.1", name: "\u9F99\u5B89\u98CE\u60A6", trait: "\u81EA\u7136\u4EB2\u5207\u97F3", gender: "\u5973", models: FLAGSHIP_31, generation: "3.1" },
  { id: "longanlingxin_v3.1", name: "\u9F99\u5B89\u7075\u5FC3", gender: "\u5973", models: FLAGSHIP_31, generation: "3.1" },
  { id: "longanhuan_v3.1", name: "\u9F99\u5B89\u6B22", gender: "\u5973", models: FLAGSHIP_31, generation: "3.1" },
  { id: "xunanchuan_v3.1", name: "\u8BB8\u5357\u5DDD", gender: "\u7537", models: FLAGSHIP_31, generation: "3.1" },
  // ---- 3.1 系统音色（仅 flash）----
  { id: "longanyuanfei_v3.1", name: "\u9F99\u5B89\u5143\u5983", trait: "\u9AD8\u50B2\u5983\u5B50\u97F3", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longanlingxi_v3.1", name: "\u9F99\u5B89\u7075\u5E0C", trait: "\u53EF\u7231\u751C\u7F8E\u97F3", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longjielidou_v3.1", name: "\u9F99\u6770\u529B\u8C46", trait: "\u5929\u771F\u7537\u7AE5\u97F3", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longhuohuo_v3.1", name: "\u9F99\u706B\u706B", trait: "\u987D\u76AE\u5C11\u5E74\u97F3", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longpaopao_v3.1", name: "\u9F99\u6CE1\u6CE1", trait: "\u98DE\u5929\u6CE1\u6CE1\u97F3", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longhua_v3.1", name: "\u9F99\u534E", trait: "\u5143\u6C14\u751C\u7F8E\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longwan_v3.1", name: "\u9F99\u5A49", trait: "\u7EC6\u817B\u67D4\u58F0\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longxing_v3.1", name: "\u9F99\u661F", trait: "\u6E29\u5A49\u90BB\u5BB6\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longyue_v3.1", name: "\u9F99\u60A6", trait: "\u6E29\u6696\u3001\u78C1\u6027", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longyan_v3.1", name: "\u9F99\u989C", trait: "\u6E29\u6696\u3001\u81EA\u7136\u3001\u4EB2\u5207", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longyuan_v3.1", name: "\u9F99\u5A9B", trait: "\u6E29\u6696\u6CBB\u6108\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longmiao_v3.1", name: "\u9F99\u5999", trait: "\u6291\u626C\u987F\u632B\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longhan_v3.1", name: "\u9F99\u5BD2", trait: "\u6E29\u6696\u75F4\u60C5\u7537", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longanyang_v3.1", name: "\u9F99\u5B89\u6D0B", trait: "\u9633\u5149\u5927\u7537\u5B69", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longanzhi_v3.1", name: "\u9F99\u5B89\u667A", trait: "\u777F\u667A\u8F7B\u719F\u7537", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longzhe_v3.1", name: "\u9F99\u54F2", trait: "\u5446\u677F\u5927\u6696\u7537", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "loongbella_v3.1", name: "Bella", trait: "\u5E72\u7EC3\u3001\u78C1\u6027\u3001\u77E5\u6027", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "loongstella_v3.1", name: "Stella", trait: "\u98D2\u723D\u5229\u843D\u5973", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longxiaobai_v3.1", name: "\u9F99\u5C0F\u767D", trait: "\u78C1\u6027\u3001\u8D28\u611F", gender: "\u5973", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longshu_v3.1", name: "\u9F99\u4E66", trait: "\u6C89\u7A33\u3001\u78C1\u6027", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longcheng_v3.1", name: "\u9F99\u6A59", trait: "\u667A\u6167\u3001\u78C1\u6027", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  { id: "longtian_v3.1", name: "\u9F99\u5929", trait: "\u78C1\u6027\u3001\u7406\u667A", gender: "\u7537", models: FLASH_ONLY_31, generation: "3.1" },
  // ---- 3.0 旧音色（兼容保留：已有克隆音色绑定在 3.0 上）----
  { id: "longanfengyue", name: "\u9F99\u5B89\u98CE\u60A6", trait: "\u81EA\u7136\u4EB2\u5207\u97F3", gender: "\u5973", age: 30, models: FLASH_30, generation: "3.0" },
  { id: "longanyuanfei", name: "\u9F99\u5B89\u5143\u5983", trait: "\u9AD8\u50B2\u5983\u5B50\u97F3", gender: "\u5973", age: 30, models: FLASH_30, generation: "3.0" },
  { id: "longanlingxi", name: "\u9F99\u5B89\u7075\u5E0C", trait: "\u53EF\u7231\u751C\u7F8E\u97F3", gender: "\u5973", age: 25, models: PLUS_30, generation: "3.0" },
  { id: "longanxiaoxin", name: "\u9F99\u5B89\u5C0F\u6615", trait: "\u4EB2\u5207\u6D3B\u6CFC\u97F3", gender: "\u5973", age: 22, models: FLASH_30, generation: "3.0" },
  { id: "longanhuan_v3.6", name: "\u9F99\u5B89\u6B22", gender: "\u5973", age: 25, models: PLUS_30, generation: "3.0" },
  { id: "longjielidou_v3.6", name: "\u9F99\u6770\u529B\u8C46", trait: "\u5929\u771F\u7537\u7AE5", gender: "\u7537", age: 5, models: FLASH_30, generation: "3.0" },
  { id: "longpaopao_v3.6", name: "\u9F99\u6CE1\u6CE1", trait: "\u8F6F\u7CEF\u53EF\u7231\u97F3", gender: "\u5973", age: 5, models: FLASH_30, generation: "3.0" },
  { id: "longhuohuo_v3.6", name: "\u9F99\u706B\u706B", trait: "\u987D\u76AE\u5C11\u5E74\u97F3", gender: "\u7537", age: 8, models: FLASH_30, generation: "3.0" },
  { id: "longchuanshu_v3.6", name: "\u9F99\u5DDD\u53D4", trait: "\u5DDD\u666E\u5927\u53D4\u97F3", gender: "\u7537", age: 40, models: FLASH_30, generation: "3.0" },
  { id: "loongmary", name: "Loong Mary", trait: "\u6E29\u6696\u82F1\u97F3", gender: "\u5973", age: 20, models: FLASH_30, generation: "3.0" },
  { id: "loongjohn", name: "Loong John", trait: "\u6C89\u7A33\u4EB2\u5207\u7F8E\u97F3", gender: "\u7537", age: 28, models: FLASH_30, generation: "3.0" },
  { id: "loongeva_v3.6", name: "Loong Eva", trait: "\u9AD8\u667A\u7F8E\u97F3", gender: "\u5973", age: 28, models: FLASH_30, generation: "3.0" }
];
var PRESET_31_TO_30 = {
  "longanfengyue_v3.1": "longanfengyue",
  "longanyuanfei_v3.1": "longanyuanfei",
  "longanlingxi_v3.1": "longanlingxi",
  "longanhuan_v3.1": "longanhuan_v3.6",
  "longjielidou_v3.1": "longjielidou_v3.6",
  "longpaopao_v3.1": "longpaopao_v3.6",
  "longhuohuo_v3.1": "longhuohuo_v3.6"
};
var PRESET_30_TO_31 = Object.fromEntries(
  Object.entries(PRESET_31_TO_30).map(([current, legacy]) => [legacy, current])
);
function defaultVoiceForModel(model) {
  const target = model?.trim() || DEFAULT_VOICE_MODEL;
  if (target === VOICE_PRESET_MODEL_PLUS) return "longanlingxin_v3.1";
  if (target === VOICE_PRESET_MODEL) return DEFAULT_VOICE_ID;
  if (target === VOICE_PRESET_MODEL_30_PLUS) return "longanlingxi";
  if (target === VOICE_PRESET_MODEL_30_FLASH) return "longanfengyue";
  return DEFAULT_VOICE_ID;
}
function resolveVoicePresetForModel(id, model) {
  const target = id?.trim() ?? "";
  const modelId = model?.trim() || DEFAULT_VOICE_MODEL;
  if (target === "") return defaultVoiceForModel(modelId);
  const mapped = modelId === VOICE_PRESET_MODEL || modelId === VOICE_PRESET_MODEL_PLUS ? PRESET_30_TO_31[target] : modelId === VOICE_PRESET_MODEL_30_FLASH || modelId === VOICE_PRESET_MODEL_30_PLUS ? PRESET_31_TO_30[target] : void 0;
  if (mapped === void 0) return target;
  const preset = findVoicePreset(mapped);
  if (preset === void 0 || !preset.models.includes(modelId)) return defaultVoiceForModel(modelId);
  return mapped;
}
function findVoiceModel(id) {
  const target = id?.trim() ?? "";
  if (target === "") return void 0;
  return VOICE_MODELS.find((model) => model.id === target);
}
function followVoiceModel(id, model) {
  const current = id?.trim() ?? "";
  if (current === "") return "";
  const modelId = model.trim() || DEFAULT_VOICE_MODEL;
  if (findVoiceModel(modelId) === void 0) return current;
  const mapped = resolveVoicePresetForModel(current, modelId);
  const preset = findVoicePreset(mapped);
  if (preset === void 0) return mapped;
  return preset.models.includes(modelId) ? mapped : defaultVoiceForModel(modelId);
}
function findVoicePreset(id) {
  const target = id?.trim() ?? "";
  if (target === "") return void 0;
  return VOICE_PRESETS.find((preset) => preset.id === target);
}
function formatVoicePresetLabel(preset) {
  const ageGender = `${preset.age === void 0 ? "" : `${preset.age}\u5C81`}${preset.gender ?? ""}`;
  const details = [preset.trait, ageGender === "" ? void 0 : ageGender, `v${preset.generation}`].filter((part) => part !== void 0 && part !== "").join(" \xB7 ");
  return details === "" ? preset.name : `${preset.name}\uFF08${details}\uFF09`;
}
function buildVoiceOptions(custom, model) {
  const options = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of custom ?? []) {
    const id = (entry?.voice ?? "").trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    const name2 = (entry?.name ?? "").trim() || id;
    options.push({ value: id, label: `${name2}\uFF08\u81EA\u5B9A\u4E49\uFF09` });
  }
  const target = model?.trim() || VOICE_PRESET_MODEL;
  const knownModel = VOICE_PRESETS.some((preset) => preset.models.includes(target));
  if (!knownModel) return options;
  for (const preset of VOICE_PRESETS) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    const supported = preset.models.includes(target);
    options.push({
      value: preset.id,
      label: formatVoicePresetLabel(preset),
      ...supported ? {} : { requiresModel: preset.models[0] ?? VOICE_PRESET_MODEL }
    });
  }
  return options;
}
function voiceOptionLabel(options, id) {
  const target = id?.trim() ?? "";
  if (target === "") return "";
  return options.find((option) => option.value === target)?.label ?? target;
}

// src/client/config-panel.ts
var STYLE_ID2 = "im-qqbot-config-panel-styles";
var STYLE_VERSION = "9";
function useConfigPanelStyles() {
  (0, import_react2.useEffect)(() => {
    if (typeof document === "undefined") return;
    const existing = document.getElementById(STYLE_ID2);
    if (existing !== null) {
      if (existing.getAttribute("data-version") === STYLE_VERSION) return;
      existing.remove();
    }
    const style = document.createElement("style");
    style.id = STYLE_ID2;
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
/* Switch\uFF08aria-checked \u9A71\u52A8\uFF0C\u89C6\u89C9\u6001\u4E0E\u65E0\u969C\u788D\u6001\u540C\u6E90\uFF09 */
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
/* \u8F93\u5165\uFF08\u5B98\u65B9 fields.input \u590D\u523B\uFF09 */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* \u5DE5\u5177\u4E0B\u62C9\uFF08\u539F\u751F select + \u5DF2\u9009 chip\uFF09 */
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
/* \u5206\u6BB5\u63A7\u4EF6\uFF08\u5B98\u65B9 SegmentedControl \u590D\u523B\uFF1A\u6307\u793A\u5668\u6309\u6BB5\u6570/\u7D22\u5F15\u5B9A\u4F4D\uFF09 */
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
/* \u4EBA\u683C\u9884\u8BBE\u5361\u7247\uFF08\u6298\u53E0\u62BD\u5C49\uFF1A\u9ED8\u8BA4\u53EA\u663E\u793A\u6807\u9898\uFF0C\u70B9\u51FB\u6807\u9898\u5C55\u5F00\u7F16\u8F91\uFF09 */
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
/* \u81EA\u5B9A\u4E49\u97F3\u8272\u884C\uFF08\u540D\u79F0 + \u97F3\u8272 id + \u5220\u9664\uFF09 */
.imqb2-voice-row { display: flex; gap: 6px; align-items: center; }
.imqb2-voice-row .imqb2-input { min-width: 0; }
.imqb2-voice-name { flex: 0 0 140px; }
.imqb2-voice-id { flex: 1 1 auto; }
/* \u5206\u533A tab \u680F\uFF08\u81EA\u52A8\u6362\u884C\uFF0C\u9009\u4E2D\u6001\u4E3A\u6D6E\u8D77\u80F6\u56CA\uFF09 */
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
/* \u5E95\u680F\uFF08\u5B98\u65B9 SettingsForm.footer \u590D\u523B\uFF09 */
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
/* cwd \u53EA\u8BFB\u884C */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
/* \u7FA4\u53CB\u4EBA\u683C\uFF1A\u7B5B\u9009\u680F + \u8868\u683C + \u8BE6\u60C5 */
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
function Switch({ checked, label, onChange }) {
  return (0, import_react2.createElement)("button", {
    type: "button",
    role: "switch",
    "aria-checked": checked,
    "aria-label": label,
    className: "imqb2-switch",
    onClick: () => {
      onChange(!checked);
    }
  }, (0, import_react2.createElement)("span", { className: "imqb2-switch-thumb" }));
}
function Segmented({ value, options, onChange, label }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const trackStyle = {
    "--imqb2-seg-count": options.length,
    "--imqb2-seg-index": index
  };
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-seg", role: "tablist", "aria-label": label, style: trackStyle },
    (0, import_react2.createElement)("span", { className: "imqb2-seg-indicator" }),
    options.map((o) => (0, import_react2.createElement)("button", {
      key: o.value,
      type: "button",
      role: "tab",
      "aria-selected": o.value === value,
      className: "imqb2-seg-tab",
      onClick: () => {
        onChange(o.value);
      }
    }, o.label))
  );
}
function SwitchRow({ label, help, checked, onChange }) {
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-head" },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, label),
      (0, import_react2.createElement)(Switch, { checked, label, onChange })
    ),
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-help" }, help)
  );
}
function FieldRow({ label, help, value, placeholder, type, onChange }) {
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)("span", { className: "imqb2-label" }, label),
    (0, import_react2.createElement)("input", {
      className: "imqb2-input",
      value,
      placeholder,
      spellCheck: false,
      type: type ?? "text",
      autoComplete: "off",
      onChange: (event) => {
        onChange(event.currentTarget.value);
      }
    }),
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, help)
  );
}
function formatShortTime(timestamp) {
  if (timestamp === void 0 || !Number.isFinite(timestamp)) return "\u2014";
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function confidenceText(confidence) {
  return confidence === "high" ? "\u9AD8" : confidence === "medium" ? "\u4E2D" : confidence === "low" ? "\u4F4E" : "\u672A\u8BC4\u4F30";
}
function traitChips(traits) {
  if (traits.length === 0) return (0, import_react2.createElement)("span", { className: "imqb2-table-meta" }, "\u2014");
  const shown = traits.slice(0, 4);
  return (0, import_react2.createElement)(
    "span",
    { className: "imqb2-chips" },
    ...shown.map((trait) => (0, import_react2.createElement)("span", {
      key: trait,
      className: "imqb2-chip imqb2-chip--trait"
    }, trait)),
    traits.length > shown.length ? (0, import_react2.createElement)("span", { className: "imqb2-table-meta" }, `+${traits.length - shown.length}`) : null
  );
}
function chatDistribution(profile) {
  if (profile.chats.length === 0) return "\u2014";
  return profile.chats.filter((chat) => chat.messageCount > 0).slice(0, 4).map((chat) => `${chat.scope === "group" ? "\u7FA4" : "\u79C1\u804A"} ${chat.peerId.slice(0, 8)} \xB7 ${chat.messageCount} \u6761`).join("\uFF1B");
}
function chatSummary(profile) {
  const groupCount = profile.chats.filter((chat) => chat.scope === "group").length;
  const c2cCount = profile.chats.filter((chat) => chat.scope === "c2c").length;
  const parts = [
    groupCount > 0 ? `\u7FA4 ${groupCount}` : "",
    c2cCount > 0 ? `\u79C1\u804A ${c2cCount}` : ""
  ].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" \xB7 ") : String(profile.chatCount);
}
function PersonaCaptureStatus({ stats }) {
  const events = Object.entries(stats.eventTypes).filter(([, count]) => count > 0).slice(0, 4).map(([type, count]) => `${type} \xD7${count}`);
  const parts = [
    `\u5DF2\u5F52\u6863 ${stats.messageCount} \u6761`,
    `${stats.memberCount} \u4F4D\u7FA4\u53CB`,
    `${stats.chatCount} \u4E2A\u4F1A\u8BDD`,
    stats.lastArchivedAt !== void 0 ? `\u6700\u8FD1 ${formatShortTime(stats.lastArchivedAt)}` : ""
  ].filter((part) => part !== "");
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-capture" },
    (0, import_react2.createElement)("span", { className: "imqb2-table-meta" }, parts.join(" \xB7 ")),
    events.length > 0 ? (0, import_react2.createElement)("span", { className: "imqb2-table-meta" }, `\u5E73\u53F0\u4E0B\u53D1\uFF1A${events.join("\u3001")}`) : null,
    stats.groupFullMessages ? (0, import_react2.createElement)("span", { className: "imqb2-chip imqb2-chip--trait" }, "\u5168\u91CF\u7FA4\u6D88\u606F") : (0, import_react2.createElement)("span", {
      className: "imqb2-chip imqb2-chip--warn",
      title: "\u5E73\u53F0\u53EA\u4E0B\u53D1\u88AB @ \u673A\u5668\u4EBA\u7684\u7FA4\u6D88\u606F\uFF08GROUP_AT_MESSAGE_CREATE\uFF09"
    }, "\u4EC5 @ \u6D88\u606F"),
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-capture-hint" },
      stats.groupFullMessages ? "\u673A\u5668\u4EBA\u80FD\u6536\u5230\u7FA4\u5185\u5168\u91CF\u6D88\u606F\uFF08GROUP_MESSAGE_CREATE\uFF09\uFF0C\u7FA4\u53CB\u672A @ \u673A\u5668\u4EBA\u7684\u53D1\u8A00\u4E5F\u4F1A\u8FDB\u6863\u6848\u3002\u8BB0\u5F55\u8303\u56F4\u4E0D\u5F71\u54CD\u56DE\u590D\u8303\u56F4\uFF1A\u53EA\u8981\u300C\u5BF9\u8BDD\u8BBE\u7F6E \u2192 \u7FA4\u804A\u4EC5\u56DE\u590D @\u673A\u5668\u4EBA\u7684\u6D88\u606F\u300D\u4FDD\u6301\u5F00\u542F\uFF08\u9ED8\u8BA4\uFF09\uFF0C\u8FD9\u4E9B\u6D88\u606F\u53EA\u5165\u6863\u3001\u4E0D\u4F1A\u88AB\u9010\u6761\u56DE\u590D\u3002" : "\u5F53\u524D\u5E73\u53F0\u53EA\u63A8\u9001\u88AB @ \u673A\u5668\u4EBA\u7684\u7FA4\u6D88\u606F\uFF08GROUP_AT_MESSAGE_CREATE\uFF09\uFF0C\u7FA4\u53CB\u672A @ \u673A\u5668\u4EBA\u7684\u53D1\u8A00\u4E0D\u4F1A\u5230\u8FBE\u63D2\u4EF6\uFF0C\u6240\u4EE5\u6863\u6848\u91CC\u53EA\u6709\u88AB @ \u65F6\u7684\u90A3\u51E0\u6761\u3002\u5F00\u901A\u79C1\u57DF / \u5168\u91CF\u7FA4\u6D88\u606F\u6743\u9650\u540E\u4F1A\u81EA\u52A8\u6536\u5230 GROUP_MESSAGE_CREATE\u3002"
    )
  );
}
function PersonaProfileDetail({ profile }) {
  const rows = [
    {
      key: "\u5206\u6790\u72B6\u6001",
      value: profile.analyzedAt === void 0 ? profile.pending ? "\u7D2F\u8BA1\u53D1\u8A00\u5DF2\u8FBE\u9608\u503C\uFF0C\u7B49\u5F85\u81EA\u52A8\u5206\u6790\uFF08\u4E5F\u53EF\u5728\u7FA4\u91CC\u8BA9\u673A\u5668\u4EBA\u624B\u52A8\u5206\u6790\uFF09" : "\u5C1A\u672A\u5206\u6790\uFF08\u53D1\u8A00\u8FBE\u5230\u9608\u503C\u540E\u4F1A\u81EA\u52A8\u751F\u6210\uFF09" : `${formatShortTime(profile.analyzedAt)} \xB7 \u8986\u76D6 ${profile.analyzedMessageCount ?? 0} \u6761 \xB7 \u53EF\u4FE1\u5EA6 ${confidenceText(profile.confidence)}`
    },
    ...profile.provider !== void 0 ? [{ key: "\u5206\u6790\u6A21\u578B", value: `${profile.provider} / ${profile.model ?? ""}` }] : [],
    { key: "\u8BF4\u8BDD\u98CE\u683C", value: profile.style ?? "\u2014" },
    { key: "\u53E3\u5934\u7985", value: profile.catchphrases.length > 0 ? profile.catchphrases.join("\uFF1B") : "\u2014" },
    { key: "\u5174\u8DA3", value: profile.interests.length > 0 ? profile.interests.join("\uFF1B") : "\u2014" },
    { key: "\u7FA4\u5185\u89D2\u8272", value: profile.role ?? "\u2014" },
    { key: "\u76F8\u5904\u5EFA\u8BAE", value: profile.advice ?? "\u2014" },
    { key: "\u4F1A\u8BDD\u5206\u5E03", value: chatDistribution(profile) },
    { key: "openid", value: (0, import_react2.createElement)("span", { className: "imqb2-table-mono" }, profile.senderId) },
    ...profile.lastError !== void 0 ? [{ key: "\u4E0A\u6B21\u5931\u8D25", value: (0, import_react2.createElement)("span", { className: "imqb2-hint-warn" }, profile.lastError) }] : []
  ];
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-detail" },
    ...rows.map((row) => (0, import_react2.createElement)(
      "div",
      { key: row.key, className: "imqb2-detail-row" },
      (0, import_react2.createElement)("span", { className: "imqb2-detail-key" }, row.key),
      (0, import_react2.createElement)("span", {}, row.value)
    ))
  );
}
function PersonaProfilesTable({ archived }) {
  const [name2, setName] = (0, import_react2.useState)("");
  const [openid, setOpenid] = (0, import_react2.useState)("");
  const [trait, setTrait] = (0, import_react2.useState)("");
  const [query, setQuery] = (0, import_react2.useState)({ name: "", openid: "", trait: "" });
  const [profiles, setProfiles] = (0, import_react2.useState)([]);
  const [archiveStats, setArchiveStats] = (0, import_react2.useState)(null);
  const [total, setTotal] = (0, import_react2.useState)(0);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [refreshKey, setRefreshKey] = (0, import_react2.useState)(0);
  const [expanded, setExpanded] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    const timer = setTimeout(() => {
      setQuery({ name: name2, openid, trait });
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [name2, openid, trait]);
  (0, import_react2.useEffect)(() => {
    let stopped = false;
    const params = new URLSearchParams();
    if (query.name.trim() !== "") params.set("name", query.name.trim());
    if (query.openid.trim() !== "") params.set("openid", query.openid.trim());
    if (query.trait.trim() !== "") params.set("trait", query.trait.trim());
    setLoading(true);
    setError(null);
    void fetch(`${BIND_PERSONAS_PATH}?${params.toString()}`, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (stopped) return;
      if (body.ok !== true) {
        setProfiles([]);
        setTotal(0);
        setError(body.error ?? `\u8BFB\u53D6\u4EBA\u683C\u6863\u6848\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
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
  }, [query.name, query.openid, query.trait, refreshKey, archived]);
  const filterInput = (label, value, onChange) => (0, import_react2.createElement)("input", {
    className: "imqb2-input imqb2-filter",
    value,
    placeholder: label,
    "aria-label": label,
    spellCheck: false,
    autoComplete: "off",
    onChange: (event) => {
      onChange(event.currentTarget.value);
    },
    // 面板整体在 <form> 里：回车不应触发表单提交（保存配置）
    onKeyDown: (event) => {
      if (event.key === "Enter") event.preventDefault();
    }
  });
  const header = (0, import_react2.createElement)(
    "tr",
    {},
    (0, import_react2.createElement)("th", {}, "\u6635\u79F0"),
    (0, import_react2.createElement)("th", {}, "openid"),
    (0, import_react2.createElement)("th", {}, "\u4F1A\u8BDD"),
    (0, import_react2.createElement)("th", {}, "\u6D88\u606F"),
    (0, import_react2.createElement)("th", {}, "\u4EBA\u683C\u7279\u70B9"),
    (0, import_react2.createElement)("th", {}, "\u4E00\u53E5\u8BDD\u5370\u8C61"),
    (0, import_react2.createElement)("th", {}, "\u6700\u8FD1\u53D1\u8A00")
  );
  const rows = profiles.map((profile) => {
    const isOpen = expanded === profile.senderId;
    const trimmedName = profile.senderName?.trim() ?? "";
    const displayName = trimmedName !== "" ? trimmedName : `${profile.senderId.slice(0, 8)}\u2026`;
    return (0, import_react2.createElement)(
      "tbody",
      { key: profile.senderId },
      (0, import_react2.createElement)(
        "tr",
        { "data-expanded": isOpen },
        (0, import_react2.createElement)(
          "td",
          {},
          (0, import_react2.createElement)("button", {
            type: "button",
            className: "imqb2-table-click",
            onClick: () => {
              setExpanded(isOpen ? null : profile.senderId);
            }
          }, displayName)
        ),
        (0, import_react2.createElement)(
          "td",
          {},
          (0, import_react2.createElement)(
            "span",
            { className: "imqb2-table-mono", title: profile.senderId },
            `${profile.senderId.slice(0, 8)}\u2026`
          )
        ),
        (0, import_react2.createElement)("td", {
          className: "imqb2-table-meta",
          title: chatDistribution(profile)
        }, chatSummary(profile)),
        (0, import_react2.createElement)(
          "td",
          {},
          (0, import_react2.createElement)(
            "span",
            { className: "imqb2-table-meta" },
            `${profile.messageCount} \u6761` + (profile.analyzedMessageCount !== void 0 && profile.analyzedMessageCount > 0 ? ` \xB7 \u5206\u6790 ${profile.analyzedMessageCount}` : "")
          ),
          profile.pending ? (0, import_react2.createElement)(
            "span",
            { className: "imqb2-chip imqb2-chip--warn", title: "\u7D2F\u8BA1\u53D1\u8A00\u5DF2\u8FBE\u5230\u81EA\u52A8\u5206\u6790\u9608\u503C" },
            "\u5F85\u5206\u6790"
          ) : null
        ),
        (0, import_react2.createElement)("td", {}, traitChips(profile.traits)),
        (0, import_react2.createElement)("td", {}, profile.summary ?? (0, import_react2.createElement)("span", { className: "imqb2-table-meta" }, "\u2014")),
        (0, import_react2.createElement)("td", { className: "imqb2-table-meta" }, formatShortTime(profile.lastAt))
      ),
      isOpen ? (0, import_react2.createElement)(
        "tr",
        {},
        (0, import_react2.createElement)(
          "td",
          { colSpan: 7 },
          (0, import_react2.createElement)(PersonaProfileDetail, { profile })
        )
      ) : null
    );
  });
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-table-wrap" },
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-head", style: { paddingBottom: "4px" } },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u7FA4\u53CB\u4EBA\u683C\u6863\u6848"),
      (0, import_react2.createElement)("button", {
        type: "button",
        className: "imqb2-persona-add",
        onClick: () => {
          setRefreshKey((key) => key + 1);
        }
      }, loading ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0")
    ),
    archiveStats !== null ? (0, import_react2.createElement)(PersonaCaptureStatus, { stats: archiveStats }) : null,
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-filters" },
      filterInput("\u6309\u6635\u79F0\u7B5B\u9009", name2, setName),
      filterInput("\u6309 openid \u7B5B\u9009", openid, setOpenid),
      filterInput("\u6309\u4EBA\u683C\u7279\u70B9\u7B5B\u9009\uFF08\u5982 \u6162\u70ED / \u6BD2\u820C\uFF09", trait, setTrait)
    ),
    error !== null ? (0, import_react2.createElement)("p", { className: "imqb2-empty" }, `\u4EBA\u683C\u6863\u6848\u8BFB\u53D6\u5931\u8D25\uFF1A${error}`) : profiles.length === 0 ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-empty" },
      loading ? "\u6B63\u5728\u8BFB\u53D6\u4EBA\u683C\u6863\u6848\u2026" : archived ? "\u8FD8\u6CA1\u6709\u5339\u914D\u7684\u4EBA\u683C\u6863\u6848\u3002\u7FA4\u53CB\u7D2F\u8BA1\u53D1\u8A00\u8FBE\u5230\u9608\u503C\u540E\u4F1A\u81EA\u52A8\u5206\u6790\uFF08\u4E5F\u53EF\u5728\u7FA4\u91CC @\u673A\u5668\u4EBA \u8BF4\u300C\u5206\u6790\u4E00\u4E0B\u67D0\u67D0\u7684\u6027\u683C\u300D\uFF09\u3002" : "\u8BF7\u5148\u6253\u5F00\u4E0A\u65B9\u300C\u7FA4\u804A\u4EBA\u683C\u6863\u6848\u300D\u3002"
    ) : (0, import_react2.createElement)(
      "table",
      { className: "imqb2-table" },
      (0, import_react2.createElement)("thead", {}, header),
      ...rows
    ),
    profiles.length > 0 ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-empty" },
      `\u5171 ${total} \u4F4D\u7FA4\u53CB${total > profiles.length ? `\uFF08\u5F53\u524D\u5C55\u793A ${profiles.length} \u4F4D\uFF09` : ""}\uFF1B\u540C\u4E00 openid \u5728\u591A\u4E2A\u7FA4/\u79C1\u804A\u7684\u53D1\u8A00\u4F1A\u5408\u5E76\u6210\u4E00\u4EFD\u6863\u6848\u3002`
    ) : null
  );
}
var CURRENT_VOICE_OPTION = "__imqb2-current-voice__";
function VoiceSelectField({ label, value, placeholder, help, options, onChange }) {
  const current = value.trim();
  const known = options.some((option) => option.value === current);
  const mismatch = known ? options.find((option) => option.value === current)?.requiresModel : void 0;
  const unknown = current !== "" && !known && options.length > 0;
  const selectValue = known ? current : current === "" ? "" : CURRENT_VOICE_OPTION;
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)("span", { className: "imqb2-label" }, label),
    (0, import_react2.createElement)(
      "select",
      {
        className: "imqb2-input imqb2-select",
        value: selectValue,
        onChange: (event) => {
          const next = event.currentTarget.value;
          if (next === CURRENT_VOICE_OPTION) return;
          onChange(next);
        }
      },
      (0, import_react2.createElement)("option", { value: "" }, placeholder ?? "\uFF08\u7559\u7A7A\uFF0C\u7EE7\u627F\u5168\u5C40\u97F3\u8272\uFF09"),
      current !== "" && !known ? (0, import_react2.createElement)(
        "option",
        { value: CURRENT_VOICE_OPTION },
        `${current}\uFF08\u5F53\u524D\u97F3\u8272\uFF0C\u4E0D\u5728\u5217\u8868\u4E2D\uFF09`
      ) : null,
      options.map((option) => (0, import_react2.createElement)(
        "option",
        { key: option.value, value: option.value },
        option.requiresModel === void 0 ? option.label : `${option.label} \xB7 \u9700 ${option.requiresModel} \u6A21\u578B`
      ))
    ),
    mismatch === void 0 ? null : (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint-warn" },
      `\u5F53\u524D\u97F3\u8272\u53EA\u652F\u6301 ${mismatch}\uFF0C\u4E0E\u73B0\u7528\u8BED\u97F3\u6A21\u578B\u4E0D\u5339\u914D\uFF0C\u5408\u6210\u4F1A\u5931\u8D25\uFF1B\u8BF7\u628A\u300C\u8BED\u97F3\u6A21\u578B\u300D\u6539\u6210 ${mismatch}\u3002`
    ),
    unknown ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint-warn" },
      "\u5F53\u524D\u97F3\u8272\u4E0D\u5728\u5185\u7F6E\u6E05\u5355\u4E2D\uFF08\u591A\u534A\u662F\u590D\u523B/\u8BBE\u8BA1\u97F3\u8272\uFF09\uFF1A\u5B83\u7ED1\u5B9A\u5728\u521B\u5EFA\u65F6\u7684\u8D26\u53F7\u4E0E\u6A21\u578B\u4E0A\uFF0C\u6362\u4EE3\u9645\u540E\u901A\u5E38\u4ECD\u53EF\u5408\u6210\uFF0C\u82E5\u5931\u8D25\u8BF7\u56DE\u5230\u539F\u4EE3\u9645\u6A21\u578B\uFF0C\u6216\u5728\u5F53\u524D\u4EE3\u9645\u91CD\u65B0\u514B\u9686\u3002"
    ) : null,
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, help)
  );
}
var CURRENT_MODEL_OPTION = "__imqb2-current-model__";
var MANUAL_MODEL_OPTION = "__imqb2-manual-model__";
function VoiceModelField({ value, help, onChange }) {
  const current = value.trim();
  const preset = findVoiceModel(current);
  const [manual, setManual] = (0, import_react2.useState)(preset === void 0 && current !== "");
  const selectValue = manual ? MANUAL_MODEL_OPTION : preset === void 0 ? current === "" ? "" : CURRENT_MODEL_OPTION : current;
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u8BED\u97F3\u6A21\u578B"),
    (0, import_react2.createElement)(
      "select",
      {
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
      },
      (0, import_react2.createElement)("option", { value: "" }, `\uFF08\u7559\u7A7A\uFF0C\u4F7F\u7528\u7F3A\u7701 ${DEFAULT_VOICE_MODEL}\uFF09`),
      current !== "" && preset === void 0 ? (0, import_react2.createElement)(
        "option",
        { value: CURRENT_MODEL_OPTION },
        `${current}\uFF08\u5F53\u524D\u6A21\u578B\uFF0C\u4E0D\u5728\u5217\u8868\u4E2D\uFF09`
      ) : null,
      VOICE_MODELS.map((model) => (0, import_react2.createElement)(
        "option",
        { key: model.id, value: model.id },
        model.recommended === true ? `${model.label}\uFF08\u63A8\u8350\uFF09` : model.label
      )),
      (0, import_react2.createElement)("option", { value: MANUAL_MODEL_OPTION }, "\u5176\u4ED6\u6A21\u578B id\uFF08\u624B\u52A8\u8F93\u5165\uFF09")
    ),
    manual ? (0, import_react2.createElement)("input", {
      className: "imqb2-input",
      value: current,
      placeholder: "\u81EA\u5B9A\u4E49\u6A21\u578B id\uFF08\u5982 cosyvoice-v2\uFF09",
      spellCheck: false,
      autoComplete: "off",
      onChange: (event) => {
        onChange(event.currentTarget.value);
      }
    }) : null,
    manual ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint" },
      "\u5185\u7F6E\u97F3\u8272\u6E05\u5355\u53EA\u8986\u76D6 Qwen-Audio-TTS\uFF1B\u5176\u4ED6\u6A21\u578B\u7684\u97F3\u8272\u8BF7\u5728\u300C\u81EA\u5B9A\u4E49\u97F3\u8272\u300D\u91CC\u624B\u52A8\u6DFB\u52A0\u3002"
    ) : preset === void 0 ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint" },
      current === "" ? `\u7559\u7A7A\u65F6\u4F7F\u7528\u7F3A\u7701\u6A21\u578B ${DEFAULT_VOICE_MODEL}\u3002` : "\u5F53\u524D\u6A21\u578B\u4E0D\u5728\u5185\u7F6E\u6E05\u5355\u91CC\uFF1A\u53EA\u80FD\u4F7F\u7528\u300C\u81EA\u5B9A\u4E49\u97F3\u8272\u300D\uFF0C\u5185\u7F6E\u7CFB\u7EDF\u97F3\u8272\u4E0D\u4F1A\u5217\u51FA\u3002"
    ) : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, preset.help),
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, help)
  );
}
function VoicePresetListField({ value, onChange }) {
  const updateRow = (index, next) => {
    onChange(value.map((row, i) => i === index ? { ...row, ...next } : row));
  };
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u81EA\u5B9A\u4E49\u97F3\u8272"),
    value.length === 0 ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint" },
      "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u97F3\u8272\u3002\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u65B0\u589E\uFF0C\u586B\u540D\u79F0 + \u97F3\u8272 id\uFF1B\u65B0\u589E\u9879\u4F1A\u6392\u5728\u97F3\u8272\u4E0B\u62C9\u7684\u6700\u4E0A\u65B9\u3002"
    ) : value.map((row, index) => (0, import_react2.createElement)(
      "div",
      {
        key: `voice-preset-${index}`,
        className: "imqb2-voice-row"
      },
      (0, import_react2.createElement)("input", {
        className: "imqb2-input imqb2-voice-name",
        value: row.name ?? "",
        placeholder: "\u540D\u79F0\uFF08\u5982 \u5143\u6C14\u5C11\u5973\uFF09",
        spellCheck: false,
        autoComplete: "off",
        onChange: (event) => {
          updateRow(index, { name: event.currentTarget.value });
        }
      }),
      (0, import_react2.createElement)("input", {
        className: "imqb2-input imqb2-voice-id",
        value: row.voice ?? "",
        placeholder: "\u97F3\u8272 id\uFF08\u5982 longanfengyue_v3.1 \u6216\u514B\u9686\u97F3\u8272 id\uFF09",
        spellCheck: false,
        autoComplete: "off",
        onChange: (event) => {
          updateRow(index, { voice: event.currentTarget.value });
        }
      }),
      (0, import_react2.createElement)("button", {
        type: "button",
        className: "imqb2-chip-x",
        "aria-label": `\u5220\u9664\u97F3\u8272 ${(row.name ?? "").trim() || index + 1}`,
        title: "\u5220\u9664\u8FD9\u4E2A\u97F3\u8272",
        onClick: () => {
          onChange(value.filter((_, i) => i !== index));
        }
      }, "\xD7")
    )),
    (0, import_react2.createElement)("button", {
      type: "button",
      className: "imqb2-persona-add",
      onClick: () => {
        onChange([{ name: "", voice: "" }, ...value]);
      }
    }, "\uFF0B \u6DFB\u52A0\u97F3\u8272"),
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint" },
      "\u8FD9\u91CC\u586B\u7684\u662F\u4F60\u81EA\u5DF1\u7684\u58F0\u97F3\u590D\u523B / \u58F0\u97F3\u8BBE\u8BA1\u97F3\u8272 id\uFF08\u7ED1\u5B9A\u5728\u521B\u5EFA\u5B83\u7684\u8D26\u53F7\u4E0A\uFF1B\u65E7\u4EE3\u9645\u7684\u97F3\u8272\u5728 3.1 \u6A21\u578B\u4E0B\u901A\u5E38\u4E5F\u80FD\u7528\uFF0C\u4F46\u5B98\u65B9\u672A\u627F\u8BFA\uFF09\uFF0C\u4E0B\u62C9\u91CC\u6392\u5728\u5185\u7F6E\u7CFB\u7EDF\u97F3\u8272\u4E4B\u524D\uFF1B\u7559\u7A7A\u7684\u97F3\u8272 id \u4FDD\u5B58\u65F6\u4F1A\u88AB\u4E22\u5F03\u3002"
    )
  );
}
function AreaRow({ label, help, value, rows, onChange }) {
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)("span", { className: "imqb2-label" }, label),
    (0, import_react2.createElement)("textarea", {
      className: "imqb2-input imqb2-textarea",
      value,
      rows: rows ?? 3,
      onChange: (event) => {
        onChange(event.currentTarget.value);
      }
    }),
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, help)
  );
}
function SegmentedRow({ label, help, value, options, onChange }) {
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field" },
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-head" },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, label),
      (0, import_react2.createElement)(Segmented, { value, options, onChange, label })
    ),
    help === void 0 ? null : (0, import_react2.createElement)("p", { className: "imqb2-hint" }, help)
  );
}
function ToolPicker({ selected, available, onChange }) {
  const chosen = selected.map((name2) => name2.trim()).filter(Boolean);
  const groups = groupToolNames(available.filter((name2) => !chosen.includes(name2)));
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-field", style: { padding: "4px 0 0", borderTop: 0 } },
    chosen.length === 0 ? (0, import_react2.createElement)("p", { className: "imqb2-hint" }, "\u8FD8\u6CA1\u9009\u4EFB\u4F55\u5DE5\u5177\uFF1A\u7559\u7A7A = \u8BE5\u4EBA\u683C\u6CA1\u6709\u4EFB\u4F55\u5DE5\u5177\u80FD\u529B\u3002") : (0, import_react2.createElement)(
      "div",
      { className: "imqb2-chips" },
      chosen.map((name2) => (0, import_react2.createElement)(
        "span",
        { key: name2, className: "imqb2-chip" },
        name2,
        (0, import_react2.createElement)("button", {
          type: "button",
          className: "imqb2-chip-x",
          "aria-label": `\u79FB\u9664 ${name2}`,
          title: `\u79FB\u9664 ${name2}`,
          onClick: () => {
            onChange(chosen.filter((item) => item !== name2));
          }
        }, "\xD7")
      ))
    ),
    (0, import_react2.createElement)(
      "select",
      {
        className: "imqb2-input imqb2-select",
        "aria-label": "\u6DFB\u52A0\u5DE5\u5177",
        value: "",
        onChange: (event) => {
          const name2 = event.currentTarget.value;
          if (name2 !== "") onChange([...chosen, name2]);
        }
      },
      (0, import_react2.createElement)(
        "option",
        { value: "" },
        groups.length === 0 ? "\u5DF2\u9009\u5B8C\u5168\u90E8\u53EF\u7528\u5DE5\u5177" : "\uFF0B \u9009\u62E9\u8981\u5141\u8BB8\u7684\u5DE5\u5177\u2026"
      ),
      groups.map(({ group, tools }) => (0, import_react2.createElement)(
        "optgroup",
        { key: group, label: group },
        tools.map((tool) => (0, import_react2.createElement)(
          "option",
          { key: tool.name, value: tool.name },
          `${tool.label}\uFF08${tool.name}\uFF09`
        ))
      ))
    )
  );
}
function PersonaCard({ index, value, expanded, available, voiceOptions, onChange, onToggle, onRemove }) {
  const title = value.name.trim() || value.id.trim() || `\u4EBA\u683C ${index + 1}`;
  const kaomojiEnabled = value.expressions?.kaomoji?.enabled === true;
  const kaomojiStyle = kaomojiEnabled ? value.expressions?.kaomoji?.style?.trim() || "daily" : "";
  const voiceId = value.expressions?.voice?.voice?.trim() ?? "";
  const voiceLabel = voiceOptionLabel(voiceOptions, voiceId);
  const subtitle = [
    value.id.trim(),
    value.tools === void 0 ? void 0 : `\u5DE5\u5177 ${value.tools.filter((t) => t.trim()).length}`,
    kaomojiEnabled ? `\u989C\u6587\u5B57\xB7${findKaomojiStyle(kaomojiStyle)?.name ?? kaomojiStyle}` : void 0,
    voiceId !== "" ? `\u8BED\u97F3\xB7${voiceLabel}` : void 0,
    (value.expressions?.voice?.instruction ?? "").trim() !== "" ? "\u60C5\u611F\u6307\u4EE4" : void 0
  ].filter((part) => part !== void 0).join(" \xB7 ");
  const updatePersonaVoice = (next) => {
    const { voice: _removedVoice, ...restExpressions } = value.expressions ?? {};
    const merged = { ...value.expressions?.voice, ...next };
    const nextVoice = {};
    if ((merged.voice ?? "").trim() !== "") nextVoice.voice = merged.voice;
    if (merged.rate !== void 0) nextVoice.rate = merged.rate;
    if (merged.volume !== void 0) nextVoice.volume = merged.volume;
    const instruction = (merged.instruction ?? "").trim();
    if (instruction !== "") nextVoice.instruction = instruction;
    const hasVoice = Object.keys(nextVoice).length > 0;
    const expressions = hasVoice ? { ...restExpressions, voice: nextVoice } : restExpressions;
    onChange({ expressions: Object.keys(expressions).length > 0 ? expressions : void 0 });
  };
  return (0, import_react2.createElement)(
    "div",
    { className: "imqb2-persona" },
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-persona-head" },
      (0, import_react2.createElement)(
        "button",
        {
          type: "button",
          className: "imqb2-persona-toggle",
          "aria-expanded": expanded,
          title: expanded ? "\u6536\u8D77" : "\u5C55\u5F00\u7F16\u8F91",
          onClick: onToggle
        },
        (0, import_react2.createElement)("span", {
          className: "imqb2-persona-arrow",
          "data-expanded": expanded
        }, "\u25B6"),
        (0, import_react2.createElement)("span", { className: "imqb2-persona-title" }, title),
        (0, import_react2.createElement)("span", { className: "imqb2-persona-sub" }, subtitle)
      ),
      (0, import_react2.createElement)("button", {
        type: "button",
        className: "imqb2-persona-remove",
        onClick: onRemove
      }, "\u5220\u9664")
    ),
    expanded ? (0, import_react2.createElement)(
      "div",
      { className: "imqb2-persona-body" },
      (0, import_react2.createElement)("input", {
        className: "imqb2-input",
        value: value.id,
        spellCheck: false,
        placeholder: "id\uFF08\u5B57\u6BCD/\u6570\u5B57/-/_\uFF0CQQ \u7AEF /persona <id> \u7528\uFF09",
        onChange: (event) => {
          onChange({ id: event.currentTarget.value });
        }
      }),
      (0, import_react2.createElement)("input", {
        className: "imqb2-input",
        value: value.name,
        spellCheck: false,
        placeholder: "\u5C55\u793A\u540D\u79F0\uFF08QQ \u83DC\u5355\u91CC\u663E\u793A\uFF09",
        onChange: (event) => {
          onChange({ name: event.currentTarget.value });
        }
      }),
      (0, import_react2.createElement)("textarea", {
        className: "imqb2-input imqb2-textarea",
        value: value.prompt,
        rows: 5,
        placeholder: "\u8BE5\u4EBA\u683C\u7684 system prompt\uFF08\u53EA\u5199\u89D2\u8272\u8BBE\u5B9A/\u8BF4\u8BDD\u98CE\u683C\uFF09",
        onChange: (event) => {
          onChange({ prompt: event.currentTarget.value });
        }
      }),
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-field", style: { padding: "8px 0 4px", borderTop: 0 } },
        (0, import_react2.createElement)(
          "div",
          { className: "imqb2-head" },
          (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u989C\u6587\u5B57"),
          (0, import_react2.createElement)(Switch, {
            checked: kaomojiEnabled,
            label: "\u989C\u6587\u5B57",
            onChange: (checked) => {
              if (!checked) {
                const { kaomoji: _kaomoji, ...rest } = value.expressions ?? {};
                onChange({ expressions: Object.keys(rest).length > 0 ? rest : void 0 });
                return;
              }
              const current = value.expressions?.kaomoji;
              onChange({
                expressions: {
                  ...value.expressions,
                  kaomoji: {
                    ...current,
                    enabled: true,
                    style: current?.style?.trim() || DEFAULT_KAOMOJI_STYLE
                  }
                }
              });
            }
          })
        ),
        kaomojiEnabled ? (0, import_react2.createElement)(
          "div",
          { className: "imqb2-head", style: { marginTop: "6px" } },
          (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u98CE\u683C"),
          (0, import_react2.createElement)(
            "select",
            {
              className: "imqb2-input imqb2-select",
              style: { width: "auto", minWidth: "160px" },
              "aria-label": "\u989C\u6587\u5B57\u98CE\u683C",
              value: kaomojiStyle || DEFAULT_KAOMOJI_STYLE,
              onChange: (event) => {
                const style = event.currentTarget.value;
                const current = value.expressions?.kaomoji;
                onChange({
                  expressions: {
                    ...value.expressions,
                    kaomoji: { ...current, enabled: true, style }
                  }
                });
              }
            },
            KAOMOJI_STYLES.map((style) => (0, import_react2.createElement)(
              "option",
              { key: style.id, value: style.id },
              `${style.name}\uFF08${style.id}\uFF09`
            ))
          )
        ) : null,
        (0, import_react2.createElement)(
          "p",
          { className: "imqb2-hint" },
          "\u5F00\u542F\u540E\u628A\u8BE5\u98CE\u683C\u7684\u989C\u6587\u5B57\u6E05\u5355\u5199\u8FDB system prompt\uFF0C\u6A21\u578B\u6309\u8BED\u5883\u81EA\u7136\u4F7F\u7528\uFF08\u9ED8\u8BA4\u4E00\u6761\u56DE\u590D\u6700\u591A 1 \u4E2A\uFF09\uFF0C\u4E0D\u9700\u8981\u5DE5\u5177\u8C03\u7528\u3002"
        )
      ),
      (0, import_react2.createElement)(VoiceSelectField, {
        label: "\u8BED\u97F3\u97F3\u8272",
        value: value.expressions?.voice?.voice ?? "",
        placeholder: "\uFF08\u7559\u7A7A\uFF0C\u7EE7\u627F\u5168\u5C40\u97F3\u8272\uFF09",
        options: voiceOptions,
        help: "\u4ECE\u4E0B\u62C9\u91CC\u9009\u5185\u7F6E\u7CFB\u7EDF\u97F3\u8272\u6216\u81EA\u5B9A\u4E49\u97F3\u8272\uFF1B\u7559\u7A7A\u7EE7\u627F\u5168\u5C40\u97F3\u8272\u3002\u6807\u4E86\u300C\u9700 xxx \u6A21\u578B\u300D\u7684\u97F3\u8272\u4E0E\u5F53\u524D\u8BED\u97F3\u6A21\u578B\u4E0D\u5339\u914D\uFF0C\u9700\u8981\u5148\u628A\u5168\u5C40\u300C\u8BED\u97F3\u6A21\u578B\u300D\u6539\u8FC7\u53BB\u3002",
        onChange: (nextVoiceId) => {
          updatePersonaVoice({ voice: nextVoiceId });
        }
      }),
      (0, import_react2.createElement)(FieldRow, {
        label: "\u8BED\u97F3\u60C5\u611F/\u8BED\u6C14\uFF08\u53EF\u9009\uFF09",
        value: value.expressions?.voice?.instruction ?? "",
        placeholder: "\u5982\uFF1A\u7528\u6E05\u51B7\u3001\u514B\u5236\u7684\u8BED\u6C14\uFF0C\u8BED\u901F\u7A0D\u6162",
        help: "\u81EA\u7136\u8BED\u8A00\u6307\u4EE4\uFF0C\u5408\u6210\u65F6\u968F\u8BF7\u6C42\u4E0B\u53D1\uFF1B\u7559\u7A7A\u7EE7\u627F\u5168\u5C40\u300C\u60C5\u611F/\u8BED\u6C14\u6307\u4EE4\u300D\u3002qwen-audio-3.1/3.0-tts-plus/flash \u652F\u6301\u3002",
        onChange: (next) => {
          updatePersonaVoice({ instruction: next });
        }
      }),
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u9650\u5236\u53EF\u7528\u5DE5\u5177"),
        (0, import_react2.createElement)(Switch, {
          checked: value.tools !== void 0,
          label: "\u9650\u5236\u53EF\u7528\u5DE5\u5177",
          onChange: (checked) => {
            onChange({ tools: checked ? [] : void 0 });
          }
        })
      ),
      value.tools === void 0 ? (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        "\u5173\u95ED\u65F6\u4F7F\u7528\u9ED8\u8BA4\u653E\u884C\u6E05\u5355\uFF08\u63D2\u4EF6\u5185\u7F6E\u5DE5\u5177 + \u53EA\u8BFB\u8054\u7F51/\u63D0\u95EE\uFF09\uFF1B\u5F00\u542F\u540E\u6A21\u578B\u53EA\u80FD\u770B\u5230\u4E0B\u9762\u9009\u4E2D\u7684\u5DE5\u5177\uFF08\u786C\u7EA6\u675F\uFF0C\u4E0D\u662F\u63D0\u793A\u8BCD\uFF09\u3002"
      ) : (0, import_react2.createElement)(ToolPicker, {
        selected: value.tools,
        available,
        onChange: (next) => {
          onChange({ tools: next });
        }
      }),
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        "\u5019\u9009\u53EA\u6709 QQ \u63D2\u4EF6\u5185\u7F6E\u5DE5\u5177\uFF08\u505A\u9898 / \u770B\u56FE / \u53D1\u6587\u4EF6 / \u7FFB\u8BD1 / \u603B\u7ED3 / \u8BB2\u89E3 / \u6539\u5199\uFF09\uFF1B\u6587\u4EF6\u8BFB\u5199\u3001\u547D\u4EE4\u6267\u884C\u7B49\u5BBF\u4E3B\u80FD\u529B\u9ED8\u8BA4\u4E0D\u5F00\u653E\u3002"
      )
    ) : null
  );
}
var MODE_OPTIONS = [
  { value: "open", label: "\u6240\u6709\u4EBA" },
  { value: "allowlist", label: "\u767D\u540D\u5355" },
  { value: "disabled", label: "\u7981\u7528" }
];
var SPLIT_OPTIONS = [
  { value: "none", label: "\u6309\u957F\u5EA6" },
  { value: "delimiter", label: "\u7EA6\u5B9A\u5206\u9694\u7B26" },
  { value: "line", label: "\u6BCF\u4E2A\u6362\u884C" },
  { value: "paragraph", label: "\u6309\u7A7A\u884C" }
];
var TABS = [
  { id: "access", label: "\u670D\u52A1\u8303\u56F4", keys: ["access"] },
  { id: "identity", label: "\u8EAB\u4EFD\u4E0E\u6743\u9650", keys: ["identity"] },
  { id: "members", label: "\u7FA4\u53CB\u4EBA\u683C", keys: ["personaAnalysis"] },
  {
    id: "conversation",
    label: "\u5BF9\u8BDD\u8BBE\u7F6E",
    keys: ["requireMention", "streaming", "replySplitMode", "replySplitIntervalMs", "showToolResults"]
  },
  { id: "voice", label: "\u8BED\u97F3\u56DE\u590D", keys: ["voice"] },
  { id: "sticker", label: "\u8868\u60C5\u5305\u8FDB\u5316", keys: ["sticker"] },
  { id: "model", label: "\u6A21\u578B\u4E0E\u63D0\u793A\u8BCD", keys: ["provider", "model", "preset", "globalPrompt"] },
  { id: "personas", label: "\u4EBA\u683C\u9884\u8BBE", keys: ["personas", "defaultPersona"] },
  // 插件更新不是配置项（keys 为空，永远不会出现「未保存」小圆点）
  { id: "update", label: "\u63D2\u4EF6\u66F4\u65B0", keys: [] }
];
function updateKindLabel(kind) {
  switch (kind) {
    case "git":
      return "Git \u5B89\u88C5";
    case "npm":
      return "npm \u5B89\u88C5";
    case "local":
      return "\u672C\u5730\u8DEF\u5F84\u5B89\u88C5";
    default:
      return "\u672A\u77E5\u5B89\u88C5\u65B9\u5F0F";
  }
}
function shortHash(ref) {
  return /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}
function shallowEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function ConfigPanel(props) {
  useConfigPanelStyles();
  const [initial, setInitial] = (0, import_react2.useState)(null);
  const [form, setForm] = (0, import_react2.useState)(null);
  const [discoveredTools, setDiscoveredTools] = (0, import_react2.useState)([]);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [result, setResult] = (0, import_react2.useState)(null);
  const [loadError, setLoadError] = (0, import_react2.useState)(null);
  const [expandedPersonas, setExpandedPersonas] = (0, import_react2.useState)(() => /* @__PURE__ */ new Set());
  const [activeTab, setActiveTab] = (0, import_react2.useState)("access");
  const [updateInfo, setUpdateInfo] = (0, import_react2.useState)(null);
  const [updateCheck, setUpdateCheck] = (0, import_react2.useState)(null);
  const [updateBusy, setUpdateBusy] = (0, import_react2.useState)(null);
  const [updateError, setUpdateError] = (0, import_react2.useState)(null);
  const [updateNotice, setUpdateNotice] = (0, import_react2.useState)(null);
  const [confirmUpdate, setConfirmUpdate] = (0, import_react2.useState)(false);
  const bindPhase = props?.bindPhase;
  (0, import_react2.useEffect)(() => {
    let stopped = false;
    void fetch(BIND_CONFIG_PATH, { cache: "no-store" }).then(async (res) => {
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
  (0, import_react2.useEffect)(() => {
    if (activeTab !== "update" || updateInfo !== null) return;
    let stopped = false;
    void fetch(BIND_UPDATE_PATH, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (stopped) return;
      if (body.install !== void 0) setUpdateInfo(body.install);
      else if (res.status === 404) {
        setUpdateError("\u63D2\u4EF6\u670D\u52A1\u7AEF\u4ECD\u5728\u8DD1\u65E7\u4EE3\u7801\uFF08\u627E\u4E0D\u5230\u66F4\u65B0\u63A5\u53E3\uFF09\u3002\u8BF7\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u542F DSH\uFF08\u4E0D\u662F\u53EA\u5173\u7A97\u53E3\uFF09\u540E\u91CD\u8BD5\u3002");
      } else setUpdateError(body.error ?? `\u8BFB\u53D6\u5B89\u88C5\u4FE1\u606F\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    }).catch((err) => {
      if (!stopped) setUpdateError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      stopped = true;
    };
  }, [activeTab, updateInfo]);
  const patch = (0, import_react2.useCallback)((key, value) => {
    setForm((current) => current === null ? current : { ...current, [key]: value });
    setResult(null);
  }, []);
  const submit = (0, import_react2.useCallback)((event) => {
    event.preventDefault();
    if (busy || initial === null || form === null) return;
    const changed = {};
    for (const key of Object.keys(form)) {
      if (!shallowEqual(form[key], initial[key])) {
        changed[key] = form[key];
      }
    }
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
    if (changed.personas !== void 0) {
      changed.personas = changed.personas.map((p) => ({
        id: p.id.trim(),
        name: p.name.trim(),
        prompt: p.prompt,
        ...p.tools !== void 0 ? { tools: [...new Set(p.tools.map((t) => t.trim()).filter(Boolean))] } : {},
        // 表达方式（颜文字 / 语音音色）：不提交会被服务端整体替换掉
        ...p.expressions !== void 0 ? { expressions: p.expressions } : {}
      }));
    }
    if (changed.defaultPersona !== void 0) {
      changed.defaultPersona = String(changed.defaultPersona).trim();
    }
    if (changed.voice !== void 0) {
      const v = changed.voice;
      const { hasApiKey: _hasApiKey, ...rest } = v;
      const maxChars = Math.round(Number(rest.maxChars));
      const timeoutMs = Math.round(Number(rest.timeoutMs));
      const presets = (rest.presets ?? []).map((entry) => ({ name: (entry.name ?? "").trim(), voice: (entry.voice ?? "").trim() })).filter((entry) => entry.voice !== "");
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
    void fetch(BIND_CONFIG_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changed)
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok === true) {
        setResult({ ok: true, message: body.message ?? "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u63D2\u4EF6\u5C06\u81EA\u52A8\u91CD\u8F7D" });
        let nextForm = form;
        if (changed.voice !== void 0) {
          const submitted = changed.voice;
          const hasKey = submitted.clearApiKey === true ? false : (submitted.apiKey ?? "").trim() !== "" || form.voice?.hasApiKey === true;
          nextForm = {
            ...form,
            voice: { ...form.voice, apiKey: "", clearApiKey: false, hasApiKey: hasKey }
          };
          setForm(nextForm);
        }
        setInitial(nextForm);
        return;
      }
      setResult({ ok: false, message: body.error ?? `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09` });
    }).catch((err) => {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }).finally(() => {
      setBusy(false);
    });
  }, [busy, form, initial]);
  const runUpdateAction = (0, import_react2.useCallback)((action) => {
    setUpdateBusy(action);
    setUpdateError(null);
    setUpdateNotice(null);
    void fetch(BIND_UPDATE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (body.install !== void 0) setUpdateInfo(body.install);
      if (body.check !== void 0) setUpdateCheck(body.check);
      if (body.ok === true) {
        if (action === "update") {
          setUpdateNotice(body.message ?? "\u66F4\u65B0\u5B8C\u6210");
          setConfirmUpdate(false);
          setUpdateCheck(null);
        }
        return;
      }
      setUpdateError(body.error ?? `\u64CD\u4F5C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    }).catch((err) => {
      setUpdateError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      setUpdateBusy(null);
    });
  }, []);
  if (loadError !== null) {
    return (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "12px 0" } },
      `\u914D\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF1A${loadError}`
    );
  }
  if (initial === null || form === null) {
    return (0, import_react2.createElement)("p", { className: "imqb2-hint", style: { padding: "12px 0" } }, "\u6B63\u5728\u52A0\u8F7D\u914D\u7F6E\u2026");
  }
  const changedKeys = Object.keys(form).filter((key) => !shallowEqual(form[key], initial[key]));
  const dirty = changedKeys.length > 0;
  const access = form.access ?? { c2cMode: "allowlist", c2cAllow: [], groupMode: "open", groupAllow: [] };
  const identity = form.identity ?? { enabled: true, ownerOpenIds: [], adminOpenIds: [], friendOpenIds: [] };
  const personaAnalysis = form.personaAnalysis ?? { enabled: true, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20 };
  const personas = form.personas ?? [];
  const voice = form.voice ?? {};
  const voiceOptions = buildVoiceOptions(voice.presets, voice.model);
  const customPresetCount = (voice.presets ?? []).filter((entry) => (entry.voice ?? "").trim() !== "").length;
  const toolCandidates = mergeToolNames(
    discoveredTools.filter((name2) => isPluginToolName(name2)),
    catalogToolNames(),
    ...personas.map((persona) => (persona.tools ?? []).filter((name2) => isPluginToolName(name2)))
  );
  const updatePersona = (index, next) => {
    const list = [...form.personas ?? []];
    const current = list[index];
    if (current === void 0) return;
    list[index] = { ...current, ...next };
    patch("personas", list);
    if (next.id !== void 0 && current.id !== "" && form.defaultPersona === current.id) {
      patch("defaultPersona", next.id);
    }
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
    patch("personas", [...list, { id: `persona-${n}`, name: `\u4EBA\u683C ${n}`, prompt: "" }]);
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
    if (removedId !== void 0 && removedId !== "" && form.defaultPersona === removedId) {
      patch("defaultPersona", "");
    }
  };
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
        expressions: { ...persona.expressions, voice: { ...persona.expressions?.voice, voice: mapped } }
      };
    });
    if (personasChanged) patch("personas", nextPersonas);
  };
  const tabDirty = (tab) => tab.keys.some((key) => changedKeys.includes(key));
  const accessPanel = [
    (0, import_react2.createElement)(SegmentedRow, {
      label: "\u79C1\u804A",
      value: access.c2cMode,
      options: MODE_OPTIONS,
      onChange: (v) => {
        patch("access", { ...access, c2cMode: v });
      }
    }),
    access.c2cMode === "allowlist" ? (0, import_react2.createElement)(AreaRow, {
      label: "\u79C1\u804A\u767D\u540D\u5355",
      help: "\u8BF7\u8F93\u5165\u7528\u6237 openid\uFF0C\u591A\u4E2A\u8BF7\u6362\u884C\u8F93\u5165",
      rows: 3,
      value: access.c2cAllow.join("\n"),
      onChange: (v) => {
        patch("access", { ...access, c2cAllow: v.split("\n").map((s) => s.trim()) });
      }
    }) : null,
    (0, import_react2.createElement)(SegmentedRow, {
      label: "\u7FA4\u804A",
      value: access.groupMode,
      options: MODE_OPTIONS,
      onChange: (v) => {
        patch("access", { ...access, groupMode: v });
      }
    }),
    access.groupMode === "allowlist" ? (0, import_react2.createElement)(AreaRow, {
      label: "\u7FA4\u804A\u767D\u540D\u5355",
      help: "\u8BF7\u8F93\u5165\u7FA4 openid\uFF0C\u591A\u4E2A\u8BF7\u6362\u884C\u8F93\u5165",
      rows: 3,
      value: access.groupAllow.join("\n"),
      onChange: (v) => {
        patch("access", { ...access, groupAllow: v.split("\n").map((s) => s.trim()) });
      }
    }) : null,
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "8px 0 0" } },
      "openid \u53EF\u5728 QQ \u91CC\u5BF9\u673A\u5668\u4EBA\u53D1\u9001 /whoami \u67E5\u770B\uFF1B\u79C1\u804A\u4E0E\u7FA4\u804A\u662F\u4E24\u5957\u503C\u3002"
    )
  ];
  const identityPanel = [
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u8EAB\u4EFD\u8BC6\u522B",
      checked: identity.enabled,
      help: "\u6309 openid \u5224\u5B9A\u53D1\u9001\u8005\u8EAB\u4EFD\uFF0C\u5E76\u5728\u6D88\u606F\u524D\u6CE8\u5165 [\u8EAB\u4EFD: \u4E3B\u4EBA / \u7BA1\u7406\u5458 / \u670B\u53CB / \u964C\u751F\u4EBA]\uFF1B\u4E09\u4EFD\u540D\u5355\u90FD\u4E3A\u7A7A\u65F6\u4E0D\u6CE8\u5165\uFF0C\u4FDD\u6301\u65E7\u884C\u4E3A",
      onChange: (v) => {
        patch("identity", { ...identity, enabled: v });
      }
    }),
    identity.enabled ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "0 0 8px" } },
      "\u5728 QQ \u91CC\u5BF9\u673A\u5668\u4EBA\u53D1\u9001 /whoami \u53EF\u67E5\u770B\u5E76\u590D\u5236\u81EA\u5DF1\u7684 openid\u3002\u79C1\u804A\uFF08user_openid\uFF09\u4E0E\u7FA4\u804A\uFF08member_openid\uFF09\u662F\u4E24\u5957\u503C\uFF0C\u9700\u8981\u5206\u522B\u6DFB\u52A0\u3002"
    ) : null,
    identity.enabled ? (0, import_react2.createElement)(AreaRow, {
      label: "\u4E3B\u4EBA openid",
      rows: 2,
      help: "\u5BF9\u5E94\u300C\u8EAB\u4EFD: \u4E3B\u4EBA\u300D\uFF0C\u4EBA\u683C\u91CC\u7684\u4E13\u5C5E\u79F0\u547C\u53EA\u5BF9\u8FD9\u4E9B\u4EBA\u751F\u6548\uFF1B\u4E00\u884C\u4E00\u4E2A",
      value: identity.ownerOpenIds.join("\n"),
      onChange: (v) => {
        patch("identity", { ...identity, ownerOpenIds: v.split("\n").map((s) => s.trim()) });
      }
    }) : null,
    identity.enabled ? (0, import_react2.createElement)(AreaRow, {
      label: "\u7BA1\u7406\u5458 openid",
      rows: 2,
      help: "\u5BF9\u5E94\u300C\u8EAB\u4EFD: \u7BA1\u7406\u5458\u300D\uFF0C\u6309\u719F\u4EBA\u5BF9\u5F85\u4F46\u4E0D\u5957\u7528\u4E3B\u4EBA\u8BBE\u5B9A\uFF1B\u4E00\u884C\u4E00\u4E2A",
      value: identity.adminOpenIds.join("\n"),
      onChange: (v) => {
        patch("identity", { ...identity, adminOpenIds: v.split("\n").map((s) => s.trim()) });
      }
    }) : null,
    identity.enabled ? (0, import_react2.createElement)(AreaRow, {
      label: "\u670B\u53CB openid",
      rows: 2,
      help: "\u5BF9\u5E94\u300C\u8EAB\u4EFD: \u670B\u53CB\u300D\uFF0C\u5176\u4F59\u672A\u547D\u4E2D\u540D\u5355\u7684\u4EBA\u90FD\u662F\u300C\u964C\u751F\u4EBA\u300D\uFF1B\u4E00\u884C\u4E00\u4E2A",
      value: identity.friendOpenIds.join("\n"),
      onChange: (v) => {
        patch("identity", { ...identity, friendOpenIds: v.split("\n").map((s) => s.trim()) });
      }
    }) : null
  ];
  const membersPanel = [
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u7FA4\u804A\u4EBA\u683C\u6863\u6848",
      checked: personaAnalysis.enabled,
      help: "\u6309\u4F1A\u8BDD\u6EDA\u52A8\u4FDD\u5B58\u7FA4\u804A/\u79C1\u804A\u6D88\u606F\uFF08~/.dsh-qqbot/persona-archive.json\uFF09\uFF0C\u4F9B\u4EBA\u683C\u5206\u6790\u603B\u7ED3\u7FA4\u53CB\u7684\u8BF4\u8BDD\u98CE\u683C\u4E0E\u6027\u683C\uFF1B\u53EA\u5B58\u672C\u673A\u3001\u4E0D\u4E0A\u4F20\uFF0C\u5173\u95ED\u540E\u4E0D\u518D\u8BB0\u5F55\u65B0\u6D88\u606F\uFF08\u5DF2\u6709\u6863\u6848\u4FDD\u7559\uFF09",
      onChange: (v) => {
        patch("personaAnalysis", { ...personaAnalysis, enabled: v });
      }
    }),
    personaAnalysis.enabled ? (0, import_react2.createElement)(FieldRow, {
      label: "\u6BCF\u4E2A\u4F1A\u8BDD\u6700\u591A\u4FDD\u7559\u6761\u6570",
      value: String(personaAnalysis.maxMessages),
      placeholder: "300",
      help: "\u8D85\u51FA\u540E\u6DD8\u6C70\u6700\u65E7\u7684\u6D88\u606F\uFF0820\u20131000\uFF09\uFF1B\u6761\u6570\u8D8A\u591A\uFF0C\u4EBA\u683C\u603B\u7ED3\u7684\u4F9D\u636E\u8D8A\u5145\u5206\uFF0C\u6863\u6848\u6587\u4EF6\u4E5F\u8D8A\u5927",
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch("personaAnalysis", {
          ...personaAnalysis,
          maxMessages: Number.isFinite(n) ? Math.min(1e3, Math.max(20, n)) : 300
        });
      }
    }) : null,
    personaAnalysis.enabled ? (0, import_react2.createElement)(FieldRow, {
      label: "\u6D88\u606F\u4FDD\u7559\u5929\u6570",
      value: String(personaAnalysis.retentionDays),
      placeholder: "30",
      help: "\u8D85\u8FC7\u5929\u6570\u7684\u8BB0\u5F55\u4F1A\u5728\u542F\u52A8\u4E0E\u5199\u5165\u65F6\u6E05\u7406\uFF081\u2013365\uFF09\uFF1B\u5220\u9664\u6863\u6848\u6587\u4EF6\u53EF\u7ACB\u5373\u6E05\u7A7A\u5168\u90E8\u8BB0\u5F55",
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch("personaAnalysis", {
          ...personaAnalysis,
          retentionDays: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 30
        });
      }
    }) : null,
    personaAnalysis.enabled ? (0, import_react2.createElement)(SwitchRow, {
      label: "\u81EA\u52A8\u83B7\u53D6\u4EBA\u683C",
      checked: personaAnalysis.autoAnalyze,
      help: "\u67D0\u4F4D\u7FA4\u53CB\u7D2F\u8BA1\u53D1\u8A00\u8FBE\u5230\u9608\u503C\u540E\u81EA\u52A8\u751F\u6210\u4EBA\u683C\u6863\u6848\uFF1B\u4E4B\u540E\u6BCF\u65B0\u589E\u540C\u6837\u6761\u6570\u518D\u66F4\u65B0\u4E00\u6B21\uFF0C\u5931\u8D25\u4F1A\u51B7\u5374 10 \u5206\u949F\u3002\u5173\u95ED\u540E\u53EA\u80FD\u624B\u52A8\u8BA9\u673A\u5668\u4EBA\u5206\u6790",
      onChange: (v) => {
        patch("personaAnalysis", { ...personaAnalysis, autoAnalyze: v });
      }
    }) : null,
    personaAnalysis.enabled && personaAnalysis.autoAnalyze ? (0, import_react2.createElement)(FieldRow, {
      label: "\u81EA\u52A8\u5206\u6790\u89E6\u53D1\u6761\u6570",
      value: String(personaAnalysis.autoAnalyzeThreshold),
      placeholder: "20",
      help: "\u7D2F\u8BA1\u53D1\u8A00\u8FBE\u5230\u8FD9\u4E2A\u6761\u6570\u5C31\u81EA\u52A8\u5206\u6790\u4E00\u6B21\uFF085\u2013200\uFF09\uFF1B\u6570\u503C\u8D8A\u5C0F\u6863\u6848\u66F4\u65B0\u8D8A\u9891\u7E41\uFF0C\u6A21\u578B\u8C03\u7528\u4E5F\u8D8A\u591A",
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch("personaAnalysis", {
          ...personaAnalysis,
          autoAnalyzeThreshold: Number.isFinite(n) ? Math.min(200, Math.max(5, n)) : 20
        });
      }
    }) : null,
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "0 0 8px" } },
      "\u91C7\u96C6\u8303\u56F4\uFF1AQQ \u5B98\u65B9\u53EA\u5411\u666E\u901A\u7FA4\u673A\u5668\u4EBA\u63A8\u9001\u88AB @ \u7684\u7FA4\u6D88\u606F\uFF08GROUP_AT_MESSAGE_CREATE\uFF09\uFF0C\u7FA4\u53CB\u6CA1 @ \u673A\u5668\u4EBA\u7684\u53D1\u8A00\u5E73\u53F0\u4E0D\u4F1A\u4E0B\u53D1\uFF1B\u5F00\u901A\u79C1\u57DF / \u5168\u91CF\u7FA4\u6D88\u606F\u6743\u9650\u540E\u8FD8\u4F1A\u6536\u5230 GROUP_MESSAGE_CREATE\uFF0C\u5C4A\u65F6\u7FA4\u5185\u6BCF\u6761\u53D1\u8A00\u90FD\u4F1A\u8FDB\u6863\u6848\u3002\u53E6\u5916\u5B98\u65B9\u4E0D\u63D0\u4F9B\u4EFB\u610F\u7FA4\u7684\u5386\u53F2\u6D88\u606F\uFF0C\u673A\u5668\u4EBA\u672A\u4E0A\u7EBF\u671F\u95F4\u7684\u6D88\u606F\u65E0\u6CD5\u8865\u5F55\u3002\u540C\u4E00\u4E2A openid \u5728\u591A\u4E2A\u7FA4/\u79C1\u804A\u7684\u53D1\u8A00\u4F1A\u5408\u5E76\u6210\u4E00\u4EFD\u6863\u6848\uFF1B\u8868\u683C\u53EF\u6309\u6635\u79F0\u3001openid\u3001\u4EBA\u683C\u7279\u70B9\u7B5B\u9009\uFF0C\u5206\u6790\u7ED3\u679C\u4E5F\u53EF\u4F5C\u4E3A\u540E\u7EED\u65B0\u589E\u4EBA\u683C\u7684\u53C2\u8003\u3002"
    ),
    (0, import_react2.createElement)(PersonaProfilesTable, { archived: personaAnalysis.enabled })
  ];
  const conversationPanel = [
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u7FA4\u804A\u4EC5\u56DE\u590D @\u673A\u5668\u4EBA\u7684\u6D88\u606F",
      checked: form.requireMention ?? true,
      help: "\u5F00\u542F\u540E\uFF0C\u673A\u5668\u4EBA\u4EC5\u53EF\u56DE\u590D @\u673A\u5668\u4EBA\u7684\u7FA4\u804A\u6D88\u606F\uFF1B\u5373\u4F7F\u5F00\u901A\u4E86\u5168\u91CF\u7FA4\u6D88\u606F\u6743\u9650\uFF0C\u672A @ \u7684\u53D1\u8A00\u4E5F\u53EA\u8FDB\u6863\u6848\u3001\u4E0D\u56DE\u590D\u3002\u5173\u95ED\u540E\u7FA4\u5185\u6BCF\u6761\u6D88\u606F\u90FD\u4F1A\u89E6\u53D1\u56DE\u590D\uFF08\u6D88\u8017\u989D\u5EA6\u3001\u53EF\u80FD\u5237\u5C4F\uFF09\uFF0C\u8BF7\u8C28\u614E\u64CD\u4F5C",
      onChange: (v) => {
        patch("requireMention", v);
      }
    }),
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u6D41\u5F0F\u8F93\u51FA",
      checked: form.streaming ?? true,
      help: "\u56DE\u590D\u5185\u5BB9\u5206\u6BB5\u5B9E\u65F6\u63A8\u9001\u5230\u804A\u5929\uFF08\u5F00\u542F\u56DE\u590D\u62C6\u5206\u65F6\u81EA\u52A8\u5931\u6548\uFF09",
      onChange: (v) => {
        patch("streaming", v);
      }
    }),
    (0, import_react2.createElement)(SegmentedRow, {
      label: "\u56DE\u590D\u62C6\u5206",
      value: form.replySplitMode ?? "none",
      options: SPLIT_OPTIONS,
      help: "\u63A8\u8350\u300C\u7EA6\u5B9A\u5206\u9694\u7B26\u300D\uFF1A\u6A21\u578B\u8F93\u51FA\u56FA\u5B9A\u5206\u9694\u7B26 ||| \u65F6\u62C6\u6761\uFF1B\u53EA\u8981\u51FA\u73B0\u5206\u9694\u7B26\uFF0C\u6BB5\u5185\u5269\u4F59\u6362\u884C\u4E5F\u4F1A\u62C6\uFF08\u6A21\u578B\u5076\u5C14\u628A\u5206\u9694\u7B26\u6572\u6210\u6362\u884C\uFF09\uFF0C\u6CA1\u51FA\u73B0\u5206\u9694\u7B26\u65F6\u6362\u884C\u4E0D\u62C6\uFF1B\u5F00\u542F\u540E\u81EA\u52A8\u5173\u95ED\u6D41\u5F0F\u8F93\u51FA",
      onChange: (v) => {
        patch("replySplitMode", v);
      }
    }),
    form.replySplitMode === "delimiter" ? (0, import_react2.createElement)("p", {
      className: "imqb2-hint",
      style: { padding: "0 0 8px" }
    }, "\u5206\u9694\u7B26\u56FA\u5B9A\u4E3A |||\uFF08\u4E0D\u53EF\u914D\u7F6E\uFF09\uFF1B\u62C6\u6761\u89C4\u5219\u5199\u5728\u300C\u6A21\u578B\u4E0E\u63D0\u793A\u8BCD\u300D\u7684\u300C\u5168\u5C40\u63D0\u793A\u8BCD\u300D\u91CC\u5373\u53EF\u5BF9\u6574\u4E2A\u673A\u5668\u4EBA\u751F\u6548") : null,
    form.replySplitMode !== void 0 && form.replySplitMode !== "none" ? (0, import_react2.createElement)(FieldRow, {
      label: "\u62C6\u5206\u95F4\u9694(ms)",
      value: String(form.replySplitIntervalMs ?? 0),
      placeholder: "0",
      help: "\u76F8\u90BB\u6D88\u606F\u4E4B\u95F4\u7684\u7B49\u5F85\u65F6\u95F4\uFF0C0 \u8868\u793A\u987A\u5E8F\u7ACB\u5373\u53D1\u9001\uFF1B\u9047\u5230\u5E73\u53F0\u9650\u6D41\u53EF\u8C03\u5927",
      onChange: (v) => {
        const n = Math.max(0, Math.round(Number(v)));
        patch("replySplitIntervalMs", Number.isFinite(n) ? n : 0);
      }
    }) : null,
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u663E\u793A\u5DE5\u5177\u8C03\u7528\u7ED3\u679C",
      checked: form.showToolResults ?? false,
      help: "\u5728\u804A\u5929\u4E2D\u5C55\u793A agent \u5DE5\u5177\u8C03\u7528\u7684\u7ED3\u6784\u5316\u7ED3\u679C",
      onChange: (v) => {
        patch("showToolResults", v);
      }
    })
  ];
  const voiceEnabled = voice.enabled !== false;
  const voicePanel = [
    (0, import_react2.createElement)(SwitchRow, {
      label: "\u542F\u7528\u8BED\u97F3\u56DE\u590D",
      checked: voiceEnabled,
      help: "\u5173\u95ED\u540E\u5373\u4F7F\u5DF2\u4FDD\u5B58 API Key \u4E5F\u4E0D\u4F1A\u6CE8\u518C qqbot_voice \u5DE5\u5177\u3001\u4E0D\u5408\u6210\u3001\u4E0D\u53D1\u8BED\u97F3\uFF1B\u91CD\u65B0\u6253\u5F00\u5373\u53EF\u6062\u590D\uFF0C\u4E0D\u9700\u8981\u6E05\u9664 Key\u3002",
      onChange: (v) => {
        patch("voice", { ...voice, enabled: v });
      }
    }),
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "4px 0 8px" } },
      voiceEnabled ? voice.hasApiKey === true ? "\u8BED\u97F3\u529F\u80FD\u5DF2\u542F\u7528\uFF1A\u7531\u6A21\u578B\u5224\u65AD\u8FD9\u4E00\u8F6E\u8981\u4E0D\u8981\u53D1\u8BED\u97F3\u3002\u9700\u8981\u8BED\u97F3\u65F6\u4F1A\u8C03\u7528 qqbot_voice\uFF0C\u672C\u8F6E\u56DE\u590D\u53EA\u53D1\u8BED\u97F3\u3001\u4E0D\u518D\u91CD\u590D\u53D1\u6587\u5B57\uFF1B\u5408\u6210\u5931\u8D25\u6216\u5185\u5BB9\u4E0D\u9002\u5408\u6717\u8BFB\u65F6\u9000\u56DE\u6587\u5B57\u3002" : "\u8BED\u97F3\u5F00\u5173\u5DF2\u6253\u5F00\uFF0C\u4F46\u8FD8\u6CA1\u6709\u586B\u5199 API Key\uFF1A\u586B\u5199\u5E76\u4FDD\u5B58\u540E\u624D\u4F1A\u771F\u6B63\u751F\u6548\u3002" : "\u8BED\u97F3\u5DF2\u5173\u95ED\uFF1A\u5373\u4F7F\u5DF2\u4FDD\u5B58 API Key \u4E5F\u4E0D\u4F1A\u6CE8\u518C\u8BED\u97F3\u5DE5\u5177\u3001\u4E0D\u5408\u6210\u3001\u4E0D\u53D1\u8BED\u97F3\uFF0C\u4E5F\u4E0D\u6D88\u8017\u989D\u5EA6\uFF1B\u6253\u5F00\u4E0A\u65B9\u5F00\u5173\u5373\u53EF\u6062\u590D\u3002"
    ),
    (0, import_react2.createElement)(FieldRow, {
      label: "DashScope API Key",
      type: "password",
      value: voice.apiKey ?? "",
      placeholder: voice.hasApiKey === true ? "\u5DF2\u4FDD\u5B58\uFF08\u8F93\u5165\u65B0 Key \u53EF\u66FF\u6362\uFF09" : "\u7559\u7A7A\u5219\u4E0D\u542F\u7528\u8BED\u97F3",
      help: "\u5DF2\u4FDD\u5B58\u7684 Key \u4E0D\u4F1A\u56DE\u663E\uFF1B\u7559\u7A7A\u63D0\u4EA4\u8868\u793A\u4FDD\u6301\u73B0\u6709 Key\u3002\u8981\u505C\u7528\u8BED\u97F3\u8BF7\u7528\u4E0A\u65B9\u5F00\u5173\uFF0C\u4E0D\u9700\u8981\u6E05\u9664 Key\u3002",
      onChange: (v) => {
        patch("voice", { ...voice, apiKey: v });
      }
    }),
    voice.hasApiKey === true && (voice.apiKey ?? "").trim() === "" ? (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field", style: { padding: "0 0 8px", borderTop: 0 } },
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-hint" }, "\u5DF2\u4FDD\u5B58 API Key\uFF1B\u8BED\u97F3\u662F\u5426\u751F\u6548\u7531\u4E0A\u65B9\u5F00\u5173\u51B3\u5B9A\u3002"),
        (0, import_react2.createElement)("button", {
          type: "button",
          className: "imqb2-persona-add",
          onClick: () => {
            patch("voice", { ...voice, apiKey: "", clearApiKey: true, hasApiKey: false });
          }
        }, "\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684 Key")
      )
    ) : null,
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u6A21\u578B\u4E0E\u97F3\u8272"),
    (0, import_react2.createElement)(VoiceModelField, {
      value: voice.model ?? "",
      help: "\u5F53\u524D\u53EA\u5185\u7F6E Qwen-Audio-TTS \u7684 3.1 / 3.0 \u6A21\u578B\uFF08\u5176\u4ED6\u6A21\u578B\u8D70\u300C\u5176\u4ED6\u6A21\u578B id\u300D\u624B\u52A8\u8F93\u5165\uFF09\u3002\u5207\u6362\u6A21\u578B\u4F1A\u81EA\u52A8\u4FEE\u6B63\u5185\u7F6E\u7CFB\u7EDF\u97F3\u8272\uFF1A\u540C\u540D\u97F3\u8272\u8DE8\u4EE3\u6539\u5199\uFF08longanfengyue \u2194 longanfengyue_v3.1\uFF09\uFF0C\u76EE\u6807\u6A21\u578B\u4E0D\u652F\u6301\u7684\u5185\u7F6E\u97F3\u8272\u56DE\u843D\u5230\u8BE5\u6A21\u578B\u7F3A\u7701\u97F3\u8272\uFF1B\u4EBA\u683C\u91CC\u7684\u97F3\u8272\u4E5F\u4F1A\u8DDF\u7740\u6539\u3002\u514B\u9686/\u8BBE\u8BA1\u97F3\u8272\u4E0D\u4F1A\u81EA\u52A8\u6539\uFF08\u9762\u677F\u65E0\u6CD5\u5224\u65AD\u5176\u517C\u5BB9\u6027\uFF09\uFF1B\u5408\u6210\u5931\u8D25\u65F6\u65E5\u5FD7\u4F1A\u5199\u660E\u539F\u56E0\u3002",
      onChange: (v) => {
        applyVoiceModel(v);
      }
    }),
    (0, import_react2.createElement)(VoiceSelectField, {
      label: "\u9ED8\u8BA4\u97F3\u8272",
      value: voice.voice ?? "",
      placeholder: "\uFF08\u7559\u7A7A\uFF0C\u4F7F\u7528\u7F3A\u7701\u97F3\u8272\uFF09",
      options: voiceOptions,
      help: voiceOptions.length > 0 ? `\u53EA\u80FD\u4ECE\u4E0B\u62C9\u91CC\u9009\uFF08\u81EA\u5B9A\u4E49 ${customPresetCount} \u4E2A\u7F6E\u9876\uFF0C\u5176\u540E\u4E3A\u5185\u7F6E\u7CFB\u7EDF\u97F3\u8272\uFF09\u3002\u97F3\u8272\u4E0E\u6A21\u578B\u4EE3\u9645\u7ED1\u5B9A\uFF1A\u6807\u4E86\u300C\u9700 xxx \u6A21\u578B\u300D\u7684\u9879\u9009\u4E2D\u540E\u4F1A\u81EA\u52A8\u628A\u4E0A\u9762\u7684\u300C\u8BED\u97F3\u6A21\u578B\u300D\u5207\u8FC7\u53BB\u3002\u8981\u65B0\u589E\u590D\u523B/\u8BBE\u8BA1\u97F3\u8272\uFF0C\u8BF7\u5728\u4E0B\u65B9\u300C\u81EA\u5B9A\u4E49\u97F3\u8272\u300D\u91CC\u6DFB\u52A0\u540D\u79F0 + id\u3002\u4EBA\u683C\u53EF\u5728\u300C\u4EBA\u683C\u9884\u8BBE\u300D\u91CC\u8986\u76D6\u3002` : "\u5F53\u524D\u6A21\u578B\u6CA1\u6709\u53EF\u786E\u8BA4\u7684\u5185\u7F6E\u97F3\u8272\u6E05\u5355\uFF1A\u8BF7\u5728\u4E0B\u65B9\u300C\u81EA\u5B9A\u4E49\u97F3\u8272\u300D\u91CC\u6DFB\u52A0\u540D\u79F0 + id\uFF0C\u6216\u628A\u300C\u8BED\u97F3\u6A21\u578B\u300D\u6539\u56DE Qwen-Audio 3.1 TTS Flash\uFF083.0 \u65E7\u6A21\u578B\u4E5F\u53EF\uFF09\u3002",
      onChange: (v) => {
        const picked = voiceOptions.find((option) => option.value === v);
        if (picked?.requiresModel !== void 0) {
          applyVoiceModel(picked.requiresModel, v);
          return;
        }
        patch("voice", { ...voice, voice: v });
      }
    }),
    (0, import_react2.createElement)(VoicePresetListField, {
      value: voice.presets ?? [],
      onChange: (nextPresets) => {
        patch("voice", { ...voice, presets: nextPresets });
      }
    }),
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u60C5\u611F\u4E0E\u8BED\u6C14"),
    (0, import_react2.createElement)(AreaRow, {
      label: "\u60C5\u611F/\u8BED\u6C14\u6307\u4EE4",
      rows: 4,
      help: "\u53EF\u5199\u6210\u300C\u573A\u666F + \u9010\u53E5\u8D70\u5411\u300D\uFF0C\u5408\u6210\u65F6\u968F\u8BF7\u6C42\u4E0B\u53D1\uFF08\u2264400 \u5B57\uFF09\u3002\u4F8B\uFF1A\u573A\u666F\uFF1A\u591C\u91CC\u6559\u5B66\u697C\u8D70\u5ECA\uFF0C\u5979\u53EB\u4F4F\u5B66\u957F\uFF0C\u7D27\u5F20\u53C8\u9F13\u8D77\u52C7\u6C14\uFF1B\u7B2C1\u53E5\uFF1A\u5F88\u8F7B\u3001\u8FDF\u7591\uFF1B\u7B2C2\u53E5\uFF1A\u541E\u5410\u3001\u6709\u505C\u987F\uFF1B\u7B2C3\u53E5\uFF1A\u67D4\u548C\u5E26\u7B11\uFF1B\u7B2C4\u53E5\uFF1A\u8F6C\u4E3A\u575A\u5B9A\u3001\u52A0\u5FEB\u4E00\u70B9\u3002\u7559\u7A7A = \u6A21\u578B\u9ED8\u8BA4\u8BED\u6C14\uFF1B\u4EBA\u683C\u53EF\u5728\u300C\u4EBA\u683C\u9884\u8BBE\u300D\u91CC\u5355\u72EC\u8986\u76D6\u3002",
      value: voice.instruction ?? "",
      onChange: (v) => {
        patch("voice", { ...voice, instruction: v });
      }
    }),
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint" },
      "\u670D\u52A1\u7AEF\u8FD8\u652F\u6301\u6587\u672C\u5185\u60C5\u611F\u6807\u7B7E\uFF08[excited] \u5174\u594B\u3001[sad] \u60B2\u4F24\u3001[serious] \u4E25\u8083\u3001[laughing] \u7B11\u58F0\u3001[sighing] \u53F9\u606F\u3001[whispers] \u8033\u8BED\u3001[very slowly] \u653E\u6162\u2026\uFF09\uFF0C\u4F46\u6807\u7B7E\u5FC5\u987B\u51FA\u73B0\u5728\u5F85\u6717\u8BFB\u6587\u672C\u91CC\u624D\u751F\u6548\uFF0C\u65E5\u5E38\u5EFA\u8BAE\u7528\u4E0A\u9762\u7684\u6307\u4EE4\u63A7\u5236\u60C5\u611F\uFF0C\u5FC5\u8981\u65F6\u6A21\u578B\u8FD8\u53EF\u4EE5\u5728\u5355\u8F6E\u8C03\u7528\u91CC\u6307\u5B9A\u8BED\u6C14\u3002"
    ),
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u957F\u5EA6\u4E0E\u8D85\u65F6"),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u5355\u6B21\u6717\u8BFB\u5B57\u6570\u4E0A\u9650",
      value: String(voice.maxChars ?? 300),
      placeholder: "300",
      help: "\u8D85\u51FA\u540E\u622A\u65AD\uFF0820\u20131000\uFF09\uFF1BQQ \u8BED\u97F3\u4E0D\u5B9C\u8FC7\u957F",
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch("voice", { ...voice, maxChars: Number.isFinite(n) ? Math.min(1e3, Math.max(20, n)) : 300 });
      }
    }),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u5408\u6210\u8D85\u65F6(ms)",
      value: String(voice.timeoutMs ?? 3e4),
      placeholder: "30000",
      help: "\u8D85\u65F6\u540E\u653E\u5F03\u8BED\u97F3\u3001\u6539\u4E3A\u53D1\u9001\u6587\u5B57\u56DE\u590D\uFF085000\u2013120000\uFF09",
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch("voice", { ...voice, timeoutMs: Number.isFinite(n) ? Math.min(12e4, Math.max(5e3, n)) : 3e4 });
      }
    }),
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u7F51\u5173"),
    (0, import_react2.createElement)(FieldRow, {
      label: "WebSocket \u5730\u5740",
      value: voice.baseUrl ?? "",
      placeholder: "\u7559\u7A7A\u4F7F\u7528 DashScope \u5B98\u65B9\u7F51\u5173",
      help: "\u81EA\u5B9A\u4E49 MaaS \u7F51\u5173\u65F6\u586B\u5B8C\u6574 wss:// \u5730\u5740\uFF1B\u7559\u7A7A\u5219\u6309 workspace \u6216\u5B98\u65B9\u7F51\u5173\u8FDE\u63A5",
      onChange: (v) => {
        patch("voice", { ...voice, baseUrl: v });
      }
    }),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u4E1A\u52A1\u7A7A\u95F4 workspace",
      value: voice.workspace ?? "",
      placeholder: "\u7559\u7A7A\u4F7F\u7528\u5B98\u65B9\u5171\u4EAB\u7F51\u5173",
      help: "\u767E\u70BC\u4E1A\u52A1\u7A7A\u95F4 id\uFF1A\u7528\u4E8E\u62FC\u63A5 MaaS \u5730\u5740\u5E76\u5728\u8BF7\u6C42\u5934\u643A\u5E26 X-DashScope-WorkSpace",
      onChange: (v) => {
        patch("voice", { ...voice, workspace: v });
      }
    }),
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "8px 0 0" } },
      "\u8BED\u97F3\u8D70 DashScope \u5B9E\u65F6\u5408\u6210\uFF08\u9700\u8981 Node 22+ \u5185\u7F6E WebSocket\uFF09\uFF1B\u5408\u6210\u5931\u8D25\u65F6\u9000\u56DE\u6587\u5B57\u56DE\u590D\uFF0C\u6D88\u606F\u4E0D\u4F1A\u4E22\u3002"
    )
  ];
  const sticker = form.sticker ?? {};
  const stickerCollector = sticker.collector ?? {};
  const stickerSelector = sticker.selector ?? {};
  const stickerEvolver = sticker.evolver ?? {};
  const stickerStorage = sticker.storage ?? {};
  const stickerPanel = [
    // 顶层开关
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u603B\u5F00\u5173"),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u542F\u7528\u8868\u60C5\u5305\u8FDB\u5316\u7CFB\u7EDF"),
        (0, import_react2.createElement)(Switch, {
          checked: sticker.enabled === true,
          onChange: (v) => {
            patch("sticker", { ...sticker, enabled: v });
          }
        })
      ),
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-help" },
        "\u5173\u95ED\u540E bot \u4E0D\u6536\u85CF\u7FA4\u56FE\u7247\uFF0C\u4E5F\u4E0D\u6CE8\u518C qqbot_pick_sticker \u5DE5\u5177\u3002\u5DF2\u6536\u85CF\u7684\u5143\u6570\u636E\u4FDD\u7559\u3002"
      )
    ),
    // 收藏器
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u6536\u85CF\u5668 \u2014 \u81EA\u52A8\u6536\u85CF\u7FA4\u804A\u56FE\u7247"),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u542F\u7528\u81EA\u52A8\u6536\u85CF"),
        (0, import_react2.createElement)(Switch, {
          checked: stickerCollector.enabled !== false,
          onChange: (v) => {
            patch("sticker", {
              ...sticker,
              collector: { ...stickerCollector, enabled: v }
            });
          }
        })
      ),
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-help" },
        "\u65C1\u8DEF\u5F02\u6B65\u6536\u85CF\uFF0C\u4E0D\u963B\u585E\u6D88\u606F\u56DE\u590D\u3002QQ \u4E0B\u8F7D\u5B8C\u9644\u4EF6\u540E\u81EA\u52A8\u63D0\u53D6 hash \u53BB\u91CD\u5165\u5E93\u3002"
      )
    ),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u6BCF\u7FA4\u6BCF\u65E5\u6700\u5927\u6536\u85CF\u6570",
      value: String(stickerCollector.maxPerGroupPerDay ?? 50),
      placeholder: "50",
      help: "\u907F\u514D\u5237\u5C4F\u6536\u85CF\uFF0C\u8D85\u8FC7\u4ECA\u65E5\u9650\u989D\u7684\u7FA4\u81EA\u52A8\u8DF3\u8FC7\u30021\u2013500\u3002",
      onChange: (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0 && n <= 500) {
          patch("sticker", {
            ...sticker,
            collector: { ...stickerCollector, maxPerGroupPerDay: n }
          });
        }
      }
    }),
    // 选择器
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u9009\u62E9\u5668 \u2014 \u667A\u80FD\u6311\u9009\u5E94\u666F\u8868\u60C5"),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u9009\u62E9\u7B56\u7565"),
      (0, import_react2.createElement)(
        "select",
        {
          className: "imqb2-select",
          value: stickerSelector.strategy ?? "mood-match",
          onChange: (event) => {
            patch("sticker", {
              ...sticker,
              selector: { ...stickerSelector, strategy: event.currentTarget.value }
            });
          }
        },
        (0, import_react2.createElement)("option", { value: "hot" }, "\u70ED\u5EA6\u4F18\u5148 \u2014 \u7528\u6700\u70ED\u7684\u8868\u60C5"),
        (0, import_react2.createElement)("option", { value: "random" }, "\u5B8C\u5168\u968F\u673A \u2014 \u5747\u5300\u6311\u9009"),
        (0, import_react2.createElement)("option", { value: "mood-match" }, "\u60C5\u7EEA\u5339\u914D \u2014 \u6309\u5F53\u524D\u804A\u5929\u6C1B\u56F4\u9009\u6700\u642D\u7684"),
        (0, import_react2.createElement)("option", { value: "topic-match" }, "\u8BDD\u9898\u5339\u914D \u2014 \u6309\u8BDD\u9898\u5173\u952E\u8BCD\u9009\uFF08\u9700\u6A21\u578B\u7406\u89E3\uFF09"),
        (0, import_react2.createElement)("option", { value: "explore" }, "\u63A2\u7D22\u4F18\u5148 \u2014 \u4F18\u5148\u5C55\u793A\u4F4E\u70ED\u5EA6\u8868\u60C5\uFF0C\u5E2E\u5B83\u4EEC\u6DA8\u66DD\u5149")
      ),
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        "mood-match \u6700\u901A\u7528\uFF1B\u60F3\u8BA9\u51B7\u95E8\u8868\u60C5\u4E5F\u6709\u673A\u4F1A\u5C31\u9009 explore\u3002"
      )
    ),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u4E3B\u52A8\u5192\u6CE1\u6982\u7387",
      value: String((stickerSelector.proactiveProbability ?? 0.15) * 100) + "%",
      placeholder: "15",
      help: "\u7FA4\u804A\u6B63\u5E38\u5BF9\u8BDD\u65F6\uFF0C\u6A21\u578B\u6709\u8FD9\u4E2A\u6982\u7387\u4E3B\u52A8\u53D1\u4E00\u4E2A\u8868\u60C5\uFF08\u9664\u4E86\u88AB @ \u7684\u56DE\u5E94\uFF09\u30020% \u8868\u793A\u53EA\u5728\u88AB\u8981\u6C42\u65F6\u53D1\u3002\u586B 0\u2013100 \u7684\u6574\u6570\u5373\u53EF\uFF0C\u4FDD\u5B58\u65F6\u81EA\u52A8\u8F6C\u5C0F\u6570\u3002",
      onChange: (v) => {
        const n = parseInt(v.replace("%", ""), 10);
        if (!isNaN(n) && n >= 0 && n <= 100) {
          patch("sticker", {
            ...sticker,
            selector: { ...stickerSelector, proactiveProbability: n / 100 }
          });
        }
      }
    }),
    // 进化引擎
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u8FDB\u5316\u5F15\u64CE \u2014 \u5B9A\u671F\u91CD\u7B97\u70ED\u5EA6 + \u6DD8\u6C70"),
    (0, import_react2.createElement)("FieldRow", {
      label: "\u8FDB\u5316\u68C0\u67E5\u95F4\u9694\uFF08\u5C0F\u65F6\uFF09",
      value: String(stickerEvolver.checkIntervalHours ?? 24),
      placeholder: "24",
      help: "\u6BCF\u9694\u591A\u4E45\u91CD\u7B97\u4E00\u6B21\u5168\u5E93\u70ED\u5EA6\u3001\u6DD8\u6C70\u4F4E\u8D28\u91CF\u8868\u60C5\u30021\u2013720\u3002",
      onChange: (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 1 && n <= 720) {
          patch("sticker", {
            ...sticker,
            evolver: { ...stickerEvolver, checkIntervalHours: n }
          });
        }
      }
    }),
    (0, import_react2.createElement)("FieldRow", {
      label: "\u6700\u5C11\u4FDD\u7559\u6570\u91CF",
      value: String(stickerEvolver.minKeepCount ?? 50),
      placeholder: "50",
      help: "\u6DD8\u6C70\u65F6\u4E0D\u4F1A\u4F4E\u4E8E\u8FD9\u4E2A\u6570\u91CF\u2014\u2014\u54EA\u6015\u70ED\u5EA6\u90FD\u5F88\u4F4E\u4E5F\u7559\u7740\uFF0C\u9632\u6B62\u7A7A\u5E93\u30020\u201310000\u3002",
      onChange: (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 0 && n <= 1e4) {
          patch("sticker", {
            ...sticker,
            evolver: { ...stickerEvolver, minKeepCount: n }
          });
        }
      }
    }),
    // 存储
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u5B58\u50A8 \u2014 \u6307\u5B9A\u5B58\u653E\u6587\u4EF6\u5939"),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u56FE\u7247\u5B58\u653E\u76EE\u5F55",
      value: stickerStorage.imagesDir ?? "",
      placeholder: "\u7559\u7A7A = \u590D\u7528 ~/.dsh-qqbot/media\uFF08\u5A92\u4F53 TTL \u6E05\u7406\u4F1A\u5220\uFF09",
      help: "\u586B\u4E86\u4E4B\u540E\u6536\u85CF\u7684\u56FE\u4F1A\u88AB copyFile \u5230\u8FD9\u4E2A\u76EE\u5F55\uFF0C\u4E0D\u518D\u53D7 media cleaner \u5F71\u54CD\u3002\u7528\u7EDD\u5BF9\u8DEF\u5F84\u6700\u7A33\u3002",
      onChange: (v) => {
        patch("sticker", {
          ...sticker,
          storage: { ...stickerStorage, imagesDir: v }
        });
      }
    }),
    (0, import_react2.createElement)(FieldRow, {
      label: "\u5143\u6570\u636E JSON \u8DEF\u5F84",
      value: stickerStorage.metadataPath ?? "",
      placeholder: "\u7559\u7A7A = ~/.dsh-qqbot/stickers.json",
      help: "\u53EA\u5B58\u5143\u6570\u636E\uFF08id/\u70ED\u5EA6/\u6807\u7B7E\u7B49\uFF09\uFF0C\u4E0D\u5B58\u56FE\u7247\u672C\u4F53\u3002\u4E00\u822C\u4E0D\u9700\u8981\u6539\u3002",
      onChange: (v) => {
        patch("sticker", {
          ...sticker,
          storage: { ...stickerStorage, metadataPath: v }
        });
      }
    }),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u81EA\u52A8\u5907\u4EFD\u5143\u6570\u636E"),
        (0, import_react2.createElement)(Switch, {
          checked: stickerStorage.autoBackup !== false,
          onChange: (v) => {
            patch("sticker", {
              ...sticker,
              storage: { ...stickerStorage, autoBackup: v }
            });
          }
        })
      ),
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-help" },
        "\u6BCF\u6B21\u5237\u76D8\u524D\u81EA\u52A8\u628A\u65E7 stickers.json \u62F7\u6210 stickers.{\u65F6\u95F4\u6233}.bak\uFF0C\u9632\u6B62\u5199\u9519\u3002"
      )
    )
  ];
  const modelPanel = [
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u6A21\u578B"),
    (0, import_react2.createElement)(FieldRow, {
      label: "Provider",
      value: form.provider ?? "",
      placeholder: "\u7559\u7A7A\u7EE7\u627F\u5BBF\u4E3B\u9ED8\u8BA4",
      onChange: (v) => {
        patch("provider", v);
      }
    }),
    (0, import_react2.createElement)(FieldRow, {
      label: "Model",
      value: form.model ?? "",
      placeholder: "\u7559\u7A7A\u7EE7\u627F\u5BBF\u4E3B\u9ED8\u8BA4",
      onChange: (v) => {
        patch("model", v);
      }
    }),
    (0, import_react2.createElement)(FieldRow, {
      label: "Preset",
      value: form.preset ?? "",
      placeholder: "Agent preset id",
      onChange: (v) => {
        patch("preset", v);
      }
    }),
    form.cwd !== void 0 ? (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)(
        "div",
        { className: "imqb2-head" },
        (0, import_react2.createElement)("span", { className: "imqb2-label" }, "Agent \u5DE5\u4F5C\u76EE\u5F55"),
        (0, import_react2.createElement)("span", { className: "imqb2-hint" }, "\u53EA\u8BFB")
      ),
      (0, import_react2.createElement)("p", { className: "imqb2-readonly" }, form.cwd)
    ) : null,
    (0, import_react2.createElement)("div", { className: "imqb2-group-title" }, "\u5168\u5C40\u63D0\u793A\u8BCD"),
    (0, import_react2.createElement)(AreaRow, {
      label: "\u5168\u5C40 system prompt",
      rows: 6,
      help: "\u5BF9\u6240\u6709\u7FA4\u804A/\u79C1\u804A\u751F\u6548\u3002\u628A\u300C\u591A\u6761\u6D88\u606F\u7528\u56FA\u5B9A\u5206\u9694\u7B26 ||| \u5206\u9694\u300D\u8FD9\u7C7B\u901A\u7528\u89C4\u5219\u5199\u5728\u8FD9\u91CC\uFF0C\u4EBA\u683C\u91CC\u53EA\u5199\u89D2\u8272\u8BBE\u5B9A\u3002",
      value: form.globalPrompt ?? "",
      onChange: (v) => {
        patch("globalPrompt", v);
      }
    })
  ];
  const personasPanel = [
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "4px 0 8px" } },
      "\u6BCF\u4E2A\u4EBA\u683C\u662F\u4E00\u5957\u89D2\u8272 system prompt\uFF0C\u53E0\u52A0\u5728\u5168\u5C40\u63D0\u793A\u8BCD\u4E4B\u4E0A\u3002\u70B9\u51FB\u6807\u9898\u5C55\u5F00\u7F16\u8F91\uFF0C\u914D\u7F6E\u540E\u53EF\u5728 QQ \u804A\u5929\u53D1\u9001 /persona\uFF08\u6216\u76F4\u63A5\u70B9\u51FB\u83DC\u5355\uFF09\u6309\u4F1A\u8BDD\u5207\u6362\uFF1B\u4FEE\u6539\u8FC7\u4F46\u672A\u4FDD\u5B58\u7684\u5206\u533A\u4F1A\u5728 tab \u4E0A\u663E\u793A\u5C0F\u5706\u70B9\u3002"
    ),
    personas.length === 0 ? (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "4px 0 12px" } },
      "\u5C1A\u672A\u6DFB\u52A0\u4EBA\u683C\u3002\u6DFB\u52A0\u5E76\u4FDD\u5B58\u540E\uFF0CQQ \u7AEF /persona \u5373\u53EF\u770B\u5230\u5207\u6362\u83DC\u5355\u3002"
    ) : null,
    personas.map((persona, index) => (0, import_react2.createElement)(PersonaCard, {
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
    (0, import_react2.createElement)("button", {
      type: "button",
      className: "imqb2-persona-add",
      onClick: addPersona
    }, "\uFF0B \u6DFB\u52A0\u4EBA\u683C"),
    personas.length > 0 ? (0, import_react2.createElement)(FieldRow, {
      label: "\u9ED8\u8BA4\u4EBA\u683C id",
      value: form.defaultPersona ?? "",
      placeholder: "\u7559\u7A7A\u8868\u793A\u4E0D\u542F\u7528\u4EBA\u683C",
      help: `\u53EF\u7528 id: ${personas.map((p) => p.id).filter(Boolean).join(", ") || "\uFF08\u5C1A\u672A\u586B\u5199\uFF09"}\uFF1B\u7559\u7A7A\u5219\u4E0D\u542F\u7528\u4EBA\u683C`,
      onChange: (v) => {
        patch("defaultPersona", v);
      }
    }) : null
  ];
  const updatePanel = [
    (0, import_react2.createElement)(
      "p",
      { className: "imqb2-hint", style: { padding: "4px 0 8px" } },
      "\u68C0\u67E5\u5F53\u524D\u5B89\u88C5\u65B9\u5F0F\u4E0B\u8FDC\u7AEF\u662F\u5426\u6709\u65B0\u7248\u672C\u3002git \u5B89\u88C5\u4F1A\u5BF9\u6BD4\u8FDC\u7AEF\u6700\u65B0 commit\uFF1B\u66F4\u65B0\u540E\u4F1A\u91CD\u65B0\u89E3\u6790\u4F9D\u8D56\u5E76\u81EA\u52A8\u91CD\u8F7D\u63D2\u4EF6\uFF0C\u4E0D\u9700\u8981\u5378\u8F7D\u91CD\u88C5\u3002"
    ),
    updateError !== null ? (0, import_react2.createElement)("p", { className: "imqb2-hint-warn" }, updateError) : null,
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u5F53\u524D\u5B89\u88C5"),
      updateInfo === null ? (0, import_react2.createElement)("p", { className: "imqb2-hint" }, "\u6B63\u5728\u8BFB\u53D6\u5B89\u88C5\u4FE1\u606F\u2026") : (0, import_react2.createElement)(
        "div",
        null,
        (0, import_react2.createElement)(
          "p",
          { className: "imqb2-readonly" },
          `${updateInfo.version} \xB7 ${updateKindLabel(updateInfo.kind)}`
        ),
        updateInfo.installed !== "" ? (0, import_react2.createElement)(
          "p",
          { className: "imqb2-hint" },
          `\u5DF2\u5B89\u88C5\u5F15\u7528\uFF1A${updateInfo.kind === "git" ? shortHash(updateInfo.installed) : updateInfo.installed}`
        ) : null,
        updateInfo.spec !== void 0 ? (0, import_react2.createElement)("p", { className: "imqb2-hint" }, `\u4F9D\u8D56\u5199\u6CD5\uFF1A${updateInfo.spec}`) : null,
        updateInfo.message !== void 0 ? (0, import_react2.createElement)("p", { className: "imqb2-hint-warn" }, updateInfo.message) : null
      )
    ),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-field" },
      (0, import_react2.createElement)("span", { className: "imqb2-label" }, "\u7248\u672C\u68C0\u67E5"),
      updateCheck === null ? (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        "\u70B9\u51FB\u300C\u68C0\u67E5\u66F4\u65B0\u300D\u5BF9\u6BD4\u8FDC\u7AEF\u6700\u65B0\u7248\u672C\uFF1Bgit \u5B89\u88C5\u5BF9\u6BD4\u8FDC\u7AEF commit\uFF0Cnpm \u5B89\u88C5\u5BF9\u6BD4 registry\u3002"
      ) : (0, import_react2.createElement)(
        "div",
        null,
        (0, import_react2.createElement)("p", {
          className: updateCheck.updateAvailable ? "imqb2-hint-warn" : "imqb2-hint"
        }, updateCheck.message),
        (0, import_react2.createElement)(
          "p",
          { className: "imqb2-hint" },
          `\u68C0\u67E5\u65F6\u95F4\uFF1A${new Date(updateCheck.checkedAt).toLocaleTimeString()}`
        )
      ),
      (0, import_react2.createElement)(
        "div",
        {
          style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }
        },
        (0, import_react2.createElement)("button", {
          type: "button",
          className: "imqb2-save",
          disabled: updateBusy !== null || updateInfo === null,
          onClick: () => {
            runUpdateAction("check");
          }
        }, updateBusy === "check" ? "\u6B63\u5728\u68C0\u67E5\u2026" : "\u68C0\u67E5\u66F4\u65B0"),
        updateCheck?.updateAvailable === true && updateInfo !== null ? confirmUpdate ? [
          (0, import_react2.createElement)("button", {
            key: "confirm",
            type: "button",
            className: "imqb2-save",
            disabled: updateBusy !== null,
            onClick: () => {
              runUpdateAction("update");
            }
          }, updateBusy === "update" ? "\u6B63\u5728\u66F4\u65B0\u2026" : "\u786E\u8BA4\u66F4\u65B0"),
          (0, import_react2.createElement)("button", {
            key: "cancel",
            type: "button",
            className: "imqb2-tab",
            disabled: updateBusy !== null,
            onClick: () => {
              setConfirmUpdate(false);
            }
          }, "\u53D6\u6D88")
        ] : (0, import_react2.createElement)("button", {
          key: "start",
          type: "button",
          className: "imqb2-save",
          disabled: updateBusy !== null || !updateInfo.canUpdate,
          title: updateInfo.canUpdate ? "\u6267\u884C pnpm update\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u91CD\u8F7D\u63D2\u4EF6" : `\u5F53\u524D\u5BBF\u4E3B\u4E0D\u652F\u6301\u4E00\u952E\u66F4\u65B0\uFF0C\u8BF7\u624B\u52A8\u6267\u884C\uFF1A${updateInfo.command}`,
          onClick: () => {
            setConfirmUpdate(true);
          }
        }, "\u7ACB\u5373\u66F4\u65B0") : null
      ),
      updateInfo !== null && !updateInfo.canUpdate && updateCheck?.updateAvailable === true ? (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        `\u5F53\u524D\u5BBF\u4E3B\u4E0D\u652F\u6301\u4E00\u952E\u66F4\u65B0\uFF0C\u8BF7\u624B\u52A8\u6267\u884C\uFF1A${updateInfo.command}`
      ) : null,
      updateNotice !== null ? (0, import_react2.createElement)("p", { className: "imqb2-note imqb2-note--ok" }, updateNotice) : null,
      (0, import_react2.createElement)(
        "p",
        { className: "imqb2-hint" },
        "\u66F4\u65B0\u5B8C\u6210\u540E\u63D2\u4EF6\u4F1A\u81EA\u52A8\u91CD\u8F7D\uFF1B\u82E5\u754C\u9762\u6CA1\u6709\u5237\u65B0\uFF0C\u8BF7\u91CD\u542F DSH\u3002"
      )
    )
  ];
  const panels = {
    access: accessPanel,
    identity: identityPanel,
    members: membersPanel,
    conversation: conversationPanel,
    voice: voicePanel,
    sticker: stickerPanel,
    model: modelPanel,
    personas: personasPanel,
    update: updatePanel
  };
  const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? "";
  return (0, import_react2.createElement)(
    "form",
    { className: "imqb2-form", onSubmit: submit },
    (0, import_react2.createElement)(
      "div",
      {
        className: "imqb2-tabs",
        role: "tablist",
        "aria-label": "\u914D\u7F6E\u5206\u533A"
      },
      TABS.map((tab) => (0, import_react2.createElement)(
        "button",
        {
          key: tab.id,
          type: "button",
          role: "tab",
          "aria-selected": activeTab === tab.id,
          "aria-controls": "imqb2-config-tabpanel",
          className: "imqb2-tab",
          onClick: () => {
            setActiveTab(tab.id);
          }
        },
        tab.label,
        tabDirty(tab) ? (0, import_react2.createElement)("span", { className: "imqb2-tab-dot", title: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539" }) : null
      ))
    ),
    (0, import_react2.createElement)("div", {
      id: "imqb2-config-tabpanel",
      className: "imqb2-tabpanel",
      role: "tabpanel",
      "aria-label": activeTabLabel
    }, panels[activeTab]),
    (0, import_react2.createElement)(
      "div",
      { className: "imqb2-footer" },
      result !== null ? (0, import_react2.createElement)(
        "p",
        { className: `imqb2-note${result.ok ? " imqb2-note--ok" : " imqb2-note--error"}` },
        (result.ok ? "" : "\u26A0\uFE0F ") + result.message
      ) : dirty ? (0, import_react2.createElement)("p", { className: "imqb2-note" }, "\u4FDD\u5B58\u540E\u63D2\u4EF6\u5C06\u91CD\u8F7D\uFF0C\u8FDB\u884C\u4E2D\u7684\u673A\u5668\u4EBA\u4F1A\u8BDD\u5C06\u91CD\u7F6E") : (0, import_react2.createElement)("p", { className: "imqb2-note" }),
      (0, import_react2.createElement)(
        "button",
        { className: "imqb2-save", type: "submit", disabled: busy || !dirty },
        busy ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58"
      )
    )
  );
}

// src/client/index.ts
var name = "im-qqbot-client";
var inject = ["slots", "sidebarRight", "sidebarRightTabs"];
var TAB_KIND = "qqbot-bind";
var TAB_ID = "im-qqbot/bind";
var PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
var IM_MAIN_PANEL_ID = "im-qqbot";
function BindGuideIcon() {
  return (0, import_react3.createElement)(
    "svg",
    {
      width: 24,
      height: 24,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": true
    },
    (0, import_react3.createElement)("path", {
      d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
      fill: "var(------icon_primary, #1A1A1A)"
    }),
    (0, import_react3.createElement)("path", {
      d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
      fill: "var(------icon_primary, #1A1A1A)"
    }),
    (0, import_react3.createElement)("path", {
      fillRule: "evenodd",
      clipRule: "evenodd",
      d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
      fill: "var(------icon_primary, #1A1A1A)"
    })
  );
}
function QQBotSettingsSection() {
  const { state, gone, recheck } = useBindState();
  return (0, import_react3.createElement)(
    "div",
    null,
    (0, import_react3.createElement)(BindPanelBody, { state, gone, recheck }),
    (0, import_react3.createElement)(ConfigPanel, { bindPhase: state?.phase })
  );
}
function QQBotPage() {
  return (0, import_react3.createElement)(
    "div",
    { className: "imqb-pluginPage" },
    (0, import_react3.createElement)(
      "div",
      { className: "imqb-pluginPageContent" },
      (0, import_react3.createElement)(QQBotSettingsSection)
    )
  );
}
function QqBotSidebarIcon({ size = 16 }) {
  return (0, import_react3.createElement)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": true
    },
    (0, import_react3.createElement)("path", { d: QQ_BOT_LOGO_PATH, fill: "currentColor" })
  );
}
function OpenQqBotAction({ subject, packageName, onOpen }) {
  if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
  if (subject.pkg?.name !== packageName) return null;
  if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
  return (0, import_react3.createElement)("button", {
    type: "button",
    className: "imqb-pluginOpen",
    onClick: onOpen
  }, "\u8BBE\u7F6E");
}
function apply(ctx) {
  installPanelStyles();
  const tabs = ctx.sidebarRightTabs;
  const right = ctx.sidebarRight;
  const slots = ctx.slots;
  const disposers = [];
  if (slots !== void 0) {
    disposers.push(slots.inject("settings.section", () => slots.register(
      { name: "settings.section", id: "qqbot", order: 7, label: "QQ \u673A\u5668\u4EBA" },
      QQBotSettingsSection
    )));
  }
  if (tabs !== void 0 && slots !== void 0) {
    disposers.push(tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => "QQ \u673A\u5668\u4EBA\u7ED1\u5B9A",
      guide: [{
        id: "bind",
        order: 90,
        title: () => "QQ \u673A\u5668\u4EBA\u7ED1\u5B9A",
        description: () => "\u626B\u7801\u6216\u624B\u52A8\u586B\u5199\uFF0C\u7ED1\u5B9A QQ \u673A\u5668\u4EBA",
        icon: BindGuideIcon
      }]
    }));
    disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register(
      { name: "sidebar.right.pane.tab", key: TAB_ID },
      BindPanelBody
    )));
    disposers.push(watchAndPrompt(right));
  }
  const ctxInject = ctx.inject;
  if (typeof ctxInject === "function") {
    void ctxInject.call(ctx, ["layout"], (pageCtx) => {
      const pageSlots = pageCtx.slots;
      const layout = pageCtx.layout;
      if (pageSlots === void 0 || layout === void 0) return void 0;
      const stopMain = pageSlots.inject("main", () => pageSlots.register(
        { name: "main", key: IM_MAIN_PANEL_ID },
        QQBotPage
      ));
      const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register(
        {
          name: "plugins.detail.actions",
          id: "im-qqbot-open",
          order: 20,
          inject: () => ({
            packageName: PACKAGE_NAME,
            onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
          })
        },
        OpenQqBotAction
      ));
      const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register(
        {
          name: "sidebar.panellist",
          id: IM_MAIN_PANEL_ID,
          order: 10,
          label: "QQ \u673A\u5668\u4EBA"
        },
        QqBotSidebarIcon
      ));
      return () => {
        stopActions();
        stopSidebar();
        stopMain();
      };
    });
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) dispose();
  }, "im-qqbot-client.binding");
}
function watchAndPrompt(right) {
  let stopped = false;
  let opened = right === void 0;
  let timer;
  const schedule = (ms) => {
    timer = setTimeout(() => {
      void tick();
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
        const body = await res.json();
        if (body.phase === "waiting" && !opened && right !== void 0) {
          try {
            right.openTab(TAB_KIND);
            opened = true;
          } catch (err) {
            console.error("[im-qqbot] \u6253\u5F00\u7ED1\u5B9A\u9875\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5", err);
          }
        }
        schedule(3e3);
        return;
      }
      schedule(3e4);
      return;
    } catch {
    }
    schedule(1e4);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer !== void 0) clearTimeout(timer);
  };
}
return module.exports; } });
//# sourceMappingURL=client.js.map
