/**
 * 本地预览构建（开发用，不参与发布）。
 *
 * 预览需要两份外部依赖：esbuild 与 react/react-dom。它们不写进本项目的
 * dependencies（插件本身零依赖），默认从同级的 StarOrbit / KittyID 里借用；
 * 也可以用环境变量指定：
 *
 *   ESBUILD_DIR=/path/to/node_modules/esbuild \
 *   REACT_DIR=/path/to/node_modules/react \
 *   node preview/build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..");

async function resolvePackageDir(envName, fallbacks, marker) {
	const candidates = [process.env[envName], ...fallbacks].filter((value) => typeof value === "string" && value.length > 0);
	for (const candidate of candidates) {
		const dir = path.resolve(candidate);
		if (fs.existsSync(path.join(dir, marker))) return dir;
	}
	throw new Error(`${envName}: 找不到 ${marker}（试过 ${candidates.join(", ")}），请用环境变量指定`);
}

const esbuildDir = await resolvePackageDir("ESBUILD_DIR", [
	path.join(project, "../StarOrbit/node_modules/esbuild"),
	path.join(project, "../KittyID/node_modules/esbuild"),
], "lib/main.js");
const reactDir = await resolvePackageDir("REACT_DIR", [
	path.join(project, "../KittyID/node_modules/react"),
	path.join(project, "../KittyID/node_modules/react-dom"),
	path.join(project, "../StarOrbit/node_modules/react"),
], "package.json");

const esbuild = await import(pathToFileURL(path.join(esbuildDir, "lib/main.js")).href);

await esbuild.build({
	entryPoints: [path.join(here, "entry.js")],
	bundle: true,
	format: "iife",
	target: ["chrome120"],
	platform: "browser",
	outfile: path.join(here, "bundle.js"),
	nodePaths: [path.dirname(reactDir)],
	define: { "process.env.NODE_ENV": '"development"' },
	loader: { ".js": "jsx" },
	jsx: "transform",
	legalComments: "none",
});

console.log(`preview/bundle.js 已生成（esbuild ${esbuild.version}）`);
