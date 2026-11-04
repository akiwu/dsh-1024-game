/**
 * 用 Playwright 给本地预览截图（开发用）。
 *
 * 预览页跑在一个临时静态服务器上（而不是 file://），这样 localStorage 与
 * 真实 GUI 一样可用；Playwright 默认从同级 StarOrbit 借用：
 *
 *   PLAYWRIGHT_DIR=/path/to/node_modules/playwright node scripts/screenshot.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..");

const playwrightDir = process.env.PLAYWRIGHT_DIR ?? path.join(project, "../StarOrbit/node_modules/playwright");
if (!fs.existsSync(path.join(playwrightDir, "index.js"))) throw new Error(`PLAYWRIGHT_DIR 无效：${playwrightDir}`);

const playwrightModule = await import(pathToFileURL(path.join(playwrightDir, "index.js")).href);
const { chromium } = playwrightModule.default ?? playwrightModule;

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
};

const server = http.createServer((request, response) => {
	const relative = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
	const file = path.join(project, relative === "/" ? "/preview/index.html" : relative);
	if (!file.startsWith(project)) {
		response.writeHead(403).end();
		return;
	}
	fs.readFile(file, (error, body) => {
		if (error !== null) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
		response.end(body);
	});
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const shots = [];

try {
	const page = await browser.newPage({ viewport: { width: 1180, height: 780 }, deviceScaleFactor: 2 });
	await page.goto(`${origin}/preview/index.html`);
	await page.waitForSelector(".dsh1024-footer");
	await page.screenshot({ path: path.join(project, "docs/screenshots/launcher.png") });
	shots.push("docs/screenshots/launcher.png");

	await page.click(".dsh1024-footer");
	await page.waitForSelector(".dsh1024-panel");
	for (const key of ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
		await page.keyboard.press(key);
		await page.waitForTimeout(60);
	}
	const tiles = await page.$$eval(".dsh1024-tile", (nodes) => nodes.map((node) => node.textContent));
	if (tiles.length < 2) throw new Error("棋盘上没有方块，移动事件可能没有生效");
	const score = await page.$eval(".dsh1024-score strong", (node) => node.textContent);
	console.log(`棋盘方块 ${tiles.length} 个，第一大项分数 ${score}`);
	await page.screenshot({ path: path.join(project, "docs/screenshots/game.png") });
	shots.push("docs/screenshots/game.png");

	// 达成 1024 的结算界面：先塞一盘 512+512 的残局，再左移合成。
	const winPage = await browser.newPage({ viewport: { width: 1180, height: 780 }, deviceScaleFactor: 2 });
	await winPage.addInitScript(() => {
		const board = [512, 512, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		window.localStorage.setItem("dsh-1024-game/state", JSON.stringify({
			v: 1,
			board,
			score: 4096,
			best: 4096,
			moves: 210,
			achieved: false,
			playable: true,
		}));
	});
	await winPage.goto(`${origin}/preview/index.html`);
	await winPage.click(".dsh1024-footer");
	await winPage.waitForSelector(".dsh1024-panel");
	await winPage.keyboard.press("ArrowLeft");
	await winPage.waitForSelector(".dsh1024-banner");
	await winPage.screenshot({ path: path.join(project, "docs/screenshots/win.png") });
	shots.push("docs/screenshots/win.png");
} finally {
	await browser.close();
	server.close();
}

console.log(shots.join("\n"));
