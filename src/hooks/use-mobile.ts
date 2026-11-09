import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * v1.3.15 安全/质量复查：原实现于 useEffect 内同步 setIsMobile，
 * 触发 react-hooks/set-state-in-effect（级联渲染）。
 * 改用 useSyncExternalStore 订阅 matchMedia —— 快照读取无级联，
 * getServerSnapshot 保证 SSR 水合一致，返回签名不变。
 */
export function useIsMobile() {
  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
