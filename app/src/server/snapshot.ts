/**
 * The internal business snapshot.
 *
 * This is the sensitive side of the boundary. It carries product titles, member
 * counts, prices, timestamps and Whop object ids. It must never be serialised
 * to the browser, and nothing in this module is imported by client code — the
 * only consumer is `project.ts`, which reads it and returns buckets.
 *
 * Ported from the halted vertical slice.
 */

import {
  readOwningAccountId,
  readPlans,
  readProductDetail,
  readProducts,
  type Env,
} from "./whop-client";

/**
 * How many products get a detail read for their affiliate fields.
 *
 * Bounded so a large catalogue cannot turn one page load into a hundred
 * requests, and set above the top bucket boundary so the bucket a district
 * lands in is exact for any business at or under this size.
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
  /** False when nothing could be read. The city renders honestly dormant. */
  reachable: boolean;
  products: SnapshotProduct[];
  plans: SnapshotPlan[];
};

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
 * A failed read is not an error to the caller: an unreachable API yields
 * `reachable: false` and empty collections, and the city renders dormant rather
 * than inventing activity.
 */
export async function captureSnapshot(env: Env): Promise<BusinessSnapshot> {
  // The business must be resolved first: both reads are scoped by it, and an
  // unscoped product read returns the public marketplace rather than failing.
  const accountId = await readOwningAccountId(env);
  if (accountId === null) return emptySnapshot(Date.now());

  const [products, plans] = await Promise.all([
    readProducts(env, accountId),
    readPlans(env, accountId),
  ]);

  const details = await Promise.all(
    products.slice(0, AFFILIATE_DETAIL_CAP).map((product) => readProductDetail(env, product.id)),
  );
  const affiliateById = new Map(
    details.filter((detail) => detail !== null).map((detail) => [detail.id, detail]),
  );

  return {
    accountId,
    capturedAt: Date.now(),
    reachable: true,
    products: products.map((product) => {
      const detail = affiliateById.get(product.id);
      return {
        id: product.id,
        title: product.title,
        visible: product.visibility === "visible",
        memberCount: toNumber(product.member_count),
        // Only an explicit "enabled" counts. An absent field means the detail
        // read was skipped or failed, and an unknown is never read as a yes.
        affiliateEnabled: detail?.global_affiliate_status === "enabled",
        affiliatePercentage: toNumber(detail?.global_affiliate_percentage),
        memberAffiliateEnabled: detail?.member_affiliate_status === "enabled",
        createdAt: toEpoch(product.created_at),
      };
    }),
    plans: plans.map((plan) => ({
      id: plan.id,
      planType: plan.plan_type,
      visible: plan.visibility === "visible",
      priceMinorUnits: Math.round(toNumber(plan.initial_price?.amount) * 100),
      createdAt: toEpoch(plan.created_at),
    })),
  };
}
