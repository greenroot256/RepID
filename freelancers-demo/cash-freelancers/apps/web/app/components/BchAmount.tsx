"use client";

import { useEffect, useState } from "react";
import { formatBch, formatUsd } from "../../lib/format";
import { satsToUsd } from "../../lib/price";

/**
 * A BCH amount with the fiat equivalent underneath, as the reference design
 * shows it.
 *
 * The fiat line is omitted entirely when the price is unavailable rather than
 * rendered as a stale or zero value: an approximate conversion that looks
 * authoritative is worse than none.
 */
export function BchAmount({
  sats,
  usd,
  className
}: {
  sats: number;
  /** Fixed fiat value (a stored or pre-computed one), which skips the lookup. */
  usd?: number | null;
  className?: string;
}) {
  const [rate, setRate] = useState<number | null>(usd ?? null);

  useEffect(() => {
    if (usd !== undefined) return;
    let cancelled = false;
    satsToUsd(sats)
      .then((value) => {
        if (!cancelled) setRate(value);
      })
      .catch(() => {
        if (!cancelled) setRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sats, usd]);

  const dollars = formatUsd(rate);

  return (
    <>
      <div className={className ?? "amount"}>{formatBch(sats)}</div>
      {dollars && <div className="amount-usd">≈ {dollars}</div>}
    </>
  );
}
