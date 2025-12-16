import { useEffect, useState, useRef, useCallback } from 'preact/hooks'

interface LiveStatsProps {
  apiUrl: string
}

function AnimatedCounter({ value, duration = 2000 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0)
  const [hasAnimated, setHasAnimated] = useState(false)
  const [prevValue, setPrevValue] = useState(value)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true)
          const startTime = performance.now()
          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime
            const progress = Math.min(elapsed / duration, 1)
            const easeOut = 1 - Math.pow(1 - progress, 3)
            setCount(Math.floor(easeOut * value))
            if (progress < 1) {
              requestAnimationFrame(animate)
            }
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.5 }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [duration, hasAnimated])

  useEffect(() => {
    if (hasAnimated && value !== prevValue) {
      const startValue = prevValue
      const startTime = performance.now()
      const animDuration = 800

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime
        const progress = Math.min(elapsed / animDuration, 1)
        const easeOut = 1 - Math.pow(1 - progress, 3)
        const currentCount = Math.floor(startValue + (value - startValue) * easeOut)
        setCount(currentCount)
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          setPrevValue(value)
        }
      }
      requestAnimationFrame(animate)
    }
  }, [value, hasAnimated, prevValue])

  return (
    <span ref={ref} class="tabular-nums">
      {count.toLocaleString()}
    </span>
  )
}

export default function LiveStats({ apiUrl }: LiveStatsProps) {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const [showTooltip, setShowTooltip] = useState(false)
  const [trades7d, setTrades7d] = useState<number | null>(null)
  const [trades30d, setTrades30d] = useState<number | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(apiUrl)
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.data) {
          setTrades7d(data.data.trades_7d || 0)
          setTrades30d(data.data.trades_30d || 0)
        }
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }, [apiUrl])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 60000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const isLoading = trades7d === null || trades30d === null
  const currentValue = period === '7d' ? (trades7d ?? 0) : (trades30d ?? 0)

  if (isLoading) {
    return (
      <div class="mt-6 relative rounded-xl border border-border bg-bg-surface overflow-hidden animate-pulse">
        <div class="px-4 py-1.5 border-b border-border">
          <div class="h-4 w-20 bg-bg-elevated rounded" />
        </div>
        <div class="p-3 sm:p-4">
          <div class="h-10 w-full bg-bg-elevated rounded" />
        </div>
      </div>
    )
  }

  return (
    <div class="mt-6 relative rounded-xl border border-border bg-bg-surface overflow-hidden">

      <div class="relative flex items-center justify-between px-4 py-1.5 border-b border-border">
        <div class="flex items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <span class="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          <span class="text-xs font-medium text-text-tertiary">Live Stats</span>
        </div>
        <div class="relative">
          <button
            type="button"
            class="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {showTooltip && (
            <div class="absolute top-full right-0 mt-1 px-3 py-2 bg-bg-elevated border border-border rounded-lg text-xs text-text-secondary whitespace-nowrap z-10 -mr-2">
              Real-time data from 247 Terminal users
              <div class="absolute bottom-full right-[9px] border-4 border-transparent border-b-bg-elevated" />
            </div>
          )}
        </div>
      </div>

      <div class="relative flex items-stretch p-3 sm:p-4">
        <div class="shrink-0 pr-3 sm:pr-4 border-r border-border flex items-center">
          <svg class="w-6 h-6 sm:w-8 sm:h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>

        <div class="flex-1 text-center min-w-0 flex flex-col justify-center">
          <div class="text-xl sm:text-2xl lg:text-3xl font-bold text-white">
            <AnimatedCounter value={currentValue} />
          </div>
          <div class="text-text-secondary text-xs sm:text-sm">Trades Executed</div>
        </div>

        <div class="shrink-0 pl-3 sm:pl-4 border-l border-border flex items-center">
          <div class="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setPeriod('7d')}
              class={`px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                period === '7d'
                  ? 'bg-accent text-white'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              7d
            </button>
            <button
              type="button"
              onClick={() => setPeriod('30d')}
              class={`px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                period === '30d'
                  ? 'bg-accent text-white'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              30d
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
