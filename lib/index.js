/**
 * dsh-1024-game — host half.
 *
 * The game itself is a pure browser surface: the Loader row exists so the Web
 * client module scanner can discover this package's `dsh.client` declaration
 * and serve `exports["./client"]` over `/plugins`. There is no host-side
 * behavior, so `apply` is intentionally empty; the empty body still makes the
 * plugin visible in `cordis.yml` and in Settings → Plugins.
 */

/** Host plugin body — no Node-side behavior for this surface-only plugin. */
export function apply() {}
