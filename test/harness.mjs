import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

export const PACKAGE_NAME = "dsh-1024-game";

/** 内存版 localStorage，测试不碰真实浏览器存储。 */
export function memoryStorage(seed = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => {
			map.set(key, String(value));
		},
		removeItem: (key) => {
			map.delete(key);
		},
		clear: () => map.clear(),
		snapshot: () => Object.fromEntries(map),
	};
}

const reactStub = {
	createElement: () => null,
	useState: () => [undefined, () => {}],
	useEffect: () => {},
	useMemo: (factory) => factory(),
	useRef: (initial) => ({ current: initial }),
	useCallback: (fn) => fn,
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

/**
 * 在同一份沙箱里执行 lib/client.js，返回注册信息、导出与测试句柄。
 * 每次调用都是全新的模块实例（模拟一次页面 materialize）。
 */
export function loadPlugin({ storage = memoryStorage() } = {}) {
	const source = fs.readFileSync(path.join(ROOT, "lib", "client.js"), "utf8");
	const registrations = [];
	const appended = [];
	const created = [];

	const documentStub = {
		head: {
			appendChild: (node) => appended.push(node),
		},
		createElement: (tag) => {
			const node = {
				tag,
				textContent: "",
				attributes: {},
				removed: false,
				setAttribute(name, value) {
					this.attributes[name] = value;
				},
				remove() {
					this.removed = true;
				},
			};
			created.push(node);
			return node;
		},
	};

	const sandbox = {
		window: {
			__ModuleLoader__: {
				load: (registration) => registrations.push(registration),
			},
			localStorage: storage,
		},
		document: documentStub,
		console,
	};
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, { filename: "lib/client.js" });

	if (registrations.length !== 1) throw new Error(`expected one __ModuleLoader__.load call, saw ${registrations.length}`);

	const registration = registrations[0];
	const requested = [];
	const exports = registration.factory((specifier) => {
		requested.push(specifier);
		if (specifier === "react") return reactStub;
		throw new Error(`unexpected external require: ${specifier}`);
	});

	return { registration, exports, storage, documentStub, appended, created, requested, sandbox };
}

/** 极简 ctx：记录 effect 与 slot 注册，便于断言卸载行为。 */
export function createClientContext() {
	const effects = [];
	const slots = [];
	const ctx = {
		effects,
		slots: [],
		effect(fn, label) {
			const disposer = fn();
			effects.push({ label, disposer });
			return () => disposer?.();
		},
	};
	ctx.slots = {
		inject(name, callback) {
			const disposer = callback();
			return () => disposer?.();
		},
		register(options, component) {
			slots.push({ options, component });
			return () => {};
		},
	};
	ctx.registrations = slots;
	ctx.layout = { selectPanel() {} };
	return ctx;
}

/** 便捷构造：行优先一维数组 → 棋盘。 */
export const board = (...rows) => rows.flat();

/** vm 沙箱与宿主 realm 的 Array/Object 原型不同，深比较前先转成宿主普通值。 */
export const plain = (value) => JSON.parse(JSON.stringify(value));
