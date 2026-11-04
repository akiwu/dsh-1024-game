import assert from "node:assert/strict";
import test from "node:test";

import { board, loadPlugin, memoryStorage, plain } from "./harness.mjs";

/** 每个用例都用新模块实例，避免单例 store 相互污染。 */
function plugin() {
	return loadPlugin().exports.__internal;
}

const zeros = (count) => new Array(count).fill(0);

test("slideLine：两枚同值合并，得分记合并值", () => {
	const game = plugin();
	assert.deepEqual(plain(game.slideLine([2, 2, 0, 0])), { values: [4, 0, 0, 0], score: 4, mergedPositions: [0] });
});

test("slideLine：一次移动里每块只合并一次", () => {
	const game = plugin();
	assert.deepEqual(plain(game.slideLine([2, 2, 2, 2])), { values: [4, 4, 0, 0], score: 8, mergedPositions: [0, 1] });
	assert.deepEqual(plain(game.slideLine([2, 2, 2, 0])), { values: [4, 2, 0, 0], score: 4, mergedPositions: [0] });
	assert.deepEqual(plain(game.slideLine([4, 4, 8, 8])), { values: [8, 16, 0, 0], score: 24, mergedPositions: [0, 1] });
});

test("slideLine：合并产物不会在同一步里再次合并", () => {
	const game = plugin();
	assert.deepEqual(plain(game.slideLine([2, 2, 4, 0])), { values: [4, 4, 0, 0], score: 4, mergedPositions: [0] });
	assert.deepEqual(plain(game.slideLine([4, 0, 4, 4])), { values: [8, 4, 0, 0], score: 8, mergedPositions: [0] });
});

test("slideLine：纯位移不加分", () => {
	const game = plugin();
	assert.deepEqual(plain(game.slideLine([0, 2, 0, 4])), { values: [2, 4, 0, 0], score: 0, mergedPositions: [] });
});

test("moveBoard：四个方向都落到正确格子", () => {
	const game = plugin();
	const start = board(
		[2, 0, 2, 0],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
	);
	assert.deepEqual(plain(game.moveBoard(start, "left").board), board([4, 0, 0, 0], zeros(4), zeros(4), zeros(4)));
	assert.deepEqual(plain(game.moveBoard(start, "right").board), board([0, 0, 0, 4], zeros(4), zeros(4), zeros(4)));

	const column = board([2, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], zeros(4));
	assert.deepEqual(plain(game.moveBoard(column, "up").board), board([4, 0, 0, 0], zeros(4), zeros(4), zeros(4)));
	assert.deepEqual(plain(game.moveBoard(column, "down").board), board(zeros(4), zeros(4), zeros(4), [4, 0, 0, 0]));
});

test("moveBoard：无变化的移动返回 null（不落新方块）", () => {
	const game = plugin();
	const packed = board([2, 4, 8, 16], zeros(4), zeros(4), zeros(4));
	assert.equal(game.moveBoard(packed, "left"), null);
	assert.equal(game.moveBoard(packed, "up"), null);
});

test("moveBoard：四个方向都把得分与合并格算全", () => {
	const game = plugin();
	const start = board(
		[2, 2, 2, 2],
		[4, 4, 4, 4],
		zeros(4),
		zeros(4),
	);
	const left = game.moveBoard(start, "left");
	assert.equal(left.score, 8 + 16);
	assert.deepEqual(plain(left.board.slice(0, 8)), [4, 4, 0, 0, 8, 8, 0, 0]);
	assert.deepEqual(plain(left.merged.slice(0, 4)), [0, 1, 4, 5]);
});

test("spawnTile：按 random 选空格与数值，盘满返回 null", () => {
	const game = plugin();
	const empty = game.emptyBoard();
	const first = game.spawnTile(empty, () => 0);
	assert.deepEqual({ index: first.index, value: first.value }, { index: 0, value: 2 });

	const high = game.spawnTile(empty, () => 0.99);
	assert.deepEqual({ index: high.index, value: high.value }, { index: 15, value: 4 });

	const full = board([2, 4], [4, 2], [2, 4], [4, 2]);
	assert.equal(game.spawnTile(full, () => 0), null);
});

test("canPlay：有空位或邻居同值才可继续", () => {
	const game = plugin();
	assert.equal(game.canPlay(game.emptyBoard()), true);
	assert.equal(game.canPlay(board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2])), false);
	assert.equal(game.canPlay(board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4])), true);
	assert.equal(game.canPlay(board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 0, 2])), true);
});

test("freshState：初始两枚方块，得分归零", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 120);
	const filled = state.board.filter((value) => value !== 0);
	assert.equal(filled.length, 2);
	assert.equal(state.score, 0);
	assert.equal(state.moves, 0);
	assert.equal(state.status, "playing");
	assert.equal(state.best, 120);
});

test("applyMove：合并计分、落新方块、记历史", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 0);
	state.board = board([2, 2, 0, 0], zeros(4), zeros(4), zeros(4));
	const moved = game.applyMove(state, "left", () => 0);
	assert.equal(moved.score, 4);
	assert.equal(moved.moves, 1);
	assert.equal(moved.board[0], 4);
	assert.equal(moved.board.filter((value) => value !== 0).length, 2);
	assert.equal(moved.history.length, 1);
	assert.deepEqual(plain(moved.history[0].board), plain(state.board));
	assert.equal(moved.spawned !== null, true);
	assert.equal(moved.seq, 1);
});

test("applyMove：无效方向返回同一状态引用", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 0);
	state.board = board([2, 4, 8, 16], zeros(4), zeros(4), zeros(4));
	assert.equal(game.applyMove(state, "left", () => 0), state);
});

test("applyMove：合成 1024 判定胜利，继续后回到进行中", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 0);
	state.board = board([512, 512, 0, 0], zeros(4), zeros(4), zeros(4));
	const won = game.applyMove(state, "left", () => 0.5);
	assert.equal(won.board[0], 1024);
	assert.equal(won.status, "won");
	assert.equal(won.achieved, true);

	const resumed = game.continueGame(won);
	assert.equal(resumed.status, "playing");
});

test("applyMove：满盘无路可走判定结束", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 0);
	state.board = board(
		[4, 2, 4, 2],
		[2, 4, 2, 4],
		[4, 2, 4, 8],
		[0, 2, 4, 8],
	);
	const over = game.applyMove(state, "left", () => 0.5);
	assert.equal(over.status, "over");
	assert.equal(game.canPlay(over.board), false);
	assert.equal(game.maxTile(over.board), 8);
});

test("undoMove：回退棋盘与得分，且只能回退有历史的局", () => {
	const game = plugin();
	const state = game.freshState(() => 0, 0);
	state.board = board([2, 2, 0, 0], zeros(4), zeros(4), zeros(4));
	const moved = game.applyMove(state, "left", () => 0);
	const undone = game.undoMove(moved);
	assert.deepEqual(plain(undone.board), plain(moved.history[0].board));
	assert.equal(undone.score, 0);
	assert.equal(undone.history.length, 0);
	assert.equal(game.undoMove(undone), undone);
});

test("loadGame：恢复合法残局，忽略坏存档", () => {
	const saved = board([2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2, 4], [8, 16, 32, 0]);
	const storage = memoryStorage({
		"dsh-1024-game/state": JSON.stringify({ v: 1, board: saved, score: 36, best: 512, moves: 9, achieved: true, playable: true }),
	});
	const fresh = loadPlugin({ storage }).exports.__internal.game.get();
	assert.deepEqual(plain(fresh.board), saved);
	assert.equal(fresh.score, 36);
	assert.equal(fresh.best, 512);
	assert.equal(fresh.moves, 9);
	assert.equal(fresh.achieved, true);
	assert.equal(fresh.status, "playing");

	const broken = memoryStorage({ "dsh-1024-game/state": "{not json" });
	const fallback = loadPlugin({ storage: broken }).exports.__internal.game.get();
	assert.equal(fallback.board.filter((value) => value !== 0).length, 2);
	assert.equal(fallback.score, 0);
});

test("actions：移动会写回 localStorage，撤销与重开可用", () => {
	const storage = memoryStorage();
	const { exports } = loadPlugin({ storage });
	const game = exports.__internal;
	const state = game.freshState(() => 0, 0);
	state.board = board([2, 2, 0, 0], zeros(4), zeros(4), zeros(4));
	game.game.set(state);

	game.actions.move("left");
	const afterMove = game.game.get();
	assert.equal(afterMove.score, 4);
	assert.equal(afterMove.moves, 1);
	assert.ok(storage.getItem("dsh-1024-game/state") !== null);
	assert.equal(JSON.parse(storage.getItem("dsh-1024-game/state")).score, 4);

	game.actions.undo();
	assert.equal(game.game.get().score, 0);

	game.actions.restart();
	assert.equal(game.game.get().moves, 0);
	assert.equal(game.game.get().history.length, 0);
});
