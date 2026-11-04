/**
 * dsh-1024-game — 浏览器半包。
 *
 * 构建约定：本文件是 DSH 模块加载器的“工厂式 CJS”bundle，
 * 执行时只向 `window.__ModuleLoader__` 注册工厂，模块体（含样式注入）
 * 在首次 materialize 时才运行。只 require 平台基座里的 react。
 *
 * 两个挂载点（都是主面板页，不再有全屏弹层）：
 *   - `main`（keyed，key = PANEL_ID）：面板内容本体。
 *   - `sidebar.panellist`（list，id = PANEL_ID）：左侧栏面板列表里的图标入口，
 *     与「插件」那一行并列；侧边栏自己负责点击后 `selectPanel`。
 *
 * 游戏状态在模块内单例保存，切到别的面板再回来不丢局；同时写入 localStorage。
 */
window.__ModuleLoader__.load({
	id: "dsh-1024-game",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;
		const { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } = React;

		// #region 常量
		const SIZE = 4;
		const WIN_TILE = 1024;
		const HISTORY_LIMIT = 32;
		const PANEL_ID = "1024-game";
		const BEST_KEY = "dsh-1024-game/best";
		const STATE_KEY = "dsh-1024-game/state";
		// #endregion

		// #region 纯游戏逻辑（可单测，见 test/game.test.mjs）
		/** 空棋盘：行优先的一维数组，0 表示空格。 */
		function emptyBoard() {
			return new Array(SIZE * SIZE).fill(0);
		}

		/** 把「方向 + 行号 + 行内位置」换算成棋盘下标。 */
		function cellIndex(direction, line, position) {
			const offset = direction === "right" || direction === "down" ? SIZE - 1 - position : position;
			if (direction === "left" || direction === "right") return line * SIZE + offset;
			return offset * SIZE + line;
		}

		/** 按移动方向读出第 line 行/列，位置 0 是移动方向的最前端。 */
		function readLine(board, direction, line) {
			const values = new Array(SIZE);
			for (let position = 0; position < SIZE; position += 1) {
				values[position] = board[cellIndex(direction, line, position)];
			}
			return values;
		}

		/**
		 * 单行压缩 + 合并：先去掉 0，再从左到右两两合并（同一次移动每块只合并一次）。
		 * @returns 结果行、本次得分、以及发生合并的“最终位置”。
		 */
		function slideLine(values) {
			const tiles = [];
			for (const value of values) if (value !== 0) tiles.push(value);
			const next = [];
			const mergedPositions = [];
			let score = 0;
			let index = 0;
			while (index < tiles.length) {
				if (tiles[index] === tiles[index + 1]) {
					const merged = tiles[index] * 2;
					next.push(merged);
					mergedPositions.push(next.length - 1);
					score += merged;
					index += 2;
				} else {
					next.push(tiles[index]);
					index += 1;
				}
			}
			while (next.length < SIZE) next.push(0);
			return { values: next, score, mergedPositions };
		}

		/**
		 * 在整盘上执行一次移动。
		 * @returns `null` 表示这个方向不改变棋盘（不触发新方块）；否则返回新棋盘、得分与合并格。
		 */
		function moveBoard(board, direction) {
			const next = board.slice();
			const merged = [];
			let score = 0;
			let moved = false;
			for (let line = 0; line < SIZE; line += 1) {
				const lineValues = readLine(board, direction, line);
				const slid = slideLine(lineValues);
				for (let position = 0; position < SIZE; position += 1) {
					const index = cellIndex(direction, line, position);
					if (next[index] !== slid.values[position]) moved = true;
					next[index] = slid.values[position];
				}
				score += slid.score;
				for (const position of slid.mergedPositions) merged.push(cellIndex(direction, line, position));
			}
			if (!moved) return null;
			return { board: next, score, merged };
		}

		function emptyIndices(board) {
			const indices = [];
			for (let index = 0; index < board.length; index += 1) if (board[index] === 0) indices.push(index);
			return indices;
		}

		/** 在随机空格里落一个新方块（90% 是 2，10% 是 4）。 */
		function spawnTile(board, random) {
			const empty = emptyIndices(board);
			if (empty.length === 0) return null;
			const pick = Math.min(empty.length - 1, Math.max(0, Math.floor(random() * empty.length)));
			const value = random() < 0.9 ? 2 : 4;
			const next = board.slice();
			next[empty[pick]] = value;
			return { board: next, index: empty[pick], value };
		}

		/** 是否还有合法移动：存在空格，或相邻同值。 */
		function canPlay(board) {
			for (let index = 0; index < board.length; index += 1) {
				if (board[index] === 0) return true;
				const row = Math.floor(index / SIZE);
				const column = index % SIZE;
				if (column + 1 < SIZE && board[index] === board[index + 1]) return true;
				if (row + 1 < SIZE && board[index] === board[index + SIZE]) return true;
			}
			return false;
		}

		function maxTile(board) {
			let max = 0;
			for (const value of board) if (value > max) max = value;
			return max;
		}

		function hasWon(board) {
			return maxTile(board) >= WIN_TILE;
		}

		/** 开新局：两枚初始方块。 */
		function freshState(random, best) {
			const first = spawnTile(emptyBoard(), random);
			const second = spawnTile(first.board, random);
			return {
				board: second.board,
				score: 0,
				best: Math.max(best, 0),
				moves: 0,
				status: "playing",
				achieved: false,
				history: [],
				seq: 0,
				merged: [],
				spawned: second.index,
			};
		}

		/** 执行一步：棋盘变了才落新方块、记历史、更新状态。 */
		function applyMove(state, direction, random) {
			if (state.status !== "playing") return state;
			const moved = moveBoard(state.board, direction);
			if (moved === null) return state;
			const spawned = spawnTile(moved.board, random);
			const board = spawned.board;
			const score = state.score + moved.score;
			const achieved = state.achieved || hasWon(board);
			const status = achieved ? "won" : canPlay(board) ? "playing" : "over";
			const history = [...state.history, { board: state.board, score: state.score, achieved: state.achieved }].slice(-HISTORY_LIMIT);
			return {
				...state,
				board,
				score,
				best: Math.max(state.best, score),
				moves: state.moves + 1,
				status,
				achieved,
				history,
				seq: state.seq + 1,
				merged: moved.merged,
				spawned: spawned.index,
			};
		}

		/** 达成 1024 后选择继续：若已无路可走则直接判负。 */
		function continueGame(state) {
			if (state.status !== "won") return state;
			return { ...state, status: canPlay(state.board) ? "playing" : "over", merged: [], spawned: null };
		}

		function undoMove(state) {
			if (state.history.length === 0) return state;
			const history = state.history.slice();
			const previous = history.pop();
			return {
				...state,
				board: previous.board,
				score: previous.score,
				achieved: previous.achieved,
				status: "playing",
				history,
				merged: [],
				spawned: null,
				seq: state.seq + 1,
			};
		}
		// #endregion

		// #region 本地持久化
		function readStorage(key) {
			try {
				return window.localStorage.getItem(key);
			} catch {
				return null;
			}
		}

		function writeStorage(key, value) {
			try {
				window.localStorage.setItem(key, value);
			} catch {
				/* 隐私模式 / 配额满：静默放弃持久化，游戏照常可玩 */
			}
		}

		function loadBest() {
			const raw = readStorage(BEST_KEY);
			const value = raw === null ? 0 : Number(raw);
			return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
		}

		function saveBest(best) {
			writeStorage(BEST_KEY, String(best));
		}

		function isBoard(value) {
			return Array.isArray(value) && value.length === SIZE * SIZE && value.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 1 << 20);
		}

		function saveGame(state) {
			writeStorage(STATE_KEY, JSON.stringify({
				v: 1,
				board: state.board,
				score: state.score,
				best: state.best,
				moves: state.moves,
				achieved: state.achieved,
				playable: state.status !== "over",
			}));
		}

		/** 读取上次的残局；数据不合法就开新局，不让坏存档卡住插件。 */
		function loadGame(random) {
			const best = loadBest();
			const raw = readStorage(STATE_KEY);
			if (raw !== null) {
				try {
					const saved = JSON.parse(raw);
					if (saved !== null && typeof saved === "object" && saved.v === 1 && isBoard(saved.board) && Number.isFinite(saved.score) && saved.score >= 0) {
						const playable = saved.playable !== false && canPlay(saved.board);
						return {
							board: saved.board.slice(),
							score: Math.floor(saved.score),
							best: Math.max(best, Number.isFinite(saved.best) ? Math.floor(saved.best) : 0),
							moves: Number.isFinite(saved.moves) ? Math.floor(saved.moves) : 0,
							status: playable ? "playing" : "over",
							achieved: saved.achieved === true,
							history: [],
							seq: 0,
							merged: [],
							spawned: null,
						};
					}
				} catch {
					/* 坏存档按开新局处理 */
				}
			}
			const fresh = freshState(random, best);
			saveBest(fresh.best);
			return fresh;
		}
		// #endregion

		// #region 单例 store
		function createStore(initial) {
			let state = initial;
			const listeners = new Set();
			return {
				get: () => state,
				set(next) {
					state = typeof next === "function" ? next(state) : next;
					for (const listener of listeners) listener();
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
		}

		const random = Math.random;
		const game = createStore(loadGame(random));

		/** 统一的“改状态 + 落盘 + 广播”入口，UI 只调这里。 */
		function commit(next) {
			const previous = game.get();
			if (next === previous) return;
			game.set(next);
			if (next.best > previous.best) saveBest(next.best);
			saveGame(next);
		}

		const actions = {
			move(direction) {
				commit(applyMove(game.get(), direction, random));
			},
			undo() {
				commit(undoMove(game.get()));
			},
			restart() {
				commit(freshState(random, game.get().best));
			},
			continue() {
				commit(continueGame(game.get()));
			},
		};
		// #endregion

		// #region 样式
		const STYLES = `
/* 侧边栏面板列表里的图标：纯 currentColor，跟随主题 */
.dsh1024-icon{display:block;flex:none}

/* —— 主面板页 —— */
.dsh1024-page{box-sizing:border-box;height:100%;overflow:auto;color:var(--dsw-alias-label-primary,inherit);
  padding:calc(var(--dsh-frame-top-clearance,0px) + 28px) clamp(20px,4vw,48px) 40px;
  font-family:inherit;-webkit-font-smoothing:antialiased}
.dsh1024-inner{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:26px}
.dsh1024-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dsh1024-brand{display:flex;align-items:center;gap:14px;min-width:0}
.dsh1024-badge{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;
  border-radius:13px;background:linear-gradient(135deg,#f2b179,#f59563);color:#fff;font-weight:800;font-size:15px;
  letter-spacing:-.3px;font-variant-numeric:tabular-nums;box-shadow:0 6px 16px rgba(242,177,121,.28)}
.dsh1024-title h1{margin:0;font-size:21px;font-weight:700;letter-spacing:.2px;line-height:1.25}
.dsh1024-title p{margin:3px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.9;line-height:1.5}
.dsh1024-stats{display:flex;gap:8px;flex-wrap:wrap}
.dsh1024-stat{min-width:76px;padding:7px 12px;border-radius:12px;text-align:center;
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));
  border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18))}
.dsh1024-stat span{display:block;font-size:10.5px;letter-spacing:.4px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.85}
.dsh1024-stat strong{display:block;font-size:16px;font-variant-numeric:tabular-nums;margin-top:1px}

.dsh1024-layout{display:grid;grid-template-columns:minmax(260px,400px) minmax(240px,1fr);gap:clamp(20px,3vw,36px);align-items:start}
@media (max-width:780px){.dsh1024-layout{grid-template-columns:1fr}}

.dsh1024-board-wrap{position:relative}
.dsh1024-board{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px;border-radius:14px;
  background:#bbada0;aspect-ratio:1/1;touch-action:none;user-select:none;-webkit-user-select:none}
.dsh1024-cell{position:relative;border-radius:9px;background:rgba(238,228,218,.35)}
.dsh1024-tile{position:absolute;inset:0;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-variant-numeric:tabular-nums;user-select:none;box-shadow:inset 0 -2px 0 rgba(0,0,0,.06)}
.dsh1024-tile.is-new{animation:dsh1024-pop .16s ease-out}
.dsh1024-tile.is-big{box-shadow:inset 0 0 0 1px rgba(255,255,255,.4),0 0 16px rgba(255,215,120,.5)}

.dsh1024-banner{position:absolute;inset:0;border-radius:14px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:12px;text-align:center;padding:18px;background:rgba(24,25,29,.86);
  backdrop-filter:blur(3px);color:#f4f2ee;animation:dsh1024-fade .2s ease-out}
.dsh1024-banner strong{font-size:19px;font-weight:800}
.dsh1024-banner p{margin:0;font-size:12.5px;opacity:.75;line-height:1.6;max-width:260px}

.dsh1024-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.dsh1024-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;
  padding:8px 14px;border-radius:10px;cursor:pointer;color:var(--dsw-alias-label-primary,inherit);
  border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.24));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));
  transition:background .15s ease,transform .08s ease}
.dsh1024-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}
.dsh1024-btn:active:not(:disabled){transform:scale(.985)}
.dsh1024-btn:disabled{opacity:.4;cursor:default}
.dsh1024-btn.is-primary{background:linear-gradient(135deg,#f2b179,#f59563);border-color:transparent;color:#3a2a1e}
.dsh1024-btn.is-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-tertiary,inherit)}
.dsh1024-btn.is-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh1024-kbd-inline{font-size:11px;opacity:.6;font-weight:500}

/* —— 右侧说明 —— */
.dsh1024-help{display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.65}
.dsh1024-card{padding:16px 18px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.18));
  background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.05))}
.dsh1024-card h2{margin:0 0 10px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary,currentColor)}
.dsh1024-rules{margin:0;padding-left:17px;display:flex;flex-direction:column;gap:7px}
.dsh1024-rules b{font-weight:700}
.dsh1024-keys{display:flex;flex-direction:column;gap:9px;margin:0}
.dsh1024-keys>div{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dsh1024-keys>div>span{margin-left:auto;padding-left:10px;font-size:12.5px;color:var(--dsw-alias-label-secondary,currentColor)}
kbd{display:inline-flex;align-items:center;justify-content:center;min-width:25px;height:25px;padding:0 7px;
  border-radius:7px;font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);
  border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));
  background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12));
  box-shadow:0 1px 0 rgba(0,0,0,.12)}
.dsh1024-footnote{margin:0;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.85}

@keyframes dsh1024-pop{0%{transform:scale(.55);opacity:.35}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
@keyframes dsh1024-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dsh1024-tile.is-new,.dsh1024-banner{animation:none}}
`;
		// #endregion

		// #region 展示层
		/** 方块配色沿用经典 2048 色板，1024 之后进入“冷色”区。 */
		const TILE_STYLES = {
			2: { backgroundColor: "#eee4da", color: "#4b4038" },
			4: { backgroundColor: "#ede0c8", color: "#4b4038" },
			8: { backgroundColor: "#f2b179", color: "#fff8f0" },
			16: { backgroundColor: "#f59563", color: "#fff8f0" },
			32: { backgroundColor: "#f67c5f", color: "#fff8f0" },
			64: { backgroundColor: "#f65e3b", color: "#fff8f0" },
			128: { backgroundColor: "#edcf72", color: "#3d3320" },
			256: { backgroundColor: "#edcc61", color: "#3d3320" },
			512: { backgroundColor: "#edc850", color: "#3d3320" },
			1024: { backgroundColor: "#edc53f", color: "#3d3320" },
			2048: { backgroundColor: "#9fbfdf", color: "#1e2f3f" },
			4096: { backgroundColor: "#7aa7d8", color: "#12202c" },
		};

		function tileStyle(value) {
			const palette = TILE_STYLES[value] ?? { backgroundColor: "#5a6b7d", color: "#eef4fa" };
			const digits = String(value).length;
			const fontSize = digits >= 4 ? 21 : digits === 3 ? 25 : 29;
			return { ...palette, fontSize: `${fontSize}px`, letterSpacing: digits >= 4 ? "-0.5px" : "0" };
		}

		function keyToDirection(key) {
			switch (key) {
				case "ArrowLeft":
				case "a":
				case "A":
					return "left";
				case "ArrowRight":
				case "d":
				case "D":
					return "right";
				case "ArrowUp":
				case "w":
				case "W":
					return "up";
				case "ArrowDown":
				case "s":
				case "S":
					return "down";
				default:
					return undefined;
			}
		}

		function isTypingTarget(target) {
			if (target === null || typeof target !== "object") return false;
			if (target.isContentEditable === true) return true;
			const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
			return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
		}

		/** 侧边栏面板列表里的图标（16/18px 由侧边栏决定），纯 currentColor。 */
		function GamePanelIcon({ size = 16 }) {
			const edge = Number.isFinite(size) ? size : 16;
			return h("svg", {
				className: "dsh1024-icon",
				width: edge,
				height: edge,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
			},
			h("rect", { x: 1.1, y: 1.1, width: 13.8, height: 13.8, rx: 3.4, stroke: "currentColor", strokeWidth: 1.35, opacity: 0.85 }),
			h("rect", { x: 4, y: 4, width: 3.3, height: 3.3, rx: 1, fill: "currentColor" }),
			h("rect", { x: 8.7, y: 4, width: 3.3, height: 3.3, rx: 1, fill: "currentColor", opacity: 0.6 }),
			h("rect", { x: 4, y: 8.7, width: 3.3, height: 3.3, rx: 1, fill: "currentColor", opacity: 0.6 }),
			h("rect", { x: 8.7, y: 8.7, width: 3.3, height: 3.3, rx: 1, fill: "currentColor", opacity: 0.32 }));
		}

		function Stat({ label, value }) {
			return h("div", { className: "dsh1024-stat" },
				h("span", null, label),
				h("strong", null, String(value)));
		}

		function KeyRow({ keys, children }) {
			return h("div", null,
				keys.map((key) => h("kbd", { key }, key)),
				h("span", null, children));
		}

		/**
		 * 面板本体。只在被选中时挂载（main 是 keyed slot），所以键盘监听天然跟随面板：
		 * 切到别的面板或回到会话，监听随组件卸载一起消失，不会抢输入框的按键。
		 */
		function GamePanel({ onBack }) {
			const state = useSyncExternalStore(game.subscribe, game.get);
			const touchRef = useRef(null);

			useEffect(() => {
				const onKeyDown = (event) => {
					if (event.defaultPrevented) return;
					const mod = event.metaKey || event.ctrlKey;
					if (mod && !event.shiftKey && !event.altKey && (event.key === "z" || event.key === "Z")) {
						event.preventDefault();
						actions.undo();
						return;
					}
					if (mod || event.altKey) return;
					if (isTypingTarget(event.target)) return;
					const direction = keyToDirection(event.key);
					if (direction !== undefined) {
						event.preventDefault();
						actions.move(direction);
						return;
					}
					if (event.key === "r" || event.key === "R") {
						event.preventDefault();
						actions.restart();
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, []);

			const onTouchStart = useCallback((event) => {
				const touch = event.touches[0];
				if (touch === undefined) return;
				touchRef.current = { x: touch.clientX, y: touch.clientY };
			}, []);

			const onTouchEnd = useCallback((event) => {
				const start = touchRef.current;
				touchRef.current = null;
				const touch = event.changedTouches[0];
				if (start === null || start === undefined || touch === undefined) return;
				const dx = touch.clientX - start.x;
				const dy = touch.clientY - start.y;
				if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
				if (Math.abs(dx) > Math.abs(dy)) actions.move(dx > 0 ? "right" : "left");
				else actions.move(dy > 0 ? "down" : "up");
			}, []);

			const animated = useMemo(() => {
				const cells = new Set();
				for (const index of state.merged) cells.add(index);
				if (state.spawned !== null) cells.add(state.spawned);
				return cells;
			}, [state.merged, state.spawned, state.seq]);

			const banner = state.status === "won"
				? h("div", { className: "dsh1024-banner", role: "status" },
					h("strong", null, "🎉 达成 1024"),
					h("p", null, `本局 ${state.moves} 步，得分 ${state.score}。可以继续挑战更高分。`),
					h("div", { className: "dsh1024-actions" },
						h("button", { type: "button", className: "dsh1024-btn is-primary", onClick: () => actions.continue() }, "继续挑战"),
						h("button", { type: "button", className: "dsh1024-btn", onClick: () => actions.restart() }, "新游戏")))
				: state.status === "over"
					? h("div", { className: "dsh1024-banner", role: "status" },
						h("strong", null, "没有可移动的方块了"),
						h("p", null, `本局 ${state.moves} 步，得分 ${state.score}，最大方块 ${maxTile(state.board)}。`),
						h("div", { className: "dsh1024-actions" },
							h("button", { type: "button", className: "dsh1024-btn is-primary", onClick: () => actions.restart() }, "再来一局"),
							state.history.length > 0
								? h("button", { type: "button", className: "dsh1024-btn", onClick: () => actions.undo() }, "撤销一步")
								: null))
					: null;

			return h("div", { className: "dsh1024-page", "data-dsh-1024-page": "" },
				h("div", { className: "dsh1024-inner" },
					h("header", { className: "dsh1024-head" },
						h("div", { className: "dsh1024-brand" },
							h("span", { className: "dsh1024-badge" }, "1024"),
							h("div", { className: "dsh1024-title" },
								h("h1", null, "1024 小游戏"),
								h("p", null, "同值方块相撞合并，合成出 1024 就赢。"))),
						h("div", { className: "dsh1024-stats" },
							h(Stat, { label: "分数", value: state.score }),
							h(Stat, { label: "最高", value: state.best }),
							h(Stat, { label: "步数", value: state.moves }))),
					h("div", { className: "dsh1024-layout" },
						h("div", null,
							h("div", { className: "dsh1024-board-wrap" },
								h("div", {
									className: "dsh1024-board",
									role: "group",
									"aria-label": `1024 棋盘，当前得分 ${state.score}`,
									onTouchStart,
									onTouchEnd,
								}, state.board.map((value, index) => {
									const animate = animated.has(index);
									return h("div", { key: index, className: "dsh1024-cell" },
										value === 0 ? null : h("div", {
											key: animate ? `${index}-${state.seq}` : `${index}-still`,
											className: `dsh1024-tile${animate ? " is-new" : ""}${value >= WIN_TILE ? " is-big" : ""}`,
											style: tileStyle(value),
										}, String(value)));
								})),
								banner),
							h("div", { className: "dsh1024-actions" },
								h("button", {
									type: "button",
									className: "dsh1024-btn",
									onClick: () => actions.undo(),
									disabled: state.history.length === 0,
								}, "撤销", h("span", { className: "dsh1024-kbd-inline" }, "⌘/Ctrl+Z")),
								h("button", { type: "button", className: "dsh1024-btn", onClick: () => actions.restart() }, "新游戏", h("span", { className: "dsh1024-kbd-inline" }, "R")),
								onBack === undefined ? null : h("button", { type: "button", className: "dsh1024-btn is-ghost", onClick: onBack }, "返回会话"))),
						h("aside", { className: "dsh1024-help" },
							h("section", { className: "dsh1024-card" },
								h("h2", null, "怎么玩"),
								h("ol", { className: "dsh1024-rules" },
									h("li", null, "按方向键，让所有方块朝这个方向滑到底。"),
									h("li", null, "两个", h("b", null, "同值"), "方块撞在一起会合并成它们的和，并计入分数。"),
									h("li", null, "每走一步，棋盘会随机多出一个 2 或 4。"),
									h("li", null, "合成出 ", h("b", null, "1024"), " 即达成；棋盘塞满且没有可合并的相邻方块时本局结束。"))),
							h("section", { className: "dsh1024-card" },
								h("h2", null, "按键"),
								h("div", { className: "dsh1024-keys" },
									h(KeyRow, { keys: ["←", "↑", "→", "↓"] }, "移动方块"),
									h(KeyRow, { keys: ["W", "A", "S", "D"] }, "同方向移动"),
									h(KeyRow, { keys: ["R"] }, "重新开局"),
									h(KeyRow, { keys: ["⌘/Ctrl", "Z"] }, "撤销一步"),
									h(KeyRow, { keys: ["拖动"] }, "触屏：在棋盘上滑动"))),
							h("p", { className: "dsh1024-footnote" },
								"进度与最高分保存在本机；切到别的面板再回来，棋局还在。")))));
		}
		// #endregion

		// #region 插件入口
		const inject = ["slots", "layout"];

		/**
		 * 客户端插件主体：注入样式，注册主面板与它在侧边栏面板列表里的入口。
		 * 侧边栏负责点击后 `selectPanel(PANEL_ID)`，所以图标组件只画图标。
		 */
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.setAttribute("data-dsh-1024-game", "");
				style.textContent = STYLES;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, "1024-game/styles");

			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				inject: () => ({ onBack: () => ctx.layout.selectPanel(null) }),
			}, GamePanel));

			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 20,
				label: "1024 小游戏",
			}, GamePanelIcon));
		}
		// #endregion

		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		exports.GamePanel = GamePanel;
		exports.GamePanelIcon = GamePanelIcon;
		/** 纯逻辑与单例句柄，仅供测试/调试使用，不属于插件契约。 */
		exports.__internal = {
			SIZE,
			WIN_TILE,
			PANEL_ID,
			BEST_KEY,
			STATE_KEY,
			emptyBoard,
			slideLine,
			moveBoard,
			spawnTile,
			canPlay,
			maxTile,
			freshState,
			applyMove,
			continueGame,
			undoMove,
			loadGame,
			saveGame,
			loadBest,
			game,
			actions,
			keyToDirection,
		};
		return module.exports;
	}
});
