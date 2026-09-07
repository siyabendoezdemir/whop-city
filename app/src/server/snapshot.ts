/**
 * The internal business snapshot.
 *
 * This is the sensitive side of the boundary. It carries product titles, member
 * counts, prices, timestamps and Whop object ids. It must never be serialised
 * to the browser, and nothing in this module is imported by client code — the
 * only consumer is `project.ts`, which reads it and returns buckets.
 *
 * `captureSnapshot` answers one of two things and never blurs them:
 *
 *  - a snapshot, possibly of a business with nothing in it, which is a real
 *    answer and renders as a dormant but *live* city;
 *  - a failure, which renders as the generic unavailable city.
 *
 * The difference matters because the failure mode is silent. A city that turns
 * a timed-out read into "this business has no products" is telling the operator
 * their shop is empty when in fact we could not look.
 */

import {
  readOwningAccountId,
  readPlans,
  readProductDetail,
  readProducts,
  type Env,
  type Read,
} from "./whop-client";

/**
 * How many products get a detail read for their affiliate fields.
 *
 * Bounded so a large catalogue cannot turn one page load into a hundred
 * requests, and set above the top bucket boundary so the bucket a district
 * lands in is exact for any business at or under this size. Products past the
 * cap are a known, deliberate limit rather than a failed read.
 */
const AFFILIATE_DETAIL_CAP = 24;

export type SnapshotProduct = {
  id: string;
  title: string | null;
  visible: boolean;
  memberCount: number;
  affiliateEnabled: boolean;
  affiliatePercentage: number;
  memberAffiliateEnabled: boolean;
  createdAt: number | null;
};

export type SnapshotPlan = {
  id: string;
  planType: string | null;
  visible: boolean;
  priceMinorUnits: number;
  createdAt: number | null;
};

export type BusinessSnapshot = {
  accountId: string | null;
  capturedAt: number;
  /** False only for the fixture that models an unreadable business. */
  reachable: boolean;
  products: SnapshotProduct[];
  plans: SnapshotPlan[];
};

/** A capture either produced a picture of the business, or it did not. */
export type Capture = { ok: true; snapshot: BusinessSnapshot } | { ok: false };

export function emptySnapshot(capturedAt: number): BusinessSnapshot {
  return { accountId: null, capturedAt, reachable: false, products: [], plans: [] };
}

function toEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNumber(value: unknown): number {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reads the business through the named read-only functions and normalises it.
 *
 * Every read here is mandatory, including the per-product detail reads. That is
 * deliberate and it is the strict choice: a failed detail read would otherwise
 * make Creator Quarter look dormant when the truth is that we could not read
 * its affiliate status. One flaky request costs the whole capture and the city
 * says so, which is the behaviour to prefer while there is no history store to
 * fall back on.
 */
/** The plan's price, from whichever shape the API returned it in. */
function initialPriceOf(plan: { initial_price?: unknown }): number {
  const price = plan.initial_price;
  if (typeof price === "number") return Number.isFinite(price) ? price : 0;
  if (price && typeof price === "object" && "amount" in price) {
    return toNumber((price as { amount?: unknown }).amount);
  }
  return 0;
}

export async function captureSnapshot(env: Env): Promise<Capture> {
  // The business must be resolved first: both reads are scoped by it, and an
  // unscoped product read returns the public marketplace rather than failing.
  const account = await readOwningAccountId(env);
  if (!account.ok) return { ok: false };

  const [products, plans] = await Promise.all([
    readProducts(env, account.data),
    readPlans(env, account.data),
  ]);
  if (!products.ok || !plans.ok) return { ok: false };

  const details = await Promise.all(
    products.data.slice(0, AFFILIATE_DETAIL_CAP).map((product) => readProductDetail(env, product.id)),
  );
  if (details.some((detail: Read<unknown>) => !detail.ok)) return { ok: false };

  const affiliateById = new Map(
    details
      .filter((detail) => detail.ok)
      .map((detail) => [detail.data.id, detail.data] as const),
  );

  return {
    ok: true,
    snapshot: {
      accountId: account.data,
      capturedAt: Date.now(),
      reachable: true,
      products: products.data.map((product) => {
        const detail = affiliateById.get(product.id);
        return {
          id: product.id,
          title: product.title,
          visible: product.visibility === "visible",
          memberCount: toNumber(product.member_count),
          // Only an explicit "enabled" counts. An absent field means the detail
          // read was outside the cap, and an unknown is never read as a yes.
          affiliateEnabled: detail?.global_affiliate_status === "enabled",
          affiliatePercentage: toNumber(detail?.global_affiliate_percentage),
          memberAffiliateEnabled: detail?.member_affiliate_status === "enabled",
          createdAt: toEpoch(product.created_at),
        };
      }),
      plans: plans.data.map((plan) => ({
        id: plan.id,
        planType: plan.plan_type,
        visible: plan.visibility === "visible",
        priceMinorUnits: Math.round(initialPriceOf(plan) * 100),
        createdAt: toEpoch(plan.created_at),
      })),
    },
  };
}
