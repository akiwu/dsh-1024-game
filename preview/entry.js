/**
 * 本地预览入口（不参与发布）：把 lib/client.js 当成真实 GUI 里的动态 bundle 加载，
 * 用一个最小 ctx 走完 apply()，然后搭一个「侧边栏面板列表 + 主面板」的假外壳。
 */
import "./loader-stub.js";
import "../lib/client.js";

import React from "react";
import ReactDOM from "react-dom/client";

import { registrations } from "./loader-stub.js";

const h = React.createElement;

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
	layout: {
		selectPanel(id) {
			console.log("[preview] selectPanel", id);
		},
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
const Panel = byName("main").component;
const PanelIcon = byName("sidebar.panellist").component;

/** 侧边栏里已有的「插件」图标，只用来说明我们的入口和它并列。 */
function PluginsGlyph() {
	return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
		h("circle", { cx: 8, cy: 8, r: 6.4, stroke: "currentColor", strokeWidth: 1.3 }),
		h("circle", { cx: 8, cy: 8, r: 2.2, stroke: "currentColor", strokeWidth: 1.3 }));
}

function SidebarRow({ icon, label, active }) {
	return h("div", {
		style: {
			display: "flex",
			alignItems: "center",
			gap: 10,
			padding: "7px 10px",
			borderRadius: 9,
			fontSize: 13.5,
			color: active ? "#f1efec" : "#a9a6a1",
			background: active ? "rgba(255,255,255,.08)" : "transparent",
		},
	}, h("span", { style: { display: "flex", color: active ? "#f1efec" : "#8f8c87" } }, icon), label);
}

function PreviewFrame() {
	return h("div", {
		style: { display: "flex", height: "100vh", background: "#1b1c1f", color: "#e8e6e3", fontFamily: "inherit" },
	},
	h("aside", {
		style: {
			width: 244,
			flex: "none",
			display: "flex",
			flexDirection: "column",
			gap: 2,
			padding: "16px 10px",
			boxSizing: "border-box",
			borderRight: "1px solid rgba(255,255,255,.07)",
			fontSize: 13,
		},
	},
	h("div", { style: { fontSize: 11.5, opacity: 0.45, padding: "0 10px 8px", letterSpacing: ".4px" } }, "今天"),
	["重构登录流程", "整理发布检查清单"].map((title) =>
		h(SidebarRow, {
			key: title,
			icon: h("span", { style: { display: "inline-block", width: 16, height: 16, borderRadius: 4, background: "currentColor", opacity: 0.25 } }),
			label: title,
			active: false,
		})),
	h("div", { style: { flex: 1 } }),
	h("div", { style: { height: 1, background: "rgba(255,255,255,.07)", margin: "8px 4px" } }),
	// 下面两行是「面板列表」：插件页与我们的游戏入口并列
	h(SidebarRow, { icon: h(PluginsGlyph, {}), label: "插件" }),
	h(SidebarRow, { icon: h(PanelIcon, { size: 16, active: true }), label: "1024 小游戏", active: true }),
	h("div", { style: { padding: "10px 10px 0", fontSize: 12.5, color: "#8f8c87" } }, "设置")),
	h("main", { style: { flex: 1, minWidth: 0, overflow: "hidden" } }, h(Panel, { onBack: () => {} })));
}

ReactDOM.createRoot(document.getElementById("root")).render(h(PreviewFrame));
