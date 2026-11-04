/**
 * 本地预览入口（不参与发布）：把 lib/client.js 当成真实 GUI 里的动态 bundle 加载，
 * 用一个最小 ctx 走完 apply()，然后按侧边栏 + 覆盖层的布局挂上去。
 */
import "./loader-stub.js";
import "../lib/client.js";

import React from "react";
import ReactDOM from "react-dom/client";

import { registrations } from "./loader-stub.js";

const registration = registrations[0];
if (registration === undefined) throw new Error("client.js 没有向 __ModuleLoader__.load 注册工厂");

const plugin = registration.factory((specifier) => {
	if (specifier === "react") return React;
	throw new Error(`unexpected external require: ${specifier}`);
});

const mounted = [];
const ctx = {
	effect(fn) {
		return fn();
	},
	slots: {
		inject(_name, callback) {
			return callback();
		},
		register(options, component) {
			mounted.push({ options, component });
			return () => {};
		},
	},
};
plugin.apply(ctx);

const byName = (name) => mounted.find((entry) => entry.options.name === name);
const Footer = byName("sidebar.footer.action").component;
const Overlay = byName("shell.overlay").component;

const h = React.createElement;

function PreviewFrame() {
	return h("div", {
		style: {
			display: "flex",
			height: "100vh",
			fontFamily: "inherit",
			background: "#1b1c1f",
		},
	},
	h("aside", {
		style: {
			width: 280,
			flex: "none",
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: "14px 10px",
			boxSizing: "border-box",
			borderRight: "1px solid rgba(255,255,255,.07)",
			color: "#d9d7d3",
			fontSize: 13,
		},
	},
	h("div", { style: { fontSize: 12, opacity: 0.5, padding: "0 6px 4px", letterSpacing: ".4px" } }, "今天"),
	["重构登录流程", "整理发布检查清单", "写 1024 插件"].map((title) =>
		h("div", {
			key: title,
			style: { padding: "7px 8px", borderRadius: 8, background: title === "写 1024 插件" ? "rgba(255,255,255,.08)" : "transparent" },
		}, title)),
	h("div", { style: { flex: 1 } }),
	h("div", { style: { padding: "0 2px" } }, h(Footer, { wide: true })),
	h("div", { style: { padding: "8px 8px 0", fontSize: 12, opacity: 0.45 } }, "设置")),
	h("main", { style: { flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", color: "#6c6a66", fontSize: 13 } }, "会话语义区"),
	h(Overlay, {}));
}

ReactDOM.createRoot(document.getElementById("root")).render(h(PreviewFrame));
