/**
 * 本地预览用的加载器桩：在真实 GUI 里这段由 DSH 注入的
 * `window.__ModuleLoader__` 队列替代，这里只收集注册。
 */
export const registrations = [];

window.__ModuleLoader__ = {
	mode: "queue",
	pendingQueue: registrations,
	load(registration) {
		registrations.push(registration);
	},
};
