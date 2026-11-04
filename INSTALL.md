# 安装 dsh-1024-game（给同事）

在 DeepSeek Harness 的左侧栏面板列表里，多一个「1024 小游戏」入口，点进去就是棋盘页。

**前提**：DSH 0.2.x（桌面版或 `dsh web` 都行），装完需要重启一次 DSH。

---

## 方式 A · 桌面版图形界面（推荐）

1. 打开 DSH → **设置 → 插件**（Plugins）
2. 找到安装/添加插件的输入框，粘贴这一行：

   ```
   github:akiwu/dsh-1024-game
   ```

3. 点安装，等它跑完（会 clone 仓库并写入 profile）
4. **完全退出 DSH 再打开**（macOS 用 ⌘Q）
5. 左侧栏「插件」下面会出现「1024 小游戏」

> 桌面版的 profile 由 App 自己管理，**不要**在终端里对 `web` profile 装，那里装了桌面版看不到。

## 方式 B · 命令行（`dsh web` 用户）

```sh
dsh plugin --profile web add "github:akiwu/dsh-1024-game"
# 装完重启 dsh web
```

别的 profile 就把 `web` 换成你的 profile 名。

## 方式 C · 离线 tarball（GitHub 慢 / 不能 clone 时）

下载这个文件（约 360 KB）：

```
https://github.com/akiwu/dsh-1024-game/releases/latest/download/dsh-1024-game.tgz
```

然后在安装入口粘贴**它的绝对路径**，例如：

```
/Users/你的用户名/Downloads/dsh-1024-game.tgz
```

命令行等价：

```sh
dsh plugin add "/Users/你的用户名/Downloads/dsh-1024-game.tgz"
```

## 怎么玩

| 按键 | 作用 |
|---|---|
| `←` `↑` `→` `↓` / `WASD` | 移动方块 |
| `R` | 重新开局 |
| `⌘ / Ctrl` + `Z` | 撤销一步 |
| 在棋盘上拖动 | 触屏滑动 |

同值方块相撞合并，合成出 1024 即达成；最高分与残局存在本机。

## 排障

| 现象 | 处理 |
|---|---|
| 装完左侧栏没有入口 | 重启 DSH；再确认 设置 → 插件 里 `dsh-1024-game` 是启用状态 |
| 页面还是旧界面 | 刷新一次（⌘R） |
| 安装报 “already-installed” | 已经装过了；先移除再装即可 |
| 想卸载 | 设置 → 插件 里移除 `dsh-1024-game`，或从 profile 的 `package.json` 删掉依赖与 `dsh.profile.bundles` 里的条目 |
