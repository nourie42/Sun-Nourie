/**
 * Smart Alerts & Deduplicated Notification Delivery Engine.
 *
 * Honesty invariant:
 * - Never claims email, mobile, or push notifications are active until the
 *   relevant provider/permission has actually been configured and verified.
 */

import crypto from 'node:crypto';
import { matchWishlistToDeal } from './intelligence.js';

export function isWithinQuietHours(alertSettings = {}, now = new Date(), timeZone = 'America/New_York') {
  if (!alertSettings.quietHoursEnabled) return false;
  const start = parseHHMM(alertSettings.quietHoursStart || '22:00');
  const end = parseHHMM(alertSettings.quietHoursEnd || '07:00');
  if (start === null || end === null) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const min = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const current = hour * 60 + min;

  if (start > end) {
    return current >= start || current < end;
  }
  return current >= start && current < end;
}

function parseHHMM(str) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function getChannelStatus({ env = process.env, settings = {} } = {}) {
  const emailConfigured = Boolean(env.RESEND_API_KEY && (settings.alerts?.emailRecipient || env.BLACK_FRIDAY_ALERT_EMAIL));
  const webhookConfigured = Boolean(env.BLACK_FRIDAY_ALERT_WEBHOOK_URL);

  return {
    inDashboard: {
      configured: true,
      active: true,
      label: 'In-Dashboard Alerts',
      detail: 'Active — real-time banner, alert center, and SSE stream.',
    },
    browserPush: {
      configured: Boolean(settings.alerts?.browserNotificationsEnabled),
      active: Boolean(settings.alerts?.browserNotificationsEnabled),
      label: 'Browser Notifications',
      detail: settings.alerts?.browserNotificationsEnabled
        ? 'Permission enabled in browser — verify with Send Test Alert.'
        : 'Not enabled yet — grant browser notification permission in Alerts page.',
    },
    email: {
      configured: emailConfigured,
      active: Boolean(emailConfigured && settings.alerts?.emailEnabled),
      label: 'Email Delivery (Resend)',
      recipient: settings.alerts?.emailRecipient || env.BLACK_FRIDAY_ALERT_EMAIL || null,
      detail: emailConfigured
        ? (settings.alerts?.emailEnabled
            ? `Configured for ${settings.alerts?.emailRecipient || env.BLACK_FRIDAY_ALERT_EMAIL}`
            : 'RESEND_API_KEY detected; enable email delivery toggle to send.')
        : 'Not configured — set RESEND_API_KEY and recipient email in hosting env / Settings.',
    },
    webhook: {
      configured: webhookConfigured,
      active: Boolean(webhookConfigured && settings.alerts?.webhookEnabled),
      label: 'Mobile / Webhook Push (ntfy / Discord / Slack)',
      detail: webhookConfigured
        ? (settings.alerts?.webhookEnabled ? 'Configured and active.' : 'BLACK_FRIDAY_ALERT_WEBHOOK_URL detected; toggle on to send.')
        : 'Not configured — set BLACK_FRIDAY_ALERT_WEBHOOK_URL to deliver mobile/webhook alerts.',
    },
  };
}

/**
 * Evaluate new alerts across all tracked wish-list items and live evaluated deals.
 * Uses deterministic dedupKeys so unchanged deals never spam repeat notifications.
 */
export function evaluateSmartAlerts({
  wishlist = [],
  evaluatedDeals = [],
  previousDealsById = {},
  existingAlerts = [],
  settings = {},
  now = new Date(),
} = {}) {
  const alertCfg = settings.alerts || {};
  const minDiscount = Number(alertCfg.defaultDiscountTriggerPct ?? 25);
  const dropTriggerPct = Number(alertCfg.priceDropSinceLastCheckPct ?? 10);
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const seenDedupKeys = new Set(existingAlerts.map((a) => a.dedupKey));
  const newAlerts = [];

  const pushIfNew = (alert) => {
    if (seenDedupKeys.has(alert.dedupKey)) return;
    seenDedupKeys.add(alert.dedupKey);
    newAlerts.push({
      id: `al_${crypto.randomBytes(6).toString('hex')}`,
      triggeredAt: nowIso,
      read: false,
      channelsAttempted: ['in_dashboard'],
      channelsDelivered: ['in_dashboard'],
      ...alert,
    });
  };

  const activeWish = wishlist.filter((w) => !['purchased', 'no_longer_interested'].includes(w.status));

  for (const item of activeWish) {
    const matches = evaluatedDeals
      .filter((d) => !d.archived && d.currentPrice !== null && matchWishlistToDeal(item, d).matched)
      .sort((a, b) => (a.finalAllInTotal ?? a.currentPrice) - (b.finalAllInTotal ?? b.currentPrice));

    if (!matches.length) continue;
    const best = matches[0];
    const prev = previousDealsById[best.id];

    // 1. Default trigger: ≥ 25% verified discount on wish-list item
    if (best.verifiedDiscountPct !== null && best.verifiedDiscountPct >= minDiscount) {
      pushIfNew({
        dedupKey: `wish-disc:${item.id}:${best.id}:${best.currentPrice}`,
        type: 'wishlist_discount',
        severity: best.verifiedDiscountPct >= 40 ? 'high' : 'medium',
        title: `${best.verifiedDiscountPct}% OFF Wish-List Item: ${item.name}`,
        message: `${best.retailerName} has "${best.title}" at $${best.currentPrice.toFixed(2)} (est. $${best.finalAllInTotal?.toFixed(2)} all-in), ${best.verifiedDiscountPct}% below $${best.normalPrice?.toFixed(2)} (${best.baselineLabel}).`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 2. Desired / preferred target price reached
    if (alertCfg.enableTargetPrice !== false && item.preferredPrice && best.currentPrice <= item.preferredPrice) {
      pushIfNew({
        dedupKey: `target:${item.id}:${best.id}:${best.currentPrice}`,
        type: 'target_price_reached',
        severity: 'high',
        title: `Target Price Reached: ${item.name}`,
        message: `Verified at $${best.currentPrice.toFixed(2)} at ${best.retailerName} — meets or beats your $${item.preferredPrice.toFixed(2)} target.`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 3. New historical low
    if (alertCfg.enableHistoricalLow !== false && (best.priceStats?.isAtObservedLow || best.mentionsAllTimeLow)) {
      pushIfNew({
        dedupKey: `hist-low:${item.id}:${best.id}:${best.currentPrice}`,
        type: 'historical_low',
        severity: 'high',
        title: `Historical Low Detected: ${item.name}`,
        message: `$${best.currentPrice.toFixed(2)} at ${best.retailerName} matches or beats the lowest recorded price.`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 4. Better price at another retailer (when ≥ 2 retailers carry the item)
    if (alertCfg.enableBetterRetailer !== false && matches.length >= 2) {
      const second = matches.find((m) => m.retailerId !== best.retailerId);
      if (second && second.currentPrice - best.currentPrice >= 5) {
        const diff = (second.currentPrice - best.currentPrice).toFixed(2);
        pushIfNew({
          dedupKey: `better-ret:${item.id}:${best.retailerId}:${best.currentPrice}:${second.retailerId}`,
          type: 'better_retailer',
          severity: 'medium',
          title: `Better Price at ${best.retailerName} (-$${diff}): ${item.name}`,
          message: `${best.retailerName} is $${best.currentPrice.toFixed(2)} vs $${second.currentPrice.toFixed(2)} at ${second.retailerName}.`,
          wishlistItemId: item.id,
          dealId: best.id,
          retailerUrl: best.retailerUrl,
        });
      }
    }

    // 5. Back in stock transition
    if (alertCfg.enableBackInStock !== false && prev?.availabilityStatus === 'out_of_stock' && best.availabilityStatus === 'in_stock') {
      pushIfNew({
        dedupKey: `restock:${item.id}:${best.id}:${nowIso.slice(0, 10)}`,
        type: 'back_in_stock',
        severity: 'high',
        title: `Back in Stock: ${item.name}`,
        message: `${best.retailerName} now reports "${best.title}" back in stock at $${best.currentPrice.toFixed(2)}.`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 6. Significant price drop since previous check
    if (prev?.currentPrice > 0 && best.currentPrice < prev.currentPrice) {
      const dropPct = ((prev.currentPrice - best.currentPrice) / prev.currentPrice) * 100;
      if (dropPct >= dropTriggerPct) {
        pushIfNew({
          dedupKey: `drop:${item.id}:${best.id}:${best.currentPrice}`,
          type: 'price_drop',
          severity: 'high',
          title: `Price Dropped ${dropPct.toFixed(0)}% Since Last Check: ${item.name}`,
          message: `Fell from $${prev.currentPrice.toFixed(2)} to $${best.currentPrice.toFixed(2)} at ${best.retailerName}.`,
          wishlistItemId: item.id,
          dealId: best.id,
          retailerUrl: best.retailerUrl,
        });
      }
    }

    // 7. Major coupon code available
    if (alertCfg.enableMajorCoupon !== false && best.couponCode) {
      pushIfNew({
        dedupKey: `coupon:${item.id}:${best.id}:${best.couponCode}`,
        type: 'major_coupon',
        severity: 'medium',
        title: `Promo Code ${best.couponCode} for ${item.name}`,
        message: `Apply code ${best.couponCode} at ${best.retailerName} for $${best.currentPrice.toFixed(2)}.`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 8. Verified local pickup in Knightdale/Raleigh
    if (alertCfg.enableLocalPickup !== false && best.localPickupKnightdale === 'available') {
      pushIfNew({
        dedupKey: `pickup:${item.id}:${best.id}:${best.currentPrice}`,
        type: 'local_pickup',
        severity: 'medium',
        title: `Knightdale Area Pickup Available: ${item.name}`,
        message: `${best.retailerName} verified local pickup availability at $${best.currentPrice.toFixed(2)}.`,
        wishlistItemId: item.id,
        dealId: best.id,
        retailerUrl: best.retailerUrl,
      });
    }

    // 9. Deal approaching verified expiration (< 24h)
    if (alertCfg.enableExpiringSoon !== false && best.expiresAt) {
      const hoursLeft = (Date.parse(best.expiresAt) - nowMs) / 3600000;
      if (hoursLeft > 0 && hoursLeft <= 24) {
        pushIfNew({
          dedupKey: `expiring:${item.id}:${best.id}:${best.expiresAt.slice(0, 10)}`,
          type: 'expiring_soon',
          severity: 'medium',
          title: `Deal Ending Within 24h: ${item.name}`,
          message: `"${best.title}" at ${best.retailerName} ($${best.currentPrice.toFixed(2)}) expires ${best.expiresAt.slice(0, 10)}.`,
          wishlistItemId: item.id,
          dealId: best.id,
          retailerUrl: best.retailerUrl,
        });
      }
    }
  }

  // Also alert on genuinely Exceptional (≥40%) Black Friday deals matching user brand/category if no wish-list alerts fired for them
  for (const deal of evaluatedDeals.filter((d) => !d.archived && d.tier === 'exceptional' && d.confidenceScore >= 70).slice(0, 3)) {
    pushIfNew({
      dedupKey: `exceptional:${deal.id}:${deal.currentPrice}`,
      type: 'exceptional_deal',
      severity: 'medium',
      title: `Exceptional ${deal.verifiedDiscountPct}% Verified Drop: ${deal.title.slice(0, 72)}`,
      message: `${deal.retailerName} at $${deal.currentPrice.toFixed(2)} (normally $${deal.normalPrice?.toFixed(2)}). ${deal.whyWorthConsidering}`,
      wishlistItemId: deal.matchedWishlistIds?.[0] || null,
      dealId: deal.id,
      retailerUrl: deal.retailerUrl,
    });
  }

  return newAlerts;
}

/**
 * Deliver an alert through configured external channels (Resend email / Webhook).
 * Respects quiet hours unless force=true (e.g. explicit user Test Alert).
 */
export async function deliverAlertExternally(alert, {
  env = process.env,
  settings = {},
  fetchImpl = globalThis.fetch,
  force = false,
  now = new Date(),
} = {}) {
  const status = getChannelStatus({ env, settings });
  const quiet = !force && isWithinQuietHours(settings.alerts, now, settings.location?.timeZone || 'America/New_York');
  const results = { quietHoursDeferred: quiet, email: null, webhook: null };

  if (quiet) return results;

  if (status.email.configured && (status.email.active || force)) {
    const to = status.email.recipient;
    const from = env.BLACK_FRIDAY_ALERT_FROM || 'Black Friday Command Center <onboarding@resend.dev>';
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `[Black Friday Command Center] ${alert.title}`,
          text: `${alert.title}\n\n${alert.message}\n\nLink: ${alert.retailerUrl || 'Open dashboard'}\nTriggered: ${alert.triggeredAt}`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      results.email = { ok: res.ok, status: res.status };
      if (res.ok) {
        alert.channelsAttempted = [...new Set([...(alert.channelsAttempted || []), 'email'])];
        alert.channelsDelivered = [...new Set([...(alert.channelsDelivered || []), 'email'])];
      }
    } catch (e) {
      results.email = { ok: false, error: String(e?.message || e) };
    }
  }

  if (status.webhook.configured && (status.webhook.active || force)) {
    try {
      const res = await fetchImpl(env.BLACK_FRIDAY_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: alert.title,
          content: `**${alert.title}**\n${alert.message}\n${alert.retailerUrl || ''}`,
          text: `${alert.title} — ${alert.message} ${alert.retailerUrl || ''}`,
          alert,
        }),
        signal: AbortSignal.timeout(8000),
      });
      results.webhook = { ok: res.ok, status: res.status };
      if (res.ok) {
        alert.channelsAttempted = [...new Set([...(alert.channelsAttempted || []), 'webhook'])];
        alert.channelsDelivered = [...new Set([...(alert.channelsDelivered || []), 'webhook'])];
      }
    } catch (e) {
      results.webhook = { ok: false, error: String(e?.message || e) };
    }
  }

  return results;
}
