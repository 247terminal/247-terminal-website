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

interface Sentiment {
  long_percentage: number
  short_percentage: number
  longs: number
  shorts: number
}

export default function LiveStats({ apiUrl }: LiveStatsProps) {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const [trades7d, setTrades7d] = useState<number | null>(null)
  const [trades30d, setTrades30d] = useState<number | null>(null)
  const [sentiment7d, setSentiment7d] = useState<Sentiment | null>(null)
  const [sentiment30d, setSentiment30d] = useState<Sentiment | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(apiUrl)
      if (response.ok) {
        const data = await response.json()
        if ((data.success || data.status === 'success') && data.data) {
          setTrades7d(data.data.trades_7d || 0)
          setTrades30d(data.data.trades_30d || 0)
          setSentiment7d(data.data.sentiment_7d || null)
          setSentiment30d(data.data.sentiment_30d || null)
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
  const currentSentiment = period === '7d' ? sentiment7d : sentiment30d

  if (isLoading) {
    return (
      <div class="mt-4 flex justify-end">
        <div
          class="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg animate-pulse"
          style={{
            background: 'rgba(24, 24, 27, 0.6)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div class="h-4 w-16 bg-white/10 rounded" />
          <div class="h-5 w-20 bg-white/10 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div class="mt-4 flex justify-end">
      <div
        class="inline-flex items-center rounded-lg transition-all duration-300"
        style={{
          background: 'rgba(24, 24, 27, 0.7)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        {/* Left - Trade count */}
        <div class="flex flex-col items-center py-4 px-4 sm:px-5">
          <div class="text-xl sm:text-2xl font-bold text-white leading-none">
            <AnimatedCounter value={currentValue} />
          </div>
          <div class="text-xs text-text-tertiary mt-1">Trades</div>
        </div>

        {/* Middle - Sentiment */}
        {currentSentiment && (
          <>
            <div class="flex flex-col items-center py-4 px-3 sm:px-4">
              <div class="text-xl sm:text-2xl font-bold text-success leading-none">
                <AnimatedCounter value={currentSentiment.longs} />
              </div>
              <div class="text-xs text-text-tertiary mt-1">Long</div>
            </div>
            <div class="flex flex-col items-center py-4 px-3 sm:px-4">
              <div class="text-xl sm:text-2xl font-bold text-accent leading-none">
                <AnimatedCounter value={currentSentiment.shorts} />
              </div>
              <div class="text-xs text-text-tertiary mt-1">Short</div>
            </div>
          </>
        )}

        {/* Right - Live + Period toggle */}
        <div class="flex flex-col items-center gap-1 py-4 pl-4 sm:pl-6 pr-3 sm:pr-4 ml-2 border-l border-white/10 hover:bg-white/5 transition-colors rounded-r-lg">
          <a
            href={apiUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="relative flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span class="relative flex h-2 w-2">
              <span class="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            <span class="text-xs font-medium text-text-tertiary uppercase tracking-wider">Live</span>
            {showTooltip && (
              <div class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-1.5 bg-bg-elevated rounded-lg text-xs text-text-secondary whitespace-nowrap z-10"
                style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)' }}
              >
                Real-time data from 247 Terminal
                <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-bg-elevated" />
              </div>
            )}
          </a>

          {/* Period toggle */}
          <div
            class="flex items-center rounded-md p-0.5"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
            }}
          >
            <button
              type="button"
              onClick={() => setPeriod('7d')}
              class={`w-8 py-0.5 text-xs font-medium rounded transition-all duration-200 cursor-pointer ${
                period === '7d'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              7d
            </button>
            <button
              type="button"
              onClick={() => setPeriod('30d')}
              class={`w-8 py-0.5 text-xs font-medium rounded transition-all duration-200 cursor-pointer ${
                period === '30d'
                  ? 'bg-accent text-white shadow-sm'
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
