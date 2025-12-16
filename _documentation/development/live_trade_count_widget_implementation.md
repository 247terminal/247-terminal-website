# Live Trade Count Widget Implementation Guide

## Overview

This document provides step-by-step instructions for implementing a live trade count widget on the 247 Terminal website. The widget will display trade counts for the last 7 days and 30 days, updating every few seconds.

## Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   Trade Created │ ──► │ Redis INCR          │     │                 │
│   (existing)    │     │ trade:count:YYYY-MM │     │   Your Website  │
└─────────────────┘     └─────────────────────┘     │                 │
                                 │                   │   polls every   │
                                 │                   │   5-10 seconds  │
                                 ▼                   │                 │
                        ┌─────────────────────┐     └────────┬────────┘
                        │  Public API Endpoint │◄────────────┘
                        │  /api/public/stats   │
                        │  (no auth, cached)   │
                        └─────────────────────┘
```

## Why This Approach?

| Concern | How It's Addressed |
|---------|-------------------|
| **Rate limiting** | Public endpoint has its own rate limiter + browser cache headers |
| **Performance** | Redis MGET for 30 keys = ~1ms; no MongoDB load |
| **High traffic** | Can handle thousands of requests/sec; add CDN caching if needed |
| **Security** | Frontend never sees Redis/MongoDB credentials |
| **Data accuracy** | Trade counts are incremented atomically on each trade |
| **Minimal impact** | Fire-and-forget pattern doesn't slow trade creation |
| **Self-cleaning** | TTL auto-expires old daily buckets |
| **Follows existing patterns** | Matches your `chat_stats.js` architecture |

---

## Step 1: Create Redis Trade Stats Model

Create file: `app/models/redis/trade_stats.js`

```javascript
import { redis } from '#config/redis.js';
import { redis_logger as logger } from '#config/logger.js';

const KEY_PREFIX = 'trade:daily_count';

function format_date_utc(date) {
    return date.toISOString().split('T')[0];
}

function get_date_days_ago(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date;
}

export class trade_stats {
    static async record_trade() {
        await redis.connect();
        const date_key = format_date_utc(new Date());
        const key = `${KEY_PREFIX}:${date_key}`;

        const count = await redis.connection.incr(key);

        // Set TTL of 35 days (slightly more than 30 to ensure data availability)
        // Only set on first increment (when count is 1)
        if (count === 1) {
            await redis.connection.expire(key, 35 * 24 * 60 * 60);
        }

        logger.debug({
            operation: 'record_trade',
            date_key,
            new_count: count
        }, 'trade_stats:record_trade');

        return count;
    }

    static async get_trade_count(days = 7) {
        await redis.connect();

        const keys = [];
        const date_map = {};

        for (let i = 0; i < days; i++) {
            const date_key = format_date_utc(get_date_days_ago(i));
            const key = `${KEY_PREFIX}:${date_key}`;
            keys.push(key);
            date_map[key] = date_key;
        }

        // Use MGET for efficient batch retrieval
        const values = await redis.connection.mGet(keys);

        let total = 0;
        const daily = {};

        keys.forEach((key, index) => {
            const count = parseInt(values[index] || 0, 10);
            const date = date_map[key];
            daily[date] = count;
            total += count;
        });

        logger.debug({
            operation: 'get_trade_count',
            days,
            total
        }, 'trade_stats:get_trade_count');

        return { total, daily };
    }

    static async get_widget_stats() {
        await redis.connect();

        const keys_30d = [];

        for (let i = 0; i < 30; i++) {
            const date_key = format_date_utc(get_date_days_ago(i));
            keys_30d.push(`${KEY_PREFIX}:${date_key}`);
        }

        const values = await redis.connection.mGet(keys_30d);

        let count_7d = 0;
        let count_30d = 0;

        values.forEach((val, index) => {
            const count = parseInt(val || 0, 10);
            count_30d += count;
            if (index < 7) {
                count_7d += count;
            }
        });

        logger.debug({
            operation: 'get_widget_stats',
            count_7d,
            count_30d
        }, 'trade_stats:get_widget_stats');

        return {
            trades_7d: count_7d,
            trades_30d: count_30d,
            last_updated: new Date().toISOString()
        };
    }
}
```

---

## Step 2: Hook into Trade Creation

Modify file: `app/routes/trading/trading.service.js`

### 2.1 Add import at top of file

```javascript
import { trade_stats } from '#app/models/redis/trade_stats.js';
```

### 2.2 Modify `create_trade()` function

Add the Redis increment call after `await trade.save()` (around line 28):

```javascript
async create_trade(user_id, trade_data) {
    try {
        const trade = new Trade({
            user_id,
            coin: trade_data.coin,
            direction: trade_data.direction,
            volume: trade_data.volume,
            price: trade_data.price,
            quantity: trade_data.quantity,
            exchange: trade_data.exchange,
            leverage: trade_data.leverage,
            stop_loss: trade_data.stop_loss,
            take_profit: trade_data.take_profit
        });

        const saved_trade = await trade.save();

        // Increment Redis counter for widget (fire-and-forget, don't await)
        trade_stats.record_trade().catch(err => {
            logger.error({
                operation: 'record_trade_stats_error',
                error: err.message
            }, 'trading:service:stats');
        });

        logger.info({
            operation: 'create_trade',
            user_id,
            trade_id: saved_trade.trade_id,
            coin: saved_trade.coin,
            direction: saved_trade.direction,
            volume: saved_trade.volume
        }, `trading:service:create:${saved_trade.trade_id}`);

        return saved_trade;
    } catch (error) {
        logger.error({
            operation: 'create_trade_error',
            error: error.message,
            user_id,
            trade_data
        }, 'trading:service:create');
        throw error;
    }
}
```

**Note:** Using fire-and-forget pattern (no `await`) ensures trade creation isn't slowed down by Redis. The `.catch()` prevents unhandled promise rejections.

---

## Step 3: Create Public API Endpoint

Create directory: `app/routes/public/`

### 3.1 Create `app/routes/public/public.service.js`

```javascript
import { trade_stats } from '#app/models/redis/trade_stats.js';
import { logger } from '#config/logger.js';

export const public_service = {
    async get_trade_stats() {
        try {
            const stats = await trade_stats.get_widget_stats();

            logger.info({
                operation: 'get_trade_stats',
                trades_7d: stats.trades_7d,
                trades_30d: stats.trades_30d
            }, 'public:service:get_trade_stats');

            return stats;
        } catch (error) {
            logger.error({
                operation: 'get_trade_stats_error',
                error: error.message
            }, 'public:service');
            throw error;
        }
    }
};
```

### 3.2 Create `app/routes/public/public.controller.js`

```javascript
import { public_service } from './public.service.js';
import { success_response } from '#app/utils/response.js';
import { logger } from '#config/logger.js';

export const public_controller = {
    async get_trade_stats(req, res, next) {
        try {
            const stats = await public_service.get_trade_stats();

            // Add cache headers (cache for 5 seconds on CDN/browser)
            res.set('Cache-Control', 'public, max-age=5, s-maxage=5');

            return success_response(res, stats, 'trade stats retrieved');
        } catch (error) {
            logger.error({
                operation: 'get_trade_stats_error',
                error: error.message
            }, 'public:controller');
            next(error);
        }
    }
};
```

### 3.3 Create `app/routes/public/public.routes.js`

```javascript
import express from 'express';
import { public_controller } from './public.controller.js';
import { public_rate_limit } from '#app/middleware/rate_limit.js';

const router = express.Router();

// Light rate limiting for public endpoints
router.use(public_rate_limit);

// No authentication required
router.get('/stats/trades', public_controller.get_trade_stats);

export default router;
```

---

## Step 4: Add Public Rate Limiter

Modify file: `app/middleware/rate_limit.js`

Add the following export:

```javascript
export const public_rate_limit = rate_limit({
    windowMs: 60 * 1000, // 1 minute window
    max: 120, // 120 requests per minute per IP (2 per second)
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests, please try again later'
    }
});
```

---

## Step 5: Register the Public Route

Modify your main router file (likely `app/routes/_index.js` or similar).

Add import:

```javascript
import public_routes from './public/public.routes.js';
```

Add route registration:

```javascript
// Public routes (no auth required)
router.use('/public', public_routes);
```

The endpoint will be available at: `GET /api/public/stats/trades`

---

## Step 6: Backfill Historical Data (One-time Script)

Create file: `scripts/backfill_trade_stats.js`

```javascript
import { Trade } from '#models/mongodb/trade.js';
import { redis } from '#config/redis.js';
import { mongodb } from '#config/mongodb.js';

const KEY_PREFIX = 'trade:daily_count';

function get_start_of_day_days_ago(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function diff_in_days(date1, date2) {
    const ms_per_day = 24 * 60 * 60 * 1000;
    return Math.floor((date1 - date2) / ms_per_day);
}

async function backfill() {
    await mongodb.connect();
    await redis.connect();

    console.log('Starting backfill of trade counts...');

    // Get trades from last 35 days grouped by date
    const start_date = get_start_of_day_days_ago(35);

    const results = await Trade.aggregate([
        { $match: { timestamp: { $gte: start_date } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$timestamp',
                        timezone: 'UTC'
                    }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    console.log(`Found ${results.length} days with trades`);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (const day of results) {
        const key = `${KEY_PREFIX}:${day._id}`;
        await redis.connection.set(key, day.count);

        // Set TTL: calculate days from now to that date, then add buffer
        const day_date = new Date(day._id + 'T00:00:00Z');
        const days_ago = diff_in_days(today, day_date);
        const ttl_days = 35 - days_ago;

        if (ttl_days > 0) {
            await redis.connection.expire(key, ttl_days * 24 * 60 * 60);
        }

        console.log(`Set ${day._id}: ${day.count} trades (TTL: ${ttl_days} days)`);
    }

    console.log('Backfill complete!');

    await redis.disconnect();
    process.exit(0);
}

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
```

**Run once after deployment:**

```bash
node scripts/backfill_trade_stats.js
```

---

## Step 7: Frontend Implementation

### 7.1 Environment Variable

Add to your frontend `.env`:

```
NEXT_PUBLIC_API_URL=https://api.247terminal.com
```

### 7.2 React Hook Example

Create `hooks/use_trade_stats.js`:

```javascript
import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.247terminal.com';
const POLL_INTERVAL = 10000; // 10 seconds

export function use_trade_stats() {
    const [stats, set_stats] = useState({ trades_7d: 0, trades_30d: 0 });
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState(null);

    useEffect(() => {
        const fetch_stats = async () => {
            try {
                const response = await fetch(`${API_URL}/api/public/stats/trades`);
                if (!response.ok) throw new Error('Failed to fetch');
                const data = await response.json();
                set_stats(data.data);
                set_error(null);
            } catch (err) {
                set_error(err.message);
            } finally {
                set_loading(false);
            }
        };

        fetch_stats();
        const interval = setInterval(fetch_stats, POLL_INTERVAL);

        return () => clearInterval(interval);
    }, []);

    return { stats, loading, error };
}
```

### 7.3 Widget Component Example

```javascript
import { use_trade_stats } from '../hooks/use_trade_stats';

export function TradeCountWidget() {
    const { stats, loading, error } = use_trade_stats();

    if (loading) {
        return (
            <div className="trade-widget trade-widget--loading">
                <div className="skeleton" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="trade-widget trade-widget--error">
                Unable to load trade stats
            </div>
        );
    }

    return (
        <div className="trade-widget">
            <div className="trade-widget__stat">
                <span className="trade-widget__value">
                    {stats.trades_7d.toLocaleString()}
                </span>
                <span className="trade-widget__label">trades (7 days)</span>
            </div>
            <div className="trade-widget__stat">
                <span className="trade-widget__value">
                    {stats.trades_30d.toLocaleString()}
                </span>
                <span className="trade-widget__label">trades (30 days)</span>
            </div>
        </div>
    );
}
```

### 7.4 Vue 3 Composition API Example (Alternative)

```javascript
// composables/use_trade_stats.js
import { ref, onMounted, onUnmounted } from 'vue';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.247terminal.com';
const POLL_INTERVAL = 10000;

export function use_trade_stats() {
    const stats = ref({ trades_7d: 0, trades_30d: 0 });
    const loading = ref(true);
    const error = ref(null);
    let interval = null;

    const fetch_stats = async () => {
        try {
            const response = await fetch(`${API_URL}/api/public/stats/trades`);
            if (!response.ok) throw new Error('Failed to fetch');
            const data = await response.json();
            stats.value = data.data;
            error.value = null;
        } catch (err) {
            error.value = err.message;
        } finally {
            loading.value = false;
        }
    };

    onMounted(() => {
        fetch_stats();
        interval = setInterval(fetch_stats, POLL_INTERVAL);
    });

    onUnmounted(() => {
        if (interval) clearInterval(interval);
    });

    return { stats, loading, error };
}
```

---

## API Response Format

**Endpoint:** `GET /api/public/stats/trades`

**Response:**

```json
{
    "success": true,
    "data": {
        "trades_7d": 12543,
        "trades_30d": 48291,
        "last_updated": "2025-12-16T10:30:00.000Z"
    },
    "message": "trade stats retrieved"
}
```

**Headers:**

```
Cache-Control: public, max-age=5, s-maxage=5
```

---

## File Checklist

| File | Action |
|------|--------|
| `app/models/redis/trade_stats.js` | Create new |
| `app/routes/trading/trading.service.js` | Modify (add import + increment call) |
| `app/routes/public/public.service.js` | Create new |
| `app/routes/public/public.controller.js` | Create new |
| `app/routes/public/public.routes.js` | Create new |
| `app/middleware/rate_limit.js` | Modify (add public_rate_limit) |
| `app/routes/_index.js` | Modify (register public routes) |
| `scripts/backfill_trade_stats.js` | Create new |

---

## Testing

### Manual Testing

1. Create a trade via your existing API
2. Check Redis for the key:
   ```bash
   redis-cli GET "trade:daily_count:2025-12-16"
   ```
3. Call the public endpoint:
   ```bash
   curl https://api.247terminal.com/api/public/stats/trades
   ```

### Unit Test Example

```javascript
import { trade_stats } from '#app/models/redis/trade_stats.js';

describe('trade_stats', () => {
    it('should increment daily count', async () => {
        const count_before = await trade_stats.get_trade_count(1);
        await trade_stats.record_trade();
        const count_after = await trade_stats.get_trade_count(1);

        expect(count_after.total).toBe(count_before.total + 1);
    });

    it('should return 7d and 30d stats', async () => {
        const stats = await trade_stats.get_widget_stats();

        expect(stats).toHaveProperty('trades_7d');
        expect(stats).toHaveProperty('trades_30d');
        expect(stats).toHaveProperty('last_updated');
        expect(stats.trades_7d).toBeLessThanOrEqual(stats.trades_30d);
    });
});
```

---

## Performance Considerations

| Metric | Expected Value |
|--------|----------------|
| Redis MGET (30 keys) | ~1ms |
| Endpoint response time | <10ms |
| Redis memory per day | ~50 bytes |
| Max requests/sec (single instance) | 5000+ |

---

## Optional Enhancements

### 1. Add CORS for Frontend Domain

If your frontend is on a different domain, ensure CORS is configured:

```javascript
// In your main app setup
app.use('/api/public', cors({
    origin: ['https://247terminal.com', 'https://www.247terminal.com'],
    methods: ['GET'],
    maxAge: 86400
}));
```

### 2. Add CDN Caching (Cloudflare/Vercel)

The `Cache-Control` headers are already set. If using Cloudflare, the `s-maxage=5` will cache at the edge for 5 seconds.

### 3. Add WebSocket for Real-time Updates (Future)

If polling every 10 seconds isn't real-time enough, consider adding a WebSocket subscription that broadcasts on each trade.

---

## References

- [Redis Counters and Statistics](https://redis.com/ebook/part-2-core-concepts/chapter-5-using-redis-for-application-support/5-2-counters-and-statistics/)
- [Storing Counters in Redis](https://redis.io/glossary/storing-counters-in-redis/)
- [MongoDB vs Redis: Complete Comparison 2025](https://www.bytebase.com/blog/mongodb-vs-redis/)
- [Redis vs MongoDB Performance](https://scalegrid.io/blog/redis-vs-mongodb-performance/)
- [Complete Guide to Redis in 2025](https://www.dragonflydb.io/guides/complete-guide-to-redis-architecture-use-cases-and-more)
