import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { PACKAGE_NAME, ROOT, createClientContext, loadPlugin, plain } from "./harness.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("package.json：浏览器半包声明可被 DSH client-modules 解析", () => {
	assert.equal(manifest.name, PACKAGE_NAME);
	assert.equal(manifest.type, "module");
	assert.equal(manifest.dsh.client.platform, "web");
	assert.equal(typeof manifest.dsh.bundle.patch, "string");
	assert.ok(manifest.exports["./client"], "缺少 exports[./client]");
	assert.ok(manifest.exports["./package.json"], "缺少 exports[./package.json]");
	assert.ok(fs.existsSync(path.join(ROOT, manifest.main)), "main 指向的文件不存在");
	assert.ok(fs.existsSync(path.join(ROOT, manifest.dsh.bundle.patch)), "bundle patch 不存在");
	assert.ok(fs.existsSync(path.join(ROOT, manifest.exports["./client"].default)), "client bundle 不存在");
});

test("cordis.patch.yml：插入一行，行名就是包名", () => {
	const patch = fs.readFileSync(path.join(ROOT, manifest.dsh.bundle.patch), "utf8");
	const names = [...patch.matchAll(/^\s*name:\s*'?"?([^'"\n]+)'?"?\s*$/gm)].map((match) => match[1]);
	assert.deepEqual(names, [PACKAGE_NAME]);
	const ids = [...patch.matchAll(/^\s*-\s*id:\s*'?"?([^'"\n]+)'?"?\s*$/gm)].map((match) => match[1]);
	assert.equal(ids.length, 1);
});

test("bundle：注册 id 与包名一致，工厂只依赖平台基座里的 react", () => {
	const { registration, exports, requested } = loadPlugin();
	assert.equal(registration.id, PACKAGE_NAME);
	assert.deepEqual(requested, ["react"]);
	assert.equal(typeof exports.apply, "function");
	assert.deepEqual(plain(exports.inject), ["slots"]);
	assert.equal(typeof exports.GameFooterButton, "function");
	assert.equal(typeof exports.GameOverlay, "function");
});

test("apply：注入可回收的样式，并向两个挂载点注册", () => {
	const { exports, created } = loadPlugin();
	const ctx = createClientContext();
	exports.apply(ctx);

	const style = created.find((node) => node.tag === "style");
	assert.ok(style, "没有创建 <style>");
	assert.equal(style.attributes["data-dsh-1024-game"], "");
	assert.match(style.textContent, /dsh1024-panel/);

	const names = ctx.registrations.map((entry) => entry.options.name);
	assert.deepEqual(names, ["sidebar.footer.action", "shell.overlay"]);
	const footer = ctx.registrations.find((entry) => entry.options.name === "sidebar.footer.action");
	assert.equal(footer.options.id, "1024-game");
	assert.equal(typeof footer.component, "function");
	const overlay = ctx.registrations.find((entry) => entry.options.name === "shell.overlay");
	assert.equal(overlay.options.id, "1024-game.dialog");
	assert.equal(typeof overlay.component, "function");

	// 插件卸载（fiber 销毁）时样式必须摘掉，避免热重载堆叠。
	for (const effect of ctx.effects) effect.disposer?.();
	assert.equal(style.removed, true);
});

test("键盘映射覆盖方向键与 WASD", () => {
	const { exports } = loadPlugin();
	const map = exports.__internal.keyToDirection;
	assert.equal(map("ArrowLeft"), "left");
	assert.equal(map("a"), "left");
	assert.equal(map("D"), "right");
	assert.equal(map("w"), "up");
	assert.equal(map("ArrowDown"), "down");
	assert.equal(map("Enter"), undefined);
});
